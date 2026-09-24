import React, { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api, { parseApiError } from '../api/axios';
import { invalidateCatalog } from '../utils/invalidateCatalog';
import Admin from '../components/admin/Admin';
import Modal from '../components/common/Modal';

// Local placeholder — a cross-origin one is blocked by the document's COEP
// (see ProductCard.jsx for the full explanation).
const DEFAULT_IMAGE_URL = '/images/placeholder.svg';
const AVAILABLE_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

const INITIAL_FORM_STATE = {
  name: '',
  price: '',
  category: 'TOPS',
  subcategory: '',
  description: '',
  colors: [],
  material: '',
  gender: 'Men',
  featured: false,
  sizes: {},
  size_measurements: {},
  image_url: '',
};

// ── Pure Helper Functions ─────────────────────────

const parseJsonSafely = (data) => {
  if (typeof data !== 'string') return data || {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
};

const normalizeSizes = (rawSizes) => {
  const parsed = parseJsonSafely(rawSizes);
  const cleanSizes = {};

  if (Array.isArray(parsed)) {
    parsed.forEach((item) => {
      if (item?.size_label) cleanSizes[item.size_label] = item.stock || 0;
    });
  } else if (typeof parsed === 'object' && parsed !== null) {
    Object.entries(parsed).forEach(([lbl, val]) => {
      cleanSizes[lbl] = typeof val === 'object' ? val.stock || 0 : Number(val) || 0;
    });
  }
  return cleanSizes;
};

const processSizesAndMeasurements = (sourceData, formData) => {
  const cleanedSizes = {};
  const cleanedMeasurements = {};
  let totalStock = 0;

  const rawSizes = sourceData.sizes || formData.sizes || {};
  const rawSizeStocks = sourceData.size_stocks || sourceData.stocks || {};
  const rawSizeMeasurements = sourceData.size_measurements || formData.size_measurements || {};

  if (Array.isArray(rawSizes)) {
    rawSizes.forEach((sz) => {
      const sizeLabel = typeof sz === 'string' ? sz : sz?.size_label || sz?.size;
      if (!sizeLabel) return;

      const stockValue = typeof sz === 'object' ? sz.stock : rawSizeStocks[sizeLabel];
      const stockVal = parseInt(stockValue, 10) || 0;
      cleanedSizes[sizeLabel] = stockVal;
      totalStock += stockVal;

      if (rawSizeMeasurements[sizeLabel]) {
        cleanedMeasurements[sizeLabel] = rawSizeMeasurements[sizeLabel];
      }
    });
  } else {
    Object.entries(rawSizes).forEach(([lbl, val]) => {
      const qty = typeof val === 'object' ? val.stock : val;
      const num = parseInt(qty, 10) || 0;
      if (num > 0 || AVAILABLE_SIZE_LABELS.includes(lbl)) {
        cleanedSizes[lbl] = num;
        totalStock += num;

        if (rawSizeMeasurements?.[lbl]) {
          cleanedMeasurements[lbl] = rawSizeMeasurements[lbl];
        }
      }
    });
  }

  return { cleanedSizes, cleanedMeasurements, totalStock };
};

/*
 * Resolve a usable file extension for BOTH upload shapes this app produces:
 *
 *   - a `File` from an <input type="file">, which has a real `.name`
 *   - a canvas `Blob` from `canvas.toBlob(...)` in the garment compositor,
 *     which has NO `.name` at all
 *
 * WHY THIS MATTERS
 * ----------------
 * The background-removed catalog image arrives as a plain Blob. The previous
 * code did `activeFile.name.split('.').pop()` unguarded, which threw
 * `Cannot read properties of undefined (reading 'split')` for every composite,
 * was swallowed by the catch, and returned `null` — so the AI cut-out was NEVER
 * uploaded and `display_image_url` stayed empty on every product. That is why
 * the original photo kept appearing in Inventory, Spotlight, Shop, QuickView,
 * ProductDetails and My Bag: the good image never left the browser.
 *
 * The MIME type is the authoritative source for a Blob; the filename is only a
 * fallback for a File.
 */
const resolveImageExtension = (file) => {
  const mimeToExt = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  if (file?.type && mimeToExt[file.type]) {
    return mimeToExt[file.type];
  }

  // A File (not a canvas Blob) also carries a name we can trust.
  if (typeof file?.name === 'string' && file.name.includes('.')) {
    const fromName = file.name.split('.').pop();
    if (fromName) return fromName;
  }

  // PNG is what the compositor exports, so it is the safest assumption.
  return 'png';
};

/*
 * Upload the ORIGINAL product photo through the BACKEND, not the browser.
 *
 * WHY THE UPLOAD MOVED OFF THE CLIENT
 * -----------------------------------
 * This used to call `supabase.storage.from('products').upload(...)` DIRECTLY from
 * the browser. That required shipping the Supabase `service_role` key in the
 * front-end bundle (`VITE_SUPABASE_SERVICE_ROLE_KEY`), because the `products`
 * bucket allows public READS but grants no INSERT to the anon role.
 *
 * A `service_role` key is a full-admin credential: it bypasses RLS on every
 * table and every bucket in the project. Any visitor can read it straight out of
 * the JavaScript bundle, so that arrangement gave every user of the site write
 * access to the entire database and storage layer. `VITE_` variables are
 * compiled into the shipped assets — there is no such thing as a secret one.
 *
 * The backend already holds the same key in its own `.env` (server-only, never
 * serialised to a client), so the upload now POSTs the file to `/api/upload` and
 * Laravel writes it to the bucket. The key never leaves the server, and the
 * response is the SAME root-relative path this function used to return — so all
 * stored rows and every reader keep working unchanged.
 *
 * Upload result shape.
 *
 * `uploadProductImage` used to return `null` for BOTH "there was no file" and
 * "the upload failed", and every caller just did `if (url) use it`. A failed
 * catalog upload therefore saved the product with `display_image_url = null`
 * while the admin saw a green "success" toast — so the shop silently kept
 * rendering the raw, uncut original (the fallback is `display_image_url ||
 * image_url`). That is exactly the reported bug, and it was invisible.
 *
 * Returning `{ url, error }` lets the caller tell the two apart and TELL the
 * admin when the cut-out did not make it to storage.
 */
const uploadProductImage = async (activeFile) => {
  if (!activeFile) return { url: null, error: null };
  try {
    const fileExt = resolveImageExtension(activeFile);
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;

    const body = new FormData();
    // The folder is the bucket-relative prefix; `catalog` holds the finished
    // marketing cards and mattes.
    body.append('folder', 'catalog');
    body.append('file', activeFile, fileName);

    /*
     * The upload lives under the `/admin` prefix in `routes/api.php`
     * (`Route::prefix('admin')` -> `Route::post('/upload', ...)`), so the path
     * MUST be `/admin/upload`. The earlier bare `/upload` resolved to
     * `http://127.0.0.1:8000/api/upload`, which has no matching route and every
     * original-photo upload answered `404 (Not Found)` — so `image_url` was never
     * stored and the save proceeded with an empty image.
     *
     * `axios` is imported as `api` with the auth interceptor already attached, so
     * the Sanctum token travels with the request. The interceptor also drops the
     * JSON `Content-Type` for a FormData body, letting the browser set the
     * multipart boundary itself.
     */
    const res = await api.post('/admin/upload', body);

    if (!res.data?.url) {
      return { url: null, error: res.data?.message || 'Storage rejected the upload.' };
    }

    return { url: res.data.url, error: null };
  } catch (err) {
    // Report the server's reason verbatim — a missing bucket, an RLS denial and a
    // blocked network each need a different fix, so do not flatten them.
    const detail = err?.response?.data?.message || err?.message;
    console.warn('Product image upload failed:', err);

    return {
      url: null,
      error: detail || 'The image could not be uploaded. Check your connection and try again.',
    };
  }
};

// ── Component ─────────────────────────────────────

const MainDashboard = () => {
  // Used by invalidateCatalog to push catalog writes out to the storefront.
  const queryClient = useQueryClient();
  const [products, setProducts] = useState([]);
  const [ordersBadge, setOrdersBadge] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [editingProduct, setEditingProduct] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');

  const [modalConfig, setModalConfig] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    onConfirm: () => {},
  });

  const closeModal = useCallback(() => setModalConfig((prev) => ({ ...prev, isOpen: false })), []);

  const showAlertModal = useCallback((title, message) => {
    setModalConfig({
      isOpen: true,
      title,
      message,
      confirmText: 'OK',
      cancelText: 'Close',
      onConfirm: closeModal,
    });
  }, [closeModal]);

  // Fetch Public Products List
  const fetchProducts = useCallback(async () => {
    setFetching(true);
    try {
      const res = await api.get('/products');
      const rawData = Array.isArray(res.data) ? res.data : res.data?.data || [];
      setProducts(rawData);
    } catch (error) {
      const parsed = parseApiError(error);
      showAlertModal('Error', parsed.message);
    } finally {
      setFetching(false);
    }
  }, [showAlertModal]);

  /*
   * Mount data: product grid first, then the pending-orders badge.
   *
   * These used to be TWO effects firing in parallel. On the single-threaded dev
   * server the requests QUEUED behind each other and whichever lost the race sat
   * until the client's 15s timeout ("The Hiraya server took too long to
   * respond"). Running the badge AFTER the grid keeps the page independent of
   * the badge, which is cosmetic. Both live in ONE effect so the grid is fetched
   * exactly once.
   */
  useEffect(() => {
    let isMounted = true;

    // `count_only=1`: this effect needs a NUMBER, but it used to pull the whole
    // unpaginated order list (with every order's user + order items) just to read
    // `.length`. That heavy hydration QUEUED the dashboard's metrics request
    // behind it on the single-threaded dev server until it hit the 15s timeout.
    const controller = new AbortController();

    const loadBadge = async () => {
      try {
        const res = await api.get('/admin/orders', {
          params: { payment_status: 'pending', count_only: 1 },
          signal: controller.signal,
        });
        if (!isMounted) return;
        // Accepts the new { count } shape, or a legacy array payload.
        const count = typeof res.data?.count === 'number'
          ? res.data.count
          : (Array.isArray(res.data) ? res.data.length : 0);
        setOrdersBadge(count);
      } catch {
        // Badge only - a failure (or a cancel on unmount) just hides it.
        if (isMounted) setOrdersBadge(0);
      }
    };

    /*
     * WAIT for the product fetch to settle before asking for the badge count.
     *
     * The badge is cosmetic; the product grid is the page. Firing both on mount
     * made them compete for the single-threaded dev server, and whichever lost
     * the race sat in the queue until the client timeout fired ("The Hiraya
     * server took too long to respond"). Sequencing them guarantees the grid is
     * never blocked by the badge, and the badge still loads a moment later.
     */
    fetchProducts().finally(() => {
      if (isMounted) loadBadge();
    });

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [fetchProducts]);

  const resetForm = useCallback(() => {
    setEditingProduct(null);
    setFormData(INITIAL_FORM_STATE);
    setImageFile(null);
    setPreviewUrl('');
  }, []);

  const handleEditClick = (product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name || '',
      price: product.price || '',
      category: product.category || 'TOPS',
      subcategory: product.subcategory || '',
      description: product.description || '',
      colors: Array.isArray(product.colors) ? product.colors : [],
      material: product.material || '',
      gender: product.gender || 'Men',
      featured: Boolean(product.featured),
      sizes: normalizeSizes(product.sizes || product.size_stocks),
      size_measurements: parseJsonSafely(product.size_measurements),
      image_url: product.image_url || '',
    });

    /*
     * Preview the CUSTOMER-FACING image, not the raw upload.
     *
     * Inventory Management is where the admin verifies what shoppers will see,
     * so it must show the AI cut-out on the HIRAYA frame when one exists. It
     * used to show `image_url` unconditionally — the original photo — which made
     * a product look unprocessed even after a successful background removal.
     * Falls back to the original when no cut-out was ever produced.
     */
    setPreviewUrl(product.display_image_url || product.image_url || '');
    setImageFile(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteProduct = useCallback((id) => {
    setModalConfig({
      isOpen: true,
      title: 'Delete Product',
      message: 'Are you sure you want to delete this product?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: async () => {
        closeModal();
        try {
          await api.delete(`/products/${id}`);
          showAlertModal('Success', 'Product deleted successfully.');
          fetchProducts();
          /*
           * A DELETE is the case where a stale cache is most obvious: without
           * this the deleted product keeps appearing on the shop until the
           * 5-minute staleTime lapses. See utils/invalidateCatalog.js.
           */
          invalidateCatalog(queryClient);
        } catch (err) {
          const parsed = parseApiError(err);
          showAlertModal('Error', parsed.message);
        }
      },
    });
  }, [closeModal, fetchProducts, showAlertModal]);

  const handleSubmit = async (eventOrPayload, submittedPayload = null) => {
    if (eventOrPayload?.preventDefault) eventOrPayload.preventDefault();

    const isFormEvent = eventOrPayload && typeof eventOrPayload.preventDefault === 'function';
    const sourceData = !isFormEvent && typeof eventOrPayload === 'object'
      ? eventOrPayload
      : typeof submittedPayload === 'object' && submittedPayload !== null
        ? submittedPayload
        : formData;

    const productName = (
      sourceData.name ||
      sourceData.title ||
      sourceData.product_name ||
      formData.name ||
      editingProduct?.name ||
      ''
    ).trim();

    if (!productName) {
      showAlertModal('Validation Error', 'The product name is required before saving.');
      return;
    }

    setLoading(true);

    try {
      const originalUpload = await uploadProductImage(imageFile || sourceData.image_file);
      const finalImageUrl = originalUpload.url || sourceData.image_url || formData.image_url || previewUrl;

      /*
       * Keep whatever cut-out the product already has; a NEW one is uploaded by
       * the backend from the multipart `display_image_file` below and
       * `handleImageUpload()` writes the resulting URL itself.
       *
       * Sending `display_image_file` as a real upload (rather than pre-uploading
       * to Supabase and passing a URL string) is what makes the two slots work:
       * the controller can store BOTH the framed card and the bare try-on matte
       * in one request, and it deletes the previous files it is replacing.
       * Pre-uploading here orphaned those files in the bucket instead.
       *
       * `display_image_url` is deliberately NOT in the payload when no new file
       * is attached — an omission preserves the stored value, whereas sending
       * `null` would wipe it on every unrelated edit.
       */
      const displayImageUrl = sourceData.display_image_url || editingProduct?.display_image_url || '';

      const { cleanedSizes, cleanedMeasurements, totalStock } = processSizesAndMeasurements(sourceData, formData);

      let formattedColors = sourceData.colors || formData.colors || [];
      if (typeof formattedColors === 'string') {
        formattedColors = formattedColors.split(',').map((c) => c.trim()).filter(Boolean);
      }

      const payload = {
        name: productName,
        product_name: productName,
        price: parseFloat(sourceData.price || formData.price) || 0,
        category: sourceData.category || formData.category || 'TOPS',
        subcategory: sourceData.subcategory || formData.subcategory || null,
        description: sourceData.description || formData.description || '',
        stock: totalStock,
        sizes: cleanedSizes,
        size_stocks: cleanedSizes,
        size_measurements: cleanedMeasurements,
        colors: formattedColors,
        material: sourceData.material || formData.material || null,
        gender: sourceData.gender || formData.gender || 'Men',
        body_shapes: sourceData.body_shapes || formData.body_shapes || [],
        occasions: sourceData.occasions || formData.occasions || [],
        undertone: sourceData.undertone || formData.undertone || 'NEUTRAL',
        fit_type: sourceData.fit_type || formData.fit_type || 'REGULAR',
        ai_tags: {
          ...(sourceData.ai_tags || {}),
          body_shapes: sourceData.body_shapes || formData.body_shapes || [],
          occasions: sourceData.occasions || formData.occasions || [],
          undertone: sourceData.undertone || formData.undertone || 'NEUTRAL',
          fit_type: sourceData.fit_type || formData.fit_type || 'REGULAR',
        },
        featured: Boolean(sourceData.featured ?? formData.featured),
        image_url: finalImageUrl || DEFAULT_IMAGE_URL,
        background_occasion: sourceData.background_occasion || editingProduct?.background_occasion || null,
      };

      /*
       * The display slot is owned by `handleImageUpload()` once a fresh cut-out
       * is attached — it stores the file and writes the URL. Only when there is
       * NO new file do we forward the existing URL, and even then only if it has
       * one: `null` would wipe a good cut-out on an unrelated edit.
       */
      if (!sourceData.display_image_file && displayImageUrl) {
        payload.display_image_url = displayImageUrl;
      }

      /*
       * THE ROOT CAUSE OF "users see the uncut original".
       *
       * `display_image_file` (the imgly cut-out composited onto the HIRAYA
       * frame) and `tryon_image_file` are FILE uploads, and the backend reads
       * them with `$request->file(...)` in `ProductController::handleImageUpload`.
       *
       * They were never attached to the request: the payload above is a plain
       * JS object, so axios serialised it as JSON, and Laravel can only parse
       * multipart uploads. `$request->file('display_image_file')` was therefore
       * ALWAYS null, `display_image_url` was always saved as NULL, and every
       * customer surface fell back to its `display_image_url || image_url`
       * default — the admin's raw, un-cut photo. The admin pipeline itself was
       * fine; the finished card simply never left the browser.
       *
       * So the body is sent as multipart/form-data with the blobs appended.
       * The axios request interceptor already deletes the JSON Content-Type
       * when it sees a FormData body, letting the browser set the multipart
       * boundary.
       */
      const body = new FormData();

      // Scalars/arrays go as JSON strings — Laravel's `array` validation rule
      // accepts JSON-encoded strings, and this keeps nested objects
      // (`ai_tags`, `size_measurements`) intact across the multipart encoding.
      Object.entries(payload).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        if (typeof value === 'object' && !(value instanceof Blob) && !(value instanceof File)) {
          body.append(key, JSON.stringify(value));
        } else {
          body.append(key, String(value));
        }
      });

      /*
       * The cut-out files. Appended LAST so no scalar can collide with them.
       *
       * Only these two need to travel as multipart bodies — the ORIGINAL photo
       * is already in storage (uploaded above), and its URL goes out as the
       * `image_url` scalar. Re-attaching it here would store the same bytes
       * twice and, worse, re-trigger the original's delete-and-replace branch
       * with an identical image.
       */
      if (sourceData.display_image_file) {
        body.append('display_image_file', sourceData.display_image_file, 'garment-display.png');
      }
      if (sourceData.tryon_image_file) {
        body.append('tryon_image_file', sourceData.tryon_image_file, 'garment-tryon.png');
      }

      const targetId = sourceData?.id || editingProduct?.id;
      /*
       * Laravel does not parse uploaded files out of a PUT/PATCH body, so the
       * multipart update is POSTed with `_method=PUT` (method spoofing) — the
       * same verb the route and `$isPost` check in `ProductRequest` expect.
       */
      if (targetId) {
        body.append('_method', 'PUT');
      }

      // Public product routes (no admin gate) — see hiraya-backend/routes/api.php.
      const saveResponse = targetId
        ? await api.post(`/products/${targetId}`, body)
        : await api.post('/products', body);

      const savedProduct = saveResponse.data?.data;
      if (savedProduct) {
        setProducts((prev) =>
          targetId
            ? prev.map((p) => (p.id === savedProduct.id ? savedProduct : p))
            : [savedProduct, ...prev]
        );
      }

      /*
       * TELL THE STOREFRONT THE CATALOG CHANGED.
       *
       * `setProducts` above only patches THIS console's local array. Shoppers
       * read React Query caches ('products' on Shop, 'products-featured' on Home),
       * which were never invalidated — so an edited name, price or image stayed
       * invisible to customers for up to five minutes. That is the reported
       * "hindi nagre-reload ang products sa users".
       *
       * Called for BOTH create and update, since either can change what the shop
       * should show.
       */
      invalidateCatalog(queryClient);

      /*
       * A cut-out was generated but the saved row still has no display image:
       * the upload was rejected (most likely over the size cap). The product
       * itself is saved, so this is a WARNING — but it must be said out loud,
       * otherwise the shop silently keeps showing the uncut original.
       */
      const cutoutWasSent = Boolean(sourceData.display_image_file);
      const displaySaved = Boolean(savedProduct?.display_image_url);

      if (cutoutWasSent && !displaySaved) {
        showAlertModal(
          'Saved, but the display image was not accepted',
          'The garment was saved, but the background-removed catalog image was rejected by the ' +
          'server, so customers will see the ORIGINAL photo. Please reopen this product and ' +
          'press "Create catalog image (AI)" again.',
        );
      } else {
        showAlertModal('Success', targetId ? 'Product updated successfully!' : 'Product created successfully!');
      }
      resetForm();
      await fetchProducts();
    } catch (error) {
      const parsed = parseApiError(error);
      showAlertModal('Error', parsed.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  return (
    <>
      <Admin
        products={products}
        editingId={editingProduct?.id || null}
        formData={formData}
        setFormData={setFormData}
        imageFile={imageFile}
        previewUrl={previewUrl}
        loading={loading}
        fetching={fetching}
        ordersBadge={ordersBadge}
        defaultImageUrl={DEFAULT_IMAGE_URL}
        onFileChange={handleFileChange}
        onSubmit={handleSubmit}
        onReset={resetForm}
        onEditClick={handleEditClick}
        onDelete={handleDeleteProduct}
        onRefresh={fetchProducts}
      />

      <Modal
        isOpen={modalConfig.isOpen}
        onClose={closeModal}
        onConfirm={modalConfig.onConfirm}
        title={modalConfig.title}
        message={modalConfig.message}
        confirmText={modalConfig.confirmText}
        cancelText={modalConfig.cancelText}
      />
    </>
  );
};

export default MainDashboard;
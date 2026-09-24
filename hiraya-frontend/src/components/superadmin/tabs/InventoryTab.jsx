import React, { useState, useMemo, useEffect } from 'react';
import { Package, Plus, Image as ImageIcon, X, Trash2, Edit3, Sparkles, Check, Loader2 } from 'lucide-react';
// Shared vocabulary so this console tags garments identically to the Admin console.
import { BODY_SHAPE_VALUES, OCCASION_VALUES } from '../../../constants/productOptions';
// THE single shared background-removal entry point (same module the Admin console
// uses), so products added here also get a transparent, framed catalog image
// instead of the raw photo — ONE removal code path for both consoles.
import { generateGarmentCatalogImage } from '../../../utils/removeBackground';
import { releaseCompositeUrl } from '../../../utils/garmentCompositor';

const AVAILABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];
const BODY_SHAPES_LIST = BODY_SHAPE_VALUES;
const OCCASIONS_LIST = OCCASION_VALUES;

const INITIAL_FORM_STATE = {
  name: '',
  category: 'TOPS',
  price: '',
  sizes: {},
  size_measurements: {},
  image_url: '',
  undertone: 'NEUTRAL',
  fit_type: 'REGULAR',
  body_shapes: [],
  occasions: []
};

export default function InventoryTab({
  products = [],
  onAddProduct,
  onUpdateProduct,
  onDeleteProduct ,
  onAnalyzeImage
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageAnalysisError, setImageAnalysisError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);

  /*
   * Background-removal outputs (identical to the Admin console):
   *   compositeBlob -> the cut-out on the HIRAYA frame -> `display_image_url`
   *   compositeUrl  -> preview shown in the modal
   *   tryonBlob     -> the bare transparent matte  -> `ghost_mannequin_url`
   */
  const [compositeBlob, setCompositeBlob] = useState(null);
  const [compositeUrl, setCompositeUrl] = useState('');
  const [tryonBlob, setTryonBlob] = useState(null);

  /**
   * Converts an image File into a scaled-down data-URI (max 1024px, JPEG q0.82)
   * for the Gemini analysis request. A smaller body uploads faster and keeps the
   * /analyze-image call inside the request timeout — same sizing the Admin
   * console uses.
   */
  const fileToAnalysisDataUri = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDimension = 1024;
          const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        image.onerror = reject;
        image.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  /**
   * Auto-fill the product details from the garment photo via AI — SAME behavior
   * as the Admin console's "Auto-fill details (AI)" button. Fills the name,
   * category, AI attributes (undertone / fit / body shapes / occasions) and a
   * sensible price when the field is still empty, WITHOUT overwriting anything
   * the admin already typed.
   */
  const handleAutoFillDetails = async () => {
    if (!imageFile || !onAnalyzeImage || isAnalyzingImage) return;

    setIsAnalyzingImage(true);
    setImageAnalysisError('');
    try {
      const imageData = await fileToAnalysisDataUri(imageFile);
      const analysis = await onAnalyzeImage(imageData);

      setFormData((prev) => ({
        ...prev,
        name: analysis.name || prev.name,
        category: analysis.category || prev.category,
        // Keep a manually-typed price; only fill an empty one.
        price: prev.price !== '' && prev.price != null ? prev.price : (analysis.price || prev.price),
        undertone: analysis.undertone || prev.undertone,
        fit_type: analysis.fit_type || prev.fit_type,
        body_shapes: Array.isArray(analysis.body_shapes) && analysis.body_shapes.length
          ? analysis.body_shapes
          : prev.body_shapes,
        occasions: Array.isArray(analysis.occasions) && analysis.occasions.length
          ? analysis.occasions
          : prev.occasions
      }));

      /*
       * BACKGROUND REMOVAL — the SAME step the Admin console runs after analysis.
       * Cuts the garment out of its photo and composes it on the one shared
       * HIRAYA frame. The framed result is uploaded as `display_image_file`
       * (-> display_image_url) and the bare matte as `tryon_image_file`
       * (-> ghost_mannequin_url), so the storefront shows a clean, transparent
       * product instead of the raw photo with its original background.
       */
      try {
        const { display, matte, ok } = await generateGarmentCatalogImage(imageFile);

        if (ok) {
          setCompositeBlob(display.blob);
          setCompositeUrl((prev) => {
            releaseCompositeUrl(prev);
            return display.url;
          });
        }
        setTryonBlob(matte.blob || null);

        if (!ok) {
          setImageAnalysisError(
            'Na-fill ang details, pero hindi na-remove ang background. Ang original na larawan ang gagamitin. Paki-retry ang background removal.'
          );
        }
      } catch (compositeError) {
        // Details still auto-filled; only the cut-out failed. Keep the original
        // photo and tell the admin, instead of silently shipping the raw image.
        console.warn('SuperAdmin: background removal failed', compositeError);
        setCompositeBlob(null);
        setTryonBlob(null);
        setCompositeUrl((prev) => {
          releaseCompositeUrl(prev);
          return '';
        });
        setImageAnalysisError(
          'Na-fill ang details, pero nabigo ang background removal. Ang original na larawan ang gagamitin — subukang muli.'
        );
      }
    } catch (err) {
      const message =
        err?.response?.data?.message ||
        'Hindi makuha ang AI details. Subukan muli o punan nang manwal.';
      setImageAnalysisError(message);
      /*
       * Log the SERVER's explanation, not the raw axios error.
       *
       * The endpoint returns a specific, actionable sentence for each failure
       * mode (model retired, key suspended, quota reached, Gemini overloaded).
       * Dumping the whole AxiosError buried that sentence under a stack trace,
       * so the console showed "status code 502" and hid the reason the backend
       * had already worked out.
       */
      console.warn(
        `SuperAdmin: image auto-fill failed (HTTP ${err?.response?.status ?? 'n/a'}): ${message}`
      );
    } finally {
      setIsAnalyzingImage(false);
    }
  };

  // Clean up object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Free the composited cut-out URL whenever it changes or the modal unmounts.
  useEffect(() => {
    return () => releaseCompositeUrl(compositeUrl);
  }, [compositeUrl]);

  // Safe Size Object Parser
  const parseSizes = (sizesData) => {
    if (!sizesData) return {};
    if (typeof sizesData === 'object' && !Array.isArray(sizesData)) return sizesData;
    if (typeof sizesData === 'string') {
      try {
        return JSON.parse(sizesData);
      } catch {
        return {};
      }
    }
    return {};
  };

  // Safe Array Parser for AI Tags
  const parseArrayField = (fieldData) => {
    if (!fieldData) return [];
    if (Array.isArray(fieldData)) return fieldData;
    if (typeof fieldData === 'string') {
      try {
        const parsed = JSON.parse(fieldData);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return fieldData.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    return [];
  };

  // Compute Total Stock based on Sizes breakdown
  const computedTotalStock = useMemo(() => {
    const currentSizes = formData.sizes || {};
    return Object.values(currentSizes).reduce((total, szData) => {
      const qty = typeof szData === 'object' && szData !== null ? (szData.stock || 0) : Number(szData);
      return total + (isNaN(qty) || qty < 0 ? 0 : qty);
    }, 0);
  }, [formData.sizes]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      // Drop any cut-out from a previous photo so a stale background-removed
      // image is never saved against the new upload.
      setCompositeBlob(null);
      setTryonBlob(null);
      setCompositeUrl((prev) => {
        releaseCompositeUrl(prev);
        return '';
      });
      // Auto-fill + background removal on selection — the admin can still adjust
      // any field afterward.
      handleAutoFillDetails();
    }
  };

  // Size Inventory Matrix Handlers
  const handleToggleSize = (size) => {
    const current = { ...(formData.sizes || {}) };
    if (Object.prototype.hasOwnProperty.call(current, size)) {
      delete current[size];
    } else {
      const defaultQty = bulkStock !== '' && !isNaN(Number(bulkStock)) && Number(bulkStock) >= 0 ? Number(bulkStock) : 0;
      current[size] = defaultQty;
    }
    setFormData((prev) => ({ ...prev, sizes: current }));
  };

  const handleSizeStockChange = (size, value) => {
    const num = Math.max(0, parseInt(value, 10) || 0);
    setFormData((prev) => ({
      ...prev,
      sizes: {
        ...(prev.sizes || {}),
        [size]: num
      }
    }));
  };

  const handleApplyBulkStock = () => {
    if (bulkStock === '') return;
    const qty = Math.max(0, parseInt(bulkStock, 10) || 0);
    const currentKeys = Object.keys(formData.sizes || {});
    const targetSizes = currentKeys.length === 0 ? AVAILABLE_SIZES : currentKeys;

    const updated = { ...(formData.sizes || {}) };
    targetSizes.forEach((sz) => {
      updated[sz] = qty;
    });

    setFormData((prev) => ({ ...prev, sizes: updated }));
  };

  const handleToggleArrayItem = (field, item) => {
    setFormData((prev) => {
      const currentList = prev[field] || [];
      const exists = currentList.includes(item);
      return {
        ...prev,
        [field]: exists ? currentList.filter((i) => i !== item) : [...currentList, item]
      };
    });
  };

  const openAddModal = () => {
    setEditingId(null);
    setFormData(INITIAL_FORM_STATE);
    setImageFile(null);
    setPreviewUrl('');
    setBulkStock('');
    setImageAnalysisError('');
    setSaveError('');
    setCompositeBlob(null);
    setTryonBlob(null);
    setCompositeUrl((prev) => {
      releaseCompositeUrl(prev);
      return '';
    });
    setIsModalOpen(true);
  };

   const openEditModal = (item) => {
    setEditingId(item.id);
    const aiTags = item.ai_tags || {};

    // Normalize sizes: handle both simple number format ({S: 5}) and
    // object format ({S: {stock: 5, measurements: {...}}})
    const rawSizes = parseSizes(item.sizes || item.size_stocks);
    const normalizedSizes = {};
    if (rawSizes && typeof rawSizes === 'object' && !Array.isArray(rawSizes)) {
      AVAILABLE_SIZES.forEach(sz => {
        if (Object.prototype.hasOwnProperty.call(rawSizes, sz)) {
          const val = rawSizes[sz];
          normalizedSizes[sz] = typeof val === 'object' && val !== null
            ? (val.stock || 0)
            : (Number(val) || 0);
        }
      });
    }

    setFormData({
      name: item.name || '',
      category: item.category || 'TOPS',
      price: item.price || '',
      sizes: normalizedSizes,
      size_measurements: parseSizes(item.size_measurements) || {},
      image_url: item.display_image_url || item.image_url || item.image || '',
      undertone: aiTags.undertone || item.undertone || 'NEUTRAL',
      fit_type: aiTags.fit_type || item.fit_type || 'REGULAR',
      body_shapes: parseArrayField(aiTags.body_shapes || item.body_shapes),
      occasions: parseArrayField(aiTags.occasions || item.occasions)
    });

    setImageFile(null);
    setPreviewUrl(item.display_image_url || item.image_url || item.image || '');
    setBulkStock('');
    setImageAnalysisError('');
    setSaveError('');
    setCompositeBlob(null);
    setTryonBlob(null);
    // Show the already-saved catalog image (if any) as the current cut-out.
    setCompositeUrl(item.display_image_url || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || isSubmitting || isAnalyzingImage) return;

    setIsSubmitting(true);
    setSaveError('');
    try {
      const sizesPayload = formData.sizes || {};
      const sizeMeasurementsPayload = formData.size_measurements || {};
      const aiTagsPayload = {
        undertone: formData.undertone,
        fit_type: formData.fit_type,
        body_shapes: formData.body_shapes,
        occasions: formData.occasions
      };

      /*
       * Sent as multipart FormData (not JSON) so the garment photo actually
       * reaches the backend. The Admin console sends `image_file`; the old
       * SuperAdmin handler sent `image`, which ProductRequest does not accept —
       * so every product added from here was stored WITHOUT a picture and later
       * showed up imageless in the Admin inventory. Using the same `image_file`
       * field keeps the two consoles byte-for-byte compatible.
       */
      /*
       * The two size columns have DIFFERENT shapes — do not send the same
       * object to both.
       *
       *   sizes       -> a LIST of the size labels this garment actually comes
       *                  in, e.g. ["XS","S","M"]. Which labels exist is the
       *                  admin's choice per garment; it is NOT every size the
       *                  store stocks, and it is NOT a stock map.
       *   size_stocks -> a MAP of label => quantity, e.g. {"XS":234,"S":12}.
       *
       * This handler previously sent `sizesPayload` (the stock MAP) for BOTH.
       * That wrote {"XS":234} into `sizes`, so every product saved from the
       * SuperAdmin console ended up with a single size, the map shape instead
       * of the documented list shape, and the AI Stylist / Size Suggester
       * (TryOnController::catalogForSize) could never match a customer to a
       * garment. The Admin console already sends the correct list shape; this
       * brings SuperAdmin in line with it.
       */
      const sizeLabels = Object.keys(sizesPayload);

      const payload = new FormData();
      payload.append('name', formData.name);
      payload.append('category', formData.category.toUpperCase());
      payload.append('price', parseFloat(formData.price) || 0);
      payload.append('stock', computedTotalStock);
      payload.append('sizes', JSON.stringify(sizeLabels));
      payload.append('size_stocks', JSON.stringify(sizesPayload));
      payload.append('size_measurements', JSON.stringify(sizeMeasurementsPayload));

      // AI Attributes Direct Payload & JSON Bundle
      payload.append('ai_tags', JSON.stringify(aiTagsPayload));
      payload.append('undertone', formData.undertone);
      payload.append('fit_type', formData.fit_type);
      payload.append('body_shapes', JSON.stringify(formData.body_shapes));
      payload.append('occasions', JSON.stringify(formData.occasions));

      // Original upload slot. On edit we only send a NEW file when one is
      // chosen, so existing images are never clobbered.
      if (imageFile) {
        payload.append('image_file', imageFile);

        /*
         * `display_image_file` is the BACKGROUND-REMOVED catalog image, not the
         * raw photo — same as the Admin console. Customers resolve their image
         * as `display_image_url || image_url`, so sending the raw file here is
         * exactly why products added from the Super Admin still showed their
         * original background. When the cut-out is missing (removal failed) we
         * fall back to the raw file so the product is never left imageless.
         */
        payload.append('display_image_file', compositeBlob || imageFile);
        payload.append('tryon_image_file', tryonBlob || imageFile);
      }

      if (editingId) {
        payload.append('_method', 'PUT'); // Laravel Sanctum HTTP Verb Spoofing
        if (onUpdateProduct) await onUpdateProduct(editingId, payload);
      } else {
        if (onAddProduct) await onAddProduct(payload);
      }

      setIsModalOpen(false);
    } catch (error) {
      console.error("Error saving product with AI Attributes:", error);
      // Surface the real backend reason instead of only logging it, so a failed
      // save is diagnosable from the UI (401 = auth gate, 422 = validation, 500
      // = server error, etc.).
      const status = error?.response?.status;
      const backendMessage = error?.response?.data?.message;
      const validationErrors = error?.response?.data?.errors;
      const firstValidation = validationErrors && typeof validationErrors === 'object'
        ? Object.values(validationErrors)[0]
        : null;
      setSaveError(
        (Array.isArray(firstValidation) ? firstValidation[0] : firstValidation) ||
        backendMessage ||
        (status ? `Save failed (HTTP ${status}).` : 'Save failed. Check that the backend server is running.')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm("Sigurado ka bang gusto mong burahin ang produktong ito?")) {
      if (onDeleteProduct) await onDeleteProduct(id);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div>
          <h2 className="text-xl font-light uppercase tracking-[0.2em] text-[#E9C46A] flex items-center gap-2">
            <Package size={20} /> Product Inventory & AI Catalog
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Manage garment inventory, size stocks, and AI Recommendation parameters in one place.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="px-4 py-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] text-black font-mono text-xs font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <Plus size={16} /> Add Product with AI Attributes
        </button>
      </div>

      {/* INVENTORY TABLE */}
      <div className="bg-[#0D1017] border border-white/10 rounded-2xl overflow-hidden text-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-white/5 border-b border-white/10 uppercase tracking-wider text-[10px] font-mono text-gray-400">
              <tr>
                <th className="p-4">Product Name</th>
                <th className="p-4">Category</th>
                <th className="p-4">Price</th>
                <th className="p-4">Sizes & Stock</th>
                <th className="p-4">AI Attributes</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300 font-mono">
               {products && products.length > 0 ? (
                 products.map((item, idx) => {
                   const sumSizes = (sizesObj) => Object.values(sizesObj).reduce((a, b) => {
                     const qty = typeof b === 'object' && b !== null ? (b.stock || 0) : Number(b);
                     return a + (isNaN(qty) || qty < 0 ? 0 : qty);
                   }, 0);

                   const itemSizesObj = parseSizes(item.sizes || item.size_stocks);
                   const activeSizes = Object.entries(itemSizesObj).filter(([, szData]) => {
                     const qty = typeof szData === 'object' && szData !== null ? (szData.stock || 0) : Number(szData);
                     return qty > 0;
                   });

                   /*
                    * TOTAL STOCK — THE STORED TOTAL UNLESS IT IS MISSING OR ZERO.
                    *
                    * `item.stock ?? sum(sizes)` looks right but is wrong in the
                    * case that matters: `stock` is a plain column that can be 0
                    * from an unrelated write while the per-size matrix still
                    * carries real quantities (or the reverse — sizes exist but
                    * the aggregate was never recomputed). `??` only falls back on
                    * null/undefined, so a stored 0 silently overrode a non-empty
                    * size breakdown and the row read "Out of Stock" for a product
                    * that had stock.
                    *
                    * Using the stored total only when it is a positive number,
                    * and otherwise trusting the actual size matrix, keeps the two
                    * from disagreeing.
                    */
                   const storedStock = Number(item.stock);
                   const sizeStock = sumSizes(itemSizesObj);
                   const totalStock = Number.isFinite(storedStock) && storedStock > 0
                     ? storedStock
                     : sizeStock;

                  const aiTags = item.ai_tags || {};
                  const undertone = aiTags.undertone || item.undertone || 'NEUTRAL';
                  const fitType = aiTags.fit_type || item.fit_type || 'REGULAR';

                  return (
                    <tr key={item.id || idx} className="hover:bg-white/5 transition">
                      <td className="p-4 flex items-center gap-3">
                        {/*
                          * CATALOG IMAGE FIRST — same resolution order the Admin console
                          * uses (`display_image_url || image_url || default`).
                          *
                          * `display_image_url` is the background-removed cut-out produced
                          * when the garment was added, i.e. exactly what shoppers see on
                          * the storefront. Rendering only `image_url` here showed the RAW
                          * uploaded photo (with its original background), so the Super
                          * Admin inventory disagreed with the Admin console and the shop
                          * for the very same product.
                          */}
                        {item.display_image_url || item.image_url || item.image ? (
                          <img
                            src={item.display_image_url || item.image_url || item.image}
                            alt={item.name}
                            className="w-10 h-10 object-cover rounded-lg border border-white/10 bg-black/40 shrink-0"
                            onError={(e) => {
                              /*
                               * Local placeholder, not `via.placeholder.com`.
                               *
                               * That service is dead — it no longer serves images, so
                               * this fallback rendered as a broken-image icon, which
                               * is indistinguishable from "the upload failed" and sent
                               * people hunting for a storage bug that was not there.
                               * A root-relative path cannot 404 for that reason and
                               * needs no network round trip.
                               */
                              e.target.onerror = null;
                              e.target.src = '/images/placeholder.svg';
                            }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-gray-500 shrink-0">
                            <ImageIcon size={18} />
                          </div>
                        )}
                        <span className="font-medium text-white">{item.name}</span>
                      </td>

                      <td className="p-4 uppercase text-gray-400">{item.category || 'N/A'}</td>
                      <td className="p-4 text-white">₱{Number(item.price || 0).toLocaleString()}</td>

                       <td className="p-4">
                         <div className="flex flex-wrap gap-1 max-w-[180px]">
                           {activeSizes.length > 0 ? (
                             activeSizes.map(([sz, szData]) => {
                               const qty = typeof szData === 'object' && szData !== null ? (szData.stock || 0) : szData;
                               return (
                                 <span key={sz} className="px-1.5 py-0.5 bg-[#E9C46A]/10 border border-[#E9C46A]/30 text-[#E9C46A] text-[9px] rounded">
                                   {sz}: {qty}
                                 </span>
                               );
                             })
                           ) : (
                             <span className="text-red-400/80 text-[10px] italic">Out of Stock</span>
                           )}
                        </div>
                      </td>

                      {/* AI ATTRIBUTES SUMMARY BADGES */}
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          <span className="px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/30 text-purple-300 text-[9px] rounded uppercase font-bold flex items-center gap-1">
                            <Sparkles size={8} /> {undertone}
                          </span>
                          <span className="px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[9px] rounded uppercase font-bold">
                            {fitType}
                          </span>
                        </div>
                      </td>

                      <td className="p-4">
                        <span
                          className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${
                            totalStock > 0
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          {totalStock > 0 ? `In Stock (${totalStock})` : 'Out of Stock'}
                        </span>
                      </td>

                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg transition cursor-pointer"
                            title="Edit Product & AI Tags"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(item.id)}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg transition cursor-pointer"
                            title="Delete Product"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="p-8 text-center text-gray-500 uppercase tracking-widest">
                    No products found in inventory
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* UNIFIED ADD / EDIT PRODUCT + AI ATTRIBUTES MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-[#0D1017] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden font-mono text-xs max-h-[90vh] flex flex-col">

            {/* Modal Header */}
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
              <h3 className="font-bold text-[#E9C46A] uppercase tracking-wider flex items-center gap-2">
                <Package size={16} /> {editingId ? 'Edit Product & AI Tags' : 'Add New Product with AI Attributes'}
              </h3>
              <button onClick={() => !isSubmitting && setIsModalOpen(false)} className="text-gray-400 hover:text-white p-1 rounded-lg transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-5 overflow-y-auto">

              {/* SECTION 1: BASIC PRODUCT INFORMATION */}
              <div className="space-y-3">
                <span className="text-[10px] text-[#E9C46A] font-bold uppercase tracking-widest block border-b border-white/5 pb-1">
                  1. Basic Product Information
                </span>

                <div>
                  <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1">Product Name *</label>
                  <input
                    type="text"
                    name="name"
                    required
                    placeholder="e.g. Modern Filipiniana Barong Top"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white focus:outline-none focus:border-[#E9C46A]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1">Category *</label>
                    <select
                      name="category"
                      value={formData.category}
                      onChange={handleInputChange}
                      className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white focus:outline-none focus:border-[#E9C46A]"
                    >
                      <option value="TOPS">TOPS</option>
                      <option value="BOTTOMS">BOTTOMS</option>
                      <option value="DRESSES">DRESSES</option>
                      <option value="OUTERWEAR">OUTERWEAR</option>
                      <option value="FORMAL_MEN">FORMAL MEN</option>
                      <option value="FORMAL_WOMEN">FORMAL WOMEN</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1">Price (₱) *</label>
                    <input
                      type="number"
                      name="price"
                      required
                      placeholder="1299"
                      value={formData.price}
                      onChange={handleInputChange}
                      className="w-full bg-black/50 border border-white/10 rounded-xl p-2.5 text-white focus:outline-none focus:border-[#E9C46A]"
                    />
                  </div>
                </div>
              </div>

              {/* SECTION 2: AI STYLING ATTRIBUTES */}
              <div className="space-y-3 bg-purple-950/10 border border-purple-500/20 p-3.5 rounded-xl">
                <span className="text-[10px] text-purple-400 font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-purple-500/20 pb-1">
                  <Sparkles size={12} /> 2. Hiraya AI Recommendation Tags
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase text-purple-300 tracking-wider mb-1">Skin Undertone</label>
                    <select
                      name="undertone"
                      value={formData.undertone}
                      onChange={handleInputChange}
                      className="w-full bg-black/50 border border-purple-500/30 rounded-xl p-2.5 text-white focus:outline-none focus:border-purple-400"
                    >
                      <option value="WARM">WARM</option>
                      <option value="COOL">COOL</option>
                      <option value="NEUTRAL">NEUTRAL</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-purple-300 tracking-wider mb-1">Garment Fit Type</label>
                    <select
                      name="fit_type"
                      value={formData.fit_type}
                      onChange={handleInputChange}
                      className="w-full bg-black/50 border border-purple-500/30 rounded-xl p-2.5 text-white focus:outline-none focus:border-purple-400"
                    >
                      <option value="SLIM">SLIM FIT</option>
                      <option value="REGULAR">REGULAR FIT</option>
                      <option value="LOOSE">LOOSE / OVERSIZED</option>
                    </select>
                  </div>
                </div>

                {/* Body Shape Matching */}
                <div>
                  <label className="block text-[10px] uppercase text-purple-300 tracking-wider mb-1.5">Matching Body Shapes</label>
                  <div className="flex flex-wrap gap-1.5">
                    {BODY_SHAPES_LIST.map((shape) => {
                      const selected = formData.body_shapes.includes(shape);
                      return (
                        <button
                          key={shape}
                          type="button"
                          onClick={() => handleToggleArrayItem('body_shapes', shape)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition border cursor-pointer ${
                            selected
                              ? 'bg-purple-500 border-purple-400 text-white'
                              : 'bg-black/40 border-purple-500/20 text-gray-400 hover:border-purple-500/40'
                          }`}
                        >
                          {shape}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Occasions Matching */}
                <div>
                  <label className="block text-[10px] uppercase text-purple-300 tracking-wider mb-1.5">Occasions / Events</label>
                  <div className="flex flex-wrap gap-1.5">
                    {OCCASIONS_LIST.map((occ) => {
                      const selected = formData.occasions.includes(occ);
                      return (
                        <button
                          key={occ}
                          type="button"
                          onClick={() => handleToggleArrayItem('occasions', occ)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition border cursor-pointer ${
                            selected
                              ? 'bg-[#E9C46A] border-[#E9C46A] text-black'
                              : 'bg-black/40 border-white/10 text-gray-400 hover:border-white/30'
                          }`}
                        >
                          {occ}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* SECTION 3: SIZE & INVENTORY MANAGEMENT */}
              <div className="p-3 bg-white/5 border border-white/10 rounded-xl space-y-3">
                <div className="flex justify-between items-center border-b border-white/5 pb-1">
                  <span className="text-[10px] uppercase text-[#E9C46A] font-bold">3. Size Inventory Breakdown</span>
                  <span className="text-[10px] text-gray-400">Calculated Stock: <strong className="text-white">{computedTotalStock}</strong></span>
                </div>

                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min="0"
                    placeholder="Quick Qty"
                    value={bulkStock}
                    onChange={(e) => setBulkStock(e.target.value)}
                    className="w-24 bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-[#E9C46A]"
                  />
                  <button
                    type="button"
                    onClick={handleApplyBulkStock}
                    className="px-3 py-1 bg-[#E9C46A] hover:bg-[#D4A94F] text-black font-bold uppercase rounded-lg text-[10px] transition cursor-pointer"
                  >
                    Apply Quantity
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                   {AVAILABLE_SIZES.map((sz) => {
                     const isConfigured = Object.prototype.hasOwnProperty.call(formData.sizes || {}, sz);
                     const szData = isConfigured ? formData.sizes[sz] : 0;
                     const qty = typeof szData === 'object' && szData !== null ? (szData.stock || 0) : szData;

                    return (
                      <div key={sz} className={`p-2 rounded-lg border ${isConfigured ? 'bg-[#E9C46A]/10 border-[#E9C46A]' : 'bg-black/40 border-white/10'}`}>
                        <button
                          type="button"
                          onClick={() => handleToggleSize(sz)}
                          className="w-full flex items-center justify-between mb-1 cursor-pointer"
                        >
                          <span className="flex items-center gap-1.5 font-bold text-white">
                            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${isConfigured ? 'bg-[#E9C46A] border-[#E9C46A]' : 'bg-black border-white/30'}`}>
                              {isConfigured && <Check size={10} className="text-black" strokeWidth={3} />}
                            </span>
                            {sz}
                          </span>
                        </button>
                        {isConfigured && (
                          <input
                            type="number"
                            min="0"
                            value={qty}
                            onChange={(e) => handleSizeStockChange(sz, e.target.value)}
                            className="w-full bg-black/60 border border-white/20 rounded px-1.5 py-0.5 text-xs text-white text-center focus:outline-none focus:border-[#E9C46A]"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* SECTION 4: PRODUCT MEDIA */}
              <div className="space-y-2">
                <span className="text-[10px] text-[#E9C46A] font-bold uppercase tracking-widest block border-b border-white/5 pb-1">
                  4. Product Media
                </span>

                <div>
                  <label className="block text-[10px] uppercase text-gray-400 tracking-wider mb-1">Garment Image File</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="w-full bg-black/50 border border-white/10 rounded-xl p-2 text-gray-400 file:mr-4 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-[#E9C46A] file:text-black hover:file:bg-[#D4A94F]"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAutoFillDetails}
                  disabled={!imageFile || isAnalyzingImage}
                  className="w-full px-3 py-2.5 bg-purple-500/10 hover:bg-purple-500/20 border-purple-500/30 text-purple-300 font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 text-[11px] transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isAnalyzingImage ? (
                    <><Loader2 size={14} className="animate-spin" /> Kinukuha ang AI details...</>
                  ) : (
                    <><Sparkles size={14} /> Auto-fill Details (AI)</>
                  )}
                </button>

                {imageAnalysisError && (
                  <p className="text-[10px] text-red-400">{imageAnalysisError}</p>
                )}

                {previewUrl && (
                  <div className="p-3 bg-black/60 border border-white/10 rounded-xl space-y-3">
                    {compositeUrl && (
                      <div className="flex items-center gap-3">
                        <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border-[#E9C46A]/50 bg-black">
                          <img src={compositeUrl} alt="Background-removed preview" className="w-full h-full object-cover" />
                          <span className="absolute bottom-0 inset-x-0 bg-[#E9C46A] text-black text-[7px] font-black uppercase tracking-wider text-center py-0.5">
                            No BG
                          </span>
                        </div>
                        <p className="text-[10px] text-[#E9C46A] font-bold uppercase">
                          Background removed — ito ang lalabas sa shop
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <div className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-white/10 bg-white/5">
                        <img src={previewUrl} alt="Original preview" className="w-full h-full object-cover" />
                        {compositeUrl && (
                          <span className="absolute bottom-0 inset-x-0 bg-black/80 text-gray-300 text-[7px] font-black uppercase tracking-wider text-center py-0.5">
                            Original
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-emerald-400 font-bold uppercase">Image Loaded &amp; Ready</p>
                    </div>
                  </div>
                )}
              </div>

              {saveError && (
                <div className="p-3 bg-red-500/10 border-red-500/30 rounded-xl">
                  <p className="text-[11px] text-red-400">{saveError}</p>
                </div>
              )}

              {/* FORM ACTIONS */}
              <div className="pt-3 flex justify-end gap-2 border-t border-white/10 shrink-0">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-gray-400 hover:text-white rounded-xl disabled:opacity-50 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isAnalyzingImage}
                  className="px-5 py-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] text-black font-bold uppercase rounded-xl flex items-center gap-2 disabled:opacity-50 transition cursor-pointer"
                >
                  {(isSubmitting || isAnalyzingImage) && <Loader2 size={14} className="animate-spin" />}
                  {editingId ? 'Update Product' : 'Save Product'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}

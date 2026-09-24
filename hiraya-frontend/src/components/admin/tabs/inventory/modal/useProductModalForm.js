import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getDefaultMeasurements } from './forms/MeasurementFields';
import { releaseCompositeUrl } from '../../../../../utils/garmentCompositor';
// THE single shared background-removal entry point — the same function the
// Super Admin console uses, so both consoles run ONE removal code path.
import { generateGarmentCatalogImage } from '../../../../../utils/removeBackground';
import api from '../../../../../api/axios';

const SIZE_VARIANTS = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

const parseObject = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const INITIAL_FORM = {
  name: '',
  description: '',
  price: '',
  category: 'TOPS',
  subcategory: '',
  material: '',
  gender: 'Men',
  colors: '',
  undertone: 'NEUTRAL',
  fit_type: 'REGULAR',
  body_shapes: [],
  occasions: [],
  image_url: '',
};

export const useProductModalForm = ({ isOpen, productToEdit, defaultImageUrl = '', onSave, onClose }) => {
  const isEditMode = Boolean(productToEdit);
  // A NEW garment starts on the image step, matching the real flow:
  // upload the photo FIRST, then the AI auto-fills the rest. Editing an
  // existing garment starts on Basic Details instead.
  const [activeTab, setActiveTab] = useState(isEditMode ? 'basic' : 'media');
  const [formData, setFormData] = useState({ ...INITIAL_FORM, image_url: defaultImageUrl });
  const [selectedSizes, setSelectedSizes] = useState({});
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(defaultImageUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [imageAnalysisError, setImageAnalysisError] = useState('');
  const fileInputRef = useRef(null);

  /*
   * STAGE 1 output — the framed catalog image (one shared frame for all).
   *
   *   compositeBlob  -> uploaded on save as `display_image_url`
   *   compositeUrl   -> shown in the modal so the admin can SEE the result
   *                     before double-checking the auto-filled details
   *   backgroundMeta -> the occasion/vibe the AI detected (PRODUCT DETAIL,
   *                     surfaced in the shop; it does not pick a background)
   */
  const [compositeBlob, setCompositeBlob] = useState(null);
  const [compositeUrl, setCompositeUrl] = useState('');
  const [backgroundMeta, setBackgroundMeta] = useState(null);

  /*
   * STAGE 1's SECOND output — the bare try-on matte.
   *
   * Uploaded on save as `tryon_image_file` -> `ghost_mannequin_url`, the column
   * the virtual try-on already prefers. It is the SAME cut-out the frame was
   * composed from, minus the frame, wordmark and caption, so the try-on receives
   * real fabric with a real alpha edge instead of re-segmenting a marketing card.
   */
  const [tryonBlob, setTryonBlob] = useState(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Free the composite object URL whenever it changes or the hook unmounts.
  useEffect(() => {
    return () => releaseCompositeUrl(compositeUrl);
  }, [compositeUrl]);

  const resetForm = useCallback(() => {
    setFormData({ ...INITIAL_FORM, image_url: defaultImageUrl });
    setSelectedSizes({});
    setImageFile(null);
    setPreviewUrl(defaultImageUrl);
    setCompositeBlob(null);
    setCompositeUrl((prev) => {
      releaseCompositeUrl(prev);
      return '';
    });
    setBackgroundMeta(null);
    setActiveTab('media');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [defaultImageUrl]);

  useEffect(() => {
    if (!isOpen) return;

    if (productToEdit) {
      setFormData({
        name: productToEdit.name || productToEdit.title || productToEdit.product_name || '',
        description: productToEdit.description || '',
        price: productToEdit.price ?? '',
        category: productToEdit.category || 'TOPS',
        subcategory: productToEdit.subcategory || '',
        material: productToEdit.material || '',
        gender: productToEdit.gender || 'Men',
        colors: Array.isArray(productToEdit.colors)
          ? productToEdit.colors.join(', ')
          : productToEdit.colors || '',
        undertone: productToEdit.undertone || 'NEUTRAL',
        fit_type: productToEdit.fit_type || 'REGULAR',
        body_shapes: Array.isArray(productToEdit.body_shapes)
          ? productToEdit.body_shapes
          : parseObject(productToEdit.ai_tags).body_shapes || [],
        occasions: Array.isArray(productToEdit.occasions)
          ? productToEdit.occasions
          : parseObject(productToEdit.ai_tags).occasions || [],
        image_url: productToEdit.image_url || defaultImageUrl,
      });

      setPreviewUrl(productToEdit.image_url || defaultImageUrl);

      const formattedSizes = {};
      const sizeKeys = new Set();
      const savedStocks = parseObject(productToEdit.size_stocks);
      const savedMeasurements = parseObject(productToEdit.size_measurements);
      const savedSizes = parseObject(productToEdit.sizes);

      if (Array.isArray(savedSizes)) {
        savedSizes.forEach((s) => {
          const key = typeof s === 'object' ? s.size_label || s.size : s;
          if (key) sizeKeys.add(key);
        });
      } else if (savedSizes && typeof savedSizes === 'object') {
        Object.keys(savedSizes).forEach((k) => sizeKeys.add(k));
      }

      if (savedStocks && typeof savedStocks === 'object') {
        Object.keys(savedStocks).forEach((k) => sizeKeys.add(k));
      }

      Object.keys(savedMeasurements).forEach((k) => sizeKeys.add(k));

      sizeKeys.forEach((szKey) => {
        let stockVal = 0;
        if (savedStocks[szKey] !== undefined) {
          stockVal = Number(savedStocks[szKey]) || 0;
        } else if (Array.isArray(savedSizes)) {
          const found = savedSizes.find((s) => (s.size_label || s.size) === szKey);
          if (found) stockVal = Number(found.stock ?? found.quantity) || 0;
        }

        let mVal = {};
        if (savedMeasurements[szKey]) {
          mVal = savedMeasurements[szKey];
        } else if (Array.isArray(savedSizes)) {
          const found = savedSizes.find((s) => (s.size_label || s.size) === szKey);
          if (found) mVal = found.measurements || found;
        }

        const parseNum = (val) => {
          const num = parseFloat(val);
          return isNaN(num) ? null : num;
        };

        formattedSizes[szKey] = {
          active: true,
          stock: stockVal,
          measurements: {
            chest_bust: parseNum(mVal.chest_bust),
            waist: parseNum(mVal.waist),
            hips: parseNum(mVal.hips),
            shoulder_width: parseNum(mVal.shoulder_width),
            sleeve_length: parseNum(mVal.sleeve_length),
            top_length: parseNum(mVal.top_length ?? mVal.length),
          },
        };
      });

      setSelectedSizes(formattedSizes);
    } else {
      resetForm();
    }
  }, [isOpen, productToEdit, resetForm, defaultImageUrl]);

  // Hydrate the previously saved composite (if any) when editing an existing
  // product, so the admin sees the same catalog image users see.
  useEffect(() => {
    if (isOpen && productToEdit?.display_image_url) {
      setCompositeUrl(productToEdit.display_image_url);
      setBackgroundMeta({
        occasion: productToEdit.background_occasion || null,
        label: productToEdit.background_occasion || null,
        image_url: productToEdit.display_image_url,
      });
    }
  }, [isOpen, productToEdit]);

  const totalStock = useMemo(() => {
    return Object.values(selectedSizes).reduce(
      (tot, sz) => tot + (sz?.active !== false ? Number(sz?.stock) || 0 : 0),
      0
    );
  }, [selectedSizes]);

  const handleBasicChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((p) => ({ ...p, [name]: value }));
  }, []);

  const handleToggleArrayItem = useCallback((field, item) => {
    setFormData((p) => {
      const current = p[field] || [];
      const updated = current.includes(item)
        ? current.filter((i) => i !== item)
        : [...current, item];
      return { ...p, [field]: updated };
    });
  }, []);

  // Auto-fill sa default measurements kapag nag-toggle ng bagong size
  const handleSizeToggle = useCallback((size) => {
    setSelectedSizes((p) => {
      const copy = { ...p };
      if (copy[size]) {
        delete copy[size];
      } else {
        copy[size] = { active: true, stock: 0, measurements: {} };
      }
      return copy;
    });
  }, [formData.category, formData.gender]);

  // Manual Auto-fill action para sa partikular na size o sa lahat ng active sizes
  const handleAutoFillDefaults = useCallback((sizeKey = null) => {
    setSelectedSizes((p) => {
      if (sizeKey) {
        if (!p[sizeKey]) return p;
        return {
          ...p,
          [sizeKey]: {
            ...p[sizeKey],
            measurements: getDefaultMeasurements(formData.category, formData.gender, sizeKey),
          },
        };
      } else {
        const updated = { ...p };
        SIZE_VARIANTS.filter((sz) => updated[sz]?.active !== false).forEach((sz) => {
          updated[sz] = {
            ...updated[sz],
            measurements: getDefaultMeasurements(formData.category, formData.gender, sz),
          };
        });
        return updated;
      }
    });
  }, [formData.category, formData.gender]);

  const handleResetSizeDefaults = useCallback((sizeKey) => {
    setSelectedSizes((p) => {
      if (!p[sizeKey]) return p;

      return {
        ...p,
        [sizeKey]: {
          ...p[sizeKey],
          measurements: getDefaultMeasurements(formData.category, formData.gender, sizeKey),
        },
      };
    });
  }, [formData.category, formData.gender]);

  const handleSizeStockChange = useCallback((size, val) => {
    const parsedStock = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0);
    setSelectedSizes((p) => ({
      ...p,
      [size]: { ...p[size], stock: parsedStock },
    }));
  }, []);

  const handleMeasurementChange = useCallback((size, field, val) => {
    const parsedVal = val === '' || val === null ? null : parseFloat(val);
    setSelectedSizes((p) => ({
      ...p,
      [size]: {
        ...p[size],
        measurements: { ...p[size]?.measurements, [field]: isNaN(parsedVal) ? null : parsedVal },
      },
    }));
  }, []);

  /*
   * Regenerate ONLY the display cut-out for a product that ALREADY exists.
   *
   * `analyzeImage` refuses to run in edit mode, and the "Auto-fill details (AI)"
   * button only appears once a NEW file is chosen. So a product whose
   * `display_image_url` is empty — because the first save's upload failed, or
   * because it was created before the two-slot upload existed — had NO way to
   * ever get a catalog image. Customers were permanently stuck on the raw,
   * uncut original (the fallback is `display_image_url || image_url`).
   *
   * This path fixes exactly that and nothing else:
   *   - source is the EXISTING `image_url` (no re-upload needed)
   *   - it does NOT call Gemini, so the admin's curated details are untouched
   *   - it does NOT touch `image_url`, sizes, stock, price or tags
   *   - it only sets `compositeBlob` (+ the bare try-on matte), which the save
   *     then persists as `display_image_url` / `ghost_mannequin_url`
   */
  const regenerateDisplayCutout = useCallback(async () => {
    const sourceUrl = formData.image_url || productToEdit?.image_url || '';
    if (!sourceUrl || isAnalyzingImage) return;

    setIsAnalyzingImage(true);
    setImageAnalysisError('');
    try {
      const { display, matte, ok } = await generateGarmentCatalogImage(sourceUrl);

      if (!ok) {
        throw new Error(
          'The background could not be removed, so no catalog image was produced. ' +
          'Please try again, or upload a clearer photo.',
        );
      }

      setCompositeBlob(display.blob);
      setCompositeUrl((prev) => {
        releaseCompositeUrl(prev);
        return display.url;
      });
      setTryonBlob(matte.blob || null);
    } catch (compositeError) {
      setCompositeBlob(null);
      setTryonBlob(null);
      setImageAnalysisError(
        compositeError?.message ||
        'The background could not be removed. The product will keep the original photo.',
      );
      console.warn('Display cut-out regeneration failed:', compositeError);
    } finally {
      setIsAnalyzingImage(false);
    }
  }, [formData.image_url, productToEdit, isAnalyzingImage]);

  const analyzeImage = useCallback(async (file = imageFile) => {
    if (productToEdit || !file) return;

    setIsAnalyzingImage(true);
    setImageAnalysisError('');
    try {
      const imageData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            /*
             * 1024px @ 0.82 is plenty for vision analysis and roughly halves the
             * base64 payload vs. 1600px @ 0.88. The smaller body uploads faster
             * and is quicker for Gemini to process, which is what keeps this
             * call inside the request timeout on slower connections.
             */
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

      // Public endpoint (no admin gate) — see hiraya-backend/routes/api.php.
      const response = await api.post('/products/analyze-image', { image: imageData });
      const analysis = response.data?.data || {};

      // The occasion/vibe the AI detected is now PURE PRODUCT DETAIL — it is
      // stored on the product and shown on the customer's shop surfaces. It no
      // longer selects a background; every garment shares one frame.
      const detectedOccasions = Array.isArray(analysis.occasions) ? analysis.occasions : [];
      if (detectedOccasions.length > 0) {
        setBackgroundMeta({ occasion: detectedOccasions[0], label: detectedOccasions[0] });
      }

      setFormData((previous) => ({
        ...previous,
        name: analysis.name || previous.name,
        description: analysis.description || previous.description,
        category: analysis.category || previous.category,
        material: analysis.material || previous.material,
        gender: analysis.gender || previous.gender,
        colors: Array.isArray(analysis.colors) ? analysis.colors.join(', ') : previous.colors,
        undertone: analysis.undertone || previous.undertone,
        fit_type: analysis.fit_type || previous.fit_type,
        body_shapes: Array.isArray(analysis.body_shapes) ? analysis.body_shapes : previous.body_shapes,
        occasions: Array.isArray(analysis.occasions) ? analysis.occasions : previous.occasions,
      }));

      /*
       * STAGE 1 — place the garment cut-out on the ONE shared default HIRAYA
       * frame (black canvas, gold ornamental borders, HIRAYA wordmark). The
       * frame is identical for every garment; only the garment itself changes.
       * Runs AFTER analysis so the details are already tagged, and the result
       * is shown for the admin to double-check.
       */
      try {
        const { display, matte, ok } = await generateGarmentCatalogImage(file);

        if (ok) {
          setCompositeBlob(display.blob);
          setCompositeUrl((prev) => {
            releaseCompositeUrl(prev);
            return display.url;
          });
        }

        /*
         * Keep the bare matte for the try-on. Independent of the framed card on
         * purpose: if it is missing the try-on still works (it falls back to
         * extracting from the shop photo), so a matte failure must not discard
         * an otherwise-good composite.
         */
        setTryonBlob(matte.blob || null);
      } catch (compositeError) {
        /*
         * The details auto-fill already succeeded, so we don't overwrite its
         * state — but the admin MUST be told the background cut-out failed.
         * Previously this failed silently and the product was saved with the
         * original photo, which looked like nothing had happened.
         */
        console.warn('Frame compositing failed; keeping the original photo:', compositeError);
        setCompositeBlob(null);
        setTryonBlob(null);
        setCompositeUrl((prev) => {
          releaseCompositeUrl(prev);
          return '';
        });
        if (!imageAnalysisError) {
          setImageAnalysisError(
            'Details were filled in, but the background could not be removed. ' +
            'The product will keep the original photo — please retry the background removal.',
          );
        }
      }
    } catch (error) {
      // Distinguish a slow round-trip from a real failure. A bare
      // "Automatic details could not be generated" is unactionable when the
      // actual cause was the request being cut off before Gemini replied.
      let message = error.response?.data?.message;
      if (!message) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          message = 'The photo took too long to analyze. Try a smaller or clearer image, then retry.';
        } else if (!error.response) {
          message = 'Cannot reach the server for image analysis. Make sure the backend is running.';
        } else {
          message = 'Automatic details could not be generated.';
        }
      }
      setImageAnalysisError(message);
      console.warn('Garment image analysis unavailable:', message, error);
    } finally {
      setIsAnalyzingImage(false);
    }
  }, [imageFile, productToEdit]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl((prevUrl) => {
        if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl);
        return URL.createObjectURL(file);
      });
    }
  }, []);

  const handleRemoveImage = useCallback(() => {
    setPreviewUrl((prevUrl) => {
      if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl);
      return '';
    });
    setImageFile(null);
    setFormData((p) => ({ ...p, image_url: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (isAnalyzingImage) return;

    // Babasahin niya kung alin man sa mga keys na ito ang may laman
    const rawName = formData.name || formData.title || formData.product_name || productToEdit?.name || '';
    const trimmedName = String(rawName).trim();

    if (!trimmedName) {
      setActiveTab('basic');
      alert('Validation Error: The product name is required before saving.');
      return;
    }

    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const sizesList = [];
      const sizeStocksObj = {};
      const sizeMeasurementsObj = {};

      SIZE_VARIANTS.filter((sz) => selectedSizes[sz] && selectedSizes[sz].active !== false).forEach((sz) => {
        const szData = selectedSizes[sz];
        const m = szData.measurements || {};
        const parsedStock = Number(szData.stock) || 0;

        sizesList.push(sz);
        sizeStocksObj[sz] = parsedStock;

        const parseNum = (val) => {
          const num = parseFloat(val);
          return isNaN(num) ? null : num;
        };

        const topLen = parseNum(m.top_length ?? m.length);

        sizeMeasurementsObj[sz] = {
          chest_bust: parseNum(m.chest_bust),
          waist: parseNum(m.waist),
          hips: parseNum(m.hips),
          shoulder_width: parseNum(m.shoulder_width),
          sleeve_length: parseNum(m.sleeve_length),
          top_length: topLen,
          length: topLen,
        };
      });

      const colorsArray = typeof formData.colors === 'string'
        ? formData.colors.split(',').map((c) => c.trim()).filter(Boolean)
        : Array.isArray(formData.colors)
        ? formData.colors
        : [];

      const payload = {
        ...formData,
        ...(isEditMode && { id: productToEdit.id }),
        name: trimmedName,
        title: trimmedName,
        product_name: trimmedName,
        price: parseFloat(formData.price) || 0,
        colors: colorsArray,
        sizes: sizesList,
        size_stocks: sizeStocksObj,
        size_measurements: sizeMeasurementsObj,
        stock: totalStock,
        image_file: imageFile,
        image_url: formData.image_url || '',
        // STAGE 1 result: the background-replaced catalog image users will see.
        // The raw `image_url` above is preserved untouched.
        display_image_file: compositeBlob,
        /*
         * STAGE 1's bare cut-out -> `ghost_mannequin_url`.
         * The virtual try-on already prefers this column over `image_url`
         * (TryOnController), so this matte is what it receives: a clean
         * transparent PNG with no frame and no product-name script.
         */
        tryon_image_file: tryonBlob,
        background_occasion: backgroundMeta?.occasion || null,
      };

      if (onSave) {
        const result = await onSave(payload, isEditMode);
        if (result === false) {
          setIsSubmitting(false);
          return;
        }
      }

      resetForm();
      onClose();
    } catch (err) {
      console.error('Save Error in Hook:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    isEditMode,
    activeTab,
    setActiveTab,
    formData,
    selectedSizes,
    previewUrl,
    imageFile,
    isSubmitting,
    isAnalyzingImage,
    imageAnalysisError,
    fileInputRef,
    SIZE_VARIANTS,
    totalStock,
    // Stage 1 (background replacement) outputs consumed by ProductImageUpload.
    compositeBlob,
    compositeUrl,
    tryonBlob,
    backgroundMeta,
    handleBasicChange,
    handleToggleArrayItem,
    handleSizeToggle,
    handleAutoFillDefaults,
    handleResetSizeDefaults,
    handleSizeStockChange,
    handleMeasurementChange,
    regenerateDisplayCutout,
    handleFileChange,
    analyzeImage,
    handleRemoveImage,
    handleSubmit,
  };
};
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Package, Plus, Image as ImageIcon, X, Trash2, Edit3, Sparkles, Loader2, Shirt, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
// THE single shared background-removal entry point, so products added here also
// get a transparent, framed catalog image instead of the raw photo.
import { generateGarmentCatalogImage } from '../../../utils/removeBackground';
import { releaseCompositeUrl, reframeCutout } from '../../../utils/garmentCompositor';
import { FRAME_PRESETS, isThemeKey, resolveThemeKey } from '../../../utils/framePresets';
import { getProductImageUrl } from '../../../utils/imageHelper';
import useConfirm from '../../../hooks/useConfirm';

const AVAILABLE_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

/** Products per inventory page; the sixth starts page two. */
const PAGE_SIZE = 5;

/** The theme picker's "follow the details" value. Anything else is a preset key. */
const AUTO_THEME = 'auto';

/** A stored image reference as a same-origin, canvas-safe URL — or null. */
const loadableUrl = (raw) => {
  const url = raw ? getProductImageUrl(raw) : null;
  return url && url !== '/images/placeholder.svg' ? url : null;
};

/**
 * THE STAGES OF THE "DROP A PHOTO IN, GET A DRAFT" FLOW.
 *
 * The work is three distinct things that each take a noticeably different amount of
 * time, and they used to be one opaque wait behind a single button label. That is
 * precisely what made the console look hung: an admin could not tell a 3-second
 * Gemini call from a 40-second model download + CPU inference, and during the
 * latter the WASM engine saturates the main thread, so the tab stops painting and
 * the page genuinely stops responding.
 *
 * Each stage names itself ON THE BUTTON, so the button alone is enough to tell the
 * admin what is happening and how far along it is — no separate panel, no extra
 * chrome, and the form stays exactly the size it always had.
 */
const AUTO_FILL_STAGES = {
  READING: 'reading',
  ANALYZING: 'analyzing',
  CUTTING: 'cutting',
  DONE: 'done'
};

/**
 * THE WORDS THE BUTTON SHOWS WHILE IT IS BUSY.
 *
 * `CUTTING` deliberately says the model is downloading on the FIRST run: that is
 * the honest explanation for a long silent wait, and it tells the admin the wait
 * is one-time rather than a hang they should retry or refresh through.
 */
const STAGE_BUTTON_COPY = {
  [AUTO_FILL_STAGES.READING]: 'Reading the photo…',
  [AUTO_FILL_STAGES.ANALYZING]: 'AI is reading the garment…',
  [AUTO_FILL_STAGES.CUTTING]: 'Removing the background…',
  [AUTO_FILL_STAGES.DONE]: 'Done!'
};

/**
 * YIELDS TO THE BROWSER SO THE SPINNER CAN ACTUALLY PAINT.
 *
 * This is load-bearing even though the feedback is only a button label.
 *
 * `handleFileChange` used to call the auto-fill in the same tick as the file
 * input's change event, so React set `isAnalyzingImage` and immediately began
 * multi-second network + CPU work inside the same task. The browser never got a
 * chance to paint the new state, so the console froze on the PREVIOUS frame and
 * the admin was looking at an inert page — the exact symptom reported as
 * "umiistop ang buong Hiraya". A button label is only useful if the browser
 * actually gets a frame to draw it.
 *
 * Two frames is the minimum that reliably flushes a state update to screen before
 * the main thread is handed over to the background-removal engine, which will
 * occupy it for tens of seconds.
 */
const nextPaint = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      setTimeout(resolve, 0);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });

/*
 * THE ENTIRE ADD-EDIT FORM.
 *
 * Skin Undertone, Matching Body Shapes and Occasions / Events were removed from
 * this surface (they are being refactored on the backend). What remains is
 * deliberately short enough to fit a laptop screen in ONE view, because a
 * product form that has to be scrolled hides half its own data from the admin
 * filling it in: the size matrix sat below the fold, the upload at the very
 * bottom, and nothing said how much of the form was left.
 *
 * `fit_type` STAYS, and is now the only AI styling tag this form owns — it is
 * what the Home recommendation engine matches a shopper's `preferred_fit`
 * against, so a garment added without one can never surface as "Recommended
 * for slims".
 */
const INITIAL_FORM_STATE = {
  name: '',
  description: '',
  category: 'TOPS',
  price: '',
  sizes: {},
  size_measurements: {},
  image_url: '',
  fit_type: 'REGULAR',
  /*
   * WHICH BACKGROUND THE CATALOG CARD IS DRAWN ON. `auto` follows the details
   * (name, AI occasion, description, category — see `resolveThemeKey`); a preset
   * key is the admin's explicit pick. Applied on SAVE and written to the
   * product's existing `background_occasion` column.
   */
  background_theme: AUTO_THEME
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
  // In-app Confirm / Cancel dialog (replaces the browser's `window.confirm`).
  const [confirm, confirmDialog] = useConfirm();

  /*
   * TABLE VIEW STATE (UI only).
   *   page          -> which slice of PAGE_SIZE products is shown.
   *   openStockRows -> rows whose size breakdown is expanded via the arrow.
   * `safePage` clamps the page when products are deleted, so the last page
   * emptying out never leaves the admin looking at a blank table.
   */
  const [page, setPage] = useState(0);
  const [openStockRows, setOpenStockRows] = useState(() => new Set());
  const pageCount = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pagedProducts = products.slice(pageStart, pageStart + PAGE_SIZE);

  const toggleStockRow = (rowId) => {
    setOpenStockRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  /*
   * True when the modal was opened on an EXISTING product.
   *
   * It only changes the AI button's wording ("Re-run AI Auto-fill"), because on
   * an edit the first automatic pass already ran and the admin is deliberately
   * correcting what it produced. Nothing about the payload depends on it — a
   * save with no new file still leaves the stored image untouched.
   */
  const [isEditingExistingImage, setIsEditingExistingImage] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  /*
   * WHICH STAGE of the photo pipeline is running, and how far the cut-out has got.
   *
   * `null` means idle. A string means a specific named step is in flight, and the
   * BUTTON renders that step's wording — so the busy state is legible without
   * anything extra on screen. `cutoutProgress` is the 0..1 the removal engine
   * reports, shown as a percentage on the button once the engine starts
   * producing it; it stays 0 during the model download, which is why the button
   * falls back to an animated sweep rather than a bar frozen at zero.
   */
  const [autoFillStage, setAutoFillStage] = useState(null);
  const [cutoutProgress, setCutoutProgress] = useState(0);

  /*
   * HAS THE PIPELINE EVER COMPLETED FOR THE CURRENT PHOTO?
   *
   * This is what turns the button from a one-shot "fill it in" into something the
   * admin can go back to. It is NOT derived from `autoFillStage` because the stage
   * self-clears after a few seconds — deriving from it would make the re-run
   * offer disappear on its own, which is the exact moment somebody wants it.
   *
   * It resets on a new photo and on opening the modal for a different product, so
   * it can never offer to re-run against the wrong image.
   */
  const [hasCompletedRun, setHasCompletedRun] = useState(false);
  const [imageAnalysisError, setImageAnalysisError] = useState('');
  const [saveError, setSaveError] = useState('');

  /*
   * A MOUNT THAT GOES AWAY MID-PIPELINE.
   *
   * Closing the modal mid-cut-out used to leave `setAutoFillStage` writing into an
   * unmounted component, and left the 40-second WASM job running with nothing left
   * to report to. This flag lets the pipeline notice and stop early, and keeps a
   * "re-open the modal and see a spinner forever" bug from being possible.
   */
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);

  /*
   * Background-removal outputs (identical to the Admin console):
   *   compositeBlob -> the cut-out on its OCCASION background -> `display_image_url`
   *   compositeUrl  -> preview shown in the modal
   *   tryonBlob     -> the bare transparent matte  -> `ghost_mannequin_url`
   *   background    -> WHICH occasion background was drawn, so the admin can see
   *                    the AI's choice instead of it being a silent surprise. It
   *                    is also written to `background_occasion` on save.
   */
  const [compositeBlob, setCompositeBlob] = useState(null);
  const [compositeUrl, setCompositeUrl] = useState('');
  const [tryonBlob, setTryonBlob] = useState(null);
  const [backgroundInfo, setBackgroundInfo] = useState(null);

  /*
   * RE-THEMING INPUTS.
   *
   *   cutoutSource  -> the TRANSPARENT garment a new background is painted
   *                    behind: the cut-out from this session's removal (Blob), or
   *                    an existing product's stored bare matte (URL). Re-theming
   *                    from it is one canvas paint — no second removal run.
   *   rawPhotoUrl   -> an existing product's original photo, used only when it
   *                    has no stored matte (the removal must then run once).
   *   aiOccasions   -> the AI's occasion tags, one input to the `auto` theme.
   *   savedThemeKey -> the background the product is SAVED with, so a save that
   *                    lands on the same background re-uploads nothing.
   */
  const [cutoutSource, setCutoutSource] = useState(null);
  const [rawPhotoUrl, setRawPhotoUrl] = useState(null);
  const [aiOccasions, setAiOccasions] = useState(null);
  const [savedThemeKey, setSavedThemeKey] = useState(null);
  const [isApplyingTheme, setIsApplyingTheme] = useState(false);

  /** true when the admin picked the theme by hand (the contrast guard stands down). */
  const isStrictTheme = formData.background_theme !== AUTO_THEME;

  /** The theme the card WILL be drawn on when this form is saved. */
  const resolvedThemeKey = useMemo(
    () =>
      resolveThemeKey({
        override: formData.background_theme,
        name: formData.name,
        occasions: aiOccasions,
        description: formData.description,
        category: formData.category
      }),
    [formData.background_theme, formData.name, formData.description, formData.category, aiOccasions]
  );

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
   * Auto-fill the product details from the garment photo via AI. Fills the name,
   * description, category, the garment fit type and a sensible price when the
   * field is still empty, WITHOUT overwriting anything the admin already typed.
   *
   * The AI is only allowed to ADD information. It is not a "reset" — pressing it
   * on a half-filled form must never wipe a field the admin has since edited.
   *
   * IT REPORTS WHAT IT IS DOING, AND IT LETS THE BROWSER PAINT IN BETWEEN.
   *
   * Both halves of that are load-bearing, and both existed because this was one
   * unbroken multi-second block that began in the same tick as the file input's
   * change event:
   *
   *   - the browser was never given a frame to render the "working" state, so
   *     the page sat on the previous paint and looked frozen, and
   *   - nothing distinguished a 2s Gemini call from a 40s model download, so a
   *     slow-but-healthy run was indistinguishable from a hang.
   *
   * `nextPaint()` between stages is what lets the spinner actually appear, and
   * `autoFillStage` is what makes the wait legible while it is up.
   */
  const handleAutoFillDetails = async (explicitFile, { overwrite = false } = {}) => {
    // Prefer the file handed in by the caller: `imageFile` is state, so inside
    // the file-input's change handler it is still the PREVIOUS photo. See
    // handleFileChange for the full explanation of why that mattered.
    const file = explicitFile || imageFile;

    if (!file || !onAnalyzeImage || isAnalyzingImage) return;

    setIsAnalyzingImage(true);
    setImageAnalysisError('');
    setCutoutProgress(0);

    // Paint "reading the photo" before anything expensive starts.
    setAutoFillStage(AUTO_FILL_STAGES.READING);
    await nextPaint();
    if (!isMountedRef.current) return;

    try {
      const imageData = await fileToAnalysisDataUri(file);

      if (!isMountedRef.current) return;
      setAutoFillStage(AUTO_FILL_STAGES.ANALYZING);
      // Another frame: the AI call is a network round trip, and the browser will
      // happily paint during it — but only if the stage is committed first.
      await nextPaint();

      const analysis = await onAnalyzeImage(imageData);

      if (!isMountedRef.current) return;
      setAiOccasions(analysis?.occasions ?? null);
      setFormData((prev) => ({
        ...prev,
        /*
         * FIRST PASS FILLS ONLY WHAT IS EMPTY. A RE-RUN OVERWRITES.
         *
         * On a fresh upload there is nothing to protect, so the AI is allowed to
         * supply anything it is confident about — that is the whole point of the
         * "drop a photo in, get a draft" flow.
         *
         * On a RE-RUN the admin is deliberately asking for the AI's answer again,
         * typically because the first one was wrong (a garment photographed at an
         * angle reads as the wrong category). Filling only empty fields would
         * make the button do nothing at all, because everything is now filled —
         * so the re-run REPLACES the values. It still never touches the size and
         * stock matrix: that is hand-entered data the AI has no opinion about,
         * and silently clearing it would discard real counts.
         */
        name: overwrite ? (analysis.name || prev.name) : (prev.name || analysis.name || ''),
        description: overwrite
          ? (analysis.description || prev.description)
          : (prev.description || analysis.description || ''),
        // The category is a closed set with no sensible "keep what I had"
        // fallback, so the AI's answer wins on a re-run and is only a default
        // on the first pass.
        category: analysis.category || prev.category,
        price: overwrite
          ? (analysis.price || prev.price)
          : (prev.price !== '' && prev.price != null ? prev.price : (analysis.price || prev.price)),
        fit_type: analysis.fit_type || prev.fit_type
      }));

      /*
       * BACKGROUND REMOVAL — the SAME step the Admin console runs after analysis.
       * Cuts the garment out of its photo and composes it on the background for
       * the OCCASION the AI just tagged it with. The framed result is uploaded as
       * `display_image_file` (-> display_image_url) and the bare matte as
       * `tryon_image_file` (-> ghost_mannequin_url), so the storefront shows a
       * clean, transparent product instead of the raw photo with its original
       * background.
       *
       * THE LONG ONE. On a first run this downloads ~95 MB of ONNX model and then
       * runs CPU inference, which blocks the main thread — so it is announced as
       * its own stage with a real percentage, rather than being left to look like
       * the app died.
       *
       * A RE-RUN MUST RE-CUT. The engine keeps an IndexedDB cache keyed on the
       * source image, so a re-run would otherwise hand back the identical cut-out
       * from the first pass and look like the button did nothing. `skipCache`
       * forces a fresh removal — which is exactly what someone pressing "run it
       * again" after a bad result is asking for.
       */
      try {
        if (!isMountedRef.current) return;
        setAutoFillStage(AUTO_FILL_STAGES.CUTTING);
        // The most important yield in the function: without it the browser starts
        // the model download in the same task as the state update above, never
        // paints, and the console is unresponsive for the whole run.
        await nextPaint();

        /*
         * The first card is drawn on the AI's own answer. If the admin then edits
         * the name/description or picks a theme, the preview effect below
         * re-themes it from `cutoutSource` — and the save applies the final one.
         */
        const { display, matte, cutout, background, ok } = await generateGarmentCatalogImage(file, {
          skipCache: overwrite,
          // The occasion the AI just returned decides the background. The category
          // is the fallback for when it returned nothing usable, so a garment the
          // AI could not place still gets a sensible card rather than a default.
          occasion: analysis?.occasions,
          category: analysis?.category,
          onProgress: (value) => {
            if (!isMountedRef.current) return;
            setCutoutProgress(Math.max(0, Math.min(1, Number(value) || 0)));
          }
        });

        if (!isMountedRef.current) return;

        if (ok) {
          setCompositeBlob(display.blob);
          setCompositeUrl((prev) => {
            releaseCompositeUrl(prev);
            return display.url;
          });
          // `requested` is null: this card came from the AI's occasion, not from
          // the form's resolved theme, so the preview effect will reconcile it.
          setBackgroundInfo(background?.key ? { ...background, requested: null, strict: false } : null);
          setCutoutSource(cutout?.blob || matte.blob || null);
        }
        setTryonBlob(matte.blob || null);

        if (!ok) {
          setImageAnalysisError(
            'The details were filled in, but the background could not be removed. The original photo will be used — press the button again to retry.'
          );
        }
      } catch (compositeError) {
        // Details still auto-filled; only the cut-out failed. Keep the original
        // photo and tell the admin, instead of silently shipping the raw image.
        if (!isMountedRef.current) return;
        console.warn('SuperAdmin: background removal failed', compositeError);
        setCompositeBlob(null);
        setTryonBlob(null);
        setBackgroundInfo(null);
        setCutoutSource(null);
        setCompositeUrl((prev) => {
          releaseCompositeUrl(prev);
          return '';
        });
        setImageAnalysisError(
          'The details were filled in, but background removal failed. The original photo will be used — try again.'
        );
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      const message =
        err?.response?.data?.message ||
        'Could not read the AI details. Try again, or fill the fields in manually.';
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
      if (isMountedRef.current) {
        /*
         * FLIP TO "DONE", NOT STRAIGHT TO IDLE.
         *
         * A spinner that vanishes the instant the work ends is indistinguishable
         * from one that never ran, and the admin is left wondering whether the
         * auto-fill happened at all. A brief, explicit success state answers that
         * before the button returns to normal — and it doubles as the "the details
         * really are filled in now" cue they are waiting for.
         */
        setAutoFillStage(AUTO_FILL_STAGES.DONE);
        setHasCompletedRun(true);
        setIsAnalyzingImage(false);
      }
    }
  };

  /*
   * THE CONFIRMATION CLEARS ITSELF.
   *
   * A success line that stays on screen forever starts claiming the form is still
   * busy, and the admin has to close the modal to clear it. It holds long enough
   * to actually be read, then goes — so the button and the form are back to their
   * resting state with no extra step from the user.
   */
  useEffect(() => {
    if (autoFillStage !== AUTO_FILL_STAGES.DONE) return undefined;
    const timer = setTimeout(() => {
      setAutoFillStage((stage) => (stage === AUTO_FILL_STAGES.DONE ? null : stage));
      setCutoutProgress(0);
    }, 5000);
    return () => clearTimeout(timer);
  }, [autoFillStage]);

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

  /*
   * LIVE THEME PREVIEW.
   *
   * Whenever the theme the save WILL use differs from the card currently shown
   * (the admin renamed "Linen Top" to "Linen Beach Top", or picked Formal in the
   * dropdown), the card is re-painted from the transparent cut-out. It is one
   * canvas paint — no removal run — and debounced so typing a name does not
   * repaint on every keystroke. The save re-checks and applies the final theme,
   * so a save pressed mid-debounce is still correct.
   */
  useEffect(() => {
    if (!isModalOpen || !cutoutSource || isAnalyzingImage) return undefined;
    if (backgroundInfo?.requested === resolvedThemeKey && backgroundInfo?.strict === isStrictTheme) return undefined;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const card = await reframeCutout({
          cutout: cutoutSource,
          occasion: resolvedThemeKey,
          strictOccasion: isStrictTheme
        });
        if (cancelled || !isMountedRef.current || !card.blob) {
          releaseCompositeUrl(card.url);
          return;
        }
        setCompositeBlob(card.blob);
        setCompositeUrl((prev) => {
          releaseCompositeUrl(prev);
          return card.url;
        });
        setBackgroundInfo({
          key: card.backgroundKey,
          label: card.backgroundLabel,
          guarded: card.backgroundGuarded,
          requested: resolvedThemeKey,
          strict: isStrictTheme
        });
      } catch (err) {
        // A preview that cannot load the stored matte is not fatal — the save
        // retries, and falls back to the original photo if it must.
        console.warn('SuperAdmin: theme preview failed', err);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isModalOpen, cutoutSource, isAnalyzingImage, resolvedThemeKey, isStrictTheme, backgroundInfo]);

  /**
   * THE CARD TO SAVE, DRAWN ON THE FORM'S FINAL THEME.
   *
   * Reuses the preview when it already matches; otherwise re-paints from the
   * cut-out. An existing product that never stored a bare matte has only its
   * original photo, so the removal runs once from that — slow, but only for
   * legacy rows, and only when the theme actually changes.
   *
   * @returns {Promise<{ blob: Blob, key: string, matte: Blob|null } | null>}
   */
  const buildThemedCard = async () => {
    if (compositeBlob && backgroundInfo?.requested === resolvedThemeKey && backgroundInfo?.strict === isStrictTheme) {
      return { blob: compositeBlob, key: backgroundInfo.key, matte: null };
    }

    if (cutoutSource) {
      const card = await reframeCutout({
        cutout: cutoutSource,
        occasion: resolvedThemeKey,
        strictOccasion: isStrictTheme
      });
      releaseCompositeUrl(card.url);
      return card.blob ? { blob: card.blob, key: card.backgroundKey, matte: null } : null;
    }

    if (!imageFile && rawPhotoUrl) {
      const { display, matte, background, ok } = await generateGarmentCatalogImage(rawPhotoUrl, {
        occasion: resolvedThemeKey,
        strictOccasion: isStrictTheme
      });
      releaseCompositeUrl(display.url);
      return ok ? { blob: display.blob, key: background.key, matte: matte.blob } : null;
    }

    return null;
  };

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

  /**
   * THE QUANTITIES THIS GARMENT ACTUALLY HOLDS, AS A LABEL => NUMBER MAP.
   *
   * There are two different columns in play and they have DIFFERENT SHAPES, which
   * is the reason stock appeared not to save:
   *
   *   size_stocks -> {"S":12,"M":8}          the stock MAP (label => quantity)
   *   sizes      -> ["S","M"]                the LIST of labels offered
   *
   * The read used `item.sizes || item.size_stocks`. `sizes` is usually a
   * NON-EMPTY ARRAY, so `||` stopped there — the quantity map was never read. An
   * array has no `S` key, so every size normalised to nothing and the form opened
   * with an EMPTY stock matrix even though the stock was sitting in the database
   * the whole time. Saving then wrote that empty matrix back and wiped it.
   *
   * `size_stocks` is therefore the source of truth for QUANTITY, and `sizes` is
   * only consulted as a fallback for rows written before the map existed, and
   * only when it is a map rather than a list.
   */
  const readStockMap = (item) => {
    // The real quantity map wins.
    const fromMap = parseSizes(item?.size_stocks);
    if (Object.keys(fromMap).length > 0) return fromMap;

    /*
     * Legacy fallback. `sizes` is only useful here when it is a LABEL => NUMBER
     * map; the documented LIST shape carries no quantities at all, so it is
     * ignored rather than being read as a stock count.
     */
    const legacy = parseSizes(item?.sizes);
    if (Array.isArray(legacy)) return {};

    return legacy;
  };

  /** The number held in ONE size cell, tolerating the legacy object shape. */
  const sizeQty = (szData) => {
    const qty = typeof szData === 'object' && szData !== null ? (szData.stock || 0) : szData;
    return Number(qty) || 0;
  };

  /**
   * HOW MANY UNITS OF ONE PRODUCT ARE ACTUALLY AVAILABLE.
   *
   * The single definition of "is this in stock", used by the table row AND the
   * header count, so the two can never disagree — which is exactly what happened
   * before, when a row said "Out of Stock" beside a header that implied a full
   * shelf.
   *
   * The stored `stock` column is trusted only when it is a POSITIVE number. It
   * is a plain column that unrelated writes can leave at 0, and `??` only
   * falls back on null/undefined, so a stored 0 would otherwise silently
   * override a real per-size breakdown and hide stock the store actually holds.
   * The matrix wins whenever it carries a positive quantity.
   */
  const totalStockOf = (item) => {
    const storedStock = Number(item?.stock);
    if (Number.isFinite(storedStock) && storedStock > 0) return storedStock;

    return Object.values(readStockMap(item)).reduce((total, szData) => {
      const qty = sizeQty(szData);
      return total + (qty > 0 ? qty : 0);
    }, 0);
  };

  /** How many products are currently unbuyable — the header's alert number. */
  const outOfStockCount = useMemo(
    () => (products || []).filter((item) => totalStockOf(item) === 0).length,
    [products]
  );

  // Compute Total Stock based on Sizes breakdown
  const computedTotalStock = useMemo(() => {
    const currentSizes = formData.sizes || {};
    return Object.values(currentSizes).reduce((total, szData) => {
      const qty = typeof szData === 'object' && szData !== null ? (szData.stock || 0) : Number(szData);
      return total + (isNaN(qty) || qty < 0 ? 0 : qty);
    }, 0);
  }, [formData.sizes]);

  /*
   * HOW MANY SIZES THIS GARMENT IS OFFERED IN.
   *
   * The bulk control's scope depends on it, and so does the warning shown when
   * it is zero — a garment with no offered size can never be matched to a
   * shopper, so it is worth saying out loud rather than letting the product
   * save silently into a feed that will ignore it.
   */
  const offeredCount = useMemo(
    () => Object.keys(formData.sizes || {}).length,
    [formData.sizes]
  );

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      // Drop any cut-out from a previous photo so a stale background-removed
      // image is never saved against the new upload.
      setCompositeBlob(null);
      setTryonBlob(null);
      setBackgroundInfo(null);
      // The old cut-out and AI tags belong to the PREVIOUS photo.
      setCutoutSource(null);
      setAiOccasions(null);
      setCompositeUrl((prev) => {
        releaseCompositeUrl(prev);
        return '';
      });
      // Clear the previous run's "Tapos na!" so the new photo starts clean.
      setAutoFillStage(null);
      setCutoutProgress(0);
      setHasCompletedRun(false);

      /*
       * AUTO-FILL ON SELECTION — the "drop a photo in, get a draft" flow.
       *
       * Two defects lived on this one line, and they are the direct cause of
       * "umiistop ang buong Hiraya" the moment a photo is chosen.
       *
       * 1. STALE FILE. `handleAutoFillDetails()` closes over `imageFile`, and in
       *    this same event handler `setImageFile(file)` has only QUEUED an
       *    update — the closure still holds the PREVIOUS value. So the first
       *    upload analysed nothing at all (it returned early on the initial
       *    `null`), and every upload after that analysed the garment from the
       *    upload BEFORE it, writing the wrong name, category and price onto a
       *    photo the admin was looking at. The file is therefore passed
       *    explicitly instead of being read back out of state.
       *
       * 2. NO PAINT BEFORE THE BLOCKING WORK. The call started synchronously
       *    inside the input's change event, so React set the busy state and
       *    immediately began seconds of network + main-thread WASM work in the
       *    same task. The browser never got a frame to render the busy state, so
       *    the page sat frozen on the pre-upload paint. The `nextPaint()` yield
       *    inside the pipeline (before it does anything expensive) is what lets
       *    the progress panel actually appear.
       */
      handleAutoFillDetails(file);
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

    /*
     * BULK APPLIES ONLY TO SIZES ALREADY OFFERED.
     *
     * It used to fall back to ALL SIX sizes when nothing was ticked, so an admin
     * who typed a quantity before choosing sizes silently turned a
     * "one size only" garment into a full run. Offering is a deliberate
     * per-size decision and this control is about quantity, so it must never
     * make that decision for them. With nothing offered there is simply nothing
     * to apply to — the button explains that instead of guessing.
     */
    if (currentKeys.length === 0) return;

    const updated = { ...(formData.sizes || {}) };
    currentKeys.forEach((sz) => {
      updated[sz] = qty;
    });

    setFormData((prev) => ({ ...prev, sizes: updated }));
  };

  const openAddModal = () => {
    setEditingId(null);
    setIsEditingExistingImage(false);
    setFormData(INITIAL_FORM_STATE);
    setImageFile(null);
    setPreviewUrl('');
    setBulkStock('');
    setImageAnalysisError('');
    setSaveError('');
    setAutoFillStage(null);
    setCutoutProgress(0);
    setHasCompletedRun(false);
    setCompositeBlob(null);
    setTryonBlob(null);
    setBackgroundInfo(null);
    setCutoutSource(null);
    setRawPhotoUrl(null);
    setAiOccasions(null);
    setSavedThemeKey(null);
    setCompositeUrl((prev) => {
      releaseCompositeUrl(prev);
      return '';
    });
    setIsModalOpen(true);
  };

   const openEditModal = (item) => {
    setEditingId(item.id);
    setIsEditingExistingImage(true);
    const aiTags = item.ai_tags || {};

    // Normalize the stored stock MAP into the form's label => number shape.
    // `readStockMap` picks size_stocks over sizes — see its note on why that
    // precedence is what makes an existing product open with its real stock.
    const rawSizes = readStockMap(item);
    const normalizedSizes = {};
    AVAILABLE_SIZES.forEach(sz => {
      if (Object.prototype.hasOwnProperty.call(rawSizes, sz)) {
        normalizedSizes[sz] = sizeQty(rawSizes[sz]);
      }
    });

    setFormData({
      name: item.name || '',
      description: item.description || '',
      category: item.category || 'TOPS',
      price: item.price || '',
      sizes: normalizedSizes,
      size_measurements: parseSizes(item.size_measurements) || {},
      image_url: item.display_image_url || item.image_url || item.image || '',
      // Preserved on edit. Products added before this field existed carry no
      // fit_type, and silently resetting them to REGULAR would stamp a styling
      // claim nobody made — the recommendation engine reads null as "untagged",
      // which is the honest state, so keep whatever is actually stored.
      fit_type: aiTags.fit_type || item.fit_type || '',
      /*
       * The SAVED background opens pre-selected, so editing an unrelated field
       * never silently re-themes a product (the column does not record whether
       * it was picked by hand or by `auto`). Legacy rows with no theme open on
       * `auto` and get one on their next save.
       */
      background_theme: isThemeKey(item.background_occasion) ? item.background_occasion : AUTO_THEME
    });

    const storedTheme = isThemeKey(item.background_occasion) ? item.background_occasion : null;
    const storedOccasions = aiTags.occasions ?? item.occasions ?? null;
    setSavedThemeKey(storedTheme);
    setAiOccasions(storedOccasions);
    // The stored bare matte is the re-theming source; the raw photo is the
    // last resort for rows saved before mattes existed.
    setCutoutSource(loadableUrl(item.ghost_mannequin_url));
    setRawPhotoUrl(loadableUrl(item.image_url || item.image));
    /*
     * Describe the card that is ALREADY stored, so the preview effect leaves it
     * alone until the admin changes something. A legacy row (no stored theme)
     * gets `requested: null`, which makes the preview show its themed card
     * straight away.
     */
    setBackgroundInfo(
      storedTheme
        ? { key: storedTheme, label: FRAME_PRESETS[storedTheme].label, guarded: false, requested: storedTheme, strict: true }
        : { key: null, label: '', guarded: false, requested: null, strict: false }
    );

    setImageFile(null);
    setPreviewUrl(item.display_image_url || item.image_url || item.image || '');
    setBulkStock('');
    setImageAnalysisError('');
    setSaveError('');
    setAutoFillStage(null);
    setCutoutProgress(0);
    setHasCompletedRun(false);
    setCompositeBlob(null);
    setTryonBlob(null);
    // (`backgroundInfo` was set above from the stored theme.)
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

      /*
       * ONLY `fit_type` is sent now.
       *
       * The other three AI styling tags (undertone / body_shapes / occasions) are
       * gone from this form while they are refactored. Crucially they are NOT
       * sent as empty values either: `prepareAiTags()` on the backend copies any
       * key present in the request over the stored tags, so appending
       * `body_shapes: "[]"` on every save would ERASE the tagging a product
       * already had the first time somebody edited an unrelated field. Sending
       * only the key we actually own leaves the rest untouched.
       */
      const aiTagsPayload = { fit_type: formData.fit_type };

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
      payload.append('description', formData.description || '');
      payload.append('stock', computedTotalStock);
      payload.append('sizes', JSON.stringify(sizeLabels));
      payload.append('size_stocks', JSON.stringify(sizesPayload));
      payload.append('size_measurements', JSON.stringify(sizeMeasurementsPayload));

      // AI Attributes Direct Payload & JSON Bundle
      payload.append('ai_tags', JSON.stringify(aiTagsPayload));
      payload.append('fit_type', formData.fit_type);

      // Original upload slot. On edit we only send a NEW file when one is
      // chosen, so existing images are never clobbered.
      /*
       * APPLY THE BACKGROUND THEME ON SAVE.
       *
       * The card is (re)drawn on the theme the form resolves to NOW — the
       * admin's pick, or `auto` from the details they just saved — so the stored
       * `display_image_url`, and therefore every shop surface, carries that
       * theme. A failure here never blocks the save: the product keeps the
       * previous card (or the raw photo) and the details still save.
       */
      const themedCard = async () => {
        setIsApplyingTheme(true);
        try {
          return await buildThemedCard();
        } catch (themeError) {
          console.warn('SuperAdmin: could not apply the background theme', themeError);
          return null;
        } finally {
          if (isMountedRef.current) setIsApplyingTheme(false);
        }
      };

      if (imageFile) {
        payload.append('image_file', imageFile);

        const card = compositeBlob || cutoutSource ? await themedCard() : null;

        /*
         * `display_image_file` is the BACKGROUND-REMOVED catalog image, not the
         * raw photo — same as the Admin console. Customers resolve their image
         * as `display_image_url || image_url`, so sending the raw file here is
         * exactly why products added from the Super Admin still showed their
         * original background. When the cut-out is missing (removal failed) we
         * fall back to the raw file so the product is never left imageless.
         */
        payload.append('display_image_file', card?.blob || compositeBlob || imageFile);
        payload.append('tryon_image_file', tryonBlob || imageFile);

        /*
         * WHICH BACKGROUND WAS DRAWN — recorded in `background_occasion` so the
         * shop can match the tile to it and the card can be re-themed later.
         * Only sent when a themed card exists, never for a raw-photo fallback.
         */
        if (card?.key) {
          payload.append('background_occasion', card.key);
        } else if (compositeBlob && backgroundInfo?.key) {
          payload.append('background_occasion', backgroundInfo.key);
        }
      } else if (editingId && (resolvedThemeKey !== savedThemeKey || !savedThemeKey)) {
        /*
         * AN EDIT THAT CHANGES THE THEME, with no new photo: re-paint the stored
         * cut-out on the new background and upload only the card. When the
         * result is the background already saved (the contrast guard can land
         * there), nothing is re-uploaded.
         */
        const card = await themedCard();
        if (card?.blob && card.key && card.key !== savedThemeKey) {
          payload.append('display_image_file', card.blob);
          payload.append('background_occasion', card.key);
          // A legacy row had no bare matte; the removal just produced one.
          if (card.matte) payload.append('tryon_image_file', card.matte);
        }
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

  const handleDelete = async (item) => {
    const ok = await confirm({
      title: 'Delete product?',
      message: `"${item.name || 'This product'}" will be removed from the inventory and the shop. This cannot be undone.`,
      confirmText: 'Delete',
      danger: true
    });
    if (ok && onDeleteProduct) await onDeleteProduct(item.id);
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-hiraya-structure-line">
        <div>
          <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900 flex items-center gap-2">
            <Package size={20} /> Inventory Management
          </h2>
          {/*
           * THE RUNNING COUNT, REPLACING THE DESCRIPTIVE SUBHEADING.
           *
           * The sentence that used to sit here ("Manage garment inventory, size
           * stocks, and fit recommendations in one place") described the screen
           * to whoever was already looking at it. A count answers the question an
           * admin actually opens this tab with — how many garments are there, and
           * how many of them are out of stock — and it is information the table
           * cannot give at a glance once it has scrolled.
           */}
          <p className="text-xs text-hiraya-ink-muted mt-1 tabular-nums">
            {products.length} {products.length === 1 ? 'product' : 'products'}
            {outOfStockCount > 0 && (
              <span className="text-red-700/80"> · {outOfStockCount} out of stock</span>
            )}
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="px-4 py-2.5 bg-hiraya-accent hover:bg-hiraya-gold-deep text-hiraya-on-accent font-mono text-xs font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <Plus size={16} /> Add Product
        </button>
      </div>

      {/* INVENTORY TABLE */}
      <div className="bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 overflow-hidden text-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-navy-900 uppercase tracking-[0.14em] text-[10px] text-cream-100">
              <tr>
                <th className="p-4">Product</th>
                <th className="p-4">Category</th>
                <th className="p-4">Price</th>
                <th className="p-4">Stock</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hiraya-structure-line/70 text-hiraya-ink font-mono">
               {products && products.length > 0 ? (
                 pagedProducts.map((item, idx) => {
                   /*
                    * THE STOCK MAP IS THE SOURCE OF TRUTH.
                    *
                    * The old read was `item.sizes || item.size_stocks`, and `sizes`
                    * is the LIST column (["S","M"]) — usually a non-empty array, so
                    * it ALWAYS won and the quantity map was never read. An array
                    * has no `S` key, so every size normalised to nothing: the
                    * per-size chips rendered empty, Status fell back to "Out of
                    * Stock", and opening a product to edit showed a blank stock
                    * matrix that then overwrote the real numbers on save.
                    * `readStockMap` gets the precedence right — see its note.
                    */
                   const itemSizesObj = readStockMap(item);
                   const sizeEntries = Object.entries(itemSizesObj);

                   /*
                    * OFFERED SIZES, NOT JUST STOCKED ONES.
                    *
                    * The old filter kept only `qty > 0`, so a size that is offered
                    * but momentarily empty disappeared from the row entirely. The
                    * admin then had no cell to type a number into and no way to
                    * tell "we don't sell that size" from "we're out of it". Every
                    * size the map names is shown; an empty one is styled amber.
                    */
                   const offeredSizes = sizeEntries.filter(([sz]) =>
                     AVAILABLE_SIZES.includes(sz)
                   );

                   /*
                    * THE ROW AND THE HEADER MUST AGREE.
                    *
                    * Both call `totalStockOf`, so a garment can never be counted
                    * as out of stock in the header while its own row claims
                    * otherwise. When these were computed separately they drifted,
                    * and the summary quietly contradicted the table under it.
                    */
                   const totalStock = totalStockOf(item);

                  const aiTags = item.ai_tags || {};
                  const fitType = aiTags.fit_type || item.fit_type || '';
                  const rowId = item.id ?? `row-${pageStart + idx}`;
                  const isStockOpen = openStockRows.has(rowId);

                  return (
                    <tr key={rowId} className="hover:bg-cream-200/60 transition">
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
                            className="w-10 h-10 object-cover rounded-lg border border-hiraya-structure-line/80 bg-hiraya-cream/30 shrink-0"
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
                          <div className="w-10 h-10 rounded-lg bg-cream-200/60 border border-hiraya-structure-line/80 flex items-center justify-center text-hiraya-sand shrink-0">
                            <ImageIcon size={18} />
                          </div>
                        )}
                          <div className="min-w-0">
                            <p className="font-medium text-hiraya-ink truncate">{item.name}</p>
                            {/*
                             * FIT TYPE AS A SUBTLE SECOND LINE.
                             *
                             * It was a full table column of its own, which spent a
                             * wide cell on a three-letter word and pushed the two
                             * things an admin actually scans — the product name
                             * and the stock — away from each other. Under the name
                             * it stays visible but out of the way, and an untagged
                             * garment says so, because that IS its state: it will
                             * not surface in a shopper's spotlight.
                             */}
                            <p className="text-[9px] uppercase tracking-wider text-hiraya-ink-muted">
                              {fitType || 'Untagged'}
                            </p>
                          </div>
                        </td>

                      <td className="p-4 uppercase text-hiraya-ink whitespace-nowrap">
                        {item.category || 'N/A'}
                      </td>

                      {/*
                       * THE PESO SIGN WAS MOJIBAKE, NOT MISSING.
                       *
                       * The cell rendered `â‚±` — the character WAS in the source
                       * and broke on the way to the screen, because a UTF-8 `₱`
                       * read as Latin-1 turns into three junk bytes. Writing it as
                       * the HTML entity `&#8369;` makes the encoding irrelevant,
                       * so it renders as ₱ whatever charset the document, the
                       * bundle or the font stack ends up using.
                       */}
                      <td className="p-4 text-hiraya-ink whitespace-nowrap tabular-nums">
                        &#8369;{Number(item.price || 0).toLocaleString('en-PH')}
                      </td>

                       <td className="p-4">
                         {/*
                          * SIZES ARE COLLAPSED BEHIND AN ARROW.
                          *
                          * Six size chips per row made every row tall and pushed the
                          * table past the screen. The row now shows only the total;
                          * the arrow reveals the per-size breakdown for that one row.
                          */}
                         <div className="flex flex-col gap-1.5">
                           <button
                             type="button"
                             onClick={() => toggleStockRow(rowId)}
                             aria-expanded={isStockOpen}
                             aria-label={`${isStockOpen ? 'Hide' : 'Show'} sizes for ${item.name}`}
                             className="flex items-center gap-1.5 text-left cursor-pointer group/stock focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus rounded"
                           >
                             <span
                               className={`text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${
                                 totalStock > 0 ? 'text-emerald-700' : 'text-red-700/80'
                               }`}
                             >
                               {totalStock > 0 ? `${totalStock} in stock` : 'Out of stock'}
                             </span>
                             <span className="flex h-5 w-5 items-center justify-center rounded-md border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink group-hover/stock:bg-cream-200 transition">
                               <ChevronDown
                                 size={12}
                                 className={`transition-transform duration-200 ${isStockOpen ? 'rotate-180' : ''}`}
                               />
                             </span>
                           </button>
                           {isStockOpen && (
                           <div className="flex flex-wrap gap-1">
                             {offeredSizes.length > 0 ? (
                               offeredSizes.map(([sz, szData]) => {
                                 const qty = sizeQty(szData);
                                 return (
                                   <span
                                     key={sz}
                                     className={`px-1.5 py-0.5 border text-[9px] rounded tabular-nums ${
                                       qty > 0
                                         ? 'bg-hiraya-cream/60 border-hiraya-structure-line text-hiraya-ink'
                                         : 'bg-amber-500/10 border-amber-600/40 text-amber-800'
                                     }`}
                                   >
                                     {sz} <span className="opacity-60">×</span> {qty}
                                   </span>
                                 );
                               })
                             ) : (
                               <span className="text-hiraya-ink-muted text-[10px] italic">
                                 No sizes set
                               </span>
                             )}
                           </div>
                           )}
                         </div>
                       </td>

                      {/*
                       * STOCK IS ONE COLUMN, NOT TWO, AND FIT TYPE IS NOT A COLUMN.
                       *
                       * "Sizes & Stock" and "Status" were both answering the same
                       * question from the same numbers, and the badge read "Out of
                       * Stock" whenever the chip filter came back empty — which is
                       * why a garment holding stock was still labelled out of
                       * stock. The running total now sits directly under the chips,
                       * which is the one place an admin looks to answer "do I have
                       * this, and in what sizes?".
                       *
                       * Fit type moved UNDER THE PRODUCT NAME: it was a full column
                       * spent on a three-letter word, pushing the name and the
                       * stock apart, and the chips it used to sit beside (undertone /
                       * body shape / occasion) are gone from the data-entry form, so
                       * showing them advertised tagging this console cannot set.
                       */}
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(item)}
                            className="p-2 bg-navy-100 hover:bg-navy-200/70 border border-navy-300/70 text-navy-800 rounded-lg transition cursor-pointer"
                            title="Edit Product"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="p-2 bg-red-500/12 hover:bg-red-500/20 border border-red-600/40 text-red-700 rounded-lg transition cursor-pointer"
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
                  <td colSpan="5" className="p-8 text-center text-hiraya-sand uppercase tracking-widest">
                    No products found in inventory
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/*
         * PAGINATION — five products per page.
         *
         * The sixth product starts page two. The arrows sit under the table so the
         * list never grows past the screen; the range line says which slice is in
         * view out of how many.
         */}
        {products.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-hiraya-structure-line/70 font-mono">
            <p className="text-[10px] uppercase tracking-wider text-hiraya-ink-muted tabular-nums">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, products.length)} of {products.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Previous page"
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-[10px] uppercase tracking-wider text-hiraya-ink tabular-nums min-w-[4.5rem] text-center">
                Page {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={safePage >= pageCount - 1}
                aria-label="Next page"
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* UNIFIED ADD / EDIT PRODUCT + AI ATTRIBUTES MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-hiraya-cream-deep/80 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 shadow-2xl w-full max-w-4xl overflow-hidden font-mono text-xs max-h-[92vh] flex flex-col">

            {/* Modal Header */}
            <div className="p-4 border-b border-hiraya-structure-line/80 flex justify-between items-center bg-cream-200/60 shrink-0">
              <h3 className="font-bold text-hiraya-ink uppercase tracking-wider flex items-center gap-2">
                <Package size={16} /> {editingId ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button onClick={() => !isSubmitting && setIsModalOpen(false)} className="text-hiraya-ink hover:text-hiraya-ink p-1 rounded-lg transition">
                <X size={18} />
              </button>
            </div>

            {/*
             * THE LAYOUT IS THE POINT.
             *
             * This used to be a 4-section, `max-w-2xl`, `max-h-[90vh]` scrolling
             * form: name/category/price, then a purple AI panel, then a size
             * matrix, then the image upload. On a laptop the size grid and the
             * upload were both below the fold, so an admin could not see the
             * whole product they were describing — and the modal never said how
             * much was hidden.
             *
             * It is now a 2-column desktop / 1-column mobile grid, sized to hold
             * every field WITHOUT scrolling on a normal screen:
             *
             *   LEFT  — the garment photo (upload + previews) and the AI button
             *   RIGHT — name, description, category, price, fit type, sizes
             *
             * The media comes FIRST because that is the natural order of work:
             * drop in the photo, let the AI draft the text, then correct it.
             * The form still scrolls on a phone, where nothing else is possible.
             */}
            <form onSubmit={handleSubmit} className="p-4 sm:p-5 flex-1 min-h-0 overflow-y-auto">

              {/* THE GRID — media on the left, every field on the right. */}
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,300px)_1fr] gap-4 sm:gap-5 items-start">

                {/*
                 * LEFT — THE GARMENT PHOTO.
                 *
                 * Deliberately the first thing in the form. The AI auto-fill reads
                 * this photo, so putting the upload above the fields it fills
                 * makes the causal order obvious: drop the photo, watch the text
                 * appear below, then correct it.
                 */}
                <div className="space-y-2.5 p-3 bg-cream-200/60 border border-hiraya-structure-line/80 rounded-xl">
                  <span className="text-[10px] text-hiraya-ink font-bold uppercase tracking-widest flex items-center gap-1.5 border-b border-hiraya-structure-line/80 pb-1">
                    <Shirt size={12} /> 1. Garment Photo
                  </span>

                  <div>
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">Upload Picture</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileChange}
                      /*
                       * LOCKED WHILE THE PIPELINE RUNS.
                       *
                       * Choosing a second photo mid-cut-out would start a second
                       * background removal while the first still owns the main
                       * thread. The two jobs then race to write `compositeBlob`, and
                       * whichever finishes last wins — so the admin could save a
                       * product whose stored image came from a photo they had
                       * already replaced. The input is disabled for the duration so
                       * there is only ever one pipeline in flight.
                       */
                      disabled={isAnalyzingImage}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2 text-hiraya-ink file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-hiraya-accent file:text-hiraya-on-accent hover:file:bg-hiraya-gold-deep disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>

                  {/*
                   * THE BUTTON IS BOTH THE FIRST RUN AND THE RE-RUN.
                   *
                   * There is no separate "run again" control. The same button
                   * CHANGES ITS WORDING once a run has completed, so the affordance
                   * to re-do the work is exactly where the work started — the admin
                   * never looks for a second button that was not there before.
                   *
                   * `overwrite` is the whole difference between the two presses:
                   *   false — first pass, FILL ONLY EMPTY FIELDS, so a
                   *           half-typed form is never wiped.
                   *   true  — re-run, REPLACE the details AND force a fresh
                   *           background removal, because the admin is telling us
                   *           the first answer was wrong. It still never touches
                   *           the size and stock matrix — hand-entered counts the
                   *           AI has no opinion about.
                   *
                   * The per-stage wording is why a slow run does not read as a
                   * hang: a 3-second Gemini call and a 40-second model download
                   * are visibly different waits, and the real percentage appears
                   * on the cut-out as soon as the engine produces one.
                   */}
                  <button
                    type="button"
                    onClick={() => handleAutoFillDetails(undefined, { overwrite: hasCompletedRun })}
                    disabled={!imageFile || isAnalyzingImage}
                    aria-busy={isAnalyzingImage}
                    title={
                      hasCompletedRun
                        ? 'Run the AI again — it will replace the current name, description, category and price, and redo the background removal'
                        : 'Let the AI fill in the product details from this photo'
                    }
                    className="w-full px-3 py-2 bg-charcoal-100 hover:bg-charcoal-200/70 border border-charcoal-300 text-charcoal-800 font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 text-[10px] transition disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isAnalyzingImage ? (
                      <>
                        <Loader2 size={13} className="animate-spin shrink-0" />
                        <span className="truncate">
                          {STAGE_BUTTON_COPY[autoFillStage] || 'Reading the photo...'}
                        </span>
                        {/*
                         * THE REAL PERCENTAGE, ONLY WHERE ONE EXISTS.
                         *
                         * The cut-out is the one step the engine reports progress
                         * for, and even then only after the first asset byte lands —
                         * during the ~95 MB model download there is nothing honest to
                         * show, so the label alone carries it. A counter frozen at 0%
                         * would look like the exact hang this is meant to prevent.
                         */}
                        {autoFillStage === AUTO_FILL_STAGES.CUTTING && cutoutProgress > 0 && (
                          <span className="tabular-nums opacity-80">
                            {Math.round(cutoutProgress * 100)}%
                          </span>
                        )}
                      </>
                    ) : hasCompletedRun ? (
                      <><Sparkles size={13} /> Run AI again</>
                    ) : (
                      <><Sparkles size={13} /> {isEditingExistingImage ? 'Auto-fill details (AI)' : 'Auto-fill Details (AI)'}</>
                    )}
                  </button>

                  {/*
                   * THE DONE STATE, AS TEXT RATHER THAN A PANEL.
                   *
                   * A brief confirmation is what the admin is actually waiting for:
                   * not "did it work" but "is it finished". It sits with the error
                   * message below the button, so the form gains one line only at
                   * the moment there is something new to say, and it self-clears.
                   *
                   * It names what was and was not achieved, because "Done" on its
                   * own hides the one case that matters most — a garment whose
                   * details are fine but whose photo kept its background.
                   */}
                  {autoFillStage === AUTO_FILL_STAGES.DONE && (
                    <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider">
                      {Boolean(compositeBlob || compositeUrl)
                        ? 'Done — details added and background removed.'
                        : 'Done — details added, but the background was not removed.'}
                    </p>
                  )}

                  {/*
                   * THE VIBE THAT WAS CHOSEN, said out loud.
                   *
                   * The background is no longer a fixed black card, so the AI's
                   * occasion guess becomes visible: a linen dress landing on the
                   * Summer background is intended, and the admin should be able
                   * to confirm it at a glance. When the contrast guard had to
                   * override the occasion's own dark surface — a black barong on
                   * the Cultural card — that is called out rather than hidden,
                   * because otherwise the image would not match its own label.
                   */}
                  {backgroundInfo?.key && (
                    <p className="text-[10px] text-charcoal-600">
                      <span className="font-bold uppercase tracking-wider text-charcoal-700">
                        {backgroundInfo.label || backgroundInfo.key} background
                      </span>
                      {backgroundInfo.guarded && ' — with a light halo for a dark garment'}
                    </p>
                  )}

                  {imageAnalysisError && (
                    <p className="text-[10px] text-red-700">{imageAnalysisError}</p>
                  )}

                  {/*
                   * BOTH IMAGES ARE SHOWN, ALWAYS.
                   *
                   * The "no background" cut-out is what shoppers see; the
                   * "original" is what was actually uploaded. Showing them as a
                   * pair is the only way an admin can tell a successful
                   * background removal from a silent fallback to the raw photo —
                   * when only the original chip appears, the removal failed.
                   */}
                  {previewUrl && (
                    <div className="space-y-2 pt-1">
                      {compositeUrl && (
                        <div className="flex items-center gap-2.5">
                          <div
                            className="relative w-12 h-[60px] shrink-0 rounded-lg overflow-hidden border-hiraya-accent/50 bg-black"
                            style={backgroundInfo?.key ? { backgroundColor: FRAME_PRESETS[backgroundInfo.key]?.base } : undefined}
                          >
                            <img src={compositeUrl} alt="Background-removed preview" className="w-full h-full object-contain" />
                            <span className="absolute bottom-0 inset-x-0 bg-hiraya-accent text-hiraya-on-accent text-[7px] font-black uppercase tracking-wider text-center py-0.5">
                              No BG
                            </span>
                          </div>
                          <p className="text-[9px] text-hiraya-ink font-bold uppercase leading-snug">
                            Background removed — this is what shoppers will see
                          </p>
                        </div>
                      )}
                      <div className="flex items-center gap-2.5">
                        <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden border border-hiraya-structure-line/80 bg-cream-200/60">
                          <img src={previewUrl} alt="Original preview" className="w-full h-full object-cover" />
                          {compositeUrl && (
                            <span className="absolute bottom-0 inset-x-0 bg-hiraya-cream-deep/80 text-hiraya-ink text-[7px] font-black uppercase tracking-wider text-center py-0.5">
                              Original
                            </span>
                          )}
                        </div>
                        <p className="text-[9px] text-hiraya-ink font-bold uppercase leading-snug">
                          Ready
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT — EVERY FIELD THE ADMIN OWNS. */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">Product Name *</label>
                    <input
                      type="text"
                      name="name"
                      required
                      placeholder="e.g. Silk Barong Tagalog"
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">Description</label>
                    <textarea
                      name="description"
                      rows={2}
                      placeholder="Fabric, cut and feel"
                      value={formData.description}
                      onChange={handleInputChange}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent resize-none"
                    />
                  </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">Category *</label>
                    <select
                      name="category"
                      value={formData.category}
                      onChange={handleInputChange}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
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
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">Price (₱) *</label>
                    <input
                      type="number"
                      name="price"
                      required
                      placeholder="1299"
                      value={formData.price}
                      onChange={handleInputChange}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                    />
                  </div>
                </div>
              </div>

                  <div>
                    <label className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1">Garment Fit Type</label>
                    <select
                      name="fit_type"
                      value={formData.fit_type}
                      onChange={handleInputChange}
                      className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                    >
                      {/*
                       * "Not set" is a REAL option, not a placeholder.
                       *
                       * A garment with no fit type cannot be surfaced as
                       * "Recommended for slims" — the engine reads a missing
                       * fit_type as untagged and ranks it below an explicit
                       * match. Offering it as a first-class choice makes it a
                       * decision the admin makes on purpose, instead of a
                       * default that silently mislabels the garment.
                       *
                       * THE WARNING UNDER IT IS GONE. It restated the option's own
                       * label in a second sentence and added a line to a form that
                       * is deliberately sized to fit on one screen. The label says
                       * "Not set" and the consequence is the admin's to judge; the
                       * table's "Untagged" marker carries the same information
                       * later, where it is actually read.
                       */}
                      <option value="">Not set</option>
                      <option value="SLIM">SLIM FIT</option>
                      <option value="REGULAR">REGULAR FIT</option>
                      <option value="LOOSE">LOOSE / OVERSIZED</option>
                    </select>

                    {/*
                     * BACKGROUND THEME — the catalog card's backdrop.
                     *
                     * "Auto" follows the details above (name, AI occasion,
                     * description, category), so the default background changes
                     * with the garment's theme on save. Picking a theme pins it.
                     * The swatch and the line under the select show the theme
                     * the SAVE will use, and it is what the shop tiles match.
                     */}
                    <label htmlFor="background_theme" className="block text-[10px] uppercase text-hiraya-ink tracking-wider mb-1 mt-3">
                      Background Theme
                    </label>
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-9 w-9 shrink-0 rounded-lg border border-hiraya-ink/15 shadow-neu-inset"
                        style={{
                          backgroundColor: FRAME_PRESETS[resolvedThemeKey].base,
                          boxShadow: `inset 0 0 0 3px ${FRAME_PRESETS[resolvedThemeKey].accent}`
                        }}
                      />
                      <select
                        id="background_theme"
                        name="background_theme"
                        value={formData.background_theme}
                        onChange={handleInputChange}
                        disabled={isSubmitting}
                        className="w-full bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-xl p-2.5 text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                      >
                        <option value={AUTO_THEME}>AUTO — match the details</option>
                        {Object.entries(FRAME_PRESETS).map(([key, preset]) => (
                          <option key={key} value={key}>{preset.label.toUpperCase()}</option>
                        ))}
                      </select>
                    </div>
                    <p className="mt-1 text-[10px] text-charcoal-600">
                      Saves on the{' '}
                      <strong className="text-charcoal-700">{FRAME_PRESETS[resolvedThemeKey].label}</strong>{' '}
                      background{isStrictTheme ? '' : ' (from the details)'}.
                    </p>
                  </div>
                </div>

                {/* ============================================================
                    2. SIZE & STOCK
                    ============================================================
                    Two separate decisions share this panel and used to be crammed
                    into one cell: does this garment COME IN this size, and how MANY
                    are we holding. They are now their own columns — OFFERED on the
                    right, STOCK beside it — so each states one fact, and the running
                    total updates as the admin types.

                    The bulk control says out loud what it will touch before it is
                    pressed, because with nothing offered it writes the number into
                    all six sizes, which is a destructive default nobody should
                    discover by accident.
                    ============================================================ */}
                  <div className="p-3 bg-cream-200/60 border border-hiraya-structure-line/80 rounded-xl space-y-2.5">
                    <div className="flex items-center justify-between gap-2 border-b border-hiraya-structure-line/80 pb-1.5">
                      <span className="text-[10px] uppercase text-hiraya-ink font-bold flex items-center gap-1.5">
                        <Shirt size={12} /> 2. Size &amp; Stock
                      </span>
                      <span className="text-[10px] text-hiraya-ink flex items-center gap-1.5">
                        <span className="opacity-70">Total</span>
                        <strong className="text-hiraya-ink text-[11px] tabular-nums">{computedTotalStock}</strong>
                        <span className="opacity-70">pcs</span>
                      </span>
                    </div>

                    {/* Column heads. A size has two independent facts, and the
                        second one is only meaningful once the first is true — so
                        STOCK is centred and OFFERED is the right-hand switch. */}
                    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5rem_6.5rem] gap-x-2 items-center px-1">
                      <span className="text-[9px] uppercase tracking-wider text-hiraya-ink-muted font-bold">Size</span>
                      <span className="hidden sm:block text-center text-[9px] uppercase tracking-wider text-hiraya-ink-muted font-bold">Stock</span>
                      <span className="text-right text-[9px] uppercase tracking-wider text-hiraya-ink-muted font-bold">Offered</span>
                    </div>

                    <div className="divide-y divide-hiraya-structure-line/60">
                      {AVAILABLE_SIZES.map((sz) => {
                        const isOffered = Object.prototype.hasOwnProperty.call(formData.sizes || {}, sz);
                        const rawQty = isOffered ? formData.sizes[sz] : 0;
                        const qty = typeof rawQty === 'object' && rawQty !== null ? (rawQty.stock || 0) : rawQty;
                        const isEmpty = isOffered && Number(qty) === 0;

                        return (
                          <div
                            key={sz}
                            className={`grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_5rem_6.5rem] gap-x-2 items-center px-1 py-1 rounded transition ${
                              isOffered ? 'bg-hiraya-cream/40' : 'bg-transparent'
                            }`}
                          >
                            <span className={`text-[11px] font-bold ${isOffered ? 'text-hiraya-ink' : 'text-hiraya-ink-muted/50'}`}>
                              {sz}
                            </span>

                            {/* STOCK — only meaningful once the size is offered.
                                It renders an em-dash rather than vanishing, so
                                enabling a size fills in a cell that was already
                                there instead of shoving every row below it down. */}
                            <div className="hidden sm:flex justify-center">
                              {isOffered ? (
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  aria-label={`Stock for size ${sz}`}
                                  value={qty}
                                  onChange={(e) => handleSizeStockChange(sz, e.target.value)}
                                  className={`w-14 text-center text-[11px] tabular-nums py-1 rounded-md border focus:outline-none focus:border-hiraya-accent ${
                                    isEmpty
                                      ? 'bg-amber-500/10 border-amber-600/40 text-amber-800'
                                      : 'bg-cream-200/55 border-hiraya-structure-line text-hiraya-ink'
                                  }`}
                                />
                              ) : (
                                <span className="text-[11px] text-hiraya-ink-muted/40">&mdash;</span>
                              )}
                            </div>

                            {/* OFFERED — the switch. Sits on the right on mobile
                                too, because "does this size exist" is the
                                decision an admin makes first; the quantity is
                                the follow-up. */}
                            <div className="flex items-center justify-end gap-2">
                              {isEmpty && (
                                <span className="hidden sm:block text-[8px] uppercase tracking-wider text-amber-700 font-bold">
                                  Out
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleToggleSize(sz)}
                                aria-pressed={isOffered}
                                aria-label={`Offer size ${sz}`}
                                className={`px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                                  isOffered
                                    ? 'bg-hiraya-accent border-hiraya-accent text-hiraya-on-accent'
                                    : 'bg-cream-50/70 border-hiraya-structure-line text-hiraya-ink-muted hover:border-hiraya-accent/40'
                                }`}
                              >
                                {isOffered ? 'Yes' : 'No'}
                              </button>
                            </div>

                            {/* Mobile stock input — the same control, below the
                                row, because a 5rem column does not fit next to
                                the label on a phone. */}
                            {isOffered && (
                              <div className="col-span-2 sm:hidden flex items-center gap-2 pt-1 pb-0.5">
                                <span className="text-[9px] uppercase tracking-wider text-hiraya-ink-muted font-bold">Stock</span>
                                <input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  aria-label={`Stock for size ${sz}`}
                                  value={qty}
                                  onChange={(e) => handleSizeStockChange(sz, e.target.value)}
                                  className={`w-20 text-center text-[11px] tabular-nums py-1 rounded-md border focus:outline-none focus:border-hiraya-accent ${
                                    isEmpty
                                      ? 'bg-amber-500/10 border-amber-600/40 text-amber-800'
                                      : 'bg-cream-200/55 border-hiraya-structure-line text-hiraya-ink'
                                  }`}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* BULK — now it states its scope. */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-hiraya-structure-line/80">
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        placeholder="Qty"
                        value={bulkStock}
                        onChange={(e) => setBulkStock(e.target.value)}
                        className="w-20 bg-cream-200/55 border border-hiraya-ink/10 shadow-neu-inset rounded-lg px-2 py-1.5 text-xs text-hiraya-ink focus:outline-none focus:border-hiraya-accent"
                      />
                      <button
                        type="button"
                        onClick={handleApplyBulkStock}
                        disabled={bulkStock === ''}
                        className="px-3 py-1.5 bg-hiraya-accent hover:bg-hiraya-gold-deep text-hiraya-on-accent font-bold uppercase rounded-lg text-[9px] tracking-wider transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed"
                      >
                        Set all offered
                      </button>
                      {/*
                       * The scope is stated in words, because it is a decision
                       * with consequences: pressing this with nothing ticked
                       * writes the number into all six sizes.
                       */}
                      <span className="text-[9px] text-hiraya-ink-muted leading-snug">
                        {offeredCount === 0
                          ? 'No sizes offered yet — this will turn on all six.'
                          : `Applies to ${offeredCount} offered size${offeredCount !== 1 ? 's' : ''}.`}
                      </span>
                    </div>
                  </div>

              {saveError && (
                <div className="p-3 bg-red-500/12 border-red-600/40 rounded-xl">
                  <p className="text-[11px] text-red-700">{saveError}</p>
                </div>
              )}

              {/* FORM ACTIONS */}
              <div className="pt-3 flex justify-end gap-2 border-t border-hiraya-structure-line/80 shrink-0">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-hiraya-ink hover:text-hiraya-ink rounded-xl disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isAnalyzingImage}
                  className="px-5 py-2.5 bg-hiraya-accent hover:bg-hiraya-gold-deep text-hiraya-on-accent font-bold uppercase rounded-xl flex items-center gap-2 disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none transition cursor-pointer"
                >
                  {(isSubmitting || isAnalyzingImage) && <Loader2 size={14} className="animate-spin" />}
                  {isApplyingTheme
                    ? 'Applying background…'
                    : editingId ? 'Update Product' : 'Save Product'}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

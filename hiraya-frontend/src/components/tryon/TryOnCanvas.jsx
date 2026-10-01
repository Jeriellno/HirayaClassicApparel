import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Layers, Camera, Loader2, Download, ImageIcon, Wand2, ShieldCheck, AlertTriangle, Info, XCircle,
  ChevronDown, RefreshCw, Share2, ShoppingBag, Check, Square, Trash2, MinusCircle, History,
} from 'lucide-react';
import { PhotoGuide } from './PhotoGuide';

/**
 * Phase thresholds kept ONLY as a progress read-out.
 *
 * The literal sentences that used to sit under the bar ("Reading your full-body
 * frame”¦", "Your photo stays as the base · ”¦") have been REMOVED from the
 * generating overlay per the requested UX: while a render is running the
 * customer should see the LOADING indicator and the Stop control, nothing else.
 *
 * The array is retained (and still exported to nobody) because the percentage
 * itself is still shown next to the bar; deleting it would leave a magic number
 * with no explanation of the thresholds the backend reports.
 */
const PHASE_LABELS = [
  { at: 0,   label: 'Reading your full-body frame…' },
  { at: 30,  label: 'Matching garments to your body regions…' },
  { at: 55,  label: 'Attaching top, bottom and footwear…' },
  { at: 80,  label: 'Blending fabric edges and shadows…' },
  { at: 100, label: 'Finalising your fitting…' },
];

const phaseLabelFor = (progress) => {
  let label = PHASE_LABELS[0].label;
  for (const phase of PHASE_LABELS) {
    if (progress >= phase.at) label = phase.label;
  }
  return label;
};

export const TryOnCanvas = ({
  selectedGarments,
  userPhotoPreview,
  generatedImage,
  isGenerating,
  canGenerate,
  onPhotoUpload,
  onGenerate,
  /*
   * STOP an in-flight render. The customer keeps their photo and their stack —
   * only the running render is abandoned.
   */
  onCancel = null,
  /*
   * Remove the body photo. Clears ONLY the portrait; the Style Stack is left
   * intact (it has its own Clear in the left panel).
   */
  onRemovePhoto = null,
  /*
   * THE CUSTOMER'S SIZING PROFILE — two size labels (upper_body_size /
   * lower_body_size). This replaced the five centimetre measurements, and the
   * canvas reads them only to caption the render honestly. It never asks the
   * customer to type a number.
   */
  bodySizes = {},
  measurements = null,
  // Live pipeline telemetry from useTryOnState
  tryOnStatus = null,
  tryOnProgress = 0,
  tryOnError = null,
  recommendedSize = null,
  aiFeedback = null,
  /*
   * RETAINED FOR CALLER COMPATIBILITY, NO LONGER READ.
   *
   * `renderEngine` used to switch the badge/labels between an AI render and a
   * local composite. The composite engine was removed, so every render is 'ai'
   * and the canvas no longer branches on it. `fitDiagnostics` described how the
   * local compositor derived the fit and drove two overlay chips that are also
   * gone. Both props are still accepted (and ignored) so the existing callers in
   * AiTryOn.jsx / AITryOnSection.jsx do not need to change.
   */
  renderEngine = null,
  /* Body regions the last render actually dressed, e.g. ['top','bottom']. */
  placedRegions = [],
  fitDiagnostics = null,
  /*
   * FIT CHECK — the advisory verdict from utils/fitCheck.js.
   * Shape: { status: 'pass'|'warn'|'block', counts, items: [{id,label,status,detail,...}] } | null
   * It ADVISES, it never gates: it is shown alongside the render, and the
   * render is never withheld because of it.
   */
  fitCheck = null,
  /*
   * Non-fatal input-quality notice from useTryOnState: set when the last
   * dispatched render sent a garment that is NOT a clean transparent cut-out
   * (no ghost-mannequin matte; segmentation fell back to the composed card).
   * Shape: { count, names: string[], reasons: string[] } | null
   */
  vtonAssetWarning = null,
  /*
   * BODY-PHOTO VERIFICATION from the upload (see photoVerification in
   * useTryOnState). Drives the small top-left indicator so a photo that cannot
   * produce a good fitting is caught BEFORE a render is spent on it.
   * Shape: { status: 'checking'|'ready'|'warn', figureType, notes } | null
   */
  photoVerification = null,
  /*
   * WHY THE PHOTO WAS REFUSED: { reason, detail, evidence } | null.
   *
   * Non-null means the upload was GATED — it never reached the canvas and no
   * background was removed from it. The canvas shows this explanation instead of a
   * preview, because a photo that could not be verified as a full-body person must
   * not be shown as if it were one (see handlePhotoUpload in useTryOnState).
   */
  photoRejection = null,
  onRetry = null,
  onProceedToCheckout = null,
  onAddWornToBag = null,
  /*
   * TRY-ON HISTORY. Opens the Studio's history drawer from the canvas header;
   * `newLooks` counts renders saved since the drawer was last opened, shown
   * as a small badge so the customer knows the fit they just made is kept.
   */
  onOpenHistory = null,
  newLooks = 0,
}) => {
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const [shareState, setShareState] = useState(null);    // null | 'copied' | 'failed'
  const [checkoutState, setCheckoutState] = useState(null); // null | 'working'
  const [addBagState, setAddBagState] = useState(null);     // null | 'working' | 'done'
  /*
   * The fit-check panel starts COLLAPSED so it never covers the render.
   *
   * It stays collapsed for `pass` AND for `warn`. A `warn` is the NORMAL case on
   * this engine — an unreadable background, an unread posture, a product with no
   * size chart and a missing measurement all report `warn` — so opening on
   * `warn` would leave the list open for almost every customer and cover the
   * very render it is describing. The header already carries the signal that
   * something was flagged ("Fit check: 3 notes"), so nothing is hidden silently.
   *
   * `block` is the one verdict that earns an automatic open: it means the size
   * could not be checked against the customer AT ALL (no sizes on file),
   * which is not a note to be discovered by clicking — it is the answer to the
   * question they came for. See the syncing effect below.
   */
  const [fitOpen, setFitOpen] = useState(false);

  const wornGarments = Object.values(selectedGarments || {}).filter(Boolean);
  const hasError = tryOnStatus === 'failed' && !!tryOnError;
  const progress = Math.min(100, Math.max(0, Number(tryOnProgress) || 0));

  /*
   * PHOTO VERIFICATION PRESENTATION.
   *
   * Four states, one chip:
   *   checking   — a small spinner while the silhouette is analysed
   *   ready      — a quiet green tick: the outline WAS measured, full figure
   *   unmeasured — NEUTRAL: the outline could not be read. This is the common state
   *                for a normal JPEG, and it is deliberately NOT a warning —
   *                nothing is wrong with the photo, there is simply nothing to
   *                measure against yet (see the note in useTryOnState).
   *   warn       — amber: the outline WAS measured and found wanting
   *                (a head-and-shoulders crop, or no person in the frame).
   *
   * It is shown ONLY when a photo exists and no render landed. Once a result
   * is on the canvas the chip has served its purpose and would compete with the
   * render's own badges, so the result view takes over.
   */
  const SHOW_PHOTO_CHECK =
    !!userPhotoPreview && !generatedImage && !isGenerating && !!photoVerification;
  const photoCheckState = photoVerification?.status || null;

  /*
   * The chip now lives on the BLACK canvas well, so its states are painted for a
   * dark ground. Previously they used `bg-hiraya-peach` / dark ink pairs that
   * only made sense while the well was a pale gradient; on black they read as
   * pale blobs with washed-out labels.
   */
  const PHOTO_CHECK_STYLES = {
    checking:   { ring: 'border-hiraya-nav-ink/20 bg-black/60', text: 'text-hiraya-nav-ink', label: 'Checking photo…' },
    ready:      { ring: 'border-emerald-500/45 bg-emerald-500/15', text: 'text-emerald-300', label: 'Photo looks good' },
    unmeasured: { ring: 'border-hiraya-nav-ink/20 bg-black/60', text: 'text-hiraya-nav-muted', label: 'Fit not measured' },
    warn:       { ring: 'border-amber-500/45 bg-amber-500/15', text: 'text-amber-300', label: 'Photo may limit the fit' },
  };
  const photoCheckStyle = PHOTO_CHECK_STYLES[photoCheckState] || null;

  /*
   * WHY THE PHOTO WAS FLAGGED.
   *
   * The chip is a fixed-width pill, so it can only carry a four-word label. On a
   * `warn` the customer needs the REASON next to their own picture — "Photo may
   * limit the fit" alone leaves them guessing at what to change (framing? light?
   * a different photo entirely?). The pose check already writes a plain-language
   * sentence, so we surface it as the hover/focus tooltip rather than inventing
   * second-hand copy here.
   */
  const photoCheckReason = (photoVerification?.notes || []).find((n) => n?.id === 'pose')?.detail || null;

  /*
   * FIT CHECK PRESENTATION.
   *
   * The colours and headline copy are driven by the folded status, so the whole
   * panel reads the same whether one item warned or five did. `pass` shows a
   * single calm green chip; anything worse shows the amber/red header plus its
   * detail lines. Nothing here ever hides the render.
   */
  const fitStatus = fitCheck?.status || null;
  const fitItems = Array.isArray(fitCheck?.items) ? fitCheck.items : [];
  const fitIssues = fitItems.filter((i) => i.status !== 'pass');
  const FIT_STYLES = {
    pass: { ring: 'border-emerald-500/45', text: 'text-emerald-300', Icon: ShieldCheck, label: 'Fit check passed' },
    warn: { ring: 'border-amber-500/45', text: 'text-amber-300', Icon: AlertTriangle, label: 'Fit check issued warnings' },
    block: { ring: 'border-red-600/50', text: 'text-red-400', Icon: XCircle, label: 'Fit check could not confirm the size' },
  };
  const fitStyle = FIT_STYLES[fitStatus] || null;

  /*
   * AUTO-OPEN ON `block` ONLY.
   *
   * A `block` verdict means the size could not be checked against the customer
   * at all — they have no sizing profile on file. That is the direct answer
   * to "what size fits me", so leaving it behind a click would bury it. A
   * `warn` stays collapsed (see the note on `fitOpen` above).
   *
   * The effect re-runs on every new `fitCheck` object, so a RE-RENDER that
   * changes the verdict from `warn` to `block` opens the panel then, and one
   * that returns to `pass`/`warn` closes it again. It deliberately does NOT
   * write on every render: it only ever sets `true` for `block` and `false`
   * otherwise, so a customer who manually opens a `warn` list is not fought by
   * a state write on an unrelated re-render.
   */
  useEffect(() => {
    setFitOpen(fitStatus === 'block');
  }, [fitStatus]);

  const itemStyle = (status) =>
    status === 'pass'
      ? { text: 'text-emerald-300', Icon: ShieldCheck }
      : status === 'block'
        ? { text: 'text-red-400', Icon: XCircle }
        : { text: 'text-amber-300', Icon: AlertTriangle };

  /**
   * Save Render — forces a download of the Base64 data URI. An anchor with a
   * `download` attribute is used (rather than window.open) because data URIs
   * are treated as same-origin and therefore actually trigger the save dialog.
   */
  const handleSaveRender = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.href = generatedImage;
    link.download = `Hiraya_Fitting_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /**
   * Share — uses the Web Share API where available (mobile / secure context),
   * with an image-clipboard fallback. Both paths are wrapped because sharing a
   * data URI can be rejected by the platform, and that must never throw into
   * the render tree.
   */
  const handleShare = async () => {
    if (!generatedImage) return;

    try {
      // Convert the data URI to a File so navigator.share can attach an image.
      const blob = await (await fetch(generatedImage)).blob();
      const file = new File([blob], 'Hiraya_Fitting.png', { type: blob.type || 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'My Hiraya AI Fitting',
          text: 'Rendered with the Hiraya Virtual Wardrobe.',
        });
        return;
      }

      throw new Error('Web Share unavailable');
    } catch {
      // Fallback: copy the rendered image itself to the clipboard.
      try {
        const blob = await (await fetch(generatedImage)).blob();
        await navigator.clipboard.write([
          new window.ClipboardItem({ [blob.type || 'image/png']: blob }),
        ]);
        setShareState('copied');
      } catch {
        setShareState('failed');
      } finally {
        setTimeout(() => setShareState(null), 2600);
      }
    }
  };

  /**
   * Add Worn Item to Bag — promotes the rendered look's garments into My Bag
   * WITHOUT navigating away, so the customer can keep styling. Pieces already
   * in the bag are skipped by the hook so this never doubles a quantity.
   */
  const handleAddWornToBag = async () => {
    if (addBagState === 'working' || wornGarments.length === 0) return;
    setAddBagState('working');

    try {
      if (typeof onAddWornToBag === 'function') {
        await onAddWornToBag();
      }
      setAddBagState('done');
    } catch {
      setAddBagState(null);
    } finally {
      // Reset the confirmation label so the button is reusable.
      setTimeout(() => setAddBagState((s) => (s === 'done' ? null : s)), 2600);
    }
  };

  /**
   * Proceed to Checkout — promotes the worn pieces into My Bag via the hook,
   * then routes to the cart. Pieces already in the bag are skipped there so this
   * never doubles a quantity.
   */
  const handleProceedToCheckout = async () => {
    if (checkoutState === 'working') return;
    setCheckoutState('working');

    try {
      if (typeof onProceedToCheckout === 'function') {
        await onProceedToCheckout();
      }
      navigate('/cart');
    } finally {
      setCheckoutState(null);
    }
  };

  /*
   * A short, honest caption of the sizing the render was built from.
   *
   * It used to print the five typed centimetres ("C92/W70/H90cm"), which is
   * impossible now that nothing is typed: the numbers come from the size chart.
   * Naming the SIZE is both truthful and what the customer actually chose.
   */
  const frameLabel = bodySizes?.upper_body_size || bodySizes?.lower_body_size
    ? `Size ${bodySizes.upper_body_size || bodySizes.lower_body_size}`
    : 'No size set';

  return (
    <section className="flex min-h-[420px] flex-1 flex-col space-y-4">
      <div className="flex items-center justify-between">
        <span
          data-tour="fitting-canvas"
          className="flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm"><Layers size={14} /></span>
          Virtual Fitting Canvas
        </span>
        <div className="flex items-center gap-2 sm:gap-3">
          {onOpenHistory && (
            <button
              type="button"
              onClick={onOpenHistory}
              data-tour="history-toggle"
              aria-label={`Open try-on history${newLooks > 0 ? ` — ${newLooks} new` : ''}`}
              title="Try-On History"
              className="btn-secondary relative cursor-pointer rounded-full px-3 py-2.5 sm:px-4"
            >
              <History size={12} />
              <span className="hidden sm:inline">History</span>
              {newLooks > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-navy-900 px-1 text-[9px] font-semibold leading-none text-cream-100 ring-2 ring-hiraya-surface">
                  {newLooks}
                </span>
              )}
            </button>
          )}
          <input id="body-photo-input" type="file" className="hidden" ref={fileInputRef} onChange={onPhotoUpload} accept="image/*" />
          <button
            onClick={() => fileInputRef.current?.click()}
            data-tour="upload-photo"
            className="btn-secondary cursor-pointer rounded-full px-4 py-2.5"
          >
            <Camera size={12} />
            {userPhotoPreview ? 'Change Photo' : 'Upload Body Photo'}
          </button>
          {/*
            * REMOVE PHOTO — clears ONLY the body photo.
            *
            * This replaces the old "Clear Canvas", which called `clearAllStack`
            * and therefore wiped the customer's ENTIRE outfit as a side effect of
            * wanting a different portrait. Removing the photo now touches nothing
            * but the photo: the Style Stack survives, so a re-shoot does not cost
            * the customer their whole selection.
            *
            * Shown only when a photo exists, because there is nothing to remove
            * otherwise.
            */}
          {userPhotoPreview && (
            <button
              onClick={onRemovePhoto}
              disabled={!onRemovePhoto}
              className="btn-quiet cursor-pointer disabled:cursor-not-allowed"
            >
              <Trash2 size={11} /> Remove Photo
            </button>
          )}
        </div>
      </div>

      {/*
       * THE CANVAS WELL IS THE OBSIDIAN FRAME.
       *
       * It was `rounded-[2rem] border-hiraya-olive/15 bg-gradient-to-b
       * from-hiraya-bg via-black to-hiraya-bg` — a 32px radius plus a top and
       * bottom fade into the page colour, which made the well read as a soft
       * vignette rather than as a frame. Every render is letterboxed onto BLACK,
       * so the well is a flat black plate with the system hairline.
       */}
      <div className="relative isolate flex min-h-[360px] max-h-[calc(100vh-16rem)] flex-1 flex-col items-center justify-center overflow-hidden rounded-[28px] border border-cream-50/10 bg-noir shadow-[0_40px_80px_-40px_rgba(13,21,36,0.8)]">
        {/* The stage's light: a soft vignette and grain behind every state. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_50%_35%,rgba(40,58,87,0.45)_0%,transparent_65%)]" />
        <div aria-hidden="true" className="vintage-grain pointer-events-none absolute inset-0 -z-10 opacity-25 mix-blend-soft-light" />
        <AnimatePresence mode="wait">
          {/* Idle / pre-upload state */}
          {!generatedImage && !isGenerating && !hasError && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="relative flex h-full w-full items-center justify-center"
            >
              {/*
                * `object-contain`, NOT `object-cover`.
                *
                * `object-cover` crops the image to FILL the frame, so an upload
                * showed up zoomed-in with its edges cut off — the customer's own
                * photo looked cropped for no reason. `object-contain` fits the
                * WHOLE image inside the frame, so what they framed is what they see.
                */}
              {userPhotoPreview ? (
                <>
                  <img
                    src={userPhotoPreview}
                    alt="User Profile"
                    className="max-h-full w-full rounded-lg object-contain"
                  />

                  {/*
                   * PHOTO VERIFICATION CHIP — top-left, over the uploaded photo.
                   *
                   * Placed here (and not in the header row) so it is read in the
                   * same glance as the photo it describes, and so it never shifts
                   * the canvas layout when the state resolves.
                   *
                   * `pointer-events-none` keeps it from swallowing a tap meant for
                   * the photo underneath.
                   */}
                  {SHOW_PHOTO_CHECK && photoCheckStyle && (
                    <div
                      title={photoCheckReason || undefined}
                      className={[
                        'pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-1.5',
                        'rounded-full border px-3 py-1.5 backdrop-blur-md',
                        photoCheckStyle.ring,
                      ].join(' ')}
                    >
                      {photoCheckState === 'checking' ? (
                        <Loader2 size={11} className="animate-spin text-hiraya-nav-ink" />
                      ) : photoCheckState === 'ready' ? (
                        <ShieldCheck size={11} className={photoCheckStyle.text} />
                      ) : photoCheckState === 'unmeasured' ? (
                        /* A neutral dot, not a warning triangle: "no reading" is not
                         * the same claim as "something is wrong with your photo". */
                        <MinusCircle size={11} className={photoCheckStyle.text} />
                      ) : (
                        <AlertTriangle size={11} className={photoCheckStyle.text} />
                      )}
                      <span
                        className={[
                          'text-[9px] font-semibold uppercase tracking-[0.18em]',
                          photoCheckStyle.text,
                        ].join(' ')}
                      >
                        {photoCheckStyle.label}
                      </span>
                    </div>
                  )}
                </>
              ) : photoRejection ? (
                /*
                 * PHOTO REFUSED — THE GATE.
                 *
                 * The upload was rejected before any background removal, so there
                 * is nothing to preview and nothing to dress. We say exactly WHY in
                 * the check's own plain-language words, and point the customer back
                 * at the guide — an explanation plus a fix, never a silent shrug and
                 * never a confident render on a photo with no person in it.
                 */
                <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
                  <div className="flex flex-col items-center space-y-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-amber-600/40 bg-amber-500/15 text-amber-800">
                      <AlertTriangle size={24} />
                    </div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-800">
                      Photo not accepted
                    </p>
                    <p className="max-w-sm text-[11px] leading-relaxed text-hiraya-nav-muted">
                      {photoRejection.detail}
                    </p>
                    <button
                      type="button"
                      /*
                       * Re-open the canvas's OWN file input. Using the local ref
                       * rather than a document lookup keeps this working no matter
                       * where the canvas is mounted, and avoids an id that could
                       * collide if two canvases ever render.
                       */
                      onClick={() => fileInputRef.current?.click()}
                      className="btn-secondary mt-1 cursor-pointer rounded-full"
                    >
                      <Camera size={12} />
                      Upload a different photo
                    </button>
                  </div>
                  <PhotoGuide />
                </div>
              ) : (
                <div className="flex w-full flex-col items-center gap-5 px-6 py-8 text-center">
                  {/*
                    * THE UPLOAD ZONE — a frosted, dashed target on the dark
                    * stage. It opens the SAME file input as the header's
                    * "Upload Body Photo" button (the canvas's own ref), so it is
                    * a larger door to the existing step, not a new flow.
                    */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative flex w-full max-w-sm cursor-pointer flex-col items-center gap-4 rounded-[26px] border-2 border-dashed border-cream-50/20 bg-cream-50/[0.04] px-8 py-10 backdrop-blur-md transition-all duration-500 hover:border-cream-100/50 hover:bg-cream-50/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100"
                  >
                    <span className="relative flex h-20 w-20 items-center justify-center">
                      <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full border border-cream-100/25 [animation-duration:2.4s] motion-reduce:animate-none" />
                      <span aria-hidden="true" className="absolute inset-2 rounded-full border border-cream-100/15" />
                      <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-cream-100 text-navy-950 shadow-[0_14px_28px_-12px_rgba(0,0,0,0.8)] transition-transform duration-500 group-hover:scale-110">
                        <ImageIcon size={22} />
                      </span>
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cream-100">
                      Select garments &amp; upload a body photo
                    </span>
                    <span className="text-[11px] text-cream-300">Your AI fit render appears here</span>
                  </button>
                  {/*
                    * The guide sits at the moment of maximum relevance: the
                    * customer is looking at an empty canvas and about to take
                    * the photo. Showing it here prevents the bad upload instead
                    * of apologising for the bad render afterwards.
                    */}
                  <PhotoGuide />
                </div>
              )}
            </motion.div>
          )}

          {/*
           * GENERATING.
           *
           * The customer's ORIGINAL photo stays visible behind a light scrim, as
           * requested — the render is drawn ON TOP of that photo, so showing a
           * separate skeleton replaced their body with a placeholder and made the
           * wait feel like a different screen. A soft veil is enough to signal
           * "working" without hiding what is being worked on.
           *
           * LAYOUT NOTE — every overlay below carries `flex` AND `flex-col`.
           * `flex-col` alone only sets the flex DIRECTION; on a plain block box it
           * does nothing, so `items-center` / `justify-center` were ignored and
           * the loader + progress bar rendered pushed to the top-LEFT corner
           * instead of centred in the canvas. Two classes, not one.
           */}
          {isGenerating && (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-navy-950/40 backdrop-blur-[2px]"
            >
              {userPhotoPreview && (
                <img
                  src={userPhotoPreview}
                  alt="Your body photo"
                  className="absolute inset-0 h-full w-full rounded-lg object-contain opacity-35"
                />
              )}
              {/* A slow scan line over the photo while the render runs. */}
              <motion.div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-[12%] h-px bg-cream-100/70 shadow-[0_0_18px_4px_rgba(247,242,231,0.35)] motion-reduce:hidden"
                initial={{ top: '12%' }}
                animate={{ top: ['12%', '88%', '12%'] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              />

              {/**
                * LAYOUT — the loader stays centred; the StoP control drops to the
                * bottom of the canvas so the two never crowd each other.
                *
                * The progress rail is what carries the state now: the phase
                * sentences that used to sit under it were removed, so this panel
                * shows a spinner, the percentage, and a way out — nothing to read
                * while waiting.
                */}
              <div className="relative flex h-full w-full flex-col items-center justify-center gap-5">
                {/* A frosted dark pane: the progress ring and rail, on glass. */}
                <div className="glass-deep flex flex-col items-center gap-5 rounded-[26px] px-8 py-7">
                <div className="relative flex h-24 w-24 items-center justify-center">
                  <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
                    <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(247,242,231,0.14)" strokeWidth="5" />
                    <motion.circle
                      cx="50"
                      cy="50"
                      r="44"
                      fill="none"
                      stroke="#F7F2E7"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray="276.46"
                      initial={{ strokeDashoffset: 276.46 * 0.95 }}
                      animate={{ strokeDashoffset: 276.46 * (1 - progress / 100) }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </svg>
                  <span className="font-sans text-lg font-semibold tabular-nums text-cream-50">{progress}%</span>
                </div>

                {/* Cream progress rail driven by the live render status */}
                <div className="w-[260px] space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-hiraya-nav-ink/18">
                    <motion.div
                      className="h-full rounded-full bg-hiraya-accent"
                      initial={{ width: '5%' }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.18em]">
                    <span className="flex items-center gap-2 text-hiraya-nav-ink"><Loader2 size={11} className="animate-spin" /> Rendering your fitting</span>
                    <span className="text-hiraya-nav-muted">{progress}%</span>
                  </div>
                </div>
                </div>
              </div>

              {/**
                * STOP — pinned to the BOTTOM of the canvas rather than stacked
                * under the loader, so it reads as the way out of the panel instead
                * of one more item in the loading column.
                *
                * A render can run for up to a minute on the backend path, and the
                * customer keeps their photo and their stack: Stop abandons only
                * the running render.
                *
                * Hidden (rather than disabled) when no handler is supplied, so a
                * caller that cannot cancel never shows a dead control.
                */}
              {onCancel && (
                <div className="absolute inset-x-0 bottom-0 flex justify-center pb-8">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-nav-ink/25 bg-black/55 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-hiraya-nav-ink backdrop-blur-md transition-colors duration-200 hover:border-red-600/50 hover:text-red-300"
                  >
                    <Square size={11} className="fill-current" /> Stop
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {/* Failed — in-canvas recovery panel instead of a blocking alert() */}
          {hasError && !isGenerating && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
                className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 px-8 text-center backdrop-blur-md"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-400/30 bg-red-500/12">
                  <AlertTriangle size={24} className="text-red-400" />
                </div>

                <div className="max-w-md space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-400">
                    Fitting Interrupted
                  </p>
                  <p className="text-[11px] leading-relaxed text-hiraya-nav-muted">
                    {tryOnError?.message || 'The AI engine could not complete this render.'}
                  </p>
                  {tryOnError?.code && (
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-hiraya-nav-muted">
                      code: {tryOnError.code}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={onRetry}
                    disabled={!onRetry}
                    className="btn-primary cursor-pointer rounded-full"
                  >
                    <RefreshCw size={13} /> Retry Fitting
                  </button>
                  {/*
                   * START OVER — retry from a clean photo state.
                   *
                   * This used to call `onClearCanvas` (`clearAllStack`), which
                   * wiped the outfit AND the photo. It now removes only the photo,
                   * matching the header control and the customer's likely intent
                   * on a failed render: re-shoot, keeping the stack they built.
                   */}
                  <button
                    onClick={onRemovePhoto}
                    disabled={!onRemovePhoto}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-nav-ink/25 bg-transparent px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-hiraya-nav-ink transition-colors duration-200 hover:border-hiraya-nav-ink/50 disabled:cursor-not-allowed disabled:border-transparent disabled:text-hiraya-nav-muted"
                  >
                    Start Over
                  </button>
                </div>
            </motion.div>
          )}

          {/* Result — Save Render / Share / Proceed to Checkout */}
          {generatedImage && !isGenerating && !hasError && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="group absolute inset-0 z-40"
            >
              {/*
                * `object-contain` so the WHOLE render is visible.
                *
                * `object-cover` cropped/zoomed the result — a 576x864 AI render in
                * a taller frame had its top and bottom cut off, which read as a bad
                * fit when the fit was actually fine. Fit the frame instead of
                * filling it.
                */}
              <img
                src={generatedImage}
                alt="AI Fit Render"
                className="h-full w-full rounded-lg object-contain"
              />

              {/* Size chip extracted from the render feedback (SIZE: prefix). */}
              {recommendedSize && (
                <div className="absolute left-4 top-4 rounded-full border border-cream-50/60 bg-cream-50/85 px-4 py-1.5 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.7)] backdrop-blur-md">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">Size </span>
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-hiraya-accent">{recommendedSize}</span>
                </div>
              )}

              {/*
               * REGIONS ATTACHED — confirms exactly which body regions received
               * a garment, so the customer is never left guessing whether a
               * selected piece made it onto the render.
               */}
              {placedRegions.length > 0 && (
                <div className="absolute bottom-4 left-4 rounded-full border border-cream-50/15 bg-noir/55 px-3.5 py-1.5 backdrop-blur-md">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-hiraya-nav-muted">
                    Attached:{' '}
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-hiraya-nav-ink">
                    {placedRegions.join(' · ')}
                  </span>
                </div>
              )}

              {/*
                * FIT HONESTY CHIP (local renders only).
                *
                * States how the local composite derived the fit, so the customer
                * knows a pose-aware body-warp was used (posture read from their
                * own photo) rather than a flat overlay — and is told plainly when
                * the body could not be measured (an opaque JPEG) so an
                * approximation is never passed off as a measured fit.
                */}
              {/*
               * (A "Fit honesty" chip used to render here for local composites.
               *  It was removed with the composite engine — the AI render needs
               *  no such disclosure, and the Fit Check panel below already
               *  reports how the size was derived.)
               */}

              {/*
                * NOT-A-FULL-FIGURE NOTICE.
                *
                * When the engine measures that the uploaded portrait is a
                * head-and-shoulders crop (`figureType: 'bust'`), every full-length
                * piece is clamped to the visible figure rather than run past the
                * bottom of the frame. The customer is TOLD, because the shortened
                * hem is a limitation of the photo, not of the garment — a
                * full-length photo would fit it properly, and they can retake one.
                */}
              {/*
               * (The "Head-and-shoulders crop" notice was a local-composite
               *  limitation. The AI render deforms the garment to the actual
               *  figure, so it is no longer needed and was removed.)
               */}

              {/*
               * PROVENANCE BADGE.
               * A locally composited render must never be passed off as an
               * AI-generated fitting. This states plainly which one it is.
               */}
              <div
                className="absolute right-4 top-4 rounded-full border border-cream-50/15 bg-noir/55 px-3.5 py-1.5 text-hiraya-nav-ink backdrop-blur-md"
                title="Rendered by the AI try-on model (PixelAPI)."
              >
                <span className="text-[9px] font-semibold uppercase tracking-[0.18em]">
                  AI Render
                </span>
              </div>

              {/*
                * FIT CHECK PANEL.
                *
                * The advisory verdict (pose, posture, body-vs-garment size,
                 * garment data, body profile). It is ADVISORY ONLY: the render
                 * above is always shown, whatever this says.
                 *
                 * The panel is COLLAPSED by default for `pass` and `warn`, and
                 * auto-opens only for `block` (see the `fitOpen` effect). The
                 * header carries the count of flagged items, so a collapsed
                 * `warn` still tells the customer that something was noted
                 * without covering the render with a list they did not ask for.
                 *
                * Placed bottom-left so it does not fight the provenance badge
                * (top-right) or the bust-crop notice (top-left).
                */}
              {fitCheck && fitStyle && (
                <div
                  className={[
                    'absolute bottom-16 left-4 max-w-[75%] rounded-lg border bg-black/65 backdrop-blur-md',
                    fitStyle.ring,
                  ].join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => setFitOpen((v) => !v)}
                    aria-expanded={fitOpen}
                    className="flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left"
                  >
                    <fitStyle.Icon size={12} className={fitStyle.text} />
                    <span className={[
                      'text-[9px] font-semibold uppercase tracking-[0.18em]',
                      fitStyle.text,
                    ].join(' ')}>
                      {fitIssues.length > 0
                        ? `Fit check: ${fitIssues.length} note${fitIssues.length > 1 ? 's' : ''}`
                        : fitStyle.label}
                    </span>
                    <ChevronDown
                      size={11}
                      className={[
                        'ml-auto transition-transform duration-300',
                        fitStyle.text,
                        fitOpen ? 'rotate-180' : '',
                      ].join(' ')}
                    />
                  </button>

                  {fitOpen && (
                    <ul className="space-y-2 border-t border-hiraya-nav-ink/18 px-3 py-2.5">
                      {fitItems.map((it) => {
                        const s = itemStyle(it.status);
                        return (
                          <li key={it.id} className="flex gap-2">
                            <s.Icon size={11} className={['mt-0.5 shrink-0', s.text].join(' ')} />
                            <div>
                              <p className="text-[10px] font-semibold leading-tight text-hiraya-nav-ink">
                                {it.label}
                              </p>
                              <p className="mt-0.5 text-[9px] leading-snug text-hiraya-nav-muted">
                                {it.detail}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                      <li className="flex gap-1.5 pt-1 text-[8px] leading-snug text-hiraya-nav-muted">
                        <Info size={10} className="mt-0.5 shrink-0" />
                        These are guidance only — your fitting is shown above regardless.
                      </li>
                    </ul>
                  )}
                </div>
              )}

              {/*
               * THE ACTION BAR APPEARS ON HOVER / TAP OVER A SCRIM.
               *
               * The scrim was `bg-hiraya-olive/65` — a 65% INDIGO veil, which on
               * a render read as a blue cast over the whole fitting. It is now a
               * black veil, which is what this canvas uses everywhere else for
               * the letterboxing, so the overlay tints nothing.
               */}
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/70 px-6 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
                {aiFeedback && (
                  <p className="mb-1 max-w-sm text-center text-[10px] leading-relaxed text-hiraya-nav-ink">
                    {/* Strip the machine-readable SIZE: prefix + markdown bold. */}
                    {String(aiFeedback).replace(/SIZE:\s*[A-Z0-9]{1,4}\s*/i, '').replace(/\*\*/g, '').trim()}
                  </p>
                )}

                {/* Result action triggers: bag promotion, download, share, checkout. */}
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  {/*"Add Worn Item to Bag" — promotes the rendered look's pieces
                      into My Bag without leaving the Studio. */}
                  <button
                    onClick={handleAddWornToBag}
                    disabled={addBagState === 'working' || wornGarments.length === 0}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-nav-ink/30 bg-hiraya-nav-ink/10 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-nav-ink transition-colors hover:border-hiraya-accent hover:bg-hiraya-accent disabled:cursor-not-allowed disabled:border-transparent disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink"
                  >
                    {addBagState === 'working'
                      ? <Loader2 size={13} className="animate-spin" />
                      : addBagState === 'done'
                        ? <Check size={13} />
                        : <ShoppingBag size={13} />}
                    {addBagState === 'done' ? 'Added to Bag' : 'Add Worn Item to Bag'}
                  </button>

                  <button
                    onClick={handleSaveRender}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent transition-colors hover:bg-hiraya-accent-deep"
                  >
                    <Download size={13} /> Save Render
                  </button>

                  <button
                    onClick={handleShare}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-nav-ink/30 bg-hiraya-nav-ink/10 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-nav-ink transition-colors hover:border-hiraya-accent hover:bg-hiraya-accent"
                  >
                    {shareState === 'copied' ? <Check size={13} /> : <Share2 size={13} />}
                    {shareState === 'copied' ? 'Copied' : shareState === 'failed' ? 'Unavailable' : 'Share'}
                  </button>

                  <button
                    onClick={handleProceedToCheckout}
                    disabled={checkoutState === 'working' || wornGarments.length === 0}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent transition-colors hover:bg-hiraya-accent-deep disabled:cursor-not-allowed disabled:border-transparent disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink"
                  >
                    {checkoutState === 'working'
                      ? <Loader2 size={13} className="animate-spin" />
                      : <ShoppingBag size={13} />}
                    Proceed to Checkout
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/*
       * VTON INPUT QUALITY NOTICE.
       *
       * Shown when the render was dispatched with a garment that is not a clean
       * cut-out. The render still runs — this is deliberately a WARNING, not a
       * block — but the customer is told WHY the result may look off instead of
       * the pipeline silently handing the model a framed marketing card. The
       * real fix is to populate the product's try-on cut-out in the admin panel.
       */}
      {vtonAssetWarning && !isGenerating && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-600/40 bg-amber-500/15 px-4 py-3 text-left">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-800" />
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">
              Garment image not try-on ready
            </p>
            <p className="text-[11px] leading-relaxed text-amber-900">
              {vtonAssetWarning.count === 1
                ? '1 piece was sent without a clean cut-out:'
                : `${vtonAssetWarning.count} pieces were sent without a clean cut-out:`}{' '}
              <span className="font-semibold text-amber-800">{(vtonAssetWarning.names || []).join(', ')}</span>.
              {' '}The model may copy the shop background, framing or artwork. The fix is a
              ghost-mannequin cut-out on the product (admin → Try-on image).
            </p>
          </div>
        </div>
      )}

      {/**
        * THE GENERATE BUTTON IS THE SHARED PRIMARY PLATE.
        *
        * It was a 16px-radius button with a `shadow-xl` and a `text-hiraya-ink`
        * disabled label sitting on the disabled parchment fill. The shadow is
        * gone (this system carries depth with rules, not drop shadows) and the
        * radius is `rounded-lg`, matching every other action in the app.
        */}
      <button
        onClick={onGenerate}
        disabled={!canGenerate || isGenerating}
        data-tour="generate-fitting"
        className="btn-primary w-full rounded-full py-4 text-xs"
      >
        {isGenerating ? (
          <>
            <Loader2 size={15} className="animate-spin" /> Composing your fitting…
          </>
        ) : hasError ? (
          <>
            <RefreshCw size={15} /> Retry Virtual Fitting
          </>
        ) : (
          <>
            <Wand2 size={15} /> Generate Virtual Fitting
          </>
        )}
      </button>

      {/*
       * Actionable hint explaining a disabled Generate button.
       * The list is ordered the way the flow is actually meant to be done, with
       * the BODY PHOTO first — it is the canvas the garments are drawn onto.
       */}
      {!canGenerate && !isGenerating && !hasError && (
        <p className="text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink-muted">
          Required: 1) your full-body photo · 2) at least one garment from the stack
        </p>
      )}
    </section>
  );
};

export default TryOnCanvas;

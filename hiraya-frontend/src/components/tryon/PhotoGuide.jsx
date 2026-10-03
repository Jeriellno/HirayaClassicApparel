import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X, Camera } from 'lucide-react';

/**
 * PhotoGuide — the "ideal full-body photo" reference shown before an upload.
 *
 * WHY THIS EXISTS
 * ---------------
 * The fitting engine places every garment against a STANDING FULL FIGURE:
 * `bodyGeometry.GARMENT_SPANS` measures a dress as `toBelowShoulder: 0.86` and
 * FOOTWEAR as `fromShoulder: 0.94`, i.e. down 94% of a body height. Those
 * fractions are only meaningful if the subject is upright, head-toe and
 * standing square to the camera.
 *
 * The engine does what it can with a bad photo — `resolveGarmentBox()` clamps a
 * hem to `subjectBottom` rather than running fabric past the frame — but that is
 * RECOVERY, not a good result. The cheapest fix is upstream: tell the customer
 * what the engine assumes BEFORE they shoot.
 *
 * THE RULES HERE ARE DERIVED FROM THE CODE, NOT INVENTED.
 *   - "Stand straight, feet slightly apart" -> the leg-split classifier needs a
 *     visible gap (splitRatio >= 0.15) or it classifies the frame as a bust crop
 *     and clamps every full-length piece. Crossed legs close that gap.
 *   - "Arms away from the body" -> the width model measures the OUTER ARM
 *     ENVELOPE (bodyGeometry.js, the 0.85-1.35 clamp), so arms pressed to the
 *     torso under-report the silhouette.
 *   - "Plain background" -> `personMatte.js` is a saliency segmenter; a busy
 *     background competes with the subject for the mask.
 *   - "No watermark or text overlay" -> hard high-contrast texture is exactly
 *     what makes a saliency model lock onto the wrong region.
 *   - "Whole body in frame" -> `measureEnvelope()` reads `topRow`/`bottomRow`
 *     from the mask, and the shoulder line is derived from that span.
 */

/** What the engine needs. Kept short — five lines is the most anyone reads. */
const DO_RULES = [
  { title: 'Whole body in frame', detail: 'Head to feet, with a little space above and below.' },
  { title: 'Stand straight, facing the camera', detail: 'Feet slightly apart, arms a little away from your body.' },
  { title: 'Plain background, even light', detail: 'A clear wall and soft front light — no harsh shadows.' },
  { title: 'Wear fitted clothing', detail: 'So the garment follows your real body line.' },
];

/** What reliably breaks a render. */
const AVOID_RULES = [
  { title: 'Crossed legs or folded arms', detail: 'Long pieces render short and the waist is hidden.' },
  { title: 'Mirror selfies or tilted shots', detail: 'The fitting expects an upright, front-facing photo.' },
  { title: 'Busy backgrounds or crowds', detail: 'The cut-out may pick up furniture or other people.' },
  { title: 'Filters, text or stickers', detail: 'They can bleed into the rendered garment.' },
];

/**
 * @param {Object} [props]
 * @param {boolean} [props.defaultOpen] Let the caller decide whether the card
 *   starts expanded. Defaults to collapsed so it never pushes the empty-canvas
 *   prompt out of view on a first visit.
 */
// The JSDoc above is the contract. The codebase carries no PropTypes anywhere
// else, so a runtime check here would be the project's only one.
export const PhotoGuide = (
  // eslint-disable-next-line react/prop-types
  { defaultOpen = false }
) => {
  const [open, setOpen] = useState(defaultOpen);
  const closeRef = useRef(null);
  const triggerRef = useRef(null);

  /*
   * A MODAL, NOT AN ACCORDION — and it closes on Escape.
   *
   * The guide used to expand INLINE, inside the empty-canvas column. On a phone
   * that pushed the upload prompt off-screen and, once opened, the only way out
   * was to find the same small pill again and click it a second time. As an
   * overlay it has an explicit, always-visible X in the corner, and Escape does
   * the same thing for anyone on a keyboard.
   */
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    // Focus the close button, lock page scroll behind the sheet, and return
    // focus to the trigger on close.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const trigger = triggerRef.current;

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus?.();
    };
  }, [open]);

  /*
   * PORTALLED TO <body>. The guide used to render inside the canvas column,
   * whose transformed ancestors trap a `fixed` overlay — the sheet was clipped
   * and squeezed into the canvas. On <body> it is a true full-screen sheet.
   */
  const sheet = open ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="photo-guide-title"
      className="fixed inset-0 z-[120] flex items-end justify-center bg-hiraya-ink/60 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[24px] sm:max-h-[85vh] sm:rounded-[24px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-hiraya-structure-line px-5 pb-4 pt-5 sm:px-7">
          <div>
            <h2 id="photo-guide-title" className="font-serif text-xl leading-tight text-hiraya-ink sm:text-2xl">
              What makes a good photo?
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-hiraya-ink-muted">
              A clear, full-body photo gives the most accurate fitting.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the photo guide"
            className="btn-icon h-11 w-11 shrink-0 cursor-pointer rounded-full"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-7">
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl bg-emerald-500/[0.07] p-4 ring-1 ring-emerald-600/20">
              <h3 className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                <Check size={14} aria-hidden="true" /> Do
              </h3>
              <ul className="space-y-3">
                {DO_RULES.map((rule) => (
                  <li key={rule.title} className="flex gap-2.5">
                    <Check size={15} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                    <div>
                      <p className="text-[13px] font-semibold leading-snug text-hiraya-ink">{rule.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-hiraya-ink-muted">{rule.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl bg-red-500/[0.06] p-4 ring-1 ring-red-600/20">
              <h3 className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-red-700 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                <X size={14} aria-hidden="true" /> Avoid
              </h3>
              <ul className="space-y-3">
                {AVOID_RULES.map((rule) => (
                  <li key={rule.title} className="flex gap-2.5">
                    <X size={15} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
                    <div>
                      <p className="text-[13px] font-semibold leading-snug text-hiraya-ink">{rule.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-hiraya-ink-muted">{rule.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <figure className="mt-5 flex items-end justify-center gap-12">
            <div className="text-center">
              <svg viewBox="0 0 60 120" className="mx-auto h-24 w-auto text-emerald-600" role="img" aria-label="Ideal: standing straight, feet apart, arms away from the body">
                <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="30" cy="13" r="7.5" />
                  <path d="M30 20.5 V64 M22 28 H38 M22 28 L16 50 M38 28 L44 50 M30 64 L24 96 V112 L20 114 M30 64 L36 96 V112 L40 114" />
                </g>
              </svg>
              <figcaption className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-600">Ideal</figcaption>
            </div>
            <div className="text-center">
              <svg viewBox="0 0 60 120" className="mx-auto h-24 w-auto text-red-600" role="img" aria-label="Avoid: hands on hips and legs crossed">
                <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="30" cy="13" r="7.5" />
                  <path d="M30 20.5 V64 M22 28 H38 M22 28 L11 44 L26 60 M38 28 L49 44 L34 60 M30 64 L36 96 L37 112 L41 114 M30 64 L24 78 L40 94 L26 112 L22 114" />
                </g>
              </svg>
              <figcaption className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-600">Avoid</figcaption>
            </div>
          </figure>

          <p className="mt-4 text-center text-xs leading-relaxed text-hiraya-ink-muted">
            Your photo is used only for your fitting. Renders are private to your account.
          </p>
        </div>

        <div className="flex justify-end border-t border-hiraya-structure-line px-5 py-4 sm:px-7">
          <button type="button" onClick={() => setOpen(false)} className="btn-primary w-full cursor-pointer rounded-full sm:w-auto">
            Got it
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="w-full max-w-md text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="mx-auto flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-full border border-cream-50/60 bg-cream-50/90 px-4 py-2 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.7)] text-[10px] font-semibold uppercase tracking-[0.14em] text-hiraya-accent transition-colors duration-200 hover:bg-hiraya-accent hover:text-hiraya-on-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
      >
        <Camera size={12} />
        What makes a good photo?
      </button>

      {sheet && createPortal(sheet, document.body)}
    </div>
  );
};

export default PhotoGuide;

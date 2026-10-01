import { useEffect, useState } from 'react';
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
  {
    title: 'Stand straight, feet slightly apart',
    detail: 'The fitting reads the gap between your legs to confirm a full figure. Crossed or together legs make long pieces (dresses, bottoms) clamp short.',
  },
  {
    title: 'Face the camera, arms slightly away from your body',
    detail: 'A front-on pose with a clear silhouette lets the engine measure your true shoulder width.',
  },
  {
    title: 'Plain, uncluttered background',
    detail: 'A clean wall separates you from the background so the cut-out follows your body.',
  },
  {
    title: 'Good, even lighting — no harsh shadows',
    detail: 'Front-lit and shadow-free keeps fabric colours accurate in the render.',
  },
  {
    title: 'Whole body in frame, phone at chest height',
    detail: 'Head to feet, with a little space above and below, so nothing is cropped.',
  },
  {
    title: 'Wear fitted clothing',
    detail: 'Form-fitting pieces show your real body line under the garment you are trying on.',
  },
];

/** What reliably breaks a render. */
const AVOID_RULES = [
  {
    title: 'Crossed legs or legs together',
    detail: 'Closes the leg gap — the engine then treats your photo as a head-and-shoulders crop.',
  },
  {
    title: 'Hands on hips, or arms folded',
    detail: 'Hides your waist and hip line, so garments are sized from a guess.',
  },
  {
    title: 'Watermarks, text or stickers on the photo',
    detail: 'These are read as part of the image and can bleed into the rendered garment.',
  },
  {
    title: 'Mirror selfies, tilted or angled shots',
    detail: 'The pose model assumes an upright, front-facing frame.',
  },
  {
    title: 'Busy or patterned backgrounds',
    detail: 'The cut-out can grab wallpaper or furniture instead of you.',
  },
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

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="w-full max-w-md text-left">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="mx-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-cream-50/60 bg-cream-50/90 px-4 py-2 shadow-[0_8px_18px_-10px_rgba(0,0,0,0.7)] text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-accent transition-colors duration-200 hover:bg-hiraya-accent hover:text-hiraya-on-accent"
      >
        <Camera size={11} />
        What makes a good photo?
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="What makes a good photo"
          className="fixed inset-0 z-[80] flex items-center justify-center bg-hiraya-ink/55 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          {/*
            * `stopPropagation` so a click INSIDE the card does not close it — only
            * the backdrop, the X, or Escape do.
            *
            * The sheet itself was a 24px-radius cream slab with a coloured glow;
            * it is now the shared `.glass` pane (frosted vintage white, hairline,
            * near-square), which is the surface every other overlay in the system
            * is built on — and it keeps body copy at 11.9:1 over the scrim.
            */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass relative max-h-[85vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-7"
          >
            {/* CLOSE — the explicit exit the accordion never had. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the photo guide"
              className="btn-icon absolute right-4 top-4 h-9 w-9 cursor-pointer"
            >
              <X size={16} />
            </button>

            <h2 className="display-md mb-1 pr-12 text-hiraya-ink">
              What makes a good photo?
            </h2>
            <p className="mb-5 text-[11px] leading-relaxed text-hiraya-ink-muted">
              The fitting engine reads your whole standing figure. These are the
              things it measures — and the ones that break a render.
            </p>

            <div className="grid gap-5 sm:grid-cols-2">
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  <Check size={11} /> Ideal shot
                </h3>
                <ul className="space-y-2.5">
                  {DO_RULES.map((rule) => (
                    <li key={rule.title} className="flex gap-2">
                      <Check size={11} className="mt-0.5 shrink-0 text-emerald-700" />
                      <div>
                        <p className="text-[11px] font-semibold leading-tight text-hiraya-ink">
                          {rule.title}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-snug text-hiraya-ink-muted">
                          {rule.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-red-700">
                  <X size={11} /> Avoid
                </h3>
                <ul className="space-y-2.5">
                  {AVOID_RULES.map((rule) => (
                    <li key={rule.title} className="flex gap-2">
                      <X size={11} className="mt-0.5 shrink-0 text-red-700" />
                      <div>
                        <p className="text-[11px] font-semibold leading-tight text-hiraya-ink">
                          {rule.title}
                        </p>
                        <p className="mt-0.5 text-[10px] leading-snug text-hiraya-ink-muted">
                          {rule.detail}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/*
              * Silhouette reference. A guide drawing beats another paragraph of
              * prose: the whole failure mode is a POSE, and a pose is easiest to
              * copy from a picture than from a description.
              *
              * The two figures are drawn in the SEMANTIC verdict colours (emerald
              * for the ideal, red for the failure), not in brand tokens — they are
              * not decoration, they are a pass/fail key, so the universal
              * good/bad pair carries the meaning that a maroon/indigo pair could
              * not. Only the RULES between them moved onto the palette.
              */}
            <figure className="mt-5 flex items-center justify-center gap-10 border-t border-hiraya-structure-line pt-5">
              <div className="text-center">
                <svg viewBox="0 0 60 120" className="mx-auto h-28 w-auto" role="img" aria-label="Ideal: standing straight, feet apart, arms away from the body">
                  <path d="M5 28 H55" stroke="#6ee7b7" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.35" />
                  <path d="M30 3 V116" stroke="#6ee7b7" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.2" />

                  <circle cx="30" cy="13" r="7.5" fill="none" stroke="#6ee7b7" strokeWidth="1.6" />
                  <path d="M30 20.5 L30 26" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M30 26 L30 64" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M22 28 H38" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M22 28 L16 50" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M38 28 L44 50" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M30 64 L24 96" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M30 64 L36 96" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M24 96 V112" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M36 96 V112" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M24 112 L20 114" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M36 112 L40 114" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <figcaption className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-emerald-700/80">
                  Ideal
                </figcaption>
              </div>

              <div className="text-center">
                <svg viewBox="0 0 60 120" className="mx-auto h-28 w-auto" role="img" aria-label="Avoid: hands on hips and legs crossed">
                  <circle cx="30" cy="13" r="7.5" fill="none" stroke="#f87171" strokeWidth="1.6" />
                  <path d="M30 20.5 L30 26" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M30 26 L30 64" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M22 28 H38" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M22 28 L11 44 L26 60" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M38 28 L49 44 L34 60" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M30 64 L36 96 L37 112" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M30 64 L24 78 L40 94 L26 112" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                  <path d="M26 112 L22 114" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                  <path d="M37 112 L41 114" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <figcaption className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-red-700/80">
                  Avoid
                </figcaption>
              </div>
            </figure>

            <p className="mt-4 text-center text-[10px] leading-snug text-hiraya-ink-muted">
              Your photo is used only to place garments on your body. It is never shared.
            </p>

            {/* ONE OBVIOUS WAY OUT, at the end of the read. */}
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-primary cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PhotoGuide;

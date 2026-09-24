import { useState } from 'react';
import { Check, X, ChevronDown, Camera } from 'lucide-react';

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

  return (
    <div className="w-full max-w-md text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mx-auto flex items-center gap-1.5 rounded-full border-stone-300/15 bg-zinc-900/60 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-stone-300/80 transition-colors duration-200 hover:border-stone-300/40 hover:text-stone-200"
      >
        <Camera size={11} />
        What makes a good photo?
        <ChevronDown
          size={12}
          className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-2xl border-stone-300/10 bg-zinc-900/50 p-4 backdrop-blur-sm">
          {/*
            * Two columns on wider screens, stacked on narrow — the canvas panel
            * is already the middle column of a 3-column layout, so it runs out of
            * horizontal room quickly.
            */}
          <div className="grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400/90">
                <Check size={11} /> Ideal shot
              </h3>
              <ul className="space-y-2">
                {DO_RULES.map((rule) => (
                  <li key={rule.title} className="flex gap-2">
                    <Check size={11} className="mt-0.5 shrink-0 text-emerald-400/80" />
                    <div>
                      <p className="text-[10px] font-semibold leading-tight text-stone-200">
                        {rule.title}
                      </p>
                      <p className="mt-0.5 text-[9px] leading-snug text-zinc-500">
                        {rule.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-red-400/90">
                <X size={11} /> Avoid
              </h3>
              <ul className="space-y-2">
                {AVOID_RULES.map((rule) => (
                  <li key={rule.title} className="flex gap-2">
                    <X size={11} className="mt-0.5 shrink-0 text-red-400/80" />
                    <div>
                      <p className="text-[10px] font-semibold leading-tight text-stone-200">
                        {rule.title}
                      </p>
                      <p className="mt-0.5 text-[9px] leading-snug text-zinc-500">
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
            * Drawn as inline SVG rather than a raster asset so it inherits the
            * theme colours and stays crisp at any size.
            */}
          <figure className="flex items-center justify-center gap-6 border-t border-stone-300/10 pt-3">
            {/*
              * IDEAL — front-on, legs apart, arms clear of the torso.
              *
              * The dotted guides mark the two things the engine actually keys
              * off: the SHOULDER LINE (`shoulderFraction` in bodyGeometry.js) and
              * the vertical centre it fits the torso to. Keeping them explains
              * WHY the pose matters instead of just asserting it.
              */}
            <div className="text-center">
              <svg viewBox="0 0 60 120" className="mx-auto h-24 w-auto" role="img" aria-label="Ideal: standing straight, feet apart, arms away from the body">
                {/* Shoulder line + centre axis, drawn behind the figure. */}
                <path d="M5 28 H55" stroke="#6ee7b7" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.35" />
                <path d="M30 3 V116" stroke="#6ee7b7" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.2" />

                <circle cx="30" cy="13" r="7.5" fill="none" stroke="#6ee7b7" strokeWidth="1.6" />
                {/* Neck + torso, with the waist pinch that makes a silhouette readable. */}
                <path d="M30 20.5 L30 26" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M30 26 L30 64" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                {/* Shoulders: a short level segment, then arms angled AWAY from the body. */}
                <path d="M22 28 H38" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M22 28 L16 50" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M38 28 L44 50" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                {/* Legs apart: a visible gap the leg-split classifier can read. */}
                <path d="M30 64 L24 96" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M30 64 L36 96" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M24 96 V112" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M36 96 V112" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                {/* Feet, angled outward. */}
                <path d="M24 112 L20 114" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M36 112 L40 114" stroke="#6ee7b7" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <figcaption className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-emerald-400/80">
                Ideal
              </figcaption>
            </div>

            {/*
              * AVOID — hands on hips (elbows jutting out, waist line lost) and
              * one leg crossed IN FRONT of the other.
              *
              * The previous version drew both legs through the SAME two
              * midpoints (24,92) and (36,92), so they collapsed into an
              * unreadable knot — a scribble, not a crossed-leg pose. Here the
              * crossing leg is a single unbroken line that travels from the hip
              * ACROSS the midline to the opposite foot, so the crossing is the
              * one obvious feature of the drawing.
              */}
            <div className="text-center">
              <svg viewBox="0 0 60 120" className="mx-auto h-24 w-auto" role="img" aria-label="Avoid: hands on hips and legs crossed">
                <circle cx="30" cy="13" r="7.5" fill="none" stroke="#f87171" strokeWidth="1.6" />
                <path d="M30 20.5 L30 26" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M30 26 L30 64" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />

                {/* Shoulders, then elbows jutting OUT and hands landing on the hips. */}
                <path d="M22 28 H38" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M22 28 L11 44 L26 60" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d="M38 28 L49 44 L34 60" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />

                {/* Standing leg drops straight to its own foot. */}
                <path d="M30 64 L36 96 L37 112" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                {/* Crossing leg: one continuous line from the hip, over the
                    midline, to the opposite side — the leg gap is closed. */}
                <path d="M30 64 L24 78 L40 94 L26 112" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                {/* Feet overlapping, so the base reads as a single mass. */}
                <path d="M26 112 L22 114" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M37 112 L41 114" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              <figcaption className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-red-400/80">
                Avoid
              </figcaption>
            </div>
          </figure>

          <p className="text-center text-[9px] leading-snug text-zinc-600">
            Your photo is used only to place garments on your body. It is never shared.
          </p>
        </div>
      )}
    </div>
  );
};

export default PhotoGuide;

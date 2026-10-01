import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Check, Loader2 } from 'lucide-react';

/**
 * AUTO-FILL PROGRESS — keeps the AI auto-fill from LOOKING stuck.
 *
 * WHY IT LOOKED FROZEN
 * --------------------
 * The background-removal engine reports progress per PHASE (each model file it
 * downloads, then decode / inference / mask), and the fraction restarts at 0
 * for every phase. The old button showed that raw number, so it jumped
 * 100% -> 3% -> 100%, then sat on one value through the whole inference — which
 * runs on the CPU, blocks the main thread, and reports almost nothing. On
 * screen that is indistinguishable from a hang.
 *
 * WHAT THIS DOES INSTEAD (presentation only — the pipeline is unchanged)
 * ---------------------------------------------------------------------
 *  1. A step list, so the admin sees which step is running and which are done
 *     (the details are already filled in before the cut-out even starts).
 *  2. ONE overall bar that only ever moves forward. Each stage owns a slice of
 *     it; inside a slice the real engine fraction is used when there is one,
 *     and a slow, never-finishing creep fills the silent stretches.
 *  3. A CSS shimmer on the bar. CSS transform animations run on the
 *     compositor thread, so it keeps moving even while inference blocks the
 *     main thread — the one thing JavaScript-driven UI cannot do.
 *  4. An elapsed-time counter and a hint that changes as the wait grows, so a
 *     long first run (model download) reads as "working", not "broken".
 */

/** Slice of the overall bar each stage owns, as [start, end] percent. */
const STAGE_RANGE = {
  reading: [0, 8],
  analyzing: [8, 35],
  cutting: [35, 96],
};

const STEPS = [
  { key: 'reading', label: 'Reading the photo' },
  { key: 'analyzing', label: 'AI is filling in the details' },
  { key: 'cutting', label: 'Removing the background' },
];

const ORDER = ['reading', 'analyzing', 'cutting', 'done'];

/** What the engine is doing right now, in words, from its phase key. */
const phaseLabel = (phase) => {
  const key = String(phase || '');
  if (key.startsWith('fetch')) return 'Downloading the AI model (first run only)';
  if (key.includes('decode')) return 'Preparing the image';
  if (key.includes('inference')) return 'Cutting the garment out';
  if (key.includes('mask') || key.includes('encode')) return 'Finishing the cut-out';
  return 'Starting the background remover';
};

/** Reassurance that grows with the wait. */
const hintFor = (stage, seconds) => {
  if (stage !== 'cutting') return 'This usually takes a few seconds.';
  if (seconds < 20) return 'You can keep editing the details while this runs.';
  if (seconds < 60) return 'Still working. The first run downloads the AI model, so it takes longer.';
  if (seconds < 120) return 'Still working. Large or busy photos take more time to cut out.';
  return 'Almost there. If it fails, the original photo is kept and you can retry.';
};

/**
 * Where inside a cut-out stage the engine is, 0..1, from its phase + fraction.
 * The model download gets the first 40% of the slice, inference the rest.
 */
const cuttingFraction = (phase, fraction) => {
  const key = String(phase || '');
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  if (key.startsWith('fetch')) return 0.4 * f;
  if (key.includes('decode')) return 0.4 + 0.1 * f;
  if (key.includes('inference')) return 0.5 + 0.35 * f;
  if (key.includes('mask') || key.includes('encode')) return 0.85 + 0.15 * f;
  return 0;
};

const AutoFillProgress = ({ stage, cutFraction = 0, cutPhase = '' }) => {
  const [now, setNow] = useState(() => Date.now());
  const startedAtRef = useRef(Date.now());
  const stageStartedAtRef = useRef({ stage, at: Date.now() });
  const shownRef = useRef(0);

  if (stageStartedAtRef.current.stage !== stage) {
    stageStartedAtRef.current = { stage, at: Date.now() };
  }

  // One tick a second drives the elapsed counter and the creep.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Math.max(0, Math.round((now - startedAtRef.current) / 1000));
  const inStage = Math.max(0, (now - stageStartedAtRef.current.at) / 1000);

  // Overall percent: the stage's slice, filled by real progress or the creep.
  const [from, to] = STAGE_RANGE[stage] || [96, 100];
  const real = stage === 'cutting' ? cuttingFraction(cutPhase, cutFraction) : 0;
  // Approaches 90% of the slice and never reaches it: always moving, never "done".
  const creep = 0.9 * (1 - Math.exp(-inStage / (stage === 'cutting' ? 45 : 6)));
  const target = from + (to - from) * Math.max(real, creep);
  // Never move backwards, even when the engine's own fraction restarts.
  shownRef.current = Math.max(shownRef.current, target);
  const percent = Math.min(99, Math.round(shownRef.current));

  const stageIndex = ORDER.indexOf(stage);

  return (
    <div
      className="rounded-xl border border-charcoal-300/70 bg-charcoal-100/60 p-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-charcoal-800">
        <span>AI auto-fill in progress</span>
        <span className="tabular-nums text-charcoal-600">{percent}% · {elapsed}s</span>
      </div>

      {/* The bar: a real, forward-only fill plus a CSS shimmer that keeps
          moving while the main thread is busy. */}
      <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-charcoal-200/80">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-hiraya-accent transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
        <div className="progress-indeterminate absolute inset-0 opacity-70 after:!bg-cream-50/60" aria-hidden="true" />
      </div>

      <ol className="mt-3 space-y-1.5">
        {STEPS.map((step, index) => {
          const done = stageIndex > index;
          const active = stageIndex === index;
          return (
            <li
              key={step.key}
              className={`flex items-center gap-2 text-[11px] ${done ? 'text-emerald-700' : active ? 'text-charcoal-800 font-semibold' : 'text-charcoal-500'}`}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {done ? (
                  <Check size={13} />
                ) : active ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />
                )}
              </span>
              <span className="min-w-0">
                {step.label}
                {done && step.key === 'analyzing' && (
                  <span className="font-normal text-charcoal-600"> (details filled in)</span>
                )}
                {active && step.key === 'cutting' && (
                  <span className="block text-[10px] font-normal text-charcoal-600">{phaseLabel(cutPhase)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-2.5 text-[10px] leading-snug text-charcoal-600">{hintFor(stage, inStage)}</p>
    </div>
  );
};

AutoFillProgress.propTypes = {
  stage: PropTypes.string,
  cutFraction: PropTypes.number,
  cutPhase: PropTypes.string,
};

export default AutoFillProgress;

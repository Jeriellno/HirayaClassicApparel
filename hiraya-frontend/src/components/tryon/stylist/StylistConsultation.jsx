import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Sparkles, X, Check, ArrowLeft, ArrowRight, Loader2, ScanLine,
  Coffee, Briefcase, Gem, Flower2, Sun, Zap, Shirt, Venus, Mars, VenusAndMars,
} from 'lucide-react';
import PhotoScan from './PhotoScan';
import { DUR, enter, leave, spring, stagger } from '../../../utils/motion';

/*
 * STYLIST CONSULTATION — card 1 of the AI Stylist (replaces the plain modal).
 *
 * Left: the customer's photo with the live scan (PhotoScan), so they watch the
 * stylist read it. Right: three one-tap steps — Palette, Occasion, Collection —
 * that slide in turn and advance on their own after a tap. The palette the
 * photo suggests carries an "AI pick" badge for the customer to CONFIRM or
 * change: the AI describes, the customer decides. Back and the step tabs let
 * them revisit any answer; "Show my looks" sends all three.
 *
 * Phones: a bottom sheet with the scan as a strip on top.
 */

const PALETTES = {
  warm: { label: 'Warm', swatches: ['#C9A66B', '#8A5A3B', '#F1E6D2', '#556B2F'] },
  cool: { label: 'Cool', swatches: ['#2E4A7D', '#6B5B95', '#D7DCE6', '#2F6F6B'] },
  neutral: { label: 'Neutral', swatches: ['#1E2A44', '#F4F1EA', '#8A8D91', '#1F2430'] },
};

const OCCASION_META = {
  everyday: { Icon: Coffee, hint: 'Errands, lunches, weekends' },
  business: { Icon: Briefcase, hint: 'Work days and meetings' },
  formal: { Icon: Gem, hint: 'Weddings, galas, evening events' },
  cultural: { Icon: Flower2, hint: 'Barong, Filipiniana, heritage days' },
  summer: { Icon: Sun, hint: 'Beach trips and hot days' },
  streetwear: { Icon: Zap, hint: 'Relaxed city style' },
};

const FALLBACK_OCCASIONS = [
  { key: 'everyday', label: 'Everyday' },
  { key: 'business', label: 'Office' },
  { key: 'formal', label: 'Formal' },
  { key: 'cultural', label: 'Filipiniana' },
  { key: 'summer', label: 'Summer' },
  { key: 'streetwear', label: 'Streetwear' },
];

const PREFERENCES = [
  { value: 'womenswear', label: "Women's", Icon: Venus, hint: 'Dresses, blouses, skirts' },
  { value: 'menswear', label: "Men's", Icon: Mars, hint: 'Barong, polos, trousers' },
  { value: 'both', label: 'Both', Icon: VenusAndMars, hint: 'Every cut in your size' },
];

const STEPS = [
  { key: 'palette', label: 'Palette', title: 'Which colors suit you?' },
  { key: 'occasion', label: 'Occasion', title: 'Where are you wearing it?' },
  { key: 'collection', label: 'Collection', title: 'Which collection?' },
];

const ADVANCE_MS = 280;

const useNarrow = () => {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
};

/* One tappable answer. Variants let children (the swatch fan) react to hover. */
const OptionCard = ({ selected, onSelect, children, badge = null, className = '' }) => {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      initial={false}
      animate={selected ? 'active' : 'rest'}
      whileHover={reduce ? undefined : 'hover'}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      variants={{ rest: { y: 0 }, hover: { y: -2 }, active: { y: 0 } }}
      transition={spring(reduce)}
      className={[
        'relative flex min-h-[44px] w-full cursor-pointer rounded-2xl text-left transition-[box-shadow,background-color] duration-200',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus focus-visible:ring-offset-2 focus-visible:ring-offset-hiraya-surface-raised',
        selected
          ? 'bg-hiraya-surface shadow-neu-sm ring-2 ring-navy-800'
          : 'bg-hiraya-surface-sunken/60 ring-1 ring-hiraya-structure-line hover:ring-navy-600',
        className,
      ].join(' ')}
    >
      {children}
      {badge}
      <AnimatePresence>
        {selected && (
          <motion.span
            className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-cream-100"
            initial={reduce ? false : { scale: 0 }}
            animate={{ scale: 1, transition: spring(reduce) }}
            exit={{ scale: 0, transition: leave(reduce) }}
            aria-hidden="true"
          >
            <Check size={13} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
};

OptionCard.propTypes = {
  selected: PropTypes.bool,
  onSelect: PropTypes.func.isRequired,
  children: PropTypes.node,
  badge: PropTypes.node,
  className: PropTypes.string,
};

/* A fan of fabric swatches that opens on hover and when chosen. */
const SwatchFan = ({ colors }) => (
  <span className="relative mx-auto block h-14 w-24" aria-hidden="true">
    {colors.map((c, i) => {
      const offset = i - (colors.length - 1) / 2;
      return (
        <motion.span
          key={c}
          className="absolute bottom-0 left-1/2 -ml-3.5 h-12 w-7 rounded-md shadow-[0_4px_10px_rgba(13,21,36,0.25)] ring-1 ring-black/10"
          style={{ background: c, transformOrigin: '50% 100%' }}
          variants={{
            rest: { rotate: offset * 9 },
            hover: { rotate: offset * 20 },
            active: { rotate: offset * 20 },
          }}
        />
      );
    })}
  </span>
);

SwatchFan.propTypes = { colors: PropTypes.arrayOf(PropTypes.string).isRequired };

const AiBadge = ({ children }) => {
  const reduce = useReducedMotion();
  return (
    <motion.span
      className="absolute -top-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-navy-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-cream-100 shadow-[0_4px_10px_-4px_rgba(13,21,36,0.6)]"
      initial={reduce ? false : { scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, transition: spring(reduce, 0.1) }}
    >
      <ScanLine size={11} aria-hidden="true" /> {children}
    </motion.span>
  );
};

AiBadge.propTypes = { children: PropTypes.node };

const StylistConsultation = ({ open, onClose, onSubmit, analysis, answers, setAnswer, occasions, photoSrc }) => {
  const reduce = useReducedMotion();
  const narrow = useNarrow();
  const dialogRef = useRef(null);
  const panelRef = useRef(null);
  const advanceRef = useRef(null);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);

  const occasionList = occasions?.length ? occasions : FALLBACK_OCCASIONS;
  const detected = analysis?.result?.undertone || null;
  const confidence = analysis?.result?.confidence ?? null;
  const vibe = analysis?.result?.vibe || null;
  const reading = analysis?.status === 'processing';
  const shown = answers.undertone || detected;
  const last = STEPS.length - 1;

  const go = (next) => {
    clearTimeout(advanceRef.current);
    if (next === step || next < 0 || next > last) return;
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const pick = (key, value) => {
    setAnswer(key, value);
    if (step < last) {
      clearTimeout(advanceRef.current);
      advanceRef.current = setTimeout(() => {
        setDir(1);
        setStep((s) => Math.min(s + 1, last));
      }, ADVANCE_MS);
    }
  };

  // Every visit starts at step 1 (reset once the dialog has fully closed, so a
  // reopen never animates out of the last step); answers are kept.
  const resetSteps = () => {
    setStep(0);
    setDir(1);
  };
  useEffect(() => () => clearTimeout(advanceRef.current), [open]);

  // Move focus to the chosen (or first) answer of the step that just slid in.
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector('[aria-checked="true"]') || panel?.querySelector('[role="radio"]');
      target?.focus({ preventScroll: true });
    }, (reduce ? 0 : DUR.fast * 1000) + 60);
    return () => clearTimeout(t);
  }, [step, open, reduce]);

  // Trap Tab inside the dialog, close on Escape, give focus back on close.
  useEffect(() => {
    if (!open) return undefined;
    const node = dialogRef.current;
    const previous = document.activeElement;
    const focusables = () => Array.from(node?.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])') || []);
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        const list = focusables();
        if (list.length === 0) return;
        const first = list[0];
        const lastEl = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  const slide = {
    enter: (d) => (reduce ? { opacity: 0 } : { opacity: 0, x: d * 36 }),
    center: { opacity: 1, x: 0, transition: enter(reduce) },
    exit: (d) => (reduce ? { opacity: 0, transition: leave(reduce) } : { opacity: 0, x: d * -36, transition: leave(reduce) }),
  };

  const paletteNote = reading ? (
    <>
      <Loader2 size={15} className="animate-spin text-hiraya-accent" aria-hidden="true" />
      <span>Reading your photo…</span>
    </>
  ) : !shown ? (
    <span>Not sure from this photo — pick the one you like.</span>
  ) : answers.undertone && detected && answers.undertone !== detected ? (
    <span>You picked a different palette — that is fine.</span>
  ) : detected ? (
    <span>
      {confidence !== null && confidence < 0.6
        ? 'The lighting made this hard to read — check the pick.'
        : 'Your photo suggests this palette.'}
    </span>
  ) : (
    <span>Not sure from this photo — pick the one you like.</span>
  );

  const renderStep = () => {
    if (step === 0) {
      return (
        <>
          <div role="radiogroup" aria-label="Color palette" className="grid grid-cols-3 gap-3">
            {Object.entries(PALETTES).map(([key, p], i) => (
              <motion.div
                key={key}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: enter(reduce, { delay: stagger(i, 0.04, 0.05) }) }}
              >
                <OptionCard
                  selected={shown === key}
                  onSelect={() => pick('undertone', key)}
                  className="flex-col items-center gap-3 px-3 pb-3 pt-6"
                  badge={detected === key ? <AiBadge>AI pick</AiBadge> : null}
                >
                  <SwatchFan colors={p.swatches} />
                  <span className="text-sm font-semibold">{p.label}</span>
                </OptionCard>
              </motion.div>
            ))}
          </div>
          <p className="mt-4 flex min-h-[24px] items-center gap-2 text-sm text-hiraya-ink-muted" aria-live="polite">
            {paletteNote}
          </p>
        </>
      );
    }

    if (step === 1) {
      return (
        <div role="radiogroup" aria-label="Occasion" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {occasionList.map((o, i) => {
            const meta = OCCASION_META[o.key] || { Icon: Shirt, hint: '' };
            return (
              <motion.div
                key={o.key}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0, transition: enter(reduce, { delay: stagger(i, 0.03, 0.04) }) }}
              >
                <OptionCard
                  selected={answers.occasion === o.key}
                  onSelect={() => pick('occasion', o.key)}
                  className="h-full flex-col gap-1.5 p-3.5"
                  badge={vibe === o.key && answers.occasion !== o.key ? (
                    <span className="absolute -top-2.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-hiraya-accent-wash px-2 py-0.5 text-[10px] font-semibold text-hiraya-ink ring-1 ring-hiraya-structure-line">
                      <ScanLine size={11} aria-hidden="true" /> From your photo
                    </span>
                  ) : null}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-900 text-cream-100" aria-hidden="true">
                    <meta.Icon size={16} />
                  </span>
                  <span className="text-sm font-semibold">{o.label}</span>
                  {meta.hint && <span className="text-xs leading-snug text-hiraya-ink-muted">{meta.hint}</span>}
                </OptionCard>
              </motion.div>
            );
          })}
        </div>
      );
    }

    return (
      <>
        <div role="radiogroup" aria-label="Collection" className="grid grid-cols-3 gap-3">
          {PREFERENCES.map((p, i) => (
            <motion.div
              key={p.value}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: enter(reduce, { delay: stagger(i, 0.04, 0.05) }) }}
            >
              <OptionCard
                selected={answers.preference === p.value}
                onSelect={() => pick('preference', p.value)}
                className="h-full flex-col items-center gap-2 p-4 text-center"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-900 text-cream-100" aria-hidden="true">
                  <p.Icon size={20} />
                </span>
                <span className="text-sm font-semibold">{p.label}</span>
                <span className="hidden text-xs leading-snug text-hiraya-ink-muted sm:block">{p.hint}</span>
              </OptionCard>
            </motion.div>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-hiraya-ink-muted">
          Sizes are converted for you when you choose another cut.
        </p>
      </>
    );
  };

  return (
    <AnimatePresence onExitComplete={resetSteps}>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-navy-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: enter(reduce) }}
          exit={{ opacity: 0, transition: leave(reduce, 0.2) }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="stylist-consult-title"
            initial={reduce ? false : { opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: enter(reduce, { duration: DUR.slow }) }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 18, transition: leave(reduce, 0.18) }}
            className="flex max-h-[94vh] w-full max-w-[940px] flex-col overflow-hidden rounded-t-[28px] bg-hiraya-surface-raised text-hiraya-ink shadow-[0_30px_70px_-20px_rgba(13,21,36,0.55)] sm:rounded-[28px] md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          >
            {photoSrc && (
              <div className="h-44 shrink-0 p-2 pb-0 sm:h-52 md:h-auto md:min-h-[540px] md:p-3 md:pr-0">
                <PhotoScan src={photoSrc} status={analysis?.status} result={analysis?.result} compact={narrow} />
              </div>
            )}

            <div className="flex min-h-0 flex-col overflow-y-auto p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-hiraya-accent">
                    <Sparkles size={14} aria-hidden="true" /> Hiraya AI Stylist
                  </p>
                  <h2 id="stylist-consult-title" className="mt-2 font-serif text-2xl leading-tight text-hiraya-ink">
                    Let&apos;s style you
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-hiraya-ink-muted">
                    Three quick taps and I&apos;ll build looks from the Hiraya collection.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close the stylist"
                  className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-hiraya-ink transition-colors hover:bg-navy-900 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Progress: three segments that fill as the steps are answered. */}
              <ol className="mt-6 grid grid-cols-3 gap-2" aria-label="Steps">
                {STEPS.map((s, i) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => go(i)}
                      aria-current={i === step ? 'step' : undefined}
                      className="group block w-full cursor-pointer rounded-md pb-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                    >
                      <span className="relative block h-1 overflow-hidden rounded-full bg-hiraya-structure-line">
                        <motion.span
                          className="absolute inset-y-0 left-0 rounded-full bg-navy-800"
                          initial={false}
                          animate={{ width: i <= step ? '100%' : '0%' }}
                          transition={enter(reduce, { duration: DUR.slow })}
                        />
                      </span>
                      <span className={`mt-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${i === step ? 'text-hiraya-ink' : 'text-hiraya-ink-muted group-hover:text-hiraya-ink'}`}>
                        {i < step ? <Check size={12} aria-hidden="true" /> : <span className="tabular-nums">{i + 1}</span>}
                        <span>{s.label}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>

              <div className="relative mt-6 min-h-[248px] flex-1 md:min-h-[352px]">
                <AnimatePresence mode="wait" custom={dir} initial={false}>
                  <motion.section
                    key={step}
                    ref={panelRef}
                    custom={dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    aria-labelledby={`stylist-step-${step}`}
                  >
                    <h3 id={`stylist-step-${step}`} className="mb-4 font-serif text-lg leading-tight">{STEPS[step].title}</h3>
                    {renderStep()}
                  </motion.section>
                </AnimatePresence>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                {step > 0 ? (
                  <button type="button" onClick={() => go(step - 1)} className="btn-quiet min-h-[44px] cursor-pointer">
                    <ArrowLeft size={14} aria-hidden="true" /> Back
                  </button>
                ) : (
                  <button type="button" onClick={onClose} className="btn-quiet min-h-[44px] cursor-pointer">
                    Not now
                  </button>
                )}
                {step < last ? (
                  <button type="button" onClick={() => go(step + 1)} className="btn-primary min-h-[44px] cursor-pointer rounded-full px-6">
                    Next <ArrowRight size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <motion.button
                    type="button"
                    onClick={() => onSubmit({ undertone: shown || null })}
                    className="btn-primary min-h-[44px] cursor-pointer rounded-full px-6"
                    initial={reduce ? false : { scale: 0.94 }}
                    animate={{ scale: 1, transition: spring(reduce) }}
                  >
                    <Sparkles size={16} aria-hidden="true" /> Show my looks
                  </motion.button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

StylistConsultation.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  analysis: PropTypes.shape({ status: PropTypes.string, result: PropTypes.object }),
  answers: PropTypes.shape({ undertone: PropTypes.string, occasion: PropTypes.string, preference: PropTypes.string }).isRequired,
  setAnswer: PropTypes.func.isRequired,
  occasions: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string, label: PropTypes.string })),
  photoSrc: PropTypes.string,
};

export default StylistConsultation;

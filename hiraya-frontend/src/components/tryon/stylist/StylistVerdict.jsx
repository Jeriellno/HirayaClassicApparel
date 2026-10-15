import { useState } from 'react';
import PropTypes from 'prop-types';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Loader2, ShoppingBag, Check, RotateCcw, Sparkles, Quote } from 'lucide-react';
import CalloutLayer from './CalloutLayer';
import ScoreRing from './ScoreRing';
import { MeasuringPulse } from './Lookbook';
import { getProductImageUrl } from '../../../utils/imageHelper';
import { DUR, enter, leave, spring, stagger } from '../../../utils/motion';

/*
 * THE VERDICT — card 3 of the AI Stylist, shown on the finished render.
 *
 * The same rules that chose the look now check it: FIT (is this your size?),
 * COLOR (does it suit your confirmed palette?), OCCASION (is it right for where
 * you are going?) — each drawn as a callout on the body part it is about, in
 * the same visual language (and the same assembly motion) as the lookbook.
 * Under the canvas a score ring sums it up, the checks reveal one by one with
 * a drawn tick, then the stylist's tip and the pieces that complete the look.
 *
 * Status is never colour alone: every check carries an icon AND a word.
 */

const STATUS = {
  good: { word: 'Good', bar: 'bg-emerald-600', chip: 'bg-emerald-600 text-white' },
  warn: { word: 'Note', bar: 'bg-amber-500', chip: 'bg-amber-500 text-[#1A1A19]' },
};

const SIDE = { fit: 'left', color: 'right', occasion: 'left' };

/* A tick that draws itself, or a warning mark. */
const StatusMark = ({ status, delay = 0, size = 24 }) => {
  const reduce = useReducedMotion();
  const s = STATUS[status] || STATUS.warn;
  return (
    <motion.span
      className={`flex shrink-0 items-center justify-center rounded-full ${s.chip}`}
      style={{ width: size, height: size }}
      initial={reduce ? false : { scale: 0 }}
      animate={{ scale: 1 }}
      transition={spring(reduce, delay)}
      aria-hidden="true"
    >
      {status === 'good' ? (
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
          <motion.path
            d="M5 12.5l4.2 4.2L19 7"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={enter(reduce, { delay: delay + 0.12, duration: 0.35 })}
          />
        </svg>
      ) : (
        <AlertTriangle size={size * 0.55} strokeWidth={2.6} />
      )}
    </motion.span>
  );
};

StatusMark.propTypes = { status: PropTypes.string, delay: PropTypes.number, size: PropTypes.number };

const CheckCallout = ({ check, number }) => {
  const s = STATUS[check.status] || STATUS.warn;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-hiraya-surface p-3 pl-4 text-hiraya-ink shadow-[0_10px_26px_-8px_rgba(0,0,0,0.5)]">
      <span className={`absolute inset-y-0 left-0 w-1 ${s.bar}`} aria-hidden="true" />
      <p className="flex items-center gap-2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em]">
        <StatusMark status={check.status} size={20} delay={0.3 + number * 0.08} />
        <span>{number} · {check.label}</span>
        {/* The mark (tick vs warning) carries the status on the card; the word is for screen readers. */}
        <span className="sr-only">: {s.word}</span>
      </p>
      <p className="mt-1.5 line-clamp-3 text-xs leading-snug">{check.text}</p>
    </div>
  );
};

CheckCallout.propTypes = { check: PropTypes.object.isRequired, number: PropTypes.number.isRequired };

export const VerdictOverlay = ({ verdict, renderSrc, anchors, onModeChange }) => {
  const [activeKey, setActiveKey] = useState(null);

  if (verdict?.status === 'loading') {
    return (
      <>
        <MeasuringPulse src={renderSrc} anchors={anchors} />
        <div className="pointer-events-none absolute inset-x-0 bottom-16 z-20 flex justify-center px-4" role="status">
          <span className="flex items-center gap-2 rounded-full bg-noir/75 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cream-100 backdrop-blur-md">
            <Sparkles size={13} className="animate-pulse" aria-hidden="true" /> Checking your look…
          </span>
        </div>
      </>
    );
  }
  if (verdict?.status !== 'ready' || !verdict.data?.checks?.length) return null;

  const items = verdict.data.checks.map((check, i) => ({
    key: check.key,
    anchor: check.anchor || 'torso',
    side: SIDE[check.key] || (i % 2 ? 'right' : 'left'),
    number: i + 1,
    height: 96,
    node: <CheckCallout check={check} number={i + 1} />,
  }));

  return (
    <CalloutLayer
      key={verdict.sessionId || 'verdict'}
      src={renderSrc}
      anchors={anchors}
      items={items}
      cardHeight={96}
      onModeChange={onModeChange}
      activeKey={activeKey}
      onActiveChange={setActiveKey}
    />
  );
};

VerdictOverlay.propTypes = {
  verdict: PropTypes.object,
  renderSrc: PropTypes.string,
  anchors: PropTypes.object,
  onModeChange: PropTypes.func,
};

export const VerdictDetails = ({ verdict, onAddLookToBag, onTryAnotherLook, canTryAnother }) => {
  const reduce = useReducedMotion();
  const [bagState, setBagState] = useState(null); // null | 'working' | 'done'

  if (verdict?.status === 'loading') {
    return (
      <section className="card-raised rounded-[24px] p-5 text-hiraya-ink sm:p-6" aria-busy="true">
        <p className="flex items-center gap-2 text-sm text-hiraya-ink-muted">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> The stylist is checking your look…
        </p>
      </section>
    );
  }
  if (verdict?.status !== 'ready' || !verdict.data) return null;
  const { checks = [], tip, complete_the_look: complete = [], occasion } = verdict.data;
  const good = checks.filter((c) => c.status === 'good').length;
  const checksDone = 0.45 + checks.length * 0.15; // when the last check has revealed

  const addToBag = async () => {
    if (!onAddLookToBag || bagState === 'working') return;
    setBagState('working');
    try {
      await onAddLookToBag();
      setBagState('done');
    } catch {
      setBagState(null);
    }
  };

  return (
    <motion.section
      aria-label="Stylist's verdict"
      className="card-raised rounded-[24px] p-5 text-hiraya-ink sm:p-6"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={enter(reduce, { duration: DUR.slow })}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
        <Sparkles size={14} aria-hidden="true" /> Stylist&apos;s verdict{occasion?.label ? ` · ${occasion.label}` : ''}
      </p>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-start">
        {/* The sum, at a glance. */}
        <div className="flex items-center gap-4 sm:flex-col sm:items-center sm:gap-2">
          <ScoreRing good={good} total={checks.length} />
          <p className="text-sm font-semibold sm:text-center">
            {good === checks.length ? 'All checks passed' : good === 0 ? 'A few things to note' : 'Mostly there'}
          </p>
        </div>

        {/* Each check, revealed one by one with a drawn tick. */}
        <ol className="flex-1 space-y-3">
          {checks.map((check, i) => {
            const s = STATUS[check.status] || STATUS.warn;
            const delay = stagger(i, 0.15, 0.45);
            return (
              <motion.li
                key={check.key}
                className="flex gap-3 rounded-2xl bg-hiraya-surface-sunken/60 p-3.5"
                initial={reduce ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={enter(reduce, { delay })}
              >
                <StatusMark status={check.status} delay={delay + 0.05} size={26} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
                    {check.label} <span className="font-normal normal-case tracking-normal text-hiraya-ink-muted">· {s.word}</span>
                  </p>
                  <p className="mt-1 text-sm leading-snug">{check.text}</p>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </div>

      {tip && (
        <motion.figure
          className="mt-5 flex gap-3 rounded-2xl bg-hiraya-accent-wash p-4"
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={enter(reduce, { delay: checksDone })}
        >
          <Quote size={18} className="mt-0.5 shrink-0 text-cream-600" aria-hidden="true" />
          <blockquote className="font-serif text-[15px] leading-relaxed text-hiraya-ink">{tip}</blockquote>
        </motion.figure>
      )}

      {complete.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">Complete the look</p>
          <ul className="mt-3 flex flex-wrap gap-3">
            {complete.map((p, i) => (
              <motion.li
                key={p.id}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={enter(reduce, { delay: checksDone + 0.1 + i * 0.05 })}
              >
                <Link
                  to={p.url || `/product/${p.id}`}
                  className="group flex w-56 items-center gap-3 rounded-2xl bg-hiraya-surface p-3 shadow-neu-sm ring-1 ring-hiraya-structure-line transition-all duration-200 hover:-translate-y-0.5 hover:ring-navy-600"
                >
                  <img src={p.image_url ? getProductImageUrl(p.image_url) : '/images/placeholder.svg'} alt={p.name} className="h-14 w-12 rounded-lg bg-white object-contain" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold group-hover:underline" translate="no">{p.name}</span>
                    <span className="block text-xs text-hiraya-ink-muted">{p.reasons?.[0]}</span>
                  </span>
                </Link>
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <motion.button
          type="button"
          onClick={addToBag}
          disabled={bagState === 'working'}
          className="btn-primary relative min-h-[44px] cursor-pointer overflow-hidden rounded-full px-6"
          animate={bagState === 'done' && !reduce ? { scale: [1, 1.05, 1] } : { scale: 1 }}
          transition={{ duration: 0.35 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={bagState || 'idle'}
              className="flex items-center gap-2"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: enter(reduce, { duration: DUR.fast }) }}
              exit={{ opacity: 0, y: -8, transition: leave(reduce) }}
            >
              {bagState === 'working' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                : bagState === 'done' ? <Check size={16} aria-hidden="true" />
                  : <ShoppingBag size={16} aria-hidden="true" />}
              {bagState === 'done' ? 'Look added to bag' : 'Add look to bag'}
            </motion.span>
          </AnimatePresence>
        </motion.button>
        {canTryAnother && (
          <button type="button" onClick={onTryAnotherLook} className="btn-secondary min-h-[44px] cursor-pointer rounded-full px-6">
            <RotateCcw size={16} aria-hidden="true" /> Try another look
          </button>
        )}
      </div>
    </motion.section>
  );
};

VerdictDetails.propTypes = {
  verdict: PropTypes.object,
  onAddLookToBag: PropTypes.func,
  onTryAnotherLook: PropTypes.func,
  canTryAnother: PropTypes.bool,
};

import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sparkles, SlidersHorizontal } from 'lucide-react';
import { enter, leave, spring } from '../../../utils/motion';

/*
 * STYLIST STATUS — the stylist is always visibly "present".
 *
 * A pill in the canvas header that says, in words, what the stylist is doing
 * right now: reading the photo, building looks, dressing you, checking the
 * render. A dot animates with it (pulsing while busy, a pop when something is
 * ready), but the TEXT carries the state, so it never relies on colour alone.
 *
 * When the stylist can take a request (a photo is up, nothing is rendering),
 * the pill is a button that opens the consultation.
 */

const DOT = {
  busy: 'bg-cream-600',
  ready: 'bg-emerald-600',
  warn: 'bg-amber-500',
  idle: 'bg-hiraya-ink-muted/60',
};

const stylistStatusFor =({ stylist, hasPhoto, isGenerating, hasResult }) => {
  const { analysis, lookbook, looks, verdict, trying, modalOpen } = stylist;

  if (!hasPhoto) return { tone: 'idle', text: 'Add a photo to start' };
  if (trying) return { tone: 'busy', text: 'Dressing you…' };
  if (isGenerating) return { tone: 'busy', text: 'Rendering your fitting…' };

  if (hasResult) {
    if (verdict.status === 'loading') return { tone: 'busy', text: 'Checking your look…' };
    if (verdict.status === 'ready' && verdict.data?.checks?.length) {
      const checks = verdict.data.checks;
      const good = checks.filter((c) => c.status === 'good').length;
      return { tone: good === checks.length ? 'ready' : 'warn', text: 'Verdict ready', badge: `${good}/${checks.length}` };
    }
    return { tone: 'idle', text: 'Fitting ready' };
  }

  if (lookbook.status === 'loading') return { tone: 'busy', text: 'Building your looks…' };
  if (lookbook.status === 'error') return { tone: 'warn', text: 'Could not build looks' };
  if (lookbook.status === 'ready') {
    if (!looks.length) return { tone: 'warn', text: 'No looks for these answers' };
    return { tone: 'ready', text: looks.length === 1 ? '1 look ready' : `${looks.length} looks ready` };
  }
  if (analysis.status === 'processing') return { tone: 'busy', text: 'Reading your photo…' };
  if (modalOpen) return { tone: 'idle', text: 'Waiting for your answers' };
  return { tone: 'idle', text: 'Tap to get styled' };
};

const StylistStatus = ({ stylist, hasPhoto, isGenerating, hasResult }) => {
  const reduce = useReducedMotion();
  const { tone, text, badge } = stylistStatusFor({ stylist, hasPhoto, isGenerating, hasResult });
  const canOpen = hasPhoto && !hasResult && !isGenerating && !stylist.trying && !stylist.modalOpen;

  const body = (
    <>
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
        {tone === 'busy' && !reduce && (
          <motion.span
            className={`absolute inset-0 rounded-full ${DOT.busy}`}
            animate={{ scale: [1, 2.6], opacity: [0.55, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <motion.span
          key={tone}
          className={`relative h-2.5 w-2.5 rounded-full ${DOT[tone]}`}
          initial={reduce ? false : { scale: 0.3 }}
          animate={{ scale: 1 }}
          transition={spring(reduce)}
        />
      </span>
      <span className="hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink-muted sm:flex">
        <Sparkles size={12} className="text-cream-600" aria-hidden="true" />
        <span>AI Stylist</span>
      </span>
      <span className="relative block overflow-hidden" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={text}
            className="block whitespace-nowrap text-xs font-semibold"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: enter(reduce) }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, transition: leave(reduce) }}
          >
            {text}
          </motion.span>
        </AnimatePresence>
      </span>
      {badge && (
        <span className="rounded-full bg-navy-900 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-cream-100" translate="no">
          {badge}
        </span>
      )}
      {canOpen && <SlidersHorizontal size={13} className="shrink-0 text-hiraya-ink-muted" aria-hidden="true" />}
    </>
  );

  const shell = 'inline-flex min-h-[40px] min-w-0 items-center gap-2.5 rounded-full bg-hiraya-surface py-1.5 pl-3 pr-3.5 text-hiraya-ink shadow-neu-sm ring-1 ring-hiraya-structure-line';

  if (!canOpen) {
    return <div className={shell} data-tour="stylist-status">{body}</div>;
  }

  return (
    <motion.button
      type="button"
      onClick={stylist.openModal}
      data-tour="stylist-status"
      title="Open the stylist"
      whileHover={reduce ? undefined : { y: -1 }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      className={`${shell} cursor-pointer transition-shadow hover:ring-navy-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus`}
    >
      {body}
    </motion.button>
  );
};

StylistStatus.propTypes = {
  stylist: PropTypes.object.isRequired,
  hasPhoto: PropTypes.bool,
  isGenerating: PropTypes.bool,
  hasResult: PropTypes.bool,
};

export default StylistStatus;

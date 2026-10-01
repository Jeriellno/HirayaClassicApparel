import { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router-dom';
import { startWalkthrough, resolveSteps } from '../../lib/walkthrough';
import { getTourForPath } from '../../lib/tourSteps';
import { useAuth } from '../../context/AuthContext';

/**
 * TourButton — the launcher for the page guide, on every page that has one.
 *
 * WHY IT LIVES HERE, NOT IN ONE PAGE
 * -----------------------------------
 * The steps live in src/lib/tourSteps.js, keyed by route and audience, and
 * this component asks for the guide of whatever page it is sitting on. One
 * launcher, one source of truth, and a page with no guide shows no button.
 *
 * THE COUNT IS LIVE
 * -----------------
 * On hover / focus the launcher resolves the guide against the page as it is
 * RIGHT NOW and shows how many stops it will make ("5 stops"). The same
 * resolution runs again when the tour starts, so the badge and the tour's own
 * "01 / 05" counter always agree — an empty bag or a still-loading grid simply
 * means fewer stops, never a step that points at nothing.
 *
 * THE TOUR ENDS WITH THE PAGE
 * ---------------------------
 * The engine is framework-free and lives outside React, so the component keeps
 * a handle on the running tour and closes it when the route changes or the
 * launcher unmounts. Without that, following a link from inside a highlighted
 * component left the old page's spotlight floating over the new one.
 *
 * WHY BOTTOM-LEFT
 * ---------------
 * Bottom-right sits over the hero's primary action on Home; the navbar owns
 * the top edge. Bottom-left has no primary action on any page.
 */
const TourButton = () => {
  const location = useLocation();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  const tourRef = useRef(null);
  const runRef = useRef(0);
  const [stops, setStops] = useState(null);
  const [preparing, setPreparing] = useState(false);

  const tour = getTourForPath(location.pathname, !user);

  // A route change (or unmount) ends whatever tour the previous page started,
  // and cancels a launch that is still waiting for the page to render.
  useEffect(() => {
    setStops(null);
    setPreparing(false);
    return () => {
      runRef.current += 1;
      tourRef.current?.close('close');
      tourRef.current = null;
    };
  }, [location.pathname]);

  if (!tour) return null;

  const countStops = () => setStops(resolveSteps(tour.steps).length);

  /*
   * PRESSED BEFORE THE PAGE HAS RENDERED?
   * The launcher is mounted outside the routes, so it can be pressed while the
   * page underneath is still loading and none of its components exist yet. It
   * then waits up to ~3s for them (the compass spins meanwhile) instead of
   * silently doing nothing, and if the page is still empty after that, it says
   * so in a centred card rather than pointing at nothing.
   */
  const start = async () => {
    if (preparing) return;
    tourRef.current?.close('close');

    const run = (runRef.current += 1);
    let available = resolveSteps(tour.steps).length;

    if (available === 0) {
      setPreparing(true);
      const deadline = Date.now() + 3000;
      while (available === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (run !== runRef.current) return;
        available = resolveSteps(tour.steps).length;
      }
      setPreparing(false);
    }

    const steps =
      available > 0
        ? tour.steps
        : [
            {
              title: 'Still setting the stage',
              text: `The ${tour.label} page is still loading. Give it a moment, then press Take a tour again.`,
            },
          ];

    setStops(available > 0 ? available : null);
    tourRef.current = startWalkthrough(steps, {
      padding: 10,
      label: `${tour.label} guide`,
      onClose: () => {
        tourRef.current = null;
      },
    });
  };

  const showCount = stops !== null && stops > 0;

  return (
    <motion.button
      type="button"
      onClick={start}
      onPointerEnter={countStops}
      onFocus={countStops}
      data-tour="tour-launcher"
      title={`Walk through what each control on the ${tour.label} page does`}
      aria-label={`Take a tour of the ${tour.label} page${showCount ? `, ${stops} stops` : ''}`}
      aria-busy={preparing}
      initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.4 }}
      whileHover={reduceMotion ? undefined : { y: -2 }}
      whileTap={reduceMotion ? undefined : { scale: 0.97 }}
      className="group fixed bottom-4 left-4 z-[70] flex cursor-pointer items-center gap-2.5 rounded-full border border-cream-50/15 bg-navy-900/90 p-1.5 text-cream-100 sm:py-2 sm:pl-2 sm:pr-5 shadow-[0_18px_36px_-16px_rgba(5,9,18,0.8),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-[opacity,background-color] duration-300 hover:bg-navy-800 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy-600 sm:bottom-6 sm:left-6"
    >
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-cream-100 text-navy-900 shadow-[inset_0_-2px_4px_rgba(21,32,54,0.18)]">
        {/* A slow ping so the launcher is findable without a hint card over the page. */}
        {!reduceMotion && (
          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-cream-100/40 [animation-duration:2.6s]" />
        )}
        <Compass
          size={16}
          className={`relative transition-transform duration-700 ease-out ${
            preparing ? 'animate-spin [animation-duration:1.2s]' : 'group-hover:rotate-[200deg]'
          }`}
        />
      </span>

      {/* On phones the launcher is the compass disc alone, so it never sits
          across a primary button; the aria-label still names it in full. */}
      <span className="hidden items-baseline gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] sm:flex">
        {preparing ? 'Preparing…' : 'Take a tour'}
        <AnimatePresence initial={false}>
          {showCount && (
            <motion.span
              key={stops}
              initial={reduceMotion ? false : { opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="hidden font-serif text-[0.7rem] normal-case tracking-[0.04em] text-cream-400 sm:inline"
              aria-hidden="true"
            >
              · {stops} {stops === 1 ? 'stop' : 'stops'}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
};

export default TourButton;

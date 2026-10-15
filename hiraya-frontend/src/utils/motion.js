/*
 * MOTION TOKENS — one vocabulary for the AI Stylist's animation.
 *
 * Same easing as the CSS entrances in index.css (`hiraya-slide-up`), three
 * durations, and exits faster than entries so the UI never feels sluggish when
 * something leaves. Every helper takes `reduce` (framer's useReducedMotion) and
 * returns an instant transition for it, so reduced-motion visitors always get
 * the final state straight away.
 */

export const EASE_OUT = [0.22, 1, 0.36, 1];
export const EASE_IN = [0.4, 0, 1, 1];

export const DUR = { fast: 0.15, base: 0.25, slow: 0.4 };

export const SPRING = { type: 'spring', stiffness: 380, damping: 28 };

const INSTANT = { duration: 0 };

/** An entrance: ease-out, optional delay. */
export const enter = (reduce, { delay = 0, duration = DUR.base } = {}) =>
  (reduce ? INSTANT : { duration, delay, ease: EASE_OUT });

/** An exit: short and ease-in. */
export const leave = (reduce, duration = DUR.fast) =>
  (reduce ? INSTANT : { duration, ease: EASE_IN });

/** A spring (for pops and lifts). */
export const spring = (reduce, delay = 0) => (reduce ? INSTANT : { ...SPRING, delay });

/** Stagger delay for the i-th item of a list. */
export const stagger = (i, step = 0.04, base = 0) => base + i * step;

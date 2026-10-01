/* ============================================================================
 * HIRAYA WALKTHROUGH — VANILLA JS ENGINE
 * ----------------------------------------------------------------------------
 * Framework-free on purpose: it manipulates plain DOM, so it needs no portal,
 * no context and no re-render. It dims the page, spotlights one element at a
 * time and floats a tooltip card beside it with Back / Next / Skip tour.
 *
 * ---------------------------------------------------------------------------
 * STEP DEFINITIONS
 * ---------------------------------------------------------------------------
 *   {
 *     element:   '[data-tour="upload-photo"]', // selector or DOM node; omit for
 *                                              // a centred, element-less card
 *     title:     'Upload a body photo',
 *     text:      'Use one full-body, front-on shot in good light.',
 *     placement: 'bottom',                     // bottom | top | left | right | auto
 *     when:      () => true,                   // optional: include only if true
 *     before:    () => {},                     // optional: open a panel first
 *   }
 *
 * ---------------------------------------------------------------------------
 * THE STEP COUNT IS WHAT THE PAGE ACTUALLY HAS
 * ---------------------------------------------------------------------------
 * The old engine skipped a missing target at run time but still drew one dot
 * per DEFINED step, so a page could promise "Step 1 of 4" and then end after
 * three. Steps are now resolved BEFORE the tour opens: a step survives only if
 * its target exists, is rendered, is on-screen horizontally and is not inside
 * an `inert` / `aria-hidden` region (a closed drawer, for example). The counter
 * and the progress segments are built from the survivors, so the number the
 * user reads is the number of stops they will actually get.
 *
 * Steps with a `before()` hook cannot be pre-resolved — their target may only
 * appear once the hook runs — so they are kept optimistically and removed from
 * the list (and the count) at the moment they turn out to be missing.
 *
 * ---------------------------------------------------------------------------
 * WHY THE POSITIONING IS DONE IN JS RATHER THAN CSS
 * ---------------------------------------------------------------------------
 * The spotlight is `position: fixed`, so its coordinates are VIEWPORT
 * coordinates (`getBoundingClientRect()`), and it must be recomputed on every
 * scroll, resize and target resize. A single rAF-throttled loop handles all
 * three, so the spotlight tracks the element instead of sliding off it.
 * ==========================================================================*/

import '../styles/walkthrough.css';

const DEFAULTS = {
  placement: 'auto',
  padding: 8,         // breathing room between the spotlight and the element
  scrollMargin: 104,  // clears the fixed navbar when a target is scrolled to
  label: '',          // page name shown in the card header, e.g. "Shop"
  onFinish: null,
  onClose: null,
};

const GAP = 16;
const EDGE = 12;

const ICONS = {
  close:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  prev:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  next:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  done:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const pad2 = (n) => String(n).padStart(2, '0');

let uid = 0;

/* ------------------------------------------------------------ RESOLUTION */

/**
 * True when an element is something a person could actually see right now.
 * `checkVisibility()` covers display/visibility/content-visibility; the rest
 * rejects zero-size boxes, off-canvas drawers and regions the page has marked
 * as not-currently-available.
 */
export const isTargetVisible = (el) => {
  if (!el || !el.isConnected) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) {
    return false;
  }

  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;

  // A drawer translated off the side of the viewport is "rendered" but hidden.
  return rect.right > 0 && rect.left < window.innerWidth;
};

/** The first VISIBLE match — a selector can match a skeleton and a real grid. */
export const resolveTarget = (element) => {
  if (!element) return null;
  if (typeof element !== 'string') return isTargetVisible(element) ? element : null;
  return [...document.querySelectorAll(element)].find(isTargetVisible) || null;
};

/**
 * The steps that will really run on this page, in order. Element-less steps
 * (centred cards) always survive; `before()` steps survive optimistically.
 */
export const resolveSteps = (steps) =>
  (Array.isArray(steps) ? steps : []).filter((step) => {
    if (!step) return false;
    if (typeof step.when === 'function' && !step.when()) return false;
    if (!step.element || typeof step.before === 'function') return true;
    return Boolean(resolveTarget(step.element));
  });

/* ---------------------------------------------------------------- ENGINE */

class Walkthrough {
  constructor(steps, options = {}) {
    this.definedSteps = Array.isArray(steps) ? steps.filter(Boolean) : [];
    this.steps = [];
    this.options = { ...DEFAULTS, ...options };

    this.index = -1;
    this.target = null;
    this.active = false;
    this.frame = null;
    this.observer = null;
    this.id = `wt-${(uid += 1)}`;

    // Bound once so add/removeEventListener always see the same references.
    this._onScroll = () => this.schedulePosition();
    this._onScrollEnd = () => {
      this.scrolling = false;
      clearTimeout(this.scrollTimer);
      this.schedulePosition();
    };
    this._onKeyDown = (e) => this.handleKey(e);
  }

  /* ------------------------------------------------------------------ START */

  start(atIndex = 0) {
    this.steps = resolveSteps(this.definedSteps);
    if (this.steps.length === 0) return this;

    this.returnFocus = document.activeElement;
    if (!this.overlayEl) this.build();

    this.active = true;
    document.documentElement.classList.add('wt-running');

    window.addEventListener('scroll', this._onScroll, true); // capture: nested scrollers too
    window.addEventListener('scrollend', this._onScrollEnd, true);
    window.addEventListener('resize', this._onScroll);
    document.addEventListener('keydown', this._onKeyDown, true);

    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.schedulePosition());
    }

    this.goTo(Math.min(Math.max(atIndex, 0), this.steps.length - 1), 1);

    return this;
  }

  /* Builds the overlay + spotlight + card DOM ONCE; steps only move them. */
  build() {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'wt-overlay';

    this.spotlightEl = document.createElement('div');
    this.spotlightEl.className = 'wt-spotlight';
    this.spotlightEl.setAttribute('aria-hidden', 'true');

    this.cardEl = document.createElement('div');
    this.cardEl.className = 'wt-card';
    this.cardEl.setAttribute('role', 'dialog');
    this.cardEl.setAttribute('aria-modal', 'true');
    this.cardEl.setAttribute('aria-labelledby', `${this.id}-title`);
    this.cardEl.setAttribute('aria-describedby', `${this.id}-text`);
    this.cardEl.innerHTML = `
      <span class="wt-card__arrow" aria-hidden="true"></span>
      <div class="wt-card__head">
        <p class="wt-card__meta" aria-live="polite">
          <span class="wt-card__label"></span>
          <span class="wt-card__count"></span>
        </p>
        <button type="button" class="wt-skip" data-wt="skip">Skip tour ${ICONS.close}</button>
      </div>
      <div class="wt-card__progress" aria-hidden="true"></div>
      <div class="wt-card__body">
        <h3 class="wt-card__title" id="${this.id}-title"></h3>
        <p class="wt-card__text" id="${this.id}-text"></p>
      </div>
      <div class="wt-card__footer">
        <button type="button" class="wt-btn wt-btn--back" data-wt="back">${ICONS.prev}<span>Back</span></button>
        <span class="wt-card__keys" aria-hidden="true"><kbd>&larr;</kbd><kbd>&rarr;</kbd></span>
        <button type="button" class="wt-btn wt-btn--next" data-wt="next"><span>Next</span>${ICONS.next}</button>
      </div>
    `;

    // Clicks INSIDE the card must not reach the overlay's nudge handler.
    this.cardEl.addEventListener('click', (e) => e.stopPropagation());

    this.cardEl.querySelector('[data-wt="next"]').addEventListener('click', () => this.next());
    this.cardEl.querySelector('[data-wt="back"]').addEventListener('click', () => this.previous());
    this.cardEl.querySelector('[data-wt="skip"]').addEventListener('click', () => this.close('skip'));

    /*
     * A click on the dimmed page NUDGES the card instead of closing the tour.
     * Dismissing a whole guide on a stray click is the most common way people
     * lose their place; the explicit "Skip tour" control and Esc are the exits.
     */
    this.overlayEl.addEventListener('click', () => this.nudge());

    document.body.append(this.overlayEl, this.spotlightEl, this.cardEl);

    this.labelEl = this.cardEl.querySelector('.wt-card__label');
    this.countEl = this.cardEl.querySelector('.wt-card__count');
    this.progressEl = this.cardEl.querySelector('.wt-card__progress');
    this.bodyEl = this.cardEl.querySelector('.wt-card__body');
    this.titleEl = this.cardEl.querySelector('.wt-card__title');
    this.textEl = this.cardEl.querySelector('.wt-card__text');
    this.backBtn = this.cardEl.querySelector('[data-wt="back"]');
    this.nextBtn = this.cardEl.querySelector('[data-wt="next"]');
  }

  /* ------------------------------------------------------------------- STEP */

  /**
   * `direction` (+1 forward, -1 back) decides where to go when the requested
   * step's target has vanished since the tour opened: the step is dropped and
   * the walk continues the way the user was already heading.
   */
  goTo(index, direction = 1) {
    if (index < 0) return this;
    if (index >= this.steps.length) return this.close('finish');

    const step = this.steps[index];
    if (typeof step.before === 'function') step.before();

    const target = step.element ? resolveTarget(step.element) : null;

    if (step.element && !target) {
      this.steps.splice(index, 1);
      if (this.steps.length === 0) return this.close('finish');
      return this.goTo(direction < 0 ? index - 1 : index, direction);
    }

    this.observer?.disconnect();
    this.index = index;
    this.target = target;
    if (target) this.observer?.observe(target);

    this.render(step);
    this.revealTarget();
    this.position();

    return this;
  }

  render(step) {
    const total = this.steps.length;
    const isFirst = this.index === 0;
    const isLast = this.index === total - 1;

    this.labelEl.textContent = this.options.label || 'Guide';
    this.countEl.textContent = `${pad2(this.index + 1)} / ${pad2(total)}`;
    this.titleEl.textContent = step.title || '';
    this.textEl.textContent = step.text || '';

    // One segment per stop that will REALLY run; everything up to here is filled.
    this.progressEl.style.setProperty('--wt-steps', total);
    this.progressEl.innerHTML = this.steps
      .map((_, i) => `<span class="wt-seg${i <= this.index ? ' is-done' : ''}${i === this.index ? ' is-current' : ''}"></span>`)
      .join('');

    this.backBtn.disabled = isFirst;
    this.nextBtn.innerHTML = isLast ? `<span>Finish</span>${ICONS.done}` : `<span>Next</span>${ICONS.next}`;
    this.nextBtn.setAttribute('aria-label', isLast ? 'Finish the tour' : `Next: step ${this.index + 2} of ${total}`);

    this.cardEl.classList.toggle('is-floating', !this.target);
    this.spotlightEl.classList.toggle('is-floating', !this.target);

    if (!prefersReducedMotion() && typeof this.bodyEl.animate === 'function') {
      this.bodyEl.animate(
        [
          { opacity: 0, transform: 'translateY(6px)', filter: 'blur(2px)' },
          { opacity: 1, transform: 'none', filter: 'none' },
        ],
        { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }

    this.nextBtn.focus({ preventScroll: true });
  }

  /**
   * Scrolls only when the target is hidden behind the navbar or off-screen —
   * OR when the tour's own previous smooth scroll is still running. Without
   * that second condition, pressing Next mid-scroll measured the new target
   * while the page was passing it, decided it was "visible", and then the old
   * scroll carried on and parked it off-screen. A fresh scrollIntoView call
   * replaces the in-flight one, so the newest step always wins.
   */
  revealTarget() {
    if (!this.target) return;

    const margin = this.options.scrollMargin;
    const rect = this.target.getBoundingClientRect();
    const vh = window.innerHeight;
    const hidden = rect.top < margin || rect.bottom > vh - EDGE;
    if (!hidden && !this.scrolling) return;

    const smooth = !prefersReducedMotion();

    // Tall targets align to their top edge; everything else is centred.
    const fitsView = rect.height < vh - margin - EDGE * 2;
    const previous = this.target.style.scrollMarginTop;
    this.target.style.scrollMarginTop = `${margin}px`;
    this.target.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: fitsView ? 'center' : 'start',
      inline: 'nearest',
    });
    this.target.style.scrollMarginTop = previous;

    if (smooth) {
      // Cleared by `scrollend` where supported; the timer is the fallback.
      this.scrolling = true;
      clearTimeout(this.scrollTimer);
      this.scrollTimer = setTimeout(this._onScrollEnd, 1000);
    }
  }

  next() {
    if (this.index >= this.steps.length - 1) return this.close('finish');
    return this.goTo(this.index + 1, 1);
  }

  previous() {
    if (this.index <= 0) return this;
    return this.goTo(this.index - 1, -1);
  }

  /* A gentle shake that says "the tour is still open — use its buttons". */
  nudge() {
    if (prefersReducedMotion() || typeof this.cardEl.animate !== 'function') {
      this.nextBtn.focus({ preventScroll: true });
      return;
    }
    this.cardEl.animate(
      [
        { translate: '0 0' },
        { translate: '-6px 0' },
        { translate: '5px 0' },
        { translate: '-3px 0' },
        { translate: '0 0' },
      ],
      { duration: 360, easing: 'ease-out' },
    );
    this.nextBtn.focus({ preventScroll: true });
  }

  /* --------------------------------------------------------------- GEOMETRY */

  schedulePosition() {
    if (this.frame) return; // a frame is already queued — coalesce the events

    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.position();
    });
  }

  position() {
    if (!this.active) return;

    // A re-render can swap the node out from under us; find its replacement.
    if (this.target && !this.target.isConnected) {
      const step = this.steps[this.index];
      this.target = resolveTarget(step?.element);
      if (this.target) this.observer?.observe(this.target);
    }

    if (!this.target) {
      this.placeFloating();
      return;
    }

    const pad = this.options.padding;
    const rect = this.target.getBoundingClientRect();

    const spot = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };

    // The cut-out follows the component's own corner radius, so a pill gets a
    // pill-shaped spotlight and a square plate a squared one.
    const own = parseFloat(getComputedStyle(this.target).borderTopLeftRadius) || 0;
    const radius = Math.min(own > 0 ? own + pad : 14, Math.min(spot.width, spot.height) / 2);

    Object.assign(this.spotlightEl.style, {
      top: `${spot.top}px`,
      left: `${spot.left}px`,
      width: `${spot.width}px`,
      height: `${spot.height}px`,
      borderRadius: `${radius}px`,
    });

    this.placeCard(spot);
  }

  /* An element-less step: full dim, card centred in the viewport. */
  placeFloating() {
    const card = this.cardEl.getBoundingClientRect();
    Object.assign(this.spotlightEl.style, {
      top: `${window.innerHeight / 2}px`,
      left: `${window.innerWidth / 2}px`,
      width: '0px',
      height: '0px',
    });
    this.cardEl.dataset.placement = 'floating';
    Object.assign(this.cardEl.style, {
      top: `${Math.max(EDGE, (window.innerHeight - card.height) / 2)}px`,
      left: `${Math.max(EDGE, (window.innerWidth - card.width) / 2)}px`,
    });
  }

  /**
   * Places the card around the spotlight. `auto` prefers below, then above,
   * then whichever side has room; when NO side fits (a target taller than the
   * viewport, or a phone), the card docks to the bottom edge of the screen.
   */
  placeCard(spot) {
    const card = this.cardEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fits = {
      bottom: spot.top + spot.height + GAP + card.height <= vh - EDGE,
      top: spot.top - GAP - card.height >= EDGE,
      right: spot.left + spot.width + GAP + card.width <= vw - EDGE,
      left: spot.left - GAP - card.width >= EDGE,
    };
    const opposite = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' };

    let placement = this.steps[this.index]?.placement || this.options.placement;
    if (placement === 'auto' || !fits[placement]) {
      const preferred = placement === 'auto' ? null : placement;
      placement =
        [preferred && opposite[preferred], 'bottom', 'top', 'right', 'left'].find((side) => side && fits[side]) ||
        'dock';
    }

    let top;
    let left;

    if (placement === 'dock') {
      top = vh - card.height - EDGE;
      left = (vw - card.width) / 2;
    } else if (placement === 'top' || placement === 'bottom') {
      top = placement === 'bottom' ? spot.top + spot.height + GAP : spot.top - card.height - GAP;
      left = spot.left + spot.width / 2 - card.width / 2;
    } else {
      left = placement === 'right' ? spot.left + spot.width + GAP : spot.left - card.width - GAP;
      top = spot.top + spot.height / 2 - card.height / 2;
    }

    // Clamp inside the viewport so the card is never half off-screen.
    top = Math.max(EDGE, Math.min(top, vh - card.height - EDGE));
    left = Math.max(EDGE, Math.min(left, vw - card.width - EDGE));

    // The arrow points at the spotlight's centre, wherever the clamp left the card.
    const along =
      placement === 'top' || placement === 'bottom'
        ? spot.left + spot.width / 2 - left
        : spot.top + spot.height / 2 - top;
    const span = placement === 'top' || placement === 'bottom' ? card.width : card.height;
    this.cardEl.style.setProperty('--wt-arrow', `${Math.max(22, Math.min(along, span - 22))}px`);

    this.cardEl.dataset.placement = placement;
    Object.assign(this.cardEl.style, { top: `${top}px`, left: `${left}px` });
  }

  /* ------------------------------------------------------------------ EXIT */

  /** reason: 'finish' (completed) | 'skip' (user skipped) | 'close' (external) */
  close(reason = 'close') {
    if (!this.active) return this;

    this.active = false;
    this.index = -1;
    this.target = null;

    window.removeEventListener('scroll', this._onScroll, true);
    window.removeEventListener('scrollend', this._onScrollEnd, true);
    window.removeEventListener('resize', this._onScroll);
    document.removeEventListener('keydown', this._onKeyDown, true);

    this.scrolling = false;
    clearTimeout(this.scrollTimer);
    this.observer?.disconnect();
    this.observer = null;

    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }

    document.documentElement.classList.remove('wt-running');

    if (this.overlayEl) {
      this.overlayEl.remove();
      this.spotlightEl.remove();
      this.cardEl.remove();
      this.overlayEl = null;
    }

    if (this.returnFocus && typeof this.returnFocus.focus === 'function' && this.returnFocus.isConnected) {
      this.returnFocus.focus({ preventScroll: true });
    }

    // Separate callbacks so the caller can distinguish "completed" from "bailed".
    if (reason === 'finish' && typeof this.options.onFinish === 'function') {
      this.options.onFinish();
    }
    if (typeof this.options.onClose === 'function') {
      this.options.onClose(reason);
    }

    return this;
  }

  handleKey(e) {
    if (!this.active) return undefined;

    if (e.key === 'Escape') {
      e.preventDefault();
      return this.close('skip');
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      return this.next();
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      return this.previous();
    }

    // Keep keyboard focus inside the card while the page behind is dimmed.
    if (e.key === 'Tab') {
      const focusables = [...this.cardEl.querySelectorAll('button:not([disabled])')];
      if (focusables.length === 0) return undefined;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const inside = this.cardEl.contains(document.activeElement);

      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    }
    return undefined;
  }
}

/** Convenience factory so callers never touch `new`. Returns the instance. */
export const startWalkthrough = (steps, options) => new Walkthrough(steps, options).start();

export default Walkthrough;

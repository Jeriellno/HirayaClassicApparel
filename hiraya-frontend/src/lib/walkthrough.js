 /* ============================================================================
 * HIRAYA WALKTHROUGH — VANILLA JS ENGINE
 * ----------------------------------------------------------------------------
 * Standard HTML + CSS + vanilla JS (no framework) that walks a user through a
 * page: dim everything, spotlight one element at a time, show a tooltip card
 * with a title, an instruction, and Next / Close.
 *
 * ---------------------------------------------------------------------------
 * STEP DEFINITIONS
 * ---------------------------------------------------------------------------
 * A step targets either a CSS selector or an element:
 *
 *   {
 *     element: '#upload-photo',          // selector, or a DOM node
 *     title:   'Upload a body photo',
 *     text:    'Use one full-body, front-on shot in good light.',
 *     placement: 'bottom',               // bottom | top | left | right | auto
 *     before:  () => {},                 // optional: open a menu, scroll, etc.
 *   }
 *
 * ---------------------------------------------------------------------------
 * WHY THE POSITIONING IS DONE IN JS RATHER THAN CSS
 * ---------------------------------------------------------------------------
 * The spotlight is `position: fixed`, so its coordinates must be VIEWPORT
 * coordinates — which is what `getBoundingClientRect()` returns. That means the
 * tour has to recompute on every scroll and resize, because a fixed box does not
 * follow a document-flow target. A single rAF-throttled reposition loop handles
 * both, so the spotlight tracks the element instead of sliding off it.
 * ==========================================================================*/

import '../styles/walkthrough.css';

const DEFAULTS = {
  placement: 'auto',
  padding: 8,        // breathing room between the spotlight and the element
  scrollMargin: 80,  // space kept above the target when scrolling it into view
  onFinish: null,
  onClose: null,
};

class Walkthrough {
  constructor(steps, options = {}) {
    this.steps = Array.isArray(steps) ? steps.filter(Boolean) : [];
    this.options = { ...DEFAULTS, ...options };

    this.index = -1;
    this.target = null;
    this.active = false;
    this.frame = null;

    // Bound once so add/removeEventListener always see the same references.
    this._onScroll = () => this.schedulePosition();
    this._onKeyDown = (e) => this.handleKey(e);
  }

  /* ------------------------------------------------------------------ START */

  start(atIndex = 0) {
    if (this.steps.length === 0) return this;

    if (!this.overlayEl) this.build();

    this.active = true;
    document.body.classList.add('wt-locked');

    window.addEventListener('scroll', this._onScroll, true); // capture: nested scrollers too
    window.addEventListener('resize', this._onScroll);
    document.addEventListener('keydown', this._onKeyDown);

    this.goTo(atIndex);

    return this;
  }

  /* Builds the overlay + spotlight DOM ONCE; steps only move them. */
  build() {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'wt-overlay';

    this.spotlightEl = document.createElement('div');
    this.spotlightEl.className = 'wt-spotlight';

    this.cardEl = document.createElement('div');
    this.cardEl.className = 'wt-card';
    this.cardEl.setAttribute('role', 'dialog');
    this.cardEl.setAttribute('aria-live', 'polite');
    this.cardEl.innerHTML = `
      <span class="wt-card__arrow"></span>
      <span class="wt-card__step"></span>
      <h3 class="wt-card__title"></h3>
      <p class="wt-card__text"></p>
      <div class="wt-card__footer">
        <div class="wt-card__dots"></div>
        <div class="wt-card__actions">
          <button type="button" class="wt-btn wt-btn--close" data-wt="close">Close</button>
          <button type="button" class="wt-btn wt-btn--next" data-wt="next">Next</button>
        </div>
      </div>
    `;

    // Clicks INSIDE the card must not fall through to the overlay's close handler.
    this.cardEl.addEventListener('click', (e) => e.stopPropagation());

    this.cardEl
      .querySelector('[data-wt="next"]')
      .addEventListener('click', () => this.next());

    this.cardEl
      .querySelector('[data-wt="close"]')
      .addEventListener('click', () => this.close('close'));

    // Clicking the dimmed area also exits — the universal escape hatch.
    this.overlayEl.addEventListener('click', () => this.close('close'));

    document.body.append(this.overlayEl, this.spotlightEl, this.cardEl);

    this.stepEl = this.cardEl.querySelector('.wt-card__step');
    this.titleEl = this.cardEl.querySelector('.wt-card__title');
    this.textEl = this.cardEl.querySelector('.wt-card__text');
    this.dotsEl = this.cardEl.querySelector('.wt-card__dots');
    this.nextBtn = this.cardEl.querySelector('[data-wt="next"]');
  }

  /* ------------------------------------------------------------------- STEP */

  goTo(index) {
    if (index < 0 || index >= this.steps.length) return this.close('finish');

    this.index = index;
    const step = this.steps[index];

    /*
     * `before()` runs FIRST — a step often needs to open a panel or expand a
     * section before its target exists on screen. It is awaited so the element
     * is measured after the DOM settles, not mid-animation.
     */
    if (typeof step.before === 'function') step.before();

    this.resolveTarget(step);

    if (!this.target) {
      // A missing target must not break the tour: skip to the next defined step.
      return this.goTo(index + 1);
    }

    this.render(step);
    this.schedulePosition();

    return this;
  }

  resolveTarget(step) {
    this.target =
      typeof step.element === 'string'
        ? document.querySelector(step.element)
        : step.element || null;
  }

  render(step) {
    const isLast = this.index === this.steps.length - 1;

    this.stepEl.textContent = step.step || `Step ${this.index + 1} of ${this.steps.length}`;
    this.titleEl.textContent = step.title || '';
    this.textEl.textContent = step.text || '';

    // Dots: one per step, current one elongated.
    this.dotsEl.innerHTML = this.steps
      .map((_, i) => `<span class="wt-dot${i === this.index ? ' is-active' : ''}"></span>`)
      .join('');

    // The last step's primary action finishes the tour rather than advancing it.
    this.nextBtn.textContent = isLast ? 'Finish' : 'Next';

    // Only scroll when the target is actually off-screen, so the page does not
    // jump under a user who has already navigated to the right place.
    const rect = this.target.getBoundingClientRect();
    const offScreen = rect.top < 0 || rect.bottom > window.innerHeight;

    if (offScreen) {
      this.target.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
  }

  next() {
    if (this.index >= this.steps.length - 1) return this.close('finish');
    return this.goTo(this.index + 1);
  }

  previous() {
    if (this.index <= 0) return this;
    return this.goTo(this.index - 1);
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
    if (!this.active || !this.target) return;

    const pad = this.options.padding;
    const rect = this.target.getBoundingClientRect();

    const spot = {
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    };

    Object.assign(this.spotlightEl.style, {
      top: `${spot.top}px`,
      left: `${spot.left}px`,
      width: `${spot.width}px`,
      height: `${spot.height}px`,
    });

    this.placeCard(spot);
  }

  /**
   * Places the card around the spotlight, flipping sides when there is no room.
   * `auto` prefers below, then above, then whichever side has more space.
   */
  placeCard(spot) {
    const gap = 16;
    const card = this.cardEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let placement = this.steps[this.index]?.placement || 'auto';

    if (placement === 'auto') {
      const spaceBelow = vh - (spot.top + spot.height);
      const spaceAbove = spot.top;
      placement = spaceBelow >= card.height + gap ? 'bottom' : spaceAbove >= card.height + gap ? 'top' : 'right';
    }

    // Flip if the preferred side cannot fit.
    if (placement === 'bottom' && spot.top + spot.height + gap + card.height > vh) placement = 'top';
    if (placement === 'top' && spot.top - gap - card.height < 0) placement = 'bottom';
    if (placement === 'right' && spot.left + spot.width + gap + card.width > vw) placement = 'left';
    if (placement === 'left' && spot.left - gap - card.width < 0) placement = 'right';

    let top;
    let left;

    if (placement === 'top' || placement === 'bottom') {
      top = placement === 'bottom' ? spot.top + spot.height + gap : spot.top - card.height - gap;
      left = spot.left + spot.width / 2 - card.width / 2;
    } else {
      left = placement === 'right' ? spot.left + spot.width + gap : spot.left - card.width - gap;
      top = spot.top + spot.height / 2 - card.height / 2;
    }

    // Clamp inside the viewport so the card is never half off-screen.
    top = Math.max(gap, Math.min(top, vh - card.height - gap));
    left = Math.max(gap, Math.min(left, vw - card.width - gap));

    this.cardEl.dataset.placement = placement;
    Object.assign(this.cardEl.style, { top: `${top}px`, left: `${left}px` });
  }

  /* ------------------------------------------------------------------ EXIT */

  close(reason = 'close') {
    if (!this.active) return this;

    this.active = false;
    this.index = -1;

    window.removeEventListener('scroll', this._onScroll, true);
    window.removeEventListener('resize', this._onScroll);
    document.removeEventListener('keydown', this._onKeyDown);

    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }

    document.body.classList.remove('wt-locked');

    if (this.overlayEl) {
      this.overlayEl.remove();
      this.spotlightEl.remove();
      this.cardEl.remove();
      this.overlayEl = null;
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
    if (e.key === 'Escape') return this.close('close');
    if (e.key === 'ArrowRight') return this.next();
    if (e.key === 'ArrowLeft') return this.previous();
    return undefined;
  }
}

/** Convenience factory so callers never touch `new`. */
export const startWalkthrough = (steps, options) => new Walkthrough(steps, options).start();

export default Walkthrough;
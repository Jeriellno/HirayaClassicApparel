/**
 * Pointer handler for the `.spotlight` card treatment (see index.css).
 *
 * Writes the pointer's position inside the card to `--mx` / `--my`, which the
 * card's ::before light reads. Pure presentation: no state, no re-render —
 * the style variables are set straight on the element.
 */
export const trackSpotlight = (e) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
};

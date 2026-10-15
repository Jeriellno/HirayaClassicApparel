/*
 * WHICH STYLE STACK SELECTIONS ONE AI FITTING CAN WEAR.
 *
 * Mirrors the backend's App\Support\TryOnGarmentPlan, which stays the authority
 * (it answers an unsupported request with the same message as a 422). Checking
 * here lets the Studio explain BEFORE Generate instead of after a request.
 *
 *   one wearable piece                 -> single render (unchanged)
 *   top OR outerwear  +  bottom        -> pair: two renders, bottom first
 *   dress  +  one top OR outerwear     -> pair: two renders, the dress first,
 *                                         then the top / outerwear layered over it
 *   anything else with 2+ pieces       -> unsupported, with a reason to act on
 *
 * Accessories are never sent to the render, so they are ignored here.
 */

const UPPER = ['top', 'outerwear'];

export const STACK_PLAN_MESSAGES = {
  dress_combo: 'A dress can be tried on with one top or one outerwear piece layered over it — like a bolero, cardigan or jacket — but not with a bottom or footwear. Remove the extra piece to render your fitting.',
  footwear_combo: 'Footwear can’t be rendered together with other pieces yet. Remove the footwear to render the rest of your look.',
  two_upper: 'The AI try-on can wear one upper-body piece at a time. Keep either the top or the outerwear, and add a bottom if you like.',
  too_many: 'The AI try-on renders up to two pieces together: one top (or outerwear) with one bottom, or one top (or outerwear) layered over a dress. Remove the extra pieces and try again.',
};

/**
 * @param {Record<string, object|null>} selectedGarments  the Style Stack slots
 * @returns {{mode: 'none'|'single'|'pair'|'unsupported', passes: number, layering?: 'over_bottom'|'over_dress', outer?: 'top'|'outerwear', code?: string, message?: string}}
 */
export const planStack = (selectedGarments) => {
  const slots = Object.entries(selectedGarments || {})
    .filter(([slot, garment]) => slot !== 'accessories' && garment)
    .map(([slot]) => slot);

  if (slots.length === 0) return { mode: 'none', passes: 0 };
  if (slots.length === 1) return { mode: 'single', passes: 1 };

  const refuse = (code) => ({ mode: 'unsupported', passes: 0, code, message: STACK_PLAN_MESSAGES[code] });

  if (slots.length > 2) return refuse('too_many');
  if (slots.includes('dress')) {
    // A bolero, cropped top or jacket over the dress; bottoms and shoes stay refused.
    const outer = slots.find((slot) => UPPER.includes(slot));
    return outer ? { mode: 'pair', passes: 2, layering: 'over_dress', outer } : refuse('dress_combo');
  }
  if (slots.includes('footwear')) return refuse('footwear_combo');
  if (slots.includes('bottom') && slots.some((slot) => UPPER.includes(slot))) return { mode: 'pair', passes: 2, layering: 'over_bottom' };

  return refuse('two_upper');
};

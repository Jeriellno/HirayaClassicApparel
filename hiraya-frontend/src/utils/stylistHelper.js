import { isLowerBodyGarment } from './categoryHelpers';
const FIT_TO_CUT = { slim: 'SLIM', regular: 'REGULAR', oversized: 'LOOSE' };
const CUT_WORDS = { SLIM: 'slim', REGULAR: 'regular', LOOSE: 'relaxed / oversized' };

/**
 * A short, honest fit note for the product page, built ONLY from what Hiraya
 * actually stores: the shopper's upper / lower size, fit style and gender, and
 * the garment's stocked sizes, AI cut (`ai_tags.fit_type`) and gender.
 *
 * (It used to ask for a `height` column that no longer exists, so every
 * signed-in shopper saw "Update your height in your profile".)
 *
 * @param {Object} user
 * @param {Object} product
 * @returns {string}
 */
export const getStylistRecommendation = (user, product) => {
  if (!user) {
    return 'Sign in to see how this piece fits your saved size and fit style.';
  }

  const isLower = isLowerBodyGarment(product?.category, product?.name);
  const mySize = isLower ? user.lower_body_size || user.upper_body_size : user.upper_body_size || user.lower_body_size;

  if (!mySize) {
    return 'Add your upper and lower body size in Account Settings for a personalised fit note.';
  }

  const stocked = parseVariants(product?.size_stocks, parseVariants(product?.sizes, []));
  const parts = [];

  if (stocked.length > 0) {
    parts.push(
      stocked.some((s) => String(s).toUpperCase() === String(mySize).toUpperCase())
        ? `Your ${isLower ? 'lower' : 'upper'} body size ${mySize} is available.`
        : `Your size ${mySize} is not stocked in this piece — check the size chart below before choosing another size.`
    );
  }

  const cut = String(product?.ai_tags?.fit_type || '').toUpperCase();
  const wanted = FIT_TO_CUT[user.preferred_fit];
  if (cut && wanted) {
    parts.push(
      cut === wanted
        ? `It is cut ${CUT_WORDS[cut]}, exactly the fit you prefer.`
        : `It is cut ${CUT_WORDS[cut]}, while you prefer a ${CUT_WORDS[wanted]} fit — consider sizing ${wanted === 'LOOSE' ? 'up' : 'down'} one if you want your usual feel.`
    );
  }

  const productGender = String(product?.gender || '').toLowerCase();
  const myGender = user.gender === 'male' ? 'men' : user.gender === 'female' ? 'women' : '';
  if (myGender && productGender && productGender !== 'unisex' && productGender !== myGender) {
    parts.push(`Note: this piece is cut for ${productGender}.`);
  }

  return parts.length > 0 ? parts.join(' ') : 'This piece is a versatile fit for your saved size.';
};

/**
 * Safely parses color or size array strings from backend response.
 * Handles JSON strings, arrays, and comma-separated string formats.
 * 
 * @param {Array|string} data - Raw variant data from API.
 * @param {Array} fallback - Default fallback array.
 * @returns {Array} Parsed variants list.
 */
export const parseVariants = (data, fallback = []) => {
  if (!data) return fallback;
  if (Array.isArray(data)) return data;

  if (typeof data === 'string') {
    const trimmed = data.trim();

    // 1. A JSON object of variant -> stock, e.g. '{"L":350,"M":350}'.
    //    Handled below with the object case, so just re-dispatch.
    if (trimmed.startsWith('{')) {
      try {
        return parseVariants(JSON.parse(trimmed), fallback);
      } catch {
        return fallback;
      }
    }

    // 2. Parse JSON Array String (e.g. '["S","M","L"]')
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch {
        return fallback;
      }
    }

    // 3. Parse Comma-Separated String (e.g."Red, Blue, Green" or"S, M, L")
    if (trimmed.includes(',')) {
      return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
    }

    // 4. Single String Value (e.g."Cotton")
    return [trimmed];
  }

  /*
   * A PLAIN OBJECT — the shape `size_stocks`/`sizes` actually arrive in:
   *   { "L": 350, "M": 350 }
   *
   * This was previously unhandled and fell through to `fallback`, which is why
   * a garment stocked ONLY in L and M rendered chips for S / M / L / XL — a
   * hard-coded default list, not the real variants. Selecting one of those
   * phantom sizes could never enable "Add to Bag".
   *
   * The KEYS are the real variants; the values are stock and are handled
   * separately via `size_stocks`.
   */
  if (typeof data === 'object') {
    const keys = Object.keys(data).filter(Boolean);
    return keys.length > 0 ? keys : fallback;
  }

  return fallback;
};
/**
 * Generates personalized fit recommendations based on user measurements and product attributes.
 * 
 * @param {Object} user - User context object containing physical attributes.
 * @param {Object} product - Product context object.
 * @returns {string} Recommendation text string.
 */
export const getStylistRecommendation = (user, product) => {
  if (!user) {
    return"Login to see how this piece fits your unique measurements.";
  }
  
  const height = parseInt(user.height, 10);
  if (!user.height || isNaN(height)) {
    return"Update your height in your profile for a personalized fit analysis.";
  }

  const category = product?.category?.toLowerCase() || '';
  const name = product?.name?.toLowerCase() || '';
  const garmentType = product?.garment_type?.toLowerCase() || '';

  // Bottoms / Trousers / Pants Logic
  if (category === 'bottom' || name.includes('trouser') || name.includes('pants')) {
    if (height < 155) {
      return `At ${height}cm, these trousers might be a bit long. We recommend pairing them with platform shoes or a slight hem adjustment to keep the aesthetic clean.`;
    }
    return `Your height of ${height}cm is ideal for this cut. It will fall perfectly at your ankles.`;
  }

  // Gowns & Full Body Garments
  if (category === 'gown' || garmentType === 'full_body' || garmentType === 'dress') {
    if (height < 155) {
      return `For your petite frame (${height}cm), we suggest pairing this gown with 3-4 inch heels to elevate the silhouette and prevent the hem from dragging.`;
    }
    return `This gown is designed to complement your stature perfectly. No major adjustments needed!`;
  }

  return"This piece is a versatile fit for your current measurements.";
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
/**
 * SINGLE SOURCE OF TRUTH for product AI-styling option values.
 *
 * The Admin console (AiAttributesTab) and the Super Admin console (InventoryTab)
 * used to hard-code their OWN, DIFFERENT lists for occasions and body shapes.
 * A garment tagged "BUSINESS" in one console could not match "SMART_CASUAL" in
 * the other, so the AI stylist silently failed to pair items that were, in fact,
 * the same vibe. These constants now back BOTH consoles AND the backend
 * ProductRequest validation, so the vocabulary can never drift again.
 *
 * If you add or rename a value here, mirror it in the backend `ProductRequest`
 * rule for `occasions.*` / `body_shapes.*` (see ProductRequest::rules()).
 */

/** Canonical occasions/events a garment can be tagged for. */
export const OCCASIONS = [
  { value: 'CASUAL', label: 'Casual' },
  { value: 'FORMAL', label: 'Formal / Gala' },
  { value: 'BUSINESS', label: 'Business / Smart Casual' },
  { value: 'PARTY', label: 'Party / Night Out' },
  { value: 'STREETWEAR', label: 'Streetwear' },
  { value: 'MINIMALIST', label: 'Minimalist' },
  { value: 'TRADITIONAL', label: 'Traditional / Cultural' },
];

/** Canonical body shapes a garment flatters. */
export const BODY_SHAPES = [
  { value: 'HOURGLASS', label: 'Hourglass' },
  { value: 'PEAR', label: 'Pear' },
  { value: 'APPLE', label: 'Apple' },
  { value: 'RECTANGLE', label: 'Rectangle' },
  { value: 'INVERTED_TRIANGLE', label: 'Inverted Triangle' },
];

/** Color undertones a garment best suits. */
export const UNDERTONES = [
  { value: 'WARM', label: 'Warm Undertone' },
  { value: 'COOL', label: 'Cool Undertone' },
  { value: 'NEUTRAL', label: 'Neutral' },
];

/** Garment fit. */
export const FIT_TYPES = [
  { value: 'SLIM', label: 'Slim Fit' },
  { value: 'REGULAR', label: 'Regular Fit' },
  { value: 'LOOSE', label: 'Oversized / Loose' },
];

/** Plain value arrays (for selects / validation-style checks). */
export const OCCASION_VALUES = OCCASIONS.map((o) => o.value);
export const BODY_SHAPE_VALUES = BODY_SHAPES.map((b) => b.value);
export const UNDERTONE_VALUES = UNDERTONES.map((u) => u.value);
export const FIT_TYPE_VALUES = FIT_TYPES.map((f) => f.value);

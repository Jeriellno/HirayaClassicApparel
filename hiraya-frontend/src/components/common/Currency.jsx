import React from 'react';

/**
 * Resolve the renderable currency symbol.
 *
 * The Philippine peso sign is U+20B1. We compare against a literal escape
 * rather than trusting the source byte sequence, so the intent survives any
 * editor/tooling that might re-encode the file.
 */
const PESO = '\u20B1';

/**
 * Format a numeric amount as Philippine pesos.
 *
 * @param {number|string} amount
 * @param {Object}  [options]
 * @param {boolean} [options.decimals=true]  Show two decimal places.
 * @returns {string} e.g. "₱1,234.50"
 */
export const formatPeso = (amount, { decimals = true } = {}) => {
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;

    const formatted = decimals
        ? safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : safe.toLocaleString();

    return `${PESO}${formatted}`;
};

/**
 * Renders a peso amount with a GLYPH-SAFE font.
 *
 * WHY THIS COMPONENT EXISTS
 * -------------------------
 * Neither `Plus Jakarta Sans` nor `Cinzel` — the two display faces this app
 * loads — contains a glyph for the peso sign (U+20B1). When an element is
 * styled with one of those families and shows a price, the browser finds no
 * glyph and paints a fallback box, which reads on screen as a plain "?".
 *
 * The `.currency` class pins a stack that DOES cover U+20B1 (`Segoe UI` on
 * Windows, `Noto Sans` elsewhere) and enables tabular figures so prices line up
 * in tables and lists. Routing every price through this one component means a
 * future font change cannot silently break the symbol again.
 *
 * Props are spread onto the underlying element so callers keep full control of
 * size, colour and layout.
 */
const Currency = ({ amount, decimals = true, symbol = PESO, className = '', as: Tag = 'span', ...rest }) => {
    const value = Number(amount);
    const safe = Number.isFinite(value) ? value : 0;

    const formatted = decimals
        ? safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : safe.toLocaleString();

    return (
        <Tag className={`currency ${className}`.trim()} {...rest}>
            {symbol}
            {formatted}
        </Tag>
    );
};

export { PESO };
export default Currency;

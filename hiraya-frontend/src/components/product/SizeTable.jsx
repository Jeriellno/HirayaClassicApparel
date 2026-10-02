import PropTypes from 'prop-types';
import { isLowerBodyGarment } from '../../utils/categoryHelpers';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', 'XXL', '3XL'];

// The store's standard chart (mirrors App\Services\SizeChart), used for any
// stocked size the product has no measurements saved for.
const STANDARD = {
  XS: { chest_bust: 81, waist: 63, hips: 87, shoulder_width: 37, sleeve_length: 57 },
  S: { chest_bust: 88, waist: 70, hips: 94, shoulder_width: 39.5, sleeve_length: 59.5 },
  M: { chest_bust: 95, waist: 77, hips: 101, shoulder_width: 41.5, sleeve_length: 61.5 },
  L: { chest_bust: 102, waist: 84, hips: 108, shoulder_width: 43.5, sleeve_length: 63.5 },
  XL: { chest_bust: 109, waist: 91, hips: 115, shoulder_width: 45.5, sleeve_length: 65.5 },
  '2XL': { chest_bust: 116.5, waist: 98.5, hips: 122.5, shoulder_width: 47.5, sleeve_length: 67.5 },
};

const COLUMNS = {
  upper: [
    ['chest_bust', 'Chest'],
    ['waist', 'Waist'],
    ['shoulder_width', 'Shoulder'],
    ['sleeve_length', 'Sleeve'],
  ],
  lower: [
    ['waist', 'Waist'],
    ['hips', 'Hip'],
  ],
};

export const sortSizes = (sizes) =>
  [...sizes].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(String(a).toUpperCase());
    const ib = SIZE_ORDER.indexOf(String(b).toUpperCase());
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

/*
 * SIZE GUIDE — the product's OWN measurements.
 *
 * This used to print one of two hard-coded example tables (a trouser table for
 * anything not literally called "tops", so a barong showed waist / hip /
 * inseam). It now reads `size_measurements`, which the backend fills from the
 * store's size chart for every size the garment is stocked in, and picks the
 * upper- or lower-body columns from the category.
 */
const SizeTable = ({ category = '', name = '', measurements = null, sizes: stocked = [], highlight = '' }) => {
  const columns = isLowerBodyGarment(category, name) ? COLUMNS.lower : COLUMNS.upper;

  const table = { ...(measurements && typeof measurements === 'object' ? measurements : {}) };
  stocked.forEach((size) => {
    const key = String(size).toUpperCase();
    if (!table[size] && STANDARD[key]) table[size] = STANDARD[key];
  });
  const sizes = sortSizes(Object.keys(table)).filter((size) => table[size] && typeof table[size] === 'object');
  const shown = columns.filter(([key]) => sizes.some((size) => table[size][key] != null));

  if (sizes.length === 0 || shown.length === 0) {
    return (
      <p className="mt-4 text-[11px] leading-relaxed text-hiraya-ink-muted">
        Measurements for this piece are not available yet. Message us and we will measure it for you.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink">Size Guide (cm)</p>
        <span className="text-[9px] text-hiraya-ink-muted">*Body measurements each size fits</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-t border-hiraya-structure-line text-left text-[11px] tracking-wider">
          <thead>
            <tr className="text-hiraya-ink-muted">
              <th className="border-b border-hiraya-structure-line py-3 font-semibold uppercase">Size</th>
              {shown.map(([key, label]) => (
                <th key={key} className="border-b border-hiraya-structure-line py-3 font-semibold uppercase">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-hiraya-ink-soft">
            {sizes.map((size) => (
              <tr
                key={size}
                className={`border-b border-hiraya-structure-line transition-colors hover:bg-hiraya-accent-wash ${
                  size === highlight ? 'bg-hiraya-accent-wash' : ''
                }`}
              >
                <td className="py-3 font-semibold text-hiraya-ink">
                  {size}
                  {size === highlight && <span className="ml-1.5 text-[9px] text-hiraya-ink-muted">(yours)</span>}
                </td>
                {shown.map(([key]) => (
                  <td key={key} className="py-3 font-normal">
                    {table[size][key] != null ? `${table[size][key]} cm` : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-hiraya-ink-muted">
        Tip: If you&apos;re between sizes, size up for a more relaxed, Hiraya-style fit.
      </p>
    </div>
  );
};

SizeTable.propTypes = {
  category: PropTypes.string,
  name: PropTypes.string,
  measurements: PropTypes.object,
  sizes: PropTypes.arrayOf(PropTypes.string),
  highlight: PropTypes.string,
};

export default SizeTable;

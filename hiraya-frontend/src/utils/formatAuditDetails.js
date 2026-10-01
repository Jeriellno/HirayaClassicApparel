/*
 * DISPLAY-ONLY simplification of PRODUCTS audit entries.
 *
 * The backend stores a detailed, database-style sentence (ids, raw field names,
 * "old -> new" diffs). That stored text is left untouched; this only turns it
 * into a short, readable line for the Audit Logs table. Anything that does not
 * match a known product shape is returned as-is.
 */

const FIELD_LABELS = {
  name: 'Name',
  description: 'Description',
  price: 'Price',
  category: 'Category',
  stock: 'Stock',
  body_shapes: 'Body Shapes',
  undertone: 'Undertone',
  occasions: 'Occasions',
  fit_type: 'Fit Type',
  sku: 'SKU',
};

// Fields whose value is too long to be worth showing inline.
const LABEL_ONLY = new Set(['description']);

// Keeps each entry to 1–2 lines.
const MAX_CHANGES = 4;

const EMPTY = new Set(['', '—', '--', '-', 'null']);

export const formatPeso = (value) => {
  const n = Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(value);
  return `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

// "REGULAR" -> "Regular", "button_down" -> "Button Down"
const titleCase = (value) =>
  String(value)
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const describeChange = (field, newValue) => {
  const label = FIELD_LABELS[field] || titleCase(field);
  const value = newValue.trim();

  if (EMPTY.has(value)) return `${label} cleared`;
  if (LABEL_ONLY.has(field)) return label;
  if (field === 'price') return `${label} ${formatPeso(value)}`;
  if (field === 'name' || field === 'sku' || field === 'stock') return `${label} ${value}`;
  return `${label} ${titleCase(value)}`;
};

const summarizeChanges = (changes) => {
  // "price: 460.00 -> 460; stock: 0 -> 50" — split only where a new field starts,
  // so a value that itself contains "; " stays intact.
  const parts = changes
    .split(/;\s(?=[a-z_]+:\s)/)
    .map((part) => part.match(/^([a-z_]+):\s[\s\S]*?\s->\s([\s\S]*)$/))
    .filter(Boolean)
    .map(([, field, newValue]) => describeChange(field, newValue));

  if (parts.length === 0) return '';
  const shown = parts.slice(0, MAX_CHANGES).join(', ');
  const extra = parts.length - MAX_CHANGES;
  return extra > 0 ? `${shown} and ${extra} more` : shown;
};

export const simplifyProductDetails = (details) => {
  if (typeof details !== 'string') return details;
  const text = details.trim();
  let m;

  // New product #12 (Name) created at 599.00 with 20 in stock.
  if ((m = text.match(/^New product #\d+ \(([\s\S]*)\) created at (\S+) with (\S+) in stock\.?$/))) {
    return `${m[1]} was added: Price ${formatPeso(m[2])}, Stock ${m[3]}.`;
  }

  // Product #48 (Name) edited. Changed — a: x -> y; b: ...   |   ... No tracked field changed.
  if ((m = text.match(/^Product #\d+ \(([\s\S]*)\) edited\.(?:\s*Changed\s*[—-]+\s*([\s\S]*))?/))) {
    const summary = m[2] ? summarizeChanges(m[2]) : '';
    return summary ? `${m[1]} was updated: ${summary}.` : `${m[1]} was updated.`;
  }

  // Product #39 (Name) deleted from the catalog; it was listed at 599.00.
  if ((m = text.match(/^Product #\d+ \(([\s\S]*)\) deleted from the catalog/))) {
    return `${m[1]} was deleted.`;
  }

  // AI styling tags for product #12 (Name) set to {...}.
  if ((m = text.match(/^AI styling tags for product #\d+ \(([\s\S]*)\) set to/))) {
    return `${m[1]}'s AI styling tags were updated.`;
  }

  return details;
};

/** The text shown in the Details column for any audit row. */
export const displayAuditDetails = (log) => {
  const raw = typeof log.details === 'object' && log.details !== null ? JSON.stringify(log.details) : log.details;
  if (!raw) return 'System configuration updated.';
  return log.target === 'PRODUCTS' ? simplifyProductDetails(raw) : raw;
};

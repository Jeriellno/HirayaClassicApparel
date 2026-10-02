import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Loader2, Minus, Plus, X } from 'lucide-react';
import { parseApiError } from '../../../api/axios';

const REASONS = ['Walk-in sale', 'Restock', 'Recount', 'Damaged / defective'];

const asObject = (value) => {
  if (typeof value === 'string') {
    try { return JSON.parse(value) || {}; } catch { return {}; }
  }
  return value && typeof value === 'object' ? value : {};
};

/** Every colour of a product with its per-size stock: the main colour first. */
const colourOptions = (product) => {
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const main = { key: '', label: colors[0] || 'Main colour', sizes: asObject(product.size_stocks) };
  const raw = Array.isArray(product.color_variants)
    ? product.color_variants
    : Object.values(asObject(product.color_variants));
  const variants = raw
    .filter((v) => v && v.color)
    .map((v) => ({ key: v.color, label: v.color, sizes: asObject(v.size_stocks) }));
  return [main, ...variants];
};

/**
 * QUICK ADJUST — add or remove units for one size of one colour (walk-in
 * sales, recounts, restocks). The server applies the change to the CURRENT
 * count, so an online order placed while this is open is never overwritten,
 * and every adjustment lands in Stock History with its reason.
 */
const StockAdjustModal = ({ product, onClose, onSubmit }) => {
  const colours = useMemo(() => colourOptions(product), [product]);
  const [colourKey, setColourKey] = useState(colours[0]?.key ?? '');
  const colour = colours.find((c) => c.key === colourKey) || colours[0];
  const sizes = Object.keys(colour?.sizes || {});
  const [size, setSize] = useState(sizes[0] || '');
  const [direction, setDirection] = useState(-1);
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState(REASONS[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const current = Number(colour?.sizes?.[size] ?? 0);
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const delta = direction * qty;
  const next = current + delta;
  const invalid = !size || qty < 1 || next < 0 || reason.trim().length < 2;

  const pickColour = (key) => {
    setColourKey(key);
    const first = Object.keys(colours.find((c) => c.key === key)?.sizes || {})[0] || '';
    setSize(first);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (invalid) return;
    setSaving(true);
    setError('');
    try {
      await onSubmit(product.id, { size, color: colour.key || null, delta, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(parseApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full rounded-lg border border-hiraya-structure-line bg-hiraya-surface px-3 py-2 text-[12px] text-hiraya-ink focus:outline-none focus:ring-2 focus:ring-hiraya-focus';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy-900/40 p-4" role="dialog" aria-modal="true" aria-label={`Adjust stock for ${product.name}`}>
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-[22px] bg-hiraya-surface p-6 shadow-neu">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-hiraya-ink-muted">Quick adjust stock</p>
            <p className="truncate text-sm font-semibold text-hiraya-ink">{product.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg p-1.5 text-hiraya-ink-muted hover:text-hiraya-ink"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1 text-[10px] uppercase tracking-[0.14em] text-hiraya-ink-muted">
            Colour
            <select value={colourKey} onChange={(e) => pickColour(e.target.value)} className={field}>
              {colours.map((c) => <option key={c.key || 'main'} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-[10px] uppercase tracking-[0.14em] text-hiraya-ink-muted">
            Size
            <select value={size} onChange={(e) => setSize(e.target.value)} className={field} disabled={sizes.length === 0}>
              {sizes.map((s) => <option key={s} value={s}>{s} ({Number(colour.sizes[s] || 0)} in stock)</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-[auto_1fr] items-end gap-3">
          <div className="flex overflow-hidden rounded-lg border border-hiraya-structure-line" role="group" aria-label="Add or remove">
            {[[-1, Minus, 'Remove'], [1, Plus, 'Add']].map(([dir, Icon, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setDirection(dir)}
                aria-pressed={direction === dir}
                className={`flex cursor-pointer items-center gap-1 px-3 py-2 text-[11px] font-semibold ${direction === dir ? 'bg-navy-900 text-cream-100' : 'text-hiraya-ink'}`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>
          <label className="space-y-1 text-[10px] uppercase tracking-[0.14em] text-hiraya-ink-muted">
            Quantity
            <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={field} />
          </label>
        </div>

        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-hiraya-ink-muted">Reason</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`cursor-pointer rounded-full border px-2.5 py-1 text-[10px] ${reason === r ? 'border-navy-900 bg-navy-900 text-cream-100' : 'border-hiraya-structure-line text-hiraya-ink'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <input type="text" value={reason} maxLength={60} onChange={(e) => setReason(e.target.value)} className={field} aria-label="Reason" />
        </div>

        <p className={`rounded-lg px-3 py-2 text-[11px] ${next < 0 ? 'bg-red-500/10 text-red-700' : 'bg-cream-200/60 text-hiraya-ink'}`}>
          {size ? `Size ${size}: ${current} → ${next < 0 ? `only ${current} left` : next}` : 'This colour has no sizes to adjust.'}
        </p>

        {error && <p className="text-[11px] text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg px-4 py-2 text-[11px] text-hiraya-ink">Cancel</button>
          <button type="submit" disabled={invalid || saving} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-[11px] font-semibold text-cream-100 disabled:cursor-not-allowed disabled:opacity-50">
            {saving && <Loader2 size={12} className="animate-spin" />} Save adjustment
          </button>
        </div>
      </form>
    </div>
  );
};

StockAdjustModal.propTypes = {
  product: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    name: PropTypes.string,
    colors: PropTypes.array,
    size_stocks: PropTypes.oneOfType([PropTypes.object, PropTypes.string]),
    color_variants: PropTypes.oneOfType([PropTypes.array, PropTypes.string]),
  }).isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default StockAdjustModal;

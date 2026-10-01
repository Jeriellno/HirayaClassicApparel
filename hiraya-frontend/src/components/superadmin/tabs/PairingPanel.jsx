import { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Link2, Search, X, AlertTriangle } from 'lucide-react';
import { getProductImageUrl } from '../../../utils/imageHelper';
import { canPair, MAX_PAIRS } from '../../../utils/garmentPairing';

/**
 * "PAIR WITH" — the admin half of garment pairing.
 *
 * Lets the admin pick catalog pieces that complete this one (a polo with a
 * coat, a top with trousers). Only COMPATIBLE pieces are offered — the rule in
 * utils/garmentPairing.js — and the backend re-checks it on save. A pairing is
 * symmetric: pairing the polo with the coat also shows the polo on the coat.
 *
 * If the admin changes this product's category after picking, pairs that no
 * longer fit are flagged here and left out of the save (see InventoryTab).
 */
const PairingPanel = ({ products, currentId, category, selectedIds, onChange, disabled }) => {
  const [query, setQuery] = useState('');

  const byId = useMemo(() => new Map(products.map((p) => [Number(p.id), p])), [products]);

  const selected = selectedIds.map((id) => byId.get(Number(id))).filter(Boolean);

  const candidates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return products.filter((p) => {
      if (Number(p.id) === Number(currentId)) return false;
      if (selectedIds.includes(Number(p.id))) return false;
      if (!canPair(category, p.category)) return false;
      if (!term) return true;
      return `${p.name} ${p.category}`.toLowerCase().includes(term);
    });
  }, [products, currentId, selectedIds, category, query]);

  const atLimit = selectedIds.length >= MAX_PAIRS;
  const categoryLabel = String(category || '').toLowerCase().replace(/_/g, ' ');

  const add = (id) => {
    if (atLimit) return;
    onChange([...selectedIds, Number(id)]);
  };
  const remove = (id) => onChange(selectedIds.filter((x) => Number(x) !== Number(id)));

  const thumb = (p) => {
    const raw = p.display_image_url || p.image_url;
    return raw ? getProductImageUrl(raw) : '/images/placeholder.svg';
  };

  let emptyText = `No compatible pieces for ${categoryLabel}.`;
  if (products.length <= 1) emptyText = 'Add more products to the catalog to pair them.';
  else if (query) emptyText = 'No compatible pieces match that search.';

  return (
    <div className="rounded-2xl border border-hiraya-structure-line/80 bg-cream-200/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-wider text-hiraya-ink">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[10px] text-cream-100">5</span>
          <span className="flex items-center gap-1.5"><Link2 size={12} /> Pair with</span>
          <span className="font-normal normal-case tracking-normal text-hiraya-ink-muted">(optional)</span>
        </p>
        <span className="text-[9px] uppercase tracking-wider text-hiraya-ink-muted tabular-nums">
          {selectedIds.length} / {MAX_PAIRS}
        </span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-hiraya-ink-muted">
        Pieces that complete this look, e.g. a polo with a coat. Customers see them as
        {' '}&ldquo;Complete the Look&rdquo; and can wear them together in the try-on.
      </p>

      {selected.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {selected.map((p) => {
            const fits = canPair(category, p.category);
            return (
              <li
                key={p.id}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-2 text-[10px] ${fits
                  ? 'border-hiraya-structure-line bg-hiraya-surface text-hiraya-ink'
                  : 'border-amber-600/50 bg-amber-500/15 text-amber-800'}`}
                title={fits ? p.category : `No longer fits ${categoryLabel}; it will not be saved`}
              >
                <img src={thumb(p)} alt="" className="h-6 w-6 rounded-full object-cover bg-cream-200" />
                <span className="max-w-[9rem] truncate font-semibold">{p.name}</span>
                {!fits && <AlertTriangle size={11} />}
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={disabled}
                  aria-label={`Unpair ${p.name}`}
                  className="cursor-pointer rounded-full p-0.5 hover:bg-cream-200 disabled:cursor-not-allowed"
                >
                  <X size={11} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="relative mt-3">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-hiraya-sand" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pieces to pair…"
          aria-label="Search pieces to pair"
          disabled={disabled}
          className="w-full rounded-xl border border-hiraya-ink/10 bg-cream-200/55 py-2 pl-8 pr-3 text-[11px] text-hiraya-ink shadow-neu-inset focus:border-hiraya-accent focus:outline-none"
        />
      </div>

      <div className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-1">
        {candidates.length === 0 ? (
          <p className="py-3 text-center text-[10px] text-hiraya-ink-muted">{emptyText}</p>
        ) : (
          candidates.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => add(p.id)}
              disabled={disabled || atLimit}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-cream-200/70 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <img src={thumb(p)} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover bg-cream-200" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-hiraya-ink">{p.name}</span>
                <span className="block text-[9px] uppercase tracking-wider text-hiraya-ink-muted">{p.category}</span>
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-hiraya-accent">+ Pair</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

PairingPanel.propTypes = {
  products: PropTypes.array.isRequired,
  currentId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  category: PropTypes.string,
  selectedIds: PropTypes.arrayOf(PropTypes.number).isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

export default PairingPanel;

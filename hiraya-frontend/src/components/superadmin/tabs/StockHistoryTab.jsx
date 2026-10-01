import { useCallback, useEffect, useMemo, useState } from 'react';
import { History, RefreshCw, Loader2 } from 'lucide-react';
import api from '../../../api/axios';

/*
 * STOCK HISTORY — every change to a product's stock, newest first.
 *
 * The backend has recorded these all along (`product_stock_movements`, written
 * by the Product model on every stock change: inventory edits, checkouts and
 * rejected-payment restocks) and served them at /admin/stock-adjustments, but
 * no screen ever showed them. Staff use this to answer "why did the M count
 * drop?" without asking the superadmin to read the audit log.
 */

const sizeDiff = (before, after) => {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .map((size) => ({ size, from: Number(b[size] ?? 0), to: Number(a[size] ?? 0) }))
    .filter((d) => d.from !== d.to);
};

export default function StockHistoryTab() {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [productId, setProductId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/stock-adjustments', {
        params: { limit: 100, ...(productId ? { product_id: productId } : {}) },
      });
      setRows(res.data?.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Stock history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api.get('/products')
      .then((res) => setProducts(Array.isArray(res.data) ? res.data : res.data?.data || []))
      .catch(() => setProducts([]));
  }, []);

  const options = useMemo(() => [...products].sort((a, b) => String(a.name).localeCompare(String(b.name))), [products]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-serif text-2xl uppercase tracking-[0.05em] text-navy-900">
            <History size={20} /> Stock History
          </h2>
          <p className="mt-1 text-[11px] text-hiraya-ink-muted">Every stock change: inventory edits, checkouts and restocks from rejected payments.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Filter by product"
            className="rounded-xl border border-hiraya-structure-line bg-hiraya-cream-deep px-3 py-2 text-[11px] text-hiraya-ink focus:border-hiraya-accent focus:outline-none"
          >
            <option value="">All products</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-hiraya-structure-line px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-hiraya-ink transition hover:bg-navy-900/5 disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-600/40 bg-red-500/12 px-3 py-2 text-[11px] text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-[20px] bg-hiraya-surface shadow-neu ring-1 ring-cream-50/80">
        <table className="w-full min-w-[640px] text-left text-[11px]">
          <thead>
            <tr className="border-b border-hiraya-structure-line text-[9px] uppercase tracking-widest text-hiraya-ink-muted">
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Sizes changed</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">By</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-b border-hiraya-structure-line/60">
                  <td colSpan={6} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-cream-200/70" /></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-hiraya-ink-muted">No stock changes recorded yet.</td>
              </tr>
            ) : (
              rows.map((m) => {
                const diffs = sizeDiff(m.before_size_stocks, m.after_size_stocks);
                const delta = Number(m.after_stock ?? 0) - Number(m.before_stock ?? 0);
                return (
                  <tr key={m.id} className="border-b border-hiraya-structure-line/60 transition-colors hover:bg-hiraya-accent-wash">
                    <td className="whitespace-nowrap px-4 py-3 text-hiraya-ink-muted">{m.created_at ? new Date(m.created_at).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 font-semibold text-hiraya-ink">{m.product_name || `#${m.product_id}`}</td>
                    <td className="px-4 py-3 text-hiraya-ink">
                      {diffs.length === 0 ? '—' : diffs.map((d) => `${d.size}: ${d.from}→${d.to}`).join(', ')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {m.before_stock == null ? (
                        <span className="text-emerald-700">New · {m.after_stock}</span>
                      ) : (
                        <span className={delta < 0 ? 'text-red-700' : 'text-emerald-700'}>
                          {m.before_stock} → {m.after_stock} ({delta > 0 ? '+' : ''}{delta})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-hiraya-ink-muted">{m.source || '—'}</td>
                    <td className="px-4 py-3 text-hiraya-ink-muted">{m.user?.full_name || 'System'}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

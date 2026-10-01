import { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { Receipt, Wallet, PackageCheck, Truck, AlertTriangle, History, RefreshCw, Loader2, ArrowRight } from 'lucide-react';
import api from '../../../api/axios';

/*
 * OPERATIONS OVERVIEW — the staff (admin) landing screen.
 *
 * A staff member's day is a queue, not a chart: which payments are waiting to
 * be verified, which orders are paid and need packing or shipping, and which
 * pieces are about to sell out. Everything here comes from endpoints the
 * `admin` role is already allowed to call (/admin/orders, /products,
 * /admin/stock-adjustments), so it adds no new permission.
 */

const LOW_STOCK = 5;

const queueOf = (orders) => {
  const open = orders.filter((o) => o.order_status !== 'rejected');
  return {
    verifyDp: open.filter((o) => o.payment_status === 'pending' && o.dp_proof_image_path),
    verifyBalance: open.filter((o) => o.payment_status === '50_paid' && o.full_payment_proof_image_path),
    toShip: open.filter((o) => o.payment_status === 'fully_paid' && ['processing', 'ready_for_shipping'].includes(o.order_status)),
    inTransit: open.filter((o) => o.order_status === 'shipped'),
  };
};

const lowStockOf = (products) => {
  const rows = [];
  products.forEach((p) => {
    const stocks = p.size_stocks && typeof p.size_stocks === 'object' ? p.size_stocks : {};
    Object.entries(stocks).forEach(([size, qty]) => {
      if (Number(qty) <= LOW_STOCK) rows.push({ id: `${p.id}-${size}`, name: p.name, color: (p.colors || [])[0] || '', size, qty: Number(qty) });
    });
    (Array.isArray(p.color_variants) ? p.color_variants : []).forEach((v) => {
      Object.entries(v.size_stocks || {}).forEach(([size, qty]) => {
        if (Number(qty) <= LOW_STOCK) rows.push({ id: `${p.id}-${v.id}-${size}`, name: v.name || p.name, color: v.color, size, qty: Number(qty) });
      });
    });
  });
  return rows.sort((a, b) => a.qty - b.qty).slice(0, 8);
};

export default function StaffOverviewTab({ onOpenSection }) {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [o, p, m] = await Promise.allSettled([
      api.get('/admin/orders'),
      api.get('/products'),
      api.get('/admin/stock-adjustments', { params: { limit: 6 } }),
    ]);
    if (o.status === 'fulfilled') setOrders(Array.isArray(o.value.data) ? o.value.data : o.value.data?.data || []);
    if (p.status === 'fulfilled') setProducts(Array.isArray(p.value.data) ? p.value.data : p.value.data?.data || []);
    if (m.status === 'fulfilled') setMovements(m.value.data?.data || []);
    if ([o, p, m].some((r) => r.status === 'rejected')) setError('Some figures could not be loaded. Press refresh to try again.');
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const queue = useMemo(() => queueOf(orders), [orders]);
  const lowStock = useMemo(() => lowStockOf(products), [products]);

  const cards = [
    { key: 'dp', label: 'Down payments to verify', count: queue.verifyDp.length, icon: Receipt, tone: 'text-amber-700' },
    { key: 'bal', label: 'Balances to confirm', count: queue.verifyBalance.length, icon: Wallet, tone: 'text-amber-700' },
    { key: 'ship', label: 'Paid — pack & ship', count: queue.toShip.length, icon: PackageCheck, tone: 'text-sky-800' },
    { key: 'transit', label: 'Shipped — in transit', count: queue.inTransit.length, icon: Truck, tone: 'text-emerald-700' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl uppercase tracking-[0.05em] text-navy-900">Today&apos;s work</h2>
          <p className="mt-1 text-[11px] text-hiraya-ink-muted">Payments waiting on you, orders ready to move, and stock running low.</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-hiraya-structure-line px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-hiraya-ink transition hover:bg-navy-900/5 disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-red-600/40 bg-red-500/12 px-3 py-2 text-[11px] text-red-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.button
              key={card.key}
              type="button"
              onClick={() => onOpenSection('orders')}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="group rounded-[20px] bg-hiraya-surface p-4 text-left shadow-neu ring-1 ring-cream-50/80 transition hover:-translate-y-0.5 cursor-pointer"
            >
              <Icon size={18} className={card.tone} />
              <p className="mt-3 font-serif text-3xl text-navy-900">{loading ? '—' : card.count}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted">
                {card.label} <ArrowRight size={11} className="opacity-0 transition group-hover:opacity-100" />
              </p>
            </motion.button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-[20px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-hiraya-ink">
              <AlertTriangle size={13} className="text-amber-700" /> Low stock (≤ {LOW_STOCK})
            </h3>
            <button type="button" onClick={() => onOpenSection('inventory')} className="text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted hover:text-hiraya-ink cursor-pointer">
              Inventory →
            </button>
          </div>
          {loading ? (
            <div className="h-24 animate-pulse rounded-xl bg-cream-200/60" />
          ) : lowStock.length === 0 ? (
            <p className="text-[11px] text-hiraya-ink-muted">Every size is well stocked.</p>
          ) : (
            <ul className="divide-y divide-hiraya-structure-line/70 text-[11px]">
              {lowStock.map((row) => (
                <li key={row.id} className="flex items-center justify-between py-2">
                  <span className="text-hiraya-ink">
                    {row.name}
                    <span className="ml-1.5 text-hiraya-ink-muted">{[row.color, `size ${row.size}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`font-semibold ${row.qty === 0 ? 'text-red-700' : 'text-amber-700'}`}>{row.qty === 0 ? 'Sold out' : `${row.qty} left`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[20px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-hiraya-ink">
              <History size={13} /> Latest stock changes
            </h3>
            <button type="button" onClick={() => onOpenSection('stock-history')} className="text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted hover:text-hiraya-ink cursor-pointer">
              Full history →
            </button>
          </div>
          {loading ? (
            <div className="h-24 animate-pulse rounded-xl bg-cream-200/60" />
          ) : movements.length === 0 ? (
            <p className="text-[11px] text-hiraya-ink-muted">No stock changes recorded yet.</p>
          ) : (
            <ul className="divide-y divide-hiraya-structure-line/70 text-[11px]">
              {movements.map((m) => {
                const delta = Number(m.after_stock ?? 0) - Number(m.before_stock ?? 0);
                return (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-hiraya-ink">
                      {m.product_name}
                      <span className="ml-1.5 text-hiraya-ink-muted">{m.source}</span>
                    </span>
                    <span className={`shrink-0 font-semibold ${delta < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {m.before_stock == null ? `+${m.after_stock}` : `${delta > 0 ? '+' : ''}${delta}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

StaffOverviewTab.propTypes = {
  onOpenSection: PropTypes.func.isRequired,
};

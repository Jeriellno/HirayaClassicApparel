import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Wallet, PackageCheck, Truck, AlertTriangle, Package, ChevronRight, ClipboardList } from 'lucide-react';
import api from '../../../api/axios';

/*
 * ADMIN (STAFF) DASHBOARD — the work, not the analytics.
 *
 * Revenue, ratings and customer trends are the owner's dashboard. An admin
 * sees what needs doing: payments to verify, orders to pack and ship, stock
 * running low — each a click away from the section where it gets done.
 * One request: GET /admin/work-summary.
 */

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

const NEXT_STEP = (o) => {
  if (o.payment_status === 'pending') return 'Verify payment';
  if (o.payment_status === 'needs_review') return 'Review payment';
  if (o.payment_status === '50_paid') return 'Confirm balance (legacy)';
  return 'Pack & ship';
};

export default function StaffDashboard({ onOpenSection }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['console-work-summary'],
    queryFn: async () => (await api.get('/admin/work-summary')).data,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const q = data?.queue;
  const inv = data?.inventory;
  const dash = isLoading ? '…' : '—';

  const cards = [
    { key: 'dp', label: 'Down payments to verify', count: q?.verify_dp, icon: Receipt, tone: 'text-amber-700', to: 'orders' },
    { key: 'bal', label: 'Balances to confirm', count: q?.verify_balance, icon: Wallet, tone: 'text-amber-700', to: 'orders' },
    { key: 'ship', label: 'Paid — pack & ship', count: q?.to_ship, icon: PackageCheck, tone: 'text-sky-800', to: 'orders' },
    { key: 'transit', label: 'Shipped — in transit', count: q?.in_transit, icon: Truck, tone: 'text-emerald-700', to: 'orders' },
  ];

  return (
    <div className="space-y-4 animate-fadeIn">
      <h2 className="flex items-center gap-2 font-serif text-[clamp(1.15rem,1.8vw,1.5rem)] uppercase tracking-[0.05em] text-navy-900">
        <ClipboardList size={20} /> My Work
      </h2>

      {isError && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-2.5 text-[11px] text-charcoal-600 shadow-neu-inset">
          Your work summary could not be loaded.
          <button type="button" onClick={() => refetch()} className="btn-quiet cursor-pointer">Try again</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onOpenSection?.(c.to)}
              className="group rounded-[20px] bg-hiraya-surface p-4 text-left shadow-neu ring-1 ring-cream-50/80 transition hover:-translate-y-0.5 cursor-pointer"
            >
              <Icon size={18} className={c.tone} />
              <p className="mt-3 font-serif text-3xl text-navy-900 tabular-nums">{c.count ?? dash}</p>
              <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted">
                {c.label} <ChevronRight size={11} className="opacity-0 transition group-hover:opacity-100" />
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-[20px] bg-hiraya-surface p-4 shadow-neu ring-1 ring-cream-50/80">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-hiraya-ink">
              <Receipt size={13} /> Orders waiting on you
            </h3>
            <button type="button" onClick={() => onOpenSection?.('orders')} className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted hover:text-hiraya-ink">
              Orders →
            </button>
          </div>
          {isLoading ? (
            <div className="h-24 animate-pulse rounded-xl bg-cream-200/60" />
          ) : !data?.needs_action?.length ? (
            <p className="text-[11px] text-hiraya-ink-muted">Nothing waiting — all caught up.</p>
          ) : (
            <ul className="divide-y divide-hiraya-structure-line/70 text-[11px]">
              {data.needs_action.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-hiraya-ink">
                    <strong>#{o.id}</strong> {o.customer_name}
                    {o.is_demo && <span className="ml-1.5 rounded bg-sky-500/15 px-1 text-[8px] font-bold text-sky-900">DEMO</span>}
                    <span className="ml-1.5 text-hiraya-ink-muted">{peso(o.total_amount)}</span>
                  </span>
                  <span className="shrink-0 font-semibold text-amber-800">{NEXT_STEP(o)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[20px] bg-hiraya-surface p-4 shadow-neu ring-1 ring-cream-50/80">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-hiraya-ink">
              <Package size={13} /> Inventory
            </h3>
            <button type="button" onClick={() => onOpenSection?.('inventory')} className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted hover:text-hiraya-ink">
              Inventory →
            </button>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {[
              ['Products', inv?.products, 'text-navy-900'],
              ['Sizes low (≤ 5)', inv?.low_stock_sizes, inv?.low_stock_sizes ? 'text-amber-700' : 'text-navy-900'],
              ['Sold out', inv?.out_of_stock, inv?.out_of_stock ? 'text-red-700' : 'text-navy-900'],
            ].map(([label, value, tone]) => (
              <div key={label} className="rounded-xl bg-cream-200/45 px-2 py-2.5 shadow-neu-inset">
                <p className={`text-xl font-semibold tabular-nums ${tone}`}>{value ?? dash}</p>
                <p className="text-[9px] uppercase tracking-wider text-hiraya-ink-muted">{label}</p>
              </div>
            ))}
          </div>
          {inv?.low_stock?.length > 0 ? (
            <ul className="divide-y divide-hiraya-structure-line/70 text-[11px]">
              {inv.low_stock.map((row, i) => (
                <li key={`${row.product_id}-${row.color}-${row.size}-${i}`} className="flex items-center justify-between py-1.5">
                  <span className="min-w-0 truncate text-hiraya-ink">
                    <AlertTriangle size={11} className="mr-1 inline text-amber-700" />
                    {row.name}
                    <span className="ml-1.5 text-hiraya-ink-muted">{[row.color, `size ${row.size}`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={`shrink-0 font-semibold ${row.qty === 0 ? 'text-red-700' : 'text-amber-700'}`}>{row.qty === 0 ? 'Sold out' : `${row.qty} left`}</span>
                </li>
              ))}
            </ul>
          ) : (
            !isLoading && <p className="text-[11px] text-hiraya-ink-muted">Every size is well stocked.</p>
          )}
        </section>
      </div>
    </div>
  );
}

StaffDashboard.propTypes = { onOpenSection: PropTypes.func };

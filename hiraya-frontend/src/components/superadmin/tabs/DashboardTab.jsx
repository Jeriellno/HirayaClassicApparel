import { useState } from 'react';
import PropTypes from 'prop-types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Sparkles, Star, Package, ShieldCheck, MessageSquareText } from 'lucide-react';
import api from '../../../api/axios';
import { Panel, StatusChip } from '../ConsoleUI';
import DashboardSummary, { SUMMARY_QUERY_KEY } from '../DashboardSummary';
import DashboardCharts, { CHARTS_QUERY_KEY } from '../DashboardCharts';

const OVERVIEW_QUERY_KEY = 'console-dashboard-overview';

/* "2 hours ago" — falls back to the full date for anything older than a week. */
const timeAgo = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const steps = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return rtf.format(value, unit);
    value = Math.round(value / size);
  }
  return date.toLocaleDateString();
};

const Stars = ({ rating }) => (
  <span className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star
        key={n}
        size={13}
        className={rating >= n ? 'text-amber-500' : 'text-hiraya-structure-line'}
        fill={rating >= n ? 'currentColor' : 'none'}
      />
    ))}
  </span>
);

Stars.propTypes = { rating: PropTypes.number.isRequired };

/* One label/value line inside a right-column panel (pressed-in row). */
const MetricRow = ({ label, value, tone = 'default', hint }) => {
  const toneCls = {
    default: 'text-navy-900',
    warn: 'text-amber-700',
    danger: 'text-red-700',
    good: 'text-emerald-700',
  }[tone];
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-2.5 text-xs shadow-neu-inset">
      <span className="min-w-0 text-charcoal-600">
        {label}
        {hint && <span className="block truncate text-[10px] text-charcoal-500">{hint}</span>}
      </span>
      <span className={`shrink-0 text-sm font-semibold tabular-nums ${toneCls}`}>{value}</span>
    </li>
  );
};

MetricRow.propTypes = {
  label: PropTypes.node.isRequired,
  value: PropTypes.node.isRequired,
  tone: PropTypes.oneOf(['default', 'warn', 'danger', 'good']),
  hint: PropTypes.node,
};

const EmptyRow = ({ children }) => (
  <div className="col-span-full rounded-xl bg-cream-200/45 py-10 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-500 shadow-neu-inset">
    {children}
  </div>
);

EmptyRow.propTypes = { children: PropTypes.node };

/*
 * SUPER ADMIN — EXECUTIVE DASHBOARD ("Vintage Atelier" console).
 *
 * Order: Analytics Overview (period cards) → Charts & Insights (revenue trend;
 * top products + order status; try-on performance + review ratings) → Recent
 * Try-On Activity → Recent Product Reviews → Inventory Status (right column on
 * desktop, last on mobile). The cards and the charts share one period switch.
 *
 * The recent lists and inventory come from GET /admin/analytics/overview, a
 * light request built for this screen. `analyticsLogs` (the full, slow log)
 * is only used as a fallback for the activity list when it is already loaded.
 */
const DashboardTab = ({
  analyticsLogs = [],
  onSync,
  onRefresh,
  onOpenAnalytics,
  loading
}) => {
  const queryClient = useQueryClient();
  // One period for both the summary cards and the charts below them.
  const [period, setPeriod] = useState('week');

  const overviewQuery = useQuery({
    queryKey: [OVERVIEW_QUERY_KEY],
    queryFn: async () => (await api.get('/admin/analytics/overview')).data,
    staleTime: 60 * 1000,
  });
  const overview = overviewQuery.data;
  const overviewLoading = overviewQuery.isLoading;

  // Prefer the overview's named rows; fall back to the full log if that failed.
  const tryOns = overview?.recent_try_ons
    ?? analyticsLogs.slice(0, 5).map((log) => ({
      id: log.id,
      products: [log.item_name, log.paired_item].filter(Boolean).join(', ') || 'Garment',
      customer: log.user_name || log.user_email,
      status: log.status,
      created_at: log.created_at,
    }));
  const reviews = overview?.recent_reviews || [];
  const inventory = overview?.inventory;
  const dash = overviewLoading ? '…' : '—';

  return (
    <div className="space-y-7 animate-fadeIn">
      {/* Header Banner */}
      <div className="relative isolate flex flex-col justify-between gap-5 overflow-hidden rounded-[26px] bg-navy-900 p-6 text-cream-100 shadow-neu-dark sm:flex-row sm:items-center sm:p-8">
        <div aria-hidden="true" className="absolute -right-16 -top-24 -z-10 h-64 w-64 rounded-full border border-cream-50/[0.08]" />
        <div aria-hidden="true" className="absolute -bottom-28 right-32 -z-10 h-56 w-56 rounded-full border border-cream-50/[0.06]" />
        <div aria-hidden="true" className="vintage-grain absolute inset-0 -z-10 opacity-30 mix-blend-soft-light" />
        <div>
          <span className="kicker text-cream-400">
            <ShieldCheck size={13} /> SuperAdmin Control Center
          </span>
          <h2 className="mt-3 font-serif text-[clamp(1.4rem,2.4vw,2rem)] uppercase leading-tight tracking-[0.05em] text-cream-50">
            System Executive Dashboard
          </h2>
          <p className="mt-2 text-[0.82rem] text-cream-300">
            Real-time system health, research analytics, and live AI pipeline metrics.
          </p>
        </div>

        <button
          onClick={(e) => {
            // Also re-read the summary cards and panels, which fetch their own data.
            queryClient.invalidateQueries({ queryKey: [SUMMARY_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [OVERVIEW_QUERY_KEY] });
            queryClient.invalidateQueries({ queryKey: [CHARTS_QUERY_KEY] });
            (onSync || onRefresh)?.(e);
          }}
          disabled={loading}
          title="Re-read the data this tab shows"
          className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-cream-100 px-6 py-3 text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-navy-950 shadow-[0_12px_24px_-12px_rgba(0,0,0,0.8)] transition-colors hover:bg-cream-50 disabled:cursor-not-allowed disabled:bg-cream-300 disabled:text-charcoal-600 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cream-100"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Dashboard</span>
        </button>
      </div>

      {/* Analytics Overview — orders, revenue, try-ons, reviews for a chosen period */}
      <DashboardSummary period={period} onPeriodChange={setPeriod} />

      {/* Charts & Insights — follows the same period switch */}
      <DashboardCharts period={period} />

      {overviewQuery.isError && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-3 text-[11px] text-charcoal-600 shadow-neu-inset">
          Some dashboard analytics could not be loaded.
          <button type="button" onClick={() => overviewQuery.refetch()} className="btn-quiet cursor-pointer">
            Try again
          </button>
        </div>
      )}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Left Column (2 Span): recent activity */}
        <div className="space-y-6 lg:col-span-2">

          {/* Try-On Activity Card */}
          <Panel
            title="Recent try-on activity"
            icon={Sparkles}
            action={
              /*
               * THE DOOR TO THE ANALYTICS SUB-TAB. This card shows only the first
               * five sessions, so the full log and the research metrics are one
               * click away from the card that already summarises them.
               */
              onOpenAnalytics ? (
                <button
                  type="button"
                  onClick={onOpenAnalytics}
                  className="btn-quiet cursor-pointer"
                >
                  View All Analytics
                </button>
              ) : (
                <span className="rounded-full bg-navy-100 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-navy-800">
                  Live Stream
                </span>
              )
            }
          >
            <ul className="space-y-2.5">
              {overviewLoading && tryOns.length === 0 ? (
                <EmptyRow>Loading try-on activity…</EmptyRow>
              ) : tryOns.length > 0 ? (
                tryOns.map((s, idx) => (
                  <li key={s.id || idx} className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-3 text-xs shadow-neu-inset">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate font-semibold text-hiraya-ink">{s.products}</p>
                      <p className="truncate text-[10px] text-charcoal-500">
                        {s.customer || 'Customer'}
                        {s.created_at && (
                          <span title={new Date(s.created_at).toLocaleString()}> · {timeAgo(s.created_at)}</span>
                        )}
                      </p>
                    </div>
                    {/* The session's recorded outcome (completed / failed / processing). */}
                    <StatusChip status={s.status} />
                  </li>
                ))
              ) : (
                <EmptyRow>No recent AI try-on activity recorded</EmptyRow>
              )}
            </ul>
          </Panel>

          {/* Recent Product Reviews (replaces the old survey responses) */}
          <Panel title="Recent product reviews" icon={MessageSquareText}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {overviewLoading ? (
                <EmptyRow>Loading reviews…</EmptyRow>
              ) : reviews.length > 0 ? (
                reviews.map((r) => (
                  <figure key={r.id} className="flex flex-col justify-between gap-3 rounded-2xl bg-cream-200/45 p-4 shadow-neu-inset">
                    <div className="space-y-2">
                      <Stars rating={r.rating} />
                      <blockquote className="line-clamp-3 text-[12px] italic leading-relaxed text-hiraya-ink">
                        {r.comment ? <>&ldquo;{r.comment}&rdquo;</> : <span className="not-italic text-charcoal-500">No written comment.</span>}
                      </blockquote>
                    </div>
                    <figcaption className="border-t border-hiraya-structure-line pt-2.5">
                      <p className="truncate text-[11px] font-semibold text-hiraya-ink">{r.product_name}</p>
                      <p className="mt-0.5 truncate text-[9px] font-semibold uppercase tracking-[0.16em] text-charcoal-500">
                        {r.customer || 'Customer'} · <span title={new Date(r.created_at).toLocaleString()}>{timeAgo(r.created_at)}</span>
                      </p>
                    </figcaption>
                  </figure>
                ))
              ) : (
                <EmptyRow>No product reviews yet</EmptyRow>
              )}
            </div>
          </Panel>

        </div>

        {/*
          * Right Column: current inventory state. The all-time "AI try-on
          * analytics" and "Product reviews" figure panels that used to sit here
          * are now the Try-On Performance and Review Ratings charts above.
          */}
        <div className="space-y-6">
          <Panel title="Inventory status" icon={Package}>
            <ul className="space-y-2">
              <MetricRow label="Active Products" value={inventory?.active ?? dash} />
              <MetricRow
                label="Low Stock"
                hint="1–4 units left"
                value={inventory?.low_stock ?? dash}
                tone={inventory?.low_stock > 0 ? 'warn' : 'default'}
              />
              <MetricRow
                label="Out of Stock"
                value={inventory?.out_of_stock ?? dash}
                tone={inventory?.out_of_stock > 0 ? 'danger' : 'default'}
              />
            </ul>
          </Panel>
        </div>

      </div>
    </div>
  );
};

DashboardTab.propTypes = {
  // `products`, `activeSessions` and `feedbacks` are still passed by SuperAdmin
  // but no longer rendered here; the panels read the overview endpoint instead.
  products: PropTypes.array,
  activeSessions: PropTypes.number,
  feedbacks: PropTypes.array,
  analyticsLogs: PropTypes.array,
  onSync: PropTypes.func,
  onRefresh: PropTypes.func,
  onOpenAnalytics: PropTypes.func,
  loading: PropTypes.bool,
};

export default DashboardTab;

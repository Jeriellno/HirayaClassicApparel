import { useState } from 'react';
import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Wallet,
  ShoppingBag,
  Sparkles,
  Users,
  Star,
  MessageSquareHeart,
  LineChart as LineIcon,
  PieChart as PieIcon,
  Layers,
  ClipboardList,
  Receipt,
  PackageCheck,
  Truck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ChevronRight,
} from 'lucide-react';
import api from '../../../api/axios';

/*
 * ANALYTICS DASHBOARD — admin AND super admin, one screen.
 *
 * Everything the console owner checks first, readable WITHOUT SCROLLING on a
 * laptop screen: a KPI strip, a revenue / orders / try-on line chart, order
 * and try-on outcome pies, the 5→1 star distributions of product reviews and
 * customer feedback, which Style Stack layers customers try on, and the work
 * queue that used to be the separate "Today's Work" tab.
 *
 * All of it comes from ONE request (GET /admin/analytics/insights) so the
 * panels appear together instead of trickling in. The period switch is the
 * only control; there is no refresh button — the query refetches on focus and
 * whenever the period changes.
 */

export const INSIGHTS_QUERY_KEY = 'console-dashboard-insights';

const PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'all', label: 'All time' },
];

/* Vintage palette: navy family + warm accents, readable on cream. */
const PALETTE = ['#1D2C45', '#4A5D7E', '#93A1B8', '#BCA47C', '#A3564A', '#6E8B74'];
const STATUS_COLORS = {
  Pending: '#BCA47C',
  Processing: '#4A5D7E',
  Shipped: '#93A1B8',
  Delivered: '#1D2C45',
  Cancelled: '#A3564A',
  Completed: '#1D2C45',
  Failed: '#A3564A',
  'In progress': '#BCA47C',
};
const GRID = '#E4D6BA';
const AXIS = '#6E6B66';
const EASE = [0.22, 1, 0.36, 1];

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const pesoCompact = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', { notation: 'compact', maximumFractionDigits: 1 })}`;

/* ---------------------------------------------------------------- pieces */

const Card = ({ title, icon: Icon, action, className = '', children }) => (
  <section className={`flex min-h-0 flex-col rounded-[20px] bg-hiraya-surface p-4 shadow-neu ring-1 ring-cream-50/80 ${className}`}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
        {Icon && (
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-navy-900 text-cream-100">
            <Icon size={12} />
          </span>
        )}
        {title}
      </h3>
      {action}
    </div>
    <div className="min-h-0 flex-1">{children}</div>
  </section>
);

Card.propTypes = {
  title: PropTypes.node.isRequired,
  icon: PropTypes.elementType,
  action: PropTypes.node,
  className: PropTypes.string,
  children: PropTypes.node,
};

const Empty = ({ children }) => (
  <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl bg-cream-200/45 px-4 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-charcoal-500 shadow-neu-inset">
    {children}
  </div>
);

Empty.propTypes = { children: PropTypes.node };

const Skeleton = () => <div aria-hidden="true" className="h-full min-h-[120px] animate-pulse rounded-xl bg-cream-200/55" />;

const Change = ({ pct }) => {
  if (pct === null || pct === undefined) return null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${pct === 0 ? 'text-charcoal-500' : up ? 'text-emerald-700' : 'text-red-700'}`}>
      {pct !== 0 && <Icon size={11} />}
      {up ? '+' : ''}{pct}%
    </span>
  );
};

Change.propTypes = { pct: PropTypes.number };

const Kpi = ({ label, value, icon: Icon, sub, change, index }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: index * 0.04 }}
      className="rounded-[18px] bg-hiraya-surface px-4 py-3 shadow-neu ring-1 ring-cream-50/80"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-charcoal-600">{label}</span>
        <Icon size={14} className="shrink-0 text-navy-700" />
      </div>
      <p className="mt-1.5 truncate text-[1.45rem] font-semibold leading-none tabular-nums text-navy-900">{value}</p>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-charcoal-500">
        <span className="truncate">{sub}</span>
        <Change pct={change} />
      </div>
    </motion.div>
  );
};

Kpi.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  icon: PropTypes.elementType.isRequired,
  sub: PropTypes.node,
  change: PropTypes.number,
  index: PropTypes.number,
};

const TooltipCard = ({ title, rows }) => (
  <div className="rounded-xl bg-navy-900 px-3 py-2 text-[11px] text-cream-100 shadow-neu-dark">
    <p className="mb-1 font-semibold text-cream-50">{title}</p>
    {rows.map(([label, value]) => (
      <p key={label} className="flex justify-between gap-4 text-cream-300">
        {label} <span className="font-semibold tabular-nums text-cream-50">{value}</span>
      </p>
    ))}
  </div>
);

TooltipCard.propTypes = { title: PropTypes.node, rows: PropTypes.array.isRequired };

/** A donut with its legend beside it. `rows` = [{ name, value }]. */
const Donut = ({ rows, colorOf, centerLabel, emptyText, small = false }) => {
  const reduce = useReducedMotion();
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) return <Empty>{emptyText}</Empty>;
  const shown = rows.filter((r) => r.value > 0);
  return (
    /*
     * Sized by the CARD, not the window (container query): beside the donut
     * when the card is wide enough, a two-column legend underneath when not —
     * so names are never cut off on a 1366-px laptop.
     */
    <div className="@container h-full">
    <div className="flex h-full flex-col items-center justify-center gap-2 @[17rem]:flex-row @[17rem]:gap-3">
      <div className={`relative shrink-0 ${small ? 'h-[76px] w-[76px] @[17rem]:h-[96px] @[17rem]:w-[96px]' : 'h-[96px] w-[96px] @[17rem]:h-[112px] @[17rem]:w-[112px]'}`} role="img" aria-label={`${total} ${centerLabel}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="98%"
              paddingAngle={shown.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={!reduce}
            >
              {shown.map((r, i) => (
                <Cell key={r.name} fill={colorOf(r.name, i)} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={payload[0].name}
                    rows={[[centerLabel, `${payload[0].value} (${Math.round((payload[0].value / total) * 100)}%)`]]}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold leading-none tabular-nums text-navy-900">{total}</span>
          <span className="mt-0.5 text-[8px] uppercase tracking-[0.14em] text-charcoal-500">{centerLabel}</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] @[17rem]:w-auto @[17rem]:flex-1 @[17rem]:grid-cols-1 @[17rem]:gap-y-1">
        {rows.map((r, i) => (
          <li key={r.name} className="flex items-center justify-between gap-2" title={`${r.name}: ${r.value} (${Math.round((r.value / total) * 100)}%)`}>
            <span className="flex min-w-0 items-center gap-1.5 text-hiraya-ink">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: colorOf(r.name, i) }} />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-navy-900">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
};

Donut.propTypes = {
  rows: PropTypes.arrayOf(PropTypes.shape({ name: PropTypes.string, value: PropTypes.number })).isRequired,
  colorOf: PropTypes.func.isRequired,
  centerLabel: PropTypes.string.isRequired,
  emptyText: PropTypes.string.isRequired,
  small: PropTypes.bool,
};

/** 5 -> 1 star bars with the average on top. */
const StarBars = ({ data, noun }) => {
  const reduce = useReducedMotion();
  if (!data || data.total === 0) return <Empty>No {noun} yet</Empty>;
  const max = Math.max(...data.distribution.map((d) => d.count), 1);
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold leading-none tabular-nums text-navy-900">{data.average?.toFixed(1)}</span>
        <span className="flex items-center gap-0.5" aria-label={`${data.average} out of 5`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} size={12} className={data.average >= n - 0.25 ? 'text-amber-500' : 'text-hiraya-structure-line'} fill={data.average >= n - 0.25 ? 'currentColor' : 'none'} />
          ))}
        </span>
        <span className="ml-auto text-[10px] text-charcoal-500">{data.total} {noun}</span>
      </div>
      <ul className="space-y-1.5">
        {data.distribution.map((d, i) => (
          <li key={d.stars} className="flex items-center gap-2 text-[10px]">
            <span className="w-5 shrink-0 tabular-nums text-charcoal-600">{d.stars}★</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-cream-200/70 shadow-neu-inset">
              <motion.div
                className={`h-full rounded-full ${d.stars >= 4 ? 'bg-navy-800' : d.stars === 3 ? 'bg-amber-600' : 'bg-red-700'}`}
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${(d.count / max) * 100}%` }}
                transition={{ duration: 0.6, ease: EASE, delay: i * 0.05 }}
              />
            </div>
            <span className="w-6 shrink-0 text-right font-semibold tabular-nums text-navy-900">{d.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

StarBars.propTypes = { data: PropTypes.object, noun: PropTypes.string.isRequired };

/* --------------------------------------------------------------- the tab */

const DashboardTab = ({ role = 'superadmin', onOpenSection, onOpenAnalytics }) => {
  const [period, setPeriod] = useState('month');
  const reduce = useReducedMotion();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [INSIGHTS_QUERY_KEY, period],
    queryFn: async () => (await api.get('/admin/analytics/insights', { params: { period } })).data,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });

  const k = data?.kpis;
  const dash = isLoading ? '…' : '—';
  const periodLabel = PERIODS.find((p) => p.key === period)?.label.toLowerCase();
  const trend = data?.trend || [];
  const trendHasData = trend.some((p) => (p.revenue || 0) > 0 || (p.orders || 0) > 0 || (p.try_ons || 0) > 0);
  const q = data?.queue;

  const queueRows = [
    { key: 'dp', label: 'Down payments to verify', count: q?.verify_dp, icon: Receipt, to: 'orders', tone: 'text-amber-700' },
    { key: 'bal', label: 'Balances to confirm', count: q?.verify_balance, icon: Wallet, to: 'orders', tone: 'text-amber-700' },
    { key: 'ship', label: 'Paid — pack & ship', count: q?.to_ship, icon: PackageCheck, to: 'orders', tone: 'text-sky-800' },
    { key: 'transit', label: 'Shipped — in transit', count: q?.in_transit, icon: Truck, to: 'orders', tone: 'text-emerald-700' },
    { key: 'low', label: 'Sizes low on stock (≤ 5)', count: q?.low_stock_sizes, icon: AlertTriangle, to: 'inventory', tone: 'text-red-700' },
  ];

  return (
    <div className="space-y-3 animate-fadeIn">
      {/* Title + the one control: the period. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-[clamp(1.15rem,1.8vw,1.5rem)] uppercase tracking-[0.05em] text-navy-900">
          Analytics Dashboard
        </h2>
        <div className="inline-flex rounded-full bg-cream-200/70 p-1 shadow-neu-inset" role="tablist" aria-label="Dashboard period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`cursor-pointer rounded-full px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-800/40 ${
                period === p.key ? 'bg-navy-900 text-cream-100 shadow-neu-sm' : 'text-charcoal-600 hover:text-navy-900'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isError && !data && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-2.5 text-[11px] text-charcoal-600 shadow-neu-inset">
          The dashboard analytics could not be loaded.
          <button type="button" onClick={() => refetch()} className="btn-quiet cursor-pointer">Try again</button>
        </div>
      )}

      {/* KPI STRIP */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi index={0} label="Revenue" icon={Wallet} value={k ? peso(k.revenue.total) : dash} sub="verified payments" change={k?.revenue.change_pct} />
        <Kpi index={1} label="Orders" icon={ShoppingBag} value={k ? k.orders.total : dash} sub={periodLabel} change={k?.orders.change_pct} />
        <Kpi
          index={2}
          label="AI Try-ons"
          icon={Sparkles}
          value={k ? k.try_ons.total : dash}
          sub={k?.try_ons.success_rate != null ? `${k.try_ons.success_rate}% succeeded` : 'no sessions'}
          change={k?.try_ons.change_pct}
        />
        <Kpi index={3} label="Customers" icon={Users} value={k ? k.customers.total : dash} sub={k ? `+${k.customers.new} new · ${periodLabel}` : ''} />
        <Kpi
          index={4}
          label="Product rating"
          icon={Star}
          value={k?.review_rating.average != null ? `${k.review_rating.average.toFixed(1)}★` : dash}
          sub={k ? `${k.review_rating.total} reviews` : ''}
        />
        <Kpi
          index={5}
          label="Feedback rating"
          icon={MessageSquareHeart}
          value={k?.feedback_rating.average != null ? `${k.feedback_rating.average.toFixed(1)}★` : dash}
          sub={k ? `${k.feedback_rating.total} responses` : ''}
        />
      </div>

      {/* ROW 2 — trend line + two pies */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Card title="Revenue, orders & try-ons" icon={LineIcon} className="h-[230px] lg:col-span-6">
          {isLoading ? (
            <Skeleton />
          ) : !trendHasData ? (
            <Empty>No activity {periodLabel}</Empty>
          ) : (
            <div className="h-full" role="img" aria-label="Revenue, orders and try-ons over time">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 4" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis yAxisId="peso" tickFormatter={pesoCompact} tick={{ fontSize: 9, fill: AXIS }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                  <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 9, fill: AXIS }} tickLine={false} axisLine={false} width={24} allowDecimals={false} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length || payload[0].payload.orders === null) return null;
                      const p = payload[0].payload;
                      return <TooltipCard title={p.full_label} rows={[['Revenue', peso(p.revenue)], ['Orders', p.orders], ['Try-ons', p.try_ons]]} />;
                    }}
                  />
                  <Line yAxisId="peso" type="monotone" dataKey="revenue" name="Revenue" stroke="#1D2C45" strokeWidth={2.25} dot={false} isAnimationActive={!reduce} />
                  <Line yAxisId="count" type="monotone" dataKey="orders" name="Orders" stroke="#BCA47C" strokeWidth={2} dot={false} isAnimationActive={!reduce} />
                  <Line yAxisId="count" type="monotone" dataKey="try_ons" name="Try-ons" stroke="#93A1B8" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={!reduce} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Legend lives in the card header area's footer to keep the plot tall. */}
          {trendHasData && !isLoading && (
            <div className="-mt-1 flex justify-end gap-3 text-[9px] uppercase tracking-[0.12em] text-charcoal-600">
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#1D2C45]" /> Revenue</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#BCA47C]" /> Orders</span>
              <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#93A1B8]" /> Try-ons</span>
            </div>
          )}
        </Card>

        <Card title="Order status" icon={PieIcon} className="h-[230px] lg:col-span-3">
          {isLoading ? <Skeleton /> : (
            <Donut rows={data?.order_status || []} colorOf={(n, i) => STATUS_COLORS[n] || PALETTE[i % PALETTE.length]} centerLabel="orders" emptyText={`No orders ${periodLabel}`} />
          )}
        </Card>

        <Card
          title="Try-on outcomes"
          icon={Sparkles}
          className="h-[230px] lg:col-span-3"
          action={role === 'superadmin' && onOpenAnalytics ? (
            <button type="button" onClick={onOpenAnalytics} className="flex cursor-pointer items-center text-[9px] font-semibold uppercase tracking-[0.12em] text-charcoal-600 hover:text-navy-900">
              Log <ChevronRight size={11} />
            </button>
          ) : null}
        >
          {isLoading ? <Skeleton /> : (
            <Donut rows={data?.try_on_status || []} colorOf={(n, i) => STATUS_COLORS[n] || PALETTE[i % PALETTE.length]} centerLabel="sessions" emptyText={`No try-ons ${periodLabel}`} />
          )}
        </Card>
      </div>

      {/* ROW 3 — ratings, stack usage, work queue */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Product reviews" icon={Star} className="h-[210px]">
          {isLoading ? <Skeleton /> : <StarBars data={data?.review_stars} noun="reviews" />}
        </Card>

        <Card title="Customer feedback" icon={MessageSquareHeart} className="h-[210px]">
          {isLoading ? <Skeleton /> : <StarBars data={data?.feedback_stars} noun="responses" />}
        </Card>

        <Card title="Style stack usage" icon={Layers} className="h-[210px]">
          {isLoading ? <Skeleton /> : (
            <div className="flex h-full flex-col gap-2">
              <div className="min-h-0 flex-1">
                <Donut rows={data?.stack_layers || []} colorOf={(n, i) => PALETTE[i % PALETTE.length]} centerLabel="layers" emptyText={`No try-ons ${periodLabel}`} small />
              </div>
              {data?.most_tried?.[0] && (
                <p className="truncate border-t border-hiraya-structure-line pt-1.5 text-[10px] text-charcoal-600" title={data.most_tried.map((m) => `${m.name} (${m.sessions})`).join(', ')}>
                  Most tried: <span className="font-semibold text-navy-900">{data.most_tried[0].name}</span> · {data.most_tried[0].sessions}×
                </p>
              )}
            </div>
          )}
        </Card>

        <Card title="Work queue" icon={ClipboardList} className="h-[210px]">
          <ul className="space-y-0.5">
            {queueRows.map((row) => {
              const Icon = row.icon;
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => onOpenSection?.(row.to)}
                    className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-[5px] text-left text-[11px] transition hover:bg-cream-200/70"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-hiraya-ink">
                      <Icon size={13} className={`shrink-0 ${row.tone}`} />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-0.5 font-semibold tabular-nums text-navy-900">
                      {row.count ?? dash}
                      <ChevronRight size={11} className="text-charcoal-400 opacity-0 transition group-hover:opacity-100" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </div>
  );
};

DashboardTab.propTypes = {
  role: PropTypes.string,
  onOpenSection: PropTypes.func,
  onOpenAnalytics: PropTypes.func,
};

export default DashboardTab;

import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { LineChart as LineIcon, Trophy, PieChart as PieIcon, Sparkles, Star } from 'lucide-react';
import api from '../../api/axios';
import { Panel } from './ConsoleUI';
import { PERIODS, SUMMARY_QUERY_KEY } from './DashboardSummary';

export const CHARTS_QUERY_KEY = 'console-dashboard-charts';

const EASE = [0.22, 1, 0.36, 1];

// Vintage Atelier tokens (tailwind.config.js) — recharts needs raw values.
const C = {
  navy: '#1D2C45',
  navySoft: '#93A1B8',
  grid: '#E4D6BA',
  axis: '#6E6B66',
};

/*
 * Order-status colours. Each slice is also named with its count and share in
 * the legend beside the donut, so colour never carries the meaning alone.
 */
const STATUS_COLORS = {
  Pending: '#BCA47C',
  Processing: '#4A5D7E',
  Shipped: '#93A1B8',
  Delivered: '#1D2C45',
  Cancelled: '#A3564A',
};

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

const pesoCompact = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', { notation: 'compact', maximumFractionDigits: 1 })}`;

/* ---------------------------------------------------------------- pieces -- */

const ChartEmpty = ({ children, className = 'h-[240px]' }) => (
  <div
    className={`flex items-center justify-center rounded-2xl bg-cream-200/45 px-6 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-500 shadow-neu-inset ${className}`}
  >
    {children}
  </div>
);

ChartEmpty.propTypes = { children: PropTypes.node, className: PropTypes.string };

const ChartSkeleton = ({ className = 'h-[240px]' }) => (
  <div aria-hidden="true" className={`animate-pulse rounded-2xl bg-cream-200/55 shadow-neu-inset ${className}`} />
);

ChartSkeleton.propTypes = { className: PropTypes.string };

/* The small caption under a panel title ("Top 5 by units sold"). */
const Caption = ({ children }) => (
  <p className="-mt-3 mb-4 text-[11px] leading-relaxed text-charcoal-500">{children}</p>
);

Caption.propTypes = { children: PropTypes.node };

/* A dark, compact tooltip card shared by the recharts charts. */
const TooltipCard = ({ title, rows }) => (
  <div className="rounded-xl bg-navy-900 px-3.5 py-2.5 text-[11px] text-cream-100 shadow-neu-dark">
    <p className="mb-1 font-semibold text-cream-50">{title}</p>
    {rows.map(([label, value]) => (
      <p key={label} className="flex justify-between gap-4 text-cream-300">
        {label} <span className="font-semibold tabular-nums text-cream-50">{value}</span>
      </p>
    ))}
  </div>
);

TooltipCard.propTypes = {
  title: PropTypes.node,
  rows: PropTypes.arrayOf(PropTypes.array).isRequired,
};

/*
 * Horizontal bar list. Product names are long, so each name sits on its own
 * line above its bar — readable at phone width, where an axis label would be
 * truncated to nothing. The value is printed, so hover is not required.
 */
const BarList = ({ items, valueLabel, color = 'bg-navy-800', ariaLabel }) => {
  const reduce = useReducedMotion();
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3.5" aria-label={ariaLabel}>
      {items.map((item, idx) => (
        <li key={item.label} title={`${item.label}: ${item.value} ${valueLabel}`}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-semibold text-hiraya-ink">{item.label}</span>
            <span className="shrink-0 tabular-nums text-charcoal-600">
              <span className="font-semibold text-navy-900">{item.value.toLocaleString('en-PH')}</span>{' '}
              {valueLabel}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-cream-200/70 shadow-neu-inset">
            <motion.div
              className={`h-full rounded-full ${color}`}
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${(item.value / max) * 100}%` }}
              transition={{ duration: 0.7, ease: EASE, delay: idx * 0.05 }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
};

BarList.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({ label: PropTypes.string.isRequired, value: PropTypes.number.isRequired })
  ).isRequired,
  valueLabel: PropTypes.string.isRequired,
  color: PropTypes.string,
  ariaLabel: PropTypes.string,
};

/* ---------------------------------------------------------------- charts -- */

const RevenueTrend = ({ data, granularity, periodLabel, loading }) => {
  const reduce = useReducedMotion();
  const points = data || [];
  const elapsed = points.filter((p) => p.revenue !== null);
  const total = elapsed.reduce((sum, p) => sum + p.revenue, 0);
  const orders = elapsed.reduce((sum, p) => sum + p.orders, 0);

  return (
    <Panel
      title="Sales & revenue trend"
      icon={LineIcon}
      action={
        !loading && (
          <div className="text-right">
            <p className="text-base font-semibold tabular-nums text-navy-900">{peso(total)}</p>
            <p className="text-[10px] text-charcoal-500">
              {orders} paid order{orders === 1 ? '' : 's'}
            </p>
          </div>
        )
      }
    >
      <Caption>
        {granularity === 'hour' ? 'Hourly' : 'Daily'} revenue for {periodLabel.toLowerCase()} — verified payments
        only (full payment, or the 50% down payment); rejected orders are excluded.
      </Caption>
      {loading ? (
        <ChartSkeleton className="h-[260px]" />
      ) : total <= 0 ? (
        <ChartEmpty className="h-[260px]">No paid orders {periodLabel.toLowerCase()} yet</ChartEmpty>
      ) : (
        <div className="h-[260px]" role="img" aria-label={`Revenue trend, ${peso(total)} total ${periodLabel.toLowerCase()}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="hiraya-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={C.navy} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={C.navy} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: C.axis }}
                tickLine={false}
                axisLine={{ stroke: C.grid }}
                interval="preserveStartEnd"
                minTickGap={14}
              />
              <YAxis
                tickFormatter={pesoCompact}
                tick={{ fontSize: 10, fill: C.axis }}
                tickLine={false}
                axisLine={false}
                width={52}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ stroke: C.navySoft, strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length || payload[0].payload.revenue === null) return null;
                  const p = payload[0].payload;
                  return (
                    <TooltipCard
                      title={p.full_label}
                      rows={[
                        ['Revenue', peso(p.revenue)],
                        ['Paid orders', p.orders],
                      ]}
                    />
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke={C.navy}
                strokeWidth={2.25}
                fill="url(#hiraya-revenue-fill)"
                dot={false}
                activeDot={{ r: 4.5, fill: C.navy, stroke: '#FCFAF5', strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={!reduce}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
};

RevenueTrend.propTypes = {
  data: PropTypes.array,
  granularity: PropTypes.string,
  periodLabel: PropTypes.string.isRequired,
  loading: PropTypes.bool,
};

const TopProducts = ({ data, periodLabel, loading }) => (
  <Panel title="Top performing products" icon={Trophy}>
    <Caption>Top 5 by units sold on paid orders.</Caption>
    {loading ? (
      <ChartSkeleton />
    ) : !data?.length ? (
      <ChartEmpty>No products sold {periodLabel.toLowerCase()} yet</ChartEmpty>
    ) : (
      <BarList
        ariaLabel="Units sold per product"
        valueLabel="sold"
        items={data.map((p) => ({ label: p.name, value: p.units }))}
      />
    )}
  </Panel>
);

TopProducts.propTypes = { data: PropTypes.array, periodLabel: PropTypes.string.isRequired, loading: PropTypes.bool };

const OrderStatus = ({ data, periodLabel, loading }) => {
  const reduce = useReducedMotion();
  const rows = data || [];
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <Panel title="Order status distribution" icon={PieIcon}>
      <Caption>Current status of orders placed {periodLabel.toLowerCase()}.</Caption>
      {loading ? (
        <ChartSkeleton />
      ) : total === 0 ? (
        <ChartEmpty>No orders placed {periodLabel.toLowerCase()}</ChartEmpty>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <div className="relative h-[200px] w-[200px] shrink-0" role="img" aria-label={`${total} orders by status`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows.filter((r) => r.count > 0)}
                  dataKey="count"
                  nameKey="status"
                  innerRadius={60}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="#FCFAF5"
                  strokeWidth={2}
                  isAnimationActive={!reduce}
                >
                  {rows
                    .filter((r) => r.count > 0)
                    .map((r) => (
                      <Cell key={r.status} fill={STATUS_COLORS[r.status]} />
                    ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const r = payload[0].payload;
                    return (
                      <TooltipCard
                        title={r.status}
                        rows={[
                          ['Orders', r.count],
                          ['Share', `${pct(r.count)}%`],
                        ]}
                      />
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-semibold tabular-nums text-navy-900">{total}</span>
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-charcoal-500">Orders</span>
            </div>
          </div>
          <ul className="w-full space-y-2">
            {rows.map((r) => (
              <li key={r.status} className="flex items-center justify-between gap-3 text-xs">
                <span className="flex items-center gap-2 text-charcoal-600">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[r.status] }}
                  />
                  {r.status}
                </span>
                <span className="tabular-nums text-charcoal-500">
                  <span className="font-semibold text-navy-900">{r.count}</span> · {pct(r.count)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
};

OrderStatus.propTypes = { data: PropTypes.array, periodLabel: PropTypes.string.isRequired, loading: PropTypes.bool };

const TryOnPerformance = ({ data, sessions, periodLabel, loading }) => (
  <Panel
    title="AI try-on performance"
    icon={Sparkles}
    action={
      sessions != null && (
        <span className="rounded-full bg-navy-100 px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-navy-800">
          {sessions} session{sessions === 1 ? '' : 's'}
        </span>
      )
    }
  >
    <Caption>Top 5 products by number of try-on sessions. Not counted as sales.</Caption>
    {loading ? (
      <ChartSkeleton />
    ) : !data?.length ? (
      <ChartEmpty>No AI try-on sessions {periodLabel.toLowerCase()} yet</ChartEmpty>
    ) : (
      <BarList
        ariaLabel="Try-on sessions per product"
        valueLabel="sessions"
        color="bg-cream-500"
        items={data.map((p) => ({ label: p.name, value: p.sessions }))}
      />
    )}
  </Panel>
);

TryOnPerformance.propTypes = {
  data: PropTypes.array,
  sessions: PropTypes.number,
  periodLabel: PropTypes.string.isRequired,
  loading: PropTypes.bool,
};

const ReviewRatings = ({ data, periodLabel, loading }) => {
  const rows = data || [];
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const average = total > 0 ? rows.reduce((sum, r) => sum + r.stars * r.count, 0) / total : null;

  return (
    <Panel
      title="Product review ratings"
      icon={Star}
      action={
        average !== null && (
          <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-navy-900">
            <Star size={13} className="text-amber-500" fill="currentColor" />
            {average.toFixed(1)}
            <span className="text-[10px] font-normal text-charcoal-500">· {total}</span>
          </span>
        )
      }
    >
      <Caption>Submitted product reviews by star rating.</Caption>
      {loading ? (
        <ChartSkeleton />
      ) : total === 0 ? (
        <ChartEmpty>No product reviews {periodLabel.toLowerCase()} yet</ChartEmpty>
      ) : (
        <BarList
          ariaLabel="Reviews per star rating"
          valueLabel={total === 1 ? 'review' : 'reviews'}
          color="bg-amber-500"
          items={rows.map((r) => ({ label: `${r.stars} Star${r.stars === 1 ? '' : 's'}`, value: r.count }))}
        />
      )}
    </Panel>
  );
};

ReviewRatings.propTypes = { data: PropTypes.array, periodLabel: PropTypes.string.isRequired, loading: PropTypes.bool };

/* ------------------------------------------------------------- section -- */

/**
 * CHARTS & INSIGHTS — the visual half of the Master Console dashboard.
 *
 * Every chart reads GET /admin/analytics/charts for the period selected in the
 * Analytics Overview switch, so they move together. The try-on session total
 * reuses the summary cards' cached query (same key), so it costs no request.
 */
const DashboardCharts = ({ period }) => {
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? 'This Week';

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: [CHARTS_QUERY_KEY, period],
    queryFn: async () => (await api.get('/admin/analytics/charts', { params: { period } })).data,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });

  const summary = useQuery({
    queryKey: [SUMMARY_QUERY_KEY, period],
    queryFn: async () => (await api.get('/admin/analytics/summary', { params: { period } })).data,
    staleTime: 60 * 1000,
  }).data;

  const loading = isLoading && !data;

  return (
    <section aria-labelledby="dashboard-charts-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="dashboard-charts-heading"
          className="text-[10px] font-semibold uppercase tracking-[0.2em] text-navy-800"
        >
          Charts &amp; Insights
        </h3>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-charcoal-500">
          {isFetching && data ? 'Updating…' : periodLabel}
        </span>
      </div>

      {isError && !data ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-3 text-[11px] text-charcoal-600 shadow-neu-inset">
          Unable to load the charts.
          <button type="button" onClick={() => refetch()} className="btn-quiet cursor-pointer">
            Try again
          </button>
        </div>
      ) : (
        <div className={`space-y-6 transition-opacity duration-300 ${isFetching && data ? 'opacity-70' : ''}`}>
          <RevenueTrend
            data={data?.revenue_trend}
            granularity={data?.granularity}
            periodLabel={periodLabel}
            loading={loading}
          />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TopProducts data={data?.top_products} periodLabel={periodLabel} loading={loading} />
            <OrderStatus data={data?.order_status} periodLabel={periodLabel} loading={loading} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <TryOnPerformance
              data={data?.try_on_products}
              sessions={summary?.try_ons?.total}
              periodLabel={periodLabel}
              loading={loading}
            />
            <ReviewRatings data={data?.review_ratings} periodLabel={periodLabel} loading={loading} />
          </div>
        </div>
      )}
    </section>
  );
};

DashboardCharts.propTypes = {
  period: PropTypes.oneOf(['today', 'week', 'month']).isRequired,
};

export default DashboardCharts;

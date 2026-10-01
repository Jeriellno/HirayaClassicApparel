import { useState } from 'react';
import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, Wallet, Sparkles, Star, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import api from '../../api/axios';
import { StatTile } from './ConsoleUI';

export const SUMMARY_QUERY_KEY = 'console-dashboard-summary';

export const PERIODS = [
  { key: 'today', label: 'Today', compare: 'vs yesterday' },
  { key: 'week', label: 'This Week', compare: 'vs last week' },
  { key: 'month', label: 'This Month', compare: 'vs last month' },
];

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/*
 * "+12% vs last week". The backend compares against the same elapsed stretch
 * of the previous period and sends `null` when that period had nothing to
 * compare against.
 */
const Change = ({ pct, compare }) => {
  if (pct === null || pct === undefined) {
    return <span className="text-charcoal-500">No data from {compare.replace('vs ', '')}</span>;
  }
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const tone = pct > 0 ? 'text-emerald-700' : pct < 0 ? 'text-red-700' : 'text-charcoal-500';
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${tone}`}>
      <Icon size={12} />
      {pct > 0 ? '+' : ''}
      {pct}% <span className="font-normal text-charcoal-500">{compare}</span>
    </span>
  );
};

Change.propTypes = {
  pct: PropTypes.number,
  compare: PropTypes.string.isRequired,
};

/**
 * Four compact analytics cards (orders, revenue, AI try-ons, product reviews)
 * with a Today / This Week / This Month switch. Every figure comes from
 * GET /admin/analytics/summary for the selected period.
 *
 * The period can be controlled by the parent (`period` + `onPeriodChange`) so
 * the Charts & Insights section below follows the same switch.
 */
const DashboardSummary = ({ period: controlledPeriod, onPeriodChange }) => {
  const [ownPeriod, setOwnPeriod] = useState('week');
  const period = controlledPeriod ?? ownPeriod;
  const setPeriod = onPeriodChange ?? setOwnPeriod;
  const compare = PERIODS.find((p) => p.key === period).compare;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [SUMMARY_QUERY_KEY, period],
    queryFn: async () => (await api.get('/admin/analytics/summary', { params: { period } })).data,
    staleTime: 60 * 1000,
    placeholderData: (previous) => previous,
  });

  const loadingValue = isLoading ? '…' : null;

  return (
    <section aria-labelledby="dashboard-summary-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="dashboard-summary-heading"
          className="text-[10px] font-semibold uppercase tracking-[0.2em] text-navy-800"
        >
          Analytics Overview
        </h3>
        <div
          className="inline-flex rounded-full bg-cream-200/70 p-1 shadow-neu-inset"
          role="tablist"
          aria-label="Summary period"
        >
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              role="tab"
              aria-selected={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-800/40 ${
                period === p.key
                  ? 'bg-navy-900 text-cream-100 shadow-neu-sm'
                  : 'text-charcoal-600 hover:text-navy-900'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isError && !data ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-3 text-[11px] text-charcoal-600 shadow-neu-inset">
          Unable to load the summary.
          <button type="button" onClick={() => refetch()} className="btn-quiet cursor-pointer">
            Try again
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            index={0}
            label="Orders"
            icon={ShoppingBag}
            value={loadingValue ?? (data?.orders?.total ?? 0).toLocaleString('en-PH')}
            note={data && <Change pct={data.orders.change_pct} compare={compare} />}
          />
          <StatTile
            index={1}
            label="Revenue"
            icon={Wallet}
            value={loadingValue ?? peso(data?.revenue?.total)}
            note={data && <Change pct={data.revenue.change_pct} compare={compare} />}
          />
          <StatTile
            index={2}
            label="AI Try-Ons"
            icon={Sparkles}
            value={loadingValue ?? (data?.try_ons?.total ?? 0).toLocaleString('en-PH')}
            note={data && `${data.try_ons.completed} completed successfully`}
          />
          <StatTile
            index={3}
            label="Product Reviews"
            icon={Star}
            value={loadingValue ?? (data?.reviews?.total ?? 0).toLocaleString('en-PH')}
            note={
              data && (
                data.reviews.average !== null ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-navy-900">
                    <Star size={12} className="text-amber-500" fill="currentColor" />
                    {Number(data.reviews.average).toFixed(1)} Avg.
                  </span>
                ) : (
                  'No ratings yet'
                )
              )
            }
          />
        </div>
      )}
    </section>
  );
};

DashboardSummary.propTypes = {
  period: PropTypes.oneOf(['today', 'week', 'month']),
  onPeriodChange: PropTypes.func,
};

export default DashboardSummary;

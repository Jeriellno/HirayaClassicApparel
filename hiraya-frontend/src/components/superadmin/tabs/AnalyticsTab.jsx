import { useState, useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion, useReducedMotion } from 'framer-motion';
import { Download, BarChart2, CheckCircle2, Sparkles, Activity, Table2, LineChart } from 'lucide-react';
import { ConsoleHeader, Panel, Well, StatTile, StatusChip } from '../ConsoleUI';

/**
 * SUPER ADMIN — CANVAS ANALYTICS.
 *
 * Previously three static totals and a flat list: no way to scope the numbers
 * to a period, and no shape to the activity over time. This adds:
 *   - a date-range filter (7d / 30d / all) applied to BOTH the metrics and the list
 *   - a daily activity trend bar chart over the selected window
 *
 * The aggregates keep the existing honesty rules: the average match and the
 * completed count are derived from the rows that ACTUALLY carry the data, and
 * the trend zero-fills empty days so a gap reads as a gap rather than a
 * misleading squashed axis.
 *
 * PRESENTATION ("Vintage Atelier" console): neumorphic stat tiles, the range
 * filter as one row above everything it scopes, and the trend as a navy
 * column chart in a pressed-in well — columns capped at 24px with a 4px
 * rounded data-end, hairline gridlines on clean ticks, a per-column tooltip
 * on hover AND keyboard (← → inside the chart), and a table view so no value
 * is reachable only by hovering.
 */

const RANGES = [
  { id: '7d', label: 'Last 7 Days', days: 7 },
  { id: '30d', label: 'Last 30 Days', days: 30 },
  { id: 'all', label: 'All Time', days: null },
];

const dayKey = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const EASE = [0.22, 1, 0.36, 1];

// Display only: "2026-09-30" -> "Sep 30". Parsed as UTC to match the key.
const fmtDay = (key) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// A clean ceiling for the y-axis: 1–5 stay whole, larger values snap to 1/2/5×10ⁿ.
const niceCeil = (v) => {
  if (v <= 5) return Math.max(1, Math.ceil(v));
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/*
 * THE DAILY ACTIVITY CHART — a single series, so no legend: the panel title
 * names it. Presentation only; `trend` arrives already computed.
 */
const ActivityChart = ({ trend, maxTrend }) => {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(null);

  const yMax = niceCeil(maxTrend);
  const ticks = yMax <= 5
    ? Array.from({ length: yMax + 1 }, (_, i) => i)
    : [0, yMax / 2, yMax];
  const n = trend.length;
  const labelIdx = n <= 7 ? trend.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const current = active !== null ? trend[active] : null;

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setActive((i) => (i === null ? (step > 0 ? 0 : n - 1) : Math.min(n - 1, Math.max(0, i + step))));
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  };

  return (
    <div>
      <div
        tabIndex={0}
        role="group"
        aria-label="Daily activity chart. Use the left and right arrow keys to read each day."
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        className="relative h-56 pl-9 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus focus-visible:ring-offset-4 focus-visible:ring-offset-cream-200 rounded-lg"
      >
        {/* Hairline gridlines on clean ticks. */}
        {ticks.map((t) => (
          <div
            key={t}
            aria-hidden="true"
            className="absolute left-9 right-0 border-t border-charcoal-200/80"
            style={{ bottom: `${(t / yMax) * 100}%` }}
          >
            <span className="absolute -left-9 w-7 -translate-y-1/2 text-right text-[10px] tabular-nums text-charcoal-500">
              {t}
            </span>
          </div>
        ))}

        {/* Columns — each slot is the hit target, wider than the bar in it. */}
        <div className="absolute inset-y-0 left-9 right-0 flex items-end gap-[2px]">
          {trend.map((t, i) => (
            <div
              key={t.key}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive(null)}
              className="relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center"
            >
              <motion.span
                aria-hidden="true"
                initial={reduce ? false : { height: 0 }}
                animate={{ height: t.count ? `${(t.count / yMax) * 100}%` : 0 }}
                transition={{ duration: 0.7, ease: EASE, delay: reduce ? 0 : Math.min(i * 0.015, 0.4) }}
                className={`block w-full max-w-[24px] rounded-t-[4px] transition-colors duration-200 ${
                  active === i ? 'bg-navy-600' : 'bg-navy-800'
                } ${t.count ? 'min-h-[3px]' : ''}`}
              />
            </div>
          ))}
        </div>

        {/* Tooltip — value leads, the day follows. */}
        {current && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-xl bg-navy-950 px-3 py-2 text-center shadow-neu-dark"
            style={{
              left: `calc(2.25rem + (100% - 2.25rem) * ${(active + 0.5) / n})`,
              bottom: `calc(${(current.count / yMax) * 100}% + 10px)`,
            }}
          >
            <p className="text-sm font-semibold text-cream-50">{current.count} {current.count === 1 ? 'interaction' : 'interactions'}</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-cream-400">{fmtDay(current.key)}</p>
          </div>
        )}

        {/* Keyboard readers hear the focused day. */}
        <p className="sr-only" aria-live="polite">
          {current ? `${fmtDay(current.key)}: ${current.count} interactions` : ''}
        </p>
      </div>

      {/* X-axis: first, middle and last day (every day for a week). */}
      <div aria-hidden="true" className="relative ml-9 mt-2 h-4">
        {labelIdx.map((i) => (
          <span
            key={trend[i].key}
            className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] tabular-nums text-charcoal-500"
            style={{ left: `${((i + 0.5) / n) * 100}%` }}
          >
            {fmtDay(trend[i].key)}
          </span>
        ))}
      </div>
    </div>
  );
};

ActivityChart.propTypes = {
  trend: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string, count: PropTypes.number })).isRequired,
  maxTrend: PropTypes.number.isRequired,
};

const AnalyticsTab = ({ analyticsLogs = [], exportSurveyCSV }) => {
  const [range, setRange] = useState('30d');
  // Chart or table — the same figures, two ways to read them.
  const [view, setView] = useState('chart');

  const activeRange = RANGES.find((r) => r.id === range) || RANGES[1];

  // Apply the window filter at the source so every downstream figure and the
  // list agree by construction.
  const logs = useMemo(() => {
    if (!activeRange.days) return analyticsLogs;
    const cutoff = Date.now() - activeRange.days * 24 * 60 * 60 * 1000;
    return analyticsLogs.filter((l) => {
      const t = new Date(l.created_at).getTime();
      return Number.isNaN(t) ? false : t >= cutoff;
    });
  }, [analyticsLogs, activeRange.days]);

  const totalLogs = logs.length;

  /*
   * REAL ENGAGEMENT METRICS — NO FABRICATED MATCH SCORE.
   *
   * "Avg Stylist Match" was computed from `match_score`, a field the try-on
   * pipeline has never produced (it belonged to the retired Supabase
   * `canvas_analytics` table), so the card permanently read "—". A metric that
   * can never have a value is worse than no metric, so it is replaced with
   * figures the session table ACTUALLY records:
   *
   *   - completed fittings (status = completed)
   *   - failed fittings   (status = failed) — the other half of the outcome
   */
  const completedCount = logs.filter((l) => l.status === 'completed').length;
  const failedCount = logs.filter((l) => l.status === 'failed').length;

  const completionRate = totalLogs > 0
    ? Math.round((completedCount / totalLogs) * 100)
    : null;

  /*
   * DAILY TREND over the selected window.
   *
   * For a fixed window we zero-fill every day so an idle day is a visible gap;
   * for "all time" we bucket only the days that actually have events, since
   * zero-filling an unbounded range could emit hundreds of empty columns.
   */
  const trend = useMemo(() => {
    const counts = new Map();
    logs.forEach((l) => {
      const key = dayKey(l.created_at);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });

    if (!activeRange.days) {
      return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count }));
    }

    const days = [];
    for (let i = activeRange.days - 1; i >= 0; i -= 1) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days.push({ key, count: counts.get(key) || 0 });
    }
    return days;
  }, [logs, activeRange.days]);

  const maxTrend = Math.max(1, ...trend.map((t) => t.count));
  const hasActivity = trend.length > 0 && maxTrend > 0 && trend.some((t) => t.count > 0);

  return (
    <div className="space-y-7 animate-fadeIn">
      <ConsoleHeader
        kicker="Research"
        icon={BarChart2}
        title="Canvas Research Analytics & Data Export"
        subtitle="Quantitative fitting interaction logs and capstone research metrics."
      >
        <button
          onClick={exportSurveyCSV}
          className="btn-primary cursor-pointer rounded-full px-6 py-3"
        >
          <Download size={15} /> Export Dataset (CSV)
        </button>
      </ConsoleHeader>

      {/* RANGE FILTER — one row, above everything it scopes. */}
      <div className="inline-flex rounded-full bg-cream-200/70 p-1 shadow-neu-inset" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            aria-pressed={range === r.id}
            className={`relative cursor-pointer rounded-full px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${
              range === r.id ? 'text-hiraya-on-accent' : 'text-hiraya-ink-soft hover:text-hiraya-ink'
            }`}
          >
            {range === r.id && (
              <motion.span
                layoutId="analytics-range-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="absolute inset-0 rounded-full bg-hiraya-accent shadow-[0_8px_16px_-8px_rgba(21,32,54,0.7)]"
              />
            )}
            <span className="relative">{r.label}</span>
          </button>
        ))}
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatTile index={0} label="Total interactions" value={totalLogs} icon={Activity} note={activeRange.label} />
        <StatTile
          index={1}
          label="Completion rate"
          value={completionRate === null ? '—' : `${completionRate}%`}
          icon={Sparkles}
          meter={completionRate === null ? null : completionRate}
          note={totalLogs > 0
            ? `${completedCount} of ${totalLogs} finished${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
            : 'no sessions yet'}
        />
        <StatTile index={2} label="Completed fittings" value={completedCount} icon={CheckCircle2} />
      </div>

      {/* ACTIVITY TREND */}
      <Panel
        title={<>Daily activity <span className="font-normal normal-case tracking-normal text-charcoal-500">({activeRange.label})</span></>}
        icon={Activity}
        action={
          hasActivity && (
            <div className="inline-flex rounded-full bg-cream-200/70 p-1 shadow-neu-inset" role="group" aria-label="Show as">
              {[
                { id: 'chart', label: 'Chart', Icon: LineChart },
                { id: 'table', label: 'Table', Icon: Table2 },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  aria-pressed={view === id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${
                    view === id ? 'bg-hiraya-surface text-hiraya-ink shadow-neu-sm' : 'text-charcoal-500 hover:text-hiraya-ink'
                  }`}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          )
        }
      >
        {hasActivity ? (
          <Well className="px-4 pb-3 pt-6 sm:px-5">
            {view === 'chart' ? (
              <ActivityChart trend={trend} maxTrend={maxTrend} />
            ) : (
              <div className="max-h-64 overflow-y-auto pr-1">
                <table className="table-heritage">
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      <th scope="col" className="text-right">Interactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...trend].reverse().map((t) => (
                      <tr key={t.key}>
                        <td>{fmtDay(t.key)}</td>
                        <td className="text-right tabular-nums">{t.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Well>
        ) : (
          <Well className="py-10 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-500">
            No activity in this period
          </Well>
        )}
      </Panel>

      {/* Interaction stream */}
      <Panel title="Try-on activity" icon={BarChart2}>
        {logs.length > 0 ? (
          <ul className="max-h-[28rem] space-y-2.5 overflow-y-auto pr-1">
            {logs.map((log, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-3 rounded-xl bg-cream-200/45 px-4 py-3 text-xs shadow-neu-inset"
              >
                <div className="flex min-w-0 items-center gap-3 text-hiraya-ink">
                  <span className="w-8 shrink-0 text-[10px] tabular-nums text-charcoal-500">#{idx + 1}</span>
                  <span className="truncate">{log.user_name || 'Customer'} - {log.item_name || 'Garment Item'}</span>
                </div>
                <StatusChip status={log.status} />
              </li>
            ))}
          </ul>
        ) : (
          <Well className="py-10 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-charcoal-500">
            No research interaction logs captured in this period
          </Well>
        )}
      </Panel>
    </div>
  );
};

AnalyticsTab.propTypes = {
  analyticsLogs: PropTypes.array,
  exportSurveyCSV: PropTypes.func,
};

export default AnalyticsTab;

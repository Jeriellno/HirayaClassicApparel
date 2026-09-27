import React, { useState, useMemo } from 'react';
import { Download, BarChart2, PieChart, Sparkles, Activity } from 'lucide-react';

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

const AnalyticsTab = ({ analyticsLogs = [], exportSurveyCSV }) => {
  const [range, setRange] = useState('30d');

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

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-hiraya-olive/15">
        <div>
          <h2 className="text-xl font-light uppercase tracking-[0.2em] text-hiraya-ink">
            Canvas Research Analytics &amp; Data Export
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            Quantitative fitting interaction logs and capstone research metrics.
          </p>
        </div>
        <button
          onClick={exportSurveyCSV}
          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-hiraya-ink text-xs font-mono font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <Download size={15} /> Export Dataset (CSV)
        </button>
      </div>

      {/* RANGE FILTER */}
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`px-4 py-2 rounded-lg text-[10px] font-mono uppercase tracking-widest border transition cursor-pointer ${
              range === r.id
                ? 'bg-[#CB997E]/15 text-hiraya-ink border-[#CB997E]/40 font-medium'
                : 'text-hiraya-ink border-hiraya-olive/15 hover:text-hiraya-ink hover:border-hiraya-olive/30'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Visual Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Total Interactions</span>
            <Activity size={16} className="text-hiraya-ink" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">{totalLogs}</p>
        </div>

        <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Completion Rate</span>
            <Sparkles size={16} className="text-emerald-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-emerald-400 pt-1">
            {completionRate === null ? '—' : `${completionRate}%`}
          </p>
          <p className="text-[10px] text-hiraya-sand">
            {totalLogs > 0
              ? `${completedCount} of ${totalLogs} finished${failedCount > 0 ? ` · ${failedCount} failed` : ''}`
              : 'no sessions yet'}
          </p>
        </div>

        <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Completed Fittings</span>
            <PieChart size={16} className="text-purple-400" />
          </div>
          <p className="text-3xl font-mono font-bold text-purple-400 pt-1">{completedCount}</p>
        </div>
      </div>

      {/* ACTIVITY TREND */}
      <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
          <Activity size={16} className="text-hiraya-ink" /> Daily Activity
          <span className="text-hiraya-sand normal-case tracking-normal">
            ({activeRange.label})
          </span>
        </h3>

        {trend.length > 0 && maxTrend > 0 && trend.some((t) => t.count > 0) ? (
          <div className="flex items-end gap-1 h-28">
            {trend.map((t) => (
              <div
                key={t.key}
                className="flex-1 min-w-[3px] bg-[#CB997E]/70 hover:bg-[#CB997E] rounded-t transition"
                style={{ height: `${Math.max(2, (t.count / maxTrend) * 100)}%` }}
                title={`${t.key}: ${t.count}`}
              />
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest">
            No activity in this period
          </div>
        )}
      </div>

      {/* Interaction Table */}
      <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-2.5">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink mb-3 flex items-center gap-2">
          <BarChart2 size={16} className="text-hiraya-ink" /> Live Try-On Activity Stream
        </h3>

        {logs.length > 0 ? (
          logs.map((log, idx) => (
            <div key={idx} className="p-3.5 bg-hiraya-cream/30 border border-hiraya-olive/15 rounded-xl flex justify-between items-center text-xs font-mono hover:border-hiraya-olive/15 transition">
              <div className="flex items-center gap-2.5 text-hiraya-ink">
                <span className="text-hiraya-sand text-[10px]">#{idx + 1}</span>
                <span>{log.user_name || 'Customer'} - {log.item_name || 'Garment Item'}</span>
              </div>
              <span className={`px-2.5 py-1 rounded text-[10px] border ${
                log.status === 'completed'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : log.status === 'failed'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-[#CB997E]/10 border-[#CB997E]/30 text-hiraya-ink'
              }`}>
                {log.status || 'queued'}
              </span>
            </div>
          ))
        ) : (
          <div className="py-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest">
            No research interaction logs captured in this period
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsTab;

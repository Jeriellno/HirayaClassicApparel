import React from 'react';
import { RefreshCw, Sparkles, MessageSquare, Layers, Activity, ShieldCheck } from 'lucide-react';

const DashboardTab = ({ 
  products = [], 
  activeSessions = 0, 
  feedbacks = [], 
  analyticsLogs = [], 
  onSync, 
  onRefresh,
  loading
}) => {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#CB997E]/5 rounded-full blur-3xl pointer-events-none" />
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={16} className="text-hiraya-ink" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-hiraya-ink">SuperAdmin Control Center</span>
          </div>
          <h2 className="text-xl font-light uppercase tracking-[0.2em] text-hiraya-ink">
            System Executive Dashboard
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            Real-time system health, research analytics, and live AI pipeline metrics.
          </p>
        </div>

        <button
          onClick={onSync || onRefresh} 
          disabled={loading}
          title="Re-read the data this tab shows"
          className="px-5 py-2.5 bg-[#CB997E]/10 hover:bg-[#CB997E]/20 border border-[#CB997E]/30 rounded-xl text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw size={14} className={loading ?"animate-spin text-hiraya-ink" :""} />
          <span>Refresh Dashboard</span>
        </button>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column (2 Span): Logs & Feedbacks */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Try-On Activity Card */}
          <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-hiraya-olive/15 pb-3">
              <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
                <Sparkles size={16} className="text-hiraya-ink" /> Recent Try-On Activity
              </h3>
              <span className="text-[9px] font-mono text-hiraya-ink bg-[#CB997E]/10 px-2.5 py-0.5 rounded border border-[#CB997E]/20">
                Live Stream
              </span>
            </div>

            <div className="space-y-2.5">
              {analyticsLogs && analyticsLogs.length > 0 ? (
                analyticsLogs.slice(0, 5).map((log, idx) => (
                  <div key={log.id || idx} className="flex justify-between items-center p-3 bg-hiraya-cream/30 border border-hiraya-olive/15 rounded-xl text-xs transition hover:border-[#CB997E]/40">
                    <div className="space-y-0.5">
                      <p className="font-mono text-hiraya-ink text-xs">{log.item_name || 'Garment Item'}</p>
                      <p className="text-[10px] text-hiraya-ink font-mono">
                        Paired with: <span className="text-hiraya-ink">{log.paired_item || 'None'}</span>
                      </p>
                    </div>
                    {/*
                     * STATUS, NOT A FAKE MATCH SCORE.
                     *
                     * This badge used to render `log.match_score`, a field the
                     * try-on pipeline has never produced (it came from the retired
                     * Supabase `canvas_analytics` table), so every row read
                     * "Match: —". The real, recorded outcome of a session is its
                     * status — queued / processing / completed / failed — so that
                     * is what is shown instead of an invented percentage.
                     */}
                    <span
                      className={`px-2.5 py-1 rounded text-[10px] border font-mono uppercase ${
                        log.status === 'completed'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : log.status === 'failed'
                          ? 'bg-red-500/10 text-red-400 border-red-500/30'
                          : 'bg-[#CB997E]/10 text-hiraya-ink border-[#CB997E]/20'
                      }`}
                    >
                      {log.status || 'queued'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest">
                  No recent AI try-on activity recorded
                </div>
              )}
            </div>
          </div>

          {/* Recent Feedback Card */}
          <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-hiraya-olive/15 pb-3">
              <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
                <MessageSquare size={16} className="text-emerald-400" /> Recent User Responses
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {feedbacks && feedbacks.length > 0 ? (
                feedbacks.slice(0, 4).map((fb, idx) => (
                  <div key={fb.id || idx} className="p-3.5 bg-hiraya-cream/30 rounded-xl border border-hiraya-olive/15 text-xs space-y-2 flex flex-col justify-between">
                    {/* `comment` is the only text column on `feedbacks`; the old
                        `fb.comment || fb.message` fallback read a field that has
                        never existed. */}
                    <p className="text-hiraya-ink italic text-[11px]">&quot;{fb.comment || '(no comment)'}&quot;</p>
                    <p className="text-[9px] text-hiraya-sand font-mono border-t border-hiraya-olive/15 pt-2 uppercase">
                      User: {fb.user_name || fb.user_email || 'Respondent'}
                    </p>
                  </div>
                ))
              ) : (
                <div className="col-span-2 py-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest">
                  No feedback responses recorded
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Right Column: Vertical Metrics */}
        <div className="space-y-4">
          <div className="p-4 bg-[#CB997E]/10 border border-[#CB997E]/30 rounded-2xl space-y-1">
            <p className="text-[9px] uppercase tracking-widest text-hiraya-ink font-mono">System Integrity</p>
            <p className="text-xs text-hiraya-ink font-light">All core database pipelines and AI canvas modules operating at optimal status.</p>
          </div>

          <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-hiraya-ink">
              <span className="text-[10px] font-mono uppercase tracking-wider">Active Items</span>
              <Layers size={16} className="text-hiraya-sand" />
            </div>
            <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">{products.length}</p>
          </div>

          <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-hiraya-ink">
              <span className="text-[10px] font-mono uppercase tracking-wider">Canvas Sessions</span>
              <Activity size={16} className="text-hiraya-ink" />
            </div>
            <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">{activeSessions}</p>
          </div>

          <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-hiraya-ink">
              <span className="text-[10px] font-mono uppercase tracking-wider">Survey Feedbacks</span>
              <MessageSquare size={16} className="text-emerald-400" />
            </div>
            <p className="text-3xl font-mono font-bold text-emerald-400 pt-1">{feedbacks.length}</p>
          </div>

          <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
            <div className="flex items-center justify-between text-hiraya-ink">
              <span className="text-[10px] font-mono uppercase tracking-wider">AI Try-On Logs</span>
              <Sparkles size={16} className="text-purple-400" />
            </div>
            <p className="text-3xl font-mono font-bold text-purple-400 pt-1">{analyticsLogs.length}</p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default DashboardTab;
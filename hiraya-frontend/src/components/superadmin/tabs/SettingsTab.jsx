import React, { useState } from 'react';
import { Database, RotateCcw, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';

/*
 * The global platform toggles, in the order a superadmin reads them. Each
 * carries its own copy so the switch is never a bare label: an operator should
 * be able to tell what a flip ACTUALLY changes.
 *
 * "Maintenance Mode" was REMOVED. It paused the storefront for every visitor,
 * which is the single most disruptive control in the console and is not part of
 * the current work. The backend flag still exists (see SuperAdminController),
 * so the feature can be reinstated with one entry here plus its consumer — it is
 * simply not exposed as a one-click switch right now.
 *
 * "Guest AI Access" was REMOVED for a harder reason: it had NO consumer at all.
 * The flag was written and reported but nothing read it, so flipping it changed
 * nothing a customer could observe — the "live-looking but inert" trap this
 * console deliberately avoids. Making it real is NOT a matter of reading it in
 * App.jsx: the entire try-on pipeline is built on an authenticated user
 * (TryOnController reads $request->user()->id, the saved portrait, the bag and
 * the stored measurements), and every /tryon/* route sits behind auth:sanctum.
 * A guest fitting would need an anonymous-session model on the backend first.
 * Rather than expose a switch that cannot do what its label says, the flag —
 * like maintenance_mode — is left in the backend settings rows but removed from
 * this surface, so it can be reinstated the day the pipeline supports guests.
 */
const TOGGLES = [
  {
    key: 'ai_engine_active',
    name: 'AI Engine Active',
    description: 'Master switch for the AI try-on render and stylist pipeline.',
  },
  {
    key: 'registrations_open',
    name: 'Registrations Open',
    description: 'Accepts new customer sign-ups on the storefront.',
  },
];

const SettingsTab = ({ settings = {}, onToggle, onExportBackup, onClearDemoAnalytics }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [togglingKey, setTogglingKey] = useState('');

  const handleToggle = async (key) => {
    if (!onToggle) return;
    setTogglingKey(key);
    try {
      await onToggle(key);
    } finally {
      setTogglingKey('');
    }
  };

  const handleExportBackup = async () => {
    if (!onExportBackup) return;
    setIsExporting(true);
    try {
      await onExportBackup();
    } finally {
      setIsExporting(false);
    }
  };

  const handleClearDemo = async () => {
    if (!onClearDemoAnalytics) return;
    setIsClearing(true);
    try {
      await onClearDemoAnalytics();
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      <div>
        <h2 className="text-xl font-light uppercase tracking-[0.2em] text-hiraya-ink">
          System Controls &amp; Utilities
        </h2>
        <p className="text-xs text-hiraya-ink mt-1">
          Manage global platform parameters and database utility operations.
        </p>
      </div>

      {/* Global platform toggles */}
      <div className="space-y-3">
        {TOGGLES.map((toggle) => {
          const isOn = !!settings[toggle.key];
          const isBusy = togglingKey === toggle.key;
          return (
            <div
              key={toggle.key}
              className="p-4 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <p className="text-sm text-hiraya-ink font-medium flex items-center gap-2">
                  {toggle.name}
                </p>
                <p className="text-[11px] text-hiraya-sand mt-0.5">{toggle.description}</p>
              </div>

              <button
                type="button"
                onClick={() => handleToggle(toggle.key)}
                disabled={isBusy || !onToggle}
                title={isOn ? 'Turn off' : 'Turn on'}
                className="shrink-0 text-hiraya-ink disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isBusy ? (
                  <Loader2 size={24} className="animate-spin" />
                ) : isOn ? (
                  <ToggleRight size={32} />
                ) : (
                  <ToggleLeft size={32} className="text-hiraya-sand" />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Utilities Section */}
      <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-4 pt-6 mt-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
          <Database size={16} className="text-hiraya-ink" /> Capstone Demo Utilities
        </h3>
        <p className="text-[11px] text-hiraya-sand normal-case tracking-normal">
          The reset zeroes the per-product canvas-drag and try-on interaction
          counters that feed the trending-garments rankings. It does NOT delete
          orders, accounts or feedback — only those two counters.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportBackup}
            disabled={isExporting}
            className="px-4 py-2 bg-hiraya-cream/60 hover:bg-hiraya-cream/60 border-hiraya-olive/15 text-hiraya-ink text-xs font-mono rounded-xl flex items-center gap-2 transition cursor-pointer"
          >
            {isExporting ? <Loader2 size={14} className="animate-spin text-hiraya-ink" /> : <Database size={14} className="text-hiraya-ink" />}
            {isExporting ? 'Generating Backup...' : 'Export Full Backup'}
          </button>

          <button
            onClick={handleClearDemo}
            disabled={isClearing}
            className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border-red-500/30 text-red-400 text-xs font-mono rounded-xl flex items-center gap-2 transition cursor-pointer"
          >
            {isClearing ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            {isClearing ? 'Resetting...' : 'Reset Demo Interaction Counters'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsTab;

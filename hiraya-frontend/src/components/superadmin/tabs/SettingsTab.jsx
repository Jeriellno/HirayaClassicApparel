import React, { useEffect, useState } from 'react';
import { Database, RotateCcw, Loader2, ToggleLeft, ToggleRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import MfaEnrollment from '../../settings/MfaEnrollment';
import { supabase } from '../../../services/supabase';
import { roleOf } from '../../../services/supabaseMfa';

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
  const { user } = useAuth();

  /*
   * THE ROLE COMES FROM SUPABASE, NOT FROM useAuth().
   *
   * Staff sign in through /login, which is a Supabase sign-in. It mints a
   * Supabase session and NO Sanctum one, so `useAuth().user` is null for every
   * console user. Reading the role from there — as this tab used to — made
   * `signedInRole` resolve to '' and the 2FA panel below render its
   * customer-facing "staff only" copy to the very person operating the console.
   *
   * The Supabase session is the authoritative identity for the console, and it
   * is already the session the API is authorized against.
   */
  const [supabaseRole, setSupabaseRole] = useState('');
  const [consoleEmail, setConsoleEmail] = useState('');

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSupabaseRole(roleOf(data?.session?.user));
      setConsoleEmail(data?.session?.user?.email ?? '');
    });

    return () => {
      cancelled = true;
    };
  }, []);

  /*
   * WHOSE 2FA IS BEING EDITED.
   *
   * The console is the one place a privileged operator is signing in from a
   * machine they control, in front of an audience, to fix a problem. That is the
   * worst possible moment to be handed a form whose primary action is "Turn On
   * two-factor" — especially for the superadmin, for whom enrolment is not a
   * suggestion but the reason the account is safe to own at all.
   *
   * So the panel is bound to the SIGNED-IN user, not to a row someone picked in
   * a list. There is deliberately no target selector here.
   */
  const signedInRole = supabaseRole || String(user?.role || '').toLowerCase().replace(/[\s_-]+/g, '');

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
        <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900">
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
              className="p-4 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 flex items-center justify-between gap-4"
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
                className="shrink-0 text-hiraya-ink disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none disabled:cursor-not-allowed cursor-pointer"
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

      {/* YOUR OWN ACCOUNT SECURITY */}
      <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-4 pt-6 mt-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
          <ShieldCheck size={16} className="text-hiraya-ink" /> Your Account Security
        </h3>
        <p className="text-[11px] text-hiraya-sand normal-case tracking-normal">
          Two-factor authentication on the account you are signed in with
          {consoleEmail && <span className="text-hiraya-ink"> ({consoleEmail})</span>}.
          This is the account that grants everything this console can do.
        </p>

        <MfaEnrollment userRole={signedInRole} />
      </div>

      {/* Utilities Section */}
      <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-4 pt-6 mt-6">
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
            className="px-4 py-2 bg-cream-200/60 hover:bg-cream-200/60 border-hiraya-structure-line/80 text-hiraya-ink text-xs font-mono rounded-xl flex items-center gap-2 transition cursor-pointer"
          >
            {isExporting ? <Loader2 size={14} className="animate-spin text-hiraya-ink" /> : <Database size={14} className="text-hiraya-ink" />}
            {isExporting ? 'Generating Backup...' : 'Export Full Backup'}
          </button>

          <button
            onClick={handleClearDemo}
            disabled={isClearing}
            className="px-4 py-2 bg-red-500/12 hover:bg-red-500/20 border-red-600/40 text-red-700 text-xs font-mono rounded-xl flex items-center gap-2 transition cursor-pointer"
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

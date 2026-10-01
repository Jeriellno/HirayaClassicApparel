import React, { useEffect, useState } from 'react';
import ChangePasswordForm from '../ChangePasswordForm';
import { Database, Download, RotateCcw, Loader2, KeyRound, ToggleLeft, ToggleRight, ShieldCheck } from 'lucide-react';
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
    name: 'AI try-on & stylist',
    description: 'Turn off to pause the virtual try-on and AI stylist for customers — e.g. while the AI service is down or out of credits.',
  },
  {
    key: 'registrations_open',
    name: 'Customer sign-ups',
    description: 'Turn off to stop new customers from creating accounts. Existing customers can still sign in.',
  },
];

const SettingsTab = ({ settings = {}, onToggle, onExportBackup, onClearDemoAnalytics }) => {
  // Which backup format is downloading ('' when idle).
  const [isExporting, setIsExporting] = useState('');
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

  const handleExportBackup = async (format) => {
    if (!onExportBackup || isExporting) return;
    setIsExporting(format);
    try {
      await onExportBackup(format);
    } finally {
      setIsExporting('');
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
          System Settings
        </h2>
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
        {consoleEmail && <p className="text-[11px] text-hiraya-sand normal-case tracking-normal">{consoleEmail}</p>}

        <MfaEnrollment userRole={signedInRole} />
      </div>

      {/* CHANGE MY PASSWORD (super admin) */}
      <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-4 pt-6 mt-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
          <KeyRound size={16} className="text-hiraya-ink" /> Change My Password
        </h3>
        <div className="max-w-sm"><ChangePasswordForm /></div>
      </div>

      {/* DATABASE BACKUP — the safety copy against corrupted or deleted data. */}
      <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-4 pt-6 mt-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
          <Database size={16} className="text-hiraya-ink" /> Database Backup
        </h3>
        <p className="text-[11px] text-hiraya-sand normal-case tracking-normal leading-relaxed">
          A full copy of the store&apos;s data, in case anything is corrupted or deleted.
          Keep it somewhere safe — it contains customer data.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { format: 'json', title: 'JSON backup', note: 'Readable copy of every table, for safekeeping.' },
            { format: 'sql', title: 'SQL restore script', note: 'Paste into the Supabase SQL editor to put missing rows back.' },
          ].map((opt) => (
            <button
              key={opt.format}
              type="button"
              onClick={() => handleExportBackup(opt.format)}
              disabled={Boolean(isExporting)}
              className="flex items-start gap-3 rounded-xl border border-hiraya-structure-line/80 bg-cream-200/50 p-3.5 text-left transition hover:bg-cream-200 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {isExporting === opt.format
                ? <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-hiraya-ink" />
                : <Download size={16} className="mt-0.5 shrink-0 text-hiraya-ink" />}
              <span>
                <span className="block text-xs font-semibold text-hiraya-ink">
                  {isExporting === opt.format ? 'Preparing download…' : opt.title}
                </span>
                <span className="mt-0.5 block text-[10px] text-hiraya-sand">{opt.note}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Demo utilities */}
      <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-4 pt-6 mt-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-hiraya-ink flex items-center gap-2">
          <RotateCcw size={16} className="text-hiraya-ink" /> Demo Tools
        </h3>
        <p className="text-[11px] text-hiraya-sand normal-case tracking-normal">
          Resets the product try-on counters used for “trending”. Orders, accounts and feedback are not affected.
        </p>

        <div className="flex flex-wrap gap-3">
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

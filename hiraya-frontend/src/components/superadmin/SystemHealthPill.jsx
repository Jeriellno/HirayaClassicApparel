import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import api from '../../api/axios';

/*
 * SYSTEM HEALTH — the super admin's one glance at "is everything working?".
 *
 * Replaces the developer-facing "API & AI" section (keys, endpoints, env
 * names). The owner only needs to know whether the AI stylist, the virtual
 * try-on, sign-in/storage and the database are working, in plain words. The
 * backend probes each service and caches the answer for five minutes; this
 * re-checks on its own every five minutes — no refresh button.
 */

const STATE = {
  healthy: { label: 'System healthy', Icon: CheckCircle2, pill: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800', dot: 'text-emerald-700', word: 'Working' },
  attention: { label: 'Needs attention', Icon: AlertTriangle, pill: 'border-amber-600/40 bg-amber-500/15 text-amber-800', dot: 'text-amber-700', word: 'Needs attention' },
  down: { label: 'Service down', Icon: XCircle, pill: 'border-red-600/40 bg-red-500/12 text-red-700', dot: 'text-red-700', word: 'Not working' },
};

export default function SystemHealthPill() {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['console-system-health'],
    queryFn: async () => (await api.get('/admin/system-health', { timeout: 60000 })).data,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });

  // Close the panel on an outside click.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const overall = isError ? 'attention' : data?.overall;
  const meta = STATE[overall] || null;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition ${
          meta ? meta.pill : 'border-hiraya-structure-line bg-cream-200/60 text-charcoal-600'
        }`}
      >
        {isLoading ? <Loader2 size={12} className="animate-spin" /> : meta ? <meta.Icon size={12} /> : <Activity size={12} />}
        <span className="hidden sm:inline">{isLoading ? 'Checking…' : meta?.label || 'System status'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-80 rounded-2xl bg-hiraya-surface p-4 shadow-neu ring-1 ring-cream-50/80">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-hiraya-ink">System health</p>
          {isError ? (
            <p className="mt-2 text-[11px] text-amber-800">The health check could not be reached right now.</p>
          ) : !data ? (
            <p className="mt-2 text-[11px] text-charcoal-600">Checking the services…</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.services.map((s) => {
                const m = STATE[s.state] || STATE.attention;
                return (
                  <li key={s.key} className="flex items-start gap-2.5">
                    <m.Icon size={15} className={`mt-0.5 shrink-0 ${m.dot}`} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-hiraya-ink">
                        {s.label} <span className={`text-[10px] font-semibold ${m.dot}`}>· {m.word}</span>
                      </p>
                      <p className="text-[10px] leading-snug text-charcoal-600">{s.state === 'healthy' ? s.what : s.summary}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {data?.checked_at && (
            <p className="mt-3 border-t border-hiraya-structure-line pt-2 text-[9px] text-charcoal-500">
              Checked {new Date(data.checked_at).toLocaleTimeString()} · re-checks every 5 minutes
            </p>
          )}
        </div>
      )}
    </div>
  );
}

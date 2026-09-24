import { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Plug,
  ShieldCheck,
  Activity,
  Clock,
} from 'lucide-react';
import api from '../../../api/axios';

/**
 * API STATUS — external AI / credential observability for super admins.
 *
 * WHY THIS TAB EXISTS
 * -------------------
 * The platform depends on third-party keys (PixelAPI for the try-on render,
 * Gemini for catalog vision, Supabase for asset storage). Previously the ONLY way
 * to discover that a key was missing, rejected, or out of daily quota was to have
 * a customer press "Generate Virtual Fitting" and read the failure off the canvas.
 * This tab makes that state visible, deliberately, before it costs a fitting.
 *
 * READ-ONLY BY DESIGN
 * -------------------
 * This screen REPORTS; it never changes how a key is used. Rotation stays an
 * `.env` edit, and each card states the exact variable and commands required. That
 * is a deliberate boundary, not a missing feature: writing a live `.env` from a
 * web form needs a writable filesystem in production and a half-written `.env`
 * takes the whole app down rather than just the key being rotated.
 *
 * The backend returns secrets MASKED (length + last 4), never in full — so this
 * component has nothing sensitive to leak even accidentally.
 */
const ApiStatusTab = () => {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Per-service probe state, keyed by service id, so testing one service never
  // blocks (or appears to affect) another.
  const [probing, setProbing] = useState({});
  const [probes, setProbes] = useState({});

  /*
   * CONFIG-ONLY LOAD.
   *
   * This request touches no vendor: it reads the server's own config, so it is
   * safe to run the moment the tab opens. The live outbound checks are opt-in per
   * service below — the dev server is single-threaded, so a page that auto-probed
   * every vendor would compete with real renders for the one worker.
   */
  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/api-status');
      setPayload(res.data);
    } catch (err) {
      setError(
        err?.response?.data?.message || 'Could not load the API status report.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const runProbe = async (key) => {
    setProbing((p) => ({ ...p, [key]: true }));
    setProbes((p) => ({ ...p, [key]: null }));

    try {
      const res = await api.post(`/admin/api-status/${key}/probe`);
      setProbes((p) => ({ ...p, [key]: res.data }));
    } catch (err) {
      setProbes((p) => ({
        ...p,
        [key]: {
          ok: false,
          reachable: false,
          summary: 'The probe request itself failed.',
          detail: err?.response?.data?.message || err.message,
        },
      }));
    } finally {
      setProbing((p) => ({ ...p, [key]: false }));
    }
  };

  /* A row is only "ready" when it is configured; liveness is the probe's job. */
  const readyCount = payload?.services?.filter((s) => s.configured).length ?? 0;
  const totalCount = payload?.services?.length ?? 0;

  /*
   * PROVIDER HEALTH — the verdict that `configured` alone cannot give.
   *
   * `tryon_ready` (below) is TRUE whenever the PixelAPI token is present, which
   * stays true while the provider is degraded and every fitting is failing. This
   * is the state an operator actually needs during an incident, and it is derived
   * from RECORDED observations (the scheduled probe + real render failures), not
   * from config.
   */
  const health = payload?.provider_health;

  /*
   * A STALE CHECKER IS NOT A HEALTHY PROVIDER.
   *
   * The scheduled probe runs every 5 minutes, so a last observation older than the
   * backend's `stale_after_minutes` means the CHECKER stopped — a different fault
   * from the provider being down, and one that must not render as green.
   */
  const healthStale =
    health?.known &&
    health?.minutes_since_check != null &&
    health.minutes_since_check > (health.stale_after_minutes ?? 15);

  const healthTone = !health?.known
    ? 'unknown'
    : healthStale
      ? 'stale'
      : health.degraded
        ? 'bad'
        : health.blocking
          ? 'misconfigured'
          : 'good';

  const healthCopy = {
    unknown: {
      title: 'Provider health is not yet known',
      body: 'No observation has been recorded. The scheduled check (php artisan tryon:check-provider, every 5 minutes) has not logged a result yet.',
    },
    stale: {
      title: 'The provider health checker is not running',
      body: `The last observation was ${health?.minutes_since_check} minutes ago, past the ${health?.stale_after_minutes}-minute freshness window. The provider may or may not be healthy — nothing is measuring it. Check that the scheduler is running.`,
    },
    bad: {
      title: 'The provider is degraded — fittings are failing for everyone',
      body: health?.last_message
        ? health.last_message
        : 'PixelAPI reported a provider-side fault. This is not caused by any customer action, and nothing was charged.',
    },
    /*
     * NOT A PROVIDER OUTAGE — and deliberately worded so it is never mistaken for
     * one. A missing token stops every render just as surely as a degraded vendor,
     * but the remedy is ours, not the vendor's, so the action here is "set the key"
     * rather than "wait it out".
     */
    misconfigured: {
      title: 'Virtual Try-On cannot render — the API key is missing',
      body: health?.last_message
        ? health.last_message
        : 'The provider is not being probed because VTON_API_URL / VTON_API_TOKEN are not set. This is a configuration problem on our side, not a provider outage.',
    },
    good: {
      title: 'The provider is healthy',
      body: 'The last check reached PixelAPI and it answered correctly.',
    },
  }[healthTone];

  const fmtWhen = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn font-mono text-xs">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-[#E9C46A] flex items-center gap-2">
            <KeyRound size={22} /> API & AI STATUS
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Live status of every external key the platform depends on. Secrets are
            shown masked — full values stay in the backend <code>.env</code>.
          </p>
        </div>

        <button
          onClick={loadStatus}
          disabled={loading}
          className="px-4 py-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] disabled:opacity-50 text-black font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          {loading ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl uppercase tracking-wider">
          {error}
        </div>
      )}

      {/* HEADLINE VERDICT — the one condition that breaks EVERY fitting. */}
      {payload && (
        <div
          className={`p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${payload.tryon_ready
              ? 'bg-green-500/5 border-green-500/30'
              : 'bg-red-500/10 border-red-500/40'
            }`}
        >
          <div className="flex items-start gap-3">
            {payload.tryon_ready ? (
              <CheckCircle2 size={20} className="text-green-400 shrink-0 mt-0.5" />
            ) : (
              <XCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
            )}
            <div>
              <p
                className={`uppercase tracking-widest font-bold ${payload.tryon_ready ? 'text-green-400' : 'text-red-400'
                  }`}
              >
                {payload.tryon_ready
                  ? 'Virtual Try-On is configured'
                  : 'Virtual Try-On is NOT configured'}
              </p>
              <p className="text-gray-400 normal-case tracking-normal mt-1">
                {payload.tryon_ready
                  ? 'The PixelAPI token is present. Use "Test" below to confirm it is accepted right now.'
                  : 'The PixelAPI token (VTON_API_TOKEN) is missing, so every fitting will fail.'}
              </p>
            </div>
          </div>

          <span className="text-[10px] uppercase tracking-widest text-gray-500 shrink-0">
            {readyCount}/{totalCount} configured
          </span>
        </div>
      )}

      {/*
        * PROVIDER HEALTH — THE VERDICT `tryon_ready` CANNOT GIVE.
        *
        * The card above answers "is the key present". This one answers "is the
        * PROVIDER serving renders RIGHT NOW", which is the question that matters
        * during an outage: while PixelAPI's safety checker is down, `tryon_ready`
        * stays green and every fitting fails. Sourced from recorded observations
        * (the 5-minute scheduled probe + real render failures), so it shows the
        * START of an outage and its history, not just a moment of truth.
        */}
      {payload && health && (
        <div
          className={`p-5 rounded-2xl border space-y-3 ${
            healthTone === 'good'
              ? 'bg-green-500/5 border-green-500/30'
              : healthTone === 'bad'
                ? 'bg-red-500/10 border-red-500/40'
                : 'bg-amber-500/5 border-amber-500/30'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {healthTone === 'good' ? (
                <Activity size={20} className="text-green-400 shrink-0 mt-0.5" />
              ) : healthTone === 'bad' ? (
                <XCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle size={20} className="text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p
                  className={`uppercase tracking-widest font-bold ${
                    healthTone === 'good'
                      ? 'text-green-400'
                      : healthTone === 'bad'
                        ? 'text-red-400'
                        : 'text-amber-400'
                  }`}
                >
                  {healthCopy.title}
                </p>
                <p className="text-gray-400 normal-case tracking-normal mt-1">
                  {healthCopy.body}
                </p>
              </div>
            </div>

            {health.since && healthTone === 'bad' && (
              <span className="text-[10px] uppercase tracking-widest text-red-400/80 shrink-0 flex items-center gap-1">
                <Clock size={11} /> Since {fmtWhen(health.since)}
              </span>
            )}
          </div>

          {/* THE MEASUREMENTS BEHIND THE VERDICT — never a bare colour. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                Last checked
              </p>
              <p className="text-gray-300">{fmtWhen(health.last_checked_at)}</p>
              {health.minutes_since_check != null && (
                <p className="text-gray-500">{health.minutes_since_check} min ago</p>
              )}
            </div>

            <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                Outages ({health.window_hours}h)
              </p>
              <p className={health.outages_in_window > 0 ? 'text-amber-400' : 'text-gray-300'}>
                {health.outages_in_window}
              </p>
            </div>

            <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
              <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                Last result
              </p>
              <p className="text-gray-300 break-all">
                {health.last_code || '—'}
                {health.last_http_status != null ? ` · HTTP ${health.last_http_status}` : ''}
              </p>
            </div>
          </div>

          {/* OUTAGE TIMELINE — "when did this start" is the first question asked. */}
          {health.recent_events?.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-gray-500 hover:text-[#E9C46A] transition list-none flex items-center gap-1.5">
                <Clock size={12} />
                Recent observations ({health.recent_events.length})
              </summary>
              <ul className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
                {[...health.recent_events].reverse().map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-gray-400 normal-case tracking-normal border-l-2 pl-3 py-0.5"
                    style={{
                      borderColor:
                        e.state === 'ok'
                          ? 'rgba(34,197,94,0.3)'
                          : e.state === 'degraded'
                            ? 'rgba(245,158,11,0.4)'
                            : 'rgba(239,68,68,0.4)',
                    }}
                  >
                    <span className="text-gray-500 shrink-0">{fmtWhen(e.at)}</span>
                    <span className="uppercase tracking-wider shrink-0">{e.state}</span>
                    <span className="text-gray-500 shrink-0">· {e.source}</span>
                    {e.code && <span className="text-gray-500 shrink-0">· {e.code}</span>}
                    {e.message && <span className="break-words">{e.message}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* SERVICE CARDS */}
      {loading && !payload ? (
        <div className="py-16 flex flex-col items-center gap-3 text-gray-500">
          <Loader2 size={26} className="animate-spin text-[#E9C46A]" />
          <span className="uppercase tracking-widest text-[10px]">Reading configuration…</span>
        </div>
      ) : (
        <div className="space-y-4">
          {(payload?.services ?? []).map((svc) => {
            const probe = probes[svc.key];
            const isProbing = probing[svc.key];

            return (
              <div
                key={svc.key}
                className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                        {svc.label}
                      </h3>
                      {svc.required && (
                        <span className="text-[9px] bg-[#E9C46A]/20 text-[#E9C46A] px-2 py-0.5 rounded border border-[#E9C46A]/40 uppercase tracking-widest">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 normal-case tracking-normal mt-1">
                      {svc.purpose}
                    </p>
                  </div>

                  <button
                    onClick={() => runProbe(svc.key)}
                    disabled={isProbing || !svc.configured}
                    title={
                      svc.configured
                        ? 'Make a real request to this service'
                        : 'Set the key first'
                    }
                    className="px-3.5 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0 uppercase tracking-wider text-[10px]"
                  >
                    {isProbing ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Plug size={13} />
                    )}
                    {isProbing ? 'Testing' : 'Test'}
                  </button>
                </div>

                {/* CONFIGURATION ROW */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                      Status
                    </p>
                    <p
                      className={`flex items-center gap-1.5 font-bold ${svc.configured ? 'text-green-400' : 'text-red-400'
                        }`}
                    >
                      {svc.configured ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <XCircle size={13} />
                      )}
                      {svc.configured ? 'Configured' : 'Missing'}
                    </p>
                  </div>

                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                      Key
                    </p>
                    <p className="text-gray-300 break-all">
                      {svc.masked || '—'}
                    </p>
                  </div>

                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                      Variable
                    </p>
                    <p className="text-[#E9C46A] break-all">{svc.env}</p>
                  </div>

                  {svc.endpoint && (
                    <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                      <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
                        Endpoint
                      </p>
                      <p className="text-gray-300 break-all">{svc.endpoint}</p>
                    </div>
                  )}
                </div>

                {/* LIVE PROBE RESULT */}
                {probe && (
                  <div
                    className={`p-3.5 rounded-xl border ${probe.ok
                        ? 'bg-green-500/5 border-green-500/30'
                        : 'bg-amber-500/5 border-amber-500/30'
                      }`}
                  >
                    <p
                      className={`font-bold flex items-center gap-1.5 ${probe.ok ? 'text-green-400' : 'text-amber-400'
                        }`}
                    >
                      {probe.ok ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <AlertTriangle size={13} />
                      )}
                      {probe.summary}
                    </p>
                    {probe.http_status != null && (
                      <p className="text-gray-500 mt-1">
                        HTTP {probe.http_status}
                        {probe.reachable === false ? ' · unreachable' : ''}
                      </p>
                    )}
                    {probe.detail && (
                      <p className="text-gray-400 normal-case tracking-normal mt-1 break-words">
                        {probe.detail}
                      </p>
                    )}
                  </div>
                )}

                {svc.notes && (
                  <p className="text-gray-500 normal-case tracking-normal border-l-2 border-[#E9C46A]/30 pl-3">
                    {svc.notes}
                  </p>
                )}

                {/* HOW TO ROTATE — the actionable half of this screen. */}
                <details className="group">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-gray-500 hover:text-[#E9C46A] transition list-none flex items-center gap-1.5">
                    <ShieldCheck size={12} />
                    How to replace this key
                  </summary>
                  <ol className="mt-3 space-y-1.5 pl-4 list-decimal text-gray-400 normal-case tracking-normal">
                    {(svc.instructions ?? []).map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </details>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-gray-600 normal-case tracking-normal text-[11px] border-t border-white/10 pt-4">
        Secrets are never sent to the browser in full. To rotate a key, edit the
        backend <code>.env</code> and run <code>php artisan config:clear</code> —
        then use <strong>Test</strong> above to confirm the new value is accepted.
      </p>
    </div>
  );
};

export default ApiStatusTab;
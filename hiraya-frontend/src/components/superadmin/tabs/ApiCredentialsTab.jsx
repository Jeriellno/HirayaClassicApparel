import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Plus,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  Zap,
  ShieldCheck,
  Clock,
  Database,
  FileText,
  Eye,
  EyeOff,
  ChevronUp,
} from 'lucide-react';
import api from '../../../api/axios';

/**
 * API MANAGEMENT PANEL — add, rotate and monitor external API keys.
 *
 * WHY THIS IS A SEPARATE TAB FROM "API & AI STATUS"
 * -------------------------------------------------
 * `ApiStatusTab` REPORTS. It reads config and, on demand, pings a vendor. It never
 * changes a credential — and it says so on the screen.
 *
 * That boundary used to be absolute, because rotating a key genuinely did mean
 * editing `.env` on the server: SSH, edit a file, `config:clear`, restart the
 * worker. That is not something you can do at 2am when a daily-quota key dies.
 *
 * With the active key held in the database instead, rotation becomes a local
 * pointer change. This tab is the write side of that: paste a key, and it is live
 * on the very next request — no deploy, no restart, no `.env`.
 *
 * THE SECRET IS NEVER DISPLAYED
 * -----------------------------
 * The backend returns only a masked hint and there is no endpoint anywhere that
 * returns a stored key in full — not for a superadmin, not once. The field below
 * is write-only: whatever is typed is POSTed and discarded. Someone watching over
 * a shoulder, or a screenshot taken after the fact, cannot recover a live
 * credential from this screen.
 *
 * IT SAYS WHERE THE KEY IS COMING FROM, AND DOES NOT PRETEND
 * ---------------------------------------------------------
 * A provider served by `.env` is labelled `env`, not shown as a managed key. That
 * distinction is the honest one: it is the difference between "this is rotated
 * automatically now" and "someone edited a file and is relying on it lasting".
 */
const ApiCredentialsTab = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Per-row action state, so one busy row never freezes the panel.
  const [busy, setBusy] = useState({});

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    provider: 'gemini',
    label: '',
    secret: '',
    activate: true,
    expires_at: '',
  });
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/admin/api-credentials');
      setData(res.data);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        'Could not load the API credentials. Run: php artisan migrate',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const credentials = data?.credentials ?? [];
  const overview = data?.overview ?? {};

  /*
   * KEYS GROUPED BY PROVIDER.
   *
   * The panel is organised by SERVICE rather than by row, because the question
   * an operator asks is never "what is key 3" — it is "does Gemini have a spare
   * ready?", which is a question about the service.
   */
  const byProvider = useMemo(() => {
    const groups = {};
    (data?.providers ?? []).forEach((p) => {
      groups[p] = credentials.filter((c) => c.provider === p);
    });
    return groups;
  }, [data]);

  const PROVIDER_META = {
    pixelapi: {
      name: 'PixelAPI — Virtual Try-On',
      blurb: 'Renders the AI fitting.',
      required: true,
    },
    gemini: {
      name: 'Gemini — Catalog Vision',
      blurb: 'Reads garment photos to auto-fill catalog details.',
      required: false,
    },
    supabase: {
      name: 'Supabase — Asset Storage',
      blurb: 'Serves catalog images and backgrounds.',
      required: true,
    },
  };

  /*
   * THE LIVE KEY, AT PAGE LEVEL.
   *
   * This used to be computed inside the per-provider `.map()` callback, and the
   * footer below referenced it from OUTSIDE that callback — so the tab threw
   * "active is not defined" the moment it rendered, and the console's error
   * boundary replaced the entire page. The bundler did not catch it: scope
   * checking is not part of what a build verifies, and `vite build` exited 0.
   *
   * A `const` declared in a callback simply does not exist outside it, so the
   * footer had no value to read. Computing it here — from the flat credential
   * list, outside every callback — is both correct for what the footer is
   * actually reporting ("which key is serving requests right now", which is a
   * question about the whole panel, not about one provider) and impossible to
   * break the same way again.
   */
  const activeKeys = useMemo(
    () => credentials.filter((c) => c.is_active),
    [credentials],
  );

  const setRowBusy = (id, on) =>
    setBusy((p) => ({ ...p, [id]: on }));

  const handleAction = async (row, action) => {
    setError('');
    setNotice('');
    setRowBusy(row.id, true);
    try {
      const res =
        action === 'retire'
          ? await api.delete(`/admin/api-credentials/${row.id}`)
          : await api.post(`/admin/api-credentials/${row.id}/${action}`);

      setNotice(res.data?.message || 'Done.');
      // The overview (which key is live) changes server-side, so always re-read.
      await load();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        err?.response?.data?.errors?.secret?.[0] ||
        'That action could not be completed.',
      );
    } finally {
      setRowBusy(null);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const res = await api.post('/admin/api-credentials', {
        provider: form.provider,
        label: form.label.trim() || undefined,
        secret: form.secret.trim(),
        activate: form.activate,
        // An empty string is not a date; only send a real one.
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      });

      setNotice(res.data?.message || 'Key stored.');
      setForm({ provider: form.provider, label: '', secret: '', activate: true, expires_at: '' });
      setShowSecret(false);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        err?.response?.data?.errors?.secret?.[0] ||
        'The key could not be stored.',
      );
    } finally {
      setSaving(false);
    }
  };

  const statusTone = (status) => {
    switch (status) {
      case 'valid':
        return 'text-green-700 border-green-500/30 bg-green-500/10';
      case 'rate_limited':
        return 'text-hiraya-accent border-hiraya-accent/40 bg-hiraya-accent/10';
      case 'expired':
      case 'unauthorized':
        return 'text-red-700 border-red-500/40 bg-red-500/12';
      case 'error':
        return 'text-hiraya-sand border-hiraya-sand/40 bg-hiraya-peach';
      default:
        return 'text-hiraya-sand border-hiraya-structure-line bg-hiraya-peach';
    }
  };

  const when = (iso) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-7 animate-fadeIn text-xs">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-hiraya-structure-line">
        <div>
          <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900 flex items-center gap-2">
            <KeyRound size={22} /> API MANAGEMENT
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            Add and rotate external API keys without editing{' '}
            <code>.env</code>. The active key is stored in the database and takes
            effect on the next request.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-4 py-2.5 bg-hiraya-olive hover:bg-hiraya-accent text-hiraya-nav-ink font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {showForm ? <ChevronUp size={16} /> : <Plus size={16} />}
            {showForm ? 'Close' : 'Add Key'}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="px-4 py-2.5 bg-hiraya-accent hover:bg-hiraya-gold-deep disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none text-hiraya-on-accent font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {loading ? 'Loading' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/12 border border-red-600/40 text-red-700 rounded-2xl uppercase tracking-wider flex items-center gap-2">
          <XCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3.5 bg-green-500/10 border border-green-500/30 text-green-700 rounded-2xl uppercase tracking-wider flex items-center gap-2">
          <CheckCircle2 size={15} className="shrink-0" />
          {notice}
        </div>
      )}

      {/* ADD FORM */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="p-5 rounded-2xl border border-hiraya-accent/40 bg-hiraya-accent/10 space-y-4"
        >
          <p className="text-[10px] uppercase tracking-widest text-hiraya-ink flex items-center gap-2">
            <ShieldCheck size={13} />
            The key is encrypted before it is written and is never shown again.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[9px] uppercase tracking-widest text-hiraya-sand">
                Service
              </span>
              <select
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-hiraya-structure-line bg-cream-200/55 px-3 py-2.5 text-hiraya-ink outline-none focus:border-hiraya-accent focus:ring-1 focus:ring-hiraya-accent/30"
              >
                {(data?.providers ?? ['gemini']).map((p) => (
                  <option key={p} value={p} className="bg-hiraya-cream">
                    {PROVIDER_META[p]?.name ?? p}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[9px] uppercase tracking-widest text-hiraya-sand">
                Label (for you)
              </span>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Primary — aistudio account"
                className="mt-1 w-full rounded-xl border border-hiraya-structure-line bg-cream-200/55 px-3 py-2.5 text-hiraya-ink placeholder-hiraya-sand/60 outline-none focus:border-hiraya-accent focus:ring-1 focus:ring-hiraya-accent/30"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[9px] uppercase tracking-widest text-hiraya-sand">
              API Key
            </span>
            <div className="relative mt-1">
              <input
                type={showSecret ? 'text' : 'password'}
                value={form.secret}
                onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the key — it is encrypted on save"
                className="w-full rounded-xl border border-hiraya-structure-line bg-cream-200/55 px-3 py-2.5 pr-11 text-hiraya-ink placeholder-hiraya-sand/60 outline-none focus:border-hiraya-accent focus:ring-1 focus:ring-hiraya-accent/30"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? 'Hide key' : 'Show key'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-hiraya-sand hover:text-hiraya-ink transition"
              >
                {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <label className="block">
              <span className="text-[9px] uppercase tracking-widest text-hiraya-sand">
                Expires at (optional)
              </span>
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-hiraya-structure-line bg-cream-200/55 px-3 py-2.5 text-hiraya-ink outline-none focus:border-hiraya-accent focus:ring-1 focus:ring-hiraya-accent/30"
              />
              <span className="block mt-1 text-[9px] normal-case tracking-normal text-hiraya-sand/70">
                If the vendor tells you when the key dies, set it — the background
                task then rotates before it expires instead of after it fails.
              </span>
            </label>

            <label className="flex items-center gap-2 pb-2.5 text-hiraya-ink cursor-pointer">
              <input
                type="checkbox"
                checked={form.activate}
                onChange={(e) => setForm((f) => ({ ...f, activate: e.target.checked }))}
                className="rounded border-hiraya-sand/40 bg-black accent-hiraya-maroon"
              />
              <span className="text-[10px] uppercase tracking-wider">
                Make this the active key
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={saving || !form.secret.trim()}
            className="px-5 py-3 bg-hiraya-olive hover:bg-hiraya-accent disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none text-hiraya-nav-ink font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
          >
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
            {saving ? 'Storing' : 'Store Key'}
          </button>
        </form>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center gap-3 py-12 text-hiraya-sand">
          <Loader2 size={18} className="animate-spin" />
          Loading credentials…
        </div>
      )}

      {/* PER-PROVIDER GROUPS */}
      {Object.entries(byProvider).map(([provider, rows]) => {
        const meta = PROVIDER_META[provider] ?? { name: provider, blurb: '' };
        const info = overview[provider] ?? {};
        const spares = rows.filter((r) => !r.is_active && !r.retired_at);

        return (
          <div
            key={provider}
            className="rounded-2xl border border-hiraya-structure-line bg-cream-200/60 overflow-hidden"
          >
            <div className="p-4 border-b border-hiraya-structure-line/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="text-hiraya-ink uppercase tracking-widest font-bold flex items-center gap-2">
                  {meta.name}
                  {meta.required && (
                    <span className="text-[8px] text-red-700 border border-red-500/40 px-1.5 py-0.5 rounded">
                      REQUIRED
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-hiraya-sand normal-case tracking-normal mt-0.5">
                  {meta.blurb}
                </p>
              </div>

              <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest">
                {/*
                 * WHERE THE LIVE KEY COMES FROM — reported honestly.
                 * `env` means this service is still running off .env, so it is
                 * NOT covered by automatic rotation yet.
                 */}
                <span
                  className={`px-2 py-1 rounded-lg border flex items-center gap-1.5 ${info.source === 'database'
                      ? 'border-green-500/30 bg-green-500/10 text-green-700'
                      : info.source === 'env'
                        ? 'border-hiraya-sand/40 bg-hiraya-peach text-hiraya-sand'
                        : 'border-red-500/40 bg-red-500/12 text-red-700'
                    }`}
                >
                  {info.source === 'database' ? (
                    <Database size={11} />
                  ) : info.source === 'env' ? (
                    <FileText size={11} />
                  ) : (
                    <AlertTriangle size={11} />
                  )}
                  {info.source === 'database'
                    ? 'Live from database'
                    : info.source === 'env'
                      ? 'Using .env — not auto-rotated'
                      : 'No key configured'}
                </span>

                {spares.length > 0 && (
                  <span className="px-2 py-1 rounded-lg border border-hiraya-accent/40 bg-hiraya-accent/10 text-hiraya-accent flex items-center gap-1.5">
                    <ShieldCheck size={11} />
                    {spares.length} spare{spares.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="p-4 text-[10px] text-hiraya-sand normal-case tracking-normal">
                No managed keys.{' '}
                {info.source === 'env'
                  ? 'This service is still using the .env value, so it will not rotate automatically until you add a key here.'
                  : 'Add a key above to take over from .env.'}
              </div>
            ) : (
              <div className="divide-y divide-hiraya-structure-line/60">
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-hiraya-ink uppercase tracking-wider flex items-center gap-2 flex-wrap">
                        <span className="truncate">{row.label}</span>
                        {row.is_active && (
                          <span className="text-[8px] text-green-700 border border-green-600/45 px-1.5 py-0.5 rounded">
                            ACTIVE
                          </span>
                        )}
                        {row.retired_at && (
                          <span className="text-[8px] text-hiraya-sand border border-hiraya-sand/40 px-1.5 py-0.5 rounded">
                            RETIRED
                          </span>
                        )}
                        {row.expires_soon && (
                          <span className="text-[8px] text-hiraya-accent border border-hiraya-accent/40 px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Clock size={9} /> EXPIRES SOON
                          </span>
                        )}
                      </p>

                      <p className="text-[10px] text-hiraya-sand normal-case tracking-normal mt-1">
                        <code className="text-hiraya-ink">{row.masked}</code>
                        {row.expires_at && (
                          <span> · expires {when(row.expires_at)}</span>
                        )}
                        {row.last_verified_at && (
                          <span> · checked {when(row.last_verified_at)}</span>
                        )}
                      </p>

                      {row.last_message && (
                        <p className="text-[10px] text-hiraya-sand/70 normal-case tracking-normal mt-0.5">
                          {row.last_message}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <span
                        className={`px-2 py-1 rounded-lg border text-[9px] uppercase tracking-widest ${statusTone(
                          row.last_status,
                        )}`}
                      >
                        {row.last_status}
                      </span>

                      {!row.is_active && !row.retired_at && (
                        <button
                          onClick={() => handleAction(row, 'activate')}
                          disabled={busy[row.id]}
                          title="Make this the active key"
                          className="px-2.5 py-1.5 border border-hiraya-structure-line hover:border-hiraya-accent hover:text-hiraya-ink text-hiraya-sand uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
                        >
                          {busy[row.id] ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Zap size={12} />
                          )}
                          Activate
                        </button>
                      )}

                      <button
                        onClick={() => handleAction(row, 'verify')}
                        disabled={busy[row.id]}
                        title="Check this key against the provider now"
                        className="px-2.5 py-1.5 border border-hiraya-structure-line hover:border-hiraya-accent hover:text-hiraya-ink text-hiraya-sand uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
                      >
                        {busy[row.id] ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RefreshCw size={12} />
                        )}
                        Verify
                      </button>

                      {!row.retired_at && (
                        <button
                          onClick={() => handleAction(row, 'retire')}
                          disabled={busy[row.id]}
                          title="Retire this key (it is kept for the record, not deleted)"
                          className="px-2.5 py-1.5 border border-red-600/40 hover:bg-red-500/12 text-red-700 uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
                        >
                          {busy[row.id] ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          Retire
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* WHAT THE BACKGROUND TASK DOES — so the automation is not a black box. */}
      <div className="p-4 rounded-2xl border border-hiraya-structure-line bg-cream-200/60 space-y-2">
        <p className="text-[10px] uppercase tracking-widest text-hiraya-ink flex items-center gap-2">
          <Clock size={13} /> Automatic rotation
        </p>
        <p className="text-[10px] text-hiraya-sand normal-case tracking-normal leading-relaxed">
          A scheduled task (<code>php artisan hiraya:refresh-api-keys</code>) checks
          stored keys on an interval. A key past its expiry is replaced with the next
          stored key automatically — no deploy, no restart, no failed request. A key
          that reports "valid but out of quota" is kept, because it works again after
          the vendor's daily reset. A vendor that is merely unreachable records the
          state but never rotates, so an outage cannot burn the whole pool.
        </p>
        {activeKeys.length > 0 && (
          <ul className="space-y-1">
            {activeKeys.map((k) => (
              <li key={k.id} className="text-[10px] text-hiraya-sand normal-case tracking-normal">
                Currently serving{' '}
                <span className="text-hiraya-ink">{k.label}</span>{' '}
                for {PROVIDER_META[k.provider]?.name ?? k.provider}.
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ApiCredentialsTab;

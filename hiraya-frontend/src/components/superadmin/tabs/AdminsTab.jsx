import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { UserCog, UserPlus, KeyRound, UserMinus, Copy, Check, Loader2, X, ShieldCheck, ShieldAlert, Crown, Mail } from 'lucide-react';
import api from '../../../api/axios';

/*
 * ADMIN MANAGEMENT (super admin only).
 *
 *   Invite by email the admin gets a link at their Gmail, enters their name
 *                   and contact number, sets their OWN password and scans the
 *                   authenticator QR. The account exists only once they accept.
 *   Add admin       name, e-mail, contact number and a password (typed or
 *                   generated). The password is shown ONCE so it can be handed
 *                   over; it is stored only as a hash. The admin sets up an
 *                   authenticator app on their first sign-in.
 *   Reset password  issues a new password, again shown once.
 *   Remove          for an admin who resigned / left: a reason is required;
 *                   their sign-in stops working immediately and the action is
 *                   recorded in the audit log.
 */

const field = 'w-full rounded-xl border border-hiraya-ink/10 bg-cream-200/55 px-3 py-2.5 text-[12px] text-hiraya-ink shadow-neu-inset focus:border-hiraya-accent focus:outline-none';
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted';

const REASONS = [
  { id: 'resigned', label: 'Resigned' },
  { id: 'contract_ended', label: 'Contract ended' },
  { id: 'terminated', label: 'Terminated' },
  { id: 'other', label: 'Other' },
];

const errorText = (err, fallback) => {
  const errors = err?.response?.data?.errors;
  return errors ? Object.values(errors).flat()[0] : err?.response?.data?.message || fallback;
};

const when = (iso) => (iso ? new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

function Dialog({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 p-4 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-md rounded-[22px] bg-hiraya-surface p-5 shadow-2xl ring-1 ring-cream-50/80">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-serif text-lg uppercase tracking-[0.05em] text-navy-900">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg p-1 hover:bg-cream-200"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

Dialog.propTypes = { title: PropTypes.string.isRequired, onClose: PropTypes.func.isRequired, children: PropTypes.node };

/** The one-time credentials card. */
function Credentials({ email, password, onDone }) {
  const [copied, setCopied] = useState('');
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 1500);
    } catch {
      /* clipboard blocked: the text is selectable */
    }
  };
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-[11px] text-amber-900">
        Copy this password now and give it to the admin privately. It will not be shown again — use “Reset password” if it is lost.
      </p>
      {[['E-mail', email], ['Password', password]].map(([k, v]) => (
        <div key={k}>
          <span className={label}>{k}</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded-lg bg-cream-200/70 px-3 py-2 font-mono text-[12px] text-navy-900">{v}</code>
            <button type="button" onClick={() => copy(k, v)} className="cursor-pointer rounded-lg border border-hiraya-structure-line p-2 hover:bg-cream-200" aria-label={`Copy ${k}`}>
              {copied === k ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      ))}
      <button type="button" onClick={onDone} className="w-full cursor-pointer rounded-xl bg-navy-900 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800">
        I have copied it
      </button>
    </div>
  );
}

Credentials.propTypes = { email: PropTypes.string, password: PropTypes.string, onDone: PropTypes.func.isRequired };

/*
 * Authenticator state comes from the server's REAL security state
 * (`mfa_status`, read from Supabase's verified MFA factors). The stored
 * `mfa_enrolled_at` is only a fallback for an older API response.
 */
const mfaSetUp = (a) => (a.mfa_status ? a.mfa_status === 'set_up' : Boolean(a.mfa_enrolled_at));

export default function AdminsTab() {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null); // { type: 'add'|'reset'|'remove'|'credentials', admin?, email?, password? }
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', contact_number: '', password: '', reason: 'resigned', note: '' });
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/accounts');
      setAdmins(Array.isArray(res.data) ? res.data : res.data?.data || []);
      setError('');
    } catch (err) {
      setError(errorText(err, 'Could not load the admin accounts.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = (type, admin = null) => {
    setForm({ full_name: '', email: '', contact_number: '', password: '', reason: 'resigned', note: '' });
    setFormError('');
    setDialog({ type, admin });
  };

  const run = async (fn) => {
    setBusy(true);
    setFormError('');
    try {
      await fn();
    } catch (err) {
      setFormError(errorText(err, 'That did not work. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const addAdmin = (e) => {
    e.preventDefault();
    run(async () => {
      const payload = { full_name: form.full_name, email: form.email, contact_number: form.contact_number || null };
      if (form.password) payload.password = form.password;
      const res = await api.post('/admin/accounts', payload);
      await load();
      setDialog({ type: 'credentials', email: res.data.account.email, password: res.data.password });
    });
  };

  const sendInvite = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.post('/admin/accounts/invite', { email: form.email, role: 'admin' });
      setDialog({ type: 'invited', email: res.data.email, url: res.data.invitation_url, expires: res.data.expires_at });
    });
  };

  const resetPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const res = await api.post(`/admin/accounts/${dialog.admin.id}/reset-password`, form.password ? { password: form.password } : {});
      setDialog({ type: 'credentials', email: dialog.admin.email, password: res.data.password });
    });
  };

  const removeAdmin = (e) => {
    e.preventDefault();
    run(async () => {
      await api.delete(`/admin/accounts/${dialog.admin.id}`, { data: { reason: form.reason, note: form.note || null } });
      await load();
      setDialog(null);
    });
  };

  const passwordHint = 'Leave blank to generate one. At least 8 characters with a capital letter and a number.';

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl uppercase tracking-[0.05em] text-navy-900">
          <UserCog size={20} /> Admin Management
        </h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => open('invite')} className="flex cursor-pointer items-center gap-2 rounded-xl border border-hiraya-structure-line px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-hiraya-ink hover:bg-cream-200">
            <Mail size={14} /> Invite by email
          </button>
          <button type="button" onClick={() => open('add')} className="flex cursor-pointer items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800">
            <UserPlus size={14} /> Add admin
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-xl bg-red-500/12 px-3 py-2 text-[11px] text-red-700">{error}</p>}

      {/* PHONES: one card per admin (a six-column table is unreadable at 375 px). */}
      <ul className="space-y-3 md:hidden">
        {loading ? (
          <li className="h-24 animate-pulse rounded-[18px] bg-cream-200/60" />
        ) : (
          admins.map((a) => {
            const owner = a.role === 'superadmin';
            return (
              <li key={a.id} className="rounded-[18px] bg-hiraya-surface p-4 shadow-neu ring-1 ring-cream-50/80">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-hiraya-ink">
                      {owner && <Crown size={13} className="shrink-0 text-amber-600" />}
                      <span className="truncate">{a.full_name || '—'}</span>
                    </p>
                    <p className="text-[9px] uppercase tracking-wider text-charcoal-500">{owner ? 'Super Admin (owner)' : 'Admin'} · since {when(a.created_at)}</p>
                  </div>
                  {!owner && (
                    <div className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => open('reset', a)} aria-label={`Reset password for ${a.full_name}`} className="cursor-pointer rounded-lg border border-hiraya-structure-line p-2 text-hiraya-ink"><KeyRound size={14} /></button>
                      <button type="button" onClick={() => open('remove', a)} aria-label={`Remove ${a.full_name}`} className="cursor-pointer rounded-lg border border-red-600/30 p-2 text-red-700"><UserMinus size={14} /></button>
                    </div>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                  <div className="col-span-2 min-w-0"><dt className="text-[9px] uppercase tracking-wider text-charcoal-500">E-mail</dt><dd className="break-all text-charcoal-700">{a.email}</dd></div>
                  <div><dt className="text-[9px] uppercase tracking-wider text-charcoal-500">Contact</dt><dd className="text-charcoal-700">{a.contact_number || '—'}</dd></div>
                  <div><dt className="text-[9px] uppercase tracking-wider text-charcoal-500">Last sign-in</dt><dd className="text-charcoal-700">{when(a.last_login_at)}</dd></div>
                  <div className="col-span-2"><dt className="text-[9px] uppercase tracking-wider text-charcoal-500">Authenticator</dt>
                    <dd>{mfaSetUp(a)
                      ? <span className="inline-flex items-center gap-1 font-semibold text-emerald-700"><ShieldCheck size={12} /> Set up</span>
                      : <span className="inline-flex items-center gap-1 font-semibold text-amber-700"><ShieldAlert size={12} /> On first sign-in</span>}</dd>
                  </div>
                </dl>
              </li>
            );
          })
        )}
      </ul>

      <div className="hidden overflow-hidden rounded-[20px] bg-hiraya-surface shadow-neu ring-1 ring-cream-50/80 md:block">
        <table className="w-full table-fixed text-left text-[12px]">
          <thead className="bg-navy-900 text-[10px] uppercase tracking-[0.14em] text-cream-100">
            <tr>
              <th className="w-[26%] px-4 py-3">Name</th>
              <th className="w-[24%] px-4 py-3">E-mail</th>
              <th className="w-[13%] px-4 py-3">Contact</th>
              <th className="w-[12%] px-4 py-3">2FA</th>
              <th className="w-[11%] px-4 py-3">Last sign-in</th>
              <th className="w-[14%] px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hiraya-structure-line/70">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8"><div className="h-10 animate-pulse rounded-lg bg-cream-200/60" /></td></tr>
            ) : admins.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-[11px] text-charcoal-500">No admin accounts yet.</td></tr>
            ) : (
              admins.map((a) => {
                const owner = a.role === 'superadmin';
                return (
                  <tr key={a.id} className="hover:bg-cream-200/40">
                    <td className="truncate px-4 py-3 font-semibold text-hiraya-ink">
                      <span className="flex items-center gap-1.5">
                        {owner && <Crown size={13} className="shrink-0 text-amber-600" />}
                        <span className="truncate">{a.full_name || '—'}</span>
                      </span>
                      <span className="block text-[9px] font-normal uppercase tracking-wider text-charcoal-500">{owner ? 'Super Admin (owner)' : 'Admin'} · since {when(a.created_at)}</span>
                    </td>
                    <td className="truncate px-4 py-3 text-charcoal-700" title={a.email}>{a.email}</td>
                    <td className="truncate px-4 py-3 text-charcoal-700">{a.contact_number || '—'}</td>
                    <td className="px-4 py-3">
                      {mfaSetUp(a) ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"><ShieldCheck size={12} /> Set up</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700"><ShieldAlert size={12} /> On first sign-in</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-charcoal-700">{when(a.last_login_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {!owner && (
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => open('reset', a)} title="Reset password" aria-label={`Reset password for ${a.full_name}`} className="cursor-pointer rounded-lg border border-hiraya-structure-line p-2 text-hiraya-ink hover:bg-cream-200"><KeyRound size={13} /></button>
                          <button type="button" onClick={() => open('remove', a)} title="Remove admin" aria-label={`Remove ${a.full_name}`} className="cursor-pointer rounded-lg border border-red-600/30 p-2 text-red-700 hover:bg-red-500/10"><UserMinus size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {dialog?.type === 'add' && (
        <Dialog title="Add admin" onClose={() => !busy && setDialog(null)}>
          <form onSubmit={addAdmin} className="space-y-3">
            <label className="block"><span className={label}>Full name *</span>
              <input required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={field} placeholder="Juan Dela Cruz" />
            </label>
            <label className="block"><span className={label}>E-mail *</span>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} placeholder="name@example.com" />
            </label>
            <label className="block"><span className={label}>Contact number</span>
              <input value={form.contact_number} onChange={(e) => setForm({ ...form, contact_number: e.target.value })} className={field} placeholder="0917 123 4567" />
            </label>
            <label className="block"><span className={label}>Password</span>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={field} placeholder="Generate automatically" autoComplete="new-password" />
              <span className="mt-1 block text-[10px] text-charcoal-500">{passwordHint}</span>
            </label>
            {formError && <p role="alert" className="text-[11px] text-red-700">{formError}</p>}
            <button type="submit" disabled={busy} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-900 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800 disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} Create admin account
            </button>
          </form>
        </Dialog>
      )}

      {dialog?.type === 'invite' && (
        <Dialog title="Invite admin" onClose={() => !busy && setDialog(null)}>
          <form onSubmit={sendInvite} className="space-y-3">
            <p className="text-[12px] text-charcoal-700">
              They receive a link by e-mail, fill in their name and contact number, choose their own password and set up the authenticator app.
            </p>
            <label className="block"><span className={label}>E-mail *</span>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} placeholder="name@gmail.com" />
            </label>
            {formError && <p role="alert" className="text-[11px] text-red-700">{formError}</p>}
            <button type="submit" disabled={busy} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-900 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800 disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} Send invitation
            </button>
          </form>
        </Dialog>
      )}

      {dialog?.type === 'invited' && (
        <Dialog title="Invitation sent" onClose={() => setDialog(null)}>
          <div className="space-y-3 text-[12px] text-charcoal-700">
            <p>An invitation was e-mailed to <strong>{dialog.email}</strong>{dialog.expires && <> — valid until {new Date(dialog.expires).toLocaleString()}</>}. They appear in this list once they accept.</p>
            {dialog.url && (
              <div>
                <span className={label}>If the e-mail does not arrive, send them this link</span>
                <code className="block select-all break-all rounded-lg bg-cream-200/70 px-3 py-2 font-mono text-[11px] text-navy-900">{dialog.url}</code>
              </div>
            )}
            <button type="button" onClick={() => setDialog(null)} className="w-full cursor-pointer rounded-xl bg-navy-900 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800">Done</button>
          </div>
        </Dialog>
      )}

      {dialog?.type === 'reset' && (
        <Dialog title="Reset password" onClose={() => !busy && setDialog(null)}>
          <form onSubmit={resetPassword} className="space-y-3">
            <p className="text-[12px] text-charcoal-700">New password for <strong>{dialog.admin.full_name}</strong>. They will be signed out everywhere.</p>
            <label className="block"><span className={label}>New password</span>
              <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={field} placeholder="Generate automatically" autoComplete="new-password" />
              <span className="mt-1 block text-[10px] text-charcoal-500">{passwordHint}</span>
            </label>
            {formError && <p role="alert" className="text-[11px] text-red-700">{formError}</p>}
            <button type="submit" disabled={busy} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-900 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800 disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} Set new password
            </button>
          </form>
        </Dialog>
      )}

      {dialog?.type === 'remove' && (
        <Dialog title="Remove admin" onClose={() => !busy && setDialog(null)}>
          <form onSubmit={removeAdmin} className="space-y-3">
            <p className="text-[12px] text-charcoal-700">
              <strong>{dialog.admin.full_name}</strong> ({dialog.admin.email}) will no longer be able to sign in. Their past actions stay in the audit log.
            </p>
            <label className="block"><span className={label}>Reason *</span>
              <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={field}>
                {REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>
            <label className="block"><span className={label}>Note</span>
              <input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} className={field} placeholder="Optional, e.g. last day Oct 31" />
            </label>
            {formError && <p role="alert" className="text-[11px] text-red-700">{formError}</p>}
            <button type="submit" disabled={busy} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-red-700 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-red-800 disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} Remove admin
            </button>
          </form>
        </Dialog>
      )}

      {dialog?.type === 'credentials' && (
        <Dialog title="Sign-in details" onClose={() => setDialog(null)}>
          <Credentials email={dialog.email} password={dialog.password} onDone={() => setDialog(null)} />
        </Dialog>
      )}
    </div>
  );
}

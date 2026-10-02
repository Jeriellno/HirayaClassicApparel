import { useState } from 'react';
import PropTypes from 'prop-types';
import { Loader2, KeyRound } from 'lucide-react';
import api from '../../api/axios';
import { PASSWORD_REQUIREMENTS } from '../../utils/passwordPolicy';

/*
 * CHANGE MY PASSWORD — for the signed-in staff member (admin or super admin).
 * The current password is checked by the server against the sign-in service;
 * the authenticator code stays the same.
 */
const field = 'w-full rounded-xl border border-hiraya-ink/10 bg-cream-200/55 px-3 py-2.5 text-[12px] text-hiraya-ink shadow-neu-inset focus:border-hiraya-accent focus:outline-none';
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted';

export default function ChangePasswordForm({ onDone }) {
  const [form, setForm] = useState({ current_password: '', new_password: '', new_password_confirmation: '' });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    // Catch the obvious mistakes before a round trip (the server re-checks).
    const unmet = PASSWORD_REQUIREMENTS.find((rule) => !rule.test(form.new_password));
    if (unmet) {
      setNotice({ ok: false, text: `New password: ${unmet.label.toLowerCase()}.` });
      return;
    }
    if (form.new_password !== form.new_password_confirmation) {
      setNotice({ ok: false, text: 'The new passwords do not match.' });
      return;
    }
    if (form.new_password === form.current_password) {
      setNotice({ ok: false, text: 'The new password must be different from the current one.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.post('/admin/me/password', form);
      setForm({ current_password: '', new_password: '', new_password_confirmation: '' });
      setNotice({ ok: true, text: res.data?.message || 'Password changed.' });
      onDone?.();
    } catch (err) {
      const errors = err?.response?.data?.errors;
      setNotice({ ok: false, text: errors ? Object.values(errors).flat()[0] : err?.response?.data?.message || 'The password could not be changed.' });
    } finally {
      setBusy(false);
    }
  };

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block"><span className={label}>Current password</span>
        <input type="password" required autoComplete="current-password" value={form.current_password} onChange={set('current_password')} className={field} />
      </label>
      <label className="block"><span className={label}>New password</span>
        <input type="password" required autoComplete="new-password" value={form.new_password} onChange={set('new_password')} className={field} />
      </label>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-hiraya-ink-muted">
        {PASSWORD_REQUIREMENTS.map((rule) => (
          <li key={rule.id} className={rule.test(form.new_password) ? 'text-emerald-700' : undefined}>{rule.label}</li>
        ))}
      </ul>
      <label className="block"><span className={label}>Confirm new password</span>
        <input type="password" required autoComplete="new-password" value={form.new_password_confirmation} onChange={set('new_password_confirmation')} className={field} />
      </label>
      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-[11px] ${notice.ok ? 'bg-emerald-500/10 text-emerald-800' : 'bg-red-500/12 text-red-700'}`}>{notice.text}</p>
      )}
      <button type="submit" disabled={busy} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-900 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800 disabled:opacity-60">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Change password
      </button>
    </form>
  );
}

ChangePasswordForm.propTypes = { onDone: PropTypes.func };

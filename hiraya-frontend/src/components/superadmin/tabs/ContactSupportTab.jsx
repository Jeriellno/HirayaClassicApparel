import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { LifeBuoy, Send, Loader2, CheckCircle2, Mail, Code2 } from 'lucide-react';
import api from '../../../api/axios';

/*
 * CONTACT SUPPORT — staff report a problem or ask for help from the console.
 *
 * The message is saved as a ticket AND e-mailed to the shop inbox
 * (hirayaclassicapparel@gmail.com) with the sender as reply-to, so the answer
 * comes back by e-mail. Admins see their own messages; the super admin sees
 * everyone's and can mark them resolved.
 */

const CATEGORIES = [
  { id: 'bug', label: 'Something is not working' },
  { id: 'orders', label: 'Orders & payments' },
  { id: 'products', label: 'Products & inventory' },
  { id: 'account', label: 'My account / sign-in' },
  { id: 'other', label: 'Other' },
];

/*
 * DEVELOPED BY — the team behind Hiraya, shown under the support form.
 * Add one entry per developer: { name, role, email }. The card stays hidden
 * while this list is empty.
 */
const DEVELOPERS = [];

const field = 'w-full rounded-xl border border-hiraya-ink/10 bg-cream-200/55 px-3 py-2.5 text-[12px] text-hiraya-ink shadow-neu-inset focus:border-hiraya-accent focus:outline-none';

export default function ContactSupportTab({ role = 'admin' }) {
  const isOwner = role === 'superadmin';
  const [form, setForm] = useState({ category: 'bug', subject: '', message: '' });
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/admin/support');
      setTickets(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    setSending(true);
    setNotice(null);
    try {
      const res = await api.post('/admin/support', form);
      setNotice({ ok: true, text: res.data?.message || 'Message sent.' });
      setForm({ category: form.category, subject: '', message: '' });
      load();
    } catch (err) {
      const errors = err?.response?.data?.errors;
      setNotice({ ok: false, text: errors ? Object.values(errors).flat()[0] : err?.response?.data?.message || 'The message could not be sent.' });
    } finally {
      setSending(false);
    }
  };

  const resolve = async (id) => {
    try {
      await api.patch(`/admin/support/${id}/resolve`);
      setTickets((list) => list.map((t) => (t.id === id ? { ...t, status: 'resolved' } : t)));
    } catch (err) {
      setNotice({ ok: false, text: err?.response?.data?.message || 'Could not update the message.' });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_1fr] animate-fadeIn">
      <form onSubmit={submit} className="space-y-3 rounded-[22px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80">
        <h2 className="flex items-center gap-2 font-serif text-xl uppercase tracking-[0.05em] text-navy-900">
          <LifeBuoy size={20} /> Contact Support
        </h2>
        <p className="flex items-center gap-1.5 text-[11px] text-charcoal-600">
          <Mail size={12} /> Replies come to your e-mail.
        </p>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted">Topic</span>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={field}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted">Subject</span>
          <input required minLength={4} maxLength={150} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="e.g. Cannot confirm a payment" className={field} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink-muted">Message</span>
          <textarea required minLength={10} maxLength={4000} rows={6} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="What happened, and what were you trying to do?" className={`${field} resize-none`} />
        </label>
        {notice && (
          <p role="status" className={`rounded-lg px-3 py-2 text-[11px] ${notice.ok ? 'bg-emerald-500/10 text-emerald-800' : 'bg-red-500/12 text-red-700'}`}>{notice.text}</p>
        )}
        <button type="submit" disabled={sending} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-cream-100 hover:bg-navy-800 disabled:opacity-60">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send message
        </button>
      </form>

      <div className="space-y-5">
      {DEVELOPERS.length > 0 && (
        <section className="rounded-[22px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80">
          <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-hiraya-ink">
            <Code2 size={14} /> Developed by
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {DEVELOPERS.map((d) => (
              <li key={d.name} className="rounded-xl bg-cream-200/45 px-3 py-2.5 shadow-neu-inset">
                <p className="text-[12px] font-semibold text-hiraya-ink">{d.name}</p>
                {d.role && <p className="text-[10px] text-charcoal-600">{d.role}</p>}
                {d.email && (
                  <a href={`mailto:${d.email}`} className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-navy-800 hover:underline">
                    <Mail size={10} /> {d.email}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-[22px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-hiraya-ink">
          {isOwner ? 'Messages from staff' : 'Your messages'}
        </h3>
        {loading ? (
          <div className="mt-4 h-24 animate-pulse rounded-xl bg-cream-200/60" />
        ) : tickets.length === 0 ? (
          <p className="mt-4 text-[11px] text-charcoal-500">No messages yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-hiraya-structure-line/70">
            {tickets.map((t) => (
              <li key={t.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold text-hiraya-ink">#{t.id} · {t.subject}</p>
                    <p className="text-[10px] text-charcoal-500">
                      {isOwner && <>{t.sender_name} ({t.sender_role || 'staff'}) · </>}
                      {CATEGORIES.find((c) => c.id === t.category)?.label || t.category} · {new Date(t.created_at).toLocaleString()}
                    </p>
                  </div>
                  {t.status === 'resolved' ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-800"><CheckCircle2 size={11} /> Resolved</span>
                  ) : isOwner ? (
                    <button type="button" onClick={() => resolve(t.id)} className="shrink-0 cursor-pointer rounded-full border border-hiraya-structure-line px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-hiraya-ink hover:bg-cream-200">Mark resolved</button>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-800">Open</span>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-relaxed text-charcoal-700">{t.message}</p>
                {isOwner && t.status !== 'resolved' && (
                  <a href={`mailto:${t.sender_email}?subject=${encodeURIComponent(`Re: [Hiraya Support #${t.id}] ${t.subject}`)}`} className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold text-navy-800 hover:underline">
                    <Mail size={11} /> Reply by e-mail
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}

ContactSupportTab.propTypes = { role: PropTypes.string };

import { Fragment, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { History, Search, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { displayAuditDetails } from '../../../utils/formatAuditDetails';

/*
 * AUDIT LOGS — who did what, and when.
 *
 * Super admin: every staff action, including which console sections each
 * admin OPENED (written by the console on every section change), plus
 * customer-account activity. Admin: the limited customer-account view the API
 * already filtered and masked.
 *
 * Compact rows: fixed column widths and a one-line summary, so a long detail
 * no longer stretches a row; click a row to read everything.
 */

const PAGE_SIZE = 15;

const RANGES = [
  { id: 'all', label: 'All time', days: null },
  { id: 'today', label: 'Today', days: 0 },
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
];

/** "APPROVE_DOWN_PAYMENT" -> "Approve down payment", with a few friendlier names. */
const ACTION_LABELS = {
  OPEN_SECTION: 'Opened section',
  USER_LOGIN: 'Signed in',
  USER_LOGIN_FAILED: 'Failed sign-in',
  USER_LOGOUT: 'Signed out',
  USER_REGISTERED: 'Registered',
  VIEW_CUSTOMER_PROFILE: 'Viewed customer',
  EXPORT_DATABASE: 'Exported database',
  APPROVE_FULL_PAYMENT: 'Verified payment',
  REJECT_PAYMENT: 'Payment verification failed',
  FLAG_PAYMENT_REVIEW: 'Flagged payment for review',
  RECHECK_PAYMENT_RECEIPT: 'Re-ran receipt check',
};
const actionLabel = (a) =>
  ACTION_LABELS[a] || String(a || 'ACTION').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const ACTION_TONE = (a = '') => {
  if (/FAILED|REJECT|REMOVE|DELETE|SUSPEND/.test(a)) return 'bg-red-500/10 text-red-700 border-red-600/30';
  if (/APPROVE|CONFIRM|CREATE|RESTORE|REACTIVATE/.test(a)) return 'bg-emerald-500/10 text-emerald-800 border-emerald-600/30';
  if (a === 'OPEN_SECTION' || a.startsWith('VIEW')) return 'bg-cream-200/70 text-charcoal-700 border-hiraya-structure-line';
  return 'bg-navy-100 text-navy-800 border-navy-300/60';
};

const ROLE_LABEL = { superadmin: 'Super admin', admin: 'Admin', user: 'Customer' };

export default function AuditLogsTab({ auditLogs = [], role = 'superadmin' }) {
  const isOwner = role === 'superadmin';
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState('ALL');
  const [area, setArea] = useState('ALL');
  const [range, setRange] = useState('all');
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState(null);

  const actorOf = (log) => log.admin_email || '';

  const people = useMemo(() => [...new Set(auditLogs.map(actorOf).filter(Boolean))].sort(), [auditLogs]);
  const areas = useMemo(() => [...new Set(auditLogs.map((l) => l.target).filter(Boolean))].sort(), [auditLogs]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const days = RANGES.find((r) => r.id === range)?.days;
    let since = null;
    if (days !== null && days !== undefined) {
      since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - days);
    }
    return auditLogs.filter((log) => {
      if (person !== 'ALL' && actorOf(log) !== person) return false;
      if (area !== 'ALL' && log.target !== area) return false;
      if (since && new Date(log.created_at) < since) return false;
      if (term) {
        const hay = `${actorOf(log)} ${log.action} ${actionLabel(log.action)} ${log.details || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [auditLogs, search, person, area, range]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const filtersOn = search || person !== 'ALL' || area !== 'ALL' || range !== 'all';
  const reset = (fn) => (e) => { fn(e.target.value); setPage(0); };

  const select = 'rounded-xl border border-hiraya-structure-line bg-hiraya-surface px-3 py-2 text-[11px] text-hiraya-ink focus:border-hiraya-accent focus:outline-none';

  return (
    <div className="space-y-4 animate-fadeIn">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl uppercase tracking-[0.05em] text-navy-900">
          <History size={20} /> {isOwner ? 'Activity Log' : 'Customer Account Audit'}
        </h2>
        {!isOwner && (
          <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-800">
            Limited view — e-mails are masked
          </span>
        )}
      </div>

      {/* FILTERS */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
          <input value={search} onChange={reset(setSearch)} placeholder="Search actions or details…" aria-label="Search the log" className={`${select} w-full pl-8`} />
        </div>
        <select value={person} onChange={reset(setPerson)} aria-label="Filter by person" className={select}>
          <option value="ALL">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={area} onChange={reset(setArea)} aria-label="Filter by area" className={select}>
          <option value="ALL">All areas</option>
          {areas.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</option>)}
        </select>
        <select value={range} onChange={reset(setRange)} aria-label="Filter by date" className={select}>
          {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        {filtersOn && (
          <button type="button" onClick={() => { setSearch(''); setPerson('ALL'); setArea('ALL'); setRange('all'); setPage(0); }} className="cursor-pointer text-[11px] font-semibold text-navy-800 underline-offset-2 hover:underline">
            Clear
          </button>
        )}
      </div>

      {/* TABLE (cards on phones) */}
      <div className="overflow-hidden rounded-[20px] bg-hiraya-surface shadow-neu ring-1 ring-cream-50/80">
        <ul className="divide-y divide-hiraya-structure-line/60 md:hidden">
          {rows.length === 0 ? (
            <li className="px-4 py-10 text-center text-[11px] text-charcoal-500">
              {auditLogs.length && filtersOn ? 'No entries match these filters.' : 'No activity recorded yet.'}
            </li>
          ) : (
            rows.map((log, idx) => {
              const id = log.id ?? idx;
              const isOpen = openId === id;
              const d = log.created_at ? new Date(log.created_at) : null;
              return (
                <li key={id}>
                  <button type="button" onClick={() => setOpenId(isOpen ? null : id)} className="w-full cursor-pointer px-4 py-3 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold ${ACTION_TONE(log.action)}`}>{actionLabel(log.action)}</span>
                      <span className="shrink-0 text-[10px] text-charcoal-500">{d ? d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-semibold text-hiraya-ink">{actorOf(log) || 'System'}</p>
                    <p className={`mt-0.5 text-[11px] text-charcoal-700 ${isOpen ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>{log.details || '—'}</p>
                    {isOpen && isOwner && log.ip_address && <p className="mt-1 text-[10px] text-charcoal-500">IP {log.ip_address}</p>}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] table-fixed text-left text-[12px]">
            <thead className="bg-navy-900 text-[10px] uppercase tracking-[0.14em] text-cream-100">
              <tr>
                <th className="w-[15%] px-4 py-2.5">When</th>
                <th className="w-[23%] px-4 py-2.5">Who</th>
                <th className="w-[19%] px-4 py-2.5">Action</th>
                <th className="w-[43%] px-4 py-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hiraya-structure-line/60 text-hiraya-ink">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-14 text-center text-[11px] text-charcoal-500">
                    {auditLogs.length && filtersOn ? 'No entries match these filters.' : 'No activity recorded yet.'}
                  </td>
                </tr>
              ) : (
                rows.map((log, idx) => {
                  const id = log.id ?? idx;
                  const isOpen = openId === id;
                  const d = log.created_at ? new Date(log.created_at) : null;
                  const summary = displayAuditDetails(log);
                  return (
                    <Fragment key={id}>
                      <tr
                        onClick={() => setOpenId(isOpen ? null : id)}
                        className={`cursor-pointer align-middle transition hover:bg-cream-200/50 ${isOpen ? 'bg-cream-200/50' : ''}`}
                      >
                        <td className="px-4 py-2.5 leading-tight">
                          <span className="block font-medium">{d ? d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                          <span className="block text-[10px] text-charcoal-500">{d ? d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }) : ''}</span>
                        </td>
                        <td className="truncate px-4 py-2.5 leading-tight" title={actorOf(log)}>
                          <span className="block truncate font-semibold">{actorOf(log) || 'System'}</span>
                          <span className="block text-[10px] text-charcoal-500">{ROLE_LABEL[log.actor_role] || (log.target === 'USER_ACCOUNTS' ? 'Customer' : 'Staff')}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-block max-w-full truncate rounded-md border px-2 py-0.5 text-[10px] font-semibold ${ACTION_TONE(log.action)}`}>
                            {actionLabel(log.action)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-charcoal-700">{typeof summary === 'string' ? summary : log.details}</span>
                            <ChevronDown size={13} className={`shrink-0 text-charcoal-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </span>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-cream-200/30">
                          <td colSpan={4} className="px-4 pb-3 pt-0">
                            <div className="rounded-xl bg-hiraya-surface px-4 py-3 text-[11px] leading-relaxed text-charcoal-700 ring-1 ring-hiraya-structure-line/70">
                              <p className="whitespace-pre-wrap break-words">{log.details || '—'}</p>
                              <p className="mt-2 text-[10px] text-charcoal-500">
                                Area: {log.target || '—'}
                                {isOwner && log.ip_address && <> · IP {log.ip_address}</>}
                                {d && <> · {d.toLocaleString()}</>}
                              </p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hiraya-structure-line/70 px-4 py-2.5">
          <p className="text-[10px] tabular-nums text-charcoal-500">
            {filtered.length === 0 ? '0 entries' : `${safePage * PAGE_SIZE + 1}–${Math.min((safePage + 1) * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          </p>
          {pageCount > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0} aria-label="Previous page" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-hiraya-structure-line hover:bg-cream-200 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={15} /></button>
              <span className="text-[10px] tabular-nums text-hiraya-ink">Page {safePage + 1} / {pageCount}</span>
              <button type="button" onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage >= pageCount - 1} aria-label="Next page" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-hiraya-structure-line hover:bg-cream-200 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight size={15} /></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

AuditLogsTab.propTypes = {
  auditLogs: PropTypes.array,
  role: PropTypes.string,
};

import React, { useState } from 'react';
import { History, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { displayAuditDetails } from '../../../utils/formatAuditDetails';

/** Log entries per page; the sixth starts page two (matches the Inventory Catalog). */
const PAGE_SIZE = 5;

export default function AuditLogsTab({ auditLogs = [] }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('ALL');
  /*
   * The actor column on `audit_logs` is `admin_email` (see the migration and
   * AuditLog::$fillable). This component searched and rendered
   * `performed_by` / `user_email` — fields the table has NEVER had — so the
   * "Performed By" cell fell through to its 'SuperAdmin' placeholder on every
   * row and the audit trail could not name the real actor. That is the exact
   * bug the SuperAdminController writes an actor to fix, so the read side has
   * to use the same field name.
   */
  const actorOf = (log) => log.admin_email || log.performed_by || log.user_email || '';

  /*
   * FILTERS ARE DERIVED FROM THE DATA, NOT HARDCODED.
   *
   * `filterAction` was state with no control bound to it — there was never a
   * <select>, so it sat on 'ALL' forever and the filter did nothing. Worse, the
   * obvious fix (a hardcoded list of known actions) would have immediately gone
   * stale the moment a new endpoint started writing to the trail, and the
   * operator would have no way to filter by it. The backend accepts a free-form
   * `action` string, so the only list that can never be wrong is the list of
   * actions actually present in the rows being displayed.
   *
   * Grouping is by TARGET rather than by action, because the question an
   * operator asks first is "what did they do to the orders?", not "show me every
   * distinct verb". Target is the small fixed vocabulary; action is unbounded.
   */
  const availableTargets = [...new Set(auditLogs.map((log) => log.target).filter(Boolean))].sort();
  const selectedTarget = filterAction;

  const filteredLogs = auditLogs.filter((log) => {
    // The search box looks up WHO did it — the "Performed By" column only. The
    // area dropdown already narrows by target, so matching action/details text
    // here only returned noise.
    const matchesSearch = (actorOf(log) || '').toLowerCase().includes(searchTerm.trim().toLowerCase());

    const matchesFilter = selectedTarget === 'ALL' || log.target === selectedTarget;
    return matchesSearch && matchesFilter;
  });

  /*
   * SELF-HEALING FILTER.
   *
   * `availableTargets` is computed from whatever rows were last fetched, but the
   * <select> keeps its own value. If the console reloads (or the filter survives a
   * tab switch) into a set of rows that no longer contains the selected target,
   * the list silently renders EMPTY — indistinguishable from "the audit log is
   * broken", which is the opposite of what the operator needs to see.
   *
   * Falling back to 'ALL' whenever the selection is no longer valid makes the
   * component safe against any change in the data behind it, with no effect on the
   * normal case where the selection is still present.
   */
  React.useEffect(() => {
    if (selectedTarget !== 'ALL' && !availableTargets.includes(selectedTarget)) {
      setFilterAction('ALL');
    }
  }, [availableTargets, selectedTarget]);

  const noResults = filteredLogs.length === 0;

  /*
   * PAGINATION — five entries per page, same as the Inventory Catalog.
   * It pages the FILTERED rows, so every area in the dropdown (All areas,
   * CUSTOMERS, ORDERS, PRODUCTS, …) gets its own 5-per-page list. Changing the
   * area or the search resets to page one; `safePage` clamps if the list shrinks.
   */
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pagedLogs = filteredLogs.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="space-y-7 animate-fadeIn text-xs">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-hiraya-structure-line">
        <div>
          <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900 flex items-center gap-2">
            <History size={22} /> SYSTEM AUDIT LOGS
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            Real-time security audit trails and administrative action tracking.
          </p>
        </div>

        {/* SEARCH CONTROLS */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedTarget}
            onChange={(e) => {
              setFilterAction(e.target.value);
              setPage(0); // each area starts on its first page
            }}
            aria-label="Filter audit logs by area"
            className="px-3 py-1.5 bg-hiraya-cream-deep border border-hiraya-structure-line rounded-xl text-hiraya-ink focus:outline-none focus:border-hiraya-maroon focus:ring-2 focus:ring-hiraya-maroon/25 text-xs"
          >
            <option value="ALL">All areas</option>
            {availableTargets.map((target) => (
              <option key={target} value={target}>{target}</option>
            ))}
          </select>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
            <input
              type="text"
              placeholder="Search performed by..."
              aria-label="Search audit logs by who performed the action"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(0); // a new search starts on page one
              }}
              className="pl-8 pr-3 py-1.5 bg-hiraya-cream-deep border border-hiraya-structure-line rounded-xl text-hiraya-ink placeholder:text-hiraya-sand/70 focus:outline-none focus:border-hiraya-maroon focus:ring-2 focus:ring-hiraya-maroon/25 text-xs"
            />
          </div>
        </div>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-hiraya-surface rounded-[22px] overflow-hidden shadow-neu ring-1 ring-cream-50/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-navy-900 uppercase tracking-[0.16em] text-[10px] text-cream-100">
              <tr>
                <th className="p-4">TIMESTAMP</th>
                <th className="p-4">PERFORMED BY</th>
                <th className="p-4">ACTION</th>
                <th className="p-4">TARGET</th>
                <th className="p-4">DETAILS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hiraya-structure-line/70 text-hiraya-ink">
              {filteredLogs && filteredLogs.length > 0 ? (
                pagedLogs.map((log, idx) => (
                  <tr key={log.id || idx} className="hover:bg-cream-200/60 transition">
                    <td className="p-4 text-hiraya-ink whitespace-nowrap">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : new Date().toLocaleString()}
                    </td>
                    <td className="p-4 font-semibold text-hiraya-ink">
                      {actorOf(log) || 'System'}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 bg-hiraya-accent/10 border border-hiraya-accent/30 text-hiraya-ink text-[10px] rounded font-bold uppercase">
                        {log.action || 'SETTINGS_TOGGLE'}
                      </span>
                    </td>
                    <td className="p-4 text-hiraya-ink uppercase text-[10px] tracking-wider">
                      {log.target ? (
                        <span className="px-2 py-0.5 bg-cream-200/60 border border-hiraya-structure-line/80 rounded">
                          {log.target}
                        </span>
                      ) : (
                        <span className="text-hiraya-sand">—</span>
                      )}
                    </td>
                    {/*
                     * WRAPPED, NOT TRUNCATED. The diff strings written by
                     * describeChanges() are the whole point of the entry, and a CSS
                     * ellipsis hides exactly the "price: 1200 -> 1450" part that makes
                     * the row worth reading. `title` still carries the raw value so the
                     * full text is one hover away, and `break-words` stops one long
                     * value from stretching the column.
                     */}
                    <td
                      className="p-4 text-hiraya-ink max-w-md"
                      style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      title={typeof log.details === 'object' ? JSON.stringify(log.details) : log.details}
                    >
                      {/* PRODUCTS rows show a short, readable summary; the full stored text stays in the hover title. */}
                      {displayAuditDetails(log)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="py-20 text-center">
                    {/*
                     * "NO AUDIT LOGS RECORDED" was shown for BOTH cases: a genuinely
                     * empty log, and rows that exist but were excluded by the search
                     * or the area filter. Those are opposite situations — one means
                     * the trail is not being written, the other means the operator
                     * has simply narrowed it too far — and collapsing them into one
                     * message is what makes a working log look broken.
                     */}
                    <span className="block text-hiraya-sand uppercase tracking-[0.25em] font-light">
                      {noResults && auditLogs.length > 0
                        ? 'NO LOGS MATCH THE CURRENT FILTER'
                        : 'NO AUDIT LOGS RECORDED'}
                    </span>
                    {noResults && auditLogs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => { setSearchTerm(''); setFilterAction('ALL'); setPage(0); }}
                        className="mt-3 text-hiraya-ink underline underline-offset-4 cursor-pointer hover:opacity-70 normal-case tracking-normal"
                      >
                        Clear filters
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION — shown once the current area has more than one page. */}
        {filteredLogs.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-hiraya-structure-line/70 font-mono">
            <p className="text-[10px] uppercase tracking-wider text-hiraya-ink-muted tabular-nums">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                aria-label="Previous page"
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="text-[10px] uppercase tracking-wider text-hiraya-ink tabular-nums min-w-[4.5rem] text-center">
                Page {safePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                disabled={safePage >= pageCount - 1}
                aria-label="Next page"
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
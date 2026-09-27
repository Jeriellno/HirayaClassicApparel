import React, { useState } from 'react';
import { History, Search } from 'lucide-react';

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

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch =
      (log.action || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (actorOf(log) || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.target || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (log.details || '').toLowerCase().includes(searchTerm.toLowerCase());
      
    const matchesFilter = filterAction === 'ALL' || log.action === filterAction;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6 animate-fadeIn font-mono text-xs">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-hiraya-olive/15">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-hiraya-ink flex items-center gap-2">
            <History size={22} /> SYSTEM AUDIT LOGS
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            Real-time security audit trails and administrative action tracking.
          </p>
        </div>

        {/* SEARCH CONTROLS */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-[#0A0D14] border border-hiraya-olive/15 rounded-xl text-hiraya-ink placeholder-gray-600 focus:outline-none focus:border-[#CB997E] text-xs"
            />
          </div>
        </div>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-[#0A0D14] border border-hiraya-olive/15 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#111622] border-b border-hiraya-olive/15 uppercase tracking-widest text-[10px] text-hiraya-ink">
              <tr>
                <th className="p-4">TIMESTAMP</th>
                <th className="p-4">PERFORMED BY</th>
                <th className="p-4">ACTION</th>
                <th className="p-4">TARGET</th>
                <th className="p-4">DETAILS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-hiraya-ink">
              {filteredLogs && filteredLogs.length > 0 ? (
                filteredLogs.map((log, idx) => (
                  <tr key={log.id || idx} className="hover:bg-hiraya-cream/60 transition">
                    <td className="p-4 text-hiraya-ink whitespace-nowrap">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : new Date().toLocaleString()}
                    </td>
                    <td className="p-4 font-semibold text-hiraya-ink">
                      {actorOf(log) || 'System'}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 bg-[#CB997E]/10 border border-[#CB997E]/30 text-hiraya-ink text-[10px] rounded font-bold uppercase">
                        {log.action || 'SETTINGS_TOGGLE'}
                      </span>
                    </td>
                    <td className="p-4 text-hiraya-ink uppercase text-[10px] tracking-wider">
                      {log.target ? (
                        <span className="px-2 py-0.5 bg-hiraya-cream/60 border border-hiraya-olive/15 rounded">
                          {log.target}
                        </span>
                      ) : (
                        <span className="text-hiraya-sand">—</span>
                      )}
                    </td>
                    <td className="p-4 text-hiraya-ink max-w-md truncate">
                      {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details || 'System configuration updated.'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-hiraya-sand uppercase tracking-[0.25em] font-light">
                    NO AUDIT LOGS RECORDED
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
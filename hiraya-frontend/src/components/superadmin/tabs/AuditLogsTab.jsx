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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-[#E9C46A] flex items-center gap-2">
            <History size={22} /> SYSTEM AUDIT LOGS
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Real-time security audit trails and administrative action tracking.
          </p>
        </div>

        {/* SEARCH CONTROLS */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 bg-[#0A0D14] border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[#E9C46A] text-xs"
            />
          </div>
        </div>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-[#0A0D14] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#111622] border-b border-white/10 uppercase tracking-widest text-[10px] text-gray-400">
              <tr>
                <th className="p-4">TIMESTAMP</th>
                <th className="p-4">PERFORMED BY</th>
                <th className="p-4">ACTION</th>
                <th className="p-4">TARGET</th>
                <th className="p-4">DETAILS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300">
              {filteredLogs && filteredLogs.length > 0 ? (
                filteredLogs.map((log, idx) => (
                  <tr key={log.id || idx} className="hover:bg-white/5 transition">
                    <td className="p-4 text-gray-400 whitespace-nowrap">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : new Date().toLocaleString()}
                    </td>
                    <td className="p-4 font-semibold text-white">
                      {actorOf(log) || 'System'}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 bg-[#E9C46A]/10 border border-[#E9C46A]/30 text-[#E9C46A] text-[10px] rounded font-bold uppercase">
                        {log.action || 'SETTINGS_TOGGLE'}
                      </span>
                    </td>
                    <td className="p-4 text-gray-400 uppercase text-[10px] tracking-wider">
                      {log.target ? (
                        <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded">
                          {log.target}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="p-4 text-gray-400 max-w-md truncate">
                      {typeof log.details === 'object' ? JSON.stringify(log.details) : log.details || 'System configuration updated.'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-gray-500 uppercase tracking-[0.25em] font-light">
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
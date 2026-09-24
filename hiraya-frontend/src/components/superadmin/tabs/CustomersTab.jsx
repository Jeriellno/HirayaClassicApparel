import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  RefreshCw,
  Users,
  Search,
  X,
  ShieldOff,
  ShieldCheck,
  Mail,
  Ruler,
  ShoppingBag,
} from 'lucide-react';
import api from '../../../api/axios';

/**
 * SUPER ADMIN — CUSTOMERS.
 *
 * The console previously listed ADMIN accounts only; customers — the majority
 * of the data — were invisible. This tab closes that gap: a searchable list,
 * a profile drawer with saved measurements and order history, and suspend /
 * reactivate.
 *
 * SUSPENSION IS REAL. `suspend` sets `suspended_at` server-side and the LOGIN
 * endpoint refuses a suspended account, so this changes behaviour rather than
 * writing a flag nothing reads.
 */

const peso = (value) => `₱${Number(value || 0).toFixed(2)}`;

const formatWhen = (iso) => {
  if (!iso) return 'Never';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Never';
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString();
};

const CustomersTab = () => {
  const [customers, setCustomers] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busyId, setBusyId] = useState(null);

  // Profile drawer state.
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  /*
   * The backend supports server-side search + status filtering, but the list
   * is small enough (and the console is a dev single-worker server) that
   * filtering in memory avoids a request per keystroke. The full list is
   * fetched once and re-fetched on demand.
   */
  const fetchCustomers = useCallback(async () => {
    setFetching(true);
    setError('');
    try {
      const res = await api.get('/admin/customers');
      setCustomers(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (err) {
      console.error('SuperAdmin: failed to load customers', err);
      setError(
        err?.response?.data?.message || 'Failed to load customers from the server.'
      );
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const openDetail = async (customer) => {
    setLoadingDetail(true);
    setDetail({ id: customer.id, loading: true });
    try {
      const res = await api.get(`/admin/customers/${customer.id}`);
      setDetail(res.data);
    } catch (err) {
      console.error('SuperAdmin: failed to load customer detail', err);
      setError(err?.response?.data?.message || 'Failed to load that customer.');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSuspend = async (customer) => {
    if (
      !window.confirm(
        `Suspend ${customer.email}?\n\nThey will be signed out immediately and unable to log in until reactivated.`
      )
    ) {
      return;
    }

    setBusyId(customer.id);
    setError('');
    try {
      const res = await api.patch(`/admin/customers/${customer.id}/suspend`);
      const updated = res.data?.customer;
      setCustomers((current) =>
        current.map((c) => (c.id === customer.id ? { ...c, ...updated } : c))
      );
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to suspend the customer.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReactivate = async (customer) => {
    setBusyId(customer.id);
    setError('');
    try {
      const res = await api.patch(`/admin/customers/${customer.id}/reactivate`);
      const updated = res.data?.customer;
      setCustomers((current) =>
        current.map((c) => (c.id === customer.id ? { ...c, ...updated } : c))
      );
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to reactivate the customer.');
    } finally {
      setBusyId(null);
    }
  };

  const visible = customers.filter((c) => {
    if (status === 'active' && c.suspended_at) return false;
    if (status === 'suspended' && !c.suspended_at) return false;
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      const haystack = [c.full_name, c.email].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const suspendedCount = customers.filter((c) => c.suspended_at).length;

  return (
    <div className="space-y-6 animate-fadeIn font-mono text-xs">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-[#E9C46A] flex items-center gap-2">
            <Users size={22} /> CUSTOMER DIRECTORY
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Search customers, review their saved measurements and order history,
            and suspend or reactivate accounts.
          </p>
        </div>

        <button
          onClick={fetchCustomers}
          disabled={fetching}
          className="px-4 py-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] disabled:opacity-50 text-black font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <RefreshCw size={16} className={fetching ? 'animate-spin' : ''} />
          {fetching ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Total Customers</p>
          <p className="text-3xl font-bold text-white pt-1">{customers.length}</p>
        </div>
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Active</p>
          <p className="text-3xl font-bold text-emerald-400 pt-1">
            {customers.length - suspendedCount}
          </p>
        </div>
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Suspended</p>
          <p className={`text-3xl font-bold pt-1 ${suspendedCount > 0 ? 'text-red-400' : 'text-white'}`}>
            {suspendedCount}
          </p>
        </div>
      </div>

      {/* FILTERS + SEARCH */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: 'All' },
          { id: 'active', label: 'Active' },
          { id: 'suspended', label: 'Suspended' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatus(tab.id)}
            className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${status === tab.id
                ? 'bg-[#E9C46A]/15 text-[#E9C46A] border-[#E9C46A]/40 font-medium'
                : 'text-gray-400 border-white/10 hover:text-white hover:border-white/30'
              }`}
          >
            {tab.label}
          </button>
        ))}

        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-2 bg-[#0A0D14] border border-white/10 rounded-xl text-white placeholder-gray-600 focus:outline-none focus:border-[#E9C46A] text-xs w-full sm:w-64"
          />
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/10 border border-red-500/30 text-red-400 rounded-2xl uppercase tracking-wider">
          {error}
        </div>
      )}

      {/* TABLE */}
      <div className="bg-[#0A0D14] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-[#111622] border-b border-white/10 uppercase tracking-widest text-[10px] text-gray-400">
              <tr>
                <th className="p-4">CUSTOMER</th>
                <th className="p-4">LAST SEEN</th>
                <th className="p-4">JOINED</th>
                <th className="p-4">STATUS</th>
                <th className="p-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-gray-300">
              {fetching ? (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-gray-500 uppercase tracking-[0.25em]">
                    <Loader2 size={20} className="animate-spin text-[#E9C46A] mx-auto mb-2" />
                    Loading Customers...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-gray-500 uppercase tracking-[0.25em] font-light">
                    {customers.length === 0 ? 'NO CUSTOMERS FOUND' : 'NOTHING MATCHES THIS VIEW'}
                  </td>
                </tr>
              ) : (
                visible.map((customer) => (
                  <tr key={customer.id} className="hover:bg-white/5 transition">
                    <td className="p-4">
                      <button
                        onClick={() => openDetail(customer)}
                        className="flex items-center gap-3 text-left cursor-pointer group"
                      >
                        <div className="w-8 h-8 rounded-full bg-[#E9C46A]/10 border border-[#E9C46A]/30 flex items-center justify-center text-[#E9C46A] font-bold">
                          {(customer.full_name || customer.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-white group-hover:text-[#E9C46A] transition">
                            {customer.full_name || 'Unnamed Customer'}
                          </div>
                          <div className="text-[10px] text-gray-500">{customer.email}</div>
                        </div>
                      </button>
                    </td>

                    <td className="p-4 text-[11px] text-gray-400">
                      {formatWhen(customer.last_login_at)}
                    </td>

                    <td className="p-4 text-[11px] text-gray-400">
                      {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '—'}
                    </td>

                    <td className="p-4">
                      <span
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${customer.suspended_at
                            ? 'bg-red-500/10 text-red-400 border-red-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          }`}
                      >
                        {customer.suspended_at ? 'Suspended' : 'Active'}
                      </span>
                    </td>

                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openDetail(customer)}
                          className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-lg transition cursor-pointer"
                          title="View profile"
                        >
                          <Search size={14} />
                        </button>

                        {customer.suspended_at ? (
                          <button
                            onClick={() => handleReactivate(customer)}
                            disabled={busyId === customer.id}
                            className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 rounded-lg transition cursor-pointer disabled:opacity-50"
                            title="Reactivate customer"
                          >
                            {busyId === customer.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ShieldCheck size={14} />
                            )}
                          </button>
                        ) : (
                          <button
                            onClick={() => handleSuspend(customer)}
                            disabled={busyId === customer.id}
                            className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg transition cursor-pointer disabled:opacity-50"
                            title="Suspend customer"
                          >
                            {busyId === customer.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <ShieldOff size={14} />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PROFILE DRAWER */}
      {detail && (
        <div
          onClick={() => setDetail(null)}
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0A0D14] border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
              <h3 className="font-bold text-[#E9C46A] uppercase tracking-wider flex items-center gap-2">
                <Users size={16} /> CUSTOMER PROFILE
              </h3>
              <button
                onClick={() => setDetail(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {loadingDetail && detail.loading ? (
              <div className="py-20 text-center text-gray-500">
                <Loader2 size={22} className="animate-spin text-[#E9C46A] mx-auto mb-3" />
                <span className="uppercase tracking-widest text-[10px]">Loading profile…</span>
              </div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Identity */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-white text-base font-semibold">
                      {detail.full_name || 'Unnamed Customer'}
                    </p>
                    <p className="text-gray-500 flex items-center gap-1.5 mt-1">
                      <Mail size={12} /> {detail.email}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border shrink-0 ${detail.suspended_at
                        ? 'bg-red-500/10 text-red-400 border-red-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}
                  >
                    {detail.suspended_at ? 'Suspended' : 'Active'}
                  </span>
                </div>

                {/* Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1 flex items-center gap-1">
                      <ShoppingBag size={11} /> Orders
                    </p>
                    <p className="text-gray-200 text-lg font-bold">{detail.order_count ?? 0}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Lifetime Value</p>
                    <p className="text-emerald-400 text-lg font-bold">{peso(detail.lifetime_value)}</p>
                  </div>
                  <div className="p-3 bg-black/40 border border-white/5 rounded-xl">
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Last Seen</p>
                    <p className="text-gray-200">{formatWhen(detail.last_login_at)}</p>
                  </div>
                </div>

                {/* Measurements */}
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2 flex items-center gap-1.5">
                    <Ruler size={12} /> Saved Body Measurements
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    {[
                      ['Chest/Bust', detail.measurements?.chest_bust],
                      ['Waist', detail.measurements?.waist],
                      ['Hips', detail.measurements?.hips],
                      ['Shoulder', detail.measurements?.shoulder_width],
                      ['Sleeve', detail.measurements?.sleeve_length],
                      ['Top Size', detail.measurements?.top_size],
                      ['Bottom Size', detail.measurements?.bottom_size],
                      ['Preferred Fit', detail.measurements?.preferred_fit],
                    ].map(([label, value]) => (
                      <div key={label} className="p-2.5 bg-black/40 border border-white/5 rounded-lg">
                        <p className="text-[9px] uppercase tracking-widest text-gray-500">{label}</p>
                        <p className="text-gray-200">
                          {value === null || value === undefined || value === '' ? '—' : value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Orders */}
                {detail.orders?.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">Order History</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {detail.orders.map((o) => (
                        <div
                          key={o.id}
                          className="flex items-center justify-between p-2.5 bg-black/40 border border-white/5 rounded-lg text-[11px]"
                        >
                          <span className="text-gray-300">Order #{o.id}</span>
                          <span className="text-gray-500">{o.payment_status}</span>
                          <span className="text-white">{peso(o.total_amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
                  {detail.suspended_at ? (
                    <button
                      onClick={() => {
                        handleReactivate(detail);
                        setDetail(null);
                      }}
                      className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold uppercase rounded-xl transition cursor-pointer flex items-center gap-2"
                    >
                      <ShieldCheck size={14} /> Reactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        handleSuspend(detail);
                        setDetail(null);
                      }}
                      className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 font-bold uppercase rounded-xl transition cursor-pointer flex items-center gap-2"
                    >
                      <ShieldOff size={14} /> Suspend
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersTab;
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
  ShoppingBag,
  Wallet,
  Clock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import api from '../../../api/axios';
import useConfirm from '../../../hooks/useConfirm';
import { getProductImageUrl } from '../../../utils/imageHelper';
import { themeSurfaceFor } from '../../../utils/framePresets';

/**
 * SUPER ADMIN — CUSTOMERS.
 *
 * The console previously listed ADMIN accounts only; customers — the majority
 * of the data — were invisible. This tab closes that gap: a searchable list,
 * a profile drawer with saved sizes and order history, and suspend /
 * reactivate.
 *
 * SUSPENSION IS REAL. `suspend` sets `suspended_at` server-side and the LOGIN
 * endpoint refuses a suspended account, so this changes behaviour rather than
 * writing a flag nothing reads.
 */

/** Customers per page; the sixth starts page two (matches the Inventory Catalog). */
const PAGE_SIZE = 5;

/*
 * The peso sign is written as an escape (₱) on purpose: the literal
 * character had been saved through a Latin-1 round trip and rendered as the
 * mojibake "â‚±0.00". An escape cannot be mis-encoded.
 */
const peso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * TOTAL SPENT — what the customer has actually paid, across every order.
 *
 * The backend's `lifetime_value` counts FULLY PAID orders only, so a customer
 * whose orders are at the 50% down-payment stage showed ₱0.00 despite having
 * paid real money. Here each order contributes what was paid on it:
 *   fully_paid -> the whole total
 *   50_paid    -> the verified down payment (`dp_amount`; 50% of the total
 *                 when the list in hand does not carry that column)
 *   pending, or a rejected order -> nothing
 * Same rule as the Orders tab's `paidAmount`, so the two never disagree.
 */
const totalSpent = (orders = []) =>
  (Array.isArray(orders) ? orders : []).reduce((sum, o) => {
    if (o?.order_status === 'rejected' || o?.payment_status === 'rejected') return sum;
    const amount = Number(o?.total_amount) || 0;
    if (o?.payment_status === 'fully_paid') return sum + amount;
    if (o?.payment_status === '50_paid') return sum + (o?.dp_amount != null ? Number(o.dp_amount) || 0 : amount * 0.5);
    return sum;
  }, 0);

/** Customer-facing order status words for the profile's order cards. */
const ORDER_STATUS_LABEL = {
  pending: 'Pending',
  processing: 'Processing',
  ready_for_shipping: 'Ready to Ship',
  shipped: 'Shipped',
  delivered: 'Completed',
  rejected: 'Rejected',
};

const ORDER_STATUS_TONE = {
  delivered: 'bg-emerald-500/12 text-emerald-700 border-emerald-500/30',
  shipped: 'bg-sky-500/12 text-sky-800 border-sky-600/30',
  rejected: 'bg-red-500/12 text-red-700 border-red-600/40',
};

/** How many Recent Orders cards the profile shows before "View All Orders". */
const RECENT_ORDER_LIMIT = 2;

/** A profile summary card: label on top, one big figure under it. */
const StatCard = ({ icon: Icon, label, children, tone = 'text-hiraya-ink' }) => (
  <div className="p-4 bg-cream-200/45 rounded-xl shadow-neu-inset">
    <p className="text-[10px] uppercase tracking-widest text-hiraya-sand flex items-center gap-1.5">
      <Icon size={12} /> {label}
    </p>
    <p className={`mt-1 text-xl font-bold tabular-nums ${tone}`}>{children}</p>
  </div>
);

/** A Customer Details card: small label, one line of value. */
const DetailCard = ({ label, children }) => (
  <div className="p-3.5 bg-hiraya-cream/30 border border-hiraya-structure-line/80 rounded-xl">
    <p className="text-[9px] uppercase tracking-widest text-hiraya-sand">{label}</p>
    <p className="text-[13px] text-hiraya-ink font-medium mt-0.5">{children}</p>
  </div>
);

const formatDate = (iso, withTime = false) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
};

/** "3 months", "1 year 2 months" — how long someone has been a customer. */
const tenure = (iso) => {
  if (!iso) return '—';
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return '—';
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 1) {
    const days = Math.max(0, Math.floor((now - start) / 86400000));
    return days === 0 ? 'Today' : `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(`${years} ${years === 1 ? 'year' : 'years'}`);
  if (rest) parts.push(`${rest} ${rest === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
};

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

/**
 * @param {Object}   props
 * @param {Function} [props.onViewOrders] opens the Orders tab focused on
 *   `{ orderId }` (one order) or `{ search }` (all of a customer's orders).
 *   Optional — without it the order links are hidden.
 */
const CustomersTab = ({ onViewOrders } = {}) => {
  // In-app Confirm / Cancel dialog (replaces the browser's `window.confirm`).
  const [confirm, confirmDialog] = useConfirm();
  const [customers, setCustomers] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [page, setPage] = useState(0);

  // Profile drawer state.
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  // This customer's orders with items: null = loading, false = failed, [] = none.
  const [customerOrders, setCustomerOrders] = useState(null);

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
    setCustomerOrders(null);
    try {
      /*
       * Two reads in parallel: the profile, and the order list WITH line items
       * and products (for the Recent Orders cards). The customer endpoint only
       * returns order totals, so the items come from the same `/admin/orders`
       * list the Orders tab uses, filtered to this customer. If that second read
       * fails the profile still opens — Recent Orders just says it could not load.
       */
      const [res, ordersRes] = await Promise.all([
        api.get(`/admin/customers/${customer.id}`),
        api.get('/admin/orders').catch((err) => {
          console.warn('SuperAdmin: could not load order items for the profile', err);
          return null;
        }),
      ]);
      setDetail(res.data);
      if (ordersRes) {
        const all = Array.isArray(ordersRes.data) ? ordersRes.data : (ordersRes.data?.data || []);
        setCustomerOrders(
          all
            .filter((o) => String(o.user_id ?? o.user?.id) === String(customer.id))
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        );
      } else {
        setCustomerOrders(false);
      }
    } catch (err) {
      console.error('SuperAdmin: failed to load customer detail', err);
      setError(err?.response?.data?.message || 'Failed to load that customer.');
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleSuspend = async (customer) => {
    const ok = await confirm({
      title: 'Suspend customer?',
      message: `${customer.email} will be signed out immediately and unable to log in until reactivated.`,
      confirmText: 'Suspend',
      danger: true,
    });
    if (!ok) return;

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

  /*
   * PAGINATION — five customers per page, same as the Inventory Catalog.
   * It pages the FILTERED list, so search and the status tabs still cover every
   * customer. `safePage` clamps the page when a filter or a refresh shrinks the
   * list, so the table never sits on an empty page.
   */
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pagedCustomers = visible.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="space-y-7 animate-fadeIn text-xs">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-hiraya-structure-line">
        <div>
          <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900 flex items-center gap-2">
            <Users size={22} /> CUSTOMER DIRECTORY
          </h2>
          <p className="text-xs text-hiraya-ink mt-1">
            Search customers, review their saved sizes and order history,
            and suspend or reactivate accounts.
          </p>
        </div>

        <button
          onClick={fetchCustomers}
          disabled={fetching}
          className="px-4 py-2.5 bg-hiraya-accent hover:bg-hiraya-gold-deep disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none text-hiraya-on-accent font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <RefreshCw size={16} className={fetching ? 'animate-spin' : ''} />
          {fetching ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {/* METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-hiraya-ink">Total Customers</p>
          <p className="text-3xl font-bold text-hiraya-ink pt-1">{customers.length}</p>
        </div>
        <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-hiraya-ink">Active</p>
          <p className="text-3xl font-bold text-emerald-700 pt-1">
            {customers.length - suspendedCount}
          </p>
        </div>
        <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-hiraya-ink">Suspended</p>
          <p className={`text-3xl font-bold pt-1 ${suspendedCount > 0 ? 'text-red-700' : 'text-hiraya-ink'}`}>
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
            onClick={() => {
              setStatus(tab.id);
              setPage(0); // a new filter starts on its first page
            }}
            className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${status === tab.id
                ? 'bg-hiraya-accent/15 text-hiraya-ink border-hiraya-accent/40 font-medium'
                : 'text-hiraya-ink border-hiraya-structure-line/80 hover:text-hiraya-ink hover:border-hiraya-structure-line'
              }`}
          >
            {tab.label}
          </button>
        ))}

        <div className="relative ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
          <input
            type="text"
            placeholder="Search name or email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0); // results of a new search start on page one
            }}
            className="pl-8 pr-3 py-2 bg-hiraya-cream-deep border border-hiraya-structure-line rounded-xl text-hiraya-ink placeholder:text-hiraya-sand/70 focus:outline-none focus:border-hiraya-accent text-xs w-full sm:w-64"
          />
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/12 border border-red-600/40 text-red-700 rounded-2xl uppercase tracking-wider">
          {error}
        </div>
      )}

      {/* TABLE */}
      <div className="bg-hiraya-surface rounded-[22px] overflow-hidden shadow-neu ring-1 ring-cream-50/80">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-navy-900 uppercase tracking-[0.16em] text-[10px] text-cream-100">
              <tr>
                <th className="p-4">CUSTOMER</th>
                <th className="p-4">LAST SEEN</th>
                <th className="p-4">JOINED</th>
                <th className="p-4">STATUS</th>
                <th className="p-4 text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hiraya-structure-line/70 text-hiraya-ink">
              {fetching ? (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-hiraya-sand uppercase tracking-[0.25em]">
                    <Loader2 size={20} className="animate-spin text-hiraya-ink mx-auto mb-2" />
                    Loading Customers...
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-20 text-center text-hiraya-sand uppercase tracking-[0.25em] font-light">
                    {customers.length === 0 ? 'NO CUSTOMERS FOUND' : 'NOTHING MATCHES THIS VIEW'}
                  </td>
                </tr>
              ) : (
                pagedCustomers.map((customer) => (
                  <tr key={customer.id} className="hover:bg-cream-200/60 transition">
                    <td className="p-4">
                      <button
                        onClick={() => openDetail(customer)}
                        className="flex items-center gap-3 text-left cursor-pointer group"
                      >
                        <div className="w-8 h-8 rounded-full bg-hiraya-accent/10 border border-hiraya-accent/30 flex items-center justify-center text-hiraya-ink font-bold">
                          {(customer.full_name || customer.email || '?').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-hiraya-ink group-hover:text-hiraya-ink transition">
                            {customer.full_name || 'Unnamed Customer'}
                          </div>
                          <div className="text-[10px] text-hiraya-sand">{customer.email}</div>
                        </div>
                      </button>
                    </td>

                    <td className="p-4 text-[11px] text-hiraya-ink">
                      {formatWhen(customer.last_login_at)}
                    </td>

                    <td className="p-4 text-[11px] text-hiraya-ink">
                      {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '—'}
                    </td>

                    <td className="p-4">
                      <span
                        className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase border ${customer.suspended_at
                            ? 'bg-red-500/12 text-red-700 border-red-600/40'
                            : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                          }`}
                      >
                        {customer.suspended_at ? 'Suspended' : 'Active'}
                      </span>
                    </td>

                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openDetail(customer)}
                          className="p-2 bg-cream-200/60 hover:bg-cream-200/60 border border-hiraya-structure-line/80 text-hiraya-ink rounded-lg transition cursor-pointer"
                          title="View profile"
                        >
                          <Search size={14} />
                        </button>

                        {customer.suspended_at ? (
                          <button
                            onClick={() => handleReactivate(customer)}
                            disabled={busyId === customer.id}
                            className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 rounded-lg transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
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
                            className="p-2 bg-red-500/12 hover:bg-red-500/20 border border-red-600/40 text-red-700 rounded-lg transition cursor-pointer disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
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

        {/* PAGINATION — shown once there is more than one page. */}
        {!fetching && visible.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-hiraya-structure-line/70 font-mono">
            <p className="text-[10px] uppercase tracking-wider text-hiraya-ink-muted tabular-nums">
              {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visible.length)} of {visible.length}
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

      {/* PROFILE DRAWER */}
      {detail && (
        <div
          onClick={() => setDetail(null)}
          className="fixed inset-0 z-[60] bg-hiraya-cream-deep/80 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-hiraya-cream-deep border border-hiraya-structure-line rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="p-4 border-b border-hiraya-structure-line/80 flex justify-between items-center bg-cream-200/60">
              <h3 className="font-bold text-hiraya-ink uppercase tracking-wider flex items-center gap-2">
                <Users size={16} /> CUSTOMER PROFILE
              </h3>
              <button
                onClick={() => setDetail(null)}
                className="text-hiraya-ink hover:text-hiraya-ink p-1 rounded-lg transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {loadingDetail && detail.loading ? (
              <div className="py-20 text-center text-hiraya-sand">
                <Loader2 size={22} className="animate-spin text-hiraya-ink mx-auto mb-3" />
                <span className="uppercase tracking-widest text-[10px]">Loading profile…</span>
              </div>
            ) : (
              <div className="p-5 space-y-5">
                {(() => {
                  /*
                   * The orders WITH items (from /admin/orders) are preferred for
                   * every figure; the profile's own order summary is the fallback
                   * while they load or if that read failed.
                   */
                  const orders = Array.isArray(customerOrders) ? customerOrders : (detail.orders || []);
                  const lastOrder = orders
                    .map((o) => o?.created_at)
                    .filter(Boolean)
                    .sort((a, b) => new Date(b) - new Date(a))[0];
                  const recent = Array.isArray(customerOrders) ? customerOrders.slice(0, RECENT_ORDER_LIMIT) : [];

                  return (
                    <>
                      {/* IDENTITY — name, email, status */}
                      <div className="space-y-2">
                        <p className="text-hiraya-ink text-lg font-semibold leading-tight">
                          {detail.full_name || 'Unnamed Customer'}
                        </p>
                        <p className="text-hiraya-sand flex items-center gap-1.5">
                          <Mail size={12} /> {detail.email}
                        </p>
                        <span
                          className={`inline-block px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider border ${detail.suspended_at
                              ? 'bg-red-500/12 text-red-700 border-red-600/40'
                              : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                            }`}
                        >
                          {detail.suspended_at ? 'Suspended' : 'Active'}
                        </span>
                      </div>

                      {/* SUMMARY — Orders / Total Spent / Last Seen, one card each */}
                      <div className="space-y-2.5">
                        <StatCard icon={ShoppingBag} label="Orders">
                          {orders.length || detail.order_count || 0}
                        </StatCard>
                        <StatCard icon={Wallet} label="Total Spent" tone="text-emerald-700">
                          {peso(totalSpent(orders))}
                        </StatCard>
                        <StatCard icon={Clock} label="Last Seen">
                          {formatWhen(detail.last_login_at)}
                        </StatCard>
                      </div>

                      {/* CUSTOMER DETAILS */}
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-hiraya-ink font-bold mb-2 flex items-center gap-1.5">
                          <CalendarDays size={12} /> Customer Details
                        </p>
                        <div className="space-y-2">
                          <DetailCard label="Account Created">{formatDate(detail.created_at, true)}</DetailCard>
                          <DetailCard label="Last Order">{lastOrder ? formatDate(lastOrder) : 'No orders yet'}</DetailCard>
                          <DetailCard label="Customer Since">{tenure(detail.created_at)}</DetailCard>
                        </div>
                      </div>

                      {/* RECENT ORDERS — the latest few, with the first item's photo */}
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-hiraya-ink font-bold mb-2 flex items-center gap-1.5">
                          <ShoppingBag size={12} /> Recent Orders
                        </p>

                        {customerOrders === null ? (
                          <div className="py-6 text-center text-hiraya-sand">
                            <Loader2 size={16} className="animate-spin mx-auto mb-1.5" />
                            <span className="uppercase tracking-widest text-[9px]">Loading orders…</span>
                          </div>
                        ) : customerOrders === false ? (
                          <p className="text-[11px] text-hiraya-sand">Could not load this customer&apos;s orders.</p>
                        ) : recent.length === 0 ? (
                          <p className="text-[11px] text-hiraya-sand">No orders yet.</p>
                        ) : (
                          <div className="space-y-2.5">
                            {recent.map((order) => {
                              const items = order.order_items || order.orderItems || [];
                              const first = items[0];
                              const product = first?.product;
                              const rawImage = product?.display_image_url || product?.image_url || product?.image;
                              const image = rawImage ? getProductImageUrl(rawImage) : null;
                              const more = items.length - 1;
                              return (
                                <div
                                  key={order.id}
                                  className="p-4 bg-hiraya-cream/30 border border-hiraya-structure-line/80 rounded-xl space-y-3"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="font-bold text-hiraya-ink uppercase tracking-wider">#ORD-{order.id}</p>
                                      <p className="text-[10px] text-hiraya-sand mt-0.5">{formatDate(order.created_at)}</p>
                                    </div>
                                    <span
                                      className={`px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${ORDER_STATUS_TONE[order.order_status] || 'bg-cream-200/60 text-hiraya-ink border-hiraya-structure-line'
                                        }`}
                                    >
                                      {ORDER_STATUS_LABEL[order.order_status] || order.order_status || '—'}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-3">
                                    <div
                                      className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-black flex items-center justify-center"
                                      style={{ backgroundColor: themeSurfaceFor(product) }}
                                    >
                                      {image ? (
                                        <img
                                          src={image}
                                          alt=""
                                          className="h-full w-full object-contain"
                                          onError={(e) => {
                                            e.currentTarget.onerror = null;
                                            e.currentTarget.src = '/images/placeholder.svg';
                                          }}
                                        />
                                      ) : (
                                        <ShoppingBag size={16} className="text-cream-100/70" />
                                      )}
                                    </div>
                                    <div className="min-w-0 text-[11px]">
                                      <p className="font-semibold text-hiraya-ink truncate">
                                        {first?.product_name_snapshot || product?.name || 'Order item'}
                                      </p>
                                      {more > 0 ? (
                                        <>
                                          <p className="text-hiraya-sand">+{more} more {more === 1 ? 'item' : 'items'}</p>
                                          <p className="text-hiraya-sand">{items.length} items</p>
                                        </>
                                      ) : first ? (
                                        <>
                                          <p className="text-hiraya-sand">Size: {first.selected_size || '—'}</p>
                                          <p className="text-hiraya-sand">Qty: {first.quantity ?? 1}</p>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-hiraya-structure-line/60">
                                    <p className="font-bold text-hiraya-ink tabular-nums">{peso(order.total_amount)}</p>
                                    {onViewOrders && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDetail(null);
                                          onViewOrders({ orderId: order.id });
                                        }}
                                        className="text-[10px] font-bold uppercase tracking-wider text-navy-800 hover:underline cursor-pointer"
                                      >
                                        View Order
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {onViewOrders && Array.isArray(customerOrders) && customerOrders.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setDetail(null);
                              onViewOrders({ search: detail.email });
                            }}
                            className="mt-3 text-[10px] font-bold uppercase tracking-wider text-navy-800 hover:underline cursor-pointer flex items-center gap-1"
                          >
                            View All Orders <ChevronRight size={12} />
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}

                <div className="pt-4 border-t border-hiraya-structure-line/80">
                  {detail.suspended_at ? (
                    <button
                      onClick={() => {
                        handleReactivate(detail);
                        setDetail(null);
                      }}
                      className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-700 font-bold uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-2 w-full py-2.5"
                    >
                      <ShieldCheck size={14} /> Reactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        handleSuspend(detail);
                        setDetail(null);
                      }}
                      className="px-4 py-2 bg-red-500/12 hover:bg-red-500/20 border border-red-600/40 text-red-700 font-bold uppercase tracking-wider rounded-xl transition cursor-pointer flex items-center justify-center gap-2 w-full py-2.5"
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

      {confirmDialog}
    </div>
  );
};

export default CustomersTab;
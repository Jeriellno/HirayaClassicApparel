import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Package, Search, Truck, Clock } from 'lucide-react';
import api from '../../../api/axios';

/**
 * SUPER ADMIN — ORDERS (read-only).
 *
 * WHY THIS EXISTS
 * ---------------
 * The Super Admin console could provision admins, export the entire database
 * and flip maintenance mode, but could NOT see a single customer order — the
 * order surface lived only in the Admin console. The highest-privilege role
 * saw strictly less than the role it manages, which is backwards.
 *
 * READ-ONLY IS DELIBERATE. Fulfilment (approving down payments, confirming the
 * balance, setting tracking, marking shipped) stays in the Admin console, where
 * the workflow and its audit trail already live. Adding a second writer here
 * would create two places that can advance the same order and two places to
 * keep in sync for no benefit. This tab answers "what is happening with
 * orders?" — the question a super admin actually has.
 *
 * It reads the SAME `GET /admin/orders` endpoint the Admin console uses, so
 * there is one source of truth and no new backend surface.
 */

const PAYMENT_STATUS = {
  pending: { label: 'DP Pending', className: 'bg-[#E9C46A]/12 text-stone-200 border-stone-300/30' },
  '50_paid': { label: '50% Paid', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  fully_paid: { label: 'Fully Paid', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  rejected: { label: 'DP Rejected', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const ORDER_STATUS = {
  pending: 'Pending',
  processing: 'Processing',
  ready_for_shipping: 'Ready for Shipping',
  shipped: 'Shipped',
};

const peso = (value) => `₱${Number(value || 0).toFixed(2)}`;

const OrdersTab = () => {
  const [orders, setOrders] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const fetchOrders = useCallback(async () => {
    setFetching(true);
    setError('');
    try {
      const res = await api.get('/admin/orders');
      setOrders(Array.isArray(res.data) ? res.data : (res.data?.data || []));
    } catch (err) {
      console.error('SuperAdmin: failed to load orders', err);
      setError(
        err?.response?.data?.message || 'Failed to load orders from the server.'
      );
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const visibleOrders = orders.filter((o) => {
    if (filter === 'awaiting_dp' && o.payment_status !== 'pending') return false;
    if (filter === 'awaiting_balance' && o.payment_status !== '50_paid') return false;
    if (filter === 'rejected' && o.payment_status !== 'rejected') return false;
    if (filter === 'shipped' && o.order_status !== 'shipped') return false;

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      const haystack = [
        String(o.id),
        o.customer_name,
        o.contact_number,
        o.delivery_address,
        o.tracking_booking_details,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  // Revenue is summed from FULLY PAID orders only — a pending DP is not income
  // yet, and counting it would overstate the figure the operator is reading.
  const totals = orders.reduce(
    (acc, o) => {
      acc.count += 1;
      if (o.payment_status === 'fully_paid') acc.revenue += Number(o.total_amount || 0);
      if (o.payment_status === 'pending') acc.awaitingDp += 1;
      return acc;
    },
    { count: 0, revenue: 0, awaitingDp: 0 }
  );

  return (
    <div className="space-y-6 animate-fadeIn font-mono text-xs">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-white/10">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-[#E9C46A] flex items-center gap-2">
            <Package size={22} /> ORDER OVERSIGHT
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            Read-only view of every order across the platform. Fulfilment happens in
            the Admin console.
          </p>
        </div>

        <button
          onClick={fetchOrders}
          disabled={fetching}
          className="px-4 py-2.5 bg-[#E9C46A] hover:bg-[#D4A94F] disabled:opacity-50 text-black font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 transition cursor-pointer shrink-0"
        >
          <RefreshCw size={16} className={fetching ? 'animate-spin' : ''} />
          {fetching ? 'Loading' : 'Refresh'}
        </button>
      </div>

      {/* SUMMARY METRICS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Total Orders</p>
          <p className="text-3xl font-bold text-white pt-1">{totals.count}</p>
        </div>
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Fully Paid Revenue</p>
          <p className="text-3xl font-bold text-emerald-400 pt-1">{peso(totals.revenue)}</p>
        </div>
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400">Awaiting Down Payment</p>
          <p className={`text-3xl font-bold pt-1 ${totals.awaitingDp > 0 ? 'text-[#E9C46A]' : 'text-white'}`}>
            {totals.awaitingDp}
          </p>
        </div>
      </div>

      {/* FILTERS + SEARCH */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: 'All' },
          { id: 'awaiting_dp', label: 'Awaiting DP' },
          { id: 'awaiting_balance', label: 'Awaiting Balance' },
          { id: 'rejected', label: 'Rejected' },
          { id: 'shipped', label: 'Shipped' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${filter === tab.id
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
            placeholder="Search id, customer, tracking..."
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

      {/* LIST */}
      {fetching ? (
        <div className="py-20 text-center text-[10px] uppercase tracking-[0.3em] text-[#E9C46A] animate-pulse">
          Loading Orders...
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="bg-[#0D1017] border border-white/10 rounded-2xl py-20 text-center">
          <Package className="w-10 h-10 text-gray-700 mx-auto mb-4" />
          <p className="text-xs text-gray-500 uppercase tracking-widest">No orders in this view.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleOrders.map((order) => {
            const payment = PAYMENT_STATUS[order.payment_status] || {
              label: order.payment_status,
              className: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
            };
            return (
              <div key={order.id} className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4 pb-3 border-b border-white/10">
                  <div>
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <span className="text-xs font-bold text-white uppercase tracking-widest">
                        Order #{order.id}
                      </span>
                      <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${payment.className}`}>
                        {payment.label}
                      </span>
                      <span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-[10px] uppercase tracking-wider text-gray-300">
                        {ORDER_STATUS[order.order_status] || order.order_status}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      {order.customer_name} · {order.contact_number}
                    </p>
                  </div>

                  {order.courier && (
                    <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-300">
                      <Truck size={14} className="text-[#E9C46A]" /> {order.courier}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="md:col-span-2 space-y-3 text-[11px]">
                    <div>
                      <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">Delivery Address</p>
                      <p className="text-gray-300 leading-relaxed">{order.delivery_address}</p>
                    </div>
                    {order.tracking_booking_details && (
                      <div>
                        <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">Tracking / Booking</p>
                        <p className="text-gray-300">{order.tracking_booking_details}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-gray-500 uppercase tracking-widest text-[9px]">Total</span>
                      <span className="text-white">{peso(order.total_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 uppercase tracking-widest text-[9px]">Down Payment</span>
                      <span className="text-[#E9C46A]">{peso(order.dp_amount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500 uppercase tracking-widest text-[9px]">Balance</span>
                      <span className="text-white">{peso(order.balance_amount)}</span>
                    </div>
                  </div>
                </div>

                <p className="text-[9px] text-gray-600 flex items-center gap-1.5 pt-1 border-t border-white/10">
                  <Clock size={11} />
                  Placed {order.created_at ? new Date(order.created_at).toLocaleString() : '—'}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default OrdersTab;

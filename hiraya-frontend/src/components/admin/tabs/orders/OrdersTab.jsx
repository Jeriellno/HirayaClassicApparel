import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Package, Truck, CheckCircle2, Clock, X, AlertTriangle, Search } from 'lucide-react';
import api from '../../../../api/axios';

// Mirrors the backend enums so labels/colors stay in one place.
const PAYMENT_STATUS = {
  pending: { label: 'DP Pending', className: 'bg-[#CB997E]/12 text-hiraya-ink border-hiraya-olive/20' },
  '50_paid': { label: '50% Paid', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  fully_paid: { label: 'Fully Paid', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  rejected: { label: 'DP Rejected', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const ORDER_STATUS = {
  pending: { label: 'Pending' },
  processing: { label: 'Processing' },
  ready_for_shipping: { label: 'Ready for Shipping' },
  shipped: { label: 'Shipped' },
};

const StatusBadge = ({ map, value }) => {
  const config = map[value] || { label: value, className: 'bg-hiraya-sand/20 text-hiraya-ink border-hiraya-sand/40' };
  return (
    <span className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${config.className}`}>
      {config.label}
    </span>
  );
};

const OrdersTab = () => {
  const [orders, setOrders] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [shippingFilter, setShippingFilter] = useState('all');
  const [previewUrl, setPreviewUrl] = useState(null);

  const fetchOrders = useCallback(async () => {
    setFetching(true);
    setError('');
    try {
      const res = await api.get('/admin/orders');
      setOrders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('Error fetching orders:', err);
      setError('Failed to load orders from server.');
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Step 1 — verify the 50% down payment proof.
  const handleApproveDp = async (order) => {
    setBusyId(order.id);
    setError('');
    try {
      const res = await api.patch(`/admin/orders/${order.id}/approve-dp`);
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? res.data.order : o))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to approve down payment.');
    } finally {
      setBusyId(null);
    }
  };

  // Step 1 (alternative) — turn down a bad down payment proof with a reason.
  const handleRejectDp = async (order) => {
    const reason = window.prompt(
      'Why is this down payment being rejected? The customer will see this message.',
      ''
    );
    if (reason === null) return; // cancelled
    if (!reason.trim()) {
      setError('A rejection reason is required so the customer knows what to fix.');
      return;
    }

    setBusyId(order.id);
    setError('');
    try {
      const res = await api.patch(`/admin/orders/${order.id}/reject-dp`, {
        rejection_reason: reason.trim(),
      });
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? res.data.order : o))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reject down payment.');
    } finally {
      setBusyId(null);
    }
  };

  // Step 2 — verify the remaining balance proof.
  const handleConfirmFullPayment = async (order, file) => {
    if (!file) return;
    setBusyId(order.id);
    setError('');
    try {
      const payload = new FormData();
      payload.append('full_payment_proof_image', file);
      const res = await api.post(`/admin/orders/${order.id}/confirm-full-payment`, payload);
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? res.data.order : o))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to confirm full payment.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveTracking = async (order, value) => {
    setBusyId(order.id);
    setError('');
    try {
      const res = await api.patch(`/admin/orders/${order.id}/tracking`, {
        tracking_booking_details: value,
      });
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? res.data.order : o))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save tracking details.');
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkShipped = async (order) => {
    setBusyId(order.id);
    setError('');
    try {
      const res = await api.patch(`/admin/orders/${order.id}/status`, {
        order_status: 'shipped',
      });
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? res.data.order : o))
      );
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update status.');
    } finally {
      setBusyId(null);
    }
  };

  const visibleOrders = useMemo(() => orders.filter((order) => {
    if (filter === 'awaiting_dp' && order.payment_status !== 'pending') return false;
    if (filter === 'awaiting_balance' && order.payment_status !== '50_paid') return false;
    if (filter === 'rejected' && order.payment_status !== 'rejected') return false;
    if (filter === 'ready' && order.order_status !== 'ready_for_shipping') return false;

    const query = searchQuery.trim().toLowerCase();
    const searchable = [
      order.id,
      order.customer_name,
      order.user?.full_name,
      order.user?.email,
      order.contact_number,
      order.tracking_booking_details,
    ].filter(Boolean).join(' ').toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (shippingFilter !== 'all' && order.order_status !== shippingFilter) return false;

    if (dateFrom || dateTo) {
      const createdAt = new Date(order.created_at).getTime();
      if (Number.isNaN(createdAt)) return false;
      if (dateFrom && createdAt < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && createdAt > new Date(`${dateTo}T23:59:59.999`).getTime()) return false;
    }

    return true;
  }), [orders, filter, searchQuery, dateFrom, dateTo, shippingFilter]);

  const awaitingDpCount = orders.filter((o) => o.payment_status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-hiraya-ink">Order Management</h2>
          <p className="text-[10px] text-hiraya-ink font-black uppercase tracking-widest mt-1">
            {awaitingDpCount > 0
              ? `${awaitingDpCount} order${awaitingDpCount !== 1 ? 's' : ''} awaiting down payment verification`
              : 'All down payments verified'}
          </p>
        </div>

        <button
          onClick={fetchOrders}
          disabled={fetching}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink border-hiraya-olive/15 hover:border-[#CB997E]/40 px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={fetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All Orders' },
          { id: 'awaiting_dp', label: 'Awaiting DP' },
          { id: 'rejected', label: 'Rejected' },
          { id: 'awaiting_balance', label: 'Awaiting Balance' },
          { id: 'ready', label: 'Ready for Shipping' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition ${filter === tab.id
                ? 'bg-[#CB997E]/15 text-hiraya-ink border-[#CB997E]/40 font-medium'
                : 'text-hiraya-ink border-hiraya-olive/15 hover:text-hiraya-ink hover:border-hiraya-olive/30'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/50 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
          <input
            type="search"
            placeholder="Search order, customer, email, tracking..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-lg border border-hiraya-olive/15 bg-[#07090D] py-2 pl-8 pr-3 text-xs text-hiraya-ink outline-none focus:border-[#CB997E]"
          />
        </div>
        <label className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-hiraya-olive">
          Status
          <select value={shippingFilter} onChange={(event) => setShippingFilter(event.target.value)} className="rounded-lg border border-hiraya-olive/15 bg-[#07090D] px-2 py-2 text-xs text-hiraya-ink">
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="ready_for_shipping">Ready to ship</option>
            <option value="shipped">Shipped</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-hiraya-olive">
          From <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded-lg border border-hiraya-olive/15 bg-[#07090D] px-2 py-2 text-xs text-hiraya-ink" />
        </label>
        <label className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-hiraya-olive">
          To <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded-lg border border-hiraya-olive/15 bg-[#07090D] px-2 py-2 text-xs text-hiraya-ink" />
        </label>
      </div>

      {error && (
        <div className="text-[11px] text-red-400 bg-red-500/10 border-red-500/30 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Body */}
      {fetching ? (
        <div className="py-24 text-center text-[10px] uppercase tracking-[0.3em] text-hiraya-ink animate-pulse">
          Loading Orders...
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="bg-hiraya-cream border-hiraya-sand/30 rounded-lg py-20 text-center">
          <Package className="w-10 h-10 text-hiraya-sand mx-auto mb-4" />
          <p className="text-sm text-hiraya-sand">No orders in this view.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleOrders.map((order) => (
            <div key={order.id} className="bg-hiraya-cream border-hiraya-sand/30 rounded-lg p-6">
              {/* Order top row */}
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-hiraya-sand/30">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-bold text-hiraya-ink uppercase tracking-widest">
                      Order #{order.id}
                    </span>
                    <StatusBadge map={PAYMENT_STATUS} value={order.payment_status} />
                    <span className="px-2.5 py-1 rounded-full border-hiraya-olive/15 bg-hiraya-cream/60 text-[10px] uppercase tracking-wider text-hiraya-ink">
                      {ORDER_STATUS[order.order_status]?.label || order.order_status}
                    </span>
                  </div>
                  <p className="text-[11px] text-hiraya-sand">
                    {order.customer_name} · {order.contact_number}
                  </p>
                  {order.user?.email && <p className="mt-1 text-[10px] text-hiraya-olive">{order.user.email}</p>}
                </div>

                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
                  <Truck size={14} className="text-hiraya-ink" />
                  <span className="text-hiraya-ink">{order.courier}</span>
                </div>
              </div>

              {(order.order_items || order.orderItems || []).length > 0 && (
                <div className="border-b border-hiraya-sand/30 py-4">
                  <p className="mb-3 text-[9px] uppercase tracking-widest text-hiraya-sand">Items in this order</p>
                  <div className="space-y-2">
                    {(order.order_items || order.orderItems).map((item) => (
                      <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-black/5 px-3 py-2 text-[11px]">
                        <div>
                          <p className="font-semibold text-hiraya-ink">{item.product_name_snapshot || item.product?.name || 'Product'}</p>
                          <p className="mt-0.5 text-[10px] text-hiraya-olive">
                            Size {item.selected_size || '—'} · {item.selected_color || '—'} · Qty {item.quantity}
                          </p>
                        </div>
                        <span className="text-hiraya-ink">₱{Number(item.line_total ?? Number(item.unit_price || 0) * Number(item.quantity || 0)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-5">
                <div className="md:col-span-2 space-y-3 text-[11px]">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-hiraya-sand mb-1">Delivery Address</p>
                    <p className="text-hiraya-ink leading-relaxed">{order.delivery_address}</p>
                  </div>

                  {order.tracking_booking_details && (
                    <div>
                      <p className="text-[9px] uppercase tracking-widest text-hiraya-sand mb-1">
                        Tracking / Booking
                      </p>
                      <p className="text-hiraya-ink">{order.tracking_booking_details}</p>
                    </div>
                  )}
                </div>

                {/* Money breakdown */}
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-hiraya-sand uppercase tracking-widest text-[9px]">Total</span>
                    <span className="text-hiraya-ink">₱{Number(order.total_amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-hiraya-sand uppercase tracking-widest text-[9px]">Down Payment</span>
                    <span className="text-hiraya-ink">₱{Number(order.dp_amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-hiraya-sand uppercase tracking-widest text-[9px]">Balance</span>
                    <span className="text-hiraya-ink">₱{Number(order.balance_amount).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Proof + actions */}
              <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-hiraya-sand/30">
                {/* DP proof */}
                {order.dp_proof_url ? (
                  <button
                    onClick={() => setPreviewUrl(order.dp_proof_url)}
                    className="text-[10px] uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink border-hiraya-olive/15 hover:border-[#CB997E]/40 px-3 py-2 rounded-lg transition"
                  >
                    View DP Proof
                  </button>
                ) : (
                  <span className="text-[10px] uppercase tracking-widest text-hiraya-sand">No DP Proof</span>
                )}

                {/* Step 1 */}
                {order.payment_status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleApproveDp(order)}
                      disabled={busyId === order.id}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-hiraya-olive bg-[#CB997E] hover:bg-hiraya-cream-deep px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      {busyId === order.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={13} />
                      )}
                      Approve 50% DP
                    </button>
                    <button
                      onClick={() => handleRejectDp(order)}
                      disabled={busyId === order.id}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-red-400 border-red-500/30 hover:border-red-500/60 hover:bg-red-500/10 px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      <AlertTriangle size={13} /> Reject DP
                    </button>
                  </>
                )}

                {order.payment_status === 'rejected' && (
                  <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-red-400 max-w-full">
                    <AlertTriangle size={13} className="shrink-0" />
                    Awaiting customer re-upload{order.rejection_reason ? `: ${order.rejection_reason}` : ''}
                  </span>
                )}

                {/* Step 2 — upload remaining balance proof */}
                {order.payment_status === '50_paid' && (
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-hiraya-olive bg-[#CB997E] hover:bg-hiraya-cream-deep px-4 py-2 rounded-lg transition cursor-pointer disabled:opacity-50">
                    {busyId === order.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={13} />
                    )}
                    Confirm Full Payment
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleConfirmFullPayment(order, e.target.files?.[0])}
                    />
                  </label>
                )}

                {/* Tracking input once fully paid */}
                {order.payment_status === 'fully_paid' && order.order_status !== 'shipped' && (
                  <>
                    <input
                      type="text"
                      defaultValue={order.tracking_booking_details || ''}
                      placeholder="Lalamove booking / LBC tracking no."
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        if (value && value !== (order.tracking_booking_details || '')) {
                          handleSaveTracking(order, value);
                        }
                      }}
                      className="flex-1 min-w-[220px] bg-hiraya-cream/30 border-hiraya-olive/15 rounded-lg px-3 py-2 text-[11px] focus:border-[#CB997E] outline-none transition"
                    />
                    <button
                      onClick={() => handleMarkShipped(order)}
                      disabled={busyId === order.id}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-hiraya-olive bg-[#CB997E] hover:bg-hiraya-cream-deep px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      <Truck size={13} /> Mark Shipped
                    </button>
                  </>
                )}

                {order.order_status === 'shipped' && (
                  <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-emerald-400">
                    <CheckCircle2 size={13} /> Shipped
                  </span>
                )}
              </div>

              <p className="text-[9px] text-hiraya-sand mt-3 flex items-center gap-1.5">
                <Clock size={11} />
                Placed {new Date(order.created_at).toLocaleString()}
                {order.dp_submitted_at && (
                  <span className="text-hiraya-sand">
                    · DP proof submitted {new Date(order.dp_submitted_at).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Proof image lightbox */}
      {previewUrl && (
        <div
          onClick={() => setPreviewUrl(null)}
          className="fixed inset-0 z-[60] bg-hiraya-cream-deep/80 backdrop-blur-sm flex items-center justify-center p-6"
        >
          <div className="relative max-w-2xl w-full">
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-10 right-0 text-hiraya-ink hover:text-hiraya-ink transition"
            >
              <X size={22} />
            </button>
            <img
              src={previewUrl}
              alt="Down payment proof"
              className="w-full rounded-xl border-[#CB997E]/30"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersTab;

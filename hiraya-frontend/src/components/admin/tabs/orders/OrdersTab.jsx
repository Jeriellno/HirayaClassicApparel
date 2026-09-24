import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Package, Truck, CheckCircle2, Clock, X, AlertTriangle } from 'lucide-react';
import api from '../../../../api/axios';

// Mirrors the backend enums so labels/colors stay in one place.
const PAYMENT_STATUS = {
  pending: { label: 'DP Pending', className: 'bg-[#E9C46A]/12 text-stone-200 border-stone-300/30' },
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
  const config = map[value] || { label: value, className: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
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

  const visibleOrders = orders.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'awaiting_dp') return o.payment_status === 'pending';
    if (filter === 'awaiting_balance') return o.payment_status === '50_paid';
    if (filter === 'rejected') return o.payment_status === 'rejected';
    if (filter === 'ready') return o.order_status === 'ready_for_shipping';
    return true;
  });

  const awaitingDpCount = orders.filter((o) => o.payment_status === 'pending').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light uppercase tracking-[0.2em] text-white">Order Management</h2>
          <p className="text-[10px] text-[#E9C46A] font-black uppercase tracking-widest mt-1">
            {awaitingDpCount > 0
              ? `${awaitingDpCount} order${awaitingDpCount !== 1 ? 's' : ''} awaiting down payment verification`
              : 'All down payments verified'}
          </p>
        </div>

        <button
          onClick={fetchOrders}
          disabled={fetching}
          className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-400 hover:text-[#E9C46A] border-white/10 hover:border-[#E9C46A]/40 px-4 py-2 rounded-lg transition disabled:opacity-50"
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
                ? 'bg-[#E9C46A]/15 text-[#E9C46A] border-[#E9C46A]/40 font-medium'
                : 'text-gray-400 border-white/10 hover:text-white hover:border-white/30'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-[11px] text-red-400 bg-red-500/10 border-red-500/30 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {/* Body */}
      {fetching ? (
        <div className="py-24 text-center text-[10px] uppercase tracking-[0.3em] text-[#E9C46A] animate-pulse">
          Loading Orders...
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="bg-[#0D1017] border-gray-800 rounded-lg py-20 text-center">
          <Package className="w-10 h-10 text-gray-700 mx-auto mb-4" />
          <p className="text-sm text-gray-500">No orders in this view.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleOrders.map((order) => (
            <div key={order.id} className="bg-[#0D1017] border-gray-800 rounded-lg p-6">
              {/* Order top row */}
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-gray-800">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-bold text-white uppercase tracking-widest">
                      Order #{order.id}
                    </span>
                    <StatusBadge map={PAYMENT_STATUS} value={order.payment_status} />
                    <span className="px-2.5 py-1 rounded-full border-white/10 bg-white/5 text-[10px] uppercase tracking-wider text-gray-300">
                      {ORDER_STATUS[order.order_status]?.label || order.order_status}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {order.customer_name} · {order.contact_number}
                  </p>
                </div>

                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest">
                  <Truck size={14} className="text-[#E9C46A]" />
                  <span className="text-gray-300">{order.courier}</span>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-5">
                <div className="md:col-span-2 space-y-3 text-[11px]">
                  <div>
                    <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">Delivery Address</p>
                    <p className="text-gray-300 leading-relaxed">{order.delivery_address}</p>
                  </div>

                  {order.tracking_booking_details && (
                    <div>
                      <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">
                        Tracking / Booking
                      </p>
                      <p className="text-gray-300">{order.tracking_booking_details}</p>
                    </div>
                  )}
                </div>

                {/* Money breakdown */}
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-gray-500 uppercase tracking-widest text-[9px]">Total</span>
                    <span className="text-white">₱{Number(order.total_amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 uppercase tracking-widest text-[9px]">Down Payment</span>
                    <span className="text-[#E9C46A]">₱{Number(order.dp_amount).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 uppercase tracking-widest text-[9px]">Balance</span>
                    <span className="text-white">₱{Number(order.balance_amount).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Proof + actions */}
              <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-gray-800">
                {/* DP proof */}
                {order.dp_proof_url ? (
                  <button
                    onClick={() => setPreviewUrl(order.dp_proof_url)}
                    className="text-[10px] uppercase tracking-widest text-gray-400 hover:text-[#E9C46A] border-white/10 hover:border-[#E9C46A]/40 px-3 py-2 rounded-lg transition"
                  >
                    View DP Proof
                  </button>
                ) : (
                  <span className="text-[10px] uppercase tracking-widest text-gray-600">No DP Proof</span>
                )}

                {/* Step 1 */}
                {order.payment_status === 'pending' && (
                  <>
                    <button
                      onClick={() => handleApproveDp(order)}
                      disabled={busyId === order.id}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-black bg-[#E9C46A] hover:bg-[#D4A94F] px-4 py-2 rounded-lg transition disabled:opacity-50"
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
                  <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-black bg-[#E9C46A] hover:bg-[#D4A94F] px-4 py-2 rounded-lg transition cursor-pointer disabled:opacity-50">
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
                      className="flex-1 min-w-[220px] bg-black/40 border-white/10 rounded-lg px-3 py-2 text-[11px] focus:border-[#E9C46A] outline-none transition"
                    />
                    <button
                      onClick={() => handleMarkShipped(order)}
                      disabled={busyId === order.id}
                      className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-black bg-[#E9C46A] hover:bg-[#D4A94F] px-4 py-2 rounded-lg transition disabled:opacity-50"
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

              <p className="text-[9px] text-gray-600 mt-3 flex items-center gap-1.5">
                <Clock size={11} />
                Placed {new Date(order.created_at).toLocaleString()}
                {order.dp_submitted_at && (
                  <span className="text-gray-700">
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
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6"
        >
          <div className="relative max-w-2xl w-full">
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-10 right-0 text-gray-400 hover:text-white transition"
            >
              <X size={22} />
            </button>
            <img
              src={previewUrl}
              alt="Down payment proof"
              className="w-full rounded-xl border-[#E9C46A]/30"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default OrdersTab;

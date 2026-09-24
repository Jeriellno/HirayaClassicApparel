import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Loader2,
    Package,
    Truck,
    CheckCircle2,
    Clock,
    ShoppingBag,
    AlertTriangle,
    Upload,
    RotateCw,
} from 'lucide-react';
import api from '../../api/axios';
import PaymentInstructions from '../common/PaymentInstructions';
import { getProductImageUrl } from '../../utils/imageHelper';

// Customer-facing labels for each backend payment status.
const PAYMENT_STEPS = {
    pending: { label: 'Down Payment Pending Verification', tone: 'cream' },
    '50_paid': { label: '50% Paid — Balance Due', tone: 'blue' },
    fully_paid: { label: 'Fully Paid', tone: 'emerald' },
    rejected: { label: 'Down Payment Rejected — Action Needed', tone: 'red' },
};

const ORDER_STATUS_LABELS = {
    pending: 'Pending',
    processing: 'Processing',
    ready_for_shipping: 'Ready for Shipping',
    shipped: 'Shipped',
};

const TONE_CLASSES = {
    cream: 'bg-[#E9C46A]/12 text-stone-200 border-stone-300/30',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    red: 'bg-red-500/15 text-red-400 border-red-500/30',
};

/**
 * Tab 2 of the customer dashboard: order history + the 2-step payment flow
 * (50% down payment verification, then balance settlement).
 *
 * Talks only to /orders — kept independent from the wishlist and cart APIs.
 */
const OrdersTab = () => {
    const navigate = useNavigate();
    const [orders, setOrders] = useState([]);
    const [fetching, setFetching] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');

    const fetchOrders = useCallback(async () => {
        setFetching(true);
        setError('');
        try {
            const res = await api.get('/orders');
            setOrders(Array.isArray(res.data) ? res.data : res.data?.data || []);
        } catch (err) {
            console.error('Error fetching orders:', err);
            setError('Failed to load your orders. Please refresh and try again.');
        } finally {
            setFetching(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    // Customer submits proof of the remaining balance.
    const handlePayBalance = async (order, file) => {
        if (!file) return;
        setBusyId(order.id);
        setError('');
        try {
            const payload = new FormData();
            payload.append('full_payment_proof_image', file);
            const res = await api.post(`/orders/${order.id}/pay-balance`, payload);
            setOrders((current) =>
                current.map((o) => (o.id === order.id ? res.data.order : o))
            );
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to submit balance payment.');
        } finally {
            setBusyId(null);
        }
    };

    // Recovery path: customer replaces a rejected down payment proof.
    const handleReuploadDp = async (order, file) => {
        if (!file) return;
        setBusyId(order.id);
        setError('');
        try {
            const payload = new FormData();
            payload.append('dp_proof_image', file);
            const res = await api.post(`/orders/${order.id}/reupload-dp`, payload);
            setOrders((current) =>
                current.map((o) => (o.id === order.id ? res.data.order : o))
            );
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to re-submit your down payment proof.');
        } finally {
            setBusyId(null);
        }
    };

    if (fetching) {
        return (
            <div className="py-24 text-center text-[#E9C46A] text-xs uppercase tracking-[0.4em] animate-pulse">
                Fetching Orders...
            </div>
        );
    }

    return (
        <div>
            <div className="mb-6 flex-wrap items-center justify-between gap-3">
                <p className="text-[10px] text-gray-400 uppercase tracking-widest">
                    {orders.length} order{orders.length !== 1 ? 's' : ''} · Track delivery & settle your balance
                </p>
                <button
                    onClick={fetchOrders}
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-400 hover:text-[#E9C46A] transition"
                >
                    <RotateCw size={12} /> Refresh
                </button>
            </div>

            {error && (
                <div className="mb-6 text-[11px] text-red-400 bg-red-500/10 border-red-500/30 rounded-lg px-4 py-3">
                    {error}
                </div>
            )}

            {orders.length === 0 ? (
                <div className="text-center py-24 border-white/10 rounded-2xl bg-white/[0.02]">
                    <ShoppingBag className="w-10 h-10 text-gray-700 mx-auto mb-4" />
                    <p className="text-xs text-gray-500 tracking-widest uppercase">No orders placed yet.</p>
                    <button
                        onClick={() => navigate('/shop')}
                        className="mt-8 px-8 py-3 bg-[#E9C46A] text-black text-[10px] font-black uppercase tracking-[0.2em] rounded-lg hover:bg-[#D4A94F] transition"
                    >
                        Browse the Shop
                    </button>
                </div>
            ) : (
                <div className="space-y-5">
                    {orders.map((order) => {
                        const step = PAYMENT_STEPS[order.payment_status] || {
                            label: order.payment_status,
                            tone: 'cream',
                        };

                        return (
                            <div key={order.id} className="bg-white/[0.03] border-white/10 rounded-2xl p-5 md:p-6">
                                {/* Header */}
                                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-white/10">
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-xs font-bold uppercase tracking-widest">
                                            Order #{order.id}
                                        </span>
                                        <span
                                            className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${TONE_CLASSES[step.tone]}`}
                                        >
                                            {step.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-gray-400">
                                        <Truck size={13} className="text-[#E9C46A]" />
                                        {order.courier}
                                    </div>
                                </div>

                                {/* Line items (empty for legacy orders) */}
                                {Array.isArray(order.order_items) && order.order_items.length > 0 && (
                                    <div className="py-4 border-b border-white/10 space-y-3">
                                        {order.order_items.map((line) => (
                                            <div key={line.id} className="flex items-center gap-3">
                                                <div className="w-11 h-14 rounded-lg overflow-hidden bg-black/40 border-white/10 shrink-0">
                                                    <img
                                                        src={getProductImageUrl(
                                                            // The AI cut-out on the HIRAYA frame, matching
                                                            // what the customer saw when they added it.
                                                            line.product?.display_image_url
                                                            || line.product?.image_url
                                                            || line.product?.image
                                                        )}
                                                        alt={line.product_name_snapshot || 'Item'}
                                                        className="w-full h-full object-cover"
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[11px] text-gray-200 truncate">
                                                        {line.product_name_snapshot || `Product #${line.product_id}`}
                                                    </p>
                                                    <p className="text-[9px] uppercase tracking-widest text-gray-500 mt-0.5">
                                                        {line.selected_size} · {line.selected_color} · ×{line.quantity}
                                                    </p>
                                                </div>
                                                <span className="text-[11px] text-gray-400 shrink-0">
                                                    ₱{Number(line.line_total).toFixed(2)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Details */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-5 text-[11px]">
                                    <div className="md:col-span-2 space-y-3">
                                        <div>
                                            <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">
                                                Delivering To
                                            </p>
                                            <p className="text-gray-300 leading-relaxed">
                                                {order.customer_name} · {order.contact_number}
                                                <br />
                                                {order.delivery_address}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">
                                                Order Status
                                            </p>
                                            <p className="text-gray-300">
                                                {ORDER_STATUS_LABELS[order.order_status] || order.order_status}
                                            </p>
                                        </div>
                                        {order.tracking_booking_details && (
                                            <div>
                                                <p className="text-[9px] uppercase tracking-widest text-gray-500 mb-1">
                                                    Tracking / Booking
                                                </p>
                                                <p className="text-[#E9C46A]">{order.tracking_booking_details}</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-gray-500 uppercase tracking-widest text-[9px]">Total</span>
                                            <span>₱{Number(order.total_amount).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500 uppercase tracking-widest text-[9px]">
                                                Down Payment
                                            </span>
                                            <span className="text-[#E9C46A]">₱{Number(order.dp_amount).toFixed(2)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-500 uppercase tracking-widest text-[9px]">Balance</span>
                                            <span>
                                                {order.payment_status === 'fully_paid'
                                                    ? '—'
                                                    : `₱${Number(order.balance_amount).toFixed(2)}`}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Status-specific action / message */}
                                <div className="pt-4 border-t border-white/10">
                                    {order.payment_status === 'pending' && (
                                        <p className="flex items-center gap-2 text-[11px] text-stone-200/90">
                                            <Clock size={13} />
                                            We are verifying your 50% down payment. Orders placed before 3:00 PM are
                                            processed the same day.
                                        </p>
                                    )}

                                    {order.payment_status === 'rejected' && (
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-2 text-[11px] text-red-400 bg-red-500/10 border-red-500/30 rounded-lg px-4 py-3">
                                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                                <span>
                                                    We could not verify your down payment.
                                                    {order.rejection_reason && (
                                                        <>
                                                            {' '}
                                                            Reason:{' '}
                                                            <strong className="text-red-300">{order.rejection_reason}</strong>
                                                        </>
                                                    )}{' '}
                                                    Please re-upload a clear photo of your receipt below.
                                                </span>
                                            </div>

                                            <PaymentInstructions amount={order.dp_amount} amountLabel="Down payment" />

                                            <label className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-black bg-[#E9C46A] hover:bg-[#D4A94F] px-4 py-2 rounded-lg transition cursor-pointer">
                                                {busyId === order.id ? (
                                                    <Loader2 size={13} className="animate-spin" />
                                                ) : (
                                                    <Upload size={13} />
                                                )}
                                                Re-upload DP Proof
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    className="hidden"
                                                    onChange={(e) => handleReuploadDp(order, e.target.files?.[0])}
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {order.payment_status === '50_paid' && (
                                        <div className="space-y-3">
                                            <div className="flex flex-wrap items-center gap-3">
                                                <p className="text-[11px] text-gray-300 mr-auto">
                                                    Your down payment is confirmed. Settle the{' '}
                                                    <span className="text-[#E9C46A] font-bold">
                                                        ₱{Number(order.balance_amount).toFixed(2)}
                                                    </span>{' '}
                                                    balance to proceed with shipping.
                                                </p>
                                                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-black bg-[#E9C46A] hover:bg-[#D4A94F] px-4 py-2 rounded-lg transition cursor-pointer">
                                                    {busyId === order.id ? (
                                                        <Loader2 size={13} className="animate-spin" />
                                                    ) : (
                                                        <CheckCircle2 size={13} />
                                                    )}
                                                    Pay Balance
                                                    <input
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => handlePayBalance(order, e.target.files?.[0])}
                                                    />
                                                </label>
                                            </div>

                                            {order.balance_proof_submitted_at ? (
                                                <p className="flex items-center gap-2 text-[11px] text-stone-200/90">
                                                    <Clock size={13} />
                                                    Balance proof submitted. We are verifying it — you can re-upload if
                                                    you sent the wrong file.
                                                </p>
                                            ) : (
                                                <PaymentInstructions
                                                    amount={order.balance_amount}
                                                    amountLabel="Balance due"
                                                />
                                            )}
                                        </div>
                                    )}

                                    {order.payment_status === 'fully_paid' && order.order_status !== 'shipped' && (
                                        <p className="flex items-center gap-2 text-[11px] text-blue-400">
                                            <Package size={13} />
                                            Payment complete. Your order is being prepared for shipment.
                                        </p>
                                    )}

                                    {order.order_status === 'shipped' && (
                                        <p className="flex items-center gap-2 text-[11px] text-emerald-400">
                                            <CheckCircle2 size={13} />
                                            Your order has been shipped.
                                        </p>
                                    )}
                                </div>

                                <p className="text-[9px] text-gray-600 mt-3">
                                    Placed {new Date(order.created_at).toLocaleString()}
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
    Star,
} from 'lucide-react';
import api from '../../api/axios';
import Currency from '../common/Currency';
import PaymentInstructions from '../common/PaymentInstructions';
import ReviewProductModal from './ReviewProductModal';
import { getProductImageUrl } from '../../utils/imageHelper';
import { themeSurfaceFor } from '../../utils/framePresets';
import { productForColor } from '../../utils/productVariant';

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
    delivered: 'Delivered',
    rejected: 'Rejected',
};

const TONE_CLASSES = {
    cream: 'bg-hiraya-accent-wash text-hiraya-accent border-hiraya-accent/35',
    // "Balance due" — a navy tint of the palette, not an off-palette blue.
    blue: 'bg-navy-100 text-navy-800 border-navy-300/70',
    emerald: 'bg-emerald-500/15 text-emerald-700 border-emerald-600/35',
    red: 'bg-red-500/15 text-red-700 border-red-600/40',
};

/**
 * Tab 2 of the customer dashboard: order history + the 2-step payment flow
 * (50% down payment verification, then balance settlement).
 *
 * Talks only to /orders — kept independent from the wishlist and cart APIs.
 */
const OrdersTab = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [orders, setOrders] = useState([]);
    const [fetching, setFetching] = useState(true);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');

    // Review flow: "All" vs "Delivered" view, the line being reviewed, and the
    // order opened from a notification (?order=4).
    const [view, setView] = useState('all');
    const [reviewLine, setReviewLine] = useState(null);
    const focusOrderId = Number(searchParams.get('order')) || null;
    const focusedRef = useRef(null);

    // The customer's own reviews, keyed by order line, decide each button's state.
    const reviewsQuery = useQuery({
        queryKey: ['my-reviews'],
        queryFn: async () => {
            const res = await api.get('/reviews/mine');
            return Array.isArray(res.data?.reviews) ? res.data.reviews : [];
        },
        staleTime: 60 * 1000,
    });
    const reviewByItem = useMemo(
        () => new Map((reviewsQuery.data || []).map((r) => [r.order_item_id, r])),
        [reviewsQuery.data]
    );

    const deliveredCount = orders.filter((o) => o.order_status === 'delivered').length;
    const visibleOrders = view === 'delivered' ? orders.filter((o) => o.order_status === 'delivered') : orders;

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

    // Re-fetches when a notification deep-links a different order, so a status
    // that just changed to Delivered shows up even if this page was already open.
    useEffect(() => {
        fetchOrders();
    }, [fetchOrders, focusOrderId]);

    // Opened from a notification: bring that exact order into view.
    useEffect(() => {
        if (!fetching && focusOrderId && focusedRef.current) {
            focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [fetching, focusOrderId]);

    // Payment reference numbers typed per order, before the receipt is picked.
    const [refDrafts, setRefDrafts] = useState({});
    const refFor = (order) => (refDrafts[order.id] || '').trim();

    // The file picker submits immediately, so the reference must be in first.
    const requireReference = (order, input, file) => {
        if (file && (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024)) {
            setError('The receipt must be a PNG, JPG or WEBP image under 5 MB.');
            if (input) input.value = '';
            return false;
        }
        if (refFor(order).length >= 4) return true;
        setError('Enter the reference number from your GCash or bank receipt before uploading it.');
        if (input) input.value = '';
        return false;
    };

    const referenceField = (order) => (
        <div className="max-w-sm">
            <label
                htmlFor={`payment-ref-${order.id}`}
                className="mb-1.5 block text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted"
            >
                Payment Reference Number
            </label>
            <input
                id={`payment-ref-${order.id}`}
                type="text"
                value={refDrafts[order.id] || ''}
                onChange={(e) => setRefDrafts((current) => ({ ...current, [order.id]: e.target.value }))}
                minLength={4}
                maxLength={64}
                autoComplete="off"
                className="field text-xs"
                placeholder="e.g. GCash Ref. No. 1234 567 890123"
            />
        </div>
    );

    // Customer submits proof of the remaining balance.
    const handlePayBalance = async (order, file, input) => {
        if (!file || !requireReference(order, input, file)) return;
        setBusyId(order.id);
        setError('');
        try {
            const payload = new FormData();
            payload.append('full_payment_proof_image', file);
            payload.append('balance_reference_number', refFor(order));
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
    const handleReuploadDp = async (order, file, input) => {
        if (!file || !requireReference(order, input, file)) return;
        setBusyId(order.id);
        setError('');
        try {
            const payload = new FormData();
            payload.append('dp_proof_image', file);
            payload.append('dp_reference_number', refFor(order));
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
            <div className="animate-pulse py-24 text-center text-xs uppercase tracking-[0.3em] text-hiraya-ink-muted">
                Fetching Orders...
            </div>
        );
    }

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                    {orders.length} order{orders.length !== 1 ? 's' : ''} · Track delivery &amp; settle your balance
                </p>
                <div className="flex items-center gap-2">
                    {/* All / Delivered — delivered orders are where reviews live. */}
                    <div className="inline-flex rounded-full bg-cream-200/70 p-1 shadow-neu-inset" role="tablist" aria-label="Filter orders">
                        {[
                            { key: 'all', label: 'All Orders' },
                            { key: 'delivered', label: `Delivered${deliveredCount ? ` (${deliveredCount})` : ''}` },
                        ].map((tab) => (
                            <button
                                key={tab.key}
                                role="tab"
                                aria-selected={view === tab.key}
                                onClick={() => setView(tab.key)}
                                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus ${
                                    view === tab.key
                                        ? 'bg-cream-50 text-hiraya-ink shadow-neu-sm'
                                        : 'text-hiraya-ink-muted hover:text-hiraya-ink'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={fetchOrders}
                        className="btn-quiet cursor-pointer"
                    >
                        <RotateCw size={12} /> Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-6 rounded-xl border border-red-600/40 bg-red-500/12 px-4 py-3 text-[11px] text-red-700">
                    {error}
                </div>
            )}

            {orders.length === 0 ? (
                <div className="card-raised py-24 text-center">
                    <span className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-cream-100 shadow-neu ring-1 ring-cream-50">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-navy-900 text-cream-100">
                            <ShoppingBag className="h-5 w-5" />
                        </span>
                    </span>
                    <p className="text-xs uppercase tracking-[0.16em] text-hiraya-ink-muted">No orders placed yet.</p>
                    <button
                        onClick={() => navigate('/shop')}
                        className="btn-primary mt-8 cursor-pointer rounded-full"
                    >
                        Browse the Shop
                    </button>
                </div>
            ) : visibleOrders.length === 0 ? (
                <div className="card-raised py-16 text-center">
                    <p className="text-xs uppercase tracking-[0.16em] text-hiraya-ink-muted">
                        No delivered orders yet.
                    </p>
                </div>
            ) : (
                <div className="space-y-5">
                    {visibleOrders.map((order) => {
                        const step = PAYMENT_STEPS[order.payment_status] || {
                            label: order.payment_status,
                            tone: 'cream',
                        };
                        const isDelivered = order.order_status === 'delivered';
                        const isFocused = order.id === focusOrderId;

                        return (
                            <div
                                key={order.id}
                                ref={isFocused ? focusedRef : undefined}
                                className={`card-raised scroll-mt-28 rounded-[24px] p-5 md:p-7 ${isFocused ? 'ring-2 ring-hiraya-accent/60' : ''}`}
                            >
                                {/* Header */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hiraya-structure-line pb-4">
                                    <div className="flex flex-wrap items-center gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
                                            Order #{order.id}
                                        </span>
                                        <span
                                            className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${TONE_CLASSES[step.tone]}`}
                                        >
                                            {step.label}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                        <Truck size={13} />
                                        {order.courier}
                                    </div>
                                </div>

                                {/* Line items (empty for legacy orders) */}
                                {Array.isArray(order.order_items) && order.order_items.length > 0 && (
                                    <div className="space-y-3 border-b border-hiraya-structure-line py-4">
                                        {order.order_items.map((line) => (
                                            <div key={line.id} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                                                <div
                                                    className="h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-black shadow-[0_8px_16px_-10px_rgba(0,0,0,0.8)]"
                                                    // Matches the product's background theme (black for legacy cards).
                                                    style={{ backgroundColor: themeSurfaceFor(line.product) }}
                                                >
                                                    {/*
                                                     * THE PRODUCT TILE IS THE OBSIDIAN FRAME.
                                                     * The catalog image is a finished card cut
                                                     * out on black, so `object-cover` inside a
                                                     * cream well cropped the frame and showed
                                                     * black bars; `object-contain` on a black
                                                     * well shows the whole card invisibly.
                                                     */}
                                                    <img
                                                        src={getProductImageUrl(
                                                            // The AI cut-out on the HIRAYA frame, matching
                                                            // what the customer saw when they added it.
                                                            productForColor(line.product, line.selected_color)?.display_image_url
                                                            || line.product?.image_url
                                                            || line.product?.image
                                                        )}
                                                        alt={line.product_name_snapshot || 'Item'}
                                                        className="h-full w-full object-contain"
                                                    />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-[11px] text-hiraya-ink">
                                                        {line.product_name_snapshot || `Product #${line.product_id}`}
                                                    </p>
                                                    <p className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                        {line.selected_size} · {line.selected_color} · ×{line.quantity}
                                                    </p>
                                                </div>
                                                {/*
                                                 * THE PESO GOES THROUGH <Currency>.
                                                 * This line (and three more below) hard-coded
                                                 * `` as a literal that the file had stored as a
                                                 * mojibake pair, so every order total, DP and
                                                 * balance in My Orders printed two junk glyphs
                                                 * where the sign belongs.
                                                 */}
                                                <Currency
                                                    amount={line.line_total}
                                                    className="shrink-0 text-[11px] text-hiraya-ink"
                                                />

                                                {/* One review per delivered line; never shown before delivery. */}
                                                {isDelivered && line.product_id && (
                                                    reviewByItem.has(line.id) ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setReviewLine(line)}
                                                            className="btn-quiet ml-auto shrink-0 cursor-pointer sm:ml-0"
                                                        >
                                                            <CheckCircle2 size={12} className="text-emerald-700" /> View Review
                                                        </button>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => setReviewLine(line)}
                                                            disabled={reviewsQuery.isLoading}
                                                            className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-3.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent transition-colors hover:bg-hiraya-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus disabled:cursor-wait disabled:opacity-60 sm:ml-0"
                                                        >
                                                            <Star size={11} /> Review Product
                                                        </button>
                                                    )
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Details */}
                                <div className="grid grid-cols-1 gap-6 py-5 text-[11px] md:grid-cols-3">
                                    <div className="space-y-3 md:col-span-2">
                                        <div>
                                            <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                Delivering To
                                            </p>
                                            <p className="leading-relaxed text-hiraya-ink">
                                                {order.customer_name} · {order.contact_number}
                                                <br />
                                                {order.delivery_address}
                                            </p>
                                        </div>
                                        <div>
                                            <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                Order Status
                                            </p>
                                            <p className="text-hiraya-ink">
                                                {ORDER_STATUS_LABELS[order.order_status] || order.order_status}
                                            </p>
                                        </div>
                                        {order.tracking_booking_details && (
                                            <div>
                                                <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                    Tracking / Booking
                                                </p>
                                                <p className="text-hiraya-ink">{order.tracking_booking_details}</p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">Total</span>
                                            <Currency amount={order.total_amount} />
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                Down Payment
                                            </span>
                                            <Currency amount={order.dp_amount} className="text-hiraya-ink" />
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">Balance</span>
                                            {order.payment_status === 'fully_paid' ? (
                                                <span>—</span>
                                            ) : (
                                                <Currency amount={order.balance_amount} />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Status-specific action / message */}
                                <div className="border-t border-hiraya-structure-line pt-4">
                                    {order.payment_status === 'pending' && (
                                        <p className="flex items-center gap-2 text-[11px] text-hiraya-ink-soft">
                                            <Clock size={13} className="shrink-0 text-hiraya-accent" />
                                            We are verifying your 50% down payment
                                            {order.dp_reference_number && ` (ref. ${order.dp_reference_number})`}. Orders
                                            placed before 3:00 PM are processed the same day.
                                        </p>
                                    )}

                                    {order.payment_status === 'rejected' && (
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-2 rounded-xl border border-red-600/40 bg-red-500/12 px-4 py-3 text-[11px] text-red-700">
                                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                                <span>
                                                    We could not verify your down payment.
                                                    {order.rejection_reason && (
                                                        <>
                                                            {' '}
                                                            Reason:{' '}
                                                            <strong className="text-red-700">{order.rejection_reason}</strong>
                                                        </>
                                                    )}{' '}
                                                    Please re-upload a clear photo of your receipt below.
                                                </span>
                                            </div>

                                            <PaymentInstructions amount={order.dp_amount} amountLabel="Down payment" />

                                            {referenceField(order)}

                                            {/*
                                             * THE RE-UPLOAD CONTROL IS A STYLED FILE LABEL.
                                             *
                                             * It has to stay a `<label>` wrapping a visually
                                             * hidden `<input type="file">` — replacing it with
                                             * a button plus a ref would change how the control
                                             * is picked up by assistive tech and by the mobile
                                             * picker. Only the paint moved onto tokens.
                                             */}
                                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent shadow-[0_10px_20px_-12px_rgba(21,32,54,0.8)] transition-colors hover:bg-hiraya-accent-deep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hiraya-focus has-[:focus-visible]:ring-offset-2">
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
                                                    onChange={(e) => handleReuploadDp(order, e.target.files?.[0], e.target)}
                                                />
                                            </label>
                                        </div>
                                    )}

                                    {order.payment_status === '50_paid' && (
                                        <div className="space-y-3">
                                            <p className="text-[11px] text-hiraya-ink-soft">
                                                Your down payment is confirmed. Settle the{' '}
                                                <Currency amount={order.balance_amount} className="font-semibold text-hiraya-ink" />{' '}
                                                balance to proceed with shipping.
                                            </p>

                                            {order.balance_proof_submitted_at ? (
                                                <p className="flex items-center gap-2 text-[11px] text-hiraya-ink-soft">
                                                    <Clock size={13} className="shrink-0 text-hiraya-accent" />
                                                    Balance proof submitted
                                                    {order.balance_reference_number && ` (ref. ${order.balance_reference_number})`}. We
                                                    are verifying it — you can re-upload if you sent the wrong file.
                                                </p>
                                            ) : (
                                                <PaymentInstructions
                                                    amount={order.balance_amount}
                                                    amountLabel="Balance due"
                                                />
                                            )}

                                            <div className="flex flex-wrap items-end gap-3">
                                                {referenceField(order)}
                                                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent shadow-[0_10px_20px_-12px_rgba(21,32,54,0.8)] transition-colors hover:bg-hiraya-accent-deep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hiraya-focus has-[:focus-visible]:ring-offset-2">
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
                                                        onChange={(e) => handlePayBalance(order, e.target.files?.[0], e.target)}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    )}

                                    {order.payment_status === 'fully_paid' && !['shipped', 'delivered', 'rejected'].includes(order.order_status) && (
                                        <p className="flex items-center gap-2 text-[11px] text-navy-700">
                                            <Package size={13} className="shrink-0" />
                                            Payment complete. Your order is being prepared for shipment.
                                        </p>
                                    )}

                                    {order.order_status === 'shipped' && (
                                        <p className="flex items-center gap-2 text-[11px] text-emerald-700">
                                            <CheckCircle2 size={13} className="shrink-0" />
                                            Your order has been shipped.
                                        </p>
                                    )}

                                    {order.order_status === 'delivered' && (
                                        <p className="flex items-center gap-2 text-[11px] text-emerald-700">
                                            <CheckCircle2 size={13} className="shrink-0" />
                                            Your order has been delivered. You can now review the products you received.
                                        </p>
                                    )}

                                    {order.order_status === 'rejected' && (
                                        <p className="flex items-center gap-2 text-[11px] text-red-700">
                                            <AlertTriangle size={13} className="shrink-0" />
                                            This order was rejected. Please contact Hiraya support for help.
                                        </p>
                                    )}
                                </div>

                                <p className="mt-3 text-[9px] text-hiraya-ink-muted">
                                    Placed {new Date(order.created_at).toLocaleString()}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {reviewLine && (
                <ReviewProductModal
                    line={reviewLine}
                    existingReview={reviewByItem.get(reviewLine.id) || null}
                    onClose={() => setReviewLine(null)}
                />
            )}
        </div>
    );
};

export default OrdersTab;

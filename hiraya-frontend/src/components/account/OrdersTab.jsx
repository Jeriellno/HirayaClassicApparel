import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    Loader2,
    Package,
    CheckCircle2,
    Clock,
    ShoppingBag,
    AlertTriangle,
    Upload,
    RotateCw,
    Star,
    ChevronDown,
} from 'lucide-react';
import api from '../../api/axios';
import Currency from '../common/Currency';
import PaymentInstructions from '../common/PaymentInstructions';
import LalamoveBookingForm from './LalamoveBookingForm';
import OrderTracker from '../common/OrderTracker';
import { RECONNECTED_EVENT } from '../common/ConnectionWatcher';
import { describeProcessingDate } from '../../utils/orderPolicy';
import ReviewProductModal from './ReviewProductModal';
import { getProductImageUrl } from '../../utils/imageHelper';
import { themeSurfaceFor } from '../../utils/framePresets';
import { productForColor } from '../../utils/productVariant';
import { useT } from '../../context/PreferencesContext';

// Customer-facing labels for each backend payment status (one full payment;
// '50_paid' only appears on historical 50/50 orders). Labels are i18n keys.
const PAYMENT_STEPS = {
    pending: { label: 'payment.pending', tone: 'cream' },
    needs_review: { label: 'payment.needsReview', tone: 'cream' },
    '50_paid': { label: 'payment.legacyBalanceDue', tone: 'blue' },
    fully_paid: { label: 'payment.verified', tone: 'emerald' },
    rejected: { label: 'payment.failed', tone: 'red' },
};

/*
 * ORDER LINE IMAGE — tries the colour's catalogue card, then the product's
 * own image, then the placeholder, so a missing or moved file never leaves a
 * broken image on mobile or desktop.
 */
const OrderLineImage = ({ line, className = '' }) => {
    const candidates = useMemo(() => {
        const product = productForColor(line.product, line.selected_color);
        return [product?.display_image_url, product?.image_url, line.product?.display_image_url, line.product?.image_url, line.product?.image]
            .filter(Boolean)
            .map((src) => getProductImageUrl(src))
            .filter((src, i, all) => all.indexOf(src) === i)
            .concat(getProductImageUrl(null));
    }, [line]);
    const [index, setIndex] = useState(0);

    return (
        <div
            className={`shrink-0 overflow-hidden rounded-xl bg-black shadow-[0_8px_16px_-10px_rgba(0,0,0,0.8)] ${className}`}
            // Matches the product's background theme (black for legacy cards).
            style={{ backgroundColor: themeSurfaceFor(line.product) }}
        >
            <img
                src={candidates[Math.min(index, candidates.length - 1)]}
                onError={() => setIndex((i) => (i < candidates.length - 1 ? i + 1 : i))}
                alt={line.product_name_snapshot || 'Item'}
                loading="lazy"
                decoding="async"
                className="block h-full w-full object-contain"
            />
        </div>
    );
};

OrderLineImage.propTypes = {
    line: PropTypes.object.isRequired,
    className: PropTypes.string,
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
 * Tab 2 of the customer dashboard: order history. Every order is ONE full
 * payment that the store verifies against its own records; historical 50/50
 * orders keep their balance step so they can still be completed.
 *
 * Orders start as COMPACT rows (thumbnail, number, status, date, total); a
 * row opens to the full details.
 *
 * Talks only to /orders — kept independent from the wishlist and cart APIs.
 */
const OrdersTab = () => {
    const t = useT();
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
    // The order-experience rating the customer already gave, keyed by order.
    const feedbackQuery = useQuery({
        queryKey: ['my-feedback'],
        queryFn: async () => {
            const res = await api.get('/feedback/mine');
            return Array.isArray(res.data?.feedback) ? res.data.feedback : [];
        },
        staleTime: 60 * 1000,
    });
    const feedbackByOrder = useMemo(
        () => new Map((feedbackQuery.data || []).filter((f) => f.order_id).map((f) => [Number(f.order_id), f])),
        [feedbackQuery.data]
    );

    // Which order cards are open. Collapsed rows by default; tap a row to open it.
    const [expanded, setExpanded] = useState(() => new Set(focusOrderId ? [focusOrderId] : []));
    const toggleOrder = (id) => setExpanded((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    useEffect(() => {
        if (focusOrderId) setExpanded((current) => new Set(current).add(focusOrderId));
    }, [focusOrderId]);

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
            // One quiet retry: a slow or briefly dropped connection should not
            // leave the customer staring at "Failed to load your orders".
            let res;
            try {
                res = await api.get('/orders');
            } catch (firstError) {
                if (firstError?.response) throw firstError;
                res = await api.get('/orders');
            }
            setOrders(Array.isArray(res.data) ? res.data : res.data?.data || []);
        } catch (err) {
            console.error('Error fetching orders:', err);
            setError('Failed to load your orders. Please refresh and try again.');
        } finally {
            setFetching(false);
        }
    }, []);

    // Reload by itself when the connection comes back after an outage.
    useEffect(() => {
        window.addEventListener(RECONNECTED_EVENT, fetchOrders);
        return () => window.removeEventListener(RECONNECTED_EVENT, fetchOrders);
    }, [fetchOrders]);

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

    // The receipt must be a real image the server will accept.
    const validReceipt = (file, input) => {
        if (file && (!/^image\/(png|jpe?g|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024)) {
            setError(t('orders.receiptInvalid'));
            if (input) input.value = '';
            return false;
        }
        return Boolean(file);
    };

    // LEGACY 50/50 orders only: proof of the remaining balance.
    const handlePayBalance = async (order, file, input) => {
        if (!validReceipt(file, input)) return;
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

    // Recovery path: verification failed, the customer uploads the right receipt.
    const handleReuploadDp = async (order, file, input) => {
        if (!validReceipt(file, input)) return;
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
            setError(err.response?.data?.message || t('orders.reuploadFailed'));
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
                    {t('orders.count', { count: orders.length })}
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
                        const paidInFull = Number(order.balance_amount) <= 0;
                        const step = PAYMENT_STEPS[order.payment_status] || {
                            label: order.payment_status,
                            tone: 'cream',
                        };
                        const isDelivered = order.order_status === 'delivered';
                        const isFocused = order.id === focusOrderId;
                        const isOpen = expanded.has(order.id);
                        const lineCount = Array.isArray(order.order_items) ? order.order_items.length : 0;
                        const needsReview = isDelivered && lineCount > 0
                            && order.order_items.some((l) => l.product_id && !reviewByItem.has(l.id));

                        return (
                            <div
                                key={order.id}
                                ref={isFocused ? focusedRef : undefined}
                                className={`card-raised scroll-mt-28 rounded-[24px] p-5 md:p-7 ${isFocused ? 'ring-2 ring-hiraya-accent/60' : ''}`}
                            >
                                {/* Header — tap to open / close the order's details. */}
                                <button
                                    type="button"
                                    onClick={() => toggleOrder(order.id)}
                                    aria-expanded={isOpen}
                                    aria-controls={`order-details-${order.id}`}
                                    className={`flex w-full min-h-[44px] cursor-pointer items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus rounded-xl ${isOpen ? 'border-b border-hiraya-structure-line pb-4' : ''}`}
                                >
                                    {/* COMPACT ROW: thumbnail, number + status, item/date, total. */}
                                    {lineCount > 0 ? (
                                        <OrderLineImage line={order.order_items[0]} className="h-14 w-11 sm:h-16 sm:w-12" />
                                    ) : (
                                        <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-xl bg-cream-200/70 sm:h-16 sm:w-12">
                                            <Package size={16} className="text-hiraya-ink-muted" />
                                        </span>
                                    )}
                                    <span className="min-w-0 flex-1 space-y-1">
                                        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                                            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
                                                {t('orders.orderNo', { id: order.id })}
                                            </span>
                                            <span
                                                className={`rounded-full border px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${TONE_CLASSES[step.tone]}`}
                                            >
                                                {t(step.label)}
                                            </span>
                                        </span>
                                        <span className="block truncate text-[11px] text-hiraya-ink-muted">
                                            {lineCount > 0
                                                ? `${order.order_items[0].product_name_snapshot || 'Item'}${lineCount > 1 ? ` + ${lineCount - 1}` : ''}`
                                                : t('orders.order')}
                                            {' · '}
                                            {new Date(order.created_at).toLocaleDateString()}
                                            {' · '}
                                            <span className="uppercase">{order.courier}</span>
                                        </span>
                                        {needsReview && !isOpen && (
                                            <span className="inline-block rounded-full bg-hiraya-accent/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-hiraya-accent">
                                                {t('orders.reviewYourItems')}
                                            </span>
                                        )}
                                    </span>
                                    <span className="flex shrink-0 flex-col items-end gap-1">
                                        <Currency amount={order.total_amount} className="text-[12px] font-semibold text-hiraya-ink" />
                                        <ChevronDown size={16} className={`text-hiraya-ink transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                                    </span>
                                </button>

                                {isOpen && (
                                <div id={`order-details-${order.id}`}>
                                {/* Line items (empty for legacy orders) */}
                                {Array.isArray(order.order_items) && order.order_items.length > 0 && (
                                    <div className="space-y-3 border-b border-hiraya-structure-line py-4">
                                        {order.order_items.map((line) => (
                                            <div key={line.id} className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                                                <OrderLineImage line={line} className="h-16 w-12" />
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

                                                {/* A line whose product was removed from the shop has nothing to review. */}
                                                {isDelivered && !line.product_id && (
                                                    <span className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.14em] text-hiraya-ink-muted sm:ml-0">
                                                        No longer in the shop · can&apos;t be reviewed
                                                    </span>
                                                )}

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
                                            <p className="mb-2 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                Order Status · <span className="text-hiraya-ink">{ORDER_STATUS_LABELS[order.order_status] || order.order_status}</span>
                                            </p>
                                            <OrderTracker order={order} />
                                        </div>
                                        {order.processing_date && !['delivered', 'rejected'].includes(order.order_status) && (
                                            <div>
                                                <p className="mb-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                    Processing
                                                </p>
                                                <p className="text-hiraya-ink">
                                                    {describeProcessingDate(order.processing_date)}
                                                    {order.placed_after_cutoff && (
                                                        <span className="text-hiraya-ink-muted"> · placed after the daily cut-off</span>
                                                    )}
                                                </p>
                                            </div>
                                        )}
                                        {order.courier === 'lalamove' && order.payment_status === 'fully_paid'
                                            && !['rejected', 'delivered'].includes(order.order_status) ? (
                                            <LalamoveBookingForm
                                                order={order}
                                                onSaved={(updated) => setOrders((current) =>
                                                    current.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))}
                                            />
                                        ) : order.tracking_booking_details && (
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
                                            <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">{t('orders.total')}</span>
                                            <Currency amount={order.total_amount} />
                                        </div>
                                        {paidInFull ? (
                                            <div className="flex justify-between">
                                                <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">{t('orders.payment')}</span>
                                                <span className="text-hiraya-ink">{t('orders.fullPayment')}</span>
                                            </div>
                                        ) : (
                                            <>
                                                {/* Historical 50/50 order, shown as it was recorded. */}
                                                <div className="flex justify-between">
                                                    <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                                        {t('orders.legacyDownPayment')}
                                                    </span>
                                                    <Currency amount={order.dp_amount} className="text-hiraya-ink" />
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">{t('orders.balance')}</span>
                                                    {order.payment_status === 'fully_paid' ? (
                                                        <span>—</span>
                                                    ) : (
                                                        <Currency amount={order.balance_amount} />
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Status-specific action / message */}
                                <div className="border-t border-hiraya-structure-line pt-4">
                                    {['pending', 'needs_review'].includes(order.payment_status) && (
                                        <p className="flex items-center gap-2 text-[11px] text-hiraya-ink-soft">
                                            <Clock size={13} className="shrink-0 text-hiraya-accent" />
                                            {order.payment_status === 'needs_review' ? t('orders.underReviewMsg') : t('orders.verifyingMsg')}
                                        </p>
                                    )}

                                    {order.payment_status === 'rejected' && (
                                        <div className="space-y-3">
                                            <div className="flex items-start gap-2 rounded-xl border border-red-600/40 bg-red-500/12 px-4 py-3 text-[11px] text-red-700">
                                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                                <span>
                                                    {t('orders.failedMsg')}
                                                    {order.rejection_reason && (
                                                        <>
                                                            {' '}
                                                            Reason:{' '}
                                                            <strong className="text-red-700">{order.rejection_reason}</strong>
                                                        </>
                                                    )}{' '}
                                                    {t('orders.uploadCorrect')}
                                                </span>
                                            </div>

                                            <PaymentInstructions amount={order.dp_amount} amountLabel={paidInFull ? t('orders.fullPayment') : t('orders.legacyDownPayment')} />

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
                                                {t('orders.uploadReceipt')}
                                                <input
                                                    type="file"
                                                    accept="image/png,image/jpeg,image/webp"
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
                                                    Balance proof submitted. We are verifying it — you can re-upload if you sent the wrong file.
                                                </p>
                                            ) : (
                                                <PaymentInstructions
                                                    amount={order.balance_amount}
                                                    amountLabel="Balance due"
                                                />
                                            )}

                                            <div className="flex flex-wrap items-end gap-3">
                                                <label className="flex cursor-pointer items-center gap-2 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent shadow-[0_10px_20px_-12px_rgba(21,32,54,0.8)] transition-colors hover:bg-hiraya-accent-deep has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hiraya-focus has-[:focus-visible]:ring-offset-2">
                                                    {busyId === order.id ? (
                                                        <Loader2 size={13} className="animate-spin" />
                                                    ) : (
                                                        <CheckCircle2 size={13} />
                                                    )}
                                                    Pay Balance
                                                    <input
                                                        type="file"
                                                        accept="image/png,image/jpeg,image/webp"
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
                                            {t('orders.paidPreparing')}
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
                                            {t('orders.deliveredReview')}
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
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {reviewLine && (
                <ReviewProductModal
                    line={reviewLine}
                    existingReview={reviewByItem.get(reviewLine.id) || null}
                    orderFeedback={feedbackByOrder.get(Number(reviewLine.order_id)) || null}
                    onClose={() => setReviewLine(null)}
                />
            )}
        </div>
    );
};

export default OrdersTab;

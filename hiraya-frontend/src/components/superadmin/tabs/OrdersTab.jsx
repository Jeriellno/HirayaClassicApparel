import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  PlayCircle,
  Package,
  Search,
  Truck,
  Clock,
  X,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Hourglass,
  Loader2,
  Receipt,
  ShieldCheck,
  Ban,
  Save,
  ImageOff,
  ExternalLink,
  Check,
  Copy,
} from 'lucide-react';
import api from '../../../api/axios';
import useConfirm from '../../../hooks/useConfirm';
import { describeProcessingDate } from '../../../utils/orderPolicy';
import OrderTracker from '../../common/OrderTracker';

/**
 * SUPER ADMIN — ORDERS.
 *
 * The list is deliberately compact — order #, status, name, number and email —
 * so the super admin can scan many orders at once. Tapping a row opens a detail
 * sheet with everything about the order, the payment verification steps, the
 * courier tracking field and the status actions (Pending, Rejected, Shipped,
 * Delivered).
 *
 * PAYMENT VERIFICATION (manual GCash / bank transfer):
 *   1. The customer pays 50% and uploads the receipt + reference number at
 *      checkout. The admin checks the reference against the store's GCash/bank
 *      app, then Approves (-> 50% paid, processing) or Rejects with a reason
 *      (-> stock returned, customer asked to re-upload).
 *   2. The customer pays the balance and uploads that receipt + reference. The
 *      admin Confirms it (-> fully paid, ready for shipping).
 *
 * Every action goes through the existing `/admin/orders/{id}/...` endpoints,
 * which write the audit entry and notify the customer.
 */

/** Orders waiting on the admin to check a receipt. */
const needsVerification = (order) =>
  (order.payment_status === 'pending' && Boolean(order.dp_proof_image_path)) ||
  (order.payment_status === '50_paid' && Boolean(order.full_payment_proof_image_path));

const PAYMENT_STATUS = {
  pending: { label: 'DP Pending', className: 'bg-hiraya-accent/12 text-hiraya-ink border-hiraya-structure-line' },
  '50_paid': { label: '50% Paid', className: 'bg-navy-100 text-navy-800 border-navy-300/70' },
  fully_paid: { label: 'Fully Paid', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  rejected: { label: 'DP Rejected', className: 'bg-red-500/15 text-red-700 border-red-600/40' },
};

const ORDER_STATUS = {
  pending: { label: 'Pending', className: 'bg-hiraya-accent/12 text-hiraya-ink border-hiraya-structure-line' },
  processing: { label: 'Processing', className: 'bg-navy-100 text-navy-800 border-navy-300/70' },
  ready_for_shipping: { label: 'Ready for Shipping', className: 'bg-navy-100 text-navy-800 border-navy-300/70' },
  shipped: { label: 'Shipped', className: 'bg-sky-500/15 text-sky-800 border-sky-600/30' },
  delivered: { label: 'Delivered', className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  rejected: { label: 'Rejected', className: 'bg-red-500/15 text-red-700 border-red-600/40' },
};

// The four actions the super admin can apply from the detail sheet.
// `needsFullPayment` mirrors the server rule: nothing ships until fully paid.
const STATUS_ACTIONS = [
  { id: 'pending', label: 'Pending', icon: Hourglass, className: 'border-hiraya-structure-line text-hiraya-ink hover:bg-hiraya-accent/12' },
  { id: 'rejected', label: 'Cancel order', icon: XCircle, className: 'border-red-600/40 text-red-700 hover:bg-red-500/12' },
  { id: 'shipped', label: 'Shipped', icon: Truck, needsFullPayment: true, className: 'border-sky-600/35 text-sky-800 hover:bg-sky-500/12' },
  { id: 'delivered', label: 'Delivered', icon: CheckCircle2, needsFullPayment: true, className: 'border-emerald-600/35 text-emerald-700 hover:bg-emerald-500/12' },
];

// The forward-only order ladder the backend enforces (AdminOrderController::updateStatus).
const STATUS_LADDER = ['pending', 'processing', 'ready_for_shipping', 'shipped', 'delivered'];

/** Why a status button is unavailable for this order, or '' when it may be pressed. */
const statusBlockReason = (order, target) => {
  // Order Guidelines §5: a fully paid order is final.
  if (target === 'rejected') return order.payment_status === 'fully_paid' ? 'Fully paid orders are final' : '';
  if (STATUS_LADDER.indexOf(target) < STATUS_LADDER.indexOf(order.order_status)) {
    return 'Orders cannot move back to an earlier step';
  }
  if (['ready_for_shipping', 'shipped', 'delivered'].includes(target) && order.payment_status !== 'fully_paid') {
    return 'Confirm the full payment first';
  }
  if (target === 'delivered' && order.order_status !== 'shipped') return 'Mark it shipped first';
  return '';
};

// `₱` is the peso sign. Writing it as an escape keeps the file ASCII, so a
// wrong file encoding can never turn it into "â‚±" again.
const peso = (value) =>
  `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * What the customer has actually paid on an order: the full total once fully
 * paid, the 50% down payment once it is verified, nothing before that.
 */
const paidAmount = (order) => {
  if (order.payment_status === 'fully_paid') return Number(order.total_amount || 0);
  if (order.payment_status === '50_paid') return Number(order.dp_amount || 0);
  return 0;
};

/** "Today", "Tomorrow (after cut-off)", … from the backend's processing_date. */
const processingLabel = (order) => {
  if (!order.processing_date) return '—';
  return describeProcessingDate(order.processing_date) + (order.placed_after_cutoff ? ' (after cut-off)' : '');
};

/** Paid in full at checkout: the first receipt covers the whole order (no balance step). */
const paidInFull = (order) => Number(order.balance_amount) <= 0;

const isRejected = (order) => order.order_status === 'rejected' || order.payment_status === 'rejected';

const Chip = ({ meta, fallback }) => (
  <span
    className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${meta?.className || 'bg-cream-200/55 text-hiraya-ink border-hiraya-sand/40'
      }`}
  >
    {meta?.label || fallback}
  </span>
);

const DetailRow = ({ label, children }) => (
  <div>
    <p className="text-[9px] uppercase tracking-widest text-hiraya-sand mb-1">{label}</p>
    <div className="text-[12px] text-hiraya-ink leading-relaxed break-words">{children || '—'}</div>
  </div>
);

/**
 * A payment receipt, loaded through the admin-only proof endpoint (receipts are
 * not on a public URL), shown as a thumbnail that opens full size in a new tab.
 */
const ProofImage = ({ orderId, type, label }) => {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    api
      .get(`/admin/orders/${orderId}/proof/${type}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId, type]);

  if (failed) {
    return (
      <div className="flex h-36 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-hiraya-structure-line text-[10px] uppercase tracking-widest text-hiraya-sand">
        <ImageOff size={14} /> Receipt file not found
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex h-36 w-full items-center justify-center rounded-xl bg-navy-900/5">
        <Loader2 size={16} className="animate-spin text-hiraya-sand" />
      </div>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="group relative block overflow-hidden rounded-xl ring-1 ring-hiraya-structure-line"
      title="Open full size"
    >
      <img src={src} alt={label} className="h-36 w-full object-cover object-top" />
      <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-navy-900/75 px-2 py-1 text-[9px] uppercase tracking-widest text-cream-50 opacity-90 group-hover:opacity-100">
        <ExternalLink size={10} /> View
      </span>
    </a>
  );
};

/** One payment step: its receipt, reference number and submission time. */
const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      aria-label="Copy reference number"
      className="cursor-pointer rounded p-0.5 text-hiraya-sand hover:text-hiraya-ink"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
};

const PaymentStep = ({ order, type, title, amount, reference, submittedAt, hasProof, children }) => (
  <div className="rounded-2xl bg-navy-900/[0.03] p-4 ring-1 ring-hiraya-structure-line/70 space-y-3">
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-hiraya-ink">{title}</p>
      <span className="text-[12px] font-medium text-hiraya-ink">{peso(amount)}</span>
    </div>

    {hasProof ? (
      <ProofImage orderId={order.id} type={type} label={`${title} receipt for order #${order.id}`} />
    ) : (
      <div className="flex h-20 w-full items-center justify-center rounded-xl border border-dashed border-hiraya-structure-line text-[10px] uppercase tracking-widest text-hiraya-sand">
        No receipt uploaded yet
      </div>
    )}

    <div className="grid grid-cols-2 gap-3">
      <DetailRow label="Reference No.">
        {reference && (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono tracking-wide">{reference}</span>
            <CopyButton text={reference} />
          </span>
        )}
      </DetailRow>
      <DetailRow label="Submitted">{submittedAt && new Date(submittedAt).toLocaleString()}</DetailRow>
    </div>

    {hasProof && (reference ? (
      <p className="rounded-lg bg-hiraya-surface px-3 py-2 text-[10px] leading-relaxed text-hiraya-ink ring-1 ring-hiraya-structure-line/70">
        <strong>Before approving:</strong> open the store&apos;s GCash or bank app, search reference{' '}
        <span className="font-mono">{reference}</span>, and check that <strong>{peso(amount)}</strong> was received.
        A photo alone is not proof of payment.
      </p>
    ) : (
      <p className="rounded-lg bg-amber-500/12 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
        No reference number on this receipt. Ask the customer for it and match it in the store&apos;s GCash or bank app before approving.
      </p>
    ))}

    {children}
  </div>
);

const OrderDetailSheet = ({ order, onClose, onUpdated }) => {
  const [saving, setSaving] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [rejectingDp, setRejectingDp] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [tracking, setTracking] = useState(order.tracking_booking_details || '');

  /**
   * Runs one admin action against the order and merges the returned order in.
   * The payment endpoints return the order WITHOUT its user/items relations,
   * so it is merged onto the current one rather than replacing it.
   */
  const runAction = async (key, request, fallbackError) => {
    if (saving) return false;
    setSaving(key);
    setMessage({ type: '', text: '' });
    try {
      const res = await request();
      onUpdated(res.data?.order ? { ...order, ...res.data.order } : order);
      setMessage({ type: 'ok', text: res.data?.message || 'Saved. The customer has been notified.' });
      return true;
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.message || fallbackError });
      return false;
    } finally {
      setSaving('');
    }
  };

  const approveDp = () =>
    runAction('approve-dp', () => api.patch(`/admin/orders/${order.id}/approve-dp`), 'Failed to approve the down payment.');

  const rejectDp = async () => {
    if (!rejectReason.trim()) {
      setMessage({ type: 'warn', text: 'Give a reason so the customer knows what to fix.' });
      return;
    }
    const ok = await runAction(
      'reject-dp',
      () => api.patch(`/admin/orders/${order.id}/reject-dp`, { rejection_reason: rejectReason.trim() }),
      'Failed to reject the down payment.'
    );
    if (ok) {
      setRejectingDp(false);
      setRejectReason('');
    }
  };

  // DEMO ORDERS ONLY: stands in for the customer uploading the balance receipt.
  const simulateBalance = () =>
    runAction(
      'demo-balance',
      () => api.post(`/admin/orders/${order.id}/demo-balance`),
      'Could not simulate the balance payment.'
    );

  const confirmFullPayment = () =>
    runAction(
      'confirm-full',
      () => api.post(`/admin/orders/${order.id}/confirm-full-payment`),
      'Failed to confirm the full payment.'
    );

  const saveTracking = () => {
    if (!tracking.trim()) {
      setMessage({ type: 'warn', text: 'Enter the Lalamove booking details or LBC tracking number first.' });
      return;
    }
    runAction(
      'tracking',
      () => api.patch(`/admin/orders/${order.id}/tracking`, { tracking_booking_details: tracking.trim() }),
      'Failed to save the tracking details.'
    );
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const items = order.order_items || order.orderItems || [];
  const locked = order.order_status === 'rejected';

  const applyStatus = async (status) => {
    if (status === order.order_status || saving) return;

    // Rejecting returns the stock and cannot be undone, so it takes a second tap.
    if (status === 'rejected' && !confirmReject) {
      setConfirmReject(true);
      setMessage({ type: 'warn', text: 'Tap Cancel order again to confirm. This returns the stock, notifies the customer and cannot be undone.' });
      return;
    }

    setSaving(status);
    setMessage({ type: '', text: '' });
    try {
      const res = await api.patch(`/admin/orders/${order.id}/status`, { order_status: status });
      onUpdated(res.data?.order ? { ...order, ...res.data.order } : { ...order, order_status: status });
      setMessage({ type: 'ok', text: `Order marked as ${ORDER_STATUS[status]?.label || status}. The customer has been notified.` });
    } catch (err) {
      setMessage({ type: 'error', text: err?.response?.data?.message || 'Failed to update the order status.' });
    } finally {
      setSaving('');
      setConfirmReject(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <button
        type="button"
        aria-label="Close order details"
        onClick={onClose}
        className="absolute inset-0 bg-navy-900/45 backdrop-blur-sm cursor-default"
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-sheet-title"
        className="relative w-full sm:max-w-2xl max-h-[92vh] flex flex-col bg-hiraya-surface rounded-t-[26px] sm:rounded-[26px] shadow-neu ring-1 ring-cream-50/80 text-xs"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      >
        {/* HEADER */}
        <div className="flex items-start justify-between gap-4 p-5 border-b border-hiraya-structure-line/80">
          <div>
            <h3 id="order-sheet-title" className="font-serif text-xl uppercase tracking-[0.05em] text-navy-900">
              Order #{order.id}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <Chip meta={ORDER_STATUS[order.order_status]} fallback={order.order_status} />
              <Chip meta={PAYMENT_STATUS[order.payment_status]} fallback={order.payment_status} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-full text-hiraya-ink hover:bg-navy-900/5 transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* BODY */}
        <div className="overflow-y-auto p-5 space-y-6">
          <section>
            <p className="mb-3 text-[9px] uppercase tracking-widest text-hiraya-sand">Order progress</p>
            <OrderTracker order={order} />
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailRow label="Customer Name">{order.customer_name || order.user?.full_name}</DetailRow>
            <DetailRow label="Contact Number">{order.contact_number}</DetailRow>
            <DetailRow label="Email">{order.user?.email}</DetailRow>
            <DetailRow label="Courier">
              {order.courier && <span className="uppercase tracking-wider">{order.courier}</span>}
            </DetailRow>
            <DetailRow label="Processing">
              {processingLabel(order)}
            </DetailRow>
            <div className="sm:col-span-2">
              <DetailRow label="Delivery Address">{order.delivery_address}</DetailRow>
            </div>
            {order.rejection_reason && (
              <div className="sm:col-span-2">
                <DetailRow label="Rejection Reason">{order.rejection_reason}</DetailRow>
              </div>
            )}
          </section>

          {items.length > 0 && (
            <section className="border-t border-hiraya-structure-line/80 pt-4">
              <p className="mb-3 text-[9px] uppercase tracking-widest text-hiraya-sand">Items in this order</p>
              <div className="space-y-2">
                {items.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-navy-900/5 px-3 py-2 text-[11px]">
                    <div>
                      <p className="font-semibold text-hiraya-ink">{item.product_name_snapshot || item.product?.name || 'Product'}</p>
                      <p className="mt-0.5 text-[10px] text-hiraya-olive">
                        Size {item.selected_size || '—'} · {item.selected_color || '—'} · Qty {item.quantity}
                      </p>
                    </div>
                    <span className="text-hiraya-ink">
                      {peso(item.line_total ?? Number(item.unit_price || 0) * Number(item.quantity || 0))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* PAYMENT VERIFICATION */}
          <section className="border-t border-hiraya-structure-line/80 pt-4 space-y-3">
            <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-hiraya-sand">
              <Receipt size={11} /> Payment verification
            </p>
            <p className="text-[11px] text-hiraya-olive">
              Match the reference number and amount against the store&apos;s GCash or bank app before approving.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PaymentStep
                order={order}
                type="dp"
                title={paidInFull(order) ? '1 · Full Payment' : '1 · 50% Down Payment'}
                amount={order.dp_amount}
                reference={order.dp_reference_number}
                submittedAt={order.dp_submitted_at}
                hasProof={Boolean(order.dp_proof_image_path)}
              >
                {order.payment_status === 'pending' && !locked && (
                  rejectingDp ? (
                    <div className="space-y-2">
                      <label htmlFor={`reject-reason-${order.id}`} className="block text-[9px] uppercase tracking-widest text-hiraya-sand">
                        Reason (shown to the customer)
                      </label>
                      <textarea
                        id={`reject-reason-${order.id}`}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        maxLength={500}
                        rows={2}
                        className="w-full rounded-xl border border-hiraya-structure-line bg-hiraya-cream-deep px-3 py-2 text-[11px] text-hiraya-ink focus:border-hiraya-accent focus:outline-none"
                        placeholder="e.g. Reference number does not match any received payment."
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => { setRejectingDp(false); setRejectReason(''); }}
                          disabled={Boolean(saving)}
                          className="rounded-xl border border-hiraya-structure-line px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-hiraya-ink transition hover:bg-navy-900/5 cursor-pointer disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={rejectDp}
                          disabled={Boolean(saving)}
                          className="flex items-center justify-center gap-1.5 rounded-xl bg-red-600 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-red-700 cursor-pointer disabled:opacity-50"
                        >
                          {saving === 'reject-dp' ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                          Reject
                        </button>
                      </div>
                      <p className="text-[10px] text-hiraya-sand">Rejecting returns the reserved stock to inventory.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRejectingDp(true)}
                        disabled={Boolean(saving)}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-red-600/40 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-red-700 transition hover:bg-red-500/12 cursor-pointer disabled:opacity-50"
                      >
                        <Ban size={13} /> Reject
                      </button>
                      <button
                        type="button"
                        onClick={approveDp}
                        disabled={Boolean(saving) || !order.dp_proof_image_path}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-emerald-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving === 'approve-dp' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                        Approve
                      </button>
                    </div>
                  )
                )}
                {order.payment_status === 'rejected' && (
                  <p className="text-[10px] text-red-700">Rejected — waiting for the customer to re-upload.</p>
                )}
                {['50_paid', 'fully_paid'].includes(order.payment_status) && (
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 size={12} /> Verified
                  </p>
                )}
              </PaymentStep>

              {!paidInFull(order) && (
              <PaymentStep
                order={order}
                type="balance"
                title="2 · Remaining Balance"
                amount={order.balance_amount}
                reference={order.balance_reference_number}
                submittedAt={order.balance_proof_submitted_at}
                hasProof={Boolean(order.full_payment_proof_image_path)}
              >
                {order.is_demo && order.payment_status === '50_paid' && !order.full_payment_proof_image_path && !locked && (
                  <button
                    type="button"
                    onClick={simulateBalance}
                    disabled={Boolean(saving)}
                    className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sky-700/50 bg-sky-500/10 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-sky-900 transition hover:bg-sky-500/20 cursor-pointer disabled:opacity-50"
                  >
                    {saving === 'demo-balance' ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                    Simulate customer balance payment
                  </button>
                )}
                {order.payment_status === '50_paid' && !locked && (
                  <button
                    type="button"
                    onClick={confirmFullPayment}
                    disabled={Boolean(saving) || !order.full_payment_proof_image_path}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-emerald-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving === 'confirm-full' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                    {order.full_payment_proof_image_path ? 'Confirm full payment' : 'Waiting for balance receipt'}
                  </button>
                )}
                {['pending', 'rejected'].includes(order.payment_status) && (
                  <p className="text-[10px] text-hiraya-sand">Available once the down payment is approved.</p>
                )}
                {order.payment_status === 'fully_paid' && (
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                    <CheckCircle2 size={12} /> Fully paid
                  </p>
                )}
              </PaymentStep>
              )}
            </div>
          </section>

          {/* COURIER TRACKING — only once the order may actually ship. */}
          {!locked && order.payment_status === 'fully_paid' && (
            <section className="border-t border-hiraya-structure-line/80 pt-4 space-y-2">
              <label htmlFor={`tracking-${order.id}`} className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-hiraya-sand">
                <Truck size={11} /> {order.courier === 'lalamove' ? 'Lalamove booking details' : 'LBC tracking number'}
              </label>
              <div className="flex gap-2">
                <input
                  id={`tracking-${order.id}`}
                  type="text"
                  value={tracking}
                  onChange={(e) => setTracking(e.target.value)}
                  maxLength={255}
                  className="flex-1 min-w-0 rounded-xl border border-hiraya-structure-line bg-hiraya-cream-deep px-3 py-2 text-[11px] text-hiraya-ink focus:border-hiraya-accent focus:outline-none"
                  placeholder={order.courier === 'lalamove' ? 'Driver, plate no., booking link' : 'e.g. 1234 5678 9012'}
                />
                <button
                  type="button"
                  onClick={saveTracking}
                  disabled={Boolean(saving) || tracking.trim() === (order.tracking_booking_details || '')}
                  className="flex shrink-0 items-center gap-1.5 rounded-xl border border-hiraya-structure-line px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-hiraya-ink transition hover:bg-navy-900/5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving === 'tracking' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save
                </button>
              </div>
              <p className="text-[10px] text-hiraya-sand">Saving notifies the customer with these details.</p>
            </section>
          )}

          <section className="border-t border-hiraya-structure-line/80 pt-4 space-y-2 text-[11px]">
            {[
              ['Total', order.total_amount],
              ['Down Payment', order.dp_amount],
              ['Balance', order.balance_amount],
              ['Amount Paid', paidAmount(order)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-hiraya-sand uppercase tracking-widest text-[9px]">{label}</span>
                <span className="text-hiraya-ink font-medium">{peso(value)}</span>
              </div>
            ))}
            <p className="text-[9px] text-hiraya-sand flex items-center gap-1.5 pt-2">
              <Clock size={11} />
              Placed {order.created_at ? new Date(order.created_at).toLocaleString() : '—'}
            </p>
          </section>
        </div>

        {/* STATUS ACTIONS */}
        <div className="p-5 border-t border-hiraya-structure-line/80 space-y-3">
          <p className="text-[9px] uppercase tracking-widest text-hiraya-sand">Update order status</p>

          {message.text && (
            <p
              role="status"
              className={`px-3 py-2 rounded-xl border text-[11px] ${message.type === 'error'
                  ? 'bg-red-500/12 border-red-600/40 text-red-700'
                  : message.type === 'warn'
                    ? 'bg-hiraya-accent/12 border-hiraya-accent/40 text-hiraya-ink'
                    : 'bg-emerald-500/12 border-emerald-600/35 text-emerald-700'
                }`}
            >
              {message.text}
            </p>
          )}

          {locked ? (
            <p className="text-[11px] text-hiraya-sand">
              This order was cancelled and its stock returned. Its status can no longer change.
            </p>
          ) : (
            <>
            {order.payment_status !== 'fully_paid' && (
              <p className="text-[10px] text-hiraya-sand">
                Shipped and Delivered unlock once the full payment is confirmed above.
              </p>
            )}
            {order.payment_status === '50_paid' && (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
                Balance still unpaid when the courier is due? Use <strong>Cancel order</strong> — the stock returns to
                inventory and the customer is told the balance was not settled before pickup (Order Guidelines §2).
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STATUS_ACTIONS.map((action) => {
                const Icon = action.icon;
                const current = order.order_status === action.id;
                const armed = action.id === 'rejected' && confirmReject;
                const blockedBy = current ? '' : statusBlockReason(order, action.id);
                const unpaid = Boolean(blockedBy);
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => applyStatus(action.id)}
                    disabled={current || unpaid || Boolean(saving)}
                    title={blockedBy || undefined}
                    aria-pressed={current}
                    className={`px-3 py-3 rounded-xl border font-bold uppercase tracking-wider text-[10px] flex items-center justify-center gap-2 transition cursor-pointer disabled:cursor-not-allowed ${current
                        ? 'bg-navy-900 text-cream-50 border-navy-900'
                        : armed
                          ? 'bg-red-600 text-white border-red-600'
                          : `${action.className} disabled:opacity-50`
                      }`}
                  >
                    {saving === action.id ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                    {armed ? 'Confirm' : action.label}
                  </button>
                );
              })}
            </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

/**
 * @param {Object} props
 * @param {string} [props.initialSearch]  pre-fills the search (e.g. a customer's
 *   email from their profile's "View All Orders").
 * @param {number|string} [props.initialOrderId] opens that order's detail sheet
 *   once the list loads (the profile's "View Order").
 */
const OrdersTab = ({ initialSearch = '', initialOrderId = null } = {}) => {
  const [orders, setOrders] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState(initialSearch || '');
  const [selectedId, setSelectedId] = useState(initialOrderId);

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

  const closeSheet = useCallback(() => setSelectedId(null), []);

  const [confirm, confirmDialog] = useConfirm();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoNotice, setDemoNotice] = useState('');
  const demoCount = orders.filter((o) => o.is_demo).length;

  const createDemo = async () => {
    setDemoBusy(true);
    setDemoNotice('');
    try {
      const res = await api.post('/admin/orders/demo');
      const order = res.data?.order;
      if (order) {
        setOrders((current) => [order, ...current.filter((o) => o.id !== order.id)]);
        setSelectedId(order.id);
      }
      setDemoNotice(res.data?.message || 'Demo order created.');
    } catch (err) {
      setDemoNotice(err?.response?.data?.message || 'The demo order could not be created.');
    } finally {
      setDemoBusy(false);
    }
  };

  const clearDemo = async () => {
    const ok = await confirm({
      title: 'Remove all demo orders?',
      message: `This deletes ${demoCount} demo order(s) and their sample receipts. Real orders are not touched.`,
      confirmText: 'Remove demo orders',
      danger: true,
    });
    if (!ok) return;
    setDemoBusy(true);
    try {
      const res = await api.delete('/admin/orders/demo');
      setOrders((current) => current.filter((o) => !o.is_demo));
      setSelectedId(null);
      setDemoNotice(res.data?.message || 'Demo orders removed.');
    } catch (err) {
      setDemoNotice(err?.response?.data?.message || 'The demo orders could not be removed.');
    } finally {
      setDemoBusy(false);
    }
  };

  const handleUpdated = useCallback((updated) => {
    setOrders((current) => current.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
  }, []);

  const selectedOrder = orders.find((o) => selectedId != null && String(o.id) === String(selectedId)) || null;

  const verifyCount = orders.filter(needsVerification).length;

  const visibleOrders = orders.filter((o) => {
    if (filter === 'verify' && !needsVerification(o)) return false;
    if (filter === 'pending' && o.order_status !== 'pending') return false;
    if (filter === 'shipped' && o.order_status !== 'shipped') return false;
    if (filter === 'delivered' && o.order_status !== 'delivered') return false;
    if (filter === 'rejected' && !isRejected(o)) return false;

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      const haystack = [
        String(o.id),
        o.customer_name,
        o.contact_number,
        o.user?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  /*
   * Revenue is the total of every order that is still live (rejected orders are
   * cancelled and excluded), split by what the customers have actually paid so
   * far versus what is still outstanding.
   */
  const totals = orders.reduce(
    (acc, o) => {
      acc.count += 1;
      if (!isRejected(o)) {
        acc.revenue += Number(o.total_amount || 0);
        acc.collected += paidAmount(o);
      }
      if (o.order_status === 'pending') acc.pending += 1;
      return acc;
    },
    { count: 0, revenue: 0, collected: 0, pending: 0 }
  );

  return (
    <div className="space-y-7 animate-fadeIn text-xs">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-hiraya-structure-line">
        <div>
          <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900 flex items-center gap-2">
            <Package size={22} /> Orders Management
          </h2>
        </div>

        {/*
          * DEMO MODE — for presenting the payment flow. A demo order walks the
          * real admin flow; only the customer's uploads are simulated. Demo
          * orders never touch stock and are left out of the dashboard.
          */}
        <div className="flex flex-wrap items-center gap-2">
          {demoCount > 0 && (
            <button
              type="button"
              onClick={clearDemo}
              disabled={demoBusy}
              className="px-3 py-2.5 rounded-xl border border-hiraya-structure-line text-hiraya-ink font-bold uppercase tracking-wider text-[10px] hover:bg-cream-200 transition cursor-pointer disabled:opacity-50"
            >
              Clear demo orders ({demoCount})
            </button>
          )}
          <button
            type="button"
            onClick={createDemo}
            disabled={demoBusy}
            className="px-4 py-2.5 bg-navy-900 hover:bg-navy-800 text-cream-100 font-bold uppercase tracking-wider rounded-xl flex items-center gap-2 text-[10px] transition cursor-pointer disabled:opacity-50"
          >
            {demoBusy ? <Loader2 size={14} className="animate-spin" /> : <PlayCircle size={14} />} Create demo order
          </button>
        </div>
      </div>

      {demoNotice && (
        <p role="status" className="rounded-xl border border-sky-700/30 bg-sky-500/10 px-4 py-2.5 text-[11px] text-sky-900">{demoNotice}</p>
      )}

      {/* SUMMARY METRICS */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="p-3 sm:p-5 bg-hiraya-surface rounded-[18px] sm:rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-hiraya-ink leading-tight">Total Orders</p>
          <p className="text-lg sm:text-3xl font-bold text-hiraya-ink pt-1">{totals.count}</p>
        </div>
        <div className="p-3 sm:p-5 bg-hiraya-surface rounded-[18px] sm:rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-hiraya-ink leading-tight">Total Revenue</p>
          <p className="text-lg sm:text-3xl font-bold text-emerald-700 pt-1">{peso(totals.revenue)}</p>
          <p className="text-[10px] text-hiraya-sand">
            {peso(totals.collected)} paid · {peso(totals.revenue - totals.collected)} outstanding
          </p>
        </div>
        <div className="p-3 sm:p-5 bg-hiraya-surface rounded-[18px] sm:rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-hiraya-ink leading-tight">Pending Orders</p>
          <p className="text-lg sm:text-3xl font-bold pt-1 text-hiraya-ink">{totals.pending}</p>
        </div>
      </div>

      {/* FILTERS + SEARCH */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { id: 'all', label: 'All' },
          { id: 'verify', label: `To Verify${verifyCount ? ` (${verifyCount})` : ''}` },
          { id: 'pending', label: 'Pending' },
          { id: 'shipped', label: 'Shipped' },
          { id: 'delivered', label: 'Delivered' },
          { id: 'rejected', label: 'Rejected' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${filter === tab.id
                ? 'bg-hiraya-accent/15 text-hiraya-ink border-hiraya-accent/40 font-medium'
                : 'text-hiraya-ink border-hiraya-structure-line/80 hover:text-hiraya-ink hover:border-hiraya-structure-line'
              }`}
          >
            {tab.label}
          </button>
        ))}

        <div className="relative ml-auto w-full sm:w-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-hiraya-sand" />
          <input
            type="text"
            placeholder="Search order #, name, number, email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-2 bg-hiraya-cream-deep border border-hiraya-structure-line rounded-xl text-hiraya-ink placeholder:text-hiraya-sand/70 focus:outline-none focus:border-hiraya-accent text-xs w-full sm:w-64"
          />
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-red-500/12 border border-red-600/40 text-red-700 rounded-2xl uppercase tracking-wider">
          {error}
        </div>
      )}

      {/* LIST */}
      {fetching ? (
        <div className="py-20 text-center text-[10px] uppercase tracking-[0.3em] text-hiraya-ink animate-pulse">
          Loading Orders...
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 py-20 text-center">
          <Package className="w-10 h-10 text-hiraya-sand mx-auto mb-4" />
          <p className="text-xs text-hiraya-sand uppercase tracking-widest">No orders in this view.</p>
        </div>
      ) : (
        <div className="bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 overflow-hidden">
          {/* Column labels (desktop only; rows stack on mobile). */}
          <div className="hidden md:grid grid-cols-[90px_150px_1fr_150px_1.2fr_24px] gap-4 px-5 py-3 border-b border-hiraya-structure-line/80 text-[9px] uppercase tracking-widest text-hiraya-sand">
            <span>Order #</span>
            <span>Status</span>
            <span>Name</span>
            <span>Number</span>
            <span>Email</span>
            <span />
          </div>

          <ul className="divide-y divide-hiraya-structure-line/70">
            {visibleOrders.map((order) => (
              <li key={order.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(order.id)}
                  className="w-full text-left px-5 py-4 grid grid-cols-[1fr_auto] md:grid-cols-[90px_150px_1fr_150px_1.2fr_24px] gap-x-4 gap-y-1.5 items-center hover:bg-navy-900/5 focus-visible:bg-navy-900/5 focus-visible:outline-none transition cursor-pointer"
                >
                  <span className="flex items-center gap-1.5 font-bold text-hiraya-ink uppercase tracking-widest">
                    #{order.id}
                    {order.is_demo && (
                      <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-bold tracking-wider text-sky-900">DEMO</span>
                    )}
                    {needsVerification(order) && (
                      <Receipt size={12} className="text-hiraya-accent" aria-label="Receipt waiting for verification" />
                    )}
                  </span>
                  <span className="justify-self-end md:justify-self-start flex flex-col items-end md:items-start gap-1">
                    <Chip meta={ORDER_STATUS[order.order_status]} fallback={order.order_status} />
                    {order.processing_date && !['delivered', 'rejected'].includes(order.order_status) && (
                      <span className="text-[9px] uppercase tracking-widest text-hiraya-sand">Process: {processingLabel(order)}</span>
                    )}
                  </span>
                  <span className="text-hiraya-ink font-medium truncate">{order.customer_name || order.user?.full_name || '—'}</span>
                  <span className="text-hiraya-ink truncate">{order.contact_number || '—'}</span>
                  <span className="text-hiraya-olive truncate col-span-2 md:col-span-1">{order.user?.email || '—'}</span>
                  <ChevronRight size={16} className="hidden md:block text-hiraya-sand" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AnimatePresence>
        {selectedOrder && (
          <OrderDetailSheet
            key={selectedOrder.id}
            order={selectedOrder}
            onClose={closeSheet}
            onUpdated={handleUpdated}
          />
        )}
      </AnimatePresence>

      {confirmDialog}
    </div>
  );
};

export default OrdersTab;

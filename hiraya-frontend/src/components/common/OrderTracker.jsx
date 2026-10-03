import PropTypes from 'prop-types';
import { Check, XCircle } from 'lucide-react';

const PAID = ['50_paid', 'fully_paid'];
const LADDER = ['pending', 'processing', 'ready_for_shipping', 'shipped', 'delivered'];
const reached = (order, status) => LADDER.indexOf(order.order_status) >= LADDER.indexOf(status);

/**
 * The order's journey, newest step highlighted: payment verified → courier →
 * delivery (legacy 50/50 orders keep their down payment → balance steps). Dates come
 * from the order's step timestamps; orders older than those columns show the
 * step without a date.
 */
// Hints differ by who is reading: the customer, or staff on the console.
const HINTS = {
  customer: {
    pending: 'Pending verification — the store is matching your payment',
    needs_review: 'Under review — no action needed unless we contact you',
    rejected: 'Verification failed — please upload the correct receipt',
    balanceSent: 'Balance receipt sent — waiting for confirmation',
    balanceDue: 'Send the remaining balance to ship your order',
  },
  staff: {
    pending: 'Receipt received — verify the full payment in the store’s payment records',
    needs_review: 'Flagged for review — verify or mark it failed',
    rejected: 'Verification failed — waiting for the customer’s new receipt',
    balanceSent: 'Balance receipt received — confirm the balance',
    balanceDue: 'Waiting for the customer’s balance payment',
  },
};

export const orderSteps = (order, audience = 'customer') => {
  /*
   * Every new order is ONE full payment, so its timeline has ONE payment event:
   * "Full payment verified" (dated by `fully_paid_at`).
   *
   * Only a HISTORICAL 50/50 order — it still carries a balance — keeps its two
   * real milestones, labelled as legacy so staff never mistake them for the
   * current flow, and a partially paid order is never shown as fully paid.
   */
  const legacySplit = Number(order.balance_amount) > 0;
  const hints = HINTS[audience] || HINTS.customer;
  const paymentHint = hints[order.payment_status] ?? null;

  return [
    { key: 'placed', label: 'Order placed', at: order.created_at, done: true },
    ...(legacySplit
      ? [
        {
          key: 'dp',
          label: '50% down payment verified (legacy order)',
          at: order.dp_verified_at,
          done: PAID.includes(order.payment_status),
          hint: paymentHint,
        },
        {
          key: 'paid',
          label: 'Balance paid — fully paid (legacy order)',
          at: order.fully_paid_at,
          done: order.payment_status === 'fully_paid',
          hint: order.payment_status === '50_paid'
            ? (order.balance_proof_submitted_at ? hints.balanceSent : hints.balanceDue)
            : null,
        },
      ]
      : [
        {
          key: 'paid',
          label: 'Full payment verified',
          at: order.fully_paid_at || order.dp_verified_at,
          done: order.payment_status === 'fully_paid',
          hint: paymentHint,
        },
      ]),
    { key: 'ready', label: 'Ready to ship', at: order.ready_for_shipping_at, done: reached(order, 'ready_for_shipping') },
    {
      key: 'shipped',
      label: order.courier === 'lalamove' ? 'Picked up by Lalamove' : 'Shipped via LBC',
      at: order.shipped_at,
      done: reached(order, 'shipped'),
      detail: order.tracking_booking_details || null,
    },
    { key: 'delivered', label: 'Delivered', at: order.delivered_at, done: reached(order, 'delivered') },
  ];
};

const formatAt = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const OrderTracker = ({ order, className = '', audience = 'customer' }) => {
  const rejected = order.order_status === 'rejected';
  const steps = orderSteps(order, audience);
  const current = steps.findIndex((s) => !s.done);

  if (rejected) {
    return (
      <div className={`flex items-start gap-2 rounded-xl border border-red-600/30 bg-red-500/10 px-4 py-3 text-[11px] text-red-700 ${className}`}>
        <XCircle size={15} className="mt-0.5 shrink-0" />
        <span>
          This order was cancelled{order.rejection_reason ? `: ${order.rejection_reason}` : '.'}
        </span>
      </div>
    );
  }

  return (
    <ol className={`space-y-0 ${className}`} aria-label="Order progress">
      {steps.map((step, index) => {
        const isCurrent = index === current;
        const last = index === steps.length - 1;
        const when = formatAt(step.at);
        return (
          <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-px ${step.done ? 'bg-emerald-600/60' : 'bg-hiraya-structure-line'}`}
              />
            )}
            <span
              className={`relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border ${
                step.done
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : isCurrent
                    ? 'border-hiraya-accent bg-hiraya-surface'
                    : 'border-hiraya-structure-line bg-hiraya-surface'
              }`}
            >
              {step.done ? <Check size={11} strokeWidth={3} /> : isCurrent && <span className="h-2 w-2 rounded-full bg-hiraya-accent" />}
            </span>
            <div className="min-w-0 text-[11px] leading-snug">
              <p className={step.done || isCurrent ? 'font-semibold text-hiraya-ink' : 'text-hiraya-ink-muted'}>
                {step.label}
                {isCurrent && <span className="sr-only"> (current step)</span>}
              </p>
              {when && step.done && <p className="text-[10px] text-hiraya-ink-muted">{when}</p>}
              {isCurrent && step.hint && <p className="text-[10px] text-hiraya-accent">{step.hint}</p>}
              {step.done && step.detail && <p className="break-words text-[10px] text-hiraya-ink">{step.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

OrderTracker.propTypes = {
  order: PropTypes.shape({
    order_status: PropTypes.string,
    payment_status: PropTypes.string,
    courier: PropTypes.string,
    created_at: PropTypes.string,
    rejection_reason: PropTypes.string,
    tracking_booking_details: PropTypes.string,
  }).isRequired,
  className: PropTypes.string,
  audience: PropTypes.oneOf(['customer', 'staff']),
};

export default OrderTracker;

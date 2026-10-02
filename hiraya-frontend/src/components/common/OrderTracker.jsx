import PropTypes from 'prop-types';
import { Check, XCircle } from 'lucide-react';

const PAID = ['50_paid', 'fully_paid'];
const LADDER = ['pending', 'processing', 'ready_for_shipping', 'shipped', 'delivered'];
const reached = (order, status) => LADDER.indexOf(order.order_status) >= LADDER.indexOf(status);

/**
 * The order's journey, newest step highlighted. Steps follow the Order
 * Guidelines: down payment → full payment → courier → delivery. Dates come
 * from the order's step timestamps; orders older than those columns show the
 * step without a date.
 */
export const orderSteps = (order) => [
  { key: 'placed', label: 'Order placed', at: order.created_at, done: true },
  {
    key: 'dp',
    label: 'Down payment verified',
    at: order.dp_verified_at,
    done: PAID.includes(order.payment_status),
    hint: order.payment_status === 'pending'
      ? 'Waiting for the store to check your receipt'
      : order.payment_status === 'rejected' ? 'Receipt was not accepted — please upload it again' : null,
  },
  {
    key: 'paid',
    label: 'Fully paid',
    at: order.fully_paid_at,
    done: order.payment_status === 'fully_paid',
    hint: order.payment_status === '50_paid'
      ? (order.balance_proof_submitted_at ? 'Balance receipt sent — waiting for confirmation' : 'Send the remaining balance to ship your order')
      : null,
  },
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

const formatAt = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const OrderTracker = ({ order, className = '' }) => {
  const rejected = order.order_status === 'rejected';
  const steps = orderSteps(order);
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
};

export default OrderTracker;

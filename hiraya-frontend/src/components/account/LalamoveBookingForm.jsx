import { useState } from 'react';
import PropTypes from 'prop-types';
import { Loader2, Truck } from 'lucide-react';
import api, { parseApiError } from '../../api/axios';

/**
 * Order Guidelines §4: for Lalamove the customer books the rider and sends the
 * store the booking/tracking details. Shown once the order is fully paid.
 */
const LalamoveBookingForm = ({ order, onSaved }) => {
  const [value, setValue] = useState(order.tracking_booking_details || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const trimmed = value.trim();
  const unchanged = trimmed === (order.tracking_booking_details || '');

  const submit = async (event) => {
    event.preventDefault();
    if (trimmed.length < 4 || unchanged) return;

    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      const { data } = await api.post(`/orders/${order.id}/lalamove-booking`, { tracking_booking_details: trimmed });
      onSaved?.(data.order);
      setMessage({ type: 'ok', text: data.message || 'Booking details sent.' });
    } catch (error) {
      setMessage({ type: 'error', text: parseApiError(error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border border-hiraya-accent/20 bg-hiraya-accent-wash p-3">
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-accent">
        <Truck size={12} /> Your Lalamove booking
      </p>
      <p className="text-[10px] leading-relaxed text-hiraya-ink-muted">
        Book a Lalamove rider to our store, then send us the booking or tracking details (rider name, plate number or share link).
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={value}
          maxLength={255}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Juan D. · ABC 1234 · lalamove.com/share/..."
          aria-label="Lalamove booking details"
          className="min-w-0 flex-1 rounded-lg border border-hiraya-structure-line bg-hiraya-surface px-3 py-2 text-[11px] text-hiraya-ink focus:outline-none focus:ring-2 focus:ring-hiraya-focus"
        />
        <button
          type="submit"
          disabled={saving || trimmed.length < 4 || unchanged}
          className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-navy-900 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cream-100 transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          {order.tracking_booking_details ? 'Update' : 'Send'}
        </button>
      </div>
      {message.text && (
        <p className={`text-[10px] ${message.type === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</p>
      )}
    </form>
  );
};

LalamoveBookingForm.propTypes = {
  order: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    tracking_booking_details: PropTypes.string,
  }).isRequired,
  onSaved: PropTypes.func,
};

export default LalamoveBookingForm;

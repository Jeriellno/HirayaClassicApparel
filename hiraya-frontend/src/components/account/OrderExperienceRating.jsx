import { useState } from 'react';
import PropTypes from 'prop-types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquareHeart, Send } from 'lucide-react';
import api, { parseApiError } from '../../api/axios';
import { StarRow } from './ReviewProductModal';

const LABELS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };

/**
 * "Rate your order experience" — one 1-5 star rating + comment per delivered
 * order (delivery, packaging, service). It is the shop Feedback, tied to the
 * order: staff see it in Customers Feedback as "Order #X", and the customer
 * sees what they gave here afterwards.
 */
const OrderExperienceRating = ({ orderId, existing }) => {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: (payload) => api.post('/feedback', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-feedback'] }),
    onError: (err) => setError(parseApiError(err).message),
  });

  if (existing) {
    return (
      <div className="rounded-xl border border-hiraya-structure-line bg-hiraya-surface p-3">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">Your order rating</p>
        <div className="flex items-center gap-2">
          <StarRow value={Number(existing.rating) || 0} size={16} />
          <span className="text-[11px] font-semibold text-hiraya-ink">{LABELS[existing.rating]}</span>
        </div>
        {existing.comment && <p className="mt-1 text-[11px] text-hiraya-ink">&ldquo;{existing.comment}&rdquo;</p>}
      </div>
    );
  }

  const onSubmit = (event) => {
    event.preventDefault();
    setError('');
    if (rating < 1) {
      setError('Please choose a star rating.');
      return;
    }
    if (!comment.trim()) {
      setError('Please tell us a little about your experience.');
      return;
    }
    submit.mutate({ order_id: orderId, rating, comment: comment.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-xl border border-hiraya-accent/20 bg-hiraya-accent-wash p-3">
      <p className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-accent">
        <MessageSquareHeart size={12} /> Rate your order experience
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <StarRow value={rating} hovered={hovered} onHover={setHovered} onSelect={setRating} size={26} />
        <span className="text-[11px] font-semibold text-hiraya-ink">
          {(hovered || rating) ? `${hovered || rating} / 5 · ${LABELS[hovered || rating]}` : 'Tap a star to rate'}
        </span>
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="How was the delivery, packaging and service?"
        aria-label="Your feedback about this order"
        className="w-full resize-none rounded-lg border border-hiraya-structure-line bg-hiraya-surface px-3 py-2 text-[11px] text-hiraya-ink focus:outline-none focus:ring-2 focus:ring-hiraya-focus"
      />
      {error && <p className="text-[10px] text-red-700">{error}</p>}
      <button
        type="submit"
        disabled={submit.isPending}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-navy-900 px-4 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-cream-100 disabled:cursor-wait disabled:opacity-60"
      >
        {submit.isPending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />} Send rating
      </button>
    </form>
  );
};

OrderExperienceRating.propTypes = {
  orderId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  existing: PropTypes.shape({ rating: PropTypes.number, comment: PropTypes.string }),
};

export default OrderExperienceRating;

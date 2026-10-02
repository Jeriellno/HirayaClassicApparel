import { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ImagePlus, Loader2, Send, Star, X } from 'lucide-react';
import api from '../../api/axios';
import { getProductImageUrl } from '../../utils/imageHelper';
import { themeSurfaceFor } from '../../utils/framePresets';

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1200;

/*
 * Reads a picked photo and returns a compact JPEG data URI (longest edge
 * capped at 1200px), so the Base64 payload stays well under the backend limit.
 */
const toCompressedDataUri = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that photo.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('That file is not a supported image.'));
            img.onload = () => {
                const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

const RATING_LABELS = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' };

const StarRow = ({ value, hovered = 0, onHover, onSelect, size = 22 }) => (
    <div className="flex items-center gap-1" onMouseLeave={() => onHover?.(0)}>
        {[1, 2, 3, 4, 5].map((n) => {
            const lit = (hovered || value) >= n;
            const star = (
                <Star
                    size={size}
                    className={lit ? 'text-amber-500' : 'text-amber-500/40'}
                    fill={lit ? 'currentColor' : 'none'}
                />
            );
            return onSelect ? (
                <button
                    key={n}
                    type="button"
                    onClick={() => onSelect(n)}
                    onMouseEnter={() => onHover?.(n)}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                    aria-pressed={value === n}
                    className="cursor-pointer rounded-sm p-0.5 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                >
                    {star}
                </button>
            ) : (
                <span key={n}>{star}</span>
            );
        })}
    </div>
);

StarRow.propTypes = {
    value: PropTypes.number.isRequired,
    hovered: PropTypes.number,
    onHover: PropTypes.func,
    onSelect: PropTypes.func,
    size: PropTypes.number,
};

/**
 * Review one delivered order line — or, when `existingReview` is given, show
 * the review already submitted for it (read-only; one line = one review).
 */
/** The order-experience rating already given for this order. */
const OrderRatingSummary = ({ feedback }) => (
    <div className="rounded-xl border border-hiraya-structure-line bg-hiraya-surface p-3">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">Your order experience rating</p>
        <div className="flex items-center gap-2">
            <StarRow value={Number(feedback.rating) || 0} size={15} />
            <span className="text-[11px] font-semibold text-hiraya-ink">{RATING_LABELS[feedback.rating]}</span>
        </div>
        {feedback.comment && <p className="mt-1 text-[11px] text-hiraya-ink">&ldquo;{feedback.comment}&rdquo;</p>}
    </div>
);

OrderRatingSummary.propTypes = {
    feedback: PropTypes.shape({ rating: PropTypes.number, comment: PropTypes.string }).isRequired,
};

const ReviewProductModal = ({ line, existingReview = null, orderFeedback = null, onClose }) => {
    const queryClient = useQueryClient();
    const [rating, setRating] = useState(0);
    /*
     * ORDER EXPERIENCE, IN THE SAME FORM. One delivered order is rated once
     * (delivery, packaging, service). It used to be a separate form under the
     * order; it now rides along with the first product review of that order,
     * and later reviews of the same order just show what was given.
     */
    const [orderRating, setOrderRating] = useState(0);
    const [orderHovered, setOrderHovered] = useState(0);
    const [orderComment, setOrderComment] = useState('');
    const [orderSaved, setOrderSaved] = useState(null);
    const needsOrderRating = !orderFeedback && !orderSaved;
    const [hovered, setHovered] = useState(0);
    const [comment, setComment] = useState('');
    const [image, setImage] = useState(null);
    const [error, setError] = useState('');
    const [isReadingImage, setIsReadingImage] = useState(false);

    // Same cache entry the product page uses, so the image is often already loaded.
    const { data: product } = useQuery({
        queryKey: ['product', String(line.product_id)],
        queryFn: async () => (await api.get(`/products/${line.product_id}`)).data,
        enabled: !!line.product_id,
        staleTime: 5 * 60 * 1000,
    });

    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const submitMutation = useMutation({
        mutationFn: async ({ order, ...payload }) => {
            const res = await api.post(`/order-items/${line.id}/review`, payload);
            if (order) {
                try {
                    const fb = await api.post('/feedback', order);
                    setOrderSaved(fb.data?.feedback || { rating: order.rating, comment: order.comment });
                } catch (orderErr) {
                    // The product review is saved; only the order rating failed.
                    setError(orderErr.response?.data?.message || 'Your review was posted, but the order rating could not be saved.');
                }
            }
            return res;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
            queryClient.invalidateQueries({ queryKey: ['my-feedback'] });
            queryClient.invalidateQueries({ queryKey: ['product-reviews', String(line.product_id)] });
        },
        onError: (err) => {
            setError(err.response?.data?.message || 'Failed to submit your review. Please try again.');
            // Already reviewed elsewhere (another tab) — refresh the button state.
            if (err.response?.status === 422) queryClient.invalidateQueries({ queryKey: ['my-reviews'] });
        },
    });

    const handlePickImage = async (file) => {
        if (!file) return;
        setError('');
        if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
            setError('Please choose a JPG, PNG or WEBP photo.');
            return;
        }
        if (file.size > MAX_SOURCE_BYTES) {
            setError('That photo is too large (8 MB max).');
            return;
        }
        setIsReadingImage(true);
        try {
            setImage(await toCompressedDataUri(file));
        } catch (err) {
            setError(err.message);
        } finally {
            setIsReadingImage(false);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');
        if (rating < 1) {
            setError('Please choose a star rating for the product.');
            return;
        }
        if (needsOrderRating && orderRating < 1) {
            setError('Please also rate your order experience (delivery, packaging and service).');
            return;
        }
        submitMutation.mutate({
            rating,
            comment: comment.trim() || null,
            image,
            order: needsOrderRating
                ? { order_id: line.order_id, rating: orderRating, comment: orderComment.trim() || null }
                : null,
        });
    };

    const submitted = submitMutation.isSuccess ? submitMutation.data?.data?.review : null;
    const review = existingReview || submitted;
    const name = product?.name || line.product_name_snapshot || `Product #${line.product_id}`;
    const imageUrl = getProductImageUrl(product?.display_image_url || product?.image_url || product?.image);

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={review ? `Your review of ${name}` : `Review ${name}`}
        >
            <div className="fixed inset-0 bg-hiraya-ink/60 backdrop-blur-sm" onClick={onClose} />

            <div className="card-raised relative z-10 max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto p-6">
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close dialog"
                    className="absolute right-4 top-4 cursor-pointer text-hiraya-ink-muted transition-colors hover:text-hiraya-accent"
                >
                    <X size={16} />
                </button>

                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
                    {review ? 'Your Review' : 'Review Product'}
                </p>

                {/* Product */}
                <div className="mt-4 flex items-center gap-4 border-b border-hiraya-structure-line pb-5">
                    <div
                        className="h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-xl bg-black shadow-[0_8px_16px_-10px_rgba(0,0,0,0.8)]"
                        style={{ backgroundColor: themeSurfaceFor(product) }}
                    >
                        <img src={imageUrl} alt={name} className="h-full w-full object-contain" />
                    </div>
                    <div className="min-w-0 pr-6">
                        <h3 className="font-serif text-base font-medium uppercase leading-snug tracking-[0.08em] text-hiraya-ink">
                            {name}
                        </h3>
                        <p className="mt-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                            Size {line.selected_size} · Qty {line.quantity}
                        </p>
                    </div>
                </div>

                {review ? (
                    /* Read-only view of the submitted review */
                    <div className="space-y-4 pt-5">
                        {submitted && (
                            <p className="flex items-center gap-2 rounded-xl border border-emerald-600/40 bg-emerald-500/12 px-3.5 py-2.5 text-[11px] text-emerald-700">
                                <CheckCircle2 size={14} className="shrink-0" />
                                Thank you — your review has been posted.
                            </p>
                        )}
                        <StarRow value={review.rating} size={18} />
                        {review.comment ? (
                            <p className="whitespace-pre-line text-[12px] leading-relaxed text-hiraya-ink-soft">
                                {review.comment}
                            </p>
                        ) : (
                            <p className="text-[11px] italic text-hiraya-ink-muted">No written comment.</p>
                        )}
                        {review.image && (
                            <img
                                src={review.image}
                                alt="Your review photo"
                                className="max-h-64 rounded-xl border border-hiraya-structure-line object-contain"
                            />
                        )}
                        <p className="text-[9px] text-hiraya-ink-muted">
                            Reviewed {new Date(review.created_at).toLocaleDateString()}
                        </p>
                        {(orderFeedback || orderSaved) && (
                            <OrderRatingSummary feedback={orderFeedback || orderSaved} />
                        )}
                        <div className="flex justify-end">
                            <button type="button" onClick={onClose} className="btn-secondary cursor-pointer">
                                Close
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-5 pt-5">
                        <div>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
                                Your rating
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                                <StarRow value={rating} hovered={hovered} onHover={setHovered} onSelect={setRating} size={32} />
                                <span className="text-sm font-semibold text-hiraya-ink">
                                    {(hovered || rating) ? `${hovered || rating} / 5 · ${RATING_LABELS[hovered || rating]}` : 'Tap a star to rate'}
                                </span>
                            </div>
                        </div>

                        <div>
                            <label
                                htmlFor="review-comment"
                                className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted"
                            >
                                Your review
                            </label>
                            <textarea
                                id="review-comment"
                                value={comment}
                                onChange={(e) => setComment(e.target.value)}
                                maxLength={1000}
                                rows={4}
                                placeholder="How was the fit, fabric and quality?"
                                className="w-full resize-none rounded-xl border border-hiraya-structure-line bg-cream-50 px-3.5 py-3 text-[12px] text-hiraya-ink placeholder:text-hiraya-ink-muted focus:border-hiraya-accent focus:outline-none focus:ring-2 focus:ring-hiraya-focus/40"
                            />
                            <p className="mt-1 text-right text-[9px] text-hiraya-ink-muted">{comment.length} / 1000</p>
                        </div>

                        <div>
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
                                Photo <span className="normal-case tracking-normal">(optional)</span>
                            </p>
                            {image ? (
                                <div className="relative inline-block">
                                    <img
                                        src={image}
                                        alt="Selected review photo"
                                        className="max-h-40 rounded-xl border border-hiraya-structure-line object-contain"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setImage(null)}
                                        aria-label="Remove photo"
                                        className="absolute -right-2 -top-2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-hiraya-ink text-cream-50 shadow"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <label className="btn-secondary inline-flex cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-hiraya-focus">
                                    {isReadingImage ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                                    Add Photo
                                    <input
                                        type="file"
                                        accept="image/png,image/jpeg,image/webp"
                                        className="sr-only"
                                        onChange={(e) => {
                                            handlePickImage(e.target.files?.[0]);
                                            e.target.value = '';
                                        }}
                                    />
                                </label>
                            )}
                        </div>

                        {error && (
                            <p className="rounded-xl border border-red-600/40 bg-red-500/12 px-3.5 py-2.5 text-[11px] text-red-700">
                                {error}
                            </p>
                        )}

                        <div className="space-y-3 border-t border-hiraya-structure-line pt-5">
                            {needsOrderRating ? (
                                <>
                                    <div>
                                        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-hiraya-ink-muted">
                                            Rate your order experience
                                        </p>
                                        <p className="mb-2 text-[11px] text-hiraya-ink-muted">Delivery, packaging and service for order #{line.order_id}.</p>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <StarRow value={orderRating} hovered={orderHovered} onHover={setOrderHovered} onSelect={setOrderRating} size={26} />
                                            <span className="text-sm font-semibold text-hiraya-ink">
                                                {(orderHovered || orderRating) ? `${orderHovered || orderRating} / 5 · ${RATING_LABELS[orderHovered || orderRating]}` : 'Tap a star to rate'}
                                            </span>
                                        </div>
                                    </div>
                                    <textarea
                                        value={orderComment}
                                        onChange={(e) => setOrderComment(e.target.value)}
                                        maxLength={2000}
                                        rows={2}
                                        placeholder="How was the delivery and service? (optional)"
                                        aria-label="Comment about your order experience"
                                        className="field resize-none"
                                    />
                                </>
                            ) : (
                                <OrderRatingSummary feedback={orderFeedback || orderSaved} />
                            )}
                        </div>

                        <div className="flex justify-end gap-3">
                            <button type="button" onClick={onClose} className="btn-secondary cursor-pointer">
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitMutation.isPending || isReadingImage}
                                className="btn-primary cursor-pointer"
                            >
                                {submitMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                                Submit Review
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

ReviewProductModal.propTypes = {
    line: PropTypes.shape({
        id: PropTypes.number.isRequired,
        order_id: PropTypes.number,
        product_id: PropTypes.number,
        product_name_snapshot: PropTypes.string,
        selected_size: PropTypes.string,
        quantity: PropTypes.number,
    }).isRequired,
    existingReview: PropTypes.object,
    orderFeedback: PropTypes.shape({ rating: PropTypes.number, comment: PropTypes.string }),
    onClose: PropTypes.func.isRequired,
};

export { StarRow };
export default ReviewProductModal;

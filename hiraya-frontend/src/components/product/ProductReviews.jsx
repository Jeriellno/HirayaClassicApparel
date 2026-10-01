import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MessageSquare } from 'lucide-react';
import api from '../../api/axios';
import { StarRow } from '../account/ReviewProductModal';

/**
 * Verified-purchase reviews for one product. Reviews can only be written from
 * a delivered order (My Orders), so every entry here is from a real buyer.
 */
const ProductReviews = ({ productId }) => {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['product-reviews', String(productId)],
        queryFn: async () => (await api.get(`/products/${productId}/reviews`)).data,
        enabled: !!productId,
        staleTime: 60 * 1000,
    });

    const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
    const count = Number(data?.count || 0);
    const average = data?.average ? Number(data.average) : 0;

    return (
        <section className="mt-16 border-t border-hiraya-structure-line pt-10" aria-labelledby="product-reviews-heading">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                <div>
                    <span className="kicker text-hiraya-ink-muted">Verified Purchases</span>
                    <h2
                        id="product-reviews-heading"
                        className="mt-2 font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.06em] text-navy-900"
                    >
                        Customer Reviews
                    </h2>
                </div>
                {count > 0 && (
                    <div className="flex items-center gap-3">
                        <StarRow value={Math.round(average)} size={16} />
                        <span className="text-[12px] font-semibold text-hiraya-ink">{average.toFixed(1)} / 5</span>
                        <span className="text-[10px] uppercase tracking-[0.16em] text-hiraya-ink-muted">
                            {count} review{count !== 1 ? 's' : ''}
                        </span>
                    </div>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center gap-2 py-8 text-[11px] text-hiraya-ink-muted">
                    <Loader2 size={13} className="animate-spin text-hiraya-accent" /> Loading reviews...
                </div>
            ) : isError ? (
                <p className="py-8 text-[11px] text-hiraya-ink-muted">Reviews are unavailable right now.</p>
            ) : reviews.length === 0 ? (
                <div className="card flex items-center gap-3 px-5 py-6 text-[11px] text-hiraya-ink-muted">
                    <MessageSquare size={15} className="shrink-0" />
                    No reviews yet. Customers can review this piece once their order is delivered.
                </div>
            ) : (
                <ul className="grid gap-4 md:grid-cols-2">
                    {reviews.map((review) => (
                        <li key={review.id} className="card px-5 py-5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <StarRow value={review.rating} size={14} />
                                <span className="text-[9px] text-hiraya-ink-muted">
                                    {new Date(review.created_at).toLocaleDateString()}
                                </span>
                            </div>
                            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-hiraya-ink">
                                {review.reviewer}
                                {review.size && (
                                    <span className="ml-2 font-normal normal-case tracking-normal text-hiraya-ink-muted">
                                        · Size {review.size}
                                    </span>
                                )}
                            </p>
                            {review.comment && (
                                <p className="mt-2 whitespace-pre-line text-[12px] leading-relaxed text-hiraya-ink-soft">
                                    {review.comment}
                                </p>
                            )}
                            {review.image && (
                                <img
                                    src={review.image}
                                    alt={`Photo from ${review.reviewer}'s review`}
                                    loading="lazy"
                                    className="mt-3 max-h-48 rounded-xl border border-hiraya-structure-line object-contain"
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

ProductReviews.propTypes = {
    productId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
};

export default ProductReviews;

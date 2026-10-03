import { useState } from 'react';
import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import { Star, MessageSquare, TrendingUp, Mail, ChevronLeft, ChevronRight, Package, Loader2, ImageIcon } from 'lucide-react';
import api from '../../../api/axios';

/** Reviews per page (matches the Inventory Catalog). */
const PAGE_SIZE = 5;

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: '5', label: '5 Star' },
  { id: '4', label: '4 Star' },
  { id: '3', label: '3 Star' },
  { id: '2', label: '2 Star' },
  { id: '1', label: '1 Star' },
];

const card = 'bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80';

/** A review photo, fetched only when staff ask for it (never inlined in the list). */
const ReviewPhoto = ({ id }) => {
  const [src, setSrc] = useState(null);
  const [state, setState] = useState('idle');

  const load = async () => {
    setState('loading');
    try {
      const res = await api.get(`/admin/product-reviews/${id}/image`, { responseType: 'blob' });
      setSrc(URL.createObjectURL(res.data));
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (src) return <img src={src} alt="Photo attached to the review" className="h-24 w-24 rounded-lg object-cover" />;

  return (
    <button
      type="button"
      onClick={load}
      disabled={state === 'loading'}
      className="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-hiraya-structure-line px-3 text-[10px] font-semibold uppercase tracking-wider text-hiraya-ink hover:bg-cream-200/60 disabled:opacity-60"
    >
      {state === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
      {state === 'error' ? 'Photo unavailable — retry' : 'View photo'}
    </button>
  );
};

ReviewPhoto.propTypes = { id: PropTypes.number.isRequired };

/**
 * PRODUCT REVIEWS — ONE UNIFIED REVIEW SYSTEM.
 *
 * Feedback and product reviews used to be two separate lists in this tab (the
 * second, the "Product Reviews" panel, inlined every review photo and timed
 * out). They are now one list from GET /admin/reviews: verified-purchase
 * product reviews plus the order-experience ratings customers left before
 * Feedback was merged. The aggregates and the All / 5..1 Star filters apply to
 * that single list, and the "Product Reviews" heading sits under the filters.
 */
const FeedbackTab = () => {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);

  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-reviews'],
    queryFn: async () => (await api.get('/admin/reviews')).data,
    staleTime: 60 * 1000,
  });
  const reviews = Array.isArray(data) ? data : [];

  const rated = reviews.filter((r) => r.rating !== null && r.rating !== undefined && r.rating !== '');
  const averageRating = rated.length > 0 ? rated.reduce((acc, r) => acc + Number(r.rating), 0) / rated.length : null;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: rated.filter((r) => Number(r.rating) === star).length,
  }));
  const maxBucket = Math.max(1, ...distribution.map((d) => d.count));

  const visible = reviews.filter((r) => filter === 'all' || Number(r.rating) === Number(filter));

  // Pages the FILTERED list; switching the filter resets to page one.
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const paged = visible.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      <div>
        <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900">
          Reviews &amp; Ratings
        </h2>
        <p className="mt-1 text-[11px] text-hiraya-ink-muted">
          Verified-purchase reviews customers leave from My Orders after delivery.
        </p>
      </div>

      {/* AGGREGATES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`p-5 ${card} space-y-1`}>
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Reviews</span>
            <MessageSquare size={16} className="text-hiraya-ink" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">{reviews.length}</p>
        </div>

        <div className={`p-5 ${card} space-y-1`}>
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Average Rating</span>
            <Star size={16} className="text-amber-500" fill="currentColor" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">
            {averageRating === null ? '—' : averageRating.toFixed(1)}
          </p>
          <p className="text-[10px] text-hiraya-sand">
            {rated.length > 0 ? `from ${rated.length} rated` : 'no ratings yet'}
          </p>
        </div>

        <div className={`p-5 ${card} space-y-2`}>
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Distribution</span>
            <TrendingUp size={16} className="text-emerald-700" />
          </div>
          <div className="space-y-1 pt-1">
            {distribution.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2 text-[10px]">
                <span className="text-hiraya-sand w-3">{star}</span>
                <div className="flex-1 h-1.5 bg-cream-200/60 rounded-full overflow-hidden">
                  <div className="h-full bg-hiraya-accent" style={{ width: `${(count / maxBucket) * 100}%` }} />
                </div>
                <span className="text-hiraya-ink w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FILTERS — the Product Reviews list sits directly under them. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter reviews by rating">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={filter === tab.id}
            onClick={() => {
              setFilter(tab.id);
              setPage(0);
            }}
            className={`min-h-[36px] px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${
              filter === tab.id
                ? 'bg-hiraya-accent/15 text-hiraya-ink border-hiraya-accent/40 font-medium'
                : 'text-hiraya-ink border-hiraya-structure-line/80 hover:border-hiraya-structure-line'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="space-y-3" aria-labelledby="product-reviews-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 id="product-reviews-heading" className="font-serif text-[clamp(1.1rem,1.8vw,1.4rem)] uppercase tracking-[0.05em] text-navy-900">
            Product Reviews
          </h3>
          <span className="text-[11px] text-hiraya-ink-muted">
            {visible.length} {visible.length === 1 ? 'review' : 'reviews'}
            {filter !== 'all' && ` · ${filter} star`}
          </span>
        </div>

        {isLoading ? (
          <div className={`flex items-center gap-2 p-6 text-xs text-hiraya-sand ${card}`}>
            <Loader2 size={14} className="animate-spin" /> Loading reviews…
          </div>
        ) : isError ? (
          <div className={`flex flex-wrap items-center justify-between gap-3 p-4 text-xs text-hiraya-ink ${card}`}>
            The reviews could not be loaded.
            <button type="button" onClick={() => refetch()} className="min-h-[36px] cursor-pointer rounded-lg border border-hiraya-structure-line px-3 py-1.5 text-[11px] font-semibold">
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className={`p-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest ${card}`}>
            {reviews.length === 0
              ? 'No reviews yet — customers review each product from My Orders once it is delivered'
              : 'No reviews match this filter'}
          </div>
        ) : (
          paged.map((r) => (
            <article key={r.key} className={`p-4 ${card} space-y-2 text-xs`}>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-hiraya-structure-line/80 pb-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-hiraya-ink">
                    <Package size={14} className="shrink-0" />
                    <span className="truncate">
                      {r.type === 'order' ? `Order #${r.order_id ?? '—'} experience` : r.product_name || `Product #${r.product_id}`}
                    </span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-hiraya-sand">
                    <span className="truncate">{r.customer_name || 'Customer'}</span>
                    {r.customer_email && (
                      <>
                        <Mail size={11} className="shrink-0" />
                        <span className="truncate">{r.customer_email}</span>
                      </>
                    )}
                    {r.type === 'product' && r.order_id && <span className="rounded bg-navy-900/5 px-1.5 py-0.5 font-mono">Order #{r.order_id}</span>}
                    {(r.size || r.color) && <span>{[r.size && `Size ${r.size}`, r.color].filter(Boolean).join(' · ')}</span>}
                  </p>
                </div>
                <span className="flex items-center gap-0.5" aria-label={r.rating ? `${r.rating} out of 5 stars` : 'Unrated'}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={13} className={r.rating >= n ? 'text-amber-500' : 'text-amber-500/40'} fill={r.rating >= n ? 'currentColor' : 'none'} />
                  ))}
                </span>
              </div>
              <p className="text-hiraya-ink leading-relaxed font-light break-words">{r.comment || '(no written review)'}</p>
              {r.has_image && <ReviewPhoto id={r.id} />}
              {r.created_at && <p className="text-[10px] text-hiraya-sand">{new Date(r.created_at).toLocaleString()}</p>}
            </article>
          ))
        )}
      </section>

      {visible.length > PAGE_SIZE && (
        <div className={`flex items-center justify-between gap-3 px-4 py-3 ${card} font-mono`}>
          <p className="text-[10px] uppercase tracking-wider text-hiraya-ink-muted tabular-nums">
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visible.length)} of {visible.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[10px] uppercase tracking-wider text-hiraya-ink tabular-nums min-w-[4.5rem] text-center">
              Page {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              aria-label="Next page"
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeedbackTab;

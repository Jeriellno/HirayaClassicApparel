import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Mail, Package, Star } from 'lucide-react';
import api from '../../../api/axios';

const STEP = 5;

/**
 * PRODUCT REVIEWS — the verified-purchase reviews customers leave from My
 * Orders after delivery (1-5 stars + comment). The same reviews feed the star
 * rating on the shop's product cards and the dashboard's product rating.
 */
const ProductReviewsPanel = () => {
  const [shown, setShown] = useState(STEP);
  const { data = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['admin-product-reviews'],
    queryFn: async () => (await api.get('/admin/product-reviews')).data,
    staleTime: 60 * 1000,
  });

  const reviews = Array.isArray(data) ? data : [];
  const average = reviews.length ? reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 pt-4">
        <h3 className="font-serif text-[clamp(1.1rem,1.8vw,1.4rem)] uppercase tracking-[0.05em] text-navy-900">
          Product Reviews
        </h3>
        {average != null && (
          <span className="text-[11px] text-hiraya-ink">
            <Star size={12} className="mr-1 inline text-amber-500" fill="currentColor" />
            {average.toFixed(1)} average · {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 p-6 text-xs text-hiraya-sand bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80">
          <Loader2 size={14} className="animate-spin" /> Loading reviews…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between gap-3 p-4 text-xs text-hiraya-ink bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80">
          The reviews are taking longer than usual to load.
          <button type="button" onClick={() => refetch()} className="cursor-pointer rounded-lg border border-hiraya-structure-line px-3 py-1.5 text-[11px] font-semibold">
            Try again
          </button>
        </div>
      ) : reviews.length === 0 ? (
        <div className="p-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80">
          No product reviews yet
        </div>
      ) : (
        <>
          {reviews.slice(0, shown).map((r) => (
            <div key={r.id} className="p-4 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-hiraya-structure-line/80 pb-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-hiraya-ink">
                    <Package size={14} className="shrink-0" />
                    <span className="truncate">{r.product_name || `Product #${r.product_id}`}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-hiraya-sand">
                    <span className="truncate">{r.customer_name || 'Customer'}</span>
                    {r.customer_email && (<><Mail size={11} className="shrink-0" /><span className="truncate">{r.customer_email}</span></>)}
                    {r.order_id && <span className="rounded bg-navy-900/5 px-1.5 py-0.5 font-mono">Order #{r.order_id}</span>}
                  </p>
                </div>
                <span className="flex items-center gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} size={13} className={r.rating >= n ? 'text-amber-500' : 'text-amber-500/40'} fill={r.rating >= n ? 'currentColor' : 'none'} />
                  ))}
                </span>
              </div>
              {r.comment && <p className="text-hiraya-ink leading-relaxed font-light">{r.comment}</p>}
              {r.image && <img src={r.image} alt="Photo attached to the review" className="h-24 w-24 rounded-lg object-cover" />}
              {r.created_at && <p className="text-[10px] text-hiraya-sand">{new Date(r.created_at).toLocaleString()}</p>}
            </div>
          ))}
          {reviews.length > shown && (
            <button
              type="button"
              onClick={() => setShown((n) => n + STEP)}
              className="w-full cursor-pointer rounded-[22px] bg-hiraya-surface py-3 text-[11px] font-semibold text-hiraya-ink shadow-neu ring-1 ring-cream-50/80"
            >
              Show more reviews ({reviews.length - shown} left)
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default ProductReviewsPanel;

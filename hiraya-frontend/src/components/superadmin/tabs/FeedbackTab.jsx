import React, { useState } from 'react';
import { Star, MessageSquare, TrendingUp, Mail, ChevronLeft, ChevronRight, Package } from 'lucide-react';
import ProductReviewsPanel from './ProductReviewsPanel';

/** Responses per page; the sixth starts page two (matches the Inventory Catalog). */
const PAGE_SIZE = 5;

/**
 * CUSTOMERS FEEDBACK — named only: every entry comes from a signed-in
 * customer (GET /admin/customer-feedback). Readable by admins and the super admin.
 *
 * The tab previously rendered a flat list of message + rating with no summary
 * at all — an "average rating" could not be read off it without counting by
 * hand, and there was no way to find the low-rated responses that are the ones
 * worth reading first.
 *
 * This adds the aggregates that make the page answer a question rather than
 * just display rows:
 *   - average rating (over rows that ACTUALLY carry one)
 *   - a 1–5 star distribution
 *   - a rating filter (all / 5..1 / unrated)
 *
 * The average deliberately skips rows with no rating rather than assuming a
 * default, so the figure is never inflated by silent 5s. The old per-row
 * `fb.rating || 5` did exactly that — it printed 5/5 for every unrated row.
 */
const FeedbackTab = ({ feedbacks = [] }) => {
  const [filter, setFilter] = useState('all');

  const rated = feedbacks.filter(
    (fb) => fb.rating !== null && fb.rating !== undefined && fb.rating !== ''
  );

  const averageRating =
    rated.length > 0
      ? rated.reduce((acc, fb) => acc + Number(fb.rating), 0) / rated.length
      : null;

  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: rated.filter((fb) => Number(fb.rating) === star).length,
  }));
  const maxBucket = Math.max(1, ...distribution.map((d) => d.count));

  const visible = feedbacks.filter((fb) => {
    if (filter === 'all') return true;
    if (filter === 'unrated') return fb.rating === null || fb.rating === undefined || fb.rating === '';
    return Number(fb.rating) === Number(filter);
  });

  /*
   * PAGINATION — five responses per page, same as the Inventory Catalog. It
   * pages the FILTERED list, so each rating filter has its own pages; switching
   * the filter resets to page one, and `safePage` clamps if the list shrinks.
   */
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pagedFeedback = visible.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      <div>
        <h2 className="font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase tracking-[0.05em] text-navy-900">
          Customers Feedback
        </h2>
      </div>

      {/* AGGREGATES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Responses</span>
            <MessageSquare size={16} className="text-hiraya-ink" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">{feedbacks.length}</p>
        </div>

        <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Average Rating</span>
            <Star size={16} className="text-hiraya-ink" fill="#541A1A" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">
            {averageRating === null ? '—' : averageRating.toFixed(1)}
          </p>
          <p className="text-[10px] text-hiraya-sand">
            {rated.length > 0 ? `from ${rated.length} rated` : 'no ratings yet'}
          </p>
        </div>

        <div className="p-5 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-2">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Distribution</span>
            <TrendingUp size={16} className="text-emerald-700" />
          </div>
          <div className="space-y-1 pt-1">
            {distribution.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2 text-[10px]">
                <span className="text-hiraya-sand w-3">{star}</span>
                <div className="flex-1 h-1.5 bg-cream-200/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-hiraya-accent"
                    style={{ width: `${(count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="text-hiraya-ink w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FILTER */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'all', label: 'All' },
          { id: '5', label: '5★' },
          { id: '4', label: '4★' },
          { id: '3', label: '3★' },
          { id: '2', label: '2★' },
          { id: '1', label: '1★' },
          { id: 'unrated', label: 'Unrated' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setFilter(tab.id);
              setPage(0); // each filter starts on its first page
            }}
            className={`px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${
              filter === tab.id
                ? 'bg-hiraya-accent/15 text-hiraya-ink border-hiraya-accent/40 font-medium'
                : 'text-hiraya-ink border-hiraya-structure-line/80 hover:text-hiraya-ink hover:border-hiraya-structure-line'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.length > 0 ? (
          pagedFeedback.map((fb, idx) => {
            const hasRating =
              fb.rating !== null && fb.rating !== undefined && fb.rating !== '';
            return (
              <div key={fb.id || idx} className="p-4 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 space-y-2 text-xs">
                <div className="flex justify-between items-center border-b border-hiraya-structure-line/80 pb-2">
                  {/*
                   * SENDER = the account's name AND email. New feedback can only
                   * come from a signed-in account with an email; rows saved
                   * before that rule have no email and are marked as such.
                   */}
                  <div className="min-w-0">
                    <span className="font-mono text-hiraya-ink flex items-center gap-2">
                      <MessageSquare size={14} className="text-hiraya-ink shrink-0" />
                      <span className="truncate font-semibold">{fb.customer_name}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-hiraya-sand">
                      <Mail size={11} className="shrink-0" />
                      <span className="truncate">{fb.customer_email}</span>
                    </span>
                    {fb.order_id && (
                      <span className="mt-1 inline-block rounded bg-navy-900/5 px-1.5 py-0.5 font-mono text-[10px] text-hiraya-ink">
                        Order #{fb.order_id} · order experience
                      </span>
                    )}
                  </div>
                  <span className="text-hiraya-ink font-mono flex items-center gap-1 text-[11px] bg-hiraya-accent/10 px-2 py-0.5 rounded border border-hiraya-accent/20">
                    <Star size={12} fill="#541A1A" />
                    {hasRating ? `${fb.rating} / 5` : 'Unrated'}
                  </span>
                </div>
                <p className="text-hiraya-ink leading-relaxed font-light">
                  {/*
                   * `comment` is the ONLY text column on `feedbacks` (see the
                   * Feedback model). The old `fb.comment || fb.message` fallback
                   * referenced a field that does not exist — harmless only
                   * because `comment` was checked first, but it made the contract
                   * look like there were two. One real field, one read.
                   */}
                  {fb.comment || '(no comment)'}
                </p>
                {Array.isArray(fb.order_products) && fb.order_products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {fb.order_products.map((item, i) => (
                      <span
                        key={`${item.name}-${i}`}
                        className="inline-flex items-center gap-1 rounded-full border border-hiraya-structure-line bg-cream-200/50 px-2 py-0.5 text-[10px] text-hiraya-ink"
                      >
                        <Package size={11} className="shrink-0" />
                        {item.name}
                        <span className="text-hiraya-sand">
                          {[item.size, item.color].filter(Boolean).join(' · ')}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                        </span>
                        {!item.in_shop && <span className="text-hiraya-sand">(no longer in shop)</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80">
            {feedbacks.length === 0 ? 'No customers feedback received yet' : 'Nothing matches this filter'}
          </div>
        )}
      </div>

      {/* PAGINATION — shown once the current filter has more than one page. */}
      {visible.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-hiraya-surface rounded-[22px] shadow-neu ring-1 ring-cream-50/80 font-mono">
          <p className="text-[10px] uppercase tracking-wider text-hiraya-ink-muted tabular-nums">
            {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, visible.length)} of {visible.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              aria-label="Previous page"
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-hiraya-structure-line bg-cream-200/60 text-hiraya-ink hover:bg-cream-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      <ProductReviewsPanel />
    </div>
  );
};

export default FeedbackTab;
import React, { useState } from 'react';
import { Star, MessageSquare, TrendingUp } from 'lucide-react';

/**
 * SUPER ADMIN — USER FEEDBACK.
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

  return (
    <div className="space-y-6 animate-fadeIn max-w-4xl">
      <div>
        <h2 className="text-xl font-light uppercase tracking-[0.2em] text-hiraya-ink">
          Student &amp; User Feedback
        </h2>
        <p className="text-xs text-hiraya-ink mt-1">
          Review research responses and student satisfaction ratings.
        </p>
      </div>

      {/* AGGREGATES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Responses</span>
            <MessageSquare size={16} className="text-hiraya-ink" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">{feedbacks.length}</p>
        </div>

        <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Average Rating</span>
            <Star size={16} className="text-hiraya-ink" fill="#CB997E" />
          </div>
          <p className="text-3xl font-mono font-bold text-hiraya-ink pt-1">
            {averageRating === null ? '—' : averageRating.toFixed(1)}
          </p>
          <p className="text-[10px] text-hiraya-sand">
            {rated.length > 0 ? `from ${rated.length} rated` : 'no ratings yet'}
          </p>
        </div>

        <div className="p-5 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-hiraya-ink">
            <span className="text-[10px] font-mono uppercase tracking-wider">Distribution</span>
            <TrendingUp size={16} className="text-emerald-400" />
          </div>
          <div className="space-y-1 pt-1">
            {distribution.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2 text-[10px]">
                <span className="text-hiraya-sand w-3">{star}</span>
                <div className="flex-1 h-1.5 bg-hiraya-cream/60 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#CB997E]"
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
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-2 rounded-lg text-[10px] uppercase tracking-widest border transition cursor-pointer ${
              filter === tab.id
                ? 'bg-[#CB997E]/15 text-hiraya-ink border-[#CB997E]/40 font-medium'
                : 'text-hiraya-ink border-hiraya-olive/15 hover:text-hiraya-ink hover:border-hiraya-olive/30'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {visible.length > 0 ? (
          visible.map((fb, idx) => {
            const hasRating =
              fb.rating !== null && fb.rating !== undefined && fb.rating !== '';
            return (
              <div key={fb.id || idx} className="p-4 bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl space-y-2 text-xs">
                <div className="flex justify-between items-center border-b border-hiraya-olive/15 pb-2">
                  <span className="font-mono text-hiraya-ink flex items-center gap-2">
                    <MessageSquare size={14} className="text-hiraya-ink" />
                    {fb.user_name || 'Anonymous Visitor'}
                  </span>
                  <span className="text-hiraya-ink font-mono flex items-center gap-1 text-[11px] bg-[#CB997E]/10 px-2 py-0.5 rounded border border-[#CB997E]/20">
                    <Star size={12} fill="#CB997E" />
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
              </div>
            );
          })
        ) : (
          <div className="p-8 text-center text-xs font-mono text-hiraya-sand uppercase tracking-widest bg-hiraya-cream border border-hiraya-olive/15 rounded-2xl">
            {feedbacks.length === 0 ? 'No student feedback received yet' : 'Nothing matches this filter'}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbackTab;
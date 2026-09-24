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
        <h2 className="text-xl font-light uppercase tracking-[0.2em] text-[#E9C46A]">
          Student &amp; User Feedback
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Review research responses and student satisfaction ratings.
        </p>
      </div>

      {/* AGGREGATES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider">Responses</span>
            <MessageSquare size={16} className="text-[#E9C46A]" />
          </div>
          <p className="text-3xl font-mono font-bold text-white pt-1">{feedbacks.length}</p>
        </div>

        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-1">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider">Average Rating</span>
            <Star size={16} className="text-[#E9C46A]" fill="#E9C46A" />
          </div>
          <p className="text-3xl font-mono font-bold text-[#E9C46A] pt-1">
            {averageRating === null ? '—' : averageRating.toFixed(1)}
          </p>
          <p className="text-[10px] text-gray-500">
            {rated.length > 0 ? `from ${rated.length} rated` : 'no ratings yet'}
          </p>
        </div>

        <div className="p-5 bg-[#0D1017] border border-white/10 rounded-2xl space-y-2">
          <div className="flex items-center justify-between text-gray-400">
            <span className="text-[10px] font-mono uppercase tracking-wider">Distribution</span>
            <TrendingUp size={16} className="text-emerald-400" />
          </div>
          <div className="space-y-1 pt-1">
            {distribution.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2 text-[10px]">
                <span className="text-gray-500 w-3">{star}</span>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#E9C46A]"
                    style={{ width: `${(count / maxBucket) * 100}%` }}
                  />
                </div>
                <span className="text-gray-400 w-4 text-right">{count}</span>
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
                ? 'bg-[#E9C46A]/15 text-[#E9C46A] border-[#E9C46A]/40 font-medium'
                : 'text-gray-400 border-white/10 hover:text-white hover:border-white/30'
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
              <div key={fb.id || idx} className="p-4 bg-[#0D1017] border border-white/10 rounded-2xl space-y-2 text-xs">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="font-mono text-gray-200 flex items-center gap-2">
                    <MessageSquare size={14} className="text-[#E9C46A]" />
                    {fb.user_name || 'Anonymous Visitor'}
                  </span>
                  <span className="text-[#E9C46A] font-mono flex items-center gap-1 text-[11px] bg-[#E9C46A]/10 px-2 py-0.5 rounded border border-[#E9C46A]/20">
                    <Star size={12} fill="#E9C46A" />
                    {hasRating ? `${fb.rating} / 5` : 'Unrated'}
                  </span>
                </div>
                <p className="text-gray-300 leading-relaxed font-light">
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
          <div className="p-8 text-center text-xs font-mono text-gray-500 uppercase tracking-widest bg-[#0D1017] border border-white/10 rounded-2xl">
            {feedbacks.length === 0 ? 'No student feedback received yet' : 'Nothing matches this filter'}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedbackTab;
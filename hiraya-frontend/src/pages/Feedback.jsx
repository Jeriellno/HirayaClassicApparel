import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Star, Send, Loader2, CheckCircle2, ArrowLeft } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/**
 * Customer feedback / survey page.
 *
 * This is the CLIENT-side writer that the Super Admin console's "User Feedback"
 * tab was missing: it POSTs to /api/feedback, which stores into the `feedbacks`
 * table the console now reads. A guest may submit too (name is optional), so it
 * is a public route.
 */
const Feedback = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rating, setRating] = useState(5);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!comment.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      await api.post('/feedback', {
        rating,
        comment: comment.trim(),
        // Only send a name for guests; a signed-in user is identified by token.
        ...(user ? {} : { name: name.trim() || undefined }),
      });
      setDone(true);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
        'Hindi maipadala ang feedback ngayon. Subukan muli.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-stone-200">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-24 md:pt-28 pb-16">
        <button
          onClick={() => navigate(-1)}
          className="group inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-semibold text-zinc-500 hover:text-stone-200 transition mb-6"
        >
          <ArrowLeft size={13} className="group-hover:-translate-x-0.5 transition-transform" />
          Back
        </button>

        <div className="flex items-center gap-2 mb-1">
          <MessageSquare size={18} className="text-[#E9C46A]" />
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#E9C46A]">
            Share your experience
          </span>
        </div>
        <h1 className="text-2xl font-light uppercase tracking-[0.15em] text-white mb-2">
          Send Feedback
        </h1>
        <p className="text-sm text-zinc-400 mb-8">
          Let us know how we did. Your response helps improve the Hiraya fitting experience.
        </p>

        {done ? (
          <div className="rounded-2xl border-emerald-500/30 bg-emerald-500/10 p-8 text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-400 mb-3" />
            <p className="text-lg text-white">Thank you for your feedback!</p>
            <p className="text-sm text-zinc-400 mt-1">Your response has been recorded.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => { setDone(false); setComment(''); setRating(5); }}
                className="px-4 py-2 rounded-xl border-white/10 text-sm text-zinc-300 hover:text-white transition"
              >
                Send another
              </button>
              <button
                onClick={() => navigate('/shop')}
                className="px-4 py-2 rounded-xl bg-[#E9C46A] text-black font-semibold text-sm hover:bg-[#d8b257] transition"
              >
                Back to shop
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6 rounded-2xl border-white/10 bg-white/5 p-6">
            {error && (
              <div className="rounded-xl border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Rating */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-2">
                Your rating
              </label>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(n)}
                    onMouseEnter={() => setHovered(n)}
                    onMouseLeave={() => setHovered(0)}
                    className="transition-transform hover:scale-110"
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star
                      size={26}
                      className={(hovered || rating) >= n ? 'text-[#E9C46A]' : 'text-zinc-600'}
                      fill={(hovered || rating) >= n ? '#E9C46A' : 'none'}
                    />
                  </button>
                ))}
                <span className="ml-2 text-sm text-zinc-400">{hovered || rating} / 5</span>
              </div>
            </div>

            {/* Guest name */}
            {!user && (
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                  Name (optional)
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Anonymous Visitor"
                  className="w-full rounded-xl border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#E9C46A]"
                />
              </div>
            )}

            {/* Comment */}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-400 mb-1">
                Your feedback <span className="text-red-500">*</span>
              </label>
              <textarea
                required
                rows={5}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us what worked well and what could be better..."
                className="w-full resize-none rounded-xl border-white/10 bg-black/40 px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#E9C46A]"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !comment.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#E9C46A] px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-black transition hover:bg-[#d8b257] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                {submitting ? 'Sending...' : 'Submit feedback'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default Feedback;

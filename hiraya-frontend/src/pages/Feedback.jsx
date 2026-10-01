import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Star, Send, Loader2, CheckCircle2, ArrowLeft, Lock } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/**
 * Customer feedback / survey page.
 *
 * This is the CLIENT-side writer that the Super Admin console's "User Feedback"
 * tab was missing: it POSTs to /api/feedback, which stores into the `feedbacks`
 * table the console now reads.
 *
 * SIGNED-IN ACCOUNTS ONLY. A guest used to be able to type any name, so the
 * console filled with unverifiable "Anonymous Visitor" messages. Now only an
 * account with an email can send: guests get a sign-in prompt, and the sender's
 * name + email come from their account (the API enforces the same rule).
 */
const Feedback = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rating, setRating] = useState(5);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const canSend = Boolean(user?.email);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSend || !comment.trim() || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      // The sender is identified by the account token — no name is sent.
      await api.post('/feedback', {
        rating,
        comment: comment.trim(),
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
    <div className="min-h-screen text-hiraya-ink">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-24 sm:px-6 md:pt-28">
        <button
          onClick={() => navigate(-1)}
          className="btn-quiet group mb-6 cursor-pointer"
        >
          <ArrowLeft size={13} className="transition-transform group-hover:-translate-x-0.5" />
          Back
        </button>

        <div className="section-head mb-8">
          <span className="kicker text-hiraya-structure">
            <MessageSquare size={13} /> Share your experience
          </span>
          <h1 className="display-lg mt-2 text-hiraya-ink">Send Feedback</h1>
          <p className="mt-2 text-sm text-hiraya-ink-muted">
            Let us know how we did. Your response helps improve the Hiraya fitting experience.
          </p>
        </div>

        {!canSend ? (
          /* GUESTS: sign in first — feedback is tied to an account email. */
          <div className="card-raised p-8 text-center">
            <Lock size={30} className="mx-auto mb-3 text-hiraya-ink-muted" />
            <p className="text-lg text-hiraya-ink">Sign in to send feedback</p>
            <p className="mt-1 text-sm text-hiraya-ink-muted">
              Only customers with an account email can send feedback, so we can follow up with you.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button onClick={() => navigate('/register')} className="btn-secondary cursor-pointer">
                Create account
              </button>
              <button
                onClick={() => navigate('/login', { state: { from: '/feedback' } })}
                className="btn-primary cursor-pointer"
              >
                Sign in
              </button>
            </div>
          </div>
        ) : done ? (
          <div className="card-raised border-emerald-600/40 p-8 text-center">
            <CheckCircle2 size={36} className="mx-auto mb-3 text-emerald-700" />
            <p className="text-lg text-hiraya-ink">Thank you for your feedback!</p>
            <p className="mt-1 text-sm text-hiraya-ink-muted">Your response has been recorded.</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => { setDone(false); setComment(''); setRating(5); }}
                className="btn-secondary cursor-pointer"
              >
                Send another
              </button>
              <button
                onClick={() => navigate('/shop')}
                className="btn-primary cursor-pointer"
              >
                Back to shop
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card-raised space-y-6 p-6">
            {error && (
              <div className="rounded-sm border border-red-600/40 bg-red-500/12 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Rating */}
            <div>
              <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
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
                    className="cursor-pointer transition-transform hover:scale-110"
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    {/*
                     * THE STARS USE A SEMANTIC AMBER.
                     *
                     * They were drawn with `fill="#541A1A"` — the maroon brand
                     * accent — because the old palette had no dedicated rating
                     * colour. Marquee stars are a UNIVERSAL signal, not a brand
                     * mark, so they now use the standard amber rating pair; the
                     * surrounding panel carries the identity instead.
                     */}
                    <Star
                      size={26}
                      className={(hovered || rating) >= n ? 'text-amber-500' : 'text-hiraya-structure-line'}
                      fill={(hovered || rating) >= n ? 'currentColor' : 'none'}
                    />
                  </button>
                ))}
                <span className="ml-2 text-sm text-hiraya-ink-muted">{hovered || rating} / 5</span>
              </div>
            </div>

            {/* SENDER — read from the account, not typed. */}
            <div>
              <p className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                Sending as
              </p>
              <p className="text-sm text-hiraya-ink">
                <span className="font-semibold">{user.full_name || user.name || user.email}</span>
                <span className="text-hiraya-ink-muted"> · {user.email}</span>
              </p>
            </div>

            {/* Comment */}
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                Your feedback <span className="text-red-600">*</span>
              </label>
              <textarea
                required
                rows={5}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us what worked well and what could be better..."
                className="field resize-none text-sm"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting || !comment.trim()}
                className="btn-primary cursor-pointer"
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

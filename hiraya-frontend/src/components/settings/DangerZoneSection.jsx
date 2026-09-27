import { useState } from 'react';
import { AlertTriangle, Trash2, Loader2 } from 'lucide-react';
import api from '../../api/axios';

/**
 * Danger Zone — permanent account deletion.
 *
 * This is the one irreversible action in Account Settings, so it deliberately
 * sits OUTSIDE the main <form> (a stray submit must never trigger it) and
 * requires:
 *
 *   1. A modal confirmation (double click-through)
 *   2. The user's CURRENT password (proof of ownership)
 *   3. Typing the word DELETE (proof of intent)
 *
 * On success the backend revokes every token and the parent page navigates
 * back to /login via the `onDeleted` callback.
 */
export const DangerZoneSection = ({ onDeleted }) => {
  const [showModal, setShowModal] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const openModal = () => {
    setPassword('');
    setConfirmText('');
    setError('');
    setShowModal(true);
  };

  const closeModal = () => {
    if (loading) return;
    setShowModal(false);
  };

  const handleDelete = async () => {
    if (!password) {
      setError('Please enter your current password to confirm.');
      return;
    }
    if (confirmText.trim().toUpperCase() !== 'DELETE') {
      setError('Type DELETE (in capital letters) to confirm.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api.delete('/user/account', { data: { password } });
      setShowModal(false);
      onDeleted?.();
    } catch (err) {
      const apiErrors = err.response?.data?.errors;
      if (apiErrors?.password) {
        setError(Array.isArray(apiErrors.password) ? apiErrors.password[0] : apiErrors.password);
      } else {
        setError(err.response?.data?.message || 'Failed to delete account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <section className="space-y-4 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 shadow-xl">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-400">
          <AlertTriangle size={16} /> Danger Zone
        </h2>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-bold text-hiraya-ink">Delete this account permanently</p>
            <p className="mt-1 text-[10px] text-hiraya-ink">
              Your profile, saved body measurements, and session will be removed. This action
              cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={openModal}
            className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-xs font-extrabold uppercase tracking-widest text-red-400 transition hover:bg-red-500/20"
          >
            <Trash2 size={14} /> Delete Account
          </button>
        </div>
      </section>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-hiraya-olive/60 p-4 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl border border-red-500/30 bg-[#121620] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wider text-red-400">
              <AlertTriangle size={18} /> Delete Account
            </h3>
            <p className="text-xs text-hiraya-ink">
              This will <span className="font-bold text-red-400">permanently delete</span> your
              Hiraya account, including your profile and saved body measurements. This action
              cannot be undone.
            </p>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-hiraya-ink">
                Current Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-4 py-2.5 text-xs text-hiraya-ink focus:border-red-400 focus:outline-none transition"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-hiraya-ink">
                Type <span className="text-red-400">DELETE</span> to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-4 py-2.5 text-xs text-hiraya-ink focus:border-red-400 focus:outline-none transition"
              />
            </label>

            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/15 p-3 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-hiraya-ink transition hover:bg-hiraya-cream/60 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-2.5 text-xs font-extrabold uppercase tracking-widest text-hiraya-ink transition hover:bg-red-600 disabled:opacity-50"
              >
                {loading && <Loader2 size={14} className="animate-spin" />}
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

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
      <section id="account-danger" className="card-raised scroll-mt-32 space-y-5 rounded-[24px] border-red-600/30 p-6 sm:p-8">
        <h2 className="flex items-center gap-3 border-b border-red-600/20 pb-4 text-xs font-semibold uppercase tracking-[0.16em] text-red-700">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/10 text-red-700"><AlertTriangle size={16} /></span>
          Danger Zone
        </h2>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-semibold text-hiraya-ink">Delete this account permanently</p>
            <p className="mt-1 text-[10px] text-hiraya-ink-muted">
              Your profile, saved body measurements, and session will be removed. This action
              cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={openModal}
            className="btn-danger shrink-0 cursor-pointer rounded-full"
          >
            <Trash2 size={14} /> Delete Account
          </button>
        </div>
      </section>

      {showModal && (
        <div
          /*
           * THE SCRIM IS A DARK VEIL, NOT THE PAGE COLOUR.
           *
           * It was `bg-hiraya-peach` — the light canvas colour — so the modal
           * "backdrop" was a solid pale sheet over the page. It read as a second
           * page rather than as an overlay, and it gave the white dialog nothing
           * to separate from. It is now a navy veil with a blur, which is what
           * every other overlay in the system uses.
           */
          className="fixed inset-0 z-50 flex items-center justify-center bg-hiraya-ink/60 p-4 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="card-raised w-full max-w-md space-y-4 rounded-[24px] border-red-600/40 p-6 sm:p-7"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-red-700">
              <AlertTriangle size={18} /> Delete Account
            </h3>
            <p className="text-xs text-hiraya-ink-soft">
              This will <span className="font-semibold text-red-700">permanently delete</span> your
              Hiraya account, including your profile and saved body measurements. This action
              cannot be undone.
            </p>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                Current Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="field"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                Type <span className="text-red-700">DELETE</span> to confirm
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="field"
              />
            </label>

            {error && (
              <div className="rounded-xl border border-red-600/40 bg-red-500/12 p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="btn-secondary cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="btn-danger cursor-pointer"
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

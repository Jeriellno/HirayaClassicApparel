import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * The shared confirmation dialog.
 *
 * WHAT WAS WRONG
 * --------------
 * The card was `bg-[#121212] border border-[#541A1A]/20 rounded-xl p-6
 * shadow-2xl` — a near-BLACK slab. Its title and body are `text-hiraya-ink`,
 * which is NAVY, so the dialog rendered navy text on black at about 1.1:1: the
 * "Logout" heading and the "Are you sure you want to log out…" message were
effectively invisible. (This is the confirmation the navbar raises on every
 * sign-out.)
 *
 * The backdrop had the same problem in reverse: `bg-hiraya-peach` — the light
 * CANVAS colour — so the "veil" was a solid pale sheet rather than a scrim.
 *
 * It is now the shared `.card-raised` panel on a navy veil, so the ink holds
 * ~12:1, and the actions use the standard secondary/danger plates.
 */
const Modal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDanger = false,
}) => {
  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    /*
     * z-[60], one layer above the z-50 edit modals, because a confirmation can
     * be raised FROM inside one (e.g. changing an admin's role on Save).
     */
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : 'Confirm'}
    >
      {/* Blurred Backdrop — a dark scrim, so the dialog separates from the page. */}
      <div
        className="fixed inset-0 bg-hiraya-ink/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="card-raised relative z-10 w-full max-w-sm p-6">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 cursor-pointer text-hiraya-ink-muted transition-colors hover:text-hiraya-accent"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="mb-3">
          <h3 className="font-serif text-base font-medium uppercase tracking-[0.1em] text-hiraya-ink">
            {title}
          </h3>
        </div>

        {/* Body Text */}
        {/* `whitespace-pre-line` keeps the paragraph breaks callers write as "\n\n". */}
        <p className="mb-6 font-sans text-xs leading-relaxed text-hiraya-ink-soft whitespace-pre-line">
          {message}
        </p>

        {/* Actions.
            `isDanger` was declared by the caller and silently IGNORED here — the
            logout dialog asked for a destructive treatment and got the plain
            accent plate. The flag now selects `.btn-danger`, which is the one
            place the system allows a destructive label colour. */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            // Focus lands on the SAFE choice, so a stray Enter never deletes.
            autoFocus
            className="btn-secondary cursor-pointer"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`${isDanger ? 'btn-danger' : 'btn-primary'} cursor-pointer`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
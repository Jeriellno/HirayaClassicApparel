import React, { useEffect } from 'react';
import { X } from 'lucide-react';

const Modal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText ="Confirm",
  cancelText ="Cancel",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Blurred Backdrop */}
      <div 
        className="fixed inset-0 bg-hiraya-olive/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative z-10 w-full max-w-sm bg-[#121212] border border-[#CB997E]/20 rounded-xl p-6 shadow-2xl text-hiraya-ink animate-in fade-in zoom-in-95 duration-150">
        {/* Close Button */}
        <button 
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-hiraya-ink hover:text-hiraya-ink transition-colors"
        >
          <X size={16} />
        </button>

        {/* Header */}
        <div className="mb-3">
          <h3 className="text-base font-serif tracking-[0.15em] text-hiraya-ink font-medium uppercase">
            {title}
          </h3>
        </div>

        {/* Body Text */}
        <p className="text-xs text-hiraya-ink leading-relaxed font-sans mb-6">
          {message}
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink transition-all font-medium"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2 rounded-lg text-xs uppercase tracking-widest font-semibold bg-[#CB997E] text-hiraya-olive hover:bg-hiraya-cream transition-all shadow-md"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
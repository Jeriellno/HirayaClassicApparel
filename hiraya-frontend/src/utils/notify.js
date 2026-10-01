/*
 * notify(message, type) — the app-wide popup notice (replaces window.alert).
 *
 * Fires a DOM event that <Toaster /> (mounted once in App.jsx) renders as an
 * animated toast, so any hook or util can raise a notice without React context
 * plumbing. type: 'info' | 'success' | 'error'.
 */
export const NOTIFY_EVENT = 'hiraya:notify';

export const notify = (message, type = 'info') => {
  if (!message || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: { message: String(message), type } }));
};

export default notify;

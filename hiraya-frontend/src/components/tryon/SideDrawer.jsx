import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

/**
 * SideDrawer — a panel that slides in from the right edge over the studio.
 *
 * UI state only: the caller owns `open`. While closed the panel stays MOUNTED
 * (so whatever it holds keeps its state — a half-typed chat message survives)
 * but it is translated off-screen and marked `inert`, which removes it from
 * the tab order, the accessibility tree and the page tour.
 *
 * Open: a light scrim covers the page (click it to close), Esc closes, focus
 * moves into the panel, and on close it returns to whatever opened it.
 */
const SideDrawer = ({ open, onClose, label, id, className = 'w-[min(390px,calc(100vw-1.5rem))]', children }) => {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  const returnRef = useRef(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;

    if (open) {
      returnRef.current = document.activeElement;
      // Focus the first field (the chat input) or the first control.
      const target = panel.querySelector('input, textarea') || panel.querySelector('button:not([disabled])');
      const t = setTimeout(() => target?.focus({ preventScroll: true }), reduce ? 0 : 280);

      const onKey = (e) => {
        if (e.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', onKey);
      return () => {
        clearTimeout(t);
        document.removeEventListener('keydown', onKey);
      };
    }

    if (returnRef.current && typeof returnRef.current.focus === 'function' && returnRef.current.isConnected) {
      returnRef.current.focus({ preventScroll: true });
      returnRef.current = null;
    }
    return undefined;
  }, [open, onClose, reduce]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="scrim"
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
            className="fixed inset-0 z-[80] bg-navy-950/25 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      <motion.div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal={open}
        aria-label={label}
        inert={!open ? '' : undefined}
        initial={false}
        animate={{ x: open ? '0%' : '112%' }}
        transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 32 }}
        className={`fixed bottom-3 right-3 top-3 z-[90] flex lg:top-[6.25rem] ${className}`}
      >
        {children}
      </motion.div>
    </>
  );
};

SideDrawer.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  label: PropTypes.string.isRequired,
  id: PropTypes.string,
  // Width classes for the panel (the stylist keeps the 390px default).
  className: PropTypes.string,
  children: PropTypes.node,
};

export default SideDrawer;

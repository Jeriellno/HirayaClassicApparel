import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { NOTIFY_EVENT } from '../../utils/notify';

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info };
const TONES = {
  success: 'border-emerald-600/35 text-emerald-700',
  error: 'border-red-600/40 text-red-700',
  info: 'border-hiraya-structure-line text-hiraya-ink',
};

/** Renders `notify()` notices bottom-right; each closes itself after 4.5s. */
export default function Toaster() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const onNotify = (e) => {
      const id = `${Date.now()}-${Math.random()}`;
      setItems((list) => [...list.slice(-3), { id, ...e.detail }]);
      window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
    };
    window.addEventListener(NOTIFY_EVENT, onNotify);
    return () => window.removeEventListener(NOTIFY_EVENT, onNotify);
  }, []);

  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-6 right-4 z-[90] flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {items.map((toast) => {
          const Icon = ICONS[toast.type] || Info;
          return (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              role={toast.type === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-hiraya-surface px-3.5 py-3 text-[12px] shadow-neu ${TONES[toast.type] || TONES.info}`}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <span className="flex-1 leading-relaxed text-hiraya-ink">{toast.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setItems((list) => list.filter((t) => t.id !== toast.id))}
                className="shrink-0 rounded p-0.5 text-hiraya-ink-muted hover:text-hiraya-ink cursor-pointer"
              >
                <X size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Bell, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

/*
 * PRESENTATION-ONLY BELL — ALL NOTIFICATION LOGIC REMOVED.
 *
 * WHAT WAS HERE AND WHY IT IS GONE
 * --------------------------------
 * This component used to own a shared module-level store, a 60s polling loop, a
 * window-focus listener and three write endpoints (`/notifications`,
 * `/notifications/{id}/read`, `/notifications/read-all`).
 *
 * The polling was the single most visible source of repeating background
 * traffic in the Studio: the bell renders TWICE in the Navbar (desktop controls
 * plus the mobile bar), so the loop fired `/notifications` on every tick from
 * two instances, on every page, on every open tab. On the single-threaded dev
 * server that traffic queued behind real work — most visibly DURING A FITTING
 * RENDER, which is the slowest request the app makes (~60-165s). The Network tab
 * showed `/notifications` and `/system-status` repeatedly cancelled behind it.
 *
 * WHAT REMAINS
 * ------------
 * The bell icon and its dropdown, unchanged in appearance and layout, so the
 * Navbar looks and measures exactly as before. It now renders from a fixed empty
 * state: no request, no interval, no listener, no store, no navigation on click.
 *
 * The unread badge is intentionally never rendered, because there is no longer
 * any source that could set it. `unread` is kept as a constant so the badge
 * markup and its styling stay in place for whoever wires this up again.
 *
 * The backend surface (NotificationController, the `/notifications` routes, the
 * OrderStatusChanged notification and the `notifications` table) was deliberately
 * LEFT INTACT — nothing here calls it now, but order-status writes elsewhere in
 * the app still target it.
 */

/** No source can set an unread count any more; kept so the badge markup survives. */
const UNREAD = 0;

/** The bell is a pure view now — it holds no notification data. */
const ITEMS = [];

const NotificationBell = ({ variant = 'light' }) => {
  const { user } = useAuth();

  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onClickAway = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const handleOpen = () => setOpen((v) => !v);

  /*
   * `items` and `unread` are the constant empty state. They were `useState`
   * values fed by the removed store; keeping the names means the JSX below is
   * untouched apart from the handlers that no longer have an endpoint to call.
   */
  const items = ITEMS;
  const unread = UNREAD;

  /*
   * Selecting a notification used to mark it read and route to /orders. There is
   * no notification to select now, so this only closes the panel.
   */
  const handleSelect = () => setOpen(false);

  /*
   * Kept as a no-op so the "Mark all read" control renders where it always did.
   * It is unreachable in practice because the branch requires `unread > 0`, which
   * cannot happen any more.
   */
  const handleMarkAll = () => {};

  if (!user) return null;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={handleOpen}
        className="relative hover:text-stone-200 transition p-1"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1.5 bg-[#E9C46A] text-black font-extrabold text-[9px] w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-80 max-h-96 overflow-y-auto bg-neutral-900/98 backdrop-blur-xl border-[#E9C46A]/25 rounded-xl shadow-2xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 sticky top-0 bg-neutral-900/98">
            <span className="text-[10px] uppercase tracking-widest text-[#E9C46A] font-black">
              Notifications
            </span>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                disabled={loading}
                className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-gray-400 hover:text-[#E9C46A] transition disabled:opacity-50"
              >
                <Check size={11} />
                Mark all read
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] text-gray-500">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => handleSelect(n)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition ${n.read_at ? 'opacity-60' : ''
                  }`}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[#E9C46A] mt-1.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-white uppercase tracking-wide">
                      {n.data?.title || 'Order Update'}
                    </p>
                    <p className="text-[11px] text-gray-400 leading-relaxed mt-0.5">
                      {n.data?.body}
                    </p>
                    <p className="text-[9px] text-gray-600 mt-1">
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

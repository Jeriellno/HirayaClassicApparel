import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';

/*
 * The bell reads the authenticated user's notifications from the backend.
 * TanStack Query shares this state between the desktop and mobile bell instances,
 * while refetch-on-open and refetch-on-focus keep it fresh without the old
 * always-on 60-second polling loop.
 */

const NotificationBell = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const [open, setOpen] = useState(false);
    const boxRef = useRef(null);

    const notificationsQuery = useQuery({
        queryKey: ['notifications'],
        queryFn: async () => {
            const response = await api.get('/notifications');
            return {
                items: Array.isArray(response.data?.notifications) ? response.data.notifications : [],
                unread: Number(response.data?.unread_count || 0),
            };
        },
        enabled: !!user,
        staleTime: 30 * 1000,
        refetchOnWindowFocus: true,
    });

    const markReadMutation = useMutation({
        mutationFn: (id) => api.post(`/notifications/${id}/read`),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    });

    const markAllMutation = useMutation({
        mutationFn: () => api.post('/notifications/read-all'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    });

    const items = notificationsQuery.data?.items || [];
    const unread = notificationsQuery.data?.unread || 0;
    const isLoading = notificationsQuery.isFetching;
    const error = notificationsQuery.isError;

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onClickAway = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

    const handleOpen = () => {
        setOpen((current) => !current);
        if (!open) notificationsQuery.refetch();
    };

  /*
   * Selecting a notification marks it read and routes the customer to orders.
   */
  const handleSelect = (notification) => {
    if (!notification.read_at) markReadMutation.mutate(notification.id);
    setOpen(false);
    const orderId = notification.data?.order_id;
    navigate(orderId ? `/orders?order=${orderId}` : '/orders');
  };

  const handleMarkAll = () => markAllMutation.mutate();

  /*
   * Selecting a notification used to mark it read and route to /orders. There is
   * no notification to select now, so this only closes the panel.
   */
  // Selecting a notification marks it read and routes to orders.

  /*
   * Kept as a no-op so the "Mark all read" control renders where it always did.
   * It is unreachable in practice because the branch requires `unread > 0`, which
   * cannot happen any more.
   */
  // Mark-all-read uses the mutation above.

  if (!user) return null;

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={handleOpen}
        aria-expanded={open}
        aria-controls="notification-panel"
        className="relative flex items-center justify-center w-10 h-10 rounded-full border border-transparent text-hiraya-ink hover:bg-hiraya-cream/60 hover:text-hiraya-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 transition"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1.5 bg-[#CB997E] text-hiraya-olive font-extrabold text-[9px] w-4 h-4 rounded-full flex items-center justify-center shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="notification-panel" className="absolute right-0 mt-3 w-[min(20rem,calc(100vw-2rem))] max-h-96 overflow-y-auto bg-hiraya-cream-deep/95 backdrop-blur-xl border border-[#CB997E]/25 rounded-2xl shadow-2xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-hiraya-olive/15 sticky top-0 bg-hiraya-cream-deep/95">
            <span className="text-[10px] uppercase tracking-widest text-hiraya-ink font-black">
              Notifications
            </span>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                disabled={isLoading || markAllMutation.isPending}
                className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink transition disabled:opacity-50"
              >
                <Check size={11} />
                Mark all read
              </button>
            )}
          </div>

          {error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-red-300">Unable to load notifications.</p>
              <button onClick={() => notificationsQuery.refetch()} className="mt-3 text-[10px] uppercase tracking-widest text-hiraya-ink hover:text-hiraya-ink">
                Try again
              </button>
            </div>
          ) : isLoading && items.length === 0 ? (
            <div className="px-4 py-10 flex items-center justify-center gap-2 text-[11px] text-hiraya-sand">
              <Loader2 size={13} className="animate-spin" /> Loading notifications...
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] text-hiraya-sand">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                onClick={() => handleSelect(n)}
                className={`w-full text-left px-4 py-3 border-b border-hiraya-olive/15 hover:bg-hiraya-cream/60 transition ${n.read_at ? 'opacity-60' : ''
                  }`}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && <span className="w-1.5 h-1.5 rounded-full bg-[#CB997E] mt-1.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-hiraya-ink uppercase tracking-wide">
                      {n.data?.title || 'Order Update'}
                    </p>
                    <p className="text-[11px] text-hiraya-ink leading-relaxed mt-0.5">
                      {n.data?.body}
                    </p>
                    <p className="text-[9px] text-hiraya-olive/70 mt-1">
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

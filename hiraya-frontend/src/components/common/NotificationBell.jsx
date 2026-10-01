import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Loader2, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';

/*
 * The bell reads the authenticated user's notifications from the backend.
 * TanStack Query shares this state between the desktop and mobile bell instances,
 * while refetch-on-open and refetch-on-focus keep it fresh without the old
 * always-on 60-second polling loop.
 */

const NotificationBell = () => {    const { user } = useAuth();
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
   * Notification rows are read-only (not tappable). The only action is the
   * "Review" button on an ORDER DELIVERED notification: it opens that exact
   * order in My Orders, where each delivered line has its own Review Product
   * button.
   */
  const handleReview = (notification) => {
    if (!notification.read_at) markReadMutation.mutate(notification.id);
    setOpen(false);
    navigate(`/orders?order=${notification.data?.order_id}`);
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
        className={`relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-sm border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-nav-ink/60 ${
          open
            ? 'border-hiraya-nav-ink/55 bg-hiraya-nav-ink/12 text-hiraya-nav-ink'
            : 'border-hiraya-nav-ink/20 text-hiraya-nav-muted hover:border-hiraya-nav-ink/45 hover:text-hiraya-nav-ink'
        }`}
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell size={17} strokeWidth={1.6} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-hiraya-maroon text-[9px] font-extrabold text-hiraya-on-accent ring-2 ring-hiraya-nav">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="notification-panel" className="glass absolute right-0 z-50 mt-3 max-h-96 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto text-hiraya-ink">
          <div className="sticky top-0 flex items-center justify-between border-b border-hiraya-structure-line bg-hiraya-surface/95 px-4 py-3 backdrop-blur-xl">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
              Notifications
            </span>
            {unread > 0 && (
              <button
                onClick={handleMarkAll}
                disabled={isLoading || markAllMutation.isPending}
                className="flex cursor-pointer items-center gap-1 text-[9px] uppercase tracking-[0.16em] text-hiraya-ink-muted transition-colors hover:text-hiraya-accent disabled:cursor-not-allowed"
              >
                <Check size={11} />
                Mark all read
              </button>
            )}
          </div>

          {error ? (
            <div className="px-4 py-8 text-center">
              <p className="text-[11px] text-red-700">Unable to load notifications.</p>
              <button onClick={() => notificationsQuery.refetch()} className="btn-quiet mt-3 cursor-pointer">
                Try again
              </button>
            </div>
          ) : isLoading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[11px] text-hiraya-ink-muted">
              <Loader2 size={13} className="animate-spin text-hiraya-accent" /> Loading notifications...
            </div>
          ) : items.length === 0 ? (
            <p className="px-4 py-10 text-center text-[11px] text-hiraya-ink-muted">
              No notifications yet.
            </p>
          ) : (
            items.map((n) => {
              /*
               * Review only on DELIVERED notifications. `order_status` also
               * covers delivered notifications sent before the `action` flag
               * existed.
               */
              const canReview = !!n.data?.order_id
                && (n.data?.action === 'review_products' || n.data?.order_status === 'delivered');

              // Plain, non-tappable row: the message is informational only.
              return (
                <div
                  key={n.id}
                  className={`border-b border-hiraya-structure-line px-4 py-3 last:border-b-0 ${n.read_at ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-hiraya-accent" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-hiraya-ink">
                        {n.data?.title || 'Order Update'}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-hiraya-ink-soft">
                        {n.data?.body}
                      </p>

                      {/* Timestamp on the left, Review button bottom-right. */}
                      <div className="mt-1.5 flex items-end justify-between gap-3">
                        <p className="text-[9px] text-hiraya-ink-muted">
                          {new Date(n.created_at).toLocaleString()}
                        </p>
                        {canReview && (
                          <button
                            type="button"
                            onClick={() => handleReview(n)}
                            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-hiraya-accent-deep bg-hiraya-accent px-3.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-hiraya-on-accent transition-colors hover:bg-hiraya-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                          >
                            <Star size={11} /> Review
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;

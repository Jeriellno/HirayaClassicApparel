import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Wifi } from 'lucide-react';
import api from '../../api/axios';
import { isBackendReachable, subscribeBackendHealth } from '../../utils/backendHealth';

/** Fired on `window` when the connection comes back, for pages that load data by hand. */
export const RECONNECTED_EVENT = 'hiraya:reconnected';

const PROBE_EVERY_MS = 5000;

/**
 * CONNECTION RECOVERY FOR THE WHOLE APP (customer, admin, superadmin).
 *
 * The backend-health flag only flipped back to "reachable" when SOME request
 * succeeded — but once a page had failed, nothing sent another request, so after
 * the internet dropped and returned every screen stayed broken until a manual
 * reload. While the connection is down this probes a cheap public endpoint every
 * few seconds; the moment it answers (or the browser reports it is back online)
 * every query is refetched and RECONNECTED_EVENT tells hand-rolled loaders to
 * reload too. A small pill tells the user what is happening meanwhile.
 */
const ConnectionWatcher = () => {
  const queryClient = useQueryClient();
  const [browserOnline, setBrowserOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [backendUp, setBackendUp] = useState(isBackendReachable);
  const [justRecovered, setJustRecovered] = useState(false);
  const wasDown = useRef(false);

  const down = !browserOnline || !backendUp;

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    const unsubscribe = subscribeBackendHealth(setBackendUp);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      unsubscribe();
    };
  }, []);

  // While down: probe until the backend answers (a success flips the health flag).
  useEffect(() => {
    if (!down) return undefined;
    wasDown.current = true;
    const probe = () => {
      api.get('/system-status', { explicitTimeout: 6000 }).catch(() => {});
    };
    const id = setInterval(probe, PROBE_EVERY_MS);
    return () => clearInterval(id);
  }, [down]);

  // Back up after an outage: reload everything once.
  useEffect(() => {
    if (down || !wasDown.current) return undefined;
    wasDown.current = false;
    queryClient.invalidateQueries();
    window.dispatchEvent(new Event(RECONNECTED_EVENT));
    setJustRecovered(true);
    const id = setTimeout(() => setJustRecovered(false), 3000);
    return () => clearTimeout(id);
  }, [down, queryClient]);

  if (!down && !justRecovered) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4"
    >
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-semibold shadow-lg ${
          down ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
        }`}
      >
        {down ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
        {down
          ? (browserOnline ? 'Reconnecting to Hiraya…' : 'You are offline — reconnecting when your internet is back…')
          : 'Back online — refreshing'}
      </div>
    </div>
  );
};

export default ConnectionWatcher;

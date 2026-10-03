import { createContext, useContext } from 'react';

/*
 * The staff role the console route guard (ProtectedRoute, requireAal2) ALREADY
 * verified. Shared so the console does not look it up a second time — its own
 * lookup used to render the console as `admin` until it finished, which also
 * reset a deep-linked superadmin-only section to the dashboard.
 */
export const StaffSessionContext = createContext(null);

export const useStaffSession = () => useContext(StaffSessionContext);

import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext'; 
import Navbar from './components/common/Navbar';
import './index.css';

// Hooks
import { useMaintenanceMode } from './hooks/useMaintenanceMode';

// Pages
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword'; //  1. IMPORT FORGOT PASSWORD PAGE HERE
import ResetPassword from './pages/ResetPassword'; //  The page the emailed link opens.
import ProductDetail from './pages/ProductDetail';
import Shop from './pages/Shop';
import AiTryOn from './pages/AiTryOn';
import TryOnHistory from './pages/TryOnHistory';
import MainDashboard from './pages/MainDashboard';
import AccountSettings from './pages/AccountSettings';
import Checkout from './pages/Checkout';
import Cart from './pages/Cart';
import MyOrders from './pages/MyOrders';
import Feedback from './pages/Feedback';

// Components
import SuperAdmin from './components/superadmin/SuperAdmin';

// Route guards
import ProtectedRoute, { AdminRoute } from './routes/ProtectedRoute';

// --- UTILS & WRAPPERS ---

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

// Guest Route (Nag-a-auto redirect sa Home kapag nakalogin na)
const GuestRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
};

// --- MAIN ROUTING COMPONENT ---

const AppRoutes = () => {
  const { loading: authLoading, logout } = useAuth();
  const maintenanceHook = useMaintenanceMode() || {};
  /*
   * The public flags that EXIST are consumed, not just displayed.
   *
   * `useMaintenanceMode` exposed registrationsOpen / aiEngineActive /
   * guestAiAccess but NOTHING read them, so the System Settings toggles were
   * stored, shown and enforced by no one — a superadmin could "close
   * registrations" and sign-ups kept working. These are wired to the routes
   * they actually govern.
   *
   * `isMaintenance` was REMOVED: the maintenance mode toggle is gone from the
   * console, so there is no longer a flag to honor or a screen to show.
   *
   * `guestAiAccess` was REMOVED for the same class of reason: nothing read it,
   * and unlike the two below it could not simply be wired up — the try-on
   * pipeline requires an authenticated user, so a guest fitting needs a backend
   * anonymous-session model that does not exist. Its toggle is gone from the
   * console rather than left switched to nothing.
   */
  const registrationsOpen = maintenanceHook.registrationsOpen !== false;
  const aiEngineActive = maintenanceHook.aiEngineActive !== false;

  const location = useLocation();

  /*
   * The app shell is gated ONLY by auth loading, never by a status check. The
   * old maintenance screen was removed from the console, so there is no longer
   * a flag whose arrival could hold the storefront blank.
   */
  const isAppLoading = authLoading;

  //  2. IDAGDAG ANG '/forgot-password' SA hideNavbarRoutes KUNG AYAW MO RING IPAKITA ANG NAVBAR DITO
  const hideNavbarRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/superadmin', '/admin'];
  const currentPath = location.pathname.toLowerCase();
  const shouldHideNavbar = hideNavbarRoutes.some(route => currentPath.startsWith(route));

  /*
   * `isConsolePath` / `isBypassRoute` were REMOVED with the maintenance gate.
   *
   * They existed ONLY to keep the consoles and the auth screens reachable while
   * maintenance mode was on. With that mode gone there is no gate to bypass, so
   * the two variables were dead code that still carried a stale comment about
   * maintenance rules.
   */

  if (isAppLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-hiraya-ink">
        <div className="animate-pulse tracking-[0.3em] uppercase text-xs">
          Hiraya is Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-hiraya-ink">
      {!shouldHideNavbar && <Navbar />}
      <ScrollToTop />

      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Home />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/product/:id" element={<ProductDetail />} />

        {/* Public feedback intake  a guest may submit too. Writes to the
            `feedbacks` table the Super Admin console reads. */}
        <Route path="/feedback" element={<Feedback />} />

        {/*  Guest-Only Routes */}
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />

        {/*
         * REGISTRATIONS GATE.
         *
         * `registrations_open = false` now actually stops sign-ups instead of
         * being a stored flag nothing read. The Login page stays open so
         * EXISTING customers can still sign in — closing registrations must
         * not lock the people already using the store.
         */}
        <Route
          path="/register"
          element={
            registrationsOpen ? (
              <GuestRoute><Register /></GuestRoute>
            ) : (
              <div className="min-h-screen flex items-center justify-center bg-black text-hiraya-ink tracking-widest uppercase text-center p-4">
                <div>
                  <h1 className="text-xl text-hiraya-ink mb-2 font-serif">Hiraya Studio</h1>
                  <p className="text-xs text-hiraya-ink">
                    Registration is currently closed. Please check back later.
                  </p>
                </div>
              </div>
            )
          }
        />

        {/*  4. DAGDAG ROUTE DITO */}
        <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />

        {/*
          * The emailed reset link opens HERE. It must stay PUBLIC — the customer
          * is locked out, so a GuestRoute wrapper is correct — and it must be
          * registered BEFORE the wildcard, or the link silently bounces Home.
          */}
        <Route path="/reset-password" element={<GuestRoute><ResetPassword /></GuestRoute>} />

        {/* Protected Member Routes */}
        {/*
         * AI ENGINE GATE.
         *
         * `ai_engine_active = false` — the master switch for the render
         * pipeline — now actually blocks the Studio instead of being a stored
         * flag nothing read. Everything else in the member area stays
         * reachable; only the fitting surface is paused.
         */}
        <Route
          path="/try-on"
          element={
            aiEngineActive ? (
              <ProtectedRoute><AiTryOn /></ProtectedRoute>
            ) : (
              <ProtectedRoute>
                <div className="min-h-screen flex items-center justify-center bg-black text-hiraya-ink tracking-widest uppercase text-center p-4">
                  <div>
                    <h1 className="text-xl text-hiraya-ink mb-2 font-serif">Hiraya Studio</h1>
                    <p className="text-xs text-hiraya-ink">
                      The virtual fitting room is temporarily unavailable. Please check back later.
                    </p>
                  </div>
                </div>
              </ProtectedRoute>
            )
          }
        />
        <Route path="/try-on/history" element={<ProtectedRoute><TryOnHistory /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
        <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
        <Route path="/cart" element={<ProtectedRoute><Cart /></ProtectedRoute>} />

        {/*  My Orders  standalone destination.
            Previously a tab inside the CustomerAccount dashboard, which has been
            retired. Orders now have their own route so the Navbar can deep-link
            straight to them without a dashboard hop. */}
        <Route path="/orders" element={<ProtectedRoute><MyOrders /></ProtectedRoute>} />

        {/* Legacy /wishlist is kept as a permanent redirect so existing
            bookmarks, notification links and emails never 404. The wishlist no
            longer exists as a section or a table: saved pieces now live in My
            Bag (/cart), the single pre-purchase container, so the old link
            lands the customer on their bag rather than a dead page. */}
        <Route path="/wishlist" element={<Navigate to="/cart" replace />} />
        <Route path="/account" element={<Navigate to="/cart" replace />} />

        {/*  Admin Routes  the shared-gateway"big company" model:
            one login for everyone, and the ROLE decides where you land.
            Admin/superadmin -> /admin/*. Any signed-in customer who tries to
            reach /admin/* by typing the URL is bounced straight back to /shop
            (see ProtectedRoute's forbiddenRedirect), while a signed-out user
            is sent to /login. The API enforces the same rule server-side.

            WHY A WILDCARD: the console is tab-driven (Dashboard, Inventory,
            Orders, ...), so /admin/dashboard, /admin/inventory and friends all
            resolve to the same shell and let it own its internal tab state.
            This keeps deep links like /admin/dashboard working without
            duplicating the console for every tab. */}
        <Route
          path="/admin/*"
          element={
            <AdminRoute>
              <MainDashboard />
            </AdminRoute>
          }
        />
        {/* SUPER ADMIN — AUTH/PERMISSION GATE REMOVED (dev request).
            Renders the console directly with NO login and NO role check, so
            every Super Admin surface is freely reachable while working on it.
            Re-wrap with <ProtectedRoute requiredRole="superadmin"> before
            shipping. NOTE: this only opens the UI — the backend still gates
            /api/admin/* with auth:sanctum + superadmin. */}
        <Route
          path="/superadmin"
          element={<SuperAdmin onLogout={logout} />}
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

export default App;
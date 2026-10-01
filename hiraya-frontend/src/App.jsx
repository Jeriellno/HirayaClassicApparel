import PropTypes from 'prop-types';
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, AuthProvider } from './context/AuthContext';
import { useMaintenanceMode } from './hooks/useMaintenanceMode';

import Home from './pages/Home';
import Shop from './pages/Shop';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AcceptInvitation from './pages/AcceptInvitation';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import AiTryOn from './pages/AiTryOn';
import AccountSettings from './pages/AccountSettings';
import MyOrders from './pages/MyOrders';
import Feedback from './pages/Feedback';
import SuperAdmin from './components/superadmin/SuperAdmin';

import ProtectedRoute from './routes/ProtectedRoute';
import { roleHome } from './utils/consoleAccess';
import Navbar from './components/common/Navbar';
import TourButton from './components/common/TourButton';

const ScrollToTop = () => {
    const { pathname } = useLocation();
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [pathname]);
    return null;
};

const GuestRoute = ({ children }) => {
    const { user, loading } = useAuth();

    if (loading) return null;
    return user ? <Navigate to={roleHome(user)} replace /> : children;
};

GuestRoute.propTypes = {
    children: PropTypes.node.isRequired,
};

/*
 * THE THREE-ROLE ROUTER.
 *
 * One login form for every role; the ROLE decides the destination:
 *
 *     superadmin  ->  MFA  ->  /superadmin   (full console)
 *     admin       ->  MFA  ->  /superadmin   (Products + Orders only)
 *     user        ->  none  ->  /home
 *
 * The `/admin/login` and `/admin/verify-2fa` routes, and the separate
 * `AdminSignIn` / `AdminVerifyTwoFactor` pages behind them, are gone — the second
 * door meant the role was read from two sources and the destination was written
 * out in two files, and one of the two answers was always wrong.
 */
const AppRoutes = () => {
    const { loading: authLoading } = useAuth();
    const location = useLocation();
    const maintenanceHook = useMaintenanceMode() || {};
    const registrationsOpen = maintenanceHook.registrationsOpen !== false;
    const aiEngineActive = maintenanceHook.aiEngineActive !== false;

    if (authLoading) {
        return <ShellNotice title="Hiraya" message="Loading your session..." pending />;
    }

    /*
     * `/activate-account` was removed from this list along with the page itself.
     * There is no activation screen to hide the navbar for any more: an admin who
     * needs to set up an authenticator meets it inside `/accept-invitation` or
     * `/login`, both of which are already listed above.
     */
    const hideNavbarRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/accept-invitation', '/superadmin', '/admin'];
    const currentPath = location.pathname.toLowerCase();
    const showNavbar = !hideNavbarRoutes.some((route) => currentPath.startsWith(route));

    return (
        <>
            <ScrollToTop />
            {showNavbar && (
                /*
                 * Navbar only: it already renders the NotificationBell itself
                 * (desktop and mobile). A second bell mounted here sat in the
                 * header's normal flow at the top-left corner, hidden only while
                 * the navbar was a full-width band.
                 */
                <header className="sticky top-0 z-40">
                    <Navbar />
                </header>
            )}
            {/*
             * THE TOUR LAUNCHER IS MOUNTED HERE, ONCE, FOR THE WHOLE APP.
             *
             * It used to be rendered inside Home.jsx, so the spotlight walkthrough
             * could only be started from one route — a visitor who landed on /shop
             * or /try-on (exactly where the navbar sends them) had no tour at all,
             * and the guides for those pages did not exist.
             *
             * Mounted at this level it survives every route change, and it decides
             * per-page whether to show: TourButton returns null on any route that
             * has no guide of its own, so this costs nothing where there is nothing
             * to point at. It sits below the <Routes> so it is never remounted by
             * navigation and its hint card dismissal survives moving between pages.
             */}
            <TourButton />

            <Routes>
                {/* Public routes */}
                <Route path="/" element={<Home />} />
                {/*
                    THE CUSTOMER LANDING PAGE. `roleHome()` sends every non-privileged
                    role here after sign-in, so this is the destination half of the
                    role branch; `/` is kept for direct links and the wildcard.
                */}
                <Route path="/home" element={<Home />} />
                <Route path="/shop" element={<Shop />} />
                <Route path="/product/:id" element={<ProductDetail />} />
                <Route path="/feedback" element={<Feedback />} />

                {/* Guest-Only Routes */}
                <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />

                <Route
                    path="/register"
                    element={
                        registrationsOpen ? (
                            <GuestRoute><Register /></GuestRoute>
                        ) : (
                            <ShellNotice
                                title="Hiraya Studio"
                                message="Registration is currently closed. Please check back later."
                            />
                        )
                    }
                />

                <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
                <Route path="/reset-password" element={<GuestRoute><ResetPassword /></GuestRoute>} />

                {/*
                 * THE INVITATION ENDPOINT THE EMAILED LINK OPENS.
                 *
                 * Wrapped in `GuestRoute` like the other auth gateways, so a
                 * signed-in visitor is sent to their own home rather than shown a
                 * second sign-up form. The flow inside sets a password, enrolls an
                 * authenticator, and verifies the 6-digit code — and that
                 * verification IS the activation. There is no separate activation
                 * step and no `/activate-account` route any more; see
                 * AcceptInvitation for the reasoning.
                 */}
                <Route path="/accept-invitation" element={<GuestRoute><AcceptInvitation /></GuestRoute>} />

                {/* Protected Storefront Routes */}
                <Route path="/cart" element={<ProtectedRoute><Cart /></ProtectedRoute>} />
                <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />

                <Route
                    path="/try-on"
                    element={
                        aiEngineActive ? (
                            <ProtectedRoute><AiTryOn /></ProtectedRoute>
                        ) : (
                            <ProtectedRoute>
                                <ShellNotice title="Hiraya Studio" message="The AI Fitting Room is offline." />
                            </ProtectedRoute>
                        )
                    }
                />
                {/* Try-On History moved INTO the studio as a drawer; old links and
                    bookmarks land on the studio with the drawer open. */}
                <Route path="/try-on/history" element={<Navigate to="/try-on?history=1" replace />} />
                <Route path="/orders" element={<ProtectedRoute><MyOrders /></ProtectedRoute>} />

                {/*
                    THE CONSOLE. One component, one URL, both privileged roles.
                    `allowedRoles` is a real authorization check — an admin who
                    hand-types a superadmin-only section still gets the section
                    allow-list applied (see SuperAdmin.jsx `resolveSection`), and
                    the backend refuses the API call independently.
                */}
                <Route
                    path="/superadmin"
                    element={
                        <ProtectedRoute allowedRoles={['admin', 'superadmin']} requireAal2>
                            <SuperAdmin />
                        </ProtectedRoute>
                    }
                />

                {/* Old console url — the SAME page, not a second surface. */}
                <Route path="/admin" element={<Navigate to="/superadmin" replace />} />
                <Route path="/admin/*" element={<Navigate to="/superadmin" replace />} />

                {/* Wildcard Catch-all */}
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </>
    );
};

/*
 * SHELL NOTICE — the app-level full-screen states (session loading,
 * registration closed, fitting room offline) as one frosted card on the cream
 * canvas. Presentation only: which state shows is still decided above.
 */
const ShellNotice = ({ title, message, pending = false }) => (
    <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass w-full max-w-sm px-8 py-10 text-center" role={pending ? 'status' : undefined}>
            <h1 className="font-serif text-2xl uppercase tracking-[0.14em] text-hiraya-ink">{title}</h1>
            <span aria-hidden="true" className="mx-auto mt-4 block h-px w-12 bg-hiraya-nav-rule" />
            <p className="mt-4 text-[11px] font-semibold uppercase leading-relaxed tracking-[0.22em] text-hiraya-ink-muted">
                {message}
            </p>
            {pending && (
                <span aria-hidden="true" className="progress-indeterminate mx-auto mt-6 block h-1 w-28 rounded-full bg-hiraya-structure-line" />
            )}
        </div>
    </div>
);

ShellNotice.propTypes = {
    title: PropTypes.string.isRequired,
    message: PropTypes.string.isRequired,
    pending: PropTypes.bool,
};

const App = () => (
    <BrowserRouter>
        <AuthProvider>
            <AppRoutes />
        </AuthProvider>
    </BrowserRouter>
);

export default App;
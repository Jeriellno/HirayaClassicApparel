import PropTypes from 'prop-types';
import { User, Sparkles, LogOut, Settings, Menu, X, Package, ShoppingBag, ChevronDown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useCart } from '../../hooks/useCart';

import logoImg from '../../assets/logo.png';
import Modal from './Modal';
import NotificationBell from './NotificationBell';
import PreferenceControls from './PreferenceControls';
import { useT } from '../../context/PreferencesContext';

/*
 * STYLE HELPERS — presentation only. Each takes the SAME active/inactive
 * boolean the markup always computed, and returns the class list for it, so
 * the ten near-identical className ternaries below share one definition.
 */
const ACTIVE_PILL_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 };
const PANEL_EASE = [0.22, 1, 0.36, 1];

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-nav-ink/60';

// Round glass control (feedback, bag, orders): cream plate when active.
const navControl = (active) =>
    `relative flex items-center justify-center rounded-full border transition-all duration-300 ${focusRing} ${
        active
            ? 'border-cream-100 bg-cream-100 text-navy-950 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)]'
            : 'border-cream-50/15 bg-cream-50/[0.04] text-hiraya-nav-muted hover:border-cream-50/35 hover:bg-cream-50/10 hover:text-hiraya-nav-ink'
    }`;

// A row in the mobile drawer.
const drawerItem = (active) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors duration-200 ${
        active
            ? 'border-cream-100 bg-cream-100 text-navy-950 font-bold'
            : 'border-transparent text-hiraya-nav-muted hover:bg-cream-50/[0.06] hover:text-hiraya-nav-ink'
    }`;

// The cream call-to-action plate used for Login on the dark bar.
const creamPlate =
    'inline-flex items-center justify-center gap-2 rounded-full bg-cream-100 text-navy-950 font-semibold uppercase tracking-[0.16em] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.7)] transition-all duration-300 hover:bg-cream-50 hover:-translate-y-px focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream-100';

const Navbar = () => {
    const { user, logout } = useAuth();
    const location = useLocation();

    const { cartCount } = useCart();
    const t = useT();

    const [isScrolled, setIsScrolled] = useState(false);
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const profileRef = useRef(null);


    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 20);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Close transient navigation surfaces on route changes and Escape. This
    // prevents an overlay or dropdown from lingering over the new destination.
    useEffect(() => {
        setIsMobileMenuOpen(false);
        setIsProfileOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsProfileOpen(false);
                setIsMobileMenuOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setIsMobileMenuOpen(false);
    };

    const closeAll = () => {
        setIsMobileMenuOpen(false);
        setIsProfileOpen(false);
    };

    const handleConfirmLogout = () => {
        setShowLogoutModal(false);
        closeAll();
        logout();
    };

    /*
     * (Placed AFTER every hook — returning before them changed the hook count
     * between storefront and console routes.)
     *
     * The console is a full-bleed surface with its own sidebar, so the storefront
     * navbar is suppressed on it. `/admin` is listed too: it is now only a
     * redirect to `/superadmin`, but the redirect renders one frame first.
     */
    if (location.pathname.startsWith('/superadmin') || location.pathname.startsWith('/admin')) {
        return null;
    }

    // `/home` is the signed-in landing page, so it lights the Home pill too.
    const isHome = location.pathname === '/' || location.pathname === '/home';
    const isShop = location.pathname === '/shop';
    const isTryOn = location.pathname.startsWith('/try-on');

    return (
        // `reducedMotion="user"` turns the sliding pill and panel entrances
        // into instant swaps for visitors who ask for reduced motion.
        <MotionConfig reducedMotion="user">
            {/*
             * THE BAR — "VINTAGE ATELIER".
             *
             * At the top of a page it is a full-width band of deep navy glass
             * finished with a brass hairline (the shopfront fascia). Once the
             * visitor scrolls it detaches into a FLOATING capsule — inset from
             * the viewport edges, rounded, frosted, and lifted on the dark
             * neumorphic shadow — so it reads as a pane hovering over the
             * page instead of a slab sitting on it. Only presentation changes
             * with `isScrolled`; the scroll listener itself is untouched.
             *
             * The capsule stays at 85% navy so that even over the lightest cream
             * page the resolved glass keeps cream ink at 10.9:1 and the muted
             * (inactive) links at 6.8:1. At 75% the muted links fell to 4.4:1.
             */}
            <nav
                className={`theme-locked fixed z-40 border text-hiraya-nav-ink backdrop-blur-2xl backdrop-saturate-150 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    isScrolled
                        ? 'top-2 left-2 right-2 sm:top-3 sm:left-5 sm:right-5 lg:left-8 lg:right-8 rounded-2xl px-3 sm:px-5 lg:px-6 py-2 bg-navy-950/85 border-cream-50/10 shadow-neu-dark'
                        : 'top-0 left-0 right-0 rounded-none px-4 sm:px-8 lg:px-12 py-3 md:py-4 bg-navy-950/92 border-transparent'
                }`}
                style={{ backgroundImage: 'var(--hiraya-nav-sheen)' }}
            >
                {/* The fascia rule — only on the full-width band. Decorative. */}
                <span
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-x-0 bottom-0 h-px bg-hiraya-nav-rule/60 transition-opacity duration-500 ${isScrolled ? 'opacity-0' : 'opacity-100'}`}
                />
                <div className="max-w-7xl mx-auto flex justify-between items-center min-h-11">

                    {/* LOGO & BRAND NAME */}
                    <Link
                        to="/"
                        onClick={scrollToTop}
                        className={`flex items-center gap-2.5 rounded-xl px-1.5 py-1 hover:bg-cream-50/[0.06] transition group shrink-0 ${focusRing}`}
                    >
                        <img
                            src={logoImg}
                            alt="Hiraya Logo"
                            className="h-8 sm:h-9 md:h-10 w-auto object-contain transition-all duration-300 group-hover:scale-105 shrink-0 block drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div className="flex flex-col justify-center">
                            <span className="text-lg sm:text-xl md:text-2xl font-serif tracking-[0.06em] text-hiraya-nav-ink font-semibold leading-none">
                                HIRAYA
                            </span>
                            <span className="hidden sm:block text-[7px] md:text-[8px] uppercase tracking-[0.4em] font-medium mt-1 text-hiraya-nav-muted">
                                {t('nav.tagline')}
                            </span>
                        </div>
                    </Link>

                    {/*
                     * DESKTOP NAV LINKS — a frosted track with ONE cream pill
                     * that glides to the current page (a shared `layoutId`), the
                     * active-state treatment from the motion reference. The
                     * active/inactive tests are the same ones as before.
                     */}
                    <div className="hidden lg:flex items-center gap-1 rounded-full border border-cream-50/10 bg-cream-50/[0.04] p-1 font-semibold uppercase text-[11px] tracking-[0.16em] shrink-0">
                        <Link
                            to="/"
                            onClick={scrollToTop}
                            className={`relative rounded-full px-4 py-2 whitespace-nowrap transition-colors duration-300 ${focusRing} ${isHome ? 'text-navy-950' : 'text-hiraya-nav-muted hover:text-hiraya-nav-ink hover:bg-cream-50/[0.06]'}`}
                        >
                            {isHome && <motion.span layoutId="nav-active-pill" transition={ACTIVE_PILL_SPRING} className="absolute inset-0 rounded-full bg-cream-100 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)]" />}
                            <span className="relative">{t('nav.home')}</span>
                        </Link>
                        <Link
                            to="/shop"
                            className={`relative rounded-full px-4 py-2 whitespace-nowrap transition-colors duration-300 ${focusRing} ${isShop ? 'text-navy-950' : 'text-hiraya-nav-muted hover:text-hiraya-nav-ink hover:bg-cream-50/[0.06]'}`}
                        >
                            {isShop && <motion.span layoutId="nav-active-pill" transition={ACTIVE_PILL_SPRING} className="absolute inset-0 rounded-full bg-cream-100 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)]" />}
                            <span className="relative">{t('nav.shop')}</span>
                        </Link>
                        <Link
                            to="/try-on"
                            className={`relative rounded-full px-4 py-2 whitespace-nowrap group transition-colors duration-300 ${focusRing} ${isTryOn ? 'text-navy-950' : 'text-hiraya-nav-muted hover:text-hiraya-nav-ink hover:bg-cream-50/[0.06]'}`}
                        >
                            {isTryOn && <motion.span layoutId="nav-active-pill" transition={ACTIVE_PILL_SPRING} className="absolute inset-0 rounded-full bg-cream-100 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.6)]" />}
                            <span className="relative flex items-center gap-1.5">
                                <Sparkles size={15} className="group-hover:animate-pulse shrink-0" strokeWidth={1.6} />
                                {t('nav.tryon')}
                            </span>
                        </Link>
                        {/* Try-On History now lives inside the AI Try-On studio
                            (the History button in the canvas header). */}
                    </div>

                    {/* Controls Section - Desktop */}
                    <div className="hidden lg:flex items-center gap-2 shrink-0">
                        {/* The Feedback icon that sat here was retired: product
                            reviews from delivered orders replace it. */}

                        <PreferenceControls />

                        {/* Notification bell — always visible for members */}
                        {user && <NotificationBell />}

                        {/* 👑 PROMINENT CART PILL — the single, canonical entry
                            point into My Bag. Routes to the dedicated /cart page;
                            there is intentionally no slide-over drawer. */}
                        {user && (
                            <Link
                                to="/cart"
                                title="Your Bag"
                                aria-label={`Your bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
                                className={`${navControl(location.pathname === '/cart')} gap-2 h-9 px-3.5`}
                            >
                                <ShoppingBag size={17} strokeWidth={1.6} />
                                <span className="text-[10px] font-bold uppercase tracking-[0.16em]">{t('nav.bag')}</span>
                                {cartCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1 bg-cream-400 text-navy-950 font-extrabold text-[9px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center ring-2 ring-navy-950">
                                        {cartCount > 99 ? '99+' : cartCount}
                                    </span>
                                )}
                            </Link>
                        )}

                        <div className={`flex items-center gap-1.5 ${user ? 'border-l border-cream-50/15 pl-2.5 ml-0.5' : ''}`}>
                            {user ? (
                                /* 🧑 CUSTOMER DASHBOARD MENU — Wishlist, Orders and
                                   Settings now live inside one dropdown instead of
                                   three competing header icons. */
                                <div className="relative" ref={profileRef}>
                                    <button
                                        onClick={() => setIsProfileOpen((v) => !v)}
                                        aria-haspopup="menu"
                                        aria-expanded={isProfileOpen}
                                        className={`relative flex items-center gap-2 h-9 pl-3.5 pr-2 rounded-full border transition-all duration-300 ${focusRing} ${isProfileOpen ? 'border-cream-50/40 bg-cream-50/12 text-hiraya-nav-ink' : 'border-cream-50/15 bg-cream-50/[0.04] hover:border-cream-50/35 hover:bg-cream-50/10'}`}
                                    >
                                        <div className="flex flex-col items-start leading-tight">
                                            <span className="text-[8px] uppercase tracking-[0.22em] text-hiraya-nav-muted font-semibold">
                                                {t('nav.member')}
                                            </span>
                                            <span className="text-[12px] font-bold tracking-[0.08em] uppercase text-hiraya-nav-ink">
                                                {user.full_name?.split(' ')[0]}
                                            </span>
                                        </div>
                                        <User size={22} strokeWidth={1.4} className="text-hiraya-nav-ink" />
                                        <ChevronDown
                                            size={14}
                                            className={`transition-transform duration-300 ${isProfileOpen ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    <AnimatePresence>
                                        {isProfileOpen && (
                                            <motion.div
                                                role="menu"
                                                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                                transition={{ duration: 0.22, ease: PANEL_EASE }}
                                                style={{ transformOrigin: 'top right' }}
                                                className="glass absolute right-0 mt-3 w-64 overflow-hidden z-50 text-hiraya-ink"
                                            >
                                                {/*
                                                 * A frosted cream pane (`.glass`) over the page;
                                                 * at 78% fill the name and email keep >= 9:1
                                                 * whatever sits behind it.
                                                 */}
                                                <div className="px-4 py-3 border-b border-hiraya-structure-line">
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.8px] truncate">
                                                        {user.full_name}
                                                    </p>
                                                    <p className="text-[10px] text-hiraya-ink-muted truncate">{user.email}</p>
                                                </div>

                                                {/* Orders and Settings stay here; the bag
                                                    has exactly ONE entry point — the My
                                                    Bag pill in the header. */}
                                                <ProfileMenuItem
                                                    to="/orders"
                                                    icon={<Package size={15} />}
                                                    label={t('nav.orders')}
                                                    onClick={closeAll}
                                                />
                                                <ProfileMenuItem
                                                    to="/settings"
                                                    icon={<Settings size={15} />}
                                                    label={t('nav.settings')}
                                                    onClick={closeAll}
                                                />

                                                <button
                                                    onClick={() => {
                                                        setIsProfileOpen(false);
                                                        setShowLogoutModal(true);
                                                    }}
                                                    className="w-full flex items-center gap-2.5 px-4 py-3 text-[11px] uppercase tracking-[0.16em] font-bold text-red-800 hover:bg-red-500/10 transition-colors border-t border-hiraya-structure-line"
                                                >
                                                    <LogOut size={15} /> {t('nav.logout')}
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            ) : (
                                <Link to="/login" className={`${creamPlate} h-9 px-5 text-[11px] shrink-0 whitespace-nowrap`}>
                                    <User size={15} />
                                    <span>{t('nav.login')}</span>
                                </Link>
                            )}
                        </div>
                    </div>

                    {/* Mobile / Tablet Toggle Button */}
                    <div className="flex items-center gap-1 sm:gap-1.5 lg:hidden">
                        {user && <NotificationBell />}

                        {/* Cart stays reachable on mobile too — same badge rules,
                            same dedicated /cart destination. */}
                        {user && (
                            <Link
                                to="/cart"
                                className={`${navControl(location.pathname === '/cart')} w-9 h-9`}
                                title="Your Bag"
                                aria-label={`Your bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
                            >
                                <ShoppingBag size={18} strokeWidth={1.6} />
                                {cartCount > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-cream-400 text-navy-950 font-extrabold text-[9px] min-w-[16px] h-4 px-0.5 rounded-full flex items-center justify-center ring-2 ring-navy-950">
                                        {cartCount > 99 ? '99+' : cartCount}
                                    </span>
                                )}
                            </Link>
                        )}

                        {/* Orders shortcut. The account dashboard icon was
                            retired with the dashboard itself — orders and the
                            bag are each reachable directly from the header. */}
                        {user && (
                            <Link
                                to="/orders"
                                className={`${navControl(location.pathname === '/orders')} w-9 h-9`}
                                title="My Orders"
                                aria-label="My orders"
                            >
                                <Package size={18} strokeWidth={1.6} />
                            </Link>
                        )}

                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className={`${navControl(isMobileMenuOpen)} w-9 h-9`}
                            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                            aria-expanded={isMobileMenuOpen}
                            aria-controls="mobile-navigation"
                        >
                            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>

                </div>

                {/* Mobile Drawer Dropdown */}
                <AnimatePresence>
                    {isMobileMenuOpen && (
                        <motion.div
                            id="mobile-navigation"
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.25, ease: PANEL_EASE }}
                            className="lg:hidden mt-3 p-3 rounded-2xl border border-cream-50/10 bg-navy-900/80 text-hiraya-nav-ink shadow-neu-dark max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain"
                        >
                            <div className="flex flex-col gap-1 font-semibold uppercase text-xs tracking-[0.14em]">
                                <Link
                                    to="/"
                                    onClick={scrollToTop}
                                    className={drawerItem(isHome)}
                                >
                                    {t('nav.home')}
                                </Link>
                                <Link
                                    to="/shop"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className={drawerItem(location.pathname === '/shop')}
                                >
                                    {t('nav.shop')}
                                </Link>
                                <Link
                                    to="/try-on"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className={drawerItem(location.pathname === '/try-on')}
                                >
                                    <Sparkles size={18} className={location.pathname === '/try-on' ? 'text-navy-950' : 'text-hiraya-nav-muted'}/>
                                    {t('nav.tryon')}
                                </Link>
                                {/* The separate Feedback page was merged into Product
                                    Reviews (rate + review from My Orders). */}

                                {user && (
                                    <>
                                        <Link
                                            to="/cart"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={`${drawerItem(location.pathname === '/cart')} justify-between`}
                                        >
                                            <span className="flex items-center gap-2">
                                                <ShoppingBag size={18} /> {t('nav.bag')}
                                            </span>
                                            {cartCount > 0 && (
                                                <span className="bg-cream-400 text-navy-950 text-[10px] font-black px-2 py-0.5 rounded-full">
                                                    {cartCount}
                                                </span>
                                            )}
                                        </Link>

                                        {/* The wishlist is gone entirely — saved
                                            items now live inside My Bag (/cart). */}
                                        <Link
                                            to="/orders"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={drawerItem(location.pathname === '/orders')}
                                        >
                                            <Package size={18} /> {t('nav.orders')}
                                        </Link>
                                        <Link
                                            to="/settings"
                                            onClick={() => setIsMobileMenuOpen(false)}
                                            className={drawerItem(location.pathname === '/settings')}
                                        >
                                            <Settings size={18} /> {t('nav.settingsShort')}
                                        </Link>
                                    </>
                                )}
                            </div>

                            <div className="mt-3 flex justify-center">
                                <PreferenceControls />
                            </div>

                            {/* Mobile Actions */}
                            <div className="mt-3 pt-4 border-t border-cream-50/15 flex items-center justify-between">
                                {user ? (
                                    <div className="flex items-center justify-between w-full">
                                        <div>
                                            <span className="text-[10px] uppercase tracking-widest text-hiraya-nav-muted font-black block">
                                                {t('nav.loggedInAs')}
                                            </span>
                                            <span className="text-sm font-bold tracking-wide uppercase text-hiraya-nav-ink">
                                                {user.full_name}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => setShowLogoutModal(true)}
                                            className="flex items-center gap-2 px-4 py-2 rounded-full border border-red-400/30 bg-red-500/15 text-red-200 text-xs font-bold transition-colors hover:bg-red-500/25"
                                        >
                                            <LogOut size={16} /> {t('nav.logout')}
                                        </button>
                                    </div>
                                ) : (
                                    <Link
                                        to="/login"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`${creamPlate} w-full py-3 text-[11px]`}
                                    >
                                        <User size={15} /> {t('nav.loginAccount')}
                                    </Link>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </nav>

            {/* Reusable Logout Confirmation Modal */}
            <Modal
                isOpen={showLogoutModal}
                onClose={() => setShowLogoutModal(false)}
                onConfirm={handleConfirmLogout}
                title={t('nav.logoutTitle')}
                message={t('nav.logoutBody')}
                confirmText={t('nav.logoutConfirm')}
                cancelText={t('common.cancel')}
                isDanger={true}
            />
        </MotionConfig>
    );
};

/**
 * A single row inside the desktop profile dropdown.
 * Kept tiny and local because it is only ever used by the Navbar.
 */
const ProfileMenuItem = ({ to, icon, label, badge = 0, onClick }) => (
    <Link
        to={to}
        role="menuitem"
        onClick={onClick}
        className="flex items-center gap-2.5 px-4 py-3 text-[11px] uppercase tracking-[0.16em] font-semibold text-hiraya-ink hover:bg-hiraya-accent hover:text-hiraya-on-accent transition-colors border-b border-hiraya-structure-line last:border-b-0"
    >
        <span>{icon}</span>
        <span className="flex-1">{label}</span>
        {badge > 0 && (
            <span className="bg-hiraya-accent text-hiraya-on-accent text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {badge}
            </span>
        )}
    </Link>
);

ProfileMenuItem.propTypes = {
    to: PropTypes.string.isRequired,
    icon: PropTypes.node.isRequired,
    label: PropTypes.string.isRequired,
    badge: PropTypes.number,
    onClick: PropTypes.func,
};

export default Navbar;

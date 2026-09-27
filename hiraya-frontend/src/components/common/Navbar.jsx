import { User, Sparkles, LogOut, Settings, Menu, X, Package, ShoppingBag, ChevronDown, MessageSquare, History } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useCart } from '../../hooks/useCart';

import logoImg from '../../assets/logo.png';
import Modal from './Modal';
import SearchBar from './SearchBar';
import NotificationBell from './NotificationBell';

const Navbar = () => {
    const { user, logout } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const { cartCount } = useCart();

    const [isScrolled, setIsScrolled] = useState(false);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [showLogoutModal, setShowLogoutModal] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const profileRef = useRef(null);

    if (location.pathname.startsWith('/admin')) {
        return null;
    }

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
        setIsSearchOpen(false);
    }, [location.pathname, location.search]);

    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                setIsProfileOpen(false);
                setIsMobileMenuOpen(false);
                setIsSearchOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, []);

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        if (searchQuery.trim()) {
            navigate(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
            setIsSearchOpen(false);
            setSearchQuery('');
            setIsMobileMenuOpen(false);
        }
    };

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

    return (
        <>
            <nav
                className={`fixed top-0 left-0 right-0 z-40 px-4 sm:px-8 lg:px-12 transition-all duration-300 ease-in-out text-hiraya-ink ${
                    isScrolled
                        ? 'py-2.5 bg-hiraya-cream-deep/95 backdrop-blur-2xl border-b border-hiraya-olive/15 shadow-lg shadow-hiraya-sand/30'
                        : /*
                           * The resting state fades the CREAM canvas into the bar.
                           * Every ink in this header is olive, so the bar must be the
                           * light surface those inks are readable on — a dark scrim
                           * would put olive text on a dark strip.
                           */
                          'py-3 md:py-4 bg-gradient-to-b from-hiraya-bg via-hiraya-bg/70 to-transparent border-b border-transparent'
                }`}
            >
                <div className="max-w-7xl mx-auto flex justify-between items-center min-h-11">

                    {/* LOGO & BRAND NAME */}
                    <Link
                        to="/"
                        onClick={scrollToTop}
                        className="flex items-center gap-2.5 rounded-xl px-1 py-1 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 transition group shrink-0"
                    >
                        <img
                            src={logoImg}
                            alt="Hiraya Logo"
                            className="h-8 sm:h-9 md:h-10 w-auto object-contain transition-all duration-300 group-hover:scale-105 shrink-0 block drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div className="flex flex-col justify-center">
                            <span className="text-lg sm:text-xl md:text-2xl font-serif tracking-[0.10em] text-hiraya-ink font-medium leading-none">
                                HIRAYA
                            </span>
                            <span className="hidden sm:block text-[6px] sm:text-[7px] uppercase tracking-[0.35em] font-semibold mt-0.5 text-hiraya-olive/70">
                                Virtual Wardrobe
                            </span>
                        </div>
                    </Link>

                    {/* Desktop Navigation Links (Nakalagay sa lg breakpoint para hindi mag-overlap sa medium screens) */}
                    <div className="hidden lg:flex items-center gap-1 xl:gap-2 font-semibold uppercase text-[12px] tracking-[0.13em] shrink-0 text-hiraya-ink p-1 rounded-full border border-hiraya-olive/15 bg-white/[0.04] backdrop-blur-md">
                        <Link
                            to="/"
                            onClick={scrollToTop}
                            className={`relative px-4 py-2 rounded-full transition whitespace-nowrap hover:text-hiraya-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname === '/' ? 'text-hiraya-ink bg-[#CB997E]/25 font-bold' : 'text-hiraya-ink/70'}`}
                        >
                            Home
                        </Link>
                        <Link
                            to="/shop"
                            className={`relative px-4 py-2 rounded-full transition whitespace-nowrap hover:text-hiraya-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname === '/shop' ? 'text-hiraya-ink bg-[#CB997E]/25 font-bold' : 'text-hiraya-ink/70'}`}
                        >
                            Shop
                        </Link>
                        <Link
                            to="/try-on"
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-full transition whitespace-nowrap group hover:text-hiraya-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname.startsWith('/try-on') ? 'text-hiraya-ink bg-[#CB997E]/25 font-bold' : 'text-hiraya-ink/70'}`}
                        >
                            <Sparkles size={16} className="group-hover:animate-pulse text-[#CB997E] shrink-0"/>
                            AI Try-On
                        </Link>
                        {user && <Link
                            to="/try-on/history"
                            title="Try-On History"
                            aria-label="Try-On History"
                            className={`flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-hiraya-cream-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname === '/try-on/history' ? 'bg-[#CB997E]/25 text-hiraya-ink' : 'text-hiraya-ink/70 hover:text-hiraya-ink'}`}
                        ><History size={17} strokeWidth={1.8} className="shrink-0" /></Link>}

                    </div>

                    {/* Controls Section - Desktop */}
                    <div className="hidden lg:flex items-center gap-1.5 shrink-0">
                        <SearchBar
                            isOpen={isSearchOpen}
                            setIsOpen={setIsSearchOpen}
                            query={searchQuery}
                            setQuery={setSearchQuery}
                            onSubmit={handleSearchSubmit}
                            isScrolled={isScrolled}
                        />

                        <Link
                            to="/feedback"
                            title="Share feedback"
                            aria-label="Share feedback"
                            className={`relative flex items-center justify-center w-10 h-10 rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname === '/feedback' ? 'border-[#CB997E]/50 bg-[#CB997E]/25 text-hiraya-ink' : 'border-transparent text-hiraya-ink/70 hover:bg-hiraya-cream-deep'}`}
                        >
                            <MessageSquare size={19} strokeWidth={1.7} />
                        </Link>

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
                                className={`relative flex items-center gap-2 h-10 px-3 rounded-full border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${
                                    location.pathname === '/cart'
                                        ? 'border-[#CB997E]/60 bg-[#CB997E]/25 text-hiraya-ink'
                                        : 'border-hiraya-olive/20 bg-hiraya-cream-deep/60 text-hiraya-ink/70 hover:border-hiraya-olive/40 hover:bg-hiraya-cream-deep'
                                }`}
                            >
                                <ShoppingBag size={19} />
                                <span className="text-[11px] font-black uppercase tracking-[0.15em]">My Bag</span>
                                {cartCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1 bg-hiraya-olive text-hiraya-ink font-extrabold text-[9px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shadow-md ring-2 ring-hiraya-cream/70">
                                        {cartCount > 99 ? '99+' : cartCount}
                                    </span>
                                )}
                            </Link>
                        )}

                        <div className={`flex items-center gap-1.5 ${user ? 'border-l border-hiraya-olive/15 pl-2 ml-1' : ''}`}>
                            {user ? (
                                /* 🧑 CUSTOMER DASHBOARD MENU — Wishlist, Orders and
                                   Settings now live inside one dropdown instead of
                                   three competing header icons. */
                                <div className="relative" ref={profileRef}>
                                    <button
                                        onClick={() => setIsProfileOpen((v) => !v)}
                                        aria-haspopup="menu"
                                        aria-expanded={isProfileOpen}
                                        className="flex items-center gap-2 h-10 px-2 rounded-full border border-transparent transition hover:border-hiraya-olive/15 hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70"
                                    >
                                        <div className="flex flex-col items-end leading-tight">
                                            <span className="text-[10px] uppercase tracking-widest text-hiraya-ink font-black">
                                                Member
                                            </span>
                                            <span className="text-[14px] font-bold tracking-wide uppercase">
                                                {user.full_name?.split(' ')[0]}
                                            </span>
                                        </div>
                                        <User size={30} strokeWidth={1.5} className="text-hiraya-ink" />
                                        <ChevronDown
                                            size={15}
                                            className={`transition-transform ${isProfileOpen ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    {isProfileOpen && (
                                        <div
                                            role="menu"
                                            className="absolute right-0 mt-3 w-64 bg-hiraya-cream-deep backdrop-blur-2xl border border-hiraya-olive/20 rounded-2xl shadow-2xl overflow-hidden z-50 text-hiraya-ink"
                                        >
                                            <div className="px-4 py-3 border-b border-hiraya-olive/15">
                                                <p className="text-[11px] font-bold uppercase tracking-wide truncate">
                                                    {user.full_name}
                                                </p>
                                                <p className="text-[10px] text-hiraya-ink truncate">{user.email}</p>
                                            </div>

                                            {/*"My Dashboard" and the duplicate
"My Bag" row were both removed.
                                                Orders and Settings stay here; the
                                                bag has exactly ONE entry point —
                                                the white My Bag pill in the header. */}
                                            <ProfileMenuItem
                                                to="/orders"
                                                icon={<Package size={15} />}
                                                label="My Orders"
                                                onClick={closeAll}
                                            />
                                            <ProfileMenuItem
                                                to="/settings"
                                                icon={<Settings size={15} />}
                                                label="Account Settings"
                                                onClick={closeAll}
                                            />

                                            <button
                                                onClick={() => {
                                                    setIsProfileOpen(false);
                                                    setShowLogoutModal(true);
                                                }}
                                                className="w-full flex items-center gap-2.5 px-4 py-3 text-[11px] uppercase tracking-widest font-bold text-red-400 hover:bg-red-500/10 transition border-t border-hiraya-olive/15"
                                            >
                                                <LogOut size={15} /> Logout
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Link to="/login" className="flex items-center gap-2 h-10 px-5 bg-[#CB997E] text-hiraya-ink rounded-full hover:bg-[#A5A58D] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 transition-all shadow-md font-bold shrink-0">
                                    <User size={16} />
                                    <span className="text-[12px] uppercase tracking-[0.15em]">Login</span>
                                </Link>
                            )}
                        </div>
                    </div>

                    {/* Mobile / Tablet Toggle Button */}
                    <div className="flex items-center gap-0.5 sm:gap-1 lg:hidden">
                        {user && <NotificationBell />}

                        {/* Cart stays reachable on mobile too — same badge rules,
                            same dedicated /cart destination. */}
                        {user && (
                            <Link
                                to="/cart"
                                className={`relative flex items-center justify-center w-9 h-9 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname === '/cart' ? 'bg-[#CB997E]/25 text-hiraya-ink' : 'hover:bg-hiraya-cream-deep text-hiraya-ink/70'}`}
                                title="Your Bag"
                                aria-label={`Your bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
                            >
                                <ShoppingBag size={21} />
                                {cartCount > 0 && (
                                    <span className="absolute top-0 right-0 bg-hiraya-olive text-hiraya-ink font-extrabold text-[9px] min-w-[16px] h-4 px-0.5 rounded-full flex items-center justify-center">
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
                                className={`relative flex items-center justify-center w-9 h-9 rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70 ${location.pathname === '/orders' ? 'bg-[#CB997E]/25 text-hiraya-ink' : 'hover:bg-hiraya-cream-deep text-hiraya-ink/70'}`}
                                title="My Orders"
                                aria-label="My orders"
                            >
                                <Package size={21} />
                            </Link>
                        )}

                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="flex items-center justify-center w-10 h-10 rounded-full border border-hiraya-olive/20 bg-hiraya-cream-deep/60 hover:bg-hiraya-cream-deep transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#CB997E]/70"
                            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                            aria-expanded={isMobileMenuOpen}
                            aria-controls="mobile-navigation"
                        >
                            {isMobileMenuOpen ? <X size={26} /> : <Menu size={26} />}
                        </button>
                    </div>

                </div>

                {/* Mobile Drawer Dropdown */}
                {isMobileMenuOpen && (
                    <div id="mobile-navigation" className="lg:hidden mt-3 pt-3 pb-4 px-3 rounded-2xl border border-hiraya-olive/15 bg-hiraya-cream-deep text-hiraya-ink shadow-2xl backdrop-blur-2xl max-h-[calc(100vh-6rem)] overflow-y-auto overscroll-contain">
                        <div className="flex flex-col gap-1 font-semibold uppercase text-xs tracking-wider">
                            <Link
                                to="/"
                                onClick={scrollToTop}
                                className={`px-4 py-3 rounded-xl border transition ${location.pathname === '/' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink border-transparent hover:bg-hiraya-cream hover:text-hiraya-olive'}`}
                            >
                                Home
                            </Link>
                            <Link
                                to="/shop"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/shop' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                            >
                                Shop
                            </Link>
                            <Link
                                to="/try-on"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/try-on' || location.pathname === '/try-on/history' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                            >
                                <Sparkles size={18} className={location.pathname === '/try-on' || location.pathname === '/try-on/history' ? 'text-[#CB997E]' : 'text-hiraya-ink/70'}/>
                                AI Try-On
                            </Link>
                            {user && <Link
                                to="/try-on/history"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/try-on/history' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                            ><History size={18} /> Try-On History</Link>}
                            <Link
                                to="/feedback"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/feedback' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                            >
                                <MessageSquare size={18} /> Feedback
                            </Link>

                            {user && (
                                <>
                                    <Link
                                        to="/cart"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/cart' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                                    >
                                        <span className="flex items-center gap-2">
                                            <ShoppingBag size={18} /> My Bag
                                        </span>
                                        {cartCount > 0 && (
                                            <span className="bg-hiraya-olive text-hiraya-ink text-[10px] font-black px-2 py-0.5 rounded-full">
                                                {cartCount}
                                            </span>
                                        )}
                                    </Link>

                                    {/* The wishlist is gone entirely — saved
                                        items now live inside My Bag (/cart). */}
                                    <Link
                                        to="/orders"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/orders' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                                    >
                                        <Package size={18} /> My Orders
                                    </Link>
                                    <Link
                                        to="/settings"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-transparent transition ${location.pathname === '/settings' ? 'text-hiraya-olive bg-[#CB997E]/25 border-[#CB997E]/40 font-bold' : 'text-hiraya-ink hover:bg-white/[0.06] hover:text-hiraya-ink'}`}
                                    >
                                        <Settings size={18} /> Settings
                                    </Link>
                                </>
                            )}
                        </div>

                        {/* Mobile Actions */}
                        <div className="mt-3 pt-4 border-t border-hiraya-olive/15 flex items-center justify-between">
                            {user ? (
                                <div className="flex items-center justify-between w-full">
                                    <div>
                                        <span className="text-[10px] uppercase tracking-widest text-hiraya-ink font-black block">
                                            Logged in as
                                        </span>
                                        <span className="text-sm font-bold tracking-wide uppercase">
                                            {user.full_name}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setShowLogoutModal(true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-xs font-bold"
                                    >
                                        <LogOut size={16} /> Logout
                                    </button>
                                </div>
                            ) : (
                                <Link
                                    to="/login"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="flex items-center justify-center gap-2 w-full py-3 bg-[#CB997E] text-hiraya-ink rounded-xl font-bold uppercase tracking-wider text-xs"
                                >
                                    <User size={16} /> Login to Account
                                </Link>
                            )}
                        </div>
                    </div>
                )}
            </nav>

            {/* Reusable Logout Confirmation Modal */}
            <Modal
                isOpen={showLogoutModal}
                onClose={() => setShowLogoutModal(false)}
                onConfirm={handleConfirmLogout}
                title="Logout"
                message="Are you sure you want to log out of your Hiraya account? You will need to log in again to access your virtual wardrobe."
                confirmText="Yes, Logout"
                cancelText="Cancel"
                isDanger={true}
            />
        </>
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
        className="flex items-center gap-2.5 px-4 py-3 text-[11px] uppercase tracking-widest font-bold text-hiraya-ink hover:bg-hiraya-cream-deep hover:text-hiraya-ink transition border-b border-hiraya-olive/15 last:border-b-0"
    >
        <span className="text-hiraya-ink">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge > 0 && (
            <span className="bg-hiraya-olive text-hiraya-ink text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {badge}
            </span>
        )}
    </Link>
);

export default Navbar;

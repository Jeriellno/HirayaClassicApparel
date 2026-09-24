import { User, Sparkles, LogOut, Settings, Menu, X, Package, ShoppingBag, ChevronDown } from 'lucide-react';
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

    // Close the profile dropdown when clicking anywhere outside it.
    useEffect(() => {
        const onClickAway = (e) => {
            if (profileRef.current && !profileRef.current.contains(e.target)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', onClickAway);
        return () => document.removeEventListener('mousedown', onClickAway);
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
                className={`fixed top-0 left-0 right-0 z-40 px-4 sm:px-8 lg:px-12 transition-all duration-300 ease-in-out text-white ${
                    isScrolled
                        ?"py-3 bg-zinc-950/95 backdrop-blur-xl border-b border-white/15 shadow-lg shadow-black/40"
                        :"py-4 md:py-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent"
                }`}
            >
                <div className="max-w-7xl mx-auto flex justify-between items-center">

                    {/* LOGO & BRAND NAME */}
                    <Link
                        to="/"
                        onClick={scrollToTop}
                        className="flex items-center gap-2.5 hover:opacity-80 transition group shrink-0"
                    >
                        <img
                            src={logoImg}
                            alt="Hiraya Logo"
                            className="h-9 md:h-11 w-auto object-contain transition-all duration-300 group-hover:scale-105 shrink-0 block drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
                            onError={(e) => { e.target.style.display = 'none'; }}
                        />
                        <div className="flex flex-col justify-center">
                            <span className="text-xl sm:text-2xl md:text-3xl font-serif tracking-[0.10em] text-[#E9C46A] font-medium leading-none">
                                HIRAYA
                            </span>
                            <span className="text-[6px] sm:text-[7px] uppercase tracking-[0.35em] font-semibold mt-0.5 text-[#E9C46A]/70">
                                Virtual Wardrobe
                            </span>
                        </div>
                    </Link>

                    {/* Desktop Navigation Links (Nakalagay sa lg breakpoint para hindi mag-overlap sa medium screens) */}
                    <div className="hidden lg:flex items-center space-x-8 xl:space-x-12 font-semibold uppercase text-[13px] tracking-[0.15em] shrink-0 text-white">
                        <Link
                            to="/"
                            onClick={scrollToTop}
                            className={`transition whitespace-nowrap hover:text-[#E9C46A] ${location.pathname === '/' ? 'text-[#E9C46A] underline-offset-8 decoration-[#E9C46A]/50' : 'text-white'}`}
                        >
                            Home
                        </Link>
                        <Link
                            to="/shop"
                            className={`transition whitespace-nowrap hover:text-[#E9C46A] ${location.pathname === '/shop' ? 'text-[#E9C46A] underline-offset-8 decoration-[#E9C46A]/50' : 'text-white'}`}
                        >
                            Shop
                        </Link>
                        <Link
                            to="/try-on"
                            className={`flex items-center gap-1.5 transition whitespace-nowrap group hover:text-[#E9C46A] ${location.pathname === '/try-on' ? 'text-[#E9C46A] underline-offset-8 decoration-[#E9C46A]/50' : 'text-white'}`}
                        >
                            <Sparkles size={16} className="group-hover:animate-pulse text-[#E9C46A] shrink-0"/>
                            AI Try-On
                        </Link>
                        <Link
                            to="/feedback"
                            className={`transition whitespace-nowrap hover:text-[#E9C46A] ${location.pathname === '/feedback' ? 'text-[#E9C46A] underline-offset-8 decoration-[#E9C46A]/50' : 'text-white'}`}
                        >
                            Feedback
                        </Link>
                    </div>

                    {/* Controls Section - Desktop */}
                    <div className="hidden lg:flex items-center space-x-5 xl:space-x-7 shrink-0">
                        <SearchBar
                            isOpen={isSearchOpen}
                            setIsOpen={setIsSearchOpen}
                            query={searchQuery}
                            setQuery={setSearchQuery}
                            onSubmit={handleSearchSubmit}
                            isScrolled={isScrolled}
                        />

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
                                className={`relative flex items-center gap-2 px-3.5 py-2 rounded-full border transition-all ${
                                    location.pathname === '/cart'
                                        ? 'border-white bg-white/15 text-white'
                                        : 'border-white/25 text-white hover:border-white/60 hover:text-white'
                                }`}
                            >
                                <ShoppingBag size={19} />
                                <span className="text-[11px] font-black uppercase tracking-[0.15em]">My Bag</span>
                                {cartCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1 bg-white text-black font-extrabold text-[9px] min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shadow-md ring-2 ring-black/20">
                                        {cartCount > 99 ? '99+' : cartCount}
                                    </span>
                                )}
                            </Link>
                        )}

                        <div className={`flex items-center gap-4 ${user ? 'border-l border-white/20 pl-5' : ''}`}>
                            {user ? (
                                /* 🧑 CUSTOMER DASHBOARD MENU — Wishlist, Orders and
                                   Settings now live inside one dropdown instead of
                                   three competing header icons. */
                                <div className="relative" ref={profileRef}>
                                    <button
                                        onClick={() => setIsProfileOpen((v) => !v)}
                                        aria-haspopup="menu"
                                        aria-expanded={isProfileOpen}
                                        className={`flex items-center gap-3 pl-1 pr-2 py-1 rounded-full transition-all ${
                                            'hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex flex-col items-end leading-tight">
                                            <span className="text-[10px] uppercase tracking-widest text-zinc-300 font-black">
                                                Member
                                            </span>
                                            <span className="text-[14px] font-bold tracking-wide uppercase">
                                                {user.full_name?.split(' ')[0]}
                                            </span>
                                        </div>
                                        <User size={30} strokeWidth={1.5} className="text-zinc-200" />
                                        <ChevronDown
                                            size={15}
                                            className={`transition-transform ${isProfileOpen ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    {isProfileOpen && (
                                        <div
                                            role="menu"
                                            className="absolute right-0 mt-3 w-60 bg-zinc-950/98 backdrop-blur-xl border-white/20 border rounded-xl shadow-2xl overflow-hidden z-50 text-white"
                                        >
                                            <div className="px-4 py-3 border-b border-white/10">
                                                <p className="text-[11px] font-bold uppercase tracking-wide truncate">
                                                    {user.full_name}
                                                </p>
                                                <p className="text-[10px] text-gray-400 truncate">{user.email}</p>
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
                                                className="w-full flex items-center gap-2.5 px-4 py-3 text-[11px] uppercase tracking-widest font-bold text-red-400 hover:bg-red-500/10 transition border-t border-white/10"
                                            >
                                                <LogOut size={15} /> Logout
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Link to="/login" className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-full hover:bg-zinc-200 transition-all shadow-md font-bold shrink-0">
                                    <User size={16} />
                                    <span className="text-[12px] uppercase tracking-[0.15em]">Login</span>
                                </Link>
                            )}
                        </div>
                    </div>

                    {/* Mobile / Tablet Toggle Button */}
                    <div className="flex items-center gap-1.5 sm:gap-3 lg:hidden">
                        {user && <NotificationBell />}

                        {/* Cart stays reachable on mobile too — same badge rules,
                            same dedicated /cart destination. */}
                        {user && (
                            <Link
                                to="/cart"
                                className={`relative p-1.5 transition ${location.pathname === '/cart' ? 'text-white' : 'hover:text-zinc-300'}`}
                                title="Your Bag"
                                aria-label={`Your bag, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
                            >
                                <ShoppingBag size={21} />
                                {cartCount > 0 && (
                                    <span className="absolute top-0 right-0 bg-white text-black font-extrabold text-[9px] min-w-[16px] h-4 px-0.5 rounded-full flex items-center justify-center">
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
                                className={`relative p-1.5 transition ${location.pathname === '/orders' ? 'text-white' : 'hover:text-zinc-300'}`}
                                title="My Orders"
                                aria-label="My orders"
                            >
                                <Package size={21} />
                            </Link>
                        )}

                        <button
                            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                            className="p-2 rounded-lg hover:bg-white/10 transition focus:outline-none"
                            aria-label="Toggle Navigation Menu"
                        >
                            {isMobileMenuOpen ? <X size={26} /> : <Menu size={26} />}
                        </button>
                    </div>

                </div>

                {/* Mobile Drawer Dropdown */}
                {isMobileMenuOpen && (
                    <div className={`lg:hidden mt-3 pt-4 pb-6 px-4 rounded-2xl border transition-all duration-300 ${
                        isScrolled
                            ? 'bg-zinc-950 text-white border-zinc-800 shadow-2xl'
                            : 'bg-zinc-950/98 text-white border-zinc-800 backdrop-blur-xl'
                    }`}>
                        <div className="flex flex-col space-y-4 font-semibold uppercase text-sm tracking-wider">
                            <Link
                                to="/"
                                onClick={scrollToTop}
                                className={`py-2 border-b border-white/5 ${location.pathname === '/' ? 'text-zinc-300' : ''}`}
                            >
                                Home
                            </Link>
                            <Link
                                to="/shop"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`py-2 border-b border-white/5 ${location.pathname === '/shop' ? 'text-zinc-300' : ''}`}
                            >
                                Shop
                            </Link>
                            <Link
                                to="/try-on"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-2 py-2 border-b border-white/5 ${location.pathname === '/try-on' ? 'text-zinc-300' : ''}`}
                            >
                                <Sparkles size={18} className="text-zinc-300"/>
                                AI Try-On
                            </Link>

                            {user && (
                                <>
                                    <Link
                                        to="/cart"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`flex items-center justify-between gap-2 py-2 border-b border-white/5 ${location.pathname === '/cart' ? 'text-zinc-300' : ''}`}
                                    >
                                        <span className="flex items-center gap-2">
                                            <ShoppingBag size={18} /> My Bag
                                        </span>
                                        {cartCount > 0 && (
                                            <span className="bg-white text-black text-[10px] font-black px-2 py-0.5 rounded-full">
                                                {cartCount}
                                            </span>
                                        )}
                                    </Link>

                                    {/* The wishlist is gone entirely — saved
                                        items now live inside My Bag (/cart). */}
                                    <Link
                                        to="/orders"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className="flex items-center gap-2 py-2 border-b border-white/5"
                                    >
                                        <Package size={18} /> My Orders
                                    </Link>
                                    <Link
                                        to="/settings"
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className="flex items-center gap-2 py-2"
                                    >
                                        <Settings size={18} /> Settings
                                    </Link>
                                </>
                            )}
                        </div>

                        {/* Mobile Actions */}
                        <div className="mt-6 pt-4 border-t border-gray-500/20 flex items-center justify-between">
                            {user ? (
                                <div className="flex items-center justify-between w-full">
                                    <div>
                                        <span className="text-[10px] uppercase tracking-widest text-zinc-300 font-black block">
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
                                    className="flex items-center justify-center gap-2 w-full py-3 bg-white text-black rounded-xl font-bold uppercase tracking-wider text-xs"
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
        className="flex items-center gap-2.5 px-4 py-3 text-[11px] uppercase tracking-widest font-bold text-zinc-300 hover:bg-white/5 hover:text-white transition border-b border-white/5 last:border-b-0"
    >
        <span className="text-zinc-300">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge > 0 && (
            <span className="bg-white text-black text-[9px] font-black px-1.5 py-0.5 rounded-full">
                {badge}
            </span>
        )}
    </Link>
);

export default Navbar;

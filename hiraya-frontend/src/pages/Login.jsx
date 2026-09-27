import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { motion } from 'framer-motion';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { parseApiError } from '../api/axios';

/**
 * Reads a role out of the freshly-authenticated user so the post-login
 * destination can branch: admins go to the console, customers to the shop.
 */
const roleOf = (user) =>
    String(
        user?.role ??
        user?.role_name ??
        (Array.isArray(user?.roles) ? user.roles[0] : user?.roles) ??
        (user?.is_admin || user?.isAdmin ? 'admin' : ''),
    )
        .toLowerCase()
        .replace(/[\s_-]+/g, '');

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [loading, setLoading] = useState(false);

    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const successMessage = location.state?.message;
    // Where to send the customer after a successful sign-in.
    const redirectTo = location.state?.from || null;

    /** Cheap client-side gate so we never fire an obviously-invalid request. */
    const validate = () => {
        const errs = {};
        const trimmedEmail = email.trim();

        if (!trimmedEmail) {
            errs.email = 'Email address is required.';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
            errs.email = 'Please enter a valid email address.';
        }

        if (!password) {
            errs.password = 'Password is required.';
        }

        setFieldErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setFieldErrors({});

        if (!validate()) return;

        setLoading(true);
        try {
            const response = await login({
                email: email.trim().toLowerCase(),
                password,
                remember: rememberMe,
            });

            // AuthContext has already persisted token + user. Branch the
            // destination by role: an explicit `from` always wins (deep link),
            // otherwise admins land on the console DASHBOARD and customers on
            // the shop — this is the shared-gateway"big company" login model.
            const authedUser = response?.data?.user;
            const role = roleOf(authedUser);

            // superadmins keep their own higher-privileged console.
            let roleHome = '/shop';
            if (role === 'superadmin') roleHome = '/superadmin';
            else if (role === 'admin') roleHome = '/admin/dashboard';

            const destination = redirectTo || roleHome;
            navigate(destination, { replace: true });
        } catch (err) {
            const { message, errors: apiFieldErrors } = parseApiError(err);

            // Laravel may answer a bad login with either a 401 ("Invalid
            // credentials") or a 422 field map — surface whichever arrived.
            if (Object.keys(apiFieldErrors).length > 0) {
                setFieldErrors(apiFieldErrors);
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black p-4 font-sans">
            {/* Ambient monochrome glow */}
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-white/[0.05] blur-[120px]" />
                <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-white/[0.03] blur-[100px]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.05),transparent_60%)]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="relative z-10 w-full max-w-[420px]"
            >
                <div className="overflow-hidden rounded-[2rem] border-hiraya-sand/30 bg-hiraya-cream-deep/80 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
                    {/* Brand mark */}
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border-hiraya-olive/20 bg-white/[0.06] text-hiraya-ink">
                            <Sparkles size={20} />
                        </div>
                        <h1 className="font-serif text-3xl uppercase leading-none tracking-[0.25em] text-hiraya-ink">
                            Login
                        </h1>
                        <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-hiraya-olive/70">
                            Welcome back to Hiraya
                        </p>
                    </div>

                    {successMessage && !error && (
                        <div className="mb-5 flex items-start gap-2 rounded-xl border-hiraya-olive/20 bg-white/[0.06] p-3 text-center text-xs font-medium text-hiraya-ink">
                            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                            <span className="leading-relaxed">{successMessage}</span>
                        </div>
                    )}

                    {error && (
                        <div className="mb-5 flex items-start gap-2 rounded-xl border-red-500/30 bg-red-500/10 p-3 text-center text-xs font-medium text-red-400">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span className="leading-relaxed">{error}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                        {/* Email Input */}
                        <div>
                            <input
                                type="email"
                                placeholder="Email Address"
                                autoComplete="email"
                                className={`w-full rounded-xl border bg-hiraya-cream/50 px-5 py-3.5 text-sm text-hiraya-ink placeholder-zinc-500 outline-none transition-all focus:ring-1 ${fieldErrors.email
                                        ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/30'
                                        : 'border-hiraya-sand/30 focus:border-hiraya-gold/60 focus:ring-white/20'
                                    }`}
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: null }));
                                }}
                                required
                            />
                            {fieldErrors.email && (
                                <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-400">{fieldErrors.email}</p>
                            )}
                        </div>

                        {/* Password Input */}
                        <div className="space-y-2">
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="Password"
                                    autoComplete="current-password"
                                    className={`w-full rounded-xl border bg-hiraya-cream/50 px-5 py-3.5 pr-12 text-sm text-hiraya-ink placeholder-zinc-500 outline-none transition-all focus:ring-1 ${fieldErrors.password
                                            ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/30'
                                            : 'border-hiraya-sand/30 focus:border-hiraya-gold/60 focus:ring-white/20'
                                        }`}
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value);
                                        if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: null }));
                                    }}
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-sand transition-colors hover:text-hiraya-ink"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {fieldErrors.password && (
                                <p className="pl-2 text-[10px] font-medium text-red-400">{fieldErrors.password}</p>
                            )}

                            {/* REMEMBER ME & FORGOT PASSWORD */}
                            <div className="flex items-center justify-between px-1 pt-1">
                                <label className="flex cursor-pointer items-center gap-2 text-xs text-hiraya-sand transition-colors hover:text-hiraya-ink">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="cursor-pointer rounded border-hiraya-sand/40 bg-black text-hiraya-ink accent-stone-200 focus:ring-0"
                                    />
                                    <span className="text-[11px]">Remember me</span>
                                </label>
                                <Link
                                    to="/forgot-password"
                                    className="text-[11px] text-hiraya-sand underline transition-colors hover:text-hiraya-ink"
                                >
                                    Forgot Password?
                                </Link>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-4 text-xs font-bold uppercase tracking-widest text-hiraya-ink shadow-lg shadow-hiraya-sand/40 transition-all hover:bg-hiraya-cream-deep active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={15} className="animate-spin" /> Signing In...
                                </>
                            ) : (
                                <>
                                    Sign In <ArrowRight size={15} />
                                </>
                            )}
                        </button>
                    </form>

                    <p className="mt-8 text-center text-[11px] text-hiraya-sand">
                        Don&apos;t have an account?{' '}
                        <Link
                            to="/register"
                            className="ml-1 border-b border-[#CB997E]/40 font-bold text-hiraya-ink transition-colors hover:text-[#FFE8D6]"
                        >
                            Create One
                        </Link>
                    </p>
                </div>
            </motion.div>
        </div>
    );
};

export default Login;

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, ArrowLeft, AlertCircle, Loader2, Sparkles, Mail, Send, ShieldCheck } from 'lucide-react';
import api, { parseApiError } from '../api/axios';

/**
 * ForgotPassword - Hiraya"Gold & Black" luxury reset gateway.
 *
 * Two explicit steps, driven by a single `step` machine:
 *   STEP 1 - email entry with INSTANT (as-you-type) validation.
 *   STEP 2 - success confirmation + a quick link back to /login.
 *
 * The step is advanced ONLY after a successful submission, so a failed
 * request keeps the customer on the form with their input intact rather than
 * dumping them on a success screen for an email that never got sent.
 */

const STEP = { EMAIL: 1, SUCCESS: 2 };

/** Laravel-ish email shape check - good enough to gate the request client-side. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ForgotPassword = () => {
    const [step, setStep] = useState(STEP.EMAIL);
    const [email, setEmail] = useState('');
    // `touched` keeps the error hidden until the field is blurred OR a submit
    // was attempted - we never scold someone mid-way through typing.
    const [touched, setTouched] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const navigate = useNavigate();

    const trimmedEmail = email.trim();
    const isEmailValid = EMAIL_REGEX.test(trimmedEmail);
    // Instant validation: recomputed on every keystroke, no request involved.
    const emailError = useMemo(() => {
        if (!touched) return '';
        if (!trimmedEmail) return 'Email address is required.';
        if (!isEmailValid) return 'Please enter a valid email address.';
        return '';
    }, [touched, trimmedEmail, isEmailValid]);

    const canSubmit = isEmailValid && !loading;

    /** Auto-dismiss the success notice if the user lingers, then bounce home. */
    useEffect(() => {
        if (step !== STEP.SUCCESS) return undefined;
        const timer = setTimeout(() => navigate('/login', { replace: true }), 12000);
        return () => clearTimeout(timer);
    }, [step, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setTouched(true);
        setError('');

        if (!isEmailValid) return;
        // Guard against a double-submit: the button is disabled while loading,
        // but Enter-key spam can still re-fire the handler.
        if (loading) return;

        setLoading(true);
        try {
            /*
             * `/forgot-password`, NOT `/check-email`.
             *
             * `/check-email` answers "is this address already registered?" for the
             * SIGN-UP form — it never sent mail. Calling it here made the success
             * screen a LIE: the customer was told a reset link was on its way and
             * nothing had been sent, which is the worst possible failure mode
             * because the person hitting it is already locked out.
             *
             * The backend stays enumeration-safe — it never reveals whether the
             * address exists — so we ALWAYS advance to the success step and keep
             * the copy conditional ("if an account exists").
             */
            await api.post('/forgot-password', { email: trimmedEmail.toLowerCase() });
            setStep(STEP.SUCCESS);
        } catch (err) {
            const { message, errors } = parseApiError(err);
            setError(errors?.email || message || 'Unable to send the reset link. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black p-4 font-sans">
            {/* Ambient gold glow - same signature lighting as the Login gateway. */}
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-hiraya-cream/\[0.05\] blur-[120px]" />
                <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-hiraya-cream/\[0.03\] blur-[100px]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(245,235,224,0.08),transparent_60%)]" />
            </div>

            <motion.div 
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="relative z-10 w-full max-w-[420px]"
            >
                <div className="overflow-hidden rounded-[2rem] border-hiraya-sand/30 bg-hiraya-cream-deep/80 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border-hiraya-olive/20 bg-[#CB997E]/10 text-hiraya-ink">
                            {step === STEP.SUCCESS ? <ShieldCheck size={20} /> : <Sparkles size={20} />}
                        </div>
                        <h1 className="font-serif text-3xl uppercase leading-none tracking-[0.25em] text-hiraya-ink">
                            {step === STEP.SUCCESS ? 'Check Inbox' : 'Reset Password'}
                        </h1>
                        <p className="mt-3 text-[10px] uppercase tracking-[0.3em] text-hiraya-olive/70">
                            {step === STEP.SUCCESS ? 'Reset link dispatched' : 'We will email you a secure link'}
                        </p>
                    </div>

                    {error && (
                        <div className="mb-5 flex items-start gap-2 rounded-xl p-3 text-left bg-red-500/10 border border-red-500/30 text-xs font-medium text-red-400">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span className="leading-relaxed">{error}</span>
                        </div>
                    )}

                    {/* STEP 1 - EMAIL INPUT (instant validation) */}
                    {step === STEP.EMAIL && (
                        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                            <div className="relative">
                                <Mail size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-hiraya-sand" />
                                <input
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    placeholder="Email Address"
                                    value={email}
                                    onChange={(e) => {
                                        setEmail(e.target.value);
                                        if (error) setError('');
                                    }}
                                    onBlur={() => setTouched(true)}
                                    aria-invalid={!!emailError}
                                    aria-describedby={emailError ? 'email-error' : undefined}
                                    className={`w-full rounded-xl py-3.5 pl-12 pr-12 text-sm text-hiraya-ink placeholder-zinc-500 outline-none transition-all focus:ring-1 ${
                                        emailError
                                            ? 'border-red-500/50 focus:border-red-500 focus:ring-red-500/30'
                                            : 'focus:border-hiraya-gold/60 focus:ring-stone-200/25'
                                    }`}
                                    required
                                />
                                {/* Instant, live validation feedback */}
                                {isEmailValid && !emailError && (
                                    <CheckCircle2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-ink" />
                                )}
                            </div>

                            <div className="min-h-[16px] px-2">
                                {emailError ? (
                                    <p id="email-error" className="text-[10px] font-medium text-red-400">{emailError}</p>
                                ) : (
                                    <p className="text-[10px] text-hiraya-sand">
                                        Enter the email linked to your Hiraya account.
                                    </p>
                                )}
                            </div>
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-4 text-xs font-bold uppercase tracking-widest text-hiraya-olive shadow-lg shadow-stone-200/10 transition-all hover:bg-hiraya-cream-deep active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 size={15} className="animate-spin" /> Sending Link...
                                    </>
                                ) : (
                                    <>
                                        <Send size={15} /> Send Reset Link
                                    </>
                                )}
                            </button>
                        </form>
                    )}

                    {/* STEP 2 - SUCCESS CONFIRMATION */}
                    {step === STEP.SUCCESS && (
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.35, ease: 'easeOut' }}
                            className="space-y-4"
                        >
                            <div className="flex items-start gap-3 rounded-2xl border-hiraya-olive/20 bg-[#CB997E]/10 p-4">
                                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-hiraya-ink" />
                                <div className="space-y-1">
                                    <p className="text-xs font-bold uppercase tracking-widest text-hiraya-ink">
                                        Reset Link Sent
                                    </p>
                                    <p className="text-[11px] leading-relaxed text-hiraya-sand">
                                        If an account exists for{' '}
                                        <span className="font-semibold text-hiraya-ink">{trimmedEmail}</span>, a
                                        password reset link is on its way. The link expires in 60 minutes.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-2xl border-hiraya-sand/30 bg-hiraya-cream/30 p-4 text-[11px] leading-relaxed text-hiraya-sand">
                                Didn&apos;t get it? Check your spam folder, or wait a minute and request a
                                new link. This page will return you to sign in automatically.
                            </div>

                            <button
                                type="button"
                                onClick={() => navigate('/login', { replace: true })}
                                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-4 text-xs font-bold uppercase tracking-widest text-hiraya-olive shadow-lg shadow-stone-200/10 transition-all hover:bg-hiraya-cream-deep active:scale-95"
                            >
                                Back to Sign In <ArrowLeft size={15} />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setStep(STEP.EMAIL);
                                    setTouched(false);
                                    setError('');
                                }}
                                className="w-full text-[11px] text-hiraya-sand underline transition-colors hover:text-hiraya-ink"
                            >
                                Use a different email
                            </button>
                        </motion.div>
                    )}

                    {step === STEP.EMAIL && (
                        <p className="mt-8 text-center text-[11px] text-hiraya-sand">
                            Remembered it?{' '}
                            <Link
                                to="/login"
                                className="ml-1 inline-flex items-center gap-1 border-b border-hiraya-olive/20 font-bold text-hiraya-ink transition-colors hover:text-hiraya-ink"
                            >
                                Back to Sign In
                            </Link>
                        </p>
                    )}
                </div>
            </motion.div>
        </div>
    );
};

export default ForgotPassword;

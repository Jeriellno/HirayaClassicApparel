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

    /*
     * NO AUTO-REDIRECT AFTER THE LINK IS SENT.
     *
     * This page used to bounce itself to /login on a 12-second timer, with
     * `{ replace: true }`. Both halves of that were wrong.
     *
     * The delay was shorter than the task: the customer has to switch to another
     * app, open Gmail, find the mail and read a long URL, which comfortably
     * exceeds 12s. They were returned to the sign-in form while the link they had
     * just been promised was still sitting unread in their inbox — the screen they
     * needed was the one being taken away from them.
     *
     * `replace: true` compounded it: it overwrote the /forgot-password entry in
     * the history stack, so Back did not restore the form either. The email and
     * the error state were gone, and "Use a different email" was unreachable.
     *
     * The confirmation is the moment the customer most needs to stay put, and it
     * already says what to do next ("check your spam folder, or request a new
     * link"). ResetPassword.jsx reaches the same conclusion about its own success
     * screen — see the note at the top of that file. The link out is a button
     * they press when they are ready, not a timer that fires on their behalf.
     */
    useEffect(() => {
        // Intentionally empty: the success step persists until the user acts.
        // Kept as a hook so the "no auto-redirect" decision stays visible here
        // rather than being an absence nobody notices and reinstates later.
    }, []);

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
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 font-sans">
            {/*
             * AMBIENT GLOW — same two-colour lighting as Login and Register.
             * Vintage-white blooms over a light canvas would be invisible; indigo
             * above and maroon at the corner give the glass something to blur.
             */}
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-hiraya-indigo/[0.12] blur-[120px]" />
                <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-hiraya-accent/[0.10] blur-[100px]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(35,47,114,0.10),transparent_60%)]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="relative z-10 w-full max-w-[420px]"
            >
                <div className="glass overflow-hidden p-8 sm:p-10">
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-sm border border-hiraya-accent/30 bg-hiraya-accent text-hiraya-on-accent">
                            {step === STEP.SUCCESS ? <ShieldCheck size={20} /> : <Sparkles size={20} />}
                        </div>
                        <h1 className="display-lg text-hiraya-ink">
                            {step === STEP.SUCCESS ? 'Check Inbox' : 'Reset Password'}
                        </h1>
                        <p className="kicker kicker-center mt-3 text-hiraya-ink-muted">
                            {step === STEP.SUCCESS ? 'Reset link dispatched' : 'We will email you a secure link'}
                        </p>
                    </div>

                    {error && (
                        <div className="mb-5 flex items-start gap-2 rounded-sm border border-red-600/40 bg-red-500/12 p-3 text-left text-xs font-medium text-red-700">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span className="leading-relaxed">{error}</span>
                        </div>
                    )}

                    {/* STEP 1 - EMAIL INPUT (instant validation) */}
                    {step === STEP.EMAIL && (
                        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                            <div className="relative">
                                <Mail size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-hiraya-ink-muted" />
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
                                    className={`field pl-12 pr-12 ${emailError ? 'border-red-500/50 focus:border-red-500' : ''}`}
                                    required
                                />
                                {/* Instant, live validation feedback */}
                                {isEmailValid && !emailError && (
                                    <CheckCircle2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-600" />
                                )}
                            </div>

                            <div className="min-h-[16px] px-2">
                                {emailError ? (
                                    <p id="email-error" className="text-[10px] font-medium text-red-700">{emailError}</p>
                                ) : (
                                    <p className="text-[10px] text-hiraya-ink-muted">
                                        Enter the email linked to your Hiraya account.
                                    </p>
                                )}
                            </div>
                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="btn-primary w-full"
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
                            <div className="flex items-start gap-3 rounded-sm border border-hiraya-accent/25 bg-hiraya-accent-wash p-4">
                                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-hiraya-accent" />
                                <div className="space-y-1">
                                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-accent">
                                        Reset Link Sent
                                    </p>
                                    <p className="text-[11px] leading-relaxed text-hiraya-ink-soft">
                                        If an account exists for{' '}
                                        <span className="font-semibold text-hiraya-ink">{trimmedEmail}</span>, a
                                        password reset link is on its way. The link expires in 60 minutes.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-sm border border-hiraya-structure-line bg-hiraya-surface-raised p-4 text-[11px] leading-relaxed text-hiraya-ink-muted">
                                Didn&apos;t get it? Check your spam folder, or wait a minute and request a
                                new link. You can stay on this page as long as you like.
                            </div>

                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="btn-primary w-full"
                            >
                                Continue to Sign In <ArrowLeft size={15} />
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    setStep(STEP.EMAIL);
                                    setTouched(false);
                                    setError('');
                                }}
                                className="w-full text-[11px] text-hiraya-ink-muted underline transition-colors hover:text-hiraya-accent cursor-pointer"
                            >
                                Use a different email
                            </button>
                        </motion.div>
                    )}

                    {step === STEP.EMAIL && (
                        <p className="mt-8 border-t border-hiraya-structure-line pt-5 text-center text-[11px] text-hiraya-ink-muted">
                            Remembered it?{' '}
                            <Link
                                to="/login"
                                className="ml-1 inline-flex items-center gap-1 border-b border-hiraya-accent/40 font-semibold text-hiraya-ink transition-colors hover:text-hiraya-accent"
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

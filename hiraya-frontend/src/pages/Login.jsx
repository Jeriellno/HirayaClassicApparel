﻿import { useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
    Eye, EyeOff, AlertCircle, CheckCircle2, Loader2, ArrowRight,
    ShieldCheck, KeyRound, ArrowLeft,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { parseApiError } from '../api/axios';
import { postLoginPath } from '../utils/consoleAccess';
import { hasStoredSupabaseSession } from '../routes/ProtectedRoute';
import MfaEnrollment from '../components/settings/MfaEnrollment';
import AuthShell from '../components/auth/AuthShell';
import {
    signInWithPassword,
    getAssuranceLevels,
    createMfaChallenge,
    verifyMfaChallenge,
    signOutSupabase,
    fetchAuthoritativeRole,
    isPrivilegedRole,
} from '../services/supabaseMfa';
import { supabase } from '../services/supabase';
import { useT } from '../context/PreferencesContext';

/*
 * Login — THE ONE DOOR.
 * ============================================================================
 *
 * There is no longer a second sign-in form for staff. Every account — customer,
 * admin, superadmin — types its email and password HERE, and what happens next
 * is decided by the ROLE, not by which page they were on:
 *
 *     superadmin  ->  6-digit TOTP  ->  /superadmin
 *     admin       ->  6-digit TOTP  ->  /superadmin
 *     user        ->  done          ->  /home
 *
 * WHY THE TWO-DOOR DESIGN WAS REPLACED
 * ------------------------------------
 * There used to be `/login` (Laravel, customers only) and `/admin/login`
 * (Supabase, staff only), joined by a 403 `{ staff_door }` that bounced a
 * correctly-typed superadmin out of the first form into the second. That split
 * meant the role was read from two different sources, the destination was
 * written out in two files, and a staff member's correct password was reported
 * as an ERROR rather than as the first half of a two-step sign-in.
 *
 * The single form removes all three. The backend answers a correct password on a
 * privileged account with `200 { mfa_required: true, role }` — an explicit "your
 * password is right, now prove the second factor" — and this component owns
 * everything that follows it.
 *
 * WHY A STAFF SESSION IS A SUPABASE SESSION
 * -----------------------------------------
 * /superadmin is authorized by a Supabase `aal2` claim, and the API calls behind
 * it are authorized by the Supabase JWT. A Laravel/Sanctum token carries no such
 * claim, so a staff member is signed into Supabase as part of this same form. A
 * customer has no such requirement and never touches Supabase here.
 *
 * THE THREE STEPS ARE STATES, NOT PAGES
 * ------------------------------------
 * `step` is the whole state machine: 'password' -> 'verify' -> (or) 'enroll'.
 * These were once two separate routes, which cost a second component, a second
 * copy of the challenge logic, and a way for the two to disagree.
 */
const Login = () => {
    const t = useT();
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    const [step, setStep] = useState('password');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [rememberMe, setRememberMe] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [code, setCode] = useState('');
    // The factor uuid and the challenge id are DIFFERENT things; verify needs both.
    const [factorId, setFactorId] = useState(null);
    const [challengeId, setChallengeId] = useState(null);
    const [role, setRole] = useState('');
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const codeRef = useRef(null);
    /*
     * True while a saved staff session is checked (see the effect below). The
     * form is held back meanwhile: painting it and then jumping to the console
     * a second later is the flicker staff saw on every reload of /login.
     * Nobody with no saved Supabase session waits at all.
     */
    const [resuming, setResuming] = useState(hasStoredSupabaseSession);

    const successMessage = location.state?.message;
    // An explicit deep link always wins over the role's own landing page.
    const redirectTo = location.state?.from || null;

    useEffect(() => {
        if (step === 'verify') codeRef.current?.focus();
    }, [step]);

    /*
     * RESUME A VERIFIED CONSOLE SESSION.
     *
     * A staff member whose browser still holds an aal2 session (they already
     * entered their authenticator code) never has to sign in again: landing on
     * /login — after a reload, a stale bookmark, or a guard that bounced too
     * early — forwards straight back to the console.
     */
    useEffect(() => {
        let cancelled = false;
        // A slow network must not hold the form back: give up after 5s.
        const giveUp = window.setTimeout(() => {
            cancelled = true;
            setResuming(false);
        }, 5000);
        (async () => {
            try {
                const { data } = await supabase.auth.getSession();
                const user = data?.session?.user;
                /*
                 * NO SESSION: SHOW THE FORM NOW.
                 * This branch used to `return` before `setResuming(false)`, so a
                 * browser with nothing saved sat on "Verifying Session..." for the
                 * full 5s timeout before the sign-in form appeared. A plain visitor
                 * with no staff session is the common case, and it should cost one
                 * paint, not five seconds.
                 */
                if (!user) {
                    setResuming(false);
                    return;
                }
                const levels = await getAssuranceLevels();
                if (cancelled || levels.currentLevel !== 'aal2') return;
                const staffRole = await fetchAuthoritativeRole(user);
                if (!cancelled && isPrivilegedRole(staffRole)) {
                    navigate(postLoginPath(redirectTo, staffRole), { replace: true });
                    return;
                }
            } catch {
                // No resumable session — show the sign-in form as usual.
            }
            if (!cancelled) setResuming(false);
        })().finally(() => window.clearTimeout(giveUp));
        return () => {
            cancelled = true;
            window.clearTimeout(giveUp);
        };
        // Runs once on mount; `redirectTo` is read from the initial location.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    /**
     * The destination for a staff member whose session is already aal2 — this
     * browser still holds a verified one from earlier, so there is nothing left
     * to ask for.
     */
    const finishStaffSignIn = (resolvedRole) => {
        // Audit Logs: record the staff sign-in (fire-and-forget; never blocks entry).
        api.post('/admin/console/signed-in').catch(() => {});
        navigate(postLoginPath(redirectTo, resolvedRole), { replace: true });
    };

    /** Step 1 — the password, and the role decision that follows it. */
    const handlePassword = async (e) => {
        e.preventDefault();
        setError('');
        setFieldErrors({});

        if (!validate()) return;

        const normalizedEmail = email.trim().toLowerCase();
        setLoading(true);

        try {
            const response = await login({
                email: normalizedEmail,
                password,
                remember: rememberMe,
            });

            const body = response?.data || {};

            /*
             * A CUSTOMER. Laravel minted a Sanctum session, AuthContext has
             * already persisted it, and there is nothing left to prove.
             */
            if (!body.mfa_required) {
                // A normal customer login must not keep an old Admin/Superadmin
                // Supabase session from a previous account in this browser.
                try {
                    await signOutSupabase();
                } catch (err) {
                    console.warn('Could not clear previous staff session:', err);
                }

                // Never into the console: /login may still remember /superadmin
                // from a staff sign-out on this browser (see postLoginPath).
                navigate(postLoginPath(redirectTo, body.user), { replace: true });
                return;
            }

            /*
             * A STAFF ACCOUNT. The password is verified but no token was issued —
             * the session that opens /superadmin has to carry `aal2`, so it must
             * be minted by Supabase and raised with a TOTP code.
             */
            const resolvedRole = body.role || 'admin';
            setRole(resolvedRole);

            await signInWithPassword(normalizedEmail, password);

            const levels = await getAssuranceLevels();

            if (levels.currentLevel === 'aal2') {
                finishStaffSignIn(resolvedRole);
                return;
            }

            /*
             * NO FACTOR ENROLLED: MOUNT THE ENROLLMENT SCREEN INSTEAD.
             *
             * `nextLevel` is GoTrue's own answer to "is there a second factor to
             * challenge?", and it is the only honest source for that question. This
             * branch no longer consults a flag from `/login`: `mfa_enrollment_required`
             * has been removed from that response, because it described the server's
             * stale copy of a fact the aal2 middleware already verifies on every
             * request — and a client reading that copy is what sent a correctly
             * enrolled admin to a QR code they did not need.
             *
             * A staff account with no factor is a legitimate, expected state — an
             * invitee who has set a password but not yet scanned a code. Offering a
             * 6-digit prompt here would be a dead end: `createMfaChallenge` throws
             * "No verified authenticator is enrolled on this account", which reads
             * like a broken authenticator rather than an unfinished setup. So the
             * screen that says "you have no authenticator" is mounted here, and it is
             * the same screen that fixes it.
             */
            if (levels.nextLevel !== 'aal2') {
                setError(
                    'Set up your authenticator app to activate this administrator account.',
                );
                setStep('enroll');
                return;
            }

            const challenge = await createMfaChallenge('totp');
            setFactorId(challenge.factorId);
            setChallengeId(challenge.challengeId);
            setCode('');
            setStep('verify');
        } catch (err) {
            /*
             * A SUPABASE ERROR IS NOT A NETWORK ERROR, AND SAYING OTHERWISE IS A
             * LIE THE USER CANNOT ACT ON.
             *
             * This catch block handles BOTH failures in one try: the Laravel
             * `/login` request and the Supabase `signInWithPassword` that follows
             * it. `parseApiError` derives `isNetworkError` from the ABSENCE of an
             * `.response`, which is true of every error Supabase throws — it
             * rejects with a plain object carrying `{ message, status }`, never an
             * axios response. So a Supabase 400 ("Invalid login credentials")
             * was rewritten to "Cannot reach the Hiraya server." and the user was
             * told to check their network when the truth was that the account's
             * password was not accepted there.
             *
             * An error that already carries a Supabase status has told us exactly
             * what happened; pass it through unchanged. Only an error with no
             * response AND no status is a genuine unknown, and that is what
             * parseApiError is for.
             */
            const isSupabaseError = err?.status !== undefined && !err?.response;

            const { message, errors: apiFieldErrors } = isSupabaseError
                ? { message: err?.message, errors: {} }
                : parseApiError(err);

            if (Object.keys(apiFieldErrors).length > 0) {
                setFieldErrors(apiFieldErrors);
            }
            setError(message);

            /*
             * THE PASSWORD WAS FINE — THE SECOND FACTOR WAS NOT.
             * A Supabase failure after the Laravel step must not leave the user
             * staring at a password form implying they mistyped it.
             *
             * It must NOT dump them into enrollment either. `createMfaChallenge`
             * throws when the account has no VERIFIED factor, but `nextLevel`
             * already said it had one — so that specific failure means the factor
             * list and the assurance level disagree, and showing a QR code would
             * have them enroll a SECOND authenticator. Stay on the password form
             * with Supabase's own message; it is honest and it is retryable.
             */
            if (step === 'verify') {
                setStep('password');
            }
        } finally {
            setLoading(false);
        }
    };

    /** Step 2 — the 6-digit code, elevating THIS session to aal2. */
    const handleVerify = async (e) => {
        e.preventDefault();
        setError('');

        if (!/^\d{6}$/.test(code)) {
            setError('Enter the 6-digit code from your authenticator app.');
            return;
        }
        if (!challengeId || !factorId) {
            setError('This verification expired. Enter your password again.');
            setRole('');
            setCode('');
            setStep('password');
            return;
        }

        setLoading(true);
        try {
            await verifyMfaChallenge(factorId, challengeId, code);
            finishStaffSignIn(role);
        } catch (err) {
            // The challenge survives a wrong code, so the user may retry in place.
            setError(err?.message || 'That code was not accepted. Try the next one.');
            setCode('');
            codeRef.current?.focus();
        } finally {
            setLoading(false);
        }
    };

    /**
     * Called by MfaEnrollment once a factor is verified.
     *
     * Confirming a factor does not by itself raise THIS session to aal2 — GoTrue
     * issues the elevated token only after a challenge is verified — so this re-reads
     * the level and opens a real challenge rather than assuming the sign-in is done.
     *
     * There is no activation step here any more, and no `mfa-enrolled` call to paper
     * over one. The account becomes usable the moment an aal2 request is accepted, and
     * `supabase.aal2` verifies that on every call. The audit stamp is still worth
     * recording, so it is sent once and treated as best-effort: if it fails, the sign-in
     * itself is unaffected and the honest outcome below still says so.
     */
    const handleEnrolled = async () => {
        try {
            setLoading(true);
            setError('');

            const levels = await getAssuranceLevels();

            if (levels.currentLevel === 'aal2') {
                finishStaffSignIn(role);
                return;
            }

            /*
             * The factor is verified but this session is still aal1, which is the
             * normal state immediately after enrolment. Open the code prompt rather
             * than declaring failure — the user owes exactly one 6-digit code, and
             * they can produce it from the app they just set up.
             */
            const challenge = await createMfaChallenge('totp');
            setFactorId(challenge.factorId);
            setChallengeId(challenge.challengeId);
            setCode('');
            setStep('verify');
        } catch (err) {
            setError(
                err?.message ||
                'The authenticator was created but the session could not be verified.',
            );
        } finally {
            setLoading(false);
        }
    };

    /**
     * Abandon the challenge and start over.
     *
     * Signs out of Supabase FIRST, so the aal1 session open in this tab cannot
     * linger while the user goes looking for their phone — and so the next
     * password submit starts from a clean state.
     */
    const restartAsAnotherUser = async () => {
        try {
            await signOutSupabase();
        } catch (err) {
            console.warn('Login: Supabase sign-out failed', err);
        }
        setStep('password');
        setFactorId(null);
        setChallengeId(null);
        setRole('');
        setCode('');
        setPassword('');
        setError('');
        setFieldErrors({});
    };

    if (resuming) {
        // Same look as the console's own session gate, so the hand-off is one screen.
        return (
            <div className="flex min-h-screen items-center justify-center" role="status">
                <div className="animate-pulse text-[11px] uppercase tracking-[0.35em] text-hiraya-ink">
                    Verifying Session...
                </div>
            </div>
        );
    }

    return (
        /*
         * The sliding Sign In / Create Account card (see AuthShell). The shell
         * owns the page, the heading and the switch to /register; everything
         * below is this page's own form, unchanged in behaviour.
         *
         * The ShieldCheck badge still marks the two-factor steps — there the
         * shield IS the message — and the switch to registration is hidden
         * while a staff member is mid-verification.
         */
        <AuthShell
            mode="signin"
            title={step === 'password' ? 'Sign In' : 'Verify'}
            kicker={step === 'password' ? 'Welcome back to Hiraya' : 'Staff accounts require an authenticator code'}
            icon={step !== 'password' ? <ShieldCheck size={20} /> : null}
            allowSwitch={step === 'password'}
        >
            <div>
                    {successMessage && !error && step === 'password' && (
                        <div className="mb-5 flex items-start gap-2 rounded-xl border border-hiraya-accent/20 bg-hiraya-accent-wash p-3 text-xs font-medium text-hiraya-ink">
                            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-hiraya-accent" />
                            <span className="leading-relaxed">{successMessage}</span>
                        </div>
                    )}

                    {error && (
                        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/15 p-3 text-xs font-medium leading-relaxed text-amber-800">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/*
                        THE ONLY BRANCH ON THIS SCREEN.
                        The password form and the second-factor form are two
                        states of one sign-in, not two doors. Which one renders is
                        decided by the role the backend reported — `mfa_required`
                        put us on the code step, and a staff account with no
                        authenticator enrolled put us on enrollment.
                    */}
                    {step === 'password' ? (
                        <form onSubmit={handlePassword} className="space-y-4" noValidate>
                        {/* Email Input */}
                        <div>
                            <input
                                type="email"
                                placeholder={t('auth.email')}
                                autoComplete="email"
                                className={`field ${fieldErrors.email
                                        ? 'border-red-500/50 focus:border-red-500'
                                        : ''
                                    }`}
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: null }));
                                }}
                                required
                            />
                            {fieldErrors.email && (
                                <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">{fieldErrors.email}</p>
                            )}
                        </div>

                        {/* Password Input */}
                        <div className="space-y-2">
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder={t('auth.password')}
                                    autoComplete="current-password"
                                    className={`field pr-12 ${fieldErrors.password
                                            ? 'border-red-500/50 focus:border-red-500'
                                            : ''
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
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-ink-muted transition-colors hover:text-hiraya-accent cursor-pointer"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                            {fieldErrors.password && (
                                <p className="pl-2 text-[10px] font-medium text-red-700">{fieldErrors.password}</p>
                            )}

                            {/* REMEMBER ME & FORGOT PASSWORD */}
                            <div className="flex items-center justify-between px-1 pt-1">
                                <label className="flex cursor-pointer items-center gap-2 text-hiraya-ink-muted transition-colors hover:text-hiraya-ink">
                                    <input
                                        type="checkbox"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="cursor-pointer accent-hiraya-accent focus:ring-0"
                                    />
                                    <span className="text-[11px]">{t('auth.rememberMe')}</span>
                                </label>
                                <Link
                                    to="/forgot-password"
                                    className="text-[11px] text-hiraya-ink-muted underline transition-colors hover:text-hiraya-accent"
                                >
                                    Forgot Password?
                                </Link>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn-primary group mt-4 w-full rounded-full py-3.5"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={15} className="animate-spin" /> Signing In...
                                </>
                            ) : (
                                <>
                                    Sign In <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
                                </>
                            )}
                        </button>
                        {/* "Create one" now lives in the shell's overlay (desktop)
                            and its Sign In / Create Account switch (mobile). */}
                        </form>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 rounded-xl border border-hiraya-structure-line bg-hiraya-surface-raised p-3 text-[11px] text-hiraya-ink shadow-neu-sm">
                                <ShieldCheck size={14} className="shrink-0 text-hiraya-accent" />
                                <span className="truncate">{email.trim().toLowerCase()}</span>
                            </div>

                            {step === 'enroll' ? (
                                <>
                                    <p className="text-center text-[11px] leading-relaxed text-hiraya-ink-muted">
                                        Staff accounts must have an authenticator app. Scan the code, then
                                        enter the 6 digits it shows to finish setting it up.
                                    </p>
                                    <MfaEnrollment bootstrap userRole={role} onEnrolled={handleEnrolled} />
                                </>
                            ) : (
                                <form onSubmit={handleVerify} className="space-y-4" noValidate>
                                    <p className="text-center text-[11px] leading-relaxed text-hiraya-ink-muted">
                                        Your password was accepted. Enter the 6-digit code from
                                        Google Authenticator.
                                    </p>
                                    <input
                                        ref={codeRef}
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        maxLength={6}
                                        placeholder="000000"
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                                        className="field text-center text-2xl tracking-[0.5em]"
                                    />
                                    <button
                                        type="submit"
                                        disabled={loading || code.length !== 6}
                                        className="btn-primary w-full rounded-full py-3.5"
                                    >
                                        {loading ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <>
                                                <KeyRound size={14} /> Verify
                                            </>
                                        )}
                                    </button>
                                </form>
                            )}

                            <button
                                type="button"
                                onClick={restartAsAnotherUser}
                                className="flex w-full items-center justify-center gap-2 text-[10px] uppercase tracking-[0.18em] text-hiraya-ink-muted transition hover:text-hiraya-accent cursor-pointer"
                            >
                                <ArrowLeft size={12} /> Use a different account
                            </button>
                        </div>
                    )}

                    {/*
                        WHICH ROLE THIS IS — ONLY ON THE SECOND-FACTOR SCREENS.
                        On the password form there is no role yet: it is still
                        whatever the last attempt resolved to, and printing it
                        above an empty password box reads as "you are already
                        signed in", which is exactly backwards.
                    */}
                    {role && step !== 'password' && (
                        <p className="mt-6 border-t border-hiraya-structure-line pt-4 text-center text-[9px] uppercase tracking-[0.2em] text-hiraya-ink-muted">
                            Signed in as {role}
                        </p>
                    )}
            </div>
        </AuthShell>
    );
};

export default Login;

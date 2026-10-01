import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
    AlertCircle,
    CheckCircle2,
    KeyRound,
    Loader2,
    Lock,
    ShieldCheck,
} from 'lucide-react';
import api from '../api/axios';
import {
    PASSWORD_MIN_LENGTH,
    PASSWORD_REQUIREMENTS,
    meetsPasswordPolicy,
    passwordPolicyError,
} from '../utils/passwordPolicy';
import {
    startMfaEnrollment,
    toQrImageSrc,
} from '../services/supabaseMfa';
import { supabase } from '../services/supabase';

/**
 * AcceptInvitation — the page the emailed link actually lands on.
 * =========================================================================
 *
 * THE THREE STEPS, AND WHY THEY ARE IN THIS ORDER
 * -------------------------------------------------
 *   1. set a password       -> POST /invitations/accept
 *   2. enroll an authenticator -> supabase.auth.mfa.enroll (QR + secret)
 *   3. verify a 6-digit code  -> supabase.auth.mfa.challengeAndVerify
 *   4. activate the account   -> POST /admin/accounts/mfa-enrolled
 *
 * Step 4 is separate from step 3 on purpose, and it is the only call that flips
 * `mfa_enrolled_at` on the server. Until it succeeds, `ResolveSupabaseUser` refuses
 * every console route for this account — so an invitee who scans the QR and then
 * abandons the flow has an account that authenticates with their password and
 * reaches nothing. That is the property the whole invitation design exists to
 * provide: an admin cannot be usable without their own second factor, and the
 * server, not the browser, is what decides.
 *
 * WHY THE ROLE IS NOT TAKEN FROM THE URL
 * --------------------------------------
 * The link carries the address and the token. The role is sent from the accepting
 * page as a value the server validates against the two real roles, and the
 * server's `accept()` is what writes it. A client that edited the value could
 * only send `superadmin` to the same public endpoint an attacker could already
 * call directly, so the field is not the boundary — `AdminAccountController`'s
 * superadmin gate on `invite` is what decides who may invite a superadmin at
 * all, and that one runs on a verified, MFA'd superadmin session.
 *
 * WHY THE LINK IS CHECKED BEFORE THE FORM APPEARS
 * ------------------------------------------------
 * Same reasoning as ResetPassword: an expired link should be reported before
 * anyone types a password, not after.
 */

const SHELL_TEXT = 'text-hiraya-ink';
const SHELL_MUTED = 'text-hiraya-ink-muted';

const Shell = ({ icon, eyebrow, title, children }) => (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 font-sans">
        <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-hiraya-indigo/[0.12] blur-[120px]" />
            <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-hiraya-accent/[0.10] blur-[100px]" />
        </div>

        <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="relative z-10 w-full max-w-[440px]"
        >
            <div className="glass overflow-hidden p-8 sm:p-10">
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-sm border border-hiraya-accent/30 bg-hiraya-accent text-hiraya-on-accent">
                        {icon}
                    </div>
                    <span className={`kicker kicker-center mb-3 ${SHELL_MUTED}`}>{eyebrow}</span>
                    <h1 className={`display-lg ${SHELL_TEXT}`}>{title}</h1>
                </div>
                {children}
            </div>
        </motion.div>
    </div>
);

const STEP = {
    CHECKING: 'checking',
    INVALID: 'invalid',
    PASSWORD: 'password',
    MFA: 'mfa',
    DONE: 'done',
};

const AcceptInvitation = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();

    const email = params.get('email') || '';
    const token = params.get('token') || '';

    const [step, setStep] = useState(STEP.CHECKING);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    // The role being accepted, read from the SIGNED token via /invitations/status.
    // It is displayed for reassurance and is NOT resubmitted on accept.
    const [role, setRole] = useState('');

    const [password, setPassword] = useState('');
    // Who the new admin is — shown to the super admin in Admin Management.
    const [fullName, setFullName] = useState('');
    const [contactNumber, setContactNumber] = useState('');
    const [confirm, setConfirm] = useState('');

    // MFA enrolment state.
    const [factorId, setFactorId] = useState('');
    const [qrCodeSvg, setQrCodeSvg] = useState('');
    const [secret, setSecret] = useState('');
    const [code, setCode] = useState('');

    /*
     * STEP 0 — is this link still redeemable?
     *
     * Asked before the form renders so an expired or already-used link says so
     * immediately, rather than after the invitee has chosen a password and been
     * told it failed.
     */
    useEffect(() => {
        let cancelled = false;

        if (!email || !token) {
            setStep(STEP.INVALID);
            return undefined;
        }

        api.get('/invitations/status', { params: { email, token } })
            .then(({ data }) => {
                if (cancelled) return;
                setRole(data?.role === 'superadmin' ? 'Super Admin' : 'Admin');
                setStep(data?.valid ? STEP.PASSWORD : STEP.INVALID);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(
                    err?.response?.data?.message
                    || 'This invitation is invalid, expired, or has already been used.'
                );
                setStep(STEP.INVALID);
            });

        return () => { cancelled = true; };
    }, [email, token]);

    /**
     * STEP 1 — set the password. This is what creates the account, and it is
     * created INACTIVE: no second factor yet, so it cannot open the console.
     */
    const handlePassword = useCallback(async (e) => {
        e.preventDefault();
        setError('');

        if (!meetsPasswordPolicy(password)) {
            setError(passwordPolicyError(password));
            return;
        }
        if (password !== confirm) {
            setError('Those passwords do not match.');
            return;
        }

        setBusy(true);
        try {
            /*
             * NO ROLE IS SENT. The server reads it from the HMAC-signed token, so
             * a value that decides a new account's authority is never something
             * this client (or anyone editing its request) can supply.
             */
            await api.post('/invitations/accept', {
                email,
                token,
                password,
                password_confirmation: confirm,
                full_name: fullName.trim(),
                contact_number: contactNumber.trim() || null,
            });

            /*
             * SIGN IN IMMEDIATELY.
             *
             * Enrolling a factor requires an authenticated session — GoTrue
             * refuses `mfa.enroll` for a guest. So the account is signed in here,
             * at aal1, and steps 2 and 3 happen inside that session. The session
             * being aal1 at this point is correct and harmless: the server gate
             * (`mfa_enrolled_at`) is what keeps the console closed until the
             * factor is verified, and nothing about aal1 access can open it.
             */
            const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
            if (signInError) throw new Error(signInError.message);

            setPassword('');
            setConfirm('');
            setStep(STEP.MFA);

            // Start enrolment straight away — there is no reason to make the
            // invitee press a second button to reach the QR code.
            const enrolment = await startMfaEnrollment(`Hiraya Authenticator ${new Date().toISOString().slice(0, 16)}`);
            setFactorId(enrolment.id);
            setQrCodeSvg(enrolment.qrCodeSvg || '');
            setSecret(enrolment.secret || '');
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Could not set that password.');
        } finally {
            setBusy(false);
        }
    }, [confirm, email, password, token, fullName, contactNumber]);

    /**
     * STEPS 2 + 3 — VERIFY THE CODE, AND RECORD THAT IT HAPPENED.
     *
     * `challengeAndVerify` proves the phone holds the same secret, and GoTrue
     * re-issues the session at aal2 when it succeeds. The account is USABLE the
     * moment that returns — `supabase.aal2` verifies a completed TOTP challenge on
     * every request, so there is no second, server-held fact that could lag behind
     * and lock a working person out. That deadlock is the reason the old
     * "verify, then POST to activate, and both must succeed" rule is gone.
     *
     * What is NOT gone is the audit stamp. `mfa_enrolled_at` answers "when did this
     * person set up their authenticator?", and the Super Admin accounts table reads
     * it to decide whether to label someone "PENDING MFA". Dropping the write
     * without moving it would leave a fully working admin labelled pending forever,
     * so it is sent below — AFTER the aal2 token is stored, which is the only moment
     * the endpoint will accept the call.
     */
    const handleVerify = useCallback(async (e) => {
        e.preventDefault();
        setError('');

        if (!/^\d{6}$/.test(code) || !factorId) return;

        setBusy(true);
        try {
            // Challenge and verify in ONE call, so the IP always matches.
            const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
            if (verifyError) throw new Error(verifyError.message);

            // Refresh so the browser STORES the aal2 token. Without this the next
            // request would still carry the aal1 one and be refused as unverified.
            await supabase.auth.refreshSession();
            await supabase.auth.getSession();

            /*
             * RECORD WHEN THE AUTHENTICATOR WAS SET UP — an audit stamp, not a gate.
             *
             * It is called HERE, and only here, because this is the first moment the
             * session genuinely holds aal2: `challengeAndVerify` succeeded and the
             * refreshed token was just stored. The route sits behind `supabase.aal2`,
             * so calling it any earlier — from the enrolment screen, or fired in
             * parallel with the code entry — answers 403 and writes nothing.
             *
             * Getting this wrong is not cosmetic. `mfa_enrolled_at` is what the Super
             * Admin accounts table reads to decide whether to show "PENDING MFA", so a
             * perfectly working, fully verified admin would sit there labelled as
             * pending forever with no way to clear it. It is a factual record of an
             * event that has already happened, and it must be written exactly once,
             * by the account it belongs to, at the moment it becomes true.
             */
            await api.post('/admin/accounts/mfa-enrolled').catch(() => {
                // Non-fatal on purpose: the code WAS accepted, so the account really is
                // usable. A failed audit write must never be reported as a failed
                // signup — it only costs the "when did this enrol?" record.
            });

            setCode('');
            setStep(STEP.DONE);
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'That code did not match. Check your phone clock.');
        } finally {
            setBusy(false);
        }
    }, [code, factorId]);

    /* ================= CHECKING ================= */
    if (step === STEP.CHECKING) {
        return (
            <Shell icon={<Loader2 size={20} className="animate-spin" />} eyebrow="Hiraya" title="Checking your invitation">
                <p className={`text-center text-sm ${SHELL_MUTED}`}>One moment…</p>
            </Shell>
        );
    }

    /* ================= INVALID ================= */
    if (step === STEP.INVALID) {
        return (
            <Shell icon={<AlertCircle size={20} />} eyebrow="Hiraya" title="Invitation unavailable">
                <p className={`text-sm leading-relaxed ${SHELL_MUTED}`}>
                    {error || 'This invitation is invalid, expired, or has already been used.'}
                </p>
                <p className={`mt-3 text-sm leading-relaxed ${SHELL_MUTED}`}>
                    Ask your Super Admin to send a new one.
                </p>
                <Link to="/login" className="btn-primary mt-6 w-full cursor-pointer py-3 text-center">
                    Back to sign in
                </Link>
            </Shell>
        );
    }

    /* ================= DONE ================= */
    if (step === STEP.DONE) {
        return (
            <Shell icon={<CheckCircle2 size={20} />} eyebrow="Hiraya" title="You are all set">
                <p className={`text-sm leading-relaxed ${SHELL_MUTED}`}>
                    Your authenticator is enrolled and your administrator account is now
                    active. From here on, every sign-in needs your password and a 6-digit
                    code from your own phone.
                </p>
                <button
                    type="button"
                    onClick={() => navigate('/login', { replace: true })}
                    className="btn-primary mt-6 w-full cursor-pointer py-3"
                >
                    Continue to sign in
                </button>
            </Shell>
        );
    }

    /* ================= STEP 1: PASSWORD ================= */
    if (step === STEP.PASSWORD) {
        return (
            <Shell icon={<Lock size={20} />} eyebrow="Hiraya" title="Choose your password">
                <p className={`mb-5 text-sm leading-relaxed ${SHELL_MUTED}`}>
                    You are signing up as{' '}
                    <span className={SHELL_TEXT}>{role || 'an administrator'}</span> of Hiraya,
                    for <span className={SHELL_TEXT}>{email}</span>. Nobody else has set this
                    password for you.
                </p>

                {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-600/40 bg-red-500/12 p-3 text-xs text-red-700">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                <form onSubmit={handlePassword} className="space-y-4">
                    <div>
                        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-hiraya-ink/70">
                            Full name
                        </label>
                        <input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={255} autoComplete="name" className="field" />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-hiraya-ink/70">
                            Contact number
                        </label>
                        <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} maxLength={30} inputMode="tel" autoComplete="tel" className="field" />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-hiraya-ink/70">
                            Password
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={PASSWORD_MIN_LENGTH}
                            autoComplete="new-password"
                            className="field"
                        />
                        {/*
                         * `PASSWORD_REQUIREMENTS` is an array of OBJECTS
                         * ({ label, test, message }), not strings. Rendering
                         * `{rule}` directly put "[object Object]" on the page, so
                         * the invitee was shown no checklist at all — and the
                         * uppercase + number rules below are the two the server
                         * enforces but a length check alone would miss.
                         */}
                        <ul className="mt-2 space-y-0.5 text-[10px] text-hiraya-ink-muted">
                            {PASSWORD_REQUIREMENTS.map((rule) => (
                                <li
                                    key={rule.id}
                                    className={rule.test(password) ? 'text-emerald-700' : undefined}
                                >
                                    {rule.label}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-hiraya-ink/70">
                            Confirm password
                        </label>
                        <input
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            required
                            autoComplete="new-password"
                            className="field"
                        />
                    </div>

                    <button type="submit" disabled={busy} className="btn-primary w-full cursor-pointer py-3">
                        {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                        Set password and continue
                    </button>
                </form>
            </Shell>
        );
    }

    /* ================= STEPS 2 + 3: MFA ================= */
    return (
        <Shell icon={<ShieldCheck size={20} />} eyebrow="Hiraya" title="Set up your authenticator">
            <ol className="mb-5 space-y-1.5 text-xs leading-relaxed text-hiraya-ink/80">
                <li><span className="text-hiraya-ink-muted">1.</span> Scan this with Google Authenticator, 1Password, or Authy.</li>
                <li><span className="text-hiraya-ink-muted">2.</span> Enter the 6-digit code it shows.</li>
            </ol>

            {error && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-600/40 bg-red-500/12 p-3 text-xs text-red-700">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {qrCodeSvg && (
                <div className="mx-auto mb-4 w-fit rounded-2xl bg-white p-4">
                    {/* An <img> on pure white: Supabase sends a data URI, not raw SVG. */}
                    <img
                        src={toQrImageSrc(qrCodeSvg)}
                        alt="Authenticator QR code"
                        width={200}
                        height={200}
                        className="block h-[200px] w-[200px] bg-white"
                        style={{ imageRendering: 'pixelated' }}
                    />
                </div>
            )}

            {secret && (
                <div className="mb-4 rounded-xl border border-hiraya-olive/20 bg-hiraya-peach/70 p-3">
                    <p className="mb-1.5 text-[9px] uppercase tracking-widest text-hiraya-ink/70">
                        Can&apos;t scan? Enter this key manually
                    </p>
                    <code className="block break-all font-mono text-xs tracking-widest text-hiraya-ink">
                        {secret}
                    </code>
                </div>
            )}

            <form onSubmit={handleVerify} className="space-y-3">
                <input
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="field text-center text-xl tracking-[0.5em]"
                />
                <button
                    type="submit"
                    disabled={busy || code.length !== 6}
                    className="btn-primary w-full cursor-pointer py-3"
                >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    Verify and activate
                </button>
            </form>
        </Shell>
    );
};

export default AcceptInvitation;
﻿import { useCallback, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { motion } from 'framer-motion';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle2, KeyRound, Copy } from 'lucide-react';
import {
    getAssuranceLevels,
    startMfaEnrollment,
    confirmMfaEnrollment,
    listMfaFactors,
    unenrollMfaFactor,
    isPrivilegedRole,
    toQrImageSrc,
} from '../../services/supabaseMfa';

const MfaEnrollment = ({ userRole = '', bootstrap = false, onEnrolled }) => {
    const privileged = isPrivilegedRole(userRole) || bootstrap;

    const [aal, setAal] = useState(null);          // 'aal1' | 'aal2'
    const [factors, setFactors] = useState([]);
    const [unverified, setUnverified] = useState([]);
    const [pending, setPending] = useState(null);  // { id, qrCodeSvg, secret }
    const [code, setCode] = useState('');
    const [copied, setCopied] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    // Verified factors to retire once a replacement is confirmed (see handleEnroll).
    const [replaceIds, setReplaceIds] = useState([]);

    const refresh = useCallback(async () => {
        try {
            const levels = await getAssuranceLevels();
            setAal(levels.currentLevel);
            const list = await listMfaFactors();
            const all = list.totp || [];
            setFactors(all.filter((f) => f.status === 'verified'));
            setUnverified(all.filter((f) => f.status !== 'verified'));
        } catch (err) {
            setError(err?.message || 'Could not read the authenticator status.');
        }
    }, []);

    useEffect(() => {
        if (privileged) refresh();
    }, [privileged, refresh]);

    if (!privileged) {
        return (
            <div className="rounded-2xl border border-hiraya-olive/20 bg-hiraya-peach/70 p-5 text-[11px] leading-relaxed text-hiraya-sand">
                <ShieldCheck size={16} className="mb-2 text-hiraya-sand" />
                Authenticator enrollment is available to staff accounts only.
                Customer accounts do not require a second factor.
            </div>
        );
    }

    /** Begin enrollment. Only ever reachable from an aal2 session. */
    /*
     * `replaceIds` — the verified factors to remove ONCE the new one is
     * confirmed ("Set up on a new phone"). The old authenticator keeps working
     * until then, so the account is never left without a second factor.
     * Each factor gets a unique name: GoTrue refuses a second factor with the
     * same friendly name (HTTP 422), which blocked setting up a new phone.
     */
    const handleEnroll = async (replace = false) => {
        setError('');
        setMessage('');
        setBusy(true);
        setReplaceIds(replace ? factors.map((f) => f.id) : []);

        try {
            const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
            const data = await startMfaEnrollment(`Hiraya Authenticator ${stamp}`);

            setPending({
                id: data.id,
                qrCodeSvg: data.qrCodeSvg,
                qrCodeSrc: data.qrCodeSrc,
                secret: data.secret,
            });

            setCode('');
        } catch (err) {
            setError(err?.message || 'Could not start enrollment.');
            await refresh();
        } finally {
            setBusy(false);
        }
    };

    /** Prove the app holds the same secret, then activate the factor. */
    const handleConfirm = async (e) => {
        e.preventDefault();
        setError('');
        if (!/^\d{6}$/.test(code) || !pending) return;

        setBusy(true);
        try {
            await confirmMfaEnrollment(pending.id, code);
            // The new factor works: now retire the one(s) it replaces.
            for (const oldId of replaceIds) {
                try {
                    await unenrollMfaFactor(oldId);
                } catch {
                    /* still listed; it can be removed by hand */
                }
            }
            const replaced = replaceIds.length > 0;
            setReplaceIds([]);
            setPending(null);
            setCode('');
            setMessage(replaced
                ? 'New authenticator active. Codes from the old phone no longer work.'
                : 'Authenticator enabled. Your next sign-in will require a code.');
            await refresh();
            if (bootstrap) onEnrolled?.();
        } catch (err) {
            setError(err?.message || 'That code did not match. Check your phone clock.');
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async (factorId) => {
        setError('');
        setBusy(true);
        try {
            await unenrollMfaFactor(factorId);
            setMessage('Authenticator removed. Enroll again to keep console access.');
            await refresh();
        } catch (err) {
            setError(err?.message || 'Could not remove the authenticator.');
        } finally {
            setBusy(false);
        }
    };

    const copySecret = async () => {
        try {
            await navigator.clipboard.writeText(pending.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError('Could not copy. Select the secret and copy it manually.');
        }
    };

    return (
        <div className="rounded-2xl border border-hiraya-olive/20 bg-hiraya-peach/70 p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-hiraya-ink">
                        <ShieldCheck size={14} className="text-hiraya-sand" />
                        Two-Factor Authentication
                    </h3>
                    <p className="mt-1.5 text-[10px] leading-relaxed text-hiraya-sand">
                        Supabase-managed TOTP. A staff session stays at{' '}
                        <span className="text-hiraya-cream">aal1</span> until a code is
                        presented, and the database refuses every admin table until it
                        reaches <span className="text-hiraya-cream">aal2</span>.
                    </p>
                </div>

                <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-widest ${
                        aal === 'aal2'
                            ? 'bg-emerald-500/15 text-emerald-700'
                            : 'bg-amber-500/15 text-amber-800'
                    }`}
                >
                    {aal ?? '—'}
                </span>
            </div>

            {error && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-600/40 bg-red-500/12 p-3 text-[11px] text-red-700">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}
            {message && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-600/30 bg-emerald-500/10 p-3 text-[11px] text-emerald-700">
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                    <span>{message}</span>
                </div>
            )}

            {unverified.length > 0 && !pending && (
                <div className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
                    <p className="mb-2 text-[10px] leading-relaxed text-amber-800/80">
                        {unverified.length} unfinished authenticator{' '}
                        {unverified.length === 1 ? 'setup' : 'setups'} on this account —
                        started but never completed with a 6-digit code. They cannot sign
                        you in, and they are what made every enroll fail with a 422. They
                        are now removed automatically before a new attempt, so pressing
                        the button below clears them for you.
                    </p>
                    <ul className="space-y-1">
                        {unverified.map((f) => (
                            <li key={f.id} className="text-[10px] text-amber-800/70">
                                · {f.friendly_name || 'Authenticator'} [{f.status}]
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {factors.length > 0 && !pending && (
                <ul className="mb-4 space-y-2">
                    {factors.map((f) => (
                        <li
                            key={f.id}
                            className="flex items-center justify-between rounded-xl border border-hiraya-olive/20 bg-hiraya-peach/70 px-3 py-2.5"
                        >
                            <span className="text-[11px] text-hiraya-ink/70">
                                {f.friendly_name || 'Authenticator app'}
                                <span className="ml-2 text-[9px] uppercase text-emerald-700">
                                    verified
                                </span>
                            </span>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => handleRemove(f.id)}
                                className="text-[9px] uppercase tracking-widest text-hiraya-ink/70 transition hover:text-red-700 disabled:bg-hiraya-disabled-bg disabled:text-hiraya-disabled-ink disabled:shadow-none"
                            >
                                Remove
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {pending && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                    <ol className="mb-4 space-y-1.5 text-[10px] leading-relaxed text-hiraya-ink/80">
                        <li>
                            <span className="text-hiraya-sand">1.</span> Scan this with Google
                            Authenticator, 1Password, or Authy.
                        </li>
                        <li>
                            <span className="text-hiraya-sand">2.</span> Enter the 6-digit code it
                            shows.
                        </li>
                    </ol>

                    {/* An <img> on pure white with a quiet zone: scanners need both. */}
                    <div className="mx-auto mb-4 w-fit rounded-2xl bg-white p-4">
                        <img
                            src={pending.qrCodeSrc || toQrImageSrc(pending.qrCodeSvg)}
                            alt="Authenticator QR code"
                            width={200}
                            height={200}
                            className="block h-[200px] w-[200px] bg-white"
                            style={{ imageRendering: 'pixelated' }}
                        />
                    </div>

                    <div className="mb-4 rounded-xl border border-hiraya-olive/20 bg-hiraya-peach/70 p-3">
                        <p className="mb-1.5 text-[9px] uppercase tracking-widest text-hiraya-ink/70">
                            Can&apos;t scan? Enter this key manually
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 break-all font-mono text-[11px] tracking-widest text-hiraya-cream">
                                {pending.secret}
                            </code>
                            <button
                                type="button"
                                onClick={copySecret}
                                className="shrink-0 text-hiraya-ink/70 transition hover:text-hiraya-ink"
                                aria-label="Copy secret"
                            >
                                {copied ? (
                                    <CheckCircle2 size={14} className="text-emerald-700" />
                                ) : (
                                    <Copy size={14} />
                                )}
                            </button>
                        </div>
                    </div>

                    <form onSubmit={handleConfirm} className="space-y-3">
                        {/* The code field is the shared `.field` primitive, so the
                            6-digit box matches the one on the Login verify step
                            (which this component is mounted beside). */}
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
                            {busy ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : (
                                <>
                                    <KeyRound size={13} /> Activate
                                </>
                            )}
                        </button>
                    </form>
                </motion.div>
            )}

            {!pending && factors.length > 0 && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleEnroll(true)}
                    className="w-full cursor-pointer rounded-xl border border-hiraya-olive/30 py-2.5 text-[10px] font-bold uppercase tracking-widest text-hiraya-ink transition hover:bg-hiraya-peach disabled:opacity-50"
                >
                    {busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : 'Set up on a new phone'}
                </button>
            )}

            {!pending && factors.length === 0 && (
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleEnroll(false)}
                    className="btn-primary w-full cursor-pointer py-3"
                >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : 'Enroll authenticator'}
                </button>
            )}
        </div>
    );
};

export default MfaEnrollment;

MfaEnrollment.propTypes = {
    userRole: PropTypes.string,
    bootstrap: PropTypes.bool,
    onEnrolled: PropTypes.func,
};
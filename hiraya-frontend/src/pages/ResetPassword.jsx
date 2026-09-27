import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import api, { parseApiError } from '../api/axios';

/**
 * ResetPassword — the page the emailed link actually lands on.
 *
 * WHY THIS PAGE HAD TO EXIST
 * --------------------------
 * The mail was never sent (the Forgot page called `/check-email`), and even if
 * it had been, there was no route for the link to open — the customer would have
 * clicked through to a 404. A reset flow is three parts and all three have to be
 * real: issue, deliver, and REDEEM. This is the redeem half.
 *
 * THE LINK IS VALIDATED BEFORE THE FORM IS SHOWN
 * ----------------------------------------------
 * `token` and `email` arrive in the query string. On mount we ask the backend
 * whether that pair is still usable, and render one of three states:
 *
 *    checking -> a spinner, briefly
 *    invalid  -> "this link is expired or already used" + a route to request a
 *                new one. NO password fields are shown, because typing one would
 *                be wasted work.
 *    valid    -> the form
 *
 * The alternative (show the form, fail on submit) makes the customer choose a
 * password, then tells them the link was dead — and because the reset endpoint
 * answers generically for security, the failure would read like success.
 *
 * THE SUCCESS COPY DOES NOT AUTO-REDIRECT
 * ---------------------------------------
 * The Forgot page bounces back to /login after a delay; this one deliberately
 * does not. Auto-navigating away from a "your password has changed" confirmation
 * can leave a customer unsure whether it happened, and this is the exact moment
 * they need to be certain. They click through when they are ready.
 */

const MIN_PASSWORD_LENGTH = 8;

/** Same shape check the Forgot gateway uses, for instant client-side feedback. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATE = {
  CHECKING: 'checking',
  INVALID: 'invalid',
  READY: 'ready',
  DONE: 'done',
};

/*
 * STRENGTH IS ADVISORY, NOT A GATE.
 *
 * The backend enforces the real rule (min 8, matched confirmation). Showing a
 * strength meter that BLOCKS a password the server would accept is how a
 * customer ends up arguing with a form; showing it while still allowing the
 * submit teaches the same lesson without holding anyone hostage.
 */
const strengthOf = (value) => {
  if (!value) return { score: 0, label: '', tone: 'text-hiraya-sand' };
  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score <= 2) return { score, label: 'Weak', tone: 'text-red-500' };
  if (score === 3) return { score, label: 'Fair', tone: 'text-[#CB997E]' };
  if (score === 4) return { score, label: 'Strong', tone: 'text-hiraya-olive' };
  return { score, label: 'Very strong', tone: 'text-hiraya-olive' };
};

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const token = (searchParams.get('token') || '').trim();

  const [state, setState] = useState(STATE.CHECKING);
  const [invalidReason, setInvalidReason] = useState('');

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ password: false, confirmation: false });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /* The link is unusable before we even call the API — no address, no token. */
  const linkIsWellFormed = EMAIL_REGEX.test(email) && token.length > 0;

  const checkToken = useCallback(async () => {
    if (!linkIsWellFormed) {
      setState(STATE.INVALID);
      setInvalidReason('This reset link is incomplete. Request a new one.');
      return;
    }

    try {
      const res = await api.post('/validate-reset-token', { email, token });
      if (res.data?.valid) {
        setState(STATE.READY);
      } else {
        setInvalidReason(res.data?.message || 'This reset link is invalid or has expired.');
        setState(STATE.INVALID);
      }
    } catch (err) {
      /*
       * A NETWORK failure is not proof the link is bad, but it is also not a
       * green light to show a form that cannot submit. Treated as invalid with
       * wording that points at the retry, which is the actionable next step.
       */
      const { message } = parseApiError(err);
      setInvalidReason(message || 'We could not verify this link. Please try again.');
      setState(STATE.INVALID);
    }
  }, [email, token, linkIsWellFormed]);

  useEffect(() => {
    checkToken();
  }, [checkToken]);

  const strength = useMemo(() => strengthOf(password), [password]);

  const passwordError = useMemo(() => {
    if (!touched.password) return '';
    if (!password) return 'A new password is required.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return '';
  }, [touched.password, password]);

  const confirmationError = useMemo(() => {
    if (!touched.confirmation) return '';
    if (!confirmation) return 'Please confirm your new password.';
    if (confirmation !== password) return 'The two passwords do not match.';
    return '';
  }, [touched.confirmation, confirmation, password]);

  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH &&
    confirmation === password &&
    !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched({ password: true, confirmation: true });
    setError('');

    if (!canSubmit) return;

    setLoading(true);
    try {
      /*
       * The backend answers generically on every outcome (by design — it must not
       * confirm which addresses exist). We therefore treat a 200 as success, but
       * we do NOT claim the password changed: `invalid` here means the token had
       * expired between the check above and this submit, which the copy covers.
       */
      const res = await api.post('/reset-password-direct', {
        email,
        token,
        password,
        password_confirmation: confirmation,
      });

      if (res.status === 200) {
        setState(STATE.DONE);
      }
    } catch (err) {
      const { message, errors } = parseApiError(err);
      setError(
        errors?.password?.[0] ||
        errors?.token?.[0] ||
        message ||
        'We could not reset your password. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  /* Shared shell: identical framing for every state, so the page never jumps. */
  const Shell = ({ icon, eyebrow, title, children }) => (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-hiraya-bg p-4 font-sans">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-[#CB997E]/10 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-hiraya-matcha/30 blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-[420px]"
      >
        <div className="overflow-hidden rounded-[2rem] border border-hiraya-olive/15 bg-hiraya-cream-deep/80 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-hiraya-olive/20 bg-[#CB997E]/15 text-hiraya-ink">
              {icon}
            </div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-hiraya-olive/70">
              {eyebrow}
            </p>
            <h1 className="font-serif text-3xl uppercase leading-none tracking-[0.25em] text-hiraya-ink">
              {title}
            </h1>
          </div>

          {children}
        </div>
      </motion.div>
    </div>
  );

  /* ---------------------------------------------------------------- CHECKING */

  if (state === STATE.CHECKING) {
    return (
      <Shell icon={<Lock size={20} />} eyebrow="Verifying your link" title="One moment">
        <div className="flex flex-col items-center gap-3 py-6 text-hiraya-olive/70">
          <Loader2 size={26} className="animate-spin text-[#CB997E]" />
          <span className="text-[11px] uppercase tracking-[0.2em]">Checking this reset link…</span>
        </div>
      </Shell>
    );
  }

  /* ----------------------------------------------------------------- INVALID */

  if (state === STATE.INVALID) {
    return (
      <Shell
        icon={<ShieldAlert size={20} />}
        eyebrow="Link not usable"
        title="Link expired"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
            <p className="text-[11px] leading-relaxed text-hiraya-ink">
              {invalidReason}
            </p>
          </div>

          {/*
            * The most common cause is covered explicitly, because "invalid link"
            * on its own sends people to support when the fix is one click away.
            */}
          <div className="rounded-2xl border border-hiraya-olive/15 bg-hiraya-cream/40 p-4 text-[11px] leading-relaxed text-hiraya-olive/80">
            Reset links expire after 60 minutes and work only once. If you have
            already reset your password with this link, simply sign in with the
            new one.
          </div>

          <button
            type="button"
            onClick={() => navigate('/forgot-password', { replace: true })}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-4 text-xs font-bold uppercase tracking-widest text-hiraya-cream shadow-lg transition-all hover:bg-[#A5A58D] active:scale-95"
          >
            Request a new link
          </button>

          <Link
            to="/login"
            className="flex w-full items-center justify-center gap-2 text-[11px] uppercase tracking-[0.2em] text-hiraya-olive/70 transition-colors hover:text-hiraya-ink"
          >
            <ArrowLeft size={13} /> Back to sign in
          </Link>
        </div>
      </Shell>
    );
  }

  /* -------------------------------------------------------------------- DONE */

  if (state === STATE.DONE) {
    return (
      <Shell
        icon={<CheckCircle2 size={20} />}
        eyebrow="All set"
        title="Password changed"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-hiraya-olive/20 bg-[#CB997E]/15 p-4">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-hiraya-ink" />
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-widest text-hiraya-ink">
                Your new password is active
              </p>
              <p className="text-[11px] leading-relaxed text-hiraya-olive/80">
                Sign in with it now. For your security, every device that was
                signed in to this account has been signed out.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-4 text-xs font-bold uppercase tracking-widest text-hiraya-cream shadow-lg transition-all hover:bg-[#A5A58D] active:scale-95"
          >
            Sign in with the new password
          </button>
        </div>
      </Shell>
    );
  }

  /* -------------------------------------------------------------------- FORM */

  return (
    <Shell
      icon={<Sparkles size={20} />}
      eyebrow={`Resetting ${email}`}
      title="New password"
    >
      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-left text-xs font-medium text-red-500">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {/* NEW PASSWORD */}
        <div>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-hiraya-olive/50" />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="New password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              aria-invalid={!!passwordError}
              className={`w-full rounded-xl bg-hiraya-cream py-3.5 pl-12 pr-12 text-sm text-hiraya-ink placeholder-hiraya-olive/40 outline-none transition-all focus:ring-1 ${passwordError
                  ? 'border border-red-500/50 focus:border-red-500 focus:ring-red-500/30'
                  : 'border border-hiraya-olive/20 focus:border-[#CB997E] focus:ring-[#CB997E]/30'
                }`}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-olive/50 transition-colors hover:text-hiraya-ink"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* ADVISORY STRENGTH — never blocks the submit. */}
          {password && (
            <div className="mt-2 flex items-center gap-2 px-1">
              <div className="flex h-1 flex-1 gap-1 overflow-hidden rounded-full">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`h-full flex-1 rounded-full transition-colors ${i < strength.score ? 'bg-[#CB997E]' : 'bg-hiraya-olive/15'
                      }`}
                  />
                ))}
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${strength.tone}`}>
                {strength.label}
              </span>
            </div>
          )}

          <div className="min-h-[16px] px-2 pt-1">
            {passwordError ? (
              <p className="text-[10px] font-medium text-red-500">{passwordError}</p>
            ) : (
              <p className="text-[10px] text-hiraya-olive/60">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
          </div>
        </div>

        {/* CONFIRMATION */}
        <div>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-hiraya-olive/50" />
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Confirm new password"
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
                if (error) setError('');
              }}
              onBlur={() => setTouched((t) => ({ ...t, confirmation: true }))}
              aria-invalid={!!confirmationError}
              className={`w-full rounded-xl bg-hiraya-cream py-3.5 pl-12 pr-12 text-sm text-hiraya-ink placeholder-hiraya-olive/40 outline-none transition-all focus:ring-1 ${confirmationError
                  ? 'border border-red-500/50 focus:border-red-500 focus:ring-red-500/30'
                  : 'border border-hiraya-olive/20 focus:border-[#CB997E] focus:ring-[#CB997E]/30'
                }`}
              required
            />
            {confirmation && confirmation === password && (
              <CheckCircle2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-olive" />
            )}
          </div>

          <div className="min-h-[16px] px-2 pt-1">
            {confirmationError && (
              <p className="text-[10px] font-medium text-red-500">{confirmationError}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#CB997E] py-4 text-xs font-bold uppercase tracking-widest text-hiraya-cream shadow-lg transition-all hover:bg-[#A5A58D] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Saving…
            </>
          ) : (
            <>
              <ShieldAlert size={15} /> Set new password
            </>
          )}
        </button>
      </form>

      <p className="mt-8 text-center text-[11px] text-hiraya-olive/60">
        Remembered it?{' '}
        <Link
          to="/login"
          className="ml-1 border-b border-hiraya-olive/20 font-bold text-hiraya-ink transition-colors hover:text-[#CB997E]"
        >
          Back to Sign In
        </Link>
      </p>
    </Shell>
  );
};

export default ResetPassword;
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
    PASSWORD_MIN_LENGTH,
    PASSWORD_REQUIREMENTS,
    meetsPasswordPolicy,
    passwordPolicyError,
} from '../utils/passwordPolicy';

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

const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;

/** Same shape check the Forgot gateway uses, for instant client-side feedback. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATE = {
  CHECKING: 'checking',
  INVALID: 'invalid',
  READY: 'ready',
  DONE: 'done',
};

/*
 * THE SHELL — DECLARED AT MODULE SCOPE, NOT INSIDE THE COMPONENT.
 *
 * WHY THIS MOVED OUT
 * ------------------
 * `Shell` used to be defined in the body of ResetPassword, so every render of
 * the page created a brand-new function, and therefore a brand-new COMPONENT
 * TYPE. React compares element types by identity, so on each keystroke React
 * unmounted the old shell and mounted a fresh one — destroying the password
 * input, throwing it away and rebuilding it empty. That is the bug reported as
 * "the page refreshes while I type": the password arrived as a single
 * character, and the text appeared to run backwards because focus was lost and
 * the caret returned to position 0 on every keystroke.
 *
 * Declared here, it is ONE stable type for the lifetime of the module, so a
 * keystroke re-renders the input and leaves the DOM node, its focus and its
 * caret alone.
 */
const Shell = ({ icon, eyebrow, title, children }) => (
  <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 font-sans">
    {/* Same two-colour ambient lighting as the other auth gateways, so the four
        screens read as one set. */}
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-hiraya-indigo/[0.12] blur-[120px]" />
      <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-hiraya-accent/[0.10] blur-[100px]" />
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
            {icon}
          </div>
          <span className="kicker kicker-center mb-3 text-hiraya-ink-muted">
            {eyebrow}
          </span>
          <h1 className="display-lg text-hiraya-ink">
            {title}
          </h1>
        </div>

        {children}
      </div>
    </motion.div>
  </div>
);

/*
 * STRENGTH IS ADVISORY; THE POLICY IS NOT.
 *
 * The five-segment strength meter below is deliberately advisory — it scores
 * beyond the minimum and never blocks the submit on its own, because a meter
 * that refuses a password the server would happily accept is how a customer
 * ends up arguing with a form.
 *
 * The GATE is the shared policy (see utils/passwordPolicy.js), which is the
 * same one Register enforces and the same one App\Rules\PasswordStrength
 * enforces on the server. This page used to check length alone, which meant a
 * customer could replace a strong password with a weak one and be told the
 * field was fine.
 */
const strengthOf = (value) => {
  if (!value) return { score: 0, label: '', tone: 'text-hiraya-ink-muted' };
  let score = 0;
  if (value.length >= MIN_PASSWORD_LENGTH) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score <= 2) return { score, label: 'Weak', tone: 'text-red-700' };
  if (score === 3) return { score, label: 'Fair', tone: 'text-amber-700' };
  if (score === 4) return { score, label: 'Strong', tone: 'text-emerald-700' };
  return { score, label: 'Very strong', tone: 'text-emerald-700' };
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

  /*
   * WHY THIS EFFECT IS GUARDED AGAINST RE-FIRING.
   *
   * The link is validated ONCE per (email, token) pair. The naive version —
   * `useEffect(checkToken, [checkToken])` — re-fired whenever the callback's
   * identity changed, and `checkToken` is recreated whenever any of its three
   * dependencies change. Two things made that happen continuously:
   *
   *   1. `searchParams` is a NEW object identity on every render of the route,
   *      so `email`/`token` (derived from it) change identity constantly.
   *   2. React's StrictMode double-invokes effects in development.
   *
   * The visible symptom was severe and reported as "the page refreshes while
   * typing": the component re-ran validation, React remounted the subtree, the
   * <input>'s state was thrown away, and a 12-character password arrived as a
   * single "Q". Validation is a one-shot gate — it has no reason to re-run once
   * it has answered, so it is pinned to a ref that changes only when the LINK
   * itself changes (a genuinely different email or token, e.g. the customer
   * pasted a second link into the same tab).
   */
  const checkedLinkRef = useRef(null);
  const linkKey = `${email}|${token}`;

  useEffect(() => {
    if (checkedLinkRef.current === linkKey) return;
    checkedLinkRef.current = linkKey;
    checkToken();
  }, [checkToken, linkKey]);

  const strength = useMemo(() => strengthOf(password), [password]);

  const passwordError = useMemo(() => {
    if (!touched.password) return '';
    return passwordPolicyError(password);
  }, [touched.password, password]);

  const confirmationError = useMemo(() => {
    if (!touched.confirmation) return '';
    if (!confirmation) return 'Please confirm your new password.';
    if (confirmation !== password) return 'The two passwords do not match.';
    return '';
  }, [touched.confirmation, confirmation, password]);

  const canSubmit =
    meetsPasswordPolicy(password) &&
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
       * THE ENDPOINT IS GENERIC, SO THE SUCCESS FLAG IS THE ONLY TRUTH.
       *
       * The backend answers the same 200 with the same message whether the reset
       * was applied or the token was dead — that is deliberate, so the endpoint
       * cannot be used to discover which addresses are registered. This code used
       * to treat ANY 200 as success, which made a dead link indistinguishable from
       * a completed one: submitting an expired or already-used token painted
       * "Password changed" and "every device has been signed out" while the
       * password had not moved a character, and the customer went off to try a
       * password that was never set.
       *
       * `reset` reports whether the signed token was actually CONSUMED, which is
       * not an enumeration oracle — a caller cannot hold a valid token without
       * having read the email it was sent to.
       *
       * FALLBACK RE-VALIDATION: if an older or differently-built backend omits
       * the flag entirely, we ask /validate-reset-token whether the token is
       * still good. A token that survived is proof the password was changed,
       * because consuming one invalidates it. That keeps an old backend honest
       * instead of regressing to "any 200 is a win".
       */
      const res = await api.post('/reset-password-direct', {
        email,
        token,
        password,
        password_confirmation: confirmation,
      });

      const applied = res.data?.reset;

      if (typeof applied !== 'boolean') {
        const recheck = await api.post('/validate-reset-token', { email, token });
        setState(recheck.data?.valid ? STATE.DONE : STATE.INVALID);

        if (!recheck.data?.valid) {
          setInvalidReason(
            recheck.data?.message ||
              'This reset link is invalid, expired, or has already been used. Request a new one.',
          );
        }
        return;
      }

      if (applied) {
        setState(STATE.DONE);
        return;
      }

      /*
       * The token was rejected. Say so, and send the customer somewhere that can
       * actually help — asking them to request a new link, rather than telling
       * them a password is active that is not.
       */
      setInvalidReason(
        'This reset link is invalid, expired, or has already been used. Request a new one.',
      );
      setState(STATE.INVALID);
    } catch (err) {
      /*
       * `parseApiError` already FLATTENS each field's message array down to a
       * single string, so `errors.password` is a string like "The password field
       * is required." — not an array. This code reached for `errors?.password?.[0]`,
       * which on a string returns its FIRST CHARACTER, so a validation failure
       * was displayed as the lone letter "T" on the error banner. Indexing a
       * string like an array is exactly the shape mismatch that made this look
       * like a backend problem.
       *
       * `errors` is a flat { field: string } map, so plain lookup is correct.
       */
      const { message, errors } = parseApiError(err);
      setError(
        errors?.password ||
        errors?.token ||
        errors?.email ||
        message ||
        'We could not reset your password. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  /* ---------------------------------------------------------------- CHECKING */

  if (state === STATE.CHECKING) {
    return (
      <Shell icon={<Lock size={20} />} eyebrow="Verifying your link" title="One moment">
        <div className="flex flex-col items-center gap-3 py-6 text-hiraya-ink-muted">
          <Loader2 size={26} className="animate-spin text-hiraya-accent" />
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
          <div className="flex items-start gap-3 rounded-sm border border-red-600/40 bg-red-500/12 p-4">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-700" />
            <p className="text-[11px] leading-relaxed text-hiraya-ink">
              {invalidReason}
            </p>
          </div>

          {/*
            * The most common cause is covered explicitly, because "invalid link"
            * on its own sends people to support when the fix is one click away.
            */}
          <div className="rounded-sm border border-hiraya-structure-line bg-hiraya-surface-raised p-4 text-[11px] leading-relaxed text-hiraya-ink-muted">
            Reset links expire after 60 minutes and work only once. If you have
            already reset your password with this link, simply sign in with the
            new one.
          </div>

          <button
            type="button"
            onClick={() => navigate('/forgot-password', { replace: true })}
            className="btn-primary w-full"
          >
            Request a new link
          </button>

          <Link
            to="/login"
            className="flex w-full items-center justify-center gap-2 text-[11px] uppercase tracking-[0.2em] text-hiraya-ink-muted transition-colors hover:text-hiraya-accent"
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
          <div className="flex items-start gap-3 rounded-sm border border-hiraya-accent/25 bg-hiraya-accent-wash p-4">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-hiraya-accent" />
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hiraya-accent">
                Your new password is active
              </p>
              <p className="text-[11px] leading-relaxed text-hiraya-ink-soft">
                Sign in with it now. For your security, every device that was
                signed in to this account has been signed out.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="btn-primary w-full"
          >
            Sign in with the new password
          </button>
        </div>
      </Shell>
    );
  }

  /* -------------------------------------------------------------------- FORM */

  /*
   * THE FORM IS ITS OWN COMPONENT, ON PURPOSE.
   *
   * THE BUG THIS FIXES: typing the new password lost every character after the
   * first, and the field jumped backwards ("Q" -> "aQ" -> "RaQ") as the caret
   * was thrown back to position 0 on each render. Reported as "the page
   * refreshes while I type".
   *
   * WHAT WAS ACTUALLY HAPPENING
   * --------------------------
   * `Shell` was defined INSIDE the ResetPassword component body, and the form
   * was passed to it as a `children` element. That makes `Shell` a NEW
   * COMPONENT TYPE on every render of the page — React compares element types
   * by identity, so a new type means the previous subtree is UNMOUNTED and a
   * fresh one MOUNTED. Measured in a browser: the same password input node
   * was gone and rebuilt after a single keystroke (`sameNode === false`), the
   * page never really reloaded (`performance` navigation entries stayed at 1),
   * and focus fell to <body> — which is exactly what sends the caret back to
   * the start of the field and reverses the text as you type.
   *
   * Moving both `Shell` and the form out here gives them stable identities, so
   * a keystroke re-renders the input and nothing else. The input keeps its
   * node, its focus and its caret.
   *
   * State that the form still needs from the page is passed in as props.
   */
  return (
    <ResetForm
      email={email}
      password={password}
      confirmation={confirmation}
      strength={strength}
      passwordError={passwordError}
      confirmationError={confirmationError}
      error={error}
      loading={loading}
      showPassword={showPassword}
      canSubmit={canSubmit}
      setPassword={setPassword}
      setConfirmation={setConfirmation}
      setShowPassword={setShowPassword}
      setTouched={setTouched}
      setError={setError}
      onSubmit={handleSubmit}
    />
  );
}

/**
 * The new-password form. Declared at module scope, so React sees ONE stable
 * component type for the lifetime of the page.
 */
const ResetForm = ({
  email,
  password,
  confirmation,
  strength,
  passwordError,
  confirmationError,
  error,
  loading,
  showPassword,
  canSubmit,
  setPassword,
  setConfirmation,
  setShowPassword,
  setTouched,
  setError,
  onSubmit,
}) => {
  return (
    <Shell
      icon={<Sparkles size={20} />}
      eyebrow={`Resetting ${email}`}
      title="New password"
    >
      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-sm border border-red-600/40 bg-red-500/12 p-3 text-left text-xs font-medium text-red-700">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {/* NEW PASSWORD */}
        <div>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-hiraya-ink-muted" />
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
              className={`field pl-12 pr-12 ${passwordError
                  ? 'border-red-500/50 focus:border-red-500'
                  : ''
                }`}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-ink-muted transition-colors hover:text-hiraya-accent cursor-pointer"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* ADVISORY STRENGTH — never blocks the submit. */}
          {password && (
            <div className="mt-2 flex items-center gap-2 px-1">
              {/* Five hairline segments, not rounded bars. */}
              <div className="flex h-[3px] flex-1 gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    className={`h-full flex-1 transition-colors ${i < strength.score ? 'bg-hiraya-accent' : 'bg-hiraya-structure-line'
                      }`}
                  />
                ))}
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${strength.tone}`}>
                {strength.label}
              </span>
            </div>
          )}

          <div className="min-h-[16px] px-2 pt-1">
            {passwordError ? (
              <p className="text-[10px] font-medium text-red-700">{passwordError}</p>
            ) : (
              <p className="text-[10px] text-hiraya-ink-muted">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            )}
          </div>
        </div>

        {/* CONFIRMATION */}
        <div>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-hiraya-ink-muted" />
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
              className={`field pl-12 pr-12 ${confirmationError
                  ? 'border-red-500/50 focus:border-red-500'
                  : ''
                }`}
              required
            />
            {confirmation && confirmation === password && (
              <CheckCircle2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-600" />
            )}
          </div>

          <div className="min-h-[16px] px-2 pt-1">
            {confirmationError && (
              <p className="text-[10px] font-medium text-red-700">{confirmationError}</p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary w-full"
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

      {/*
       * LEGACY TOKENS REMOVED.
       *
       * This footer line was the last place on the page still reaching for the
       * retired aliases: `text-hiraya-olive/80` (olive is now indigo, so the
       * caption rendered DARK on a dark-tinted ground) and a raw
       * `hover:text-[#541A1A]` hex that bypassed the accent token. It now uses
       * the same ruled footer the other three auth gateways use, so all four
       * screens end identically.
       */}
      <p className="mt-8 border-t border-hiraya-structure-line pt-5 text-center text-[11px] text-hiraya-ink-muted">
        Remembered it?{' '}
        <Link
          to="/login"
          className="ml-1 border-b border-hiraya-accent/40 font-semibold text-hiraya-ink transition-colors hover:text-hiraya-accent"
        >
          Back to Sign In
        </Link>
      </p>
    </Shell>
  );
};

export default ResetPassword;
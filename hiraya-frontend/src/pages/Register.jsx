import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Check, X, CheckCircle2, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseApiError } from '../api/axios';
import AuthShell from '../components/auth/AuthShell';
import {
    PASSWORD_REQUIREMENTS,
    meetsPasswordPolicy,
    passwordPolicyError,
} from '../utils/passwordPolicy';

// Shared field styling, drawn from the .field primitive so every input on this
// page stays identical without repeating a long class string per input. Only the
// error overrides differ between fields.
const FIELD_BASE = 'field';
const FIELD_OK = '';
const FIELD_ERR = 'border-red-500/50 focus:border-red-500';
const fieldClass = (hasError) => `${FIELD_BASE} ${hasError ? FIELD_ERR : FIELD_OK}`;

/*
 * EMAIL SHAPE — the same check Login.jsx and the Forgot gateway use.
 *
 * WHY IT HAD TO BE ADDED HERE.
 *
 * The old `validateStep1` checked that the email was PRESENT but never that it
 * was well-FORMED, so "not-an-email" passed and the customer was marched
 * through registration before anything objected.
 *
 * The `type="email"` input does not help: the whole form is `noValidate`, which
 * exists precisely to switch off the browser's own bubbles, and the browser's
 * "enter an email address" message is in the browser's language, not the app's.
 *
 * Checking the shape here is also what makes the two pages agree. Login rejects
 * "not-an-email" in the same keystroke, so Register accepting it made the same
 * input behave differently on two screens of the same flow.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * REGISTRATION IS ONE STEP AGAIN — BUT IT STILL COLLECTS A SIZING PROFILE.
 *
 * The "5 Core Body Profile" (chest / bust, waist, hips, shoulder width, sleeve
 * length in centimetres) is what was removed: forcing five numbers before an
 * account could exist meant one typo locked a shopper out, and five typed
 * decimals could never be kept in step with the size chart the store actually
 * sells from.
 *
 * What the form now asks for instead is the SAME three things Account Settings
 * holds (see VirtualTryOnSection.jsx): an upper body size, a lower body size
 * and a fit style. Asking here means the sizing profile is complete the moment
 * the account is created, instead of a shopper having to remember to go and
 * fill it in later before recommendations and AI try-on had anything to work
 * with. It is still one step, and still far shorter than five measurement boxes.
 */
/*
 * A SIZING PROFILE WITH NO PRE-PICKED ANSWER.
 *
 * These three fields used to default to M / M / Regular. That was wrong for two
 * reasons, and both were reported from the shop floor:
 *
 *  1. It INVENTED an answer. A customer who never thought about it still ended
 *     up with a confident M in the database, which then drove size suggestions
 *     and AI try-on as if it had been chosen. Better a blank that the customer
 *     fills in than a guess the store treats as fact.
 *  2. A pre-selected `<select>` cannot show a placeholder, so the two size
 *     boxes opened on "Medium (M)" / "Medium (M)" with no label explaining
 *     which was which. Two identical-looking dropdowns is exactly the confusion
 *     that made people pick the wrong one.
 *
 * So the empty state is the DEFAULT, every box says what it is, and the form
 * refuses to submit until all three are answered. The empty option is
 * `disabled`, so it cannot be re-selected once a real choice is made.
 */
const SIZE_LABELS = [
    { value: 'XS', text: 'Extra Small (XS)' },
    { value: 'S', text: 'Small (S)' },
    { value: 'M', text: 'Medium (M)' },
    { value: 'L', text: 'Large (L)' },
    { value: 'XL', text: 'Extra Large (XL)' },
    { value: '2XL', text: '2X Large (2XL)' },
];

/*
 * THE FIT LADDER MIRRORS THE "Fit Style" SELECT IN ACCOUNT SETTINGS, and the
 * server enforces the same three values (`in:slim,regular,oversized` in
 * AuthController::register). The form and the API therefore cannot disagree:
 * there is no fourth option here that the backend would reject.
 */
const FIT_OPTIONS = [
    { value: 'slim', text: 'Slim / Fitted' },
    { value: 'regular', text: 'Regular' },
    { value: 'oversized', text: 'Oversized / Loose' },
];

const Register = () => {
    const [formData, setFormData] = useState({
        full_name: '',
        email: '',
        password: '',
        password_confirmation: '',
        upper_body_size: '',
        lower_body_size: '',
        preferred_fit: '',
        agree_terms: false,
    });

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errors, setErrors] = useState({});
    const [isLoading, setIsLoading] = useState(false);

    const navigate = useNavigate();
    // Registration issues a token server-side; using the provider means the
    // session is persisted and the customer lands signed-in. Registering by
    // calling `api.post` directly (as this page used to) silently discarded
    // that token and forced a second login trip.
    const { register } = useAuth();

    /*
     * THE CHECKLIST IS THE SHARED POLICY, NOT A LOCAL LIST.
     *
     * These three requirements used to be re-typed here, and the SERVER never
     * checked them. They now come from utils/passwordPolicy.js, which the reset
     * page and App\Rules\PasswordStrength enforce identically, so the form can
     * no longer promise more (or less) than the API does.
     */
    const requirements = PASSWORD_REQUIREMENTS.map((requirement) => ({
        label: requirement.label,
        valid: requirement.test(formData.password),
    }));

    const isPasswordValid = meetsPasswordPolicy(formData.password);
    const passwordsMatch = formData.password_confirmation && formData.password === formData.password_confirmation;

    const updateField = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    };

    const validate = () => {
        const errs = {};
        if (!formData.full_name.trim()) errs.full_name = "Full Name is required";
        if (!formData.email.trim()) errs.email = "Email Address is required";
        else if (!EMAIL_REGEX.test(formData.email.trim())) errs.email = "Please enter a valid email address.";
        if (!formData.upper_body_size) errs.upper_body_size = "Please choose your upper body size.";
        else if (!SIZE_LABELS.some((s) => s.value === formData.upper_body_size)) {
            errs.upper_body_size = "Please choose a valid upper body size.";
        }
        if (!formData.lower_body_size) errs.lower_body_size = "Please choose your lower body size.";
        else if (!SIZE_LABELS.some((s) => s.value === formData.lower_body_size)) {
            errs.lower_body_size = "Please choose a valid lower body size.";
        }
        if (!formData.preferred_fit) errs.preferred_fit = "Please choose your fit style.";
        else if (!FIT_OPTIONS.some((f) => f.value === formData.preferred_fit)) {
            errs.preferred_fit = "Please choose a valid fit style.";
        }
        if (!formData.password) errs.password = "Password is required";
        else if (!isPasswordValid) errs.password = passwordPolicyError(formData.password);
        if (formData.password !== formData.password_confirmation) {
            errs.password_confirmation = "Passwords do not match";
        }
        if (!formData.agree_terms) errs.agree_terms = "You must accept the terms";

        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrors({});

        if (!validate()) return;

        setIsLoading(true);
        try {
            /**
             * Payload keys expected by Laravel's /api/register:
             *   full_name, email, password, password_confirmation,
             *   upper_body_size, lower_body_size, preferred_fit.
             *
             * The three sizing fields are sent for the same reason the backend
             * validates them: the account's sizing profile is written in the
             * same INSERT, so a customer who answers here lands on the shop
             * with a complete profile rather than an empty one.
             */
            const payload = {
                full_name: formData.full_name.trim(),
                email: formData.email.trim().toLowerCase(),
                password: formData.password,
                password_confirmation: formData.password_confirmation,
                upper_body_size: formData.upper_body_size,
                lower_body_size: formData.lower_body_size,
                preferred_fit: formData.preferred_fit,
            };

            const response = await register(payload);
            const status = response?.status;

            if (status === 200 || status === 201) {
                // Token already persisted by AuthContext — go straight to shop.
                navigate('/shop', {
                    state: { message: 'Welcome to Hiraya! Your account is ready.' },
                });
            }
        } catch (err) {
            const { message, errors: fieldErrors, status } = parseApiError(err);

            if (Object.keys(fieldErrors).length > 0) {
                // Bind each backend validation message under its own input.
                setErrors(fieldErrors);
            } else if (status === 429) {
                setErrors({ general: message });
            } else {
                setErrors({ general: message || 'Registration failed. Please try again.' });
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        /*
         * The sliding Sign In / Create Account card (see AuthShell). The shell
         * owns the page, the heading and the switch back to /login; the form
         * below is this page's own, unchanged in fields, validation and submit.
         *
         * On desktop the identity and password pairs sit side by side, which is
         * what keeps the longer form inside the same card height as Sign In —
         * so the card does not jump in size when the overlay slides across.
         */
        <AuthShell mode="signup" title="Create Account" kicker="Join Hiraya">
            <div>
                    {errors.general && (
                        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-600/40 bg-red-500/12 p-3 text-xs font-medium text-red-700">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span className="leading-relaxed">{errors.general}</span>
                        </div>
                    )}

                    <form
                        onSubmit={handleSubmit}
                        noValidate
                        className="space-y-3.5"
                    >
                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:items-start">
                        {/* FULL NAME */}
                        <div>
                            <input
                                type="text"
                                placeholder="Full Name"
                                autoComplete="name"
                                className={fieldClass(errors.full_name)}
                                value={formData.full_name}
                                onChange={(e) => updateField('full_name', e.target.value)}
                            />
                            {errors.full_name && <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">{errors.full_name}</p>}
                        </div>

                        {/* EMAIL */}
                        <div>
                            <input
                                type="email"
                                placeholder="Email Address"
                                autoComplete="email"
                                className={fieldClass(errors.email)}
                                value={formData.email}
                                onChange={(e) => updateField('email', e.target.value)}
                            />
                            {errors.email && <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">{errors.email}</p>}
                        </div>
                        </div>

                        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:items-start">
                        {/* PASSWORD */}
                        <div>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Password"
                                    autoComplete="new-password"
                                    className={`${fieldClass(errors.password)} pr-12`}
                                    value={formData.password}
                                    onChange={(e) => updateField('password', e.target.value)}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-ink-muted transition-colors hover:text-hiraya-accent cursor-pointer"
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {formData.password.length > 0 && (
                                <div className="mt-2 space-y-1 rounded-xl border border-hiraya-structure-line bg-hiraya-surface-raised p-2.5 shadow-neu-sm">
                                    {requirements.map((req, idx) => (
                                        <div key={idx} className="flex items-center gap-1.5">
                                            {req.valid
                                                ? <Check size={12} className="text-emerald-600 shrink-0" />
                                                : <X size={12} className="shrink-0 text-hiraya-ink-muted" />}
                                            <span className={`text-[10px] ${req.valid ? 'font-medium text-emerald-700' : 'text-hiraya-ink-muted'}`}>
                                                {req.label}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {errors.password && <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">{errors.password}</p>}
                        </div>

                        {/* CONFIRM PASSWORD */}
                        <div>
                            <div className="relative">
                                <input
                                    type={showConfirmPassword ? "text" : "password"}
                                    placeholder="Confirm Password"
                                    autoComplete="new-password"
                                    className={`${fieldClass(errors.password_confirmation)} pr-20`}
                                    value={formData.password_confirmation}
                                    onChange={(e) => updateField('password_confirmation', e.target.value)}
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                    {passwordsMatch && <CheckCircle2 size={16} className="text-emerald-600" />}
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                        className="text-hiraya-ink-muted transition-colors hover:text-hiraya-accent cursor-pointer"
                                    >
                                        {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            {errors.password_confirmation && (
                                <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">{errors.password_confirmation}</p>
                            )}
                        </div>
                        </div>

                        {/*
                         * SIZING PROFILE — upper size, lower size, fit style.
                         *
                         * These replace the old "5 Core Body Measurements" step
                         * (chest / waist / hips / shoulder / sleeve in
                         * centimetres). Same three fields Account Settings
                         * holds, so a customer is never asked to describe
                         * themselves twice in two different ways; the backend
                         * resolves centimetres from the size chart behind these
                         * labels, which is what makes recommendations and AI
                         * try-on agree with the catalogue.
                         *
                         * EVERY BOX IS LABELLED AND STARTS EMPTY. Two size
                         * dropdowns opening on the same "Medium (M)" with
                         * nothing above them to tell them apart is unreadable —
                         * which one is the shirt and which the trousers? The
                         * label sits above its own box, and the first option is
                         * the name of the choice ("Upper body (tops & shirts)")
                         * rather than a size, so the box is self-describing
                         * before it is touched.
                         */}
                        <div className="pt-2">
                            <p className="kicker mb-2.5 text-hiraya-ink-muted">Sizing Profile</p>
                            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                                <div>
                                    <label
                                        htmlFor="upper_body_size"
                                        className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-hiraya-ink-muted"
                                    >
                                        Upper Body Size
                                    </label>
                                    <select
                                        id="upper_body_size"
                                        name="upper_body_size"
                                        className={`${fieldClass(errors.upper_body_size)} cursor-pointer px-3 text-[13px]`}
                                        value={formData.upper_body_size}
                                        onChange={(e) => updateField('upper_body_size', e.target.value)}
                                    >
                                        <option value="" disabled>
                                            Tops
                                        </option>
                                        {SIZE_LABELS.map((size) => (
                                            <option key={size.value} value={size.value}>
                                                {size.text}
                                            </option>
                                        ))}
                                    </select>
                                    {errors.upper_body_size && (
                                        <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">
                                            {errors.upper_body_size}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label
                                        htmlFor="lower_body_size"
                                        className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-hiraya-ink-muted"
                                    >
                                        Lower Body Size
                                    </label>
                                    <select
                                        id="lower_body_size"
                                        name="lower_body_size"
                                        className={`${fieldClass(errors.lower_body_size)} cursor-pointer px-3 text-[13px]`}
                                        value={formData.lower_body_size}
                                        onChange={(e) => updateField('lower_body_size', e.target.value)}
                                    >
                                        <option value="" disabled>
                                            Bottoms
                                        </option>
                                        {SIZE_LABELS.map((size) => (
                                            <option key={size.value} value={size.value}>
                                                {size.text}
                                            </option>
                                        ))}
                                    </select>
                                    {errors.lower_body_size && (
                                        <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">
                                            {errors.lower_body_size}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label
                                        htmlFor="preferred_fit"
                                        className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-hiraya-ink-muted"
                                    >
                                        Fit Style
                                    </label>
                                    <select
                                        id="preferred_fit"
                                        name="preferred_fit"
                                        className={`${fieldClass(errors.preferred_fit)} cursor-pointer px-3 text-[13px]`}
                                        value={formData.preferred_fit}
                                        onChange={(e) => updateField('preferred_fit', e.target.value)}
                                    >
                                        <option value="" disabled>
                                            Fit style
                                        </option>
                                        {FIT_OPTIONS.map((fit) => (
                                            <option key={fit.value} value={fit.value}>
                                                {fit.text}
                                            </option>
                                        ))}
                                    </select>
                                    {errors.preferred_fit && (
                                        <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-700">
                                            {errors.preferred_fit}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <p className="mt-2.5 pl-1 text-[10px] leading-relaxed text-hiraya-ink-muted">
                                You can change these any time in{' '}
                                <span className="font-semibold text-hiraya-ink">Account Settings</span> — they
                                power size suggestions and AI try-on fits.
                            </p>
                        </div>

                        {/* TERMS */}
                        <div className="pt-1 px-1">
                            <label className="flex cursor-pointer items-start gap-2 text-hiraya-ink-muted">
                                <input
                                    type="checkbox"
                                    checked={formData.agree_terms}
                                    onChange={(e) => updateField('agree_terms', e.target.checked)}
                                    className="mt-0.5 cursor-pointer accent-hiraya-accent focus:ring-0"
                                />
                                <span className="select-none text-[11px] leading-tight">
                                    I agree to the <span className="text-hiraya-ink underline">Terms of Service</span> and <span className="text-hiraya-ink underline">Privacy Policy</span>.
                                </span>
                            </label>
                            {errors.agree_terms && <p className="mt-1 text-[10px] font-medium text-red-700">{errors.agree_terms}</p>}
                        </div>

                        {/*
                         * The gate on the terms checkbox is unchanged — the button
                         * is disabled until it is ticked. This now SUBMITS rather
                         * than advancing to a second step, so it is also disabled
                         * while the request is in flight (otherwise a double-click
                         * created two accounts).
                         */}
                        <button
                            type="submit"
                            disabled={!formData.agree_terms || isLoading}
                            className={`btn-primary group mt-2 w-full rounded-full py-3.5 ${
                                formData.agree_terms && !isLoading ? '' : 'cursor-not-allowed'
                            }`}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" /> Creating Account...
                                </>
                            ) : (
                                <>Create Account <ChevronRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" /></>
                            )}
                        </button>
                        {/* "Sign in" now lives in the shell's overlay (desktop)
                            and its Sign In / Create Account switch (mobile). */}
                    </form>
            </div>
        </AuthShell>
    );
};

export default Register;

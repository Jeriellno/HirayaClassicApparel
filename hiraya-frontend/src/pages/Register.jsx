import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Check, X, CheckCircle2, Ruler, ChevronRight, ChevronLeft, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseApiError } from '../api/axios';

// Shared Gold & Black input styling so every field on this page stays visually
// identical without repeating a 200-character class string per input.
const FIELD_BASE =
    'w-full rounded-xl border bg-hiraya-cream/50 px-5 py-3.5 text-sm text-hiraya-ink placeholder-hiraya-sand outline-none transition-all focus:ring-1';
const FIELD_OK = 'border-hiraya-sand/30 focus:border-[#CB997E]/60 focus:ring-[#CB997E]/25';
const FIELD_ERR = 'border-red-500/50 focus:border-red-500 focus:ring-red-500/30';
const fieldClass = (hasError) => `${FIELD_BASE} ${hasError ? FIELD_ERR : FIELD_OK}`;

// 5 Core Standardized Body Measurements
// (identical for Men and Women across all Hiraya surfaces)
const CORE_MEASUREMENT_FIELDS = [
    { key: 'chest_bust',     label: 'Chest / Bust',    placeholder: '90'  },
    { key: 'waist',          label: 'Waist',           placeholder: '75'  },
    { key: 'hips',           label: 'Hips',            placeholder: '95'  },
    { key: 'shoulder_width', label: 'Shoulder Width',  placeholder: '42'  },
    { key: 'sleeve_length',  label: 'Sleeve Length',   placeholder: '62'  },
];

const Register = () => {
    const [step, setStep] = useState(1);
    const [formData, setFormData] = useState({
        // Step 1 — account
        full_name: '',
        email: '',
        password: '',
        password_confirmation: '',
        agree_terms: false,

        // Step 2 — 5 Core Body Measurements
        chest_bust: '',
        waist: '',
        hips: '',
        shoulder_width: '',
        sleeve_length: '',
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

    const requirements = [
        { label:"At least 8 characters", valid: formData.password.length >= 8 },
        { label:"At least 1 uppercase letter", valid: /[A-Z]/.test(formData.password) },
        { label:"At least 1 number or symbol", valid: /[0-9!@#$%^&*]/.test(formData.password) },
    ];

    const isPasswordValid = requirements.every(req => req.valid);
    const passwordsMatch = formData.password_confirmation && formData.password === formData.password_confirmation;

    const updateField = (field, value) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    };

    const validateStep1 = () => {
        let errs = {};
        if (!formData.full_name.trim()) errs.full_name ="Full Name is required";
        if (!formData.email.trim()) errs.email ="Email Address is required";
        if (!formData.password) errs.password ="Password is required";
        else if (!isPasswordValid) errs.password ="Password does not meet requirements";
        if (formData.password !== formData.password_confirmation) {
            errs.password_confirmation ="Passwords do not match";
        }
        if (!formData.agree_terms) errs.agree_terms ="You must accept the terms";

        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    // All 5 Core fields are optional during registration; if any value is
    // provided, it must fall within a sensible body-measurement range.
    const validateStep2 = () => {
        let errs = {};
        const ranges = {
            chest_bust:     { min: 40, max: 200, label: 'Chest / Bust' },
            waist:          { min: 40, max: 200, label: 'Waist' },
            hips:           { min: 40, max: 200, label: 'Hips' },
            shoulder_width: { min: 20, max: 100, label: 'Shoulder Width' },
            sleeve_length:  { min: 30, max: 100, label: 'Sleeve Length' },
        };

        Object.entries(ranges).forEach(([key, { min, max, label }]) => {
            const v = formData[key];
            if (v !== '' && v !== null && v !== undefined) {
                const n = Number(v);
                if (Number.isNaN(n) || n < min || n > max) {
                    errs[key] = `${label} must be between ${min} and ${max}`;
                }
            }
        });

        setErrors(prev => ({ ...prev, ...errs }));
        return Object.keys(errs).length === 0;
    };

    const handleNext = () => {
        if (validateStep1()) setStep(2);
    };

    const handleBack = () => {
        setErrors({});
        setStep(1);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrors({});

        if (!validateStep1()) {
            setStep(1);
            return;
        }
        if (!validateStep2()) return;

        setIsLoading(true);
        try {
            /**
             * Exact payload keys expected by Laravel's /api/register:
             *   full_name, email, password, password_confirmation + optional
             *   5 Core body measurements.
             * Empty measurement strings are dropped so the backend stores NULL
             * instead of failing numeric validation on an empty string.
             */
            const payload = {
                full_name: formData.full_name.trim(),
                email: formData.email.trim().toLowerCase(),
                password: formData.password,
                password_confirmation: formData.password_confirmation,
            };

            CORE_MEASUREMENT_FIELDS.forEach(({ key }) => {
                const value = formData[key];
                if (value !== '' && value !== null && value !== undefined) {
                    payload[key] = Number(value);
                }
            });

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

                // A field error on step-1 fields means the customer must be sent
                // back to step 1 to actually see it.
                const step1Fields = ['full_name', 'email', 'password', 'password_confirmation'];
                if (step1Fields.some((field) => field in fieldErrors)) {
                    setStep(1);
                }
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
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-black p-4 font-sans">
            {/* Ambient gold glow */}
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-1/3 left-1/2 h-[70vh] w-[70vh] -translate-x-1/2 rounded-full bg-hiraya-cream/\[0.05\] blur-[120px]" />
                <div className="absolute bottom-0 right-0 h-[40vh] w-[40vh] rounded-full bg-hiraya-cream/\[0.03\] blur-[100px]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(245,235,224,0.08),transparent_60%)]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="relative z-10 w-full max-w-[460px]"
            >
                <div className="overflow-hidden rounded-[2rem] border-hiraya-sand/30 bg-hiraya-cream-deep/80 p-8 shadow-2xl backdrop-blur-xl">
                    <div className="mb-6 text-center">
                        <h1 className="font-serif text-3xl font-light uppercase leading-none tracking-[0.2em] text-hiraya-ink">
                            {step === 1 ? 'Register' : 'Body Profile'}
                        </h1>
                        <p className="mt-2 text-[10px] uppercase tracking-[0.25em] text-hiraya-sand">
                            {step === 1
                                ? 'Create your account'
                                : '5 Core measurements for AI virtual fitting'}
                        </p>

                        <div className="mt-5 flex items-center justify-center gap-2">
                            <div className={`h-1 w-8 rounded-full transition-colors ${step >= 1 ? 'bg-[#CB997E]' : 'bg-hiraya-sand/70'}`} />
                            <div className={`h-1 w-8 rounded-full transition-colors ${step >= 2 ? 'bg-[#CB997E]' : 'bg-hiraya-sand/70'}`} />
                        </div>
                    </div>

                    {errors.general && (
                        <div className="mb-4 flex items-start gap-2 rounded-xl border-red-500/30 bg-red-500/10 p-3 text-center text-xs font-medium text-red-400">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            <span className="leading-relaxed">{errors.general}</span>
                        </div>
                    )}

                    <AnimatePresence mode="wait">
                        {step === 1 && (
                            <motion.form
                                key="step-1"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                transition={{ duration: 0.2 }}
                                onSubmit={(e) => { e.preventDefault(); handleNext(); }}
                                noValidate
                                className="space-y-3.5"
                            >
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
                                    {errors.full_name && <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-400">{errors.full_name}</p>}
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
                                    {errors.email && <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-400">{errors.email}</p>}
                                </div>

                                {/* PASSWORD */}
                                <div>
                                    <div className="relative">
                                        <input
                                            type={showPassword ?"text" :"password"}
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
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-hiraya-sand transition-colors hover:text-hiraya-ink"
                                        >
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    {formData.password.length > 0 && (
                                        <div className="mt-2 space-y-1 rounded-xl border-hiraya-sand/30 bg-hiraya-sand/60 p-2.5">
                                            {requirements.map((req, idx) => (
                                                <div key={idx} className="flex items-center gap-1.5">
                                                    {req.valid
                                                        ? <Check size={12} className="text-emerald-500 shrink-0" />
                                                        : <X size={12} className="shrink-0 text-hiraya-sand" />}
                                                    <span className={`text-[10px] ${req.valid ? 'font-medium text-emerald-500' : 'text-hiraya-sand'}`}>
                                                        {req.label}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {errors.password && <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-400">{errors.password}</p>}
                                </div>

                                {/* CONFIRM PASSWORD */}
                                <div>
                                    <div className="relative">
                                        <input
                                            type={showConfirmPassword ?"text" :"password"}
                                            placeholder="Confirm Password"
                                            autoComplete="new-password"
                                            className={`${fieldClass(errors.password_confirmation)} pr-20`}
                                            value={formData.password_confirmation}
                                            onChange={(e) => updateField('password_confirmation', e.target.value)}
                                        />
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                            {passwordsMatch && <CheckCircle2 size={16} className="text-emerald-500" />}
                                            <button
                                                type="button"
                                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                                                className="text-hiraya-sand transition-colors hover:text-hiraya-ink"
                                            >
                                                {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                    </div>
                                    {errors.password_confirmation && (
                                        <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-400">{errors.password_confirmation}</p>
                                    )}
                                </div>

                                {/* TERMS */}
                                <div className="pt-1 px-1">
                                    <label className="flex cursor-pointer items-start gap-2 text-xs text-hiraya-sand">
                                        <input
                                            type="checkbox"
                                            checked={formData.agree_terms}
                                            onChange={(e) => updateField('agree_terms', e.target.checked)}
                                            className="mt-0.5 cursor-pointer rounded border-hiraya-sand/40 bg-black text-hiraya-ink accent-stone-200 focus:ring-0"
                                        />
                                        <span className="select-none text-[11px] leading-tight">
                                            I agree to the <span className="text-hiraya-ink underline">Terms of Service</span> and <span className="text-hiraya-ink underline">Privacy Policy</span>.
                                        </span>
                                    </label>
                                    {errors.agree_terms && <p className="mt-1 text-[10px] font-medium text-red-400">{errors.agree_terms}</p>}
                                </div>

                                <button
                                    type="submit"
                                    disabled={!formData.agree_terms}
                                    className={`mt-2 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-xs font-bold uppercase tracking-widest transition-all ${
                                        formData.agree_terms
                                            ? 'cursor-pointer bg-[#CB997E] text-hiraya-olive shadow-lg shadow-stone-200/10 hover:bg-hiraya-cream-deep active:scale-95'
                                            : 'cursor-not-allowed bg-hiraya-sand text-hiraya-sand'
                                    }`}
                                >
                                    Continue <ChevronRight size={14} />
                                </button>
                            </motion.form>
                        )}

                        {step === 2 && (
                            <motion.form
                                key="step-2"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                transition={{ duration: 0.2 }}
                                onSubmit={handleSubmit}
                                noValidate
                                className="space-y-3.5"
                            >
                                <div className="mb-2 flex items-center gap-2 text-hiraya-sand">
                                    <Ruler size={14} className="text-hiraya-ink" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest">
                                        All 5 fields are optional — you can skip and update later in Settings.
                                    </span>
                                </div>

                                <div className="space-y-3">
                                    {CORE_MEASUREMENT_FIELDS.map(({ key, label, placeholder }) => (
                                        <div key={key}>
                                            <label className="ml-1 text-[9px] font-bold uppercase tracking-widest text-hiraya-sand">
                                                {label} (cm)
                                            </label>
                                            <input
                                                type="number"
                                                step="0.1"
                                                name={key}
                                                placeholder={placeholder}
                                                className={fieldClass(errors[key])}
                                                value={formData[key]}
                                                onChange={(e) => updateField(key, e.target.value)}
                                            />
                                            {errors[key] && (
                                                <p className="mt-1.5 pl-2 text-[10px] font-medium text-red-400">{errors[key]}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-2 gap-2 pt-2">
                                    <button
                                        type="button"
                                        onClick={handleBack}
                                        className="flex items-center justify-center gap-2 rounded-full border-hiraya-sand/30 bg-hiraya-sand/60 py-3.5 text-xs font-bold uppercase tracking-widest text-hiraya-ink transition-all hover:border-hiraya-gold/50 hover:text-hiraya-ink active:scale-95"
                                    >
                                        <ChevronLeft size={14} /> Back
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="flex items-center justify-center gap-2 rounded-full bg-[#CB997E] py-3.5 text-xs font-bold uppercase tracking-widest text-hiraya-olive shadow-lg shadow-stone-200/10 transition-all hover:bg-hiraya-cream-deep active:scale-95 disabled:cursor-not-allowed disabled:bg-hiraya-sand disabled:text-hiraya-sand disabled:shadow-none"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" /> Creating Account...
                                            </>
                                        ) : (
                                            'Finish'
                                        )}
                                    </button>
                                </div>
                            </motion.form>
                        )}
                    </AnimatePresence>

                    <div className="mt-6 text-center">
                        <p className="text-[11px] text-hiraya-sand">
                            Already have an account?{' '}
                            <Link to="/login" className="ml-1 border-b border-hiraya-olive/20 font-bold text-hiraya-ink transition-colors hover:text-hiraya-ink">Sign In</Link>
                        </p>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default Register;

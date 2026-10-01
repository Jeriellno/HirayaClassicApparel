import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Link, useNavigate } from 'react-router-dom';
import {
    animate,
    motion,
    useMotionTemplate,
    useMotionValue,
    useReducedMotion,
    useTransform,
} from 'framer-motion';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import logoImg from '../../assets/logo.png';

/*
 * ============================================================================
 * AUTH SHELL — the split neumorphic card (after the login reference video)
 * ============================================================================
 *
 * PRESENTATION ONLY. Login.jsx and Register.jsx keep all of their own state,
 * validation, API calls and MFA steps and pass their form in as `children`.
 * /login and /register stay two routes; switching is still a navigation.
 *
 * STRUCTURE
 * ---------
 * One wide rectangle split down the middle: a FORM half and a raised
 * WELCOME panel that invites you to the other state. Everything is the same
 * cream stock, shaped by neumorphic light alone; the only dark element is the
 * form's primary button. Sign In puts the panel on the right, Create Account
 * on the left. Below `lg` the rectangle stands upright and the panel becomes
 * a band across the top.
 *
 * THE ANIMATION — "stretch, then contract"
 * ----------------------------------------
 * The panel never slides as one block. Its LEADING edge sweeps across first,
 * stretching the panel over the whole card while the two greetings cross
 * over each other; then its TRAILING edge follows and the panel contracts
 * onto the other half, uncovering the new form.
 *
 * The route change happens in the middle, at FULL COVER: the page being left
 * plays the stretch (t 0 -> 0.5) and navigates; the page being entered starts
 * fully covered and plays the contraction (t 0.5 -> 1) on a spring, so the
 * swap of forms underneath is never visible. The hand-off between the two
 * pages is one module-level note (`pendingSwitch`); a direct visit or the
 * back button simply shows the card at rest.
 */

// The in-flight switch: written by the page being left, read (and cleared)
// by the page being entered.
let pendingSwitch = null;

const COVER = { duration: 0.42, ease: [0.65, 0, 0.35, 1] };
const REVEAL = { type: 'spring', stiffness: 120, damping: 18, mass: 1 };

const MODES = {
    signin: { path: '/login' },
    signup: { path: '/register' },
};
const OTHER = { signin: 'signup', signup: 'signin' };

// Direction of travel: 0 = panel moving right -> left (to Create Account),
// 1 = left -> right (to Sign In).
const DEPART = { signin: 0, signup: 1 };
const ARRIVE = { signin: 1, signup: 0 };

// Panel copy, keyed by the state it INVITES you to.
const INVITES = {
    signup: {
        title: 'New to Hiraya?',
        body: 'Create an account to build your wardrobe and try every look on your own portrait.',
        cta: 'Create Account',
    },
    signin: {
        title: 'Welcome Back',
        body: 'Sign in to pick up your fittings, bag and orders right where you left them.',
        cta: 'Sign In',
    },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Stretch progress (leading edge) and contract progress (trailing edge). The
// contract term is left unclamped above 1 so the spring's overshoot reads as
// the panel settling a hair past its mark.
const lead = (t) => clamp01(t / 0.5);
const trail = (t) => Math.max(0, (t - 0.5) / 0.5);

// Panel edges, in % of the card width.
const leftEdge = ([t, d]) => (d === 0 ? 50 * (1 - lead(t)) : 50 * trail(t));
const rightEdge = ([t, d]) => (d === 0 ? 100 - 50 * trail(t) : 50 + 50 * lead(t));

// The greetings cross over each other at full stretch.
const fadeOut = (t) => 1 - clamp01((t - 0.12) / 0.42);
const fadeIn = (t) => clamp01((t - 0.4) / 0.38);

const isPlainLeftClick = (e) =>
    !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

// Neumorphic rings inside the panel — one pressed in, one raised.
const Rings = ({ rotate }) => (
    <>
        <motion.span
            aria-hidden="true"
            style={{ rotate }}
            className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full shadow-[inset_10px_10px_22px_rgba(21,32,54,0.09),inset_-10px_-10px_22px_rgba(255,255,255,0.9)]"
        />
        <motion.span
            aria-hidden="true"
            style={{ rotate }}
            className="pointer-events-none absolute -bottom-36 -left-24 h-80 w-80 rounded-full shadow-[10px_10px_24px_rgba(21,32,54,0.10),-10px_-10px_24px_rgba(255,255,255,0.9)]"
        />
    </>
);

Rings.propTypes = { rotate: PropTypes.object.isRequired };

const AuthShell = ({ mode, title, kicker, icon = null, allowSwitch = true, children }) => {
    const navigate = useNavigate();
    const reduce = useReducedMotion();
    const other = OTHER[mode];

    // Did we arrive here from the other state a moment ago?
    const [arrived] = useState(
        () => Boolean(pendingSwitch) && pendingSwitch.to === mode && Date.now() - pendingSwitch.at < 2000
    );
    const [leaving, setLeaving] = useState(false);
    const coverAnim = useRef(null);
    const fallback = useRef(null);

    // t: 0 -> 0.5 stretch (page being left), 0.5 -> 1 contract (page entered).
    const entering = arrived && !reduce;
    const t = useMotionValue(entering ? 0.5 : 0);
    const d = useMotionValue(entering ? ARRIVE[mode] : DEPART[mode]);

    // Desktop: the panel's two edges.
    const panelLeft = useTransform([t, d], (v) => `${leftEdge(v)}%`);
    const panelRight = useTransform([t, d], (v) => `${100 - rightEdge(v)}%`);
    // Mobile: the band grows down over the form, then pulls back up.
    const uncover = useTransform(t, (v) => (v <= 0.5 ? 1 - lead(v) : trail(v)));
    const bandClip = useMotionTemplate`inset(0 0 calc((100% - 13rem) * ${uncover}) 0 round 22px)`;
    // Copy + rings.
    const toSignupOpacity = useTransform([t, d], ([tv, dv]) => (dv === 0 ? fadeOut(tv) : fadeIn(tv)));
    const toSigninOpacity = useTransform([t, d], ([tv, dv]) => (dv === 0 ? fadeIn(tv) : fadeOut(tv)));
    const ringRotate = useTransform(t, [0, 1], [0, 140]);

    useEffect(() => {
        pendingSwitch = null;
        if (!entering) return undefined;
        const controls = animate(t, 1, REVEAL);
        return () => controls.stop();
    }, [entering, t]);

    useEffect(
        () => () => {
            coverAnim.current?.stop();
            window.clearTimeout(fallback.current);
        },
        []
    );

    // The toggle. Modified clicks (new tab, etc.) keep the Link's normal
    // behaviour; a plain click stretches the panel, then navigates.
    const switchState = (e) => {
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        if (leaving) return;
        setLeaving(true);

        let done = false;
        const go = () => {
            if (done) return;
            done = true;
            pendingSwitch = { to: other, at: Date.now() };
            navigate(MODES[other].path);
        };
        if (reduce) {
            go();
            return;
        }
        // Rest geometry is identical at (arrive, 1) and (depart, 0), so this
        // re-basing is invisible.
        d.set(DEPART[mode]);
        t.set(0);
        coverAnim.current = animate(t, 0.5, { ...COVER, onComplete: go });
        // If the tab is hidden mid-stretch, frames stop; navigate anyway.
        fallback.current = window.setTimeout(go, 900);
    };

    const invites = (
        <div className="relative grid w-full max-w-[19rem]">
            <InviteCopy
                invite={INVITES.signup}
                to={MODES.signup.path}
                active={mode === 'signin'}
                opacity={reduce ? (mode === 'signin' ? 1 : 0) : toSignupOpacity}
                onSwitch={switchState}
            />
            <InviteCopy
                invite={INVITES.signin}
                to={MODES.signin.path}
                active={mode === 'signup'}
                opacity={reduce ? (mode === 'signup' ? 1 : 0) : toSigninOpacity}
                onSwitch={switchState}
            />
        </div>
    );

    const secureNote = (
        <div className="relative max-w-[19rem] text-center">
            <p className="font-serif text-[1.6rem] font-semibold tracking-[0.03em] text-navy-900">One More Step</p>
            <p className="mt-3 flex items-start justify-center gap-2 text-[0.84rem] leading-relaxed text-charcoal-600">
                <ShieldCheck size={16} className="mt-0.5 shrink-0 text-navy-800" />
                Staff accounts confirm every sign-in with an authenticator code.
            </p>
        </div>
    );

    const panelFace = 'relative h-full w-full overflow-hidden bg-cream-100';

    return (
        <div className="relative flex min-h-screen items-center justify-center px-4 pb-10 pt-16 font-sans lg:py-14">
            {/* Flat paper ground, a whisper of grain. */}
            <div aria-hidden="true" className="vintage-grain pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-multiply" />

            {/* The navbar is hidden on auth routes, so the wordmark is the way home. */}
            <Link
                to="/"
                className="absolute left-5 top-5 z-20 flex items-center gap-2.5 rounded-full px-2 py-1 text-hiraya-ink transition-colors hover:bg-navy-900/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus sm:left-8 sm:top-4"
            >
                <img src={logoImg} alt="" className="h-8 w-8 object-contain" />
                <span className="font-serif text-lg font-semibold tracking-[0.08em]">HIRAYA</span>
            </Link>

            <motion.div
                initial={arrived || reduce ? false : { opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="relative z-10 w-full max-w-md overflow-hidden rounded-[22px] bg-cream-100 shadow-[var(--shadow-neu),inset_0_1px_0_rgba(255,255,255,0.8)] ring-1 ring-cream-50/80 lg:max-w-[1040px]"
            >
                {/* ---- FORM HALF ---- */}
                <div
                    className={`relative flex flex-col justify-center px-7 pb-10 pt-[calc(13rem+2.25rem)] sm:px-10 lg:min-h-[620px] lg:w-1/2 lg:px-12 lg:py-10 ${mode === 'signup' ? 'lg:ml-[50%]' : ''}`}
                >
                    {/* The crease under the mobile band. */}
                    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[13rem] h-5 bg-[linear-gradient(to_bottom,rgba(21,32,54,0.08),transparent)] lg:hidden" />

                    <div className="mb-7 text-center">
                        {icon && (
                            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-900 text-cream-100 shadow-neu-sm">
                                {icon}
                            </div>
                        )}
                        <h1 className="font-serif text-[clamp(1.7rem,2.6vw,2.2rem)] font-semibold leading-tight tracking-[0.03em] text-navy-900">
                            {title}
                        </h1>
                        <p className="mt-3 text-[0.62rem] font-semibold uppercase tracking-[0.26em] text-charcoal-500">
                            {kicker}
                        </p>
                    </div>

                    {children}
                </div>

                {/* ---- WELCOME PANEL, desktop: two edges on the move ---- */}
                <motion.aside
                    style={
                        reduce
                            ? { left: mode === 'signin' ? '50%' : '0%', right: mode === 'signin' ? '0%' : '50%' }
                            : { left: panelLeft, right: panelRight }
                    }
                    className="absolute inset-y-0 z-10 hidden lg:block"
                >
                    <div className={`${panelFace} flex items-center justify-center rounded-[22px] px-10 shadow-[-14px_0_28px_-16px_rgba(21,32,54,0.28),14px_0_28px_-16px_rgba(21,32,54,0.28),inset_1px_1px_0_rgba(255,255,255,0.85)]`}>
                        <Rings rotate={ringRotate} />
                        {allowSwitch ? invites : secureNote}
                    </div>
                </motion.aside>

                {/* ---- WELCOME PANEL, mobile: a band that grows and retracts ---- */}
                <motion.aside
                    style={{ clipPath: reduce ? 'inset(0 0 calc(100% - 13rem) 0 round 22px)' : bandClip }}
                    className="absolute inset-0 z-10 lg:hidden"
                >
                    <div className={`${panelFace} shadow-[inset_1px_1px_0_rgba(255,255,255,0.85)]`}>
                        <Rings rotate={ringRotate} />
                        <div className="absolute inset-x-0 top-0 flex h-[13rem] items-center justify-center px-8">
                            {allowSwitch ? invites : secureNote}
                        </div>
                    </div>
                </motion.aside>
            </motion.div>
        </div>
    );
};

AuthShell.propTypes = {
    mode: PropTypes.oneOf(['signin', 'signup']).isRequired,
    title: PropTypes.string.isRequired,
    kicker: PropTypes.string.isRequired,
    icon: PropTypes.node,
    allowSwitch: PropTypes.bool,
    children: PropTypes.node.isRequired,
};

/*
 * One greeting. Both are stacked in one grid cell and cross-faded by the
 * panel's travel; only the one for the CURRENT page is focusable/clickable.
 */
const InviteCopy = ({ invite, to, active, opacity, onSwitch }) => (
    <motion.div
        style={{ opacity }}
        aria-hidden={!active}
        className={`flex flex-col items-center text-center [grid-area:1/1] ${active ? '' : 'pointer-events-none'}`}
    >
        <p className="font-serif text-[1.6rem] font-semibold leading-tight tracking-[0.03em] text-navy-900 lg:text-[1.85rem]">
            {invite.title}
        </p>
        <p className="mt-3 text-[0.84rem] leading-relaxed text-charcoal-600">{invite.body}</p>
        <Link
            to={to}
            onClick={onSwitch}
            tabIndex={active ? 0 : -1}
            className="group mt-6 inline-flex items-center gap-2.5 rounded-full bg-cream-100 px-9 py-3 text-[0.64rem] font-semibold uppercase tracking-[0.24em] text-navy-900 shadow-neu-sm transition-all duration-300 hover:shadow-neu active:bg-cream-200 active:shadow-neu-inset focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hiraya-focus lg:mt-8"
        >
            {invite.cta}
            <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" />
        </Link>
    </motion.div>
);

InviteCopy.propTypes = {
    invite: PropTypes.shape({
        title: PropTypes.string.isRequired,
        body: PropTypes.string.isRequired,
        cta: PropTypes.string.isRequired,
    }).isRequired,
    to: PropTypes.string.isRequired,
    active: PropTypes.bool.isRequired,
    opacity: PropTypes.oneOfType([PropTypes.number, PropTypes.object]).isRequired,
    onSwitch: PropTypes.func.isRequired,
};

export default AuthShell;

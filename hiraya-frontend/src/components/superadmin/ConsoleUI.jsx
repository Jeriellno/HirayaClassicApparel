import PropTypes from 'prop-types';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, XCircle, Clock } from 'lucide-react';

/*
 * ============================================================================
 * CONSOLE UI — the shared neumorphic pieces of the admin dashboards
 * ============================================================================
 *
 * Presentation only. Every figure these render is computed by the tab that
 * uses them; nothing here fetches, derives or stores data.
 *
 *   ConsoleHeader  kicker + serif title + subline, with an actions slot
 *   Panel          a raised cream sheet (the outer neumorphic light)
 *   Well           a pressed-in area inside a panel (the inner light) —
 *                  charts and lists sit in wells
 *   StatTile       label · value · optional note / meter (the stat-tile
 *                  contract: sentence-case label, sans semibold value in ink,
 *                  never in a data or status colour)
 *   StatusChip     a session/order state as icon + label — status colours are
 *                  reserved for state and never carry meaning by colour alone
 */

const EASE = [0.22, 1, 0.36, 1];

export const ConsoleHeader = ({ kicker, title, subtitle, icon: Icon, children }) => (
    <div className="flex flex-col justify-between gap-5 border-b border-hiraya-structure-line pb-6 sm:flex-row sm:items-end">
        <div>
            <span className="kicker text-hiraya-ink-muted">
                {Icon && <Icon size={13} />} {kicker}
            </span>
            <h2 className="mt-3 font-serif text-[clamp(1.4rem,2.2vw,1.9rem)] uppercase leading-tight tracking-[0.05em] text-navy-900">
                {title}
            </h2>
            {subtitle && <p className="mt-2 max-w-2xl text-[0.82rem] leading-relaxed text-charcoal-600">{subtitle}</p>}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>}
    </div>
);

ConsoleHeader.propTypes = {
    kicker: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    subtitle: PropTypes.string,
    icon: PropTypes.elementType,
    children: PropTypes.node,
};

export const Panel = ({ title, icon: Icon, action, className = '', children }) => (
    <section className={`rounded-[24px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80 sm:p-6 ${className}`}>
        {(title || action) && (
            <div className="mb-5 flex items-center justify-between gap-3">
                {title && (
                    <h3 className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
                        {Icon && (
                            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm">
                                <Icon size={15} />
                            </span>
                        )}
                        {title}
                    </h3>
                )}
                {action}
            </div>
        )}
        {children}
    </section>
);

Panel.propTypes = {
    title: PropTypes.node,
    icon: PropTypes.elementType,
    action: PropTypes.node,
    className: PropTypes.string,
    children: PropTypes.node,
};

export const Well = ({ className = '', children }) => (
    <div className={`rounded-2xl bg-cream-200/55 shadow-neu-inset ${className}`}>{children}</div>
);

Well.propTypes = { className: PropTypes.string, children: PropTypes.node };

export const StatTile = ({ label, value, icon: Icon, note, meter = null, index = 0 }) => {
    const reduce = useReducedMotion();
    const pct = typeof meter === 'number' ? Math.max(0, Math.min(100, meter)) : null;

    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE, delay: index * 0.06 }}
            className="group rounded-[22px] bg-hiraya-surface p-5 shadow-neu ring-1 ring-cream-50/80 transition-[translate,box-shadow] duration-500 hover:-translate-y-1 hover:shadow-[var(--shadow-neu),0_24px_40px_-26px_rgba(21,32,54,0.45)]"
        >
            <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold tracking-[0.04em] text-charcoal-600">{label}</span>
                {Icon && (
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-200/70 text-navy-800 shadow-neu-inset transition-colors duration-500 group-hover:bg-navy-900 group-hover:text-cream-100">
                        <Icon size={16} />
                    </span>
                )}
            </div>
            <p className="mt-3 font-sans text-[2rem] font-semibold leading-none tracking-[-0.01em] text-navy-900">{value}</p>
            {pct !== null && (
                <div
                    className="mt-4 h-2 overflow-hidden rounded-full bg-navy-100 shadow-neu-inset"
                    role="meter"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={label}
                >
                    <motion.div
                        className="h-full rounded-full bg-navy-800"
                        initial={reduce ? false : { width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.9, ease: EASE, delay: 0.2 + index * 0.06 }}
                    />
                </div>
            )}
            {note && <p className="mt-3 text-[11px] leading-relaxed text-charcoal-500">{note}</p>}
        </motion.div>
    );
};

StatTile.propTypes = {
    label: PropTypes.string.isRequired,
    value: PropTypes.node.isRequired,
    icon: PropTypes.elementType,
    note: PropTypes.node,
    meter: PropTypes.number,
    index: PropTypes.number,
};

const STATUS = {
    completed: { Icon: CheckCircle2, cls: 'border-emerald-600/30 bg-emerald-500/10 text-emerald-800' },
    failed: { Icon: XCircle, cls: 'border-red-600/35 bg-red-500/10 text-red-700' },
};

export const StatusChip = ({ status }) => {
    const label = status || 'queued';
    const { Icon, cls } = STATUS[label] || { Icon: Clock, cls: 'border-navy-300/70 bg-navy-100 text-navy-800' };
    return (
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}>
            <Icon size={12} aria-hidden="true" />
            {label}
        </span>
    );
};

StatusChip.propTypes = { status: PropTypes.string };

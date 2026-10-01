import { ArrowLeft } from 'lucide-react';

/*
 * THE PAGE HEADING.
 *
 * The title was `font-serif text-2xl font-bold` sitting under a `rounded-full`
 * arrow button on a peach pill — two devices the system does not use. The heading
 * is now the shared `.display-lg`, the sub-line is a ruled caption, and the back
 * control is the standard `.btn-icon` plate.
 */
export const SettingsHeader = ({ onBack }) => (
  <div className="flex items-center gap-5 border-b border-hiraya-structure-line pb-8">
    <button
      type="button"
      onClick={onBack}
      className="btn-icon h-11 w-11 shrink-0 cursor-pointer rounded-full"
      aria-label="Go back"
    >
      <ArrowLeft size={20} />
    </button>
    <div>
      <span className="kicker text-hiraya-ink-muted">Hiraya Account</span>
      <h1 className="display-section mt-2 text-navy-900">Account Settings</h1>
      <p className="mt-2 text-[0.85rem] text-charcoal-600">
        Manage your personal info and virtual try-on measurements.
      </p>
    </div>
  </div>
);
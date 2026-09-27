import { ArrowLeft } from 'lucide-react';

export const SettingsHeader = ({ onBack }) => (
  <div className="flex items-center gap-4 border-b border-hiraya-olive/15 pb-6">
    <button 
      type="button" 
      onClick={onBack} 
      className="flex items-center justify-center rounded-full bg-hiraya-cream/60 p-2.5 text-hiraya-ink transition hover:bg-hiraya-cream/60 hover:text-hiraya-ink" 
      aria-label="Go back"
    >
      <ArrowLeft size={20} />
    </button>
    <div>
      <h1 className="font-serif text-2xl font-bold tracking-wide md:text-3xl text-hiraya-ink">Account Settings</h1>
      <p className="mt-0.5 text-xs text-hiraya-ink">Manage your personal info and virtual try-on measurements.</p>
    </div>
  </div>
);
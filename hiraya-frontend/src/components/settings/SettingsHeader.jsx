import { ArrowLeft } from 'lucide-react';

export const SettingsHeader = ({ onBack }) => (
  <div className="flex items-center gap-4 border-b border-white/10 pb-6">
    <button 
      type="button" 
      onClick={onBack} 
      className="flex items-center justify-center rounded-full bg-white/5 p-2.5 text-gray-300 transition hover:bg-white/10 hover:text-white" 
      aria-label="Go back"
    >
      <ArrowLeft size={20} />
    </button>
    <div>
      <h1 className="font-serif text-2xl font-bold tracking-wide md:text-3xl text-[#E9C46A]">Account Settings</h1>
      <p className="mt-0.5 text-xs text-gray-400">Manage your personal info and virtual try-on measurements.</p>
    </div>
  </div>
);
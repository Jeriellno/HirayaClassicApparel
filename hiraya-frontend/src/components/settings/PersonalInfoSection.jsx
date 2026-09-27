import { User } from 'lucide-react';
import { Field } from './Field';

export const PersonalInfoSection = ({ formData, handleChange }) => (
  <section className="space-y-4 rounded-2xl border border-hiraya-olive/15 bg-[#121620] p-6 shadow-xl">
    <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-hiraya-ink">
      <User size={16} /> Personal Information
    </h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Full Name">
        <input 
          type="text" 
          name="fullName" 
          value={formData.fullName} 
          onChange={handleChange} 
          placeholder="Your full name" 
          className="w-full rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-4 py-2.5 text-xs text-hiraya-ink focus:border-[#CB997E] focus:outline-none transition" 
        />
      </Field>
      <Field label="Email Address">
        <input 
          type="email" 
          name="email" 
          value={formData.email} 
          disabled 
          className="w-full cursor-not-allowed rounded-xl border border-hiraya-olive/15 bg-hiraya-cream/60 px-4 py-2.5 text-xs text-hiraya-olive/70" 
        />
      </Field>
    </div>
  </section>
);
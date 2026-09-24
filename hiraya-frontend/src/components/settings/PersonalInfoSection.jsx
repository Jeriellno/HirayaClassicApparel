import { User } from 'lucide-react';
import { Field } from './Field';

export const PersonalInfoSection = ({ formData, handleChange }) => (
  <section className="space-y-4 rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl">
    <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E9C46A]">
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
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white focus:border-[#E9C46A] focus:outline-none transition" 
        />
      </Field>
      <Field label="Email Address">
        <input 
          type="email" 
          name="email" 
          value={formData.email} 
          disabled 
          className="w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white/50" 
        />
      </Field>
    </div>
  </section>
);
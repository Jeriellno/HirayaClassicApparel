import { ShieldCheck } from 'lucide-react';
import { Field } from './Field';

export const SecuritySection = ({ formData, handleChange }) => (
  <section className="space-y-4 rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl">
    <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#E9C46A]">
      <ShieldCheck size={16} /> Security & Password
    </h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Field label="Current Password">
        <input 
          type="password" 
          name="currentPassword" 
          value={formData.currentPassword} 
          onChange={handleChange} 
          placeholder="••••••••"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white focus:border-[#E9C46A] focus:outline-none transition" 
        />
      </Field>

      <Field label="New Password">
        <input 
          type="password" 
          name="newPassword" 
          value={formData.newPassword} 
          onChange={handleChange} 
          placeholder="••••••••"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white focus:border-[#E9C46A] focus:outline-none transition" 
        />
      </Field>

      <Field label="Confirm New Password">
        <input 
          type="password" 
          name="confirmPassword" 
          value={formData.confirmPassword} 
          onChange={handleChange} 
          placeholder="••••••••"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-white focus:border-[#E9C46A] focus:outline-none transition" 
        />
      </Field>
    </div>
  </section>
);
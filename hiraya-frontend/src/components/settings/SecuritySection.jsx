import { ShieldCheck } from 'lucide-react';
import { Field } from './Field';

export const SecuritySection = ({ formData, handleChange }) => (
  <section id="account-security" className="card-raised scroll-mt-32 space-y-5 rounded-[24px] p-6 sm:p-8" data-tour="account-security">
    <h2 className="flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm"><ShieldCheck size={16} /></span>
      Security &amp; Password
    </h2>
    {/*
     * `type="password"` inputs are the one place a monospace-feeling dot run is
     * genuinely helpful, so the placeholder stays. What changed is the surface:
     * all three now use the shared `.field`, which is what the other two sections
     * use — previously two of the three already did while the surrounding panel
     * was black.
     */}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Field label="Current Password">
        <input 
          type="password" 
          name="currentPassword" 
          value={formData.currentPassword} 
          onChange={handleChange} 
          placeholder="••••"
          className="field" 
        />
      </Field>

      <Field label="New Password">
        <input 
          type="password" 
          name="newPassword" 
          value={formData.newPassword} 
          onChange={handleChange} 
          placeholder="••••"
          className="field" 
        />
      </Field>

      <Field label="Confirm New Password">
        <input 
          type="password" 
          name="confirmPassword" 
          value={formData.confirmPassword} 
          onChange={handleChange} 
          placeholder="••••"
          className="field" 
        />
      </Field>
    </div>
  </section>
);
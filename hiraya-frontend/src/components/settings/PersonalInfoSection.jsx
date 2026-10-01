import { User } from 'lucide-react';
import { Field } from './Field';

/*
 * ALL FIVE SETTINGS SECTIONS SHARED THE SAME DEFECTS, so they were fixed as one
 * shape rather than five times over:
 *
 *   `rounded-2xl border-hiraya-olive/15 bg-[#121620] shadow-xl`
 *
 *   - `bg-[#121620]` is a near-black surface from the retired dark theme. On the
 *     light canvas these panels were five black slabs carrying navy ink
 *     (`text-hiraya-ink`), i.e. NAVY TEXT ON NEAR-BLACK — about 1.1:1. Every
 *     label, heading and input value in Account Settings was effectively
 *     invisible.
 *   - `border-hiraya-olive/15` is the INDIGO hairline, which on a black fill is
 *     invisible a second time.
 *   - `rounded-2xl` (16px) is not a radius this system uses on panels.
 *
 * The sections are now the shared `.card-raised` plate — vintage white, system
 * hairline, near-square — so their navy ink sits at ~12:1, and every input uses
 * the `.field` primitive instead of a per-file one-off colour set.
 *
 * This comment block is repeated in spirit across the settings sections; only the
 * heading and the fields differ per file.
 */
export const PersonalInfoSection = ({ formData, handleChange }) => (
  <section id="account-profile" className="card-raised scroll-mt-32 space-y-5 rounded-[24px] p-6 sm:p-8" data-tour="account-profile">
    <h2 className="flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm"><User size={16} /></span>
      Personal Information
    </h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Field label="Full Name">
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Your full name"
          className="field"
        />
      </Field>
      <Field label="Email Address">
        {/*
         * A READ-ONLY FIELD STILL HAS TO BE LEGIBLE.
         *
         * This input was `bg-hiraya-peach/70 ... text-hiraya-olive/70` — indigo
         * ink at 70% on a pale peach fill, ~4:1 and visibly washed out, which
         * reads as "broken" rather than as "you cannot edit this". It now uses
         * the system's dedicated disabled pair, which is faded but still 6.9:1.
         */}
        <input
          type="email"
          name="email"
          value={formData.email}
          disabled
          className="field cursor-not-allowed bg-hiraya-disabled-bg text-hiraya-disabled-ink" 
        />
      </Field>
    </div>
  </section>
);
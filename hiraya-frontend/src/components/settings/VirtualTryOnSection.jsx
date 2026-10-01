import { Sparkles } from 'lucide-react';
import { Field } from './Field';

/*
 * THE SIZE LADDER IS NOT HARDCODED AS THE SOURCE OF TRUTH.
 *
 * It is fetched once from `GET /api/size-chart` — the same table the backend
 * sizes from (App\Services\SizeChart). This list is the fallback that mirrors
 * that ladder; a size added server-side appears here without a second edit.
 */
export const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL', '2XL'];

const labelFor = (size) =>
  ({
    XS: 'Extra Small (XS)',
    S: 'Small (S)',
    M: 'Medium (M)',
    L: 'Large (L)',
    XL: 'Extra Large (XL)',
    '2XL': '2X Large (2XL)',
  }[size] ?? size);

/**
 * THE SIZING PROFILE — two size labels.
 *
 * This section used to be the "5 Core Body Measurements" form (chest / bust,
 * waist, hips, shoulder width and sleeve length in centimetres) sitting
 * alongside a "Top Size" select and a "Waist Size (Inches)" box — three
 * overlapping representations of one fact, which is exactly why they could
 * disagree with each other.
 *
 * There is now ONE representation: an upper body size and a lower body size.
 * Every consumer — size suggestions, personalised recommendations, the AI
 * try-on render — resolves centimetres from the size chart behind these two
 * values, so they cannot drift apart.
 */
export const VirtualTryOnSection = ({ formData, handleChange, sizeLabels = SIZE_OPTIONS }) => {
  const options = sizeLabels?.length ? sizeLabels : SIZE_OPTIONS;

  return (
    <section id="account-measurements" className="card-raised scroll-mt-32 space-y-5 rounded-[24px] p-6 sm:p-8" data-tour="account-measurements">
      <h2 className="flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm"><Sparkles size={16} /></span>
        Sizing Profile
      </h2>
      <p className="text-[10px] text-hiraya-ink-muted">
        Your sizes, fit style and gender drive your size suggestions, your personalised Home
        recommendations, and how garments are fitted in AI Try-On.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Field label="Upper Body Size">
          <select
            name="upper_body_size"
            value={formData.upper_body_size || ''}
            onChange={handleChange}
            className="field cursor-pointer"
          >
            <option value="">Not set</option>
            {options.map((size) => (
              <option key={size} value={size}>
                {labelFor(size)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Lower Body Size">
          <select
            name="lower_body_size"
            value={formData.lower_body_size || ''}
            onChange={handleChange}
            className="field cursor-pointer"
          >
            <option value="">Not set</option>
            {options.map((size) => (
              <option key={size} value={size}>
                {labelFor(size)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fit Style">
          <select
            name="preferredFit"
            value={formData.preferredFit}
            onChange={handleChange}
            className="field cursor-pointer"
          >
            <option value="slim">Slim / Fitted</option>
            <option value="regular">Regular</option>
            <option value="oversized">Oversized / Loose</option>
          </select>
        </Field>

        <Field label="Gender">
          <select
            name="gender"
            value={formData.gender || ''}
            onChange={handleChange}
            className="field cursor-pointer"
          >
            <option value="" disabled>Choose…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </Field>
      </div>
    </section>
  );
};

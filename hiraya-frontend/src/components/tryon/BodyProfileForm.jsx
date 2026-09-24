import React from 'react';
import { Ruler, Loader2, Check } from 'lucide-react';

// 5 Core Standardized Body Measurements (identical for Men & Women)
const CORE_MEASUREMENT_FIELDS = [
    { key: 'chest_bust', label: 'Chest / Bust' },
    { key: 'waist', label: 'Waist' },
    { key: 'hips', label: 'Hips' },
    { key: 'shoulder_width', label: 'Shoulder Width' },
    { key: 'sleeve_length', label: 'Sleeve Length' },
];

export const BodyProfileForm = ({ measurements, onChange, onSave, isSaving, status }) => {
    return (
        <section className="shrink-0 rounded-3xl border-zinc-800 bg-zinc-950/80 p-5 shadow-xl backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2.5">
                <div className="flex items-center gap-2">
                    <Ruler size={16} className="text-stone-200" />
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white">
                        5 Core Body Profile
                    </h2>
                </div>
                {status && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-200">
                        {status}
                    </span>
                )}
            </div>

            <div className="grid grid-cols-3 gap-3">
                {CORE_MEASUREMENT_FIELDS.map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">
                            {label} (cm)
                        </label>
                        <input
                            type="number"
                            step="0.1"
                            name={key}
                            value={measurements[key] ?? ''}
                            onChange={onChange}
                            placeholder="0"
                            className="w-full rounded-xl border-stone-300/20 bg-black/60 px-3.5 py-2 text-xs font-bold text-white outline-none transition-colors focus:border-stone-300/60 focus:ring-1 focus:ring-stone-200/30"
                        />
                    </div>
                ))}
            </div>

            <button
                onClick={onSave}
                disabled={isSaving}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-stone-300/30 bg-[#E9C46A]/10 py-2.5 text-[9px] font-bold uppercase tracking-[0.2em] text-stone-200 transition-colors duration-200 hover:bg-[#E9C46A] hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Sync &amp; Save to Database
            </button>
        </section>
    );
};

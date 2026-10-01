import { useState } from 'react';
import { motion } from 'framer-motion';
import { Ruler, CheckCircle2 } from 'lucide-react';

const MeasurementModal = ({ onSave, initialData }) => {
    // SIGURADUHIN NA HINDI NULL ANG FORMDATA
    const [formData, setFormData] = useState(initialData || { height: '', waist: '', chest: '' });

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-hiraya-ink/60 px-4 backdrop-blur-md"
        >
            {/*
             * THE SHEET IS THE SHARED RAISED CARD.
             *
             * It was `bg-white/90 ... rounded-[40px] border-hiraya-olive/150`:
             * a 40px radius and a 150%-opacity indigo border (an opacity value
             * above 1 is clamped to solid, so that rule was a full-strength dark
             * line around a white box). The heading was `text-[#2D2D2D]` and the
             * submit plate `bg-[#2D2D2D]` — a near-black that is in no version of
             * the palette — and the icon tile used it too.
             */}
            <motion.div
                initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
                className="card-raised w-full max-w-sm p-8"
            >
                <div className="mb-8 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-sm border border-hiraya-accent-deep/45 bg-hiraya-accent text-hiraya-on-accent">
                        <Ruler size={32} />
                    </div>
                    <h2 className="display-md text-hiraya-ink">Body Profile</h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {['height', 'waist', 'chest'].map((field) => (
                        <div key={field}>
                            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">
                                {field} (cm)
                            </label>
                            <input
                                required
                                type="number"
                                className="field"
                                placeholder={`Enter ${field}`}
                                // SAFE ACCESS: formData?.[field] para iwas crash
                                value={formData ? formData[field] : ''}
                                onChange={(e) => setFormData({...formData, [field]: e.target.value})}
                            />
                        </div>
                    ))}

                    <button type="submit" className="btn-primary w-full cursor-pointer py-4">
                        Save Profile
                    </button>
                </form>
            </motion.div>
        </motion.div>
    );
};

export default MeasurementModal;
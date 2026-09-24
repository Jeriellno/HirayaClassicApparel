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
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-md px-4"
        >
            <motion.div 
                initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }}
                className="bg-white/90 backdrop-blur-2xl p-8 rounded-[40px] shadow-2xl border border-white/50 max-w-sm w-full"
            >
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-[#2D2D2D] rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <Ruler className="text-[#E9C46A]" size={32} />
                    </div>
                    <h2 className="text-2xl font-bold text-[#2D2D2D]">Body Profile</h2>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    {['height', 'waist', 'chest'].map((field) => (
                        <div key={field}>
                            <label className="text-[10px] uppercase font-bold text-gray-400 mb-2 block">
                                {field} (cm)
                            </label>
                            <input 
                                required
                                type="number"
                                className="w-full h-14 bg-gray-50/50 border border-gray-100 rounded-2xl px-6 outline-none text-[#2D2D2D]"
                                placeholder={`Enter ${field}`}
                                // SAFE ACCESS: formData?.[field] para iwas crash
                                value={formData ? formData[field] : ''} 
                                onChange={(e) => setFormData({...formData, [field]: e.target.value})}
                            />
                        </div>
                    ))}
                    
                    <button type="submit" className="w-full h-16 bg-[#2D2D2D] text-white rounded-2xl font-bold uppercase tracking-widest text-[10px]">
                        Save Profile
                    </button>
                </form>
            </motion.div>
        </motion.div>
    );
};

export default MeasurementModal;
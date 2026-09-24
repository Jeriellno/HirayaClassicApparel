import { Check, Save, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

import { SettingsHeader } from '../components/settings/SettingsHeader';
import { PersonalInfoSection } from '../components/settings/PersonalInfoSection';
import { VirtualTryOnSection } from '../components/settings/VirtualTryOnSection';
import { SecuritySection } from '../components/settings/SecuritySection';

// 5 Core Standardized Body Measurements (identical for Men & Women)
const CORE_MEASUREMENT_FIELDS = [
    'chest_bust',
    'waist',
    'hips',
    'shoulder_width',
    'sleeve_length',
];

const AccountSettings = () => {
  const navigate = useNavigate();
  const { user, updateUser, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',

    // 5 Core Body Measurements
    chest_bust: '',
    waist: '',
    hips: '',
    shoulder_width: '',
    sleeve_length: '',

    topSize: 'M',
    bottomSize: '30',
    preferredFit: 'regular',

    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        fullName:      user.full_name || user.name || '',
        email:         user.email || '',
        // 5 Core Measurements — hydrate from authenticated user profile
        chest_bust:     user.chest_bust     ?? '',
        waist:          user.waist          ?? '',
        hips:           user.hips           ?? '',
        shoulder_width: user.shoulder_width ?? '',
        sleeve_length:  user.sleeve_length  ?? '',
        topSize:        user.top_size || 'M',
        bottomSize:     user.bottom_size || '30',
        preferredFit:   user.preferred_fit || 'regular',
      }));
    }
  }, [user]);

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage('');

    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      setErrorMessage('New passwords do not match!');
      setLoading(false);
      return;
    }

    try {
      // 1. Update general profile (name + sizing preferences)
      const profilePayload = {
        full_name:     formData.fullName,
        top_size:      formData.topSize,
        bottom_size:   formData.bottomSize,
        preferred_fit: formData.preferredFit,
      };
      if (formData.currentPassword && formData.newPassword) {
        profilePayload.current_password = formData.currentPassword;
        profilePayload.new_password     = formData.newPassword;
      }
      const profileRes = await api.put('/user/profile', profilePayload);

      // 2. Overwrite the 5 Core Body Measurements
      //    PUT semantics = full replace, so omitted fields are nulled
      //    out by the backend. We explicitly send only the 5 Core fields.
      const measurementsPayload = {};
      CORE_MEASUREMENT_FIELDS.forEach((key) => {
        const raw = formData[key];
        measurementsPayload[key] =
          raw === '' || raw === null || raw === undefined ? null : Number(raw);
      });
      const measurementsRes = await api.put('/user/measurements', measurementsPayload);

      // 3. Sync AuthContext with the freshly returned user
      const freshUser = measurementsRes.data?.user || profileRes.data?.user;
      if (freshUser) {
        updateUser(freshUser);
      } else {
        updateUser({
          ...profilePayload,
          ...measurementsPayload,
        });
      }
      // Belt-and-suspenders: force-refresh from /user so all 5 Core
      // columns (including ones the backend may have normalized) are
      // present in the global auth state.
      if (typeof refreshUser === 'function') {
        try { await refreshUser(); } catch (e) { /* non-fatal */ }
      }

      setFormData((prev) => ({
        ...prev,
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      console.error('Error saving settings:', error);
      const apiErrors = error.response?.data?.errors;
      if (apiErrors) {
        const first = Object.values(apiErrors)[0];
        setErrorMessage(Array.isArray(first) ? first[0] : first);
      } else {
        setErrorMessage(error.response?.data?.message || 'Failed to update settings. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0B0D12] px-6 pb-16 pt-28 text-white md:px-16">
      <div className="mx-auto max-w-3xl space-y-8">

        <SettingsHeader onBack={() => navigate(-1)} />

        {errorMessage && (
          <div className="rounded-xl bg-red-500/15 border border-red-500/20 p-4 text-xs text-red-400">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <PersonalInfoSection formData={formData} handleChange={handleChange} />
          <VirtualTryOnSection formData={formData} handleChange={handleChange} />
          <SecuritySection formData={formData} handleChange={handleChange} />

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-[#E9C46A] px-8 py-3 text-xs font-extrabold uppercase tracking-widest text-black transition hover:bg-[#D4A94F] disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
              {loading ? 'Saving...' : saved ? 'Saved Changes!' : 'Save Settings'}
            </button>
            {saved && <span className="text-xs font-bold text-green-400">Profile & measurements updated successfully!</span>}
          </div>
        </form>

      </div>
    </main>
  );
};

export default AccountSettings;

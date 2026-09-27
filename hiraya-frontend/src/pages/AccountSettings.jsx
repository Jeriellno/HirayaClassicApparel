import { Check, Save, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { clearStoredSession } from '../api/axios';

import { SettingsHeader } from '../components/settings/SettingsHeader';
import { PersonalInfoSection } from '../components/settings/PersonalInfoSection';
import { VirtualTryOnSection } from '../components/settings/VirtualTryOnSection';
import { SecuritySection } from '../components/settings/SecuritySection';
import { DangerZoneSection } from '../components/settings/DangerZoneSection';

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
    if (formData.newPassword && formData.newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters.');
      setLoading(false);
      return;
    }
    if (formData.newPassword && !formData.currentPassword) {
      setErrorMessage('Please enter your current password to change it.');
      setLoading(false);
      return;
    }

    const wantsPasswordChange = Boolean(formData.currentPassword && formData.newPassword);

    try {
      // 1. Update general profile (name + sizing preferences)
      const profilePayload = {
        full_name:     formData.fullName,
        top_size:      formData.topSize,
        bottom_size:   formData.bottomSize,
        preferred_fit: formData.preferredFit,
      };
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

      // 2. Change the password via its dedicated endpoint.
      //
      // This previously piggybacked on PUT /user/profile, but that endpoint
      // never validated or applied password fields, so "Save Settings" with a
      // new password silently did nothing. PUT /user/password verifies the
      // CURRENT password against the stored hash and revokes all tokens —
      // meaning the user must sign back in with their new password.
      let passwordChanged = false;
      if (wantsPasswordChange) {
        await api.put('/user/password', {
          current_password: formData.currentPassword,
          new_password:     formData.newPassword,
        });
        passwordChanged = true;
      }

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

      // A password change revokes every token server-side. End the session
      // cleanly and send the user to login to re-authenticate with the new
      // password instead of letting their very next request 401.
      if (passwordChanged) {
        clearStoredSession();
        navigate('/login', {
          replace: true,
          state: { message: 'Password updated successfully. Please sign in with your new password.' },
        });
        return;
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
    <main className="min-h-screen bg-[#0B0D12] px-6 pb-16 pt-28 text-hiraya-ink md:px-16">
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
              className="flex items-center gap-2 rounded-xl bg-[#CB997E] px-8 py-3 text-xs font-extrabold uppercase tracking-widest text-hiraya-olive transition hover:bg-hiraya-cream-deep disabled:opacity-50"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
              {loading ? 'Saving...' : saved ? 'Saved Changes!' : 'Save Settings'}
            </button>
            {saved && <span className="text-xs font-bold text-green-400">Profile & measurements updated successfully!</span>}
          </div>
        </form>

        <DangerZoneSection onDeleted={() => {
          clearStoredSession();
          navigate('/login', {
            replace: true,
            state: { message: 'Your account has been permanently deleted.' },
          });
        }} />

      </div>
    </main>
  );
};

export default AccountSettings;

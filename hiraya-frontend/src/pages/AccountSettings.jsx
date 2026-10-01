import { Check, Save, Loader2, User, Sparkles, ShieldCheck, AlertTriangle, Palette } from 'lucide-react';

/*
 * The in-page index. Plain anchors to the sections' own ids — scrolling only,
 * no state. `scroll-mt-32` on each section keeps its heading clear of the
 * floating navbar when it lands.
 */
const SECTION_INDEX = [
  { href: '#account-profile', label: 'Personal', Icon: User },
  { href: '#account-measurements', label: 'Sizing', Icon: Sparkles },
  { href: '#account-preferences', label: 'Display', Icon: Palette },
  { href: '#account-security', label: 'Security', Icon: ShieldCheck },
  { href: '#account-danger', label: 'Danger zone', Icon: AlertTriangle },
];
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api, { clearStoredSession } from '../api/axios';
import { meetsPasswordPolicy, passwordPolicyError } from '../utils/passwordPolicy';

import { SettingsHeader } from '../components/settings/SettingsHeader';
import { PersonalInfoSection } from '../components/settings/PersonalInfoSection';
import { VirtualTryOnSection } from '../components/settings/VirtualTryOnSection';
import { SecuritySection } from '../components/settings/SecuritySection';
import { PreferencesSection } from '../components/settings/PreferencesSection';
import { DangerZoneSection } from '../components/settings/DangerZoneSection';
import { loadSizeChart, getSizeLabels } from '../hooks/useTryOnState';

/*
 * THE SIZING PROFILE — two size labels, saved through its own endpoint.
 *
 * `top_size` / `bottom_size` and the five centimetre measurements are gone.
 * The two labels go to `PUT /api/user/sizes`, which is the ONE place a sizing
 * profile is written from — the AI Try-On panel that used to offer a second
 * "Sync & Save to Database" button over the same numbers has been removed, so
 * this page is now unambiguously the source of truth.
 */
const SIZE_FIELDS = ['upper_body_size', 'lower_body_size'];

const AccountSettings = () => {
  const navigate = useNavigate();
  const { user, updateUser, refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  /*
   * The size ladder for the selects, fetched from the SAME table the backend
   * sizes from. Until (or unless) that resolves the component's mirrored
   * fallback is used, so the selects are never empty.
   */
  const [sizeLabels, setSizeLabels] = useState([]);

  useEffect(() => {
    let isMounted = true;

    loadSizeChart().then((chart) => {
      if (isMounted) setSizeLabels((chart || []).map((s) => s.label));
    });

    // The label list is also readable synchronously once the chart has loaded,
    // which covers a remount that never issues a new request.
    const cached = getSizeLabels();
    if (cached?.length) setSizeLabels(cached);

    return () => { isMounted = false; };
  }, []);

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',

    // Sizing profile — the two size labels that replaced the 5 Core Body
    // Measurements.
    upper_body_size: '',
    lower_body_size: '',

    preferredFit: 'regular',
    gender: '',

    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  /*
   * READ THE FULL PROFILE ON OPEN. The cached user can be a partial copy (from
   * an older sign-in), and filling the form from it showed "Not set" for sizes
   * and gender — then "Save" would have overwritten the real values with blanks.
   */
  useEffect(() => {
    if (typeof refreshUser === 'function') {
      refreshUser().catch?.(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user) {
      setFormData((prev) => ({
        ...prev,
        fullName:       user.full_name || user.name || '',
        email:          user.email || '',
        upper_body_size: user.upper_body_size || '',
        lower_body_size: user.lower_body_size || '',
        preferredFit:   user.preferred_fit || 'regular',
        gender:         user.gender || '',
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
    /*
     * THE SHARED POLICY, NOT A LOCAL LENGTH CHECK.
     *
     * This page only asked for 8 characters, so it would happily submit
     * "abcdefgh" — which the server now rejects, because the same
     * App\Rules\PasswordStrength that guards sign-up and reset also guards
     * this endpoint. Checking the identical policy here turns what would be a
     * 422 round-trip into an inline message. See utils/passwordPolicy.js.
     */
    if (formData.newPassword && !meetsPasswordPolicy(formData.newPassword)) {
        setErrorMessage(passwordPolicyError(formData.newPassword));
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
      // 1. Update general profile (name + fit preference)
      const profilePayload = {
        full_name:     formData.fullName,
        preferred_fit: formData.preferredFit,
        ...(formData.gender ? { gender: formData.gender } : {}),
      };
      const profileRes = await api.put('/user/profile', profilePayload);

      // 2. Overwrite the sizing profile.
      //    PUT semantics = full replace, so a cleared select is sent as an
      //    empty string and the backend stores NULL rather than keeping a size
      //    the customer just removed.
      const sizesPayload = {};
      SIZE_FIELDS.forEach((key) => {
        sizesPayload[key] = formData[key] || null;
      });
      const sizesRes = await api.put('/user/sizes', sizesPayload);

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
      const freshUser = sizesRes.data?.user || profileRes.data?.user;
      if (freshUser) {
        updateUser(freshUser);
      } else {
        updateUser({
          ...profilePayload,
          ...sizesPayload,
        });
      }
      // Belt-and-suspenders: force-refresh from /user so both sizing columns
      // (including any the backend normalised) are present in the global auth
      // state.
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
    /*
     * THE PAGE GROUND IS THE CANVAS, NOT A BLACK SLAB.
     *
     * This was `bg-[#0B0D12]` — a near-black that exists nowhere in the heritage
     * palette, left over from the retired dark theme. It painted the entire
     * settings page as a black sheet UNDER the light `.glass` cards, so the page
     * fought both the app's canvas gradient and its own contents. The sections
     * carry their own surfaces; the page itself is the canvas.
     */
    <main className="container-page min-h-screen pb-24 pt-32 text-hiraya-ink">
      <div className="mx-auto max-w-6xl space-y-10">

        <SettingsHeader onBack={() => navigate(-1)} />

        <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
        {/* SECTION INDEX — desktop only; a sticky frosted card of anchors. */}
        <aside className="hidden lg:block">
          <nav aria-label="Settings sections" className="glass sticky top-32 p-3">
            <ul className="space-y-1">
              {SECTION_INDEX.map(({ href, label, Icon }) => (
                <li key={href}>
                  <a
                    href={href}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-hiraya-ink-soft transition-colors hover:bg-navy-900/[0.06] hover:text-hiraya-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-hiraya-focus"
                  >
                    <Icon size={15} className="shrink-0" />
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 space-y-8">
        {errorMessage && (
          <div className="rounded-xl border border-red-600/40 bg-red-500/12 p-4 text-xs text-red-700">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <PersonalInfoSection formData={formData} handleChange={handleChange} />
          <VirtualTryOnSection formData={formData} handleChange={handleChange} sizeLabels={sizeLabels} />
          <PreferencesSection />
          <SecuritySection formData={formData} handleChange={handleChange} />

          <div className="flex items-center gap-4 pt-2" data-tour="account-save">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary cursor-pointer rounded-full px-8 py-3.5"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : <Save size={16} />}
              {loading ? 'Saving...' : saved ? 'Saved Changes!' : 'Save Settings'}
            </button>
            {saved && <span className="text-xs font-semibold text-emerald-700">Profile &amp; sizes updated successfully!</span>}
          </div>
        </form>

        {/*
          TWO FACTOR — OUTSIDE THE PROFILE <form>, AND THAT IS LOAD-BEARING.

          THE BUG THIS FIXES
          ------------------
          This section was rendered INSIDE the profile form above, and it has its
          OWN <form> for the confirm step. HTML does not allow nested forms: the
          parser silently DROPS the inner <form> and keeps the outer one. So the
          "Turn On" button — type="submit" inside the inner form — ended up
          submitting the OUTER form instead.

          The user saw the page reload, the profile save run, and the enrollment
          never happen. The status endpoint then correctly reported "setup was
          started but not finished", so the section offered "Start Again", and the
          loop repeated forever. The report was "after Turn On it just refreshes
          and says Start Again" — and it was never the user's fault or their
          code: the confirm request was never sent.

          Rendered here, as a SIBLING of the profile form, the two forms are
          genuinely separate. Pressing Enter in the 6-digit box now confirms the
          factor, and pressing Enter in the name field still saves the profile.
        */}
        {/*
         * 2FA IS NOT HERE ANY MORE, AND NOW IT REALLY IS GONE.
         *
         * This section used to render `TwoFactorSection` for every signed-in user.
         * That was the wrong home for it: a customer who taps "Turn On" here
         * enrolled a factor the login endpoint never checked for them, and — worse —
         * the one person for whom the second factor is genuinely load-bearing, the
         * superadmin, had to leave the console to find it, under a heading
         * ("Account Settings") shared with body measurements and a wishlist.
         *
         * `TwoFactorSection` and the Laravel endpoints it drove are now DELETED, so
         * this is no longer a relocation. The replacement is `MfaEnrollment.jsx`,
         * mounted in the console's Settings tab and bound to the signed-in
         * operator, where a privileged account is expected to be — and it
         * enrols against Supabase rather than the deleted `user_two_factors`
         * table.
         */}
        <DangerZoneSection onDeleted={() => {
          clearStoredSession();
          navigate('/login', {
            replace: true,
            state: { message: 'Your account has been permanently deleted.' },
          });
        }} />
        </div>
        </div>

      </div>
    </main>
  );
};

export default AccountSettings;

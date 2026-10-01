import { Palette } from 'lucide-react';
import PreferenceControls from '../common/PreferenceControls';
import { useT } from '../../context/PreferencesContext';

/*
 * DISPLAY PREFERENCES — language and light / dark theme.
 *
 * These apply immediately and are stored on this device (see
 * PreferencesContext), so they are NOT part of the Save Settings submit.
 */
export const PreferencesSection = () => {
  const t = useT();
  return (
    <section id="account-preferences" className="card-raised scroll-mt-32 space-y-5 rounded-[24px] p-6 sm:p-8">
      <h2 className="flex items-center gap-3 border-b border-hiraya-structure-line pb-4 text-xs font-semibold uppercase tracking-[0.16em] text-hiraya-ink">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 text-cream-100 shadow-neu-sm"><Palette size={16} /></span>
        {t('prefs.title')}
      </h2>
      <p className="text-[10px] text-hiraya-ink-muted">{t('prefs.subtitle')}</p>
      <PreferenceControls variant="panel" />
    </section>
  );
};

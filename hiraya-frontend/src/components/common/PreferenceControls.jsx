import PropTypes from 'prop-types';
import { Moon, Sun, Languages } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { LANGUAGES } from '../../i18n/translations';

/*
 * LANGUAGE + THEME CONTROLS.
 *
 * `variant="nav"` is the compact pair that sits on the dark navigation bar
 * (a language select and a sun / moon button); `variant="panel"` is the
 * labelled version used in Account Settings and on the console.
 */
export default function PreferenceControls({ variant = 'nav' }) {
  const { lang, setLang, theme, toggleTheme, setTheme, t } = usePreferences();

  if (variant === 'panel') {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">{t('prefs.language')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="field cursor-pointer">
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-hiraya-ink-muted">{t('prefs.theme')}</span>
          <div role="radiogroup" aria-label={t('prefs.theme')} className="grid grid-cols-2 gap-2">
            {[
              { value: 'light', icon: Sun, label: t('prefs.light') },
              { value: 'dark', icon: Moon, label: t('prefs.dark') },
            ].map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] transition cursor-pointer ${
                  theme === value
                    ? 'border-hiraya-accent bg-hiraya-accent text-hiraya-on-accent shadow-neu-sm'
                    : 'border-hiraya-structure-line bg-hiraya-surface text-hiraya-ink hover:border-hiraya-accent/50'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <label className="relative flex h-9 items-center rounded-full border border-cream-50/15 bg-cream-50/[0.04] pl-2.5 pr-1 text-hiraya-nav-muted transition hover:border-cream-50/35 hover:text-hiraya-nav-ink">
        <Languages size={14} aria-hidden="true" />
        <span className="sr-only">{t('prefs.language')}</span>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="cursor-pointer appearance-none bg-transparent px-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-hiraya-nav-ink focus:outline-none"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} className="text-navy-900">
              {l.short}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={t('prefs.toggleTheme')}
        title={t('prefs.toggleTheme')}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-cream-50/15 bg-cream-50/[0.04] text-hiraya-nav-muted transition hover:border-cream-50/35 hover:text-hiraya-nav-ink cursor-pointer"
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </div>
  );
}

PreferenceControls.propTypes = {
  variant: PropTypes.oneOf(['nav', 'panel']),
};

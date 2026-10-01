import { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { Moon, Sun, Languages, ChevronDown, Check } from 'lucide-react';
import { usePreferences } from '../../context/PreferencesContext';
import { LANGUAGES } from '../../i18n/translations';

/*
 * LANGUAGE + THEME CONTROLS.
 *
 * `variant="nav"` is the compact pair that sits on the dark navigation bar
 * (a language select and a sun / moon button); `variant="panel"` is the
 * labelled version used in Account Settings and on the console.
 */
/*
 * THE NAV LANGUAGE MENU — a styled dropdown instead of a native <select>,
 * whose option list is drawn by the operating system (a plain white box that
 * ignored the site's look). Closes on outside click, Escape, or a choice.
 */
function LanguageMenu({ lang, setLang, label }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const current = LANGUAGES.find((l) => l.code === lang) || LANGUAGES[0];

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-cream-50/15 bg-cream-50/[0.04] pl-2.5 pr-2 text-hiraya-nav-muted transition hover:border-cream-50/35 hover:text-hiraya-nav-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-100/50"
      >
        <Languages size={14} aria-hidden="true" />
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-hiraya-nav-ink">{current.short}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-[calc(100%+8px)] z-[70] min-w-[11rem] overflow-hidden rounded-2xl bg-hiraya-surface p-1.5 shadow-[0_18px_40px_-18px_rgba(13,21,36,0.6)] ring-1 ring-hiraya-structure-line animate-fadeIn"
        >
          {LANGUAGES.map((l) => {
            const active = l.code === lang;
            return (
              <li key={l.code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setLang(l.code);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-[12px] transition ${
                    active ? 'bg-navy-900 text-cream-100' : 'text-hiraya-ink hover:bg-cream-200/70'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <span className={`w-6 text-[10px] font-bold uppercase tracking-wider ${active ? 'text-cream-300' : 'text-hiraya-ink-muted'}`}>{l.short}</span>
                    {l.label}
                  </span>
                  {active && <Check size={13} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

LanguageMenu.propTypes = {
  lang: PropTypes.string.isRequired,
  setLang: PropTypes.func.isRequired,
  label: PropTypes.string,
};

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
      <LanguageMenu lang={lang} setLang={setLang} label={t('prefs.language')} />
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

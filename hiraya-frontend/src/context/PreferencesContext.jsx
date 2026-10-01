import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { TRANSLATIONS, LANGUAGES } from '../i18n/translations';

/*
 * PREFERENCES — language (English / Tagalog / 日本語) and theme (light / dark).
 *
 * Both are per-browser display choices, so they live in localStorage rather
 * than on the account: they work for guests on the login page too, and a
 * storage failure (private mode, blocked site data) simply falls back to the
 * defaults instead of breaking the app.
 *
 * `t(key, vars)` looks the key up in the active language, falls back to
 * English, and finally to the key itself, so a missing translation can never
 * blank a label. `{name}` placeholders are filled from `vars`.
 */

const STORAGE_LANG = 'hiraya.lang';
const STORAGE_THEME = 'hiraya.theme';

const read = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the choice still applies for this visit */
  }
};

const initialTheme = () => {
  const saved = read(STORAGE_THEME);
  if (saved === 'dark' || saved === 'light') return saved;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

const initialLang = () => {
  const saved = read(STORAGE_LANG);
  return LANGUAGES.some((l) => l.code === saved) ? saved : 'en';
};

const PreferencesContext = createContext(null);

export const PreferencesProvider = ({ children }) => {
  const [lang, setLangState] = useState(initialLang);
  const [theme, setThemeState] = useState(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-transition');
    root.classList.toggle('dark', theme === 'dark');
    const timer = window.setTimeout(() => root.classList.remove('theme-transition'), 400);
    return () => window.clearTimeout(timer);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang === 'tl' ? 'tl' : lang;
  }, [lang]);

  const setLang = useCallback((code) => {
    if (!LANGUAGES.some((l) => l.code === code)) return;
    setLangState(code);
    write(STORAGE_LANG, code);
  }, []);

  const setTheme = useCallback((next) => {
    const value = next === 'dark' ? 'dark' : 'light';
    setThemeState(value);
    write(STORAGE_THEME, value);
  }, []);

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  const t = useCallback(
    (key, vars) => {
      let text = TRANSLATIONS[lang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
      if (vars) {
        Object.entries(vars).forEach(([name, value]) => {
          text = text.split(`{${name}}`).join(String(value));
        });
      }
      return text;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, theme, setTheme, toggleTheme, t }), [lang, setLang, theme, setTheme, toggleTheme, t]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
};

PreferencesProvider.propTypes = {
  children: PropTypes.node,
};

/** Safe outside the provider too (returns English + light no-ops). */
export const usePreferences = () => {
  const ctx = useContext(PreferencesContext);
  if (ctx) return ctx;
  return {
    lang: 'en',
    setLang: () => {},
    theme: 'light',
    setTheme: () => {},
    toggleTheme: () => {},
    t: (key) => TRANSLATIONS.en[key] ?? key,
  };
};

/** Shorthand for components that only need the translator. */
export const useT = () => usePreferences().t;

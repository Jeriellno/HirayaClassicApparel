import { useEffect } from 'react';
import { usePreferences } from '../context/PreferencesContext';
import { PHRASES, PHRASE_PATTERNS } from './phrases';

/*
 * LIVE TRANSLATOR — applies the selected language to the WHOLE app.
 *
 * Keyed `t()` strings (translations.js) already switch with the language, but
 * most screens — customer pages, the Admin / Super Admin console, dialogs,
 * toasts, empty states and status labels — render literal English. This
 * component translates those, centrally, from the phrase dictionary
 * (i18n/phrases.js):
 *
 *   - every text node and every `placeholder` / `title` / `aria-label` / `alt`
 *     whose WHOLE text is a known UI phrase is swapped for the selected
 *     language; anything else is left exactly as it is;
 *   - a MutationObserver keeps up with React re-renders, route changes, modals
 *     and portals (React writing a new English value is translated again; our
 *     own writes are recognised and ignored, so there is no loop);
 *   - switching back to English restores the original text;
 *   - `translate="no"`, `data-no-translate`, inputs, textareas and code blocks
 *     are never touched, so database values and what people type stay as-is.
 *
 * The language itself is persisted by PreferencesContext (localStorage).
 */

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SKIP = 'script,style,textarea,code,pre,[translate="no"],[data-no-translate],[contenteditable="true"]';

// node -> { orig, shown } for text we replaced; element -> { [attr]: { orig, shown } }
const textState = new WeakMap();
const attrState = new WeakMap();

const translate = (value, lang) => {
  if (!value || lang === 'en') return null;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  const core = match[2].replace(/\s+/g, ' ');
  if (!core || core.length > 400) return null;

  let out = PHRASES[lang]?.get(core) ?? null;
  if (!out) {
    const pattern = PHRASE_PATTERNS.find((p) => p.re.test(core));
    if (pattern && pattern[lang]) out = core.replace(pattern.re, pattern[lang]);
  }
  return out ? `${match[1]}${out}${match[3]}` : null;
};

const skipped = (node) => {
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !el || Boolean(el.closest(SKIP));
};

const applyText = (node, lang) => {
  if (skipped(node)) return;
  const rec = textState.get(node);
  const current = node.nodeValue;
  // Our own earlier write -> its English original; otherwise React wrote new text.
  const original = rec && current === rec.shown ? rec.orig : current;
  const next = translate(original, lang);

  if (next) {
    if (next !== current) node.nodeValue = next;
    textState.set(node, { orig: original, shown: next });
  } else {
    if (rec && current === rec.shown && current !== original) node.nodeValue = original;
    textState.delete(node);
  }
};

const applyAttr = (el, attr, lang) => {
  if (!el.hasAttribute(attr) || skipped(el)) return;
  const all = attrState.get(el) || {};
  const rec = all[attr];
  const current = el.getAttribute(attr);
  const original = rec && current === rec.shown ? rec.orig : current;
  const next = translate(original, lang);

  if (next) {
    if (next !== current) el.setAttribute(attr, next);
    all[attr] = { orig: original, shown: next };
    attrState.set(el, all);
  } else if (rec) {
    if (current === rec.shown && current !== original) el.setAttribute(attr, original);
    delete all[attr];
  }
};

const applyTree = (root, lang) => {
  if (root.nodeType === 3) {
    applyText(root, lang);
    return;
  }
  if (root.nodeType !== 1 || skipped(root)) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) applyText(node, lang);

  const withAttrs = [root, ...root.querySelectorAll(ATTRS.map((a) => `[${a}]`).join(','))];
  withAttrs.forEach((el) => ATTRS.forEach((attr) => applyAttr(el, attr, lang)));
};

const LiveTranslator = () => {
  const { lang } = usePreferences();

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;

    // Translate (or restore, for English) everything already on screen.
    applyTree(document.body, lang);
    if (lang === 'en') return undefined;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        if (m.type === 'characterData') applyText(m.target, lang);
        else if (m.type === 'attributes') applyAttr(m.target, m.attributeName, lang);
        else m.addedNodes.forEach((node) => applyTree(node, lang));
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });

    return () => observer.disconnect();
  }, [lang]);

  return null;
};

export default LiveTranslator;

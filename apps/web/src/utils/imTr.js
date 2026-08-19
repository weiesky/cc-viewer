import { t } from '../i18n';

// Safe translate-with-fallback used across the IM settings components: returns the translation
// when present, otherwise the provided English fallback (never the raw key).
export const imTr = (key, params, fallback) => {
  try { const r = t(key, params); return (r && r !== key) ? r : fallback; } catch { return fallback; }
};

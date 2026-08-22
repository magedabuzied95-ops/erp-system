import i18n, {
  applyDocumentLanguage,
  normalizeLanguage,
  resolveInitialLanguage,
  whenLocalesReady,
} from "../../../i18n/i18n";

/**
 * Manager-portal language preference.
 *
 * The portal keeps its OWN language, independent of the ERP's `app_language`
 * / user preference: a manager on a phone may want the portal in Arabic while
 * the back-office stays in English (or the reverse). The preference lives
 * under its own storage key, is applied to the i18n instance + document only
 * while the portal is mounted, and the system language is restored on exit.
 *
 * `persistApplicationLanguage` is deliberately NOT used here — that would leak
 * the portal choice into the system setting.
 */
export const MANAGER_PORTAL_LANGUAGE_KEY = "manager_portal_language";

export const readManagerPortalLanguage = () => {
  try {
    if (typeof localStorage === "undefined") return "";
    const raw = localStorage.getItem(MANAGER_PORTAL_LANGUAGE_KEY);
    return raw ? normalizeLanguage(raw) : "";
  } catch {
    return "";
  }
};

export const writeManagerPortalLanguage = (language) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(MANAGER_PORTAL_LANGUAGE_KEY, normalizeLanguage(language));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
};

/** The language the rest of the ERP is using (what we restore on exit). */
export const readSystemLanguage = () => normalizeLanguage(resolveInitialLanguage());

/** Effective portal language: the portal's own choice, else the system one. */
export const resolveManagerPortalLanguage = () => readManagerPortalLanguage() || readSystemLanguage();

/** Switch the runtime (dictionary + document direction) without persisting anything system-wide. */
export const activateRuntimeLanguage = async (language) => {
  const normalized = normalizeLanguage(language);
  if (normalizeLanguage(i18n.resolvedLanguage || i18n.language) !== normalized) {
    await whenLocalesReady();
    await i18n.changeLanguage(normalized);
  }
  applyDocumentLanguage(normalized);
  return normalized;
};

export const clearManagerPortalLanguage = () => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(MANAGER_PORTAL_LANGUAGE_KEY);
  } catch {
    // ignore
  }
};

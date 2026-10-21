/*
 * The pages this person opens, for the quick search (Ctrl K) and the two
 * shortcuts beside it — Genie ERP's "Jump back", "Likely next" and "Recent".
 * Kept per user in this browser; nothing here is required for navigation, so
 * every storage access is guarded and a failure just means no history.
 */

const KEY_PREFIX = "m1.recentPages.";
const MAX_ENTRIES = 40;
export const RECENT_PAGES_EVENT = "erp:recent-pages";

const storageKey = (userId) => `${KEY_PREFIX}${userId || "anon"}`;

export const readRecentPages = (userId) => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.to === "string") : [];
  } catch {
    return [];
  }
};

// One visit to `to` (a sidebar path). Moves it to the front and counts it.
export const recordPageVisit = (userId, to) => {
  if (!to) return;
  try {
    const entries = readRecentPages(userId);
    const existing = entries.find((entry) => entry.to === to);
    const next = [
      { to, at: Date.now(), count: (existing?.count || 0) + 1 },
      ...entries.filter((entry) => entry.to !== to),
    ].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENT_PAGES_EVENT));
  } catch {
    // Private window or blocked storage: no history, navigation unaffected.
  }
};

// Newest first, without the page you are on.
export const recentPagePaths = (userId, currentPath = "") =>
  readRecentPages(userId).filter((entry) => entry.to !== currentPath).map((entry) => entry.to);

// Most visited first (ties: most recent), without the page you are on.
export const frequentPagePaths = (userId, currentPath = "") =>
  readRecentPages(userId)
    .filter((entry) => entry.to !== currentPath)
    .sort((a, b) => (b.count || 0) - (a.count || 0) || (b.at || 0) - (a.at || 0))
    .map((entry) => entry.to);

// The sidebar item a URL belongs to: the longest sidebar path it starts with.
export const matchSidebarPath = (pathname = "", paths = []) => {
  let best = "";
  for (const path of paths) {
    if (!path) continue;
    const exact = pathname === path;
    const nested = pathname.startsWith(path.endsWith("/") ? path : `${path}/`);
    if ((exact || nested) && path.length > best.length) best = path;
  }
  return best;
};

// Arabic-aware folding for the search: letter variants that read the same.
export const foldSearchText = (value = "") =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .trim();

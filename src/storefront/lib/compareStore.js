import { useCallback, useSyncExternalStore } from "react";
import { ROOT_PATHS } from "./paths.js";

/**
 * The product comparison list: up to three colourways the customer picked from a
 * card or a product page, compared side by side on /compare.
 *
 * It is a module store rather than Storefront state on purpose. ProductCard is a
 * memoised component rendered by a dozen callers; threading the list through all
 * of them would re-render every card on every toggle. A card subscribes to its own
 * membership only, so adding one product re-renders exactly one card.
 *
 * Kept in localStorage (per browser, like the guest wishlist) and mirrored across
 * tabs through the `storage` event.
 */

export const COMPARE_STORAGE_KEY = "storefront.compare.v1";
export const COMPARE_MAX_ITEMS = 3;

const listeners = new Set();
let items = null;

const text = (value) => String(value ?? "").trim();

/** A bag against a sneaker has no row in common but the price, so the list keeps one family. */
export const compareFamilyOf = (productType = "") => {
  const key = text(productType).toLowerCase();
  if (!key) return "";
  // Arabic written as escapes so an editor's encoding guess cannot corrupt the match.
  if (/bag|backpack|\u0634\u0646\u0637|\u062D\u0642\u064A\u0628/.test(key)) return "bags";
  return "footwear";
};

export const normalizeCompareItem = (item = {}) => {
  const safe = item && typeof item === "object" ? item : {};
  const id = text(safe.id || safe.product_id || safe.productId || safe.parent_product_id).split(":")[0];
  if (!id) return null;
  return {
    id,
    slug: text(safe.slug || safe.canonical_slug) || id,
    name: text(safe.name),
    image: text(safe.image),
    colorKey: text(safe.colorKey).toLowerCase(),
    colorName: text(safe.colorName),
    productType: text(safe.productType),
    family: text(safe.family) || compareFamilyOf(safe.productType),
    addedAt: Number(safe.addedAt) || Date.now(),
  };
};

const sanitizeList = (list) => {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(normalizeCompareItem)
    .filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, COMPARE_MAX_ITEMS);
};

const readStorage = () => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return [];
    return sanitizeList(JSON.parse(window.localStorage.getItem(COMPARE_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
};

const writeStorage = (list) => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    if (list.length) window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(list));
    else window.localStorage.removeItem(COMPARE_STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: the list still lives for this page view.
  }
};

const EMPTY = Object.freeze([]);

export const getCompareItems = () => {
  if (items === null) items = readStorage();
  return items.length ? items : EMPTY;
};

const commit = (next) => {
  items = sanitizeList(next);
  writeStorage(items);
  listeners.forEach((listener) => listener());
};

let storageListenerAttached = false;
const subscribe = (listener) => {
  listeners.add(listener);
  if (!storageListenerAttached && typeof window !== "undefined") {
    storageListenerAttached = true;
    window.addEventListener("storage", (event) => {
      if (event.key !== COMPARE_STORAGE_KEY) return;
      items = readStorage();
      listeners.forEach((entry) => entry());
    });
  }
  return () => listeners.delete(listener);
};

/**
 * @returns {{ ok: true, action: "added" | "removed" } | { ok: false, reason: "full" | "family" | "invalid" }}
 */
export const toggleCompareItem = (input) => {
  const item = normalizeCompareItem(input);
  if (!item) return { ok: false, reason: "invalid" };
  const current = getCompareItems();
  if (current.some((entry) => entry.id === item.id)) {
    commit(current.filter((entry) => entry.id !== item.id));
    return { ok: true, action: "removed" };
  }
  if (current.length >= COMPARE_MAX_ITEMS) return { ok: false, reason: "full" };
  const family = current.find((entry) => entry.family)?.family || "";
  if (family && item.family && family !== item.family) return { ok: false, reason: "family" };
  commit([...current, item]);
  return { ok: true, action: "added" };
};

export const removeCompareItem = (id) => {
  const key = text(id);
  commit(getCompareItems().filter((entry) => entry.id !== key));
};

/**
 * Re-points one column (another colourway, or the real id a shared link only knew
 * by slug) without losing its place in the list.
 */
export const updateCompareItem = (id, patch = {}) => {
  const key = text(id);
  commit(getCompareItems().map((entry) => (entry.id === key ? { ...entry, ...patch } : entry)));
};

export const replaceCompareItems = (list) => commit(list);
export const clearCompareItems = () => commit([]);

export const useCompareItems = () => useSyncExternalStore(subscribe, getCompareItems, () => EMPTY);

export const useIsInCompare = (id) => {
  const key = text(id);
  const getSnapshot = useCallback(() => getCompareItems().some((entry) => entry.id === key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
};

/** `slug~colorKey` pairs, comma separated: short enough to paste in WhatsApp. */
export const serializeCompareQuery = (list = []) =>
  sanitizeList(list).map((entry) => (entry.colorKey ? `${entry.slug}~${entry.colorKey}` : entry.slug)).join(",");

export const comparePagePath = (list = []) => {
  const query = serializeCompareQuery(list);
  return query ? `${ROOT_PATHS.compare}?items=${encodeURIComponent(query)}` : ROOT_PATHS.compare;
};

export const parseCompareQuery = (value = "") =>
  text(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, COMPARE_MAX_ITEMS)
    .map((part) => {
      const [slug, colorKey = ""] = part.split("~");
      return { slug: text(slug), colorKey: text(colorKey).toLowerCase() };
    })
    .filter((entry) => entry.slug);

/** Only for tests: forget the in-memory copy so the next read hits storage. */
export const __resetCompareStoreForTests = () => {
  items = null;
};

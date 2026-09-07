import { api } from "../../../shared/api/api";
import { normalizeSaleModeSettings } from "../../../shared/lib/saleMode";
import { getPosSellableProducts, normalizePosCatalogProduct, normalizePosSellableProducts, repricePosCatalogProducts } from "../../pos/services/posProductsApi";
import { getPosCatalogVersion } from "../../products/services/productsApi";
import { PICKER_PAGE_SIZE, buildPickerParams, pickerQueryKey } from "./pickerQuery";
import {
  SNAPSHOT_FRESH_MS,
  readCatalogSnapshot,
  snapshotAgeMs,
  touchCatalogSnapshot,
  writeCatalogSnapshot,
} from "./inboxCatalogSnapshot";

const readSettings = (payload = {}) =>
  payload?.settings && typeof payload.settings === "object" ? payload.settings : payload;

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogCache = null;
let catalogRequest = null;

// ---- Bounded, search-first picker results --------------------------------
// "إرسال منتج" used to call loadCustomerProductCatalog(), which asks
// /products/with-variants with NO limit — the server then omits the LIMIT clause
// entirely and returns the whole catalog with every variant (~50MB). That is why
// the modal sat on "جاري تحميل كتالوج المنتجات...". The size-first flow already
// avoided this, but only for the "المتاح بالمقاس" button.
//
// We keep the EXACT same endpoint and the EXACT same client pipeline
// (getPosSellableProducts → normalizePosSellableProducts → normalizePosCatalogProduct),
// so sale-mode / effective-price resolution and stock/active flags stay
// byte-for-byte identical. The only change is asking the server for one bounded,
// pre-filtered page instead of everything.
export { PICKER_PAGE_SIZE, SERVER_FILTER_KEYS, buildPickerParams, pickerQueryKey } from "./pickerQuery";

const SETTINGS_TTL_MS = 5 * 60 * 1000;
let saleModeCache = null;
let saleModeRequest = null;

const SEARCH_TTL_MS = 60 * 1000;
const searchCache = new Map();    // key -> { loadedAt, value }
const searchInFlight = new Map(); // key -> Promise (in-flight dedup)

const loadSaleModeSettings = async ({ headers } = {}) => {
  if (saleModeCache && Date.now() - saleModeCache.loadedAt < SETTINGS_TTL_MS) return saleModeCache.value;
  if (saleModeRequest) return saleModeRequest;
  const requestConfig = {
    cache: "no-store",
    headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" },
  };
  saleModeRequest = (async () => {
    const settingsPayload = await api
      .get("/website/settings", requestConfig)
      .catch(() => api.get("/settings/public", requestConfig))
      .catch(() => ({ settings: { sale_mode_enabled: false } }));
    const value = normalizeSaleModeSettings(readSettings(settingsPayload));
    saleModeCache = { loadedAt: Date.now(), value };
    return value;
  })();
  try {
    return await saleModeRequest;
  } finally {
    saleModeRequest = null;
  }
};

/**
 * One bounded page of picker products, optionally server-filtered by `search`.
 * Identical normalization/pricing to the full-catalog path — only bounded.
 * Concurrent identical requests share one promise, and results are briefly
 * cached so closing and reopening the picker is effectively instant.
 */
/**
 * One bounded page of picker products, filtered SERVER-SIDE across the whole
 * catalog. Same endpoint and same normalization/pricing pipeline as the
 * full-catalog path (normalizePosSellableProducts → normalizePosCatalogProduct),
 * so prices and stock stay byte-identical — only bounded and pre-filtered.
 * Returns the match total so callers can paginate and show "X products match"
 * without loading them all.
 */
export const searchCustomerProducts = async ({ search = "", filters = {}, limit = PICKER_PAGE_SIZE, page = 1, headers, signal } = {}) => {
  const params = buildPickerParams({ search, filters, page, limit });
  const key = pickerQueryKey(params);
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.loadedAt < SEARCH_TTL_MS) return cached.value;
  const inFlight = searchInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const saleModeSettings = await loadSaleModeSettings({ headers });
    const response = await api.get("/products/with-variants", {
      params,
      headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal,
      perfComponent: "ProductCardPicker.search",
    });
    const rows = Array.isArray(response?.products)
      ? response.products
      : Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
          ? response
          : [];
    // EXACT same pipeline getPosSellableProducts uses — pricing parity by construction.
    const products = normalizePosSellableProducts(rows, saleModeSettings).map((product) => normalizePosCatalogProduct(product));
    const total = Number.isFinite(Number(response?.total)) ? Number(response.total) : null;
    const hasMore = typeof response?.has_more === "boolean" ? response.has_more : products.length >= limit;
    const value = { products, saleModeSettings, total, hasMore, page };
    searchCache.set(key, { loadedAt: Date.now(), value });
    return value;
  })();

  searchInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    searchInFlight.delete(key);
  }
};

export const __resetPickerSearchCacheForTests = () => {
  searchCache.clear();
  searchInFlight.clear();
  saleModeCache = null;
};

export const loadCustomerProductCatalog = async ({ headers } = {}) => {
  if (catalogCache && Date.now() - catalogCache.loadedAt < CATALOG_CACHE_TTL_MS) {
    return catalogCache.value;
  }
  if (catalogRequest) return catalogRequest;
  const requestConfig = {
    cache: "no-store",
    headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" },
  };
  catalogRequest = (async () => {
    const settingsPayload = await api
      .get("/website/settings", requestConfig)
      .catch(() => api.get("/settings/public", requestConfig))
      .catch(() => ({ settings: { sale_mode_enabled: false } }));
    const saleModeSettings = normalizeSaleModeSettings(readSettings(settingsPayload));
    // Ask for the POS allowlist projection (?pos=1), not the old ?compact=1 denylist.
    // This is the full-catalog path — the one the inbox sheet still uses — so the
    // payload size IS the wait. compact stripped ~19 fields; pos keeps only the fields
    // this exact pipeline reads, which is why the normalized result is unchanged (see
    // tests/ai-inbox-picker-projection-parity.test.js) while the download shrinks by
    // roughly 5x. It also keeps cost data off the inbox client, as compact did.
    const products = await getPosSellableProducts(saleModeSettings, {
      requestOptions: { params: { pos: 1 }, headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" } },
    });
    const value = { products, saleModeSettings };
    catalogCache = { loadedAt: Date.now(), value };
    return value;
  })();
  try {
    return await catalogRequest;
  } finally {
    catalogRequest = null;
  }
};

const asProducts = (value) => (Array.isArray(value) ? value : []);

// ---- Warm-open catalog: paint from the persistent snapshot, then revalidate ---
//
// loadCustomerProductCatalog() downloads the WHOLE catalog (no limit param means
// the server emits no LIMIT clause). Its module-level 5-minute cache dies with the
// JS context, which on a phone happens every time the PWA is backgrounded - so the
// inbox product sheet paid the full multi-MB download, parse and normalize on
// practically every open. This wraps it in the same stale-while-revalidate shape
// the POS terminal uses:
//
//   1. paint the IndexedDB snapshot immediately (no network at all),
//   2. re-price it against the live sale-mode settings, so a cached page can never
//      show a price the current pricing rule would not produce,
//   3. only then ask the ~80-byte /products/pos-catalog-version watermark, and skip
//      the multi-MB download entirely when nothing sellable changed.
//
// `onSnapshot` fires once per improvement (cached -> re-priced -> fresh), so the
// caller can render the first one and drop its spinner.
export const loadCustomerProductCatalogWarm = async ({ headers, onSnapshot, force = false } = {}) => {
  const emit = (products, meta) => {
    if (typeof onSnapshot !== "function") return;
    if (!Array.isArray(products) || !products.length) return;
    try {
      onSnapshot({ products, ...meta });
    } catch {
      // A render error in the consumer must never abort the revalidation.
    }
  };

  const snapshot = force ? null : await readCatalogSnapshot().catch(() => null);
  let servedProducts = null;
  let servedSaleMode = null;
  // Read the watermark at most once per call: asking twice could straddle a
  // mutation and store a version that does not describe the payload we saved.
  let versionRead = false;
  let version = "";
  const readVersion = async () => {
    if (versionRead) return version;
    versionRead = true;
    version = await getPosCatalogVersion().catch(() => "");
    return version;
  };

  if (snapshot) {
    servedProducts = snapshot.products;
    emit(servedProducts, { fromCache: true, stale: true });

    // The watermark covers a sale-mode SETTINGS change but not a change to the
    // pricing rule itself, and it can also fail. Re-pricing the snapshot in memory
    // is cheap and makes the cached page obey whatever rule is live right now.
    servedSaleMode = await loadSaleModeSettings({ headers }).catch(() => null);
    if (servedSaleMode) {
      servedProducts = repricePosCatalogProducts(snapshot.products, servedSaleMode);
      emit(servedProducts, { fromCache: true, stale: true, saleModeSettings: servedSaleMode });
    }

    if (snapshotAgeMs(snapshot) < SNAPSHOT_FRESH_MS) {
      return { products: servedProducts, saleModeSettings: servedSaleMode, fromCache: true, refreshed: false };
    }

    const cachedVersion = await readVersion();
    if (cachedVersion && cachedVersion === snapshot.catalog_version) {
      await touchCatalogSnapshot(snapshot).catch(() => null);
      return { products: servedProducts, saleModeSettings: servedSaleMode, fromCache: true, refreshed: false };
    }
  }

  // Capture the watermark BEFORE the download, so a mutation landing mid-download
  // leaves the snapshot looking stale rather than falsely current.
  const freshVersion = await readVersion();
  const fresh = await loadCustomerProductCatalog({ headers });
  const products = asProducts(fresh?.products);
  if (products.length) {
    await writeCatalogSnapshot(products, freshVersion).catch(() => null);
    emit(products, { fromCache: false, stale: false, saleModeSettings: fresh?.saleModeSettings });
    return { ...fresh, products, fromCache: false, refreshed: true };
  }
  // An empty refresh must not blank a good cached page.
  if (servedProducts) {
    return { products: servedProducts, saleModeSettings: servedSaleMode, fromCache: true, refreshed: false };
  }
  return { ...fresh, products, fromCache: false, refreshed: true };
};

export default loadCustomerProductCatalog;

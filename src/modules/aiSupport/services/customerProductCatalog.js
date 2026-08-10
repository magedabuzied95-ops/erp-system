import { api } from "../../../shared/api/api";
import { normalizeSaleModeSettings } from "../../../shared/lib/saleMode";
import { getPosSellableProducts } from "../../pos/services/posProductsApi";

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
export const PICKER_PAGE_SIZE = 24; // /products/with-variants hard-caps limit at 48

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
export const searchCustomerProducts = async ({ search = "", limit = PICKER_PAGE_SIZE, page = 1, headers, signal } = {}) => {
  const term = String(search ?? "").trim();
  const key = `${term}|${page}|${limit}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.loadedAt < SEARCH_TTL_MS) return cached.value;
  const inFlight = searchInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const saleModeSettings = await loadSaleModeSettings({ headers });
    const products = await getPosSellableProducts(saleModeSettings, {
      requestOptions: {
        params: { compact: 1, limit, page, ...(term ? { search: term } : {}) },
        headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" },
        signal,
        perfComponent: "ProductCardPicker.search",
      },
    });
    const value = { products, saleModeSettings };
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
    // Use the compact picker projection: same normalization/pricing, but the API
    // omits cost/margin/supplier/description/SEO fields the card never uses. Keeps
    // sensitive cost data off the inbox client and trims the payload.
    const products = await getPosSellableProducts(saleModeSettings, {
      requestOptions: { params: { compact: 1 }, headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" } },
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

export default loadCustomerProductCatalog;

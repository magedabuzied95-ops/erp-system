import { api } from "../../../shared/api/api";
import { normalizeSaleModeSettings } from "../../../shared/lib/saleMode";
import { getPosSellableProducts } from "../../pos/services/posProductsApi";

const readSettings = (payload = {}) =>
  payload?.settings && typeof payload.settings === "object" ? payload.settings : payload;

const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
let catalogCache = null;
let catalogRequest = null;

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
    const products = await getPosSellableProducts(saleModeSettings);
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

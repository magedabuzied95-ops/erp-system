import { api } from "../../../shared/api/api";
import { normalizeSaleModeSettings } from "../../../shared/lib/saleMode";
import { getPosSellableProducts } from "../../pos/services/posProductsApi";

const readSettings = (payload = {}) =>
  payload?.settings && typeof payload.settings === "object" ? payload.settings : payload;

export const loadCustomerProductCatalog = async ({ headers } = {}) => {
  const requestConfig = {
    cache: "no-store",
    headers: { ...(headers || {}), "Cache-Control": "no-cache", Pragma: "no-cache" },
  };
  const settingsPayload = await api
    .get("/website/settings", requestConfig)
    .catch(() => api.get("/settings/public", requestConfig))
    .catch(() => ({ settings: { sale_mode_enabled: false } }));
  const saleModeSettings = normalizeSaleModeSettings(readSettings(settingsPayload));
  const products = await getPosSellableProducts(saleModeSettings);
  return { products, saleModeSettings };
};

export default loadCustomerProductCatalog;

import { api } from '../api/api.js';
import { getCurrentTenant, getCurrentUser } from '../auth/authStorage.js';
import { createPreparedWorkspaceCache } from './preparedWorkspaceCache.js';

const scope = () => {
  const user = getCurrentUser() || {}, tenant = getCurrentTenant() || {};
  const tenantId = tenant.id || tenant.tenant_id || user.tenant_id || user.tenantId;
  if (!user.id || !tenantId) return '';
  return JSON.stringify([user.id, tenantId, user.branch_id || user.branchId || '', user.role || user.role_name,
    (Array.isArray(user.permissions) ? [...user.permissions] : []).sort()]);
};
const cache = createPreparedWorkspaceCache({ scope });
export const peekWorkspace = (key) => cache.peek(key);
export const readPreparedWorkspace = (key, loader, options) => cache.read(key, loader, options);
export const clearWorkspacePreload = () => cache.clear();
export const preparedOrderRows = (data) => Array.isArray(data) ? data : data?.orders || data?.data || [];

const loaders = {
  dashboard: (signal) => api.get('/dashboard/overview?range=today', { signal, timeoutMs: 12000 }),
  orders: (signal) => api.get('/orders?page=1&limit=500&include_items=0', { signal, timeoutMs: 12000 }),
  pos: async (signal) => {
    const [response, publicSettings, productsApi, saleModeApi] = await Promise.all([
      api.get('/products/with-variants', { params: { pos: 1, page: 1, limit: 30 }, signal, timeoutMs: 15000 }),
      api.get('/settings/public', { signal, timeoutMs: 10000, cache: 'no-store' }),
      import('../../modules/pos/services/posProductsApi.js'),
      import('../../modules/pos/lib/posSaleModeSettings.js'),
    ]);
    const raw = Array.isArray(response) ? response : response?.products || response?.data || [];
    const { saleModeSettings } = saleModeApi.resolvePosSaleModeForLoad({ publicSettings });
    return { products: productsApi.normalizePosSellableProducts(raw, saleModeSettings).map(productsApi.normalizePosCatalogProduct), saleModeSettings };
  },
};
const screens = {
  dashboard: () => import('../../pages/Dashboard.jsx'),
  orders: () => import('../../modules/orders/pages/OrdersDashboard.jsx'),
  pos: () => import('../../modules/pos/pages/POSPro.jsx'),
};

export async function preloadWorkspaces({ routes, pathname, cancelled = () => false, intent }) {
  const keys = ['pos', 'dashboard', 'orders'].filter((key) => routes.includes(`/${key}`) && pathname !== `/${key}`);
  if (intent) keys.sort((a, b) => Number(intent === `/${b}`) - Number(intent === `/${a}`));
  const identity = scope();
  for (const key of keys) {
    if (cancelled() || !identity || scope() !== identity) return;
    // POS first; lower-priority screens never fan out over it or the inbox.
    await Promise.all([cache.prepare(key, loaders[key]), screens[key]()]).catch(() => {});
  }
}

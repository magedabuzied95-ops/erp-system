import { readProductsListFilters } from './productListFilters.js';

export const productListSignature = (params) => JSON.stringify([
  Number(params.page), Number(params.limit), params.search || '', params.status, params.colorImageStatus,
  params.brand, params.manufacturer, params.storefrontVisibility, params.catalogTab,
  params.gender, params.productType, params.grade,
]);

export function readProductListBootstrap(storage = globalThis?.localStorage) {
  const filters = readProductsListFilters(storage);
  let size = 10;
  try {
    const saved = storage?.getItem('erp.products.list.pageSize');
    if (saved === 'all') return null;
    if (saved && [10, 25, 50, 100, 200, 500, 1000].includes(Number(saved))) size = Number(saved);
  } catch { /* defaults remain valid without browser storage */ }
  // A large operator-selected page is fetched on demand, never speculatively.
  if (size > 50) return null;
  const params = { page: 1, limit: size, search: '', status: filters.status, colorImageStatus: filters.colorImageStatus,
    brand: filters.brand, manufacturer: filters.manufacturer, storefrontVisibility: filters.storefrontVisibility,
    catalogTab: filters.catalogTab, ...filters.classifications };
  return { params, signature: productListSignature(params) };
}

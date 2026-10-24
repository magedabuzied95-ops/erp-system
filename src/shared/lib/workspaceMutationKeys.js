export function workspaceMutationKeys(method, endpoint) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())) return [];
  const path = String(endpoint).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '').split('?')[0];
  if (/^\/(?:orders|pos)(?:\/|$)/.test(path)) return ['pos-recent', 'orders'];
  if (/^\/purchases(?:\/|$)/.test(path)) return ['purchases', 'products', 'pos'];
  if (/^\/products(?:\/|$)/.test(path)) return ['products', 'pos'];
  return [];
}

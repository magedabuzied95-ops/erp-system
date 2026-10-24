import { API_BASE_URL } from '../../shared/constants/app.js?m1PreviewApi=2';

let configPromise;
let destination = '';
const queued = new Map();
const sent = new Set();
const shopHost = () => typeof window !== 'undefined' && ['m1store-egy.com', 'www.m1store-egy.com'].includes(window.location.hostname.toLowerCase());

export const googleAdsPurchasePayload = (purchase, sendTo) => {
  if (!/^AW-\d+\/[A-Za-z0-9_-]+$/.test(sendTo || '')) return null;
  const transaction = String(purchase?.transaction_id || '').trim();
  const value = Number(purchase?.value);
  if (!transaction || transaction.length > 100 || !Number.isFinite(value) || value <= 0 || purchase?.currency !== 'EGP') return null;
  // Explicit allowlist: no customer name, email, phone, address or order lines.
  return { send_to: sendTo, transaction_id: transaction, value, currency: 'EGP' };
};
const emit = purchase => {
  const payload = googleAdsPurchasePayload(purchase, destination);
  if (!payload || !window.gtag) return;
  const key = `${destination}:${payload.transaction_id}`;
  if (sent.has(key)) return;
  try { if (window.localStorage.getItem(`m1.googleAds.purchase.${key}`)) return; } catch { /* restricted storage */ }
  window.gtag('event', 'conversion', payload);
  sent.add(key);
  try { window.localStorage.setItem(`m1.googleAds.purchase.${key}`, '1'); } catch { /* measurement cannot break checkout */ }
};
export const loadGoogleAdsTracking = () => {
  if (!shopHost() || !window.gtag) return;
  if (!configPromise) configPromise = fetch(`${API_BASE_URL}/google-ads-public/tracking`, { credentials: 'omit', signal: AbortSignal.timeout(10000) })
    .then(response => { if (!response.ok) throw Error('Tracking config unavailable'); return response.json(); })
    .then(config => {
      if (!config.enabled || !/^AW-\d+\/[A-Za-z0-9_-]+$/.test(config.sendTo || '')) return;
      destination = config.sendTo;
      window.gtag('config', destination.split('/')[0]);
      for (const purchase of queued.values()) emit(purchase);
      queued.clear();
    }).catch(() => { configPromise = null; });
  return configPromise;
};
export const __resetGoogleAdsTrackingForTests = () => { configPromise = undefined; destination = ''; queued.clear(); sent.clear(); };
export const trackGoogleAdsPurchase = purchase => {
  if (!shopHost() || !window.gtag) return;
  if (destination) emit(purchase);
  else {
    if (queued.size < 20 && purchase?.transaction_id) queued.set(String(purchase.transaction_id), purchase);
    loadGoogleAdsTracking();
  }
};

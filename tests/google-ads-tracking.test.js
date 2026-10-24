import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseAction, conversionDestination } from '../server/modules/googleAds/googleAdsTracking.js';
import { googleAdsPurchasePayload, trackGoogleAdsPurchase, loadGoogleAdsTracking, __resetGoogleAdsTrackingForTests } from '../src/storefront/lib/googleAdsPurchase.js';

test('purchase action measures variable EGP order values and counts separate orders', () => {
  const action = purchaseAction();
  assert.equal(action.category, 'PURCHASE'); assert.equal(action.type, 'WEBPAGE');
  assert.equal(action.countingType, 'MANY_PER_CLICK'); assert.equal(action.valueSettings.alwaysUseDefaultValue, false);
});
test('tag extraction accepts only a valid Google destination, never arbitrary code', () => {
  assert.equal(conversionDestination([{ eventSnippet: "gtag('event', 'conversion', {'send_to': 'AW-123456/Abc_12-Z'});" }]), 'AW-123456/Abc_12-Z');
  assert.throws(() => conversionDestination([{ eventSnippet: '<script>evil()</script>' }]));
  assert.throws(() => conversionDestination([{ eventSnippet: "{'send_to':'https://evil.example'}" }]));
});
test('purchase payload strips PII and rejects invalid values', () => {
  assert.deepEqual(googleAdsPurchasePayload({ transaction_id: '42', value: 600, currency: 'EGP', email: 'private@example.com', phone: 'private', items: ['private'] }, 'AW-123/aB'), { send_to: 'AW-123/aB', transaction_id: '42', value: 600, currency: 'EGP' });
  for (const value of [0, -1, Infinity, 'invalid']) assert.equal(googleAdsPurchasePayload({ transaction_id: '42', value, currency: 'EGP' }, 'AW-123/aB'), null);
});
test('queued conversion waits for config and is deduplicated across reload guards', async () => {
  const oldFetch = global.fetch; const oldWindow = global.window;
  const events = []; const storage = new Map();
  try {
    __resetGoogleAdsTrackingForTests();
    global.window = { location: { hostname: 'm1store-egy.com' }, gtag: (...args) => events.push(args), localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v) } };
    global.fetch = async () => ({ ok: true, json: async () => ({ enabled: true, sendTo: 'AW-123/aB' }) });
    const order = { transaction_id: '42', value: 600, currency: 'EGP' };
    trackGoogleAdsPurchase(order); trackGoogleAdsPurchase(order); await loadGoogleAdsTracking();
    assert.equal(events.filter(e => e[0] === 'event').length, 1);
    __resetGoogleAdsTrackingForTests();
    trackGoogleAdsPurchase(order); await loadGoogleAdsTracking();
    assert.equal(events.filter(e => e[0] === 'event').length, 1);
    window.location.hostname = 'erp.m1store-egy.com';
    trackGoogleAdsPurchase({ ...order, transaction_id: '43' });
    assert.equal(events.filter(e => e[0] === 'event').length, 1);
  } finally { global.fetch = oldFetch; global.window = oldWindow; __resetGoogleAdsTrackingForTests(); }
});

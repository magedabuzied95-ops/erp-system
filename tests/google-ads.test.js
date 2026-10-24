import test from 'node:test';
import assert from 'node:assert/strict';
import { customerId, micros, campaignUpdate, encrypt, decrypt, googleRequest } from '../server/modules/googleAds/googleAdsApi.js';

test('Google Ads validates account IDs and prevents resource path injection', () => {
  assert.equal(customerId('123-456-7890'), '1234567890');
  for (const value of ['123/4567890', '../campaigns', '', '123']) assert.throws(() => customerId(value));
  assert.throws(() => campaignUpdate('1234567890', '1/../../2', { status: 'PAUSED' }));
});
test('budgets are positive finite account currency amounts converted to micros', () => {
  assert.equal(micros('123.45'), '123450000');
  for (const value of [0, -1, 'NaN', Infinity, '']) assert.throws(() => micros(value));
});
test('campaign updates use an explicit allowlist and sparse masks', () => {
  assert.deepEqual(campaignUpdate('1234567890', '42', { status: 'PAUSED', budget: 999 }), {
    update: { resourceName: 'customers/1234567890/campaigns/42', status: 'PAUSED' }, updateMask: 'status',
  });
  assert.throws(() => campaignUpdate('1234567890', '42', { status: 'REMOVED' }));
  assert.throws(() => campaignUpdate('1234567890', '42', { name: '' }));
  assert.throws(() => campaignUpdate('1234567890', '42', {}));
});
test('refresh tokens are authenticated encrypted and dedicated key is mandatory', () => {
  const original = process.env.GOOGLE_ADS_ENCRYPTION_KEY;
  try {
    process.env.GOOGLE_ADS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
    const envelope = encrypt('private-refresh-token');
    assert.ok(!envelope.includes('private-refresh-token'));
    assert.equal(decrypt(envelope), 'private-refresh-token');
    const parts = envelope.split(':'); parts[3] = Buffer.from('tampered').toString('base64');
    assert.throws(() => decrypt(parts.join(':')));
    delete process.env.GOOGLE_ADS_ENCRYPTION_KEY;
    assert.throws(() => encrypt('token'));
  } finally { if (original === undefined) delete process.env.GOOGLE_ADS_ENCRYPTION_KEY; else process.env.GOOGLE_ADS_ENCRYPTION_KEY = original; }
});
test('provider errors never expose token or provider body', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 403, headers: new Headers({ 'request-id': 'trace-1' }), json: async () => ({ secret: 'private-token' }) });
    await assert.rejects(googleRequest('private-token', 'customers:listAccessibleCustomers'), error => {
      assert.equal(error.requestId, 'trace-1'); assert.ok(!error.message.includes('private-token')); return true;
    });
  } finally { globalThis.fetch = original; }
});

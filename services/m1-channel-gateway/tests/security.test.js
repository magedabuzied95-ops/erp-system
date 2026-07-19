import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptConfiguration, decryptConfiguration } from '../src/security/encryptedConfig.js';
import { signGatewayRequest, verifyGatewayRequest } from '../src/security/hmac.js';
import { redact } from '../src/observability/logger.js';

test('connection configuration is authenticated and encrypted', () => {
  const encrypted = encryptConfiguration({ access_token: 'private', page_id: '42' }, 'test-secret');
  assert.notEqual(encrypted.ciphertext.toString('utf8'), 'private');
  assert.deepEqual(decryptConfiguration(encrypted, 'test-secret'), { access_token: 'private', page_id: '42' });
  assert.throws(() => decryptConfiguration(encrypted, 'wrong-secret'));
});

test('HMAC covers timestamp nonce method path and exact body', () => {
  const input = {
    secret: 'shared-secret', timestamp: Date.now(), nonce: 'nonce-1',
    method: 'POST', path: '/v1/outbound/messages', rawBody: '{"ok":true}',
  };
  const signature = signGatewayRequest(input);
  assert.equal(verifyGatewayRequest({ ...input, signature }).ok, true);
  assert.equal(verifyGatewayRequest({ ...input, signature, rawBody: '{"ok":false}' }).ok, false);
});

test('structured logs redact nested credentials', () => {
  assert.deepEqual(redact({ metadata: { accessToken: 'a', cookie: 'b', safe: 'c' } }), {
    metadata: { accessToken: '[REDACTED]', cookie: '[REDACTED]', safe: 'c' },
  });
});

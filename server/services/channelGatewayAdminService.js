import { createHash, createHmac, randomUUID } from 'node:crypto';

const text = (value = '') => String(value ?? '').trim();
const gatewayUrl = () => text(process.env.CHANNEL_GATEWAY_URL || 'http://channel-gateway:4080').replace(/\/$/, '');
const gatewaySecret = () => text(process.env.CHANNEL_GATEWAY_HMAC_SECRET);
const connectionId = () => text(process.env.INSTAGRAM_CHANNEL_CONNECTION_ID);
const expectedAccount = () => text(process.env.INSTAGRAM_EXPECTED_USERNAME || 'm.one.store.pro').replace(/^@/, '').toLowerCase();
const digest = (body = '') => createHash('sha256').update(Buffer.from(String(body))).digest('hex');

const sign = ({ secret, timestamp, nonce, method, path, rawBody = '' }) => createHmac('sha256', secret)
  .update([timestamp, nonce, method.toUpperCase(), path, digest(rawBody)].join('.'))
  .digest('hex');

async function gatewayRequest(path, { method = 'GET', body = null, timeoutMs = 10_000 } = {}) {
  const secret = gatewaySecret();
  if (!secret) throw Object.assign(new Error('Channel Gateway admin authentication is not configured'), { code: 'GATEWAY_AUTH_NOT_CONFIGURED', status: 503 });
  const rawBody = body == null ? '' : JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const response = await fetch(`${gatewayUrl()}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-m1-timestamp': timestamp,
      'x-m1-nonce': nonce,
      'x-m1-signature': sign({ secret, timestamp, nonce, method, path, rawBody }),
    },
    body: rawBody || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `Channel Gateway returned ${response.status}`), {
    code: payload.error || 'CHANNEL_GATEWAY_ERROR', status: response.status,
  });
  return payload;
}

export async function getInstagramBridgeAdminStatus({ tenantId = null } = {}) {
  const id = connectionId();
  const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : '';
  const [snapshotResult, bridgeResult] = await Promise.allSettled([
    gatewayRequest(`/v1/health/snapshot${query}`),
    id ? gatewayRequest(`/v1/connections/${encodeURIComponent(id)}/bridge-health`) : Promise.reject(Object.assign(new Error('Instagram connection is not configured'), { code: 'CONNECTION_NOT_CONFIGURED' })),
  ]);
  const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null;
  const bridge = bridgeResult.status === 'fulfilled' ? bridgeResult.value : null;
  const currentAccount = text(bridge?.current_connected_account || 'unverified').replace(/^@/, '').toLowerCase();
  const expected = expectedAccount();
  return {
    environment: 'production',
    label: 'TEST ACCOUNT',
    channel: 'instagram',
    expected_test_account: expected,
    current_connected_account: currentAccount,
    test_account_verified: bridge?.test_account_verified === true && currentAccount === expected,
    bridge,
    gateway: snapshot,
    errors: {
      gateway: snapshotResult.status === 'rejected' ? text(snapshotResult.reason?.code || 'GATEWAY_UNAVAILABLE') : null,
      bridge: bridgeResult.status === 'rejected' ? text(bridgeResult.reason?.code || 'BRIDGE_UNAVAILABLE') : null,
    },
  };
}

export async function disableInstagramBridge() {
  const id = connectionId();
  if (!id) throw Object.assign(new Error('Instagram connection is not configured'), { code: 'CONNECTION_NOT_CONFIGURED', status: 409 });
  const bridge = await gatewayRequest(`/v1/connections/${encodeURIComponent(id)}/pause`, { method: 'POST', timeoutMs: 30_000 });
  return { disabled: true, inbound: 'stopped', outbound: 'stopped', recovery: 'stopped', live_watch: 'stopped', bridge };
}

export async function enableInstagramBridge() {
  const id = connectionId();
  if (!id) throw Object.assign(new Error('Instagram connection is not configured'), { code: 'CONNECTION_NOT_CONFIGURED', status: 409 });
  const bridge = await gatewayRequest(`/v1/connections/${encodeURIComponent(id)}/resume`, { method: 'POST', timeoutMs: 180_000 });
  const currentAccount = text(bridge?.current_connected_account).replace(/^@/, '').toLowerCase();
  if (bridge?.test_account_verified !== true || currentAccount !== expectedAccount()) {
    await gatewayRequest(`/v1/connections/${encodeURIComponent(id)}/pause`, { method: 'POST', timeoutMs: 30_000 }).catch(() => {});
    throw Object.assign(new Error('Instagram test account verification failed; bridge remains disabled'), { code: 'TEST_ACCOUNT_VERIFICATION_FAILED', status: 409 });
  }
  return { enabled: true, bridge };
}

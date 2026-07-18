import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const hash = (body = '') => createHash('sha256').update(Buffer.isBuffer(body) ? body : Buffer.from(String(body))).digest('hex');
const payload = ({ timestamp, nonce, method, path, rawBody = '' }) => [timestamp, nonce, String(method).toUpperCase(), path, hash(rawBody)].join('.');
export const signRequest = ({ secret, ...input }) => createHmac('sha256', String(secret)).update(payload(input)).digest('hex');

export function signedHeaders({ secret, method, path, rawBody = '' }) {
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  return {
    'x-m1-timestamp': timestamp,
    'x-m1-nonce': nonce,
    'x-m1-signature': signRequest({ secret, timestamp, nonce, method, path, rawBody }),
  };
}

export function verifyRequest({ secret, signature, maxSkewMs = 300_000, now = Date.now(), ...input }) {
  if (!secret) return { ok: false, reason: 'secret_missing' };
  if (!input.nonce) return { ok: false, reason: 'nonce_missing' };
  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxSkewMs) return { ok: false, reason: 'timestamp_expired' };
  const expected = Buffer.from(signRequest({ secret, ...input }), 'hex');
  const actual = Buffer.from(String(signature || ''), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? { ok: true, reason: 'verified' }
    : { ok: false, reason: 'signature_invalid' };
}

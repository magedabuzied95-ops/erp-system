import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import db from '../database/db.js';

const digest = (body = '') => createHash('sha256').update(Buffer.isBuffer(body) ? body : Buffer.from(String(body))).digest('hex');
const expectedSignature = ({ secret, timestamp, nonce, method, path, rawBody }) => createHmac('sha256', secret).update([timestamp, nonce, method.toUpperCase(), path, digest(rawBody)].join('.')).digest('hex');

export async function channelGatewayAuth(req, res, next) {
  const secret = String(process.env.CHANNEL_GATEWAY_HMAC_SECRET || '');
  if (!secret) return res.status(503).json({ error: 'gateway_auth_not_configured' });
  const timestamp = req.get('x-m1-timestamp'); const nonce = req.get('x-m1-nonce'); const actual = req.get('x-m1-signature') || '';
  if (!nonce || !Number.isFinite(Number(timestamp)) || Math.abs(Date.now() - Number(timestamp)) > 300_000) return res.status(401).json({ error: 'timestamp_or_nonce_invalid' });
  const expected = expectedSignature({ secret, timestamp, nonce, method: req.method, path: req.originalUrl, rawBody: req.rawBody || Buffer.alloc(0) });
  const actualBuffer = Buffer.from(actual, 'hex'); const expectedBuffer = Buffer.from(expected, 'hex');
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return res.status(401).json({ error: 'signature_invalid' });
  try {
    const reserved = await db.query(`INSERT INTO channel_gateway_request_nonces (nonce, request_timestamp, expires_at) VALUES ($1, TO_TIMESTAMP($2::double precision / 1000), NOW() + INTERVAL '5 minutes') ON CONFLICT DO NOTHING RETURNING nonce`, [nonce, Number(timestamp)]);
    if (!reserved.rowCount) return res.status(409).json({ error: 'nonce_replayed' });
    return next();
  } catch (error) { return next(error); }
}

import { verifyGatewayRequest } from './hmac.js';

export function createGatewayAuth({ pool, secret, maxSkewMs = 300_000 }) {
  return async function gatewayAuth(req, res, next) {
    if (!secret) return res.status(503).json({ error: 'gateway_auth_not_configured' });
    const timestamp = req.get('x-m1-timestamp');
    const nonce = req.get('x-m1-nonce');
    const signature = req.get('x-m1-signature');
    const result = verifyGatewayRequest({
      secret,
      signature,
      timestamp,
      nonce,
      method: req.method,
      path: req.originalUrl,
      rawBody: req.rawBody || Buffer.alloc(0),
      maxSkewMs,
    });
    if (!result.ok) return res.status(401).json({ error: result.reason });

    try {
      const reserved = await pool.query(`
        INSERT INTO channel_gateway_request_nonces (nonce, request_timestamp, expires_at)
        VALUES ($1, TO_TIMESTAMP($2::double precision / 1000), NOW() + ($3 * INTERVAL '1 millisecond'))
        ON CONFLICT DO NOTHING RETURNING nonce
      `, [nonce, Number(timestamp), maxSkewMs]);
      if (!reserved.rowCount) return res.status(409).json({ error: 'nonce_replayed' });
      if (Math.random() < 0.01) {
        pool.query('DELETE FROM channel_gateway_request_nonces WHERE expires_at < NOW()').catch(() => {});
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

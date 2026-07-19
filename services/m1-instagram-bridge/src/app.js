import express from 'express';
import { randomUUID } from 'node:crypto';
import { verifyRequest } from './security/hmac.js';

export function createBridgeAuth({ secret, maxSkewMs = 300_000 }) {
  const nonces = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [nonce, expires] of nonces) if (expires < now) nonces.delete(nonce);
    const nonce = req.get('x-m1-nonce');
    const result = verifyRequest({ secret, signature: req.get('x-m1-signature'), timestamp: req.get('x-m1-timestamp'), nonce, method: req.method, path: req.originalUrl, rawBody: req.rawBody || Buffer.alloc(0), now, maxSkewMs });
    if (!result.ok) return res.status(secret ? 401 : 503).json({ error: result.reason });
    if (nonces.has(nonce)) return res.status(409).json({ error: 'nonce_replayed' });
    nonces.set(nonce, now + maxSkewMs);
    return next();
  };
}

export function createApp({ bridge, config, logger = console }) {
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => { req.requestId = req.get('x-request-id') || randomUUID(); res.set('x-request-id', req.requestId); next(); });
  app.use(express.json({ limit: '256kb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer || ''); } }));
  app.get('/health/live', (_req, res) => res.json({ status: 'alive', service: 'm1-instagram-bridge', enabled: config.enabled }));
  app.get('/health/ready', async (_req, res) => {
    const health = await bridge.getHealth(); const ready = !config.enabled || ['healthy', 'degraded', 'paused'].includes(health.status);
    res.status(ready ? 200 : 503).json(health);
  });
  const internal = express.Router(); internal.use(createBridgeAuth({ secret: config.bridgeHmacSecret }));
  internal.get('/health', async (_req, res) => res.json(await bridge.getHealth()));
  internal.post('/sync', async (_req, res, next) => { try { res.json(await bridge.forceRecoverySync()); } catch (error) { next(error); } });
  internal.post('/pause', async (_req, res) => res.json(await bridge.pause()));
  internal.post('/resume', async (_req, res, next) => { try { res.json(await bridge.resume()); } catch (error) { next(error); } });
  internal.post('/restart', async (_req, res, next) => { try { res.json(await bridge.restart()); } catch (error) { next(error); } });
  internal.post('/messages/text', async (req, res, next) => {
    try { res.json(await bridge.sendText(req.body?.external_conversation_id, req.body?.text, req.body?.options || {})); }
    catch (error) { next(error); }
  });
  internal.post('/messages/media', (_req, res) => res.status(409).json({ error: 'unsupported_in_current_phase' }));
  internal.post('/messages/reaction', (_req, res) => res.status(409).json({ error: 'unsupported_in_current_phase' }));
  internal.post('/typing', (_req, res) => res.status(409).json({ error: 'unsupported_in_current_phase' }));
  internal.post('/conversations/:id/read', async (req, res, next) => { try { res.json(await bridge.markAsRead(req.params.id)); } catch (error) { next(error); } });
  app.use('/internal/v1', internal);
  // Express recognizes error middleware by its four-argument signature.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error?.('instagram_bridge.http_error', { request_id: req.requestId, error_code: error.code || 'INTERNAL_ERROR' });
    const status = error.needsManualReview ? 409 : Number(error.status || 500);
    res.status(status).json({ error: error.code || 'internal_error', status: error.needsManualReview ? 'needs_manual_review' : 'failed', request_id: req.requestId });
  });
  return app;
}

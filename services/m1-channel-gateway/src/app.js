import express from 'express';
import { randomUUID } from 'node:crypto';
import { normalizeChannelEnvelope } from './contracts/channelEnvelope.js';
import { rawJsonSaver } from './security/hmac.js';
import { createGatewayAuth } from './security/authMiddleware.js';
import { checkMigrationState } from './db/migrationState.js';

export function createApp({ pool, redis, queue, inboundStore, shadowQueue, health, adapters, config, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.requestId = req.get('x-request-id') || randomUUID();
    res.set('x-request-id', req.requestId);
    next();
  });
  app.use(express.json({ limit: '2mb', verify: rawJsonSaver }));

  app.get('/health/live', (_req, res) => res.json({ status: 'alive', service: 'm1-channel-gateway' }));
  app.get('/health/ready', async (_req, res) => {
    try {
      const migrations = await checkMigrationState(pool);
      if (!migrations.ready) return res.status(503).json({ status: 'not_ready', postgres: 'connected', migrations });
      const redisHealth = await redis.health().catch(() => ({ status: 'degraded' }));
      res.json({ status: 'ready', postgres: 'connected', redis: redisHealth, migrations });
    } catch (error) {
      res.status(503).json({ status: 'not_ready', postgres: 'unavailable', error: error.code || error.message });
    }
  });

  const v1 = express.Router();
  v1.use(createGatewayAuth({ pool, secret: config.hmacSecret, maxSkewMs: config.hmacMaxSkewMs }));

  v1.post('/inbound/messages', async (req, res, next) => {
    try {
      if (config.shadowMode || !config.inboundEnabled) {
        return res.status(409).json({ error: 'shadow_mode_inbound_disabled' });
      }
      const accepted = await inboundStore.accept(req.body);
      res.status(accepted.duplicate ? 200 : 202).json({
        event_id: accepted.event.id,
        duplicate: accepted.duplicate,
        status: accepted.event.status,
      });
    } catch (error) { next(error); }
  });

  v1.post('/outbound/messages', async (req, res, next) => {
    try {
      if (config.shadowMode || !config.outboundEnabled) {
        return res.status(409).json({ error: 'shadow_mode_outbound_disabled' });
      }
      const envelope = normalizeChannelEnvelope({ ...req.body, direction: 'outbound' }, { requireIdempotencyKey: true });
      const queued = await queue.enqueue({
        jobKey: envelope.event_id,
        idempotencyKey: envelope.idempotency_key,
        tenantId: envelope.tenant_id,
        connectionId: envelope.connection_id,
        externalConversationId: envelope.external_conversation_id,
        internalConversationId: envelope.metadata?.internal_conversation_id || null,
        payload: envelope,
      });
      res.status(queued.duplicate ? 200 : 202).json({
        job_key: queued.job.job_key,
        duplicate: queued.duplicate,
        status: queued.job.status,
      });
    } catch (error) { next(error); }
  });

  v1.get('/outbound/jobs/:jobKey', async (req, res, next) => {
    try {
      const job = await queue.getByKey(req.params.jobKey, req.query.tenant_id || null);
      if (!job) return res.status(404).json({ error: 'job_not_found' });
      return res.json({ job });
    } catch (error) { return next(error); }
  });
  v1.post('/outbound/jobs/:jobKey/reconcile', async (req, res, next) => {
    try {
      const job = await queue.reconcile(req.params.jobKey, {
        status: req.body?.status,
        externalMessageId: req.body?.external_message_id || null,
        reason: req.body?.reason || '',
      });
      if (!job) return res.status(404).json({ error: 'reconcilable_job_not_found' });
      return res.json({ job_key: job.job_key, status: job.status });
    } catch (error) { return next(error); }
  });

  v1.get('/queue/metrics', async (req, res, next) => {
    try { res.json({ statuses: await queue.metrics(req.query.tenant_id || null) }); }
    catch (error) { next(error); }
  });
  v1.get('/health/snapshot', async (req, res, next) => {
    try { res.json(await health.snapshot(req.query.tenant_id || null)); }
    catch (error) { next(error); }
  });
  v1.get('/shadow/metrics', async (req, res, next) => {
    try { res.json(await shadowQueue.metrics(req.query.tenant_id || null)); }
    catch (error) { next(error); }
  });
  v1.post('/shadow/events/:eventId/retry', async (req, res, next) => {
    try {
      const event = await shadowQueue.retryDeadLetter(req.params.eventId);
      if (!event) return res.status(404).json({ error: 'dead_letter_event_not_found' });
      return res.json({ event_id: event.event_id, status: event.status });
    } catch (error) { return next(error); }
  });
  v1.get('/connections/:connectionId/bridge-health', async (req, res, next) => {
    try {
      const adapter = adapters.get(req.params.connectionId);
      if (!adapter) return res.status(404).json({ error: 'adapter_not_found' });
      return res.json(await adapter.getHealth());
    } catch (error) { return next(error); }
  });
  for (const [path, method] of [['pause','pause'], ['resume','resume'], ['force-recovery-sync','forceRecoverySync'], ['restart','restart']]) {
    v1.post(`/connections/:connectionId/${path}`, async (req, res, next) => {
      try {
        const adapter = adapters.get(req.params.connectionId);
        if (!adapter || typeof adapter[method] !== 'function') return res.status(404).json({ error: 'operation_unavailable' });
        return res.json(await adapter[method]());
      } catch (error) { return next(error); }
    });
  }
  app.use('/v1', v1);

  // Express identifies an error handler by its four-argument signature.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    logger.error('http.error', {
      request_id: req.requestId,
      error_code: error.code || 'INTERNAL_ERROR',
      message: error.message,
    });
    res.status(Number(error.status || 500)).json({
      error: error.code || 'internal_error',
      message: Number(error.status || 500) < 500 ? error.message : 'Internal server error',
      request_id: req.requestId,
    });
  });
  return app;
}

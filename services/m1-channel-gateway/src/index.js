import 'dotenv/config';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { RedisCoordinator } from './redis/RedisCoordinator.js';
import { PostgresOutboundQueue } from './queue/PostgresOutboundQueue.js';
import { InboundMessageStore } from './messages/InboundMessageStore.js';
import { AdapterRegistry } from './adapters/registry.js';
import { OutboundWorker } from './worker/OutboundWorker.js';
import { createApp } from './app.js';
import logger from './observability/logger.js';
import { HealthSnapshotService } from './observability/HealthSnapshotService.js';
import { BridgeEventStore } from './observability/BridgeEventStore.js';
import { ConnectionHealthMonitor } from './health/ConnectionHealthMonitor.js';
import { PostgresShadowEventQueue } from './shadow/PostgresShadowEventQueue.js';
import { ShadowComparator } from './shadow/ShadowComparator.js';
import { ShadowConsumer } from './shadow/ShadowConsumer.js';
import { InstagramBridgeAdapter } from './adapters/InstagramBridgeAdapter.js';
import { ErpInboundOutboxWorker } from './worker/ErpInboundOutboxWorker.js';
import { ErpOutboundEventConsumer } from './worker/ErpOutboundEventConsumer.js';
import { validateStagingIsolation } from '../../shared/stagingIsolation.js';

validateStagingIsolation(process.env);
const config = loadConfig();
const pool = createPool({ connectionString: config.databaseUrl });
const redis = new RedisCoordinator({ url: config.redisUrl, logger });
const queue = new PostgresOutboundQueue(pool, { staleAfterSeconds: config.staleAfterSeconds });
const adapters = new AdapterRegistry();
const inboundStore = new InboundMessageStore(pool);
const events = new BridgeEventStore(pool);
const worker = new OutboundWorker({ queue, adapters, logger, pollIntervalMs: config.pollIntervalMs });
const shadowQueue = new PostgresShadowEventQueue(pool, { staleAfterSeconds: config.staleAfterSeconds });
const shadowComparator = new ShadowComparator(pool);
const shadowConsumer = new ShadowConsumer({
  queue: shadowQueue, comparator: shadowComparator, logger,
  pollIntervalMs: config.pollIntervalMs,
  processingTimeoutMs: config.shadowProcessingTimeoutMs,
});
const erpInboundWorker = new ErpInboundOutboxWorker({ pool, baseUrl: config.erpBackendUrl, secret: config.erpHmacSecret, logger, pollIntervalMs: config.pollIntervalMs });
const erpOutboundConsumer = new ErpOutboundEventConsumer({ pool, queue, logger, pollIntervalMs: config.pollIntervalMs });
const health = new HealthSnapshotService({
  pool, redis, queue, worker, adapters, shadowQueue, shadowConsumer,
});
const healthMonitor = new ConnectionHealthMonitor({
  pool, adapters, events, logger, intervalMs: config.healthIntervalMs,
});
const instagramAdapterAllowed = config.gatewayEnabled && !config.shadowMode && config.instagramBridgeEnabled
  && (config.instagramBridgeInboundEnabled || config.instagramBridgeOutboundEnabled)
  && Boolean(config.instagramConnectionId && config.instagramBridgeHmacSecret);
if (instagramAdapterAllowed) {
  adapters.register(config.instagramConnectionId, new InstagramBridgeAdapter({
    connectionId: config.instagramConnectionId,
    baseUrl: config.instagramBridgeUrl,
    secret: config.instagramBridgeHmacSecret,
    logger,
  }));
}
const app = createApp({ pool, redis, queue, inboundStore, shadowQueue, health, adapters, config, logger });
const server = createServer(app);

await redis.connect().catch((error) => logger.warn('redis.startup_degraded', { message: error.message }));
const externalWorkerAllowed = config.gatewayEnabled && !config.shadowMode && config.outboundEnabled && config.workerEnabled;
if (externalWorkerAllowed) await worker.start();
const erpInboundWorkerAllowed = config.gatewayEnabled && !config.shadowMode && config.inboundEnabled && config.erpInboundPublishEnabled;
if (erpInboundWorkerAllowed) await erpInboundWorker.start();
const erpOutboundConsumerAllowed = externalWorkerAllowed && config.erpOutboundConsumeEnabled && config.instagramBridgeOutboundEnabled;
if (erpOutboundConsumerAllowed) await erpOutboundConsumer.start();
const shadowConsumerAllowed = config.gatewayEnabled && config.shadowMode && config.compareEnabled;
if (shadowConsumerAllowed) await shadowConsumer.start();
healthMonitor.start();
server.listen(config.port, () => logger.info('gateway.started', {
  port: config.port,
  worker_enabled: config.workerEnabled,
  external_worker_allowed: externalWorkerAllowed,
  shadow_consumer_enabled: shadowConsumerAllowed,
  instagram_adapter_enabled: instagramAdapterAllowed,
  erp_inbound_publisher_enabled: erpInboundWorkerAllowed,
  erp_outbound_consumer_enabled: erpOutboundConsumerAllowed,
  adapters_registered: adapters.entries().length,
}));

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('gateway.shutdown', { signal });
  server.close();
  healthMonitor.stop();
  const timeout = new Promise((resolve) => setTimeout(resolve, config.shutdownTimeoutMs));
  await Promise.race([worker.stop(), timeout]);
  await Promise.race([shadowConsumer.stop(), timeout]);
  await Promise.race([erpInboundWorker.stop(), timeout]);
  await Promise.race([erpOutboundConsumer.stop(), timeout]);
  await redis.disconnect().catch(() => {});
  await pool.end();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => shutdown(signal).finally(() => process.exit(0)));
}

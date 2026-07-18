export class HealthSnapshotService {
  constructor({ pool, redis, queue, worker, adapters, shadowQueue = null, shadowConsumer = null }) {
    this.pool = pool;
    this.redis = redis;
    this.queue = queue;
    this.worker = worker;
    this.adapters = adapters;
    this.shadowQueue = shadowQueue;
    this.shadowConsumer = shadowConsumer;
    this.startedAt = new Date();
  }

  async snapshot(tenantId = null) {
    const values = tenantId == null ? [] : [tenantId];
    const tenantClause = tenantId == null ? '' : 'WHERE tenant_id = $1';
    const [queueStatuses, shadow, activity, connections, redis] = await Promise.all([
      this.queue.metrics(tenantId),
      this.shadowQueue ? this.shadowQueue.metrics(tenantId) : null,
      this.pool.query(`
        SELECT
          (SELECT MAX(received_at) FROM channel_inbound_events ${tenantClause}) AS last_incoming,
          (SELECT MAX(sent_at) FROM outbound_message_jobs ${tenantClause}) AS last_outgoing,
          (SELECT MAX(last_sync_at) FROM channel_connections ${tenantClause}) AS last_sync
      `, values),
      this.pool.query(`
        SELECT id, tenant_id, channel, account_external_id, status, session_status,
          health, last_connected_at, last_sync_at, last_error_code, last_error_at, updated_at
        FROM channel_connections ${tenantClause}
        ORDER BY tenant_id, channel, id
      `, values),
      this.redis.health().catch(() => ({ status: 'degraded' })),
    ]);
    const memory = process.memoryUsage();
    return {
      generated_at: new Date().toISOString(),
      service: {
        uptime_seconds: Math.floor(process.uptime()),
        started_at: this.startedAt.toISOString(),
        worker_status: this.worker.running ? 'running' : 'disabled',
        shadow_consumer_status: this.shadowConsumer?.running ? 'running' : 'disabled',
        registered_adapters: this.adapters.entries().length,
        memory: { rss_bytes: memory.rss, heap_used_bytes: memory.heapUsed },
        cpu: process.cpuUsage(),
      },
      postgres: { status: 'connected', source_of_truth: true },
      redis,
      queue: queueStatuses,
      shadow,
      activity: activity.rows[0],
      connections: connections.rows,
    };
  }
}

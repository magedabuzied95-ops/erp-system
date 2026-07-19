export class ConnectionHealthMonitor {
  constructor({ pool, adapters, events, logger, intervalMs = 60_000 }) {
    this.pool = pool;
    this.adapters = adapters;
    this.events = events;
    this.logger = logger;
    this.intervalMs = Math.max(10_000, intervalMs);
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  #schedule(delay = this.intervalMs) {
    if (!this.running) return;
    this.timer = setTimeout(() => this.checkAll()
      .catch((error) => this.logger.warn('health.monitor_failed', { message: error.message }))
      .finally(() => this.#schedule()), delay);
    this.timer.unref?.();
  }

  async checkAll() {
    for (const [connectionId, adapter] of this.adapters.entries()) {
      try {
        const health = await adapter.getHealth();
        await this.pool.query(`
          UPDATE channel_connections SET status = $2, session_status = $3,
            health = $4::jsonb, last_error_code = NULL, updated_at = NOW()
          WHERE id = $1
        `, [connectionId, health?.status || 'connected', health?.session_status || 'ready', JSON.stringify(health || {})]);
      } catch (error) {
        const connection = await this.pool.query(`
          UPDATE channel_connections SET status = 'degraded', session_status = 'error',
            last_error_code = $2, last_error_at = NOW(), updated_at = NOW()
          WHERE id = $1 RETURNING tenant_id
        `, [connectionId, String(error.code || 'HEALTH_FAILED').slice(0, 120)]);
        const tenantId = connection.rows[0]?.tenant_id;
        if (tenantId) await this.events.record({
          tenantId, connectionId, severity: 'error', eventType: 'health_failed',
          details: { error_code: error.code || 'HEALTH_FAILED', message: error.message },
        });
      }
    }
  }
}

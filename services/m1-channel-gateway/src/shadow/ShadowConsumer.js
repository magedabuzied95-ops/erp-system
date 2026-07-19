import { normalizeErpEvent } from '../contracts/erpEvent.js';

export class ShadowConsumer {
  constructor({ queue, comparator, logger, pollIntervalMs = 750, processingTimeoutMs = 15_000 }) {
    this.queue = queue;
    this.comparator = comparator;
    this.logger = logger;
    this.pollIntervalMs = Math.max(100, pollIntervalMs);
    this.processingTimeoutMs = Math.max(1_000, processingTimeoutMs);
    this.running = false;
    this.timer = null;
    this.active = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const recovered = await this.queue.recoverStale();
    this.logger.info('shadow.started', { recovered });
    this.#schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.active?.catch(() => {});
  }

  #schedule(delay = this.pollIntervalMs) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.active = this.#tick().finally(() => {
        this.active = null;
        this.#schedule();
      });
    }, delay);
    this.timer.unref?.();
  }

  async #tick() {
    const eventRow = await this.queue.claimNext();
    if (!eventRow) return;
    const startedAt = Date.now();
    try {
      const event = normalizeErpEvent(eventRow);
      let timeoutId;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(Object.assign(new Error('Shadow event processing timed out'), {
          code: 'SHADOW_PROCESSING_TIMEOUT',
        })), this.processingTimeoutMs);
        timeoutId.unref?.();
      });
      let comparison;
      try {
        comparison = await Promise.race([this.comparator.compare(event), timeout]);
      } finally {
        clearTimeout(timeoutId);
      }
      const result = await this.queue.complete(eventRow, comparison, startedAt);
      this.logger.info('shadow.processed', {
        event_id: event.event_id, event_type: event.event_type,
        correlation_id: event.correlation_id, tenant_id: event.tenant_id,
        aggregate_id: event.aggregate_id, attempt: eventRow.attempts,
        duration_ms: result.durationMs, result: comparison.status,
      });
    } catch (error) {
      const failed = await this.queue.fail(eventRow, error, startedAt);
      this.logger.warn('shadow.failed', {
        event_id: eventRow.event_id, event_type: eventRow.event_type,
        correlation_id: eventRow.correlation_id, tenant_id: eventRow.tenant_id,
        aggregate_id: eventRow.aggregate_id, attempt: eventRow.attempts,
        duration_ms: failed.durationMs, result: failed.status, error_code: error.code,
      });
    }
  }
}

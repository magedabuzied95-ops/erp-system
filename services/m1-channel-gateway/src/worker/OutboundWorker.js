export class OutboundWorker {
  constructor({ queue, adapters, logger, pollIntervalMs = 750 }) {
    this.queue = queue;
    this.adapters = adapters;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.running = false;
    this.timer = null;
    this.active = null;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const recovery = await this.queue.recoverStale();
    this.logger.info('worker.started', { recovery });
    this.#schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.active?.catch(() => {});
    this.logger.info('worker.stopped');
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
    const job = await this.queue.claimNext();
    if (!job) return;
    const adapter = this.adapters.get(job.connection_id);
    if (!adapter) {
      await this.queue.fail(job.id, { code: 'ADAPTER_UNAVAILABLE', message: 'No active adapter for connection' });
      return;
    }
    try {
      const payload = job.payload || {};
      const result = payload.attachments?.length
        ? await adapter.sendMedia(job.external_conversation_id, payload)
        : await adapter.sendText(job.external_conversation_id, payload.text, payload);
      await this.queue.complete(job.id, {
        providerMessageId: result?.external_message_id || result?.messageId || null,
        confirmed: Boolean(result?.confirmed),
      });
      this.logger.info('outbound.sent', { job_key: job.job_key, connection_id: job.connection_id });
    } catch (error) {
      const failed = await this.queue.fail(job.id, error);
      this.logger.warn('outbound.failed', {
        job_key: job.job_key,
        status: failed.status,
        attempts: failed.attempts,
        error_code: error.code || 'SEND_FAILED',
      });
    }
  }
}

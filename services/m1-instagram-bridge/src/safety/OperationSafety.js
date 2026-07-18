export class OperationSafety {
  constructor({ maxPerMinute = 12, delayMinMs = 350, delayMaxMs = 900, failureThreshold = 3 } = {}) {
    this.maxPerMinute = maxPerMinute; this.delayMinMs = delayMinMs; this.delayMaxMs = Math.max(delayMinMs, delayMaxMs);
    this.failureThreshold = failureThreshold; this.opened = []; this.failures = 0; this.circuitOpen = false;
  }
  async beforeConversationOpen(now = Date.now()) {
    this.opened = this.opened.filter((at) => now - at < 60_000);
    if (this.opened.length >= this.maxPerMinute) throw Object.assign(new Error('Conversation open rate limited'), { code: 'RATE_LIMITED' });
    this.opened.push(now); await this.delay();
  }
  async delay() {
    const ms = this.delayMinMs + Math.floor(Math.random() * (this.delayMaxMs - this.delayMinMs + 1));
    if (ms) await new Promise((resolve) => setTimeout(resolve, ms));
  }
  success() { this.failures = 0; this.circuitOpen = false; }
  failure() { this.failures += 1; if (this.failures >= this.failureThreshold) this.circuitOpen = true; }
  assertSendAllowed() { if (this.circuitOpen) throw Object.assign(new Error('Send circuit breaker is open'), { code: 'CIRCUIT_OPEN' }); }
}

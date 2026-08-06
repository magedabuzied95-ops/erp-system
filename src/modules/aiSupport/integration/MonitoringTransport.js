const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
import { runtimeConfigService } from "./RuntimeConfigService.js";

export class MonitoringTransport {
  #queue = [];
  #timer = null;

  constructor({ endpoint = "", batchSize = 20, flushInterval = 2000, retries = 3, fetcher = globalThis.fetch, sentry = globalThis.Sentry } = {}) {
    this.endpoint = endpoint;
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
    this.retries = retries;
    this.fetcher = fetcher?.bind(globalThis);
    this.sentry = sentry;
  }

  send(event) {
    this.#queue.push(Object.freeze({ ...event }));
    if (this.#queue.length >= this.batchSize) return this.flush();
    if (!this.#timer) this.#timer = globalThis.setTimeout(() => void this.flush(), this.flushInterval);
    return Promise.resolve(true);
  }

  configure({ endpoint, sentry } = {}) {
    if (typeof endpoint === "string") this.endpoint = endpoint;
    if (sentry) this.sentry = sentry;
  }

  async flush() {
    if (this.#timer) globalThis.clearTimeout(this.#timer);
    this.#timer = null;
    const events = this.#queue.splice(0, this.batchSize);
    if (!events.length) return true;
    if (this.sentry?.captureEvent) events.forEach((event) => this.sentry.captureEvent({ message: event.event, level: event.level || "info", extra: event }));
    if (!this.endpoint || !this.fetcher) return Boolean(this.sentry?.captureEvent);
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetcher(this.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }), keepalive: true });
        if (!response.ok) throw new Error(`Monitoring delivery failed: ${response.status}`);
        return true;
      } catch {
        if (attempt === this.retries) { this.#queue.unshift(...events); return false; }
        await sleep(250 * (2 ** attempt));
      }
    }
    return false;
  }

  dispose() { if (this.#timer) globalThis.clearTimeout(this.#timer); this.#timer = null; }
}

export const monitoringTransport = new MonitoringTransport({ endpoint: import.meta.env?.VITE_MONITORING_ENDPOINT || "" });
const applyMonitoringConfig = (config = {}) => {
  monitoringTransport.configure({ endpoint: config.monitoring?.endpoint || import.meta.env?.VITE_MONITORING_ENDPOINT || "" });
};
applyMonitoringConfig(runtimeConfigService.getSnapshot());
runtimeConfigService.subscribe(applyMonitoringConfig);

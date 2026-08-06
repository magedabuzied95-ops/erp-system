const CACHE_KEY = "m1:runtime-config:v1";
const CURRENT_VERSION = 1;

const validConfig = (value) => value && typeof value === "object" && !Array.isArray(value) && Number(value.version || CURRENT_VERSION) === CURRENT_VERSION;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class RuntimeConfigService {
  #config = Object.freeze({ version: CURRENT_VERSION });
  #etag = "";
  #listeners = new Set();
  #timer = null;
  #controller = null;

  constructor({ url = "/runtime-config.json", pollInterval = 5000, retries = 3, fetcher = globalThis.fetch } = {}) {
    this.url = url;
    this.pollInterval = pollInterval;
    this.retries = retries;
    this.fetcher = fetcher?.bind(globalThis);
    this.#restore();
  }

  #restore() {
    try {
      const cached = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) || "null");
      if (validConfig(cached?.config)) { this.#config = Object.freeze(cached.config); this.#etag = String(cached.etag || ""); }
    } catch { /* Invalid or unavailable offline cache. */ }
  }

  #commit(config, etag = "") {
    if (!validConfig(config)) throw new Error("Invalid runtime configuration");
    const next = Object.freeze({ ...config, version: CURRENT_VERSION });
    const changed = JSON.stringify(next) !== JSON.stringify(this.#config);
    this.#config = next;
    this.#etag = etag || this.#etag;
    try { globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ config: next, etag: this.#etag, cachedAt: Date.now() })); } catch { /* Storage is optional. */ }
    if (changed) this.#listeners.forEach((listener) => listener(next));
    return next;
  }

  async refresh() {
    if (!this.fetcher) return this.#config;
    this.#controller?.abort();
    this.#controller = new AbortController();
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetcher(this.url, { cache: "no-store", headers: this.#etag ? { "If-None-Match": this.#etag } : {}, signal: this.#controller.signal });
        if (response.status === 304) return this.#config;
        if (!response.ok) throw new Error(`Runtime config request failed: ${response.status}`);
        return this.#commit(await response.json(), response.headers.get("etag") || "");
      } catch (error) {
        if (error?.name === "AbortError") return this.#config;
        if (attempt === this.retries) return this.#config;
        await delay(250 * (2 ** attempt));
      }
    }
    return this.#config;
  }

  start() { if (this.#timer) return; void this.refresh(); this.#timer = globalThis.setInterval(() => void this.refresh(), this.pollInterval); }
  stop() { if (this.#timer) globalThis.clearInterval(this.#timer); this.#timer = null; this.#controller?.abort(); }
  getSnapshot = () => this.#config;
  subscribe = (listener) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
}

export const runtimeConfigService = new RuntimeConfigService();

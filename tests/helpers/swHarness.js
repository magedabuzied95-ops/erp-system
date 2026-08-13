import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * Executes the real public/pos-sw.js inside a sandboxed ServiceWorkerGlobalScope
 * so its lifecycle can be driven deterministically: install -> activate -> fetch,
 * across two different builds, with a fake origin that reproduces the deployed
 * routing (including the SPA catch-all that answers missing assets with HTML).
 *
 * This is a behavioural harness, not a source-text assertion: the point is to be
 * able to FAIL before the fix.
 */

const HTML_SHELL = (buildId, chunks) =>
  `<!doctype html><html><head>${chunks
    .map((c) => `<script type="module" crossorigin src="${c}"></script>`)
    .join("")}</head><body data-build="${buildId}"><div id="root"></div></body></html>`;

/**
 * A deployment.
 *
 * `chunks` are referenced by the shell and therefore loaded at boot.
 * `lazyChunks` belong to the same build's module graph but are only imported
 * when the operator reaches that screen (a modal, a drawer, the shift report).
 * That distinction is the whole incident: those are the URLs a client can first
 * request AFTER the build they belong to has already been replaced.
 */
export const createBuild = (buildId, { extraFiles = {} } = {}) => {
  const chunks = [`/assets/app-${buildId}.js`, `/assets/POSPro-${buildId}.js`];
  const lazyChunks = [`/assets/RecentOps-${buildId}.js`, `/assets/ShiftReport-${buildId}.js`];
  const files = new Map();
  for (const c of [...chunks, ...lazyChunks]) {
    files.set(c, { body: `/*${buildId}*/export default ${JSON.stringify(buildId)};`, type: "application/javascript" });
  }
  const shell = HTML_SHELL(buildId, chunks);
  files.set("/index.html", { body: shell, type: "text/html" });
  for (const [k, v] of Object.entries(extraFiles)) files.set(k, v);
  return { buildId, chunks, lazyChunks, files, shell };
};

/**
 * Origin server. `assetFallback` selects the behaviour under test:
 *   "spa"  -> missing /assets/* answered with index.html (the deployed bug)
 *   "404"  -> missing /assets/* answered with a real 404 (the fixed contract)
 */
export const createServer = (build, { assetFallback = "spa", offline = false } = {}) => {
  const server = {
    build,
    assetFallback,
    offline,
    requests: [],
    deploy(nextBuild) {
      this.build = nextBuild;
    },
    handle(url) {
      const { pathname } = new URL(url, "https://erp.test");
      this.requests.push(pathname);
      if (this.offline) throw new TypeError("Failed to fetch");

      const file = this.build.files.get(pathname);
      if (file) {
        return new Response(file.body, {
          status: 200,
          headers: {
            "Content-Type": file.type,
            "Cache-Control": pathname.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-store",
          },
        });
      }

      if (pathname.startsWith("/assets/")) {
        if (this.assetFallback === "404") {
          return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
        }
        // The deployed behaviour: SPA catch-all wins, and the /assets/(.*)
        // header rule stamps a one-year immutable lifetime onto HTML.
        return new Response(this.build.shell, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=31536000, immutable",
          },
        });
      }

      // Every other path is an SPA route.
      return new Response(this.build.shell, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    },
  };
  return server;
};

class FakeCache {
  constructor() {
    this.entries = new Map();
  }
  #key(req) {
    return typeof req === "string" ? new URL(req, "https://erp.test").pathname : new URL(req.url).pathname;
  }
  async put(req, res) {
    this.entries.set(this.#key(req), res);
  }
  async match(req) {
    return this.entries.get(this.#key(req));
  }
  async delete(req) {
    return this.entries.delete(this.#key(req));
  }
  async keys() {
    return [...this.entries.keys()];
  }
}

class FakeCacheStorage {
  constructor() {
    this.caches = new Map();
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache());
    return this.caches.get(name);
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name) {
    return this.caches.delete(name);
  }
  async match(req) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

export const loadServiceWorker = (server, { swPath } = {}) => {
  const file = swPath || path.join(process.cwd(), "public", "pos-sw.js");
  const source = fs.readFileSync(file, "utf8");

  const listeners = new Map();
  const cacheStorage = new FakeCacheStorage();
  const state = { skipWaitingCalled: 0, claimCalled: 0 };

  const self = {
    location: { href: "https://erp.test/pos-sw.js?v=10", origin: "https://erp.test" },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    skipWaiting: async () => {
      state.skipWaitingCalled += 1;
    },
    clients: {
      claim: async () => {
        state.claimCalled += 1;
      },
    },
    registration: { scope: "https://erp.test/pos" },
  };

  const sandbox = {
    self,
    caches: cacheStorage,
    fetch: async (input) => server.handle(typeof input === "string" ? input : input.url),
    Response,
    Request,
    Headers,
    URL,
    console,
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "pos-sw.js" });

  const dispatch = async (type, event) => {
    const fns = listeners.get(type) || [];
    const waits = [];
    const evt = {
      ...event,
      waitUntil: (p) => waits.push(p),
      respondWith: (p) => {
        evt._response = p;
      },
    };
    for (const fn of fns) fn(evt);
    await Promise.all(waits);
    return evt;
  };

  return {
    cacheStorage,
    state,
    listeners,
    install: () => dispatch("install", {}),
    activate: () => dispatch("activate", {}),
    /** Returns the Response the SW produced, or null when it passed through. */
    fetch: async (url, { mode = "no-cors" } = {}) => {
      const request = new Request(new URL(url, "https://erp.test").toString());
      Object.defineProperty(request, "mode", { value: mode, configurable: true });
      const evt = await dispatch("fetch", { request });
      if (!evt._response) return null;
      return evt._response;
    },
  };
};

/** Reads every cached entry whose key looks like a script but holds HTML. */
export const findPoisonedAssetEntries = async (cacheStorage) => {
  const poisoned = [];
  for (const [name, cache] of cacheStorage.caches.entries()) {
    for (const [key, res] of cache.entries.entries()) {
      if (!/\.(js|mjs|css)$/i.test(key)) continue;
      const type = res.headers.get("content-type") || "";
      if (type.includes("text/html")) poisoned.push({ cache: name, key, type });
    }
  }
  return poisoned;
};

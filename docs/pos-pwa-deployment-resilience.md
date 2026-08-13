# POS PWA — deployment resilience

Why a frontend deploy used to be able to leave POS on a blank screen, what
changed, and what to check if it ever recurs.

## Symptom

After a deployment, POS booted to a white screen. Console:

```
Failed to load module script: Expected a JavaScript-or-Wasm module script but
the server responded with a MIME type of "text/html".
```

React never mounted. Unregistering the service worker and clearing caches by
hand recovered that browser. It was observed three times.

## Root causes — there were two, and they compounded

### 1. Hosting: a missing asset was answered with the app shell, marked immutable

Measured on Production, before the fix:

```
GET /assets/<purged-or-missing>.js
  HTTP 200
  Content-Type:  text/html; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  X-Vercel-Cache: HIT
```

Two separate mistakes produced that response:

- `vercel.json` ended with a catch-all `"/(.*)" -> "/index.html"`. The
  `"/assets/(.*)" -> "/assets/$1"` rule above it looks protective but is a
  no-op: existing files are served from the filesystem before rewrites are
  consulted, and a rewrite whose destination also does not exist falls through
  to the next rule. So every missing chunk reached the catch-all.
- The `headers` rule for `/assets/(.*)` matches the **request path**, not the
  file that ends up being served. The HTML fallback therefore inherited the
  one-year `immutable` asset lifetime.

The consequence is the important part: any client that ever requested a missing
chunk cached **HTML under a `.js` URL for a year, marked immutable**, so it
never revalidated. That lives in the browser HTTP cache and at the CDN edge —
unregistering a service worker does not clear it.

### 2. Service worker: it stored that HTML as if it were a module

`public/pos-sw.js` serves `/assets/*` **cache-first** and cached whatever the
network returned as long as `response.ok` was true. A `200 text/html` fallback
satisfied that, so the worker wrote HTML into `pos-shell-v10-runtime` under a
`.js` key — and then served it from cache forever.

The realistic trigger is a **lazily imported** chunk: the cashier opens POS
(entry chunks get cached), a deploy replaces the build, and the first time they
open a drawer or modal the client requests a chunk from the *old* graph that it
never cached and that no longer exists.

### 3. Why nothing recovered

`src/shared/utils/chunkLoadRecovery.js` already handles chunk failures well —
but it is imported by `main.jsx`, so it ships **inside the entry bundle**. When
the failing asset *is* the entry bundle, that code never runs. Recovery existed
for every case except the one that was happening.

## What changed

| Area | Before | After |
| --- | --- | --- |
| `vercel.json` | catch-all `"/(.*)"`; no-op `/assets/` self-rewrite | catch-all `"/((?!assets/).*)"`; self-rewrite removed. A missing hashed asset now 404s |
| `public/pos-sw.js` | cached any `ok` response under an asset key; served it cache-first | `isUsableAssetResponse()` refuses HTML for `.js`/`.css` on both write and read; a poisoned entry is evicted; an HTML-for-script response is converted to a clean 404 |
| cache version | `pos-shell-v10` | `pos-shell-v11` — `activate` deletes non-current `pos-shell-*` caches, which is what heals already-poisoned clients |
| `index.html` | recovery only inside the entry bundle | inline boot-level recovery that survives a missing entry chunk; shares the `erp.chunk-reload-attempted` guard |
| POS update | `controllerchange` → immediate `location.reload()` | reload deferred while a sale is open |

### In-progress sale safety

`writePosSession` persists the cart, invoice number, payment mode, amounts,
discounts, service fee and salesperson. It does **not** persist the customer —
`omitCustomerState` strips `CUSTOMER_STATE_KEYS` deliberately. So an automatic
mid-sale reload silently dropped a customer the cashier had already selected.

The update now waits: `saleInProgressRef` is true whenever the cart is non-empty
or a customer is selected, and the pending reload is retried every 15s until the
till is idle. Nothing is lost by waiting — the running build keeps working.

## Cache policy, stated

- **Navigation HTML** — network-first, cached copy only as an offline fallback.
  Unchanged; it was already correct.
- **Hashed assets** — cache-first (they are immutable by identity), but only
  responses that are `ok` *and* correctly typed are stored.
- **Cleanup** — on `activate`, every `pos-shell-*` cache that is not the current
  shell/runtime pair is deleted. Bumping `VERSION` is therefore the eviction
  mechanism, not a cosmetic change.
- **Never cached** — `/api/*` and anything containing `/orders`, `/checkout`,
  `/payments`, `/auth`, `/stock`. Unchanged.

## Offline behaviour is preserved

The worker still precaches the POS shell and serves it when the network is
unreachable, and still serves cached hashed assets offline. IndexedDB — catalog
cache, offline order drafts, active-shift cache — is not touched by any of this;
the service worker never handled those paths.

## Operational note for future deployments

Three version numbers must move together, and a test enforces it:

- `VERSION` in `public/pos-sw.js`
- `POS_SERVICE_WORKER_VERSION` in `src/modules/pos/pages/POSPro.jsx`
- `/pos-sw.js?v=N` in `index.html`

The `?v=` is what makes a browser fetch the new script; the cache name is what
`activate` cleans up. If they drift, a poisoned cache survives the release meant
to evict it.

## If it recurs

Run this in the console of the affected tab — it is defined in the HTML document,
so it still answers on a page that failed to boot:

```js
await window.__m1Diagnostics()
// { build, entry, rootMounted, recoveryGuard, controller, serviceWorkers, caches }
```

Then check the origin directly:

```bash
curl -sD- -o /dev/null https://erp.m1store-egy.com/assets/does-not-exist-probe.js
# expected: 404. A 200 with Content-Type: text/html means the routing
# regression is back.
```

## Tests

- `tests/deployment-asset-fallback.test.js` — models the platform's routing and
  asserts a missing hashed asset never resolves to the shell, that SPA deep
  links still do, and that HTML is never given an immutable lifetime.
- `tests/pos-sw-deployment-transition.test.js` — executes the real
  `public/pos-sw.js` in a sandboxed worker scope and drives it across a Build A
  → Build B transition, on both a fixed origin and a legacy one.
- `tests/posServiceWorker.test.js` — version-alignment and sale-safety guards.

Both behavioural suites fail against the pre-fix code, which is what makes them
worth keeping.

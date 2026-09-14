// Storefront audit, group 8: robustness, mobile and misc. Behavioural where the code can run in
// node (pure helpers, server services against a fake db, the index.html boot script in a vm, the
// build minifier on the CSS fallbacks); source assertions for what only exists inside JSX.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

// Checkouts may carry CRLF; the assertions are written against LF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const require = createRequire(import.meta.url);

const db = (await import("../server/database/db.js")).default;
const originalQuery = db.query;
after(() => {
  db.query = originalQuery;
  // The pool is never connected by these tests; ending it lets node exit.
  db.end?.().catch?.(() => {});
});

/* ------------------------------------------------------------------ #62 dvh sheet fallbacks */

const SHEETS = [
  ["src/storefront/components/productQuickView.css", "body.storefront-shell .sfq__panel", "max-height: 92vh"],
  ["src/storefront/components/productQuickView.css", "body.storefront-shell .sfq__media", "height: min(40vh, 22rem)"],
  ["src/storefront/components/productQuickView.css", "body.storefront-shell .sfq__panel", "max-height: min(90vh, 44rem)"],
  ["src/storefront/catalog-skin.css", "body.storefront-shell .sfx-sheet", "max-height: 92vh"],
  ["src/storefront/components/sizeGuideSheet.css", "body.storefront-shell .sfg__panel", "max-height: 92vh"],
  ["src/storefront/site-skin.css", ":is(body.storefront-shell, .sfx-scope) .sfx-drawer--bottom", "max-height: 92vh"],
  ["src/storefront/checkout/checkout.css", ".sfc-sheet", "max-height: 80vh"],
];

const supportsBlocks = (css) => {
  const blocks = [];
  let index = css.indexOf("@supports not (height: 1dvh)");
  while (index !== -1) {
    const open = css.indexOf("{", index);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") { depth -= 1; if (depth === 0) break; }
    }
    blocks.push(css.slice(open, end + 1));
    index = css.indexOf("@supports not (height: 1dvh)", end);
  }
  return blocks;
};

test("#62 every dvh-only bottom sheet has a vh height behind @supports not (height: 1dvh)", () => {
  for (const [file, selector, declaration] of SHEETS) {
    const blocks = supportsBlocks(read(file));
    const hit = blocks.some((block) => block.includes(`${selector} {`) && block.includes(`${declaration};`));
    assert.ok(hit, `${file}: ${selector} needs "${declaration}" behind @supports`);
  }
});

test("#62 the build minifier keeps the @supports fallback but folds a plain vh line away", () => {
  const { transform } = require("lightningcss");
  // Vite 8 minifies with lightningcss; its default targets support dvh.
  const targets = { chrome: 111 << 16, safari: (16 << 16) | (4 << 8) };
  const run = (code) => transform({ filename: "x.css", code: Buffer.from(code), minify: true, targets }).code.toString();
  assert.doesNotMatch(run(".a{max-height:92vh;max-height:92dvh}"), /92vh/, "a plain fallback does not survive, which is why @supports is used");
  const css = read("src/storefront/components/sizeGuideSheet.css");
  assert.match(run(css), /@supports not \(height:1dvh\)\{[^}]*\.sfg__panel\{max-height:92vh\}/);
});

/* ------------------------------------------------------------------ #63 sticky header on old Safari */

test("#63 body and #root clip without a hidden fallback; html keeps the horizontal guard", () => {
  const css = read("src/index.css");
  const rootRule = css.match(/\*\/\n  body,\n  #root \{([^}]*)\}/);
  assert.ok(rootRule, "the body, #root rule is still there");
  assert.match(rootRule[1], /overflow-x: clip;/);
  assert.doesNotMatch(rootRule[1], /overflow-x: hidden/);
  const bodyRule = css.match(/\n  body \{\n    margin: 0;([^}]*)\}/);
  assert.ok(bodyRule);
  assert.match(bodyRule[1], /overflow-x: clip;/);
  assert.doesNotMatch(bodyRule[1], /overflow-x: hidden/);
  assert.match(css, /\n  html \{\n    overflow-x: hidden;/);
});

/* ------------------------------------------------------------------ #79 offline chunk failure */

const boundarySource = () => {
  const source = read("src/storefront/Storefront.jsx");
  const start = source.indexOf("class StorefrontErrorBoundary extends Component");
  return source.slice(start, source.indexOf("function StorefrontWithBoundary", start));
};

test("#79 a chunk failure that cannot reload leaves the skeleton for a no-connection card", () => {
  const boundary = boundarySource();
  assert.match(boundary, /Promise\.resolve\(recoverFromChunkLoadError\(error\)\)/);
  assert.match(boundary, /if \(reloading \|\| this\.unmounted \|\| isChunkRecoveryInFlight\(\)\) return;/);
  assert.match(boundary, /this\.setState\(\{ recovering: false, offline: isChunkRecoveryBlockedOffline\(\) \}\)/);
  assert.match(boundary, /if \(this\.state\.offline\) \{/);
  assert.match(boundary, /sfText\("storefront\.errors\.offlineTitle"\)/);
  assert.match(boundary, /onClick=\{\(\) => window\.location\.reload\(\)\}/);
  assert.match(boundary, /window\.addEventListener\("online", this\.handleOnline\)/);
  assert.match(boundary, /window\.removeEventListener\("online", this\.handleOnline\)/);
  assert.match(boundary, /if \(this\.state\.offline\) window\.location\.reload\(\);/);
});

/* ------------------------------------------------------------------ #80 not-found page */

test("#80 the shop host has a catch-all route and Storefront shows a not-found page off the home path", () => {
  const app = read("src/App.jsx");
  const block = app.slice(app.indexOf("{enableStorefrontRootRoutes ? ("), app.indexOf("{enableErpAppRoutes ? ("));
  assert.match(block, /<Route path="\*" element=\{<Suspense fallback=\{<RouteSkeleton \/>\}><Storefront \/><\/Suspense>\} \/>/);
  // The ERP block keeps its own catch-all.
  assert.match(app.slice(app.indexOf("{enableErpAppRoutes ? (")), /path="\*"/);

  const storefront = read("src/storefront/Storefront.jsx");
  assert.match(storefront, /const LazyStorefrontNotFoundPage = lazy\(\(\) => importWithChunkRetry\(\(\) => import\("\.\/pages\/StorefrontNotFoundPage\.jsx"\)\)\);/);
  const fallback = storefront.slice(storefront.indexOf("currentStorefrontPath === ROOT_PATHS.returns"), storefront.indexOf("<PremiumHomePage", storefront.indexOf("currentStorefrontPath === ROOT_PATHS.returns")));
  assert.match(fallback, /if \(!isStorefrontHomePath\(currentStorefrontPath\)\) \{\s*return <LazyStorefrontNotFoundPage/);
});

test("#80 the not-found page speaks through sfText keys present in both locales, noindex, no Arabic literals", () => {
  const page = read("src/storefront/pages/StorefrontNotFoundPage.jsx");
  assert.doesNotMatch(page, /[؀-ۿ]/);
  assert.match(page, /import PolicyLayout, \{ PolicyHelp \} from "\.\/policy\/PolicyLayout"/);
  assert.match(page, /robots\.content = "noindex, follow"/);
  const keys = [...page.matchAll(/sfText\("([^"]+)"\)/g)].map((match) => match[1]);
  keys.push("storefront.errors.offlineTitle", "storefront.errors.offlineText", "storefront.common.retry");
  for (const locale of ["ar", "en"]) {
    const dictionary = JSON.parse(read(`src/locales/${locale}/storefront.json`));
    for (const key of keys) {
      const value = key.replace(/^storefront\./, "").split(".").reduce((node, part) => node?.[part], dictionary);
      assert.equal(typeof value, "string", `${locale}: ${key}`);
      assert.ok(value.trim(), `${locale}: ${key} is empty`);
    }
  }
});

/* ------------------------------------------------------------------ #81 confirmation links */

test("#81 the pages App renders without Storefront release the boot loader on mount", () => {
  for (const [file, name] of [
    ["src/storefront/pages/OrderConfirmationActionPage.jsx", "OrderConfirmationActionPage"],
    ["src/storefront/pages/CustomerAddressPage.jsx", "CustomerAddressPage"],
  ]) {
    const source = read(file);
    assert.match(source, /import \{ releaseBootLoader \} from "\.\.\/lib\/bootLoader";/);
    const body = source.slice(source.indexOf(`export function ${name}() {`), source.indexOf("return (", source.indexOf(`export function ${name}() {`)));
    assert.match(body, /useEffect\(\(\) => \{\s*releaseBootLoader\(\);\s*\}, \[\]\);/, file);
  }
});

/* ------------------------------------------------------------------ #82 missing product link */

test("#82 (already fixed) a missing product serves the SPA shell with noindex and 404; a failure serves it plain", async () => {
  const { createStorefrontProductSeoPageHandler } = await import("../server/services/storefrontProductSeoPageService.js");
  const shell = "<html><head><title>M1</title></head><body><div id=\"root\"></div></body></html>";
  const run = async (loaded) => {
    const res = { headers: {}, statusCode: 200, body: "", headersSent: false,
      set(key, value) { this.headers[key] = value; return this; },
      status(code) { this.statusCode = code; return this; },
      send(body) { this.body = body; return this; } };
    await createStorefrontProductSeoPageHandler({ loadProduct: async () => loaded, loadShell: async () => shell })({ params: { identifier: "gone" }, query: {} }, res, (error) => { throw error; });
    return res;
  };
  const missing = await run({ status: 404, product: null });
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body, /<div id="root">/);
  assert.match(missing.body, /noindex/);
  const failing = await run({ status: 503, product: null });
  assert.equal(failing.statusCode, 200);
  assert.match(failing.body, /<div id="root">/);
  assert.doesNotMatch(failing.body, /noindex/);
});

/* ------------------------------------------------------------------ #99 viewport-fit=cover */

const bootScript = () => {
  const html = read("index.html");
  const marker = html.indexOf("STOREFRONT BOOT LOADER: decide before first paint");
  const start = html.lastIndexOf("<script>", marker) + "<script>".length;
  return html.slice(start, html.indexOf("</script>", marker));
};

const runBoot = ({ hostname, pathname }) => {
  const meta = { content: "width=device-width, initial-scale=1", getAttribute() { return this.content; }, setAttribute(_name, value) { this.content = value; } };
  const attributes = {};
  const context = {
    window: { location: { hostname, pathname } },
    document: {
      documentElement: { setAttribute: (name, value) => { attributes[name] = value; } },
      querySelector: (selector) => (selector === 'meta[name="viewport"]' ? meta : null),
    },
    String,
  };
  vm.runInNewContext(bootScript(), context);
  return { viewport: meta.content, loader: "data-m1-boot-loader" in attributes };
};

test("#99 storefront pages opt into viewport-fit=cover; the ERP host and non-shop paths keep the plain viewport", () => {
  assert.match(read("index.html"), /<meta name="viewport" content="width=device-width, initial-scale=1" \/>/, "the shared static meta stays plain");
  const shop = runBoot({ hostname: "m1store-egy.com", pathname: "/product/12" });
  assert.equal(shop.loader, true);
  assert.equal(shop.viewport, "width=device-width, initial-scale=1, viewport-fit=cover");
  const erp = runBoot({ hostname: "erp.m1store-egy.com", pathname: "/products" });
  assert.equal(erp.viewport, "width=device-width, initial-scale=1");
  const portal = runBoot({ hostname: "m1store-egy.com", pathname: "/manager-portal/abc" });
  assert.equal(portal.viewport, "width=device-width, initial-scale=1");

  const skin = read("src/storefront/site-skin.css");
  assert.match(skin, /body\.storefront-shell,\nbody:not\(\.storefront-shell\) \.sfx-scope \{\n  padding-left: env\(safe-area-inset-left, 0px\);\n  padding-right: env\(safe-area-inset-right, 0px\);/);
});

/* ------------------------------------------------------------------ #74 Meta purchase storage */

test("#74 purchase dedupe survives blocked site storage (reading window.sessionStorage throws)", () => {
  const source = read("src/storefront/lib/metaPixelEvents.js");
  assert.doesNotMatch(source, /window\.sessionStorage\?\./, "no unguarded storage access left");
  const helpers = source.slice(source.indexOf("const trackedPurchases = new Set();"), source.indexOf("const text = "));
  const make = (windowObject) => new Function("window", `${helpers}\nreturn { hasTrackedPurchase, rememberTrackedPurchase };`)(windowObject);

  const blocked = {};
  Object.defineProperty(blocked, "sessionStorage", { get() { throw new Error("SecurityError: Access is denied for this document."); } });
  const guard = make(blocked);
  assert.equal(guard.hasTrackedPurchase("m1.meta.purchase.9"), false);
  assert.doesNotThrow(() => guard.rememberTrackedPurchase("m1.meta.purchase.9"));
  assert.equal(guard.hasTrackedPurchase("m1.meta.purchase.9"), true, "the in-memory set still dedupes");

  const stored = new Map([["m1.meta.purchase.7", "1"]]);
  const healthy = make({ sessionStorage: { getItem: (key) => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) } });
  assert.equal(healthy.hasTrackedPurchase("m1.meta.purchase.7"), true, "a refresh still reads the stored mark");
  healthy.rememberTrackedPurchase("m1.meta.purchase.8");
  assert.equal(stored.get("m1.meta.purchase.8"), "1");

  const purchase = source.slice(source.indexOf("export const trackMetaPurchase"));
  assert.match(purchase, /if \(hasTrackedPurchase\(storageKey\)\) return null;/);
  assert.match(purchase, /if \(payload\) rememberTrackedPurchase\(storageKey\);/);
});

test("#74 a tracking error after the order is created never reaches the checkout error path", () => {
  const storefront = read("src/storefront/Storefront.jsx");
  const start = storefront.indexOf('const data = await api.post("/storefront/checkout", requestBody);');
  const segment = storefront.slice(start, storefront.indexOf("clearCart();", start));
  assert.match(segment, /try \{\s*trackMetaPurchase\(\{[\s\S]*trackGa4Purchase\(\{[\s\S]*?\}\);\s*\} catch \(trackingError\) \{/);
});

/* ------------------------------------------------------------------ #76 GA4 page_view */

test("#76 page_view repeats for a return visit and only drops an immediate duplicate", async () => {
  const { __resetGa4GuardsForTests, trackGa4PageView } = await import("../src/storefront/lib/ga4Events.js");
  global.window = { location: { hostname: "m1store-egy.com", pathname: "/", search: "", href: "https://m1store-egy.com/" }, dataLayer: [] };
  global.document = { title: "M1", head: { appendChild() {} }, createElement: () => ({}), getElementById: () => ({}), querySelector: () => null };
  try {
    __resetGa4GuardsForTests();
    for (const path of ["/", "/", "/product/a", "/", "/product/b", "/product/b", "/"]) trackGa4PageView({ path });
    const views = window.dataLayer.filter((entry) => entry?.[0] === "event" && entry[1] === "page_view").map((entry) => entry[2].page_path);
    assert.deepEqual(views, ["/", "/product/a", "/", "/product/b", "/"]);
  } finally {
    delete global.window;
    delete global.document;
  }
});

/* ------------------------------------------------------------------ #77 wishlist across devices */

test("#77 a model removed on another device is dropped, not re-saved; a heart added here since is sent", async () => {
  const { reconcileWishlistWithServer } = await import("../src/storefront/lib/wishlistIdentity.js");
  const local = [{ id: "10", key: "10:red", color_key: "red" }, { id: "11", key: "11" }, { id: "12", key: "12" }];
  const remote = [{ id: "10", key: "10" }, { id: "13", key: "13" }];

  // Synced before with 10, 11 (and 13 added elsewhere since). 11 is gone from the server: removed elsewhere.
  const synced = reconcileWishlistWithServer({ local, remote, baseIds: ["10", "11"] });
  assert.deepEqual(synced.merged.map((entry) => entry.key), ["10:red", "12", "13"]);
  assert.deepEqual(synced.toAdd, ["12"]);

  // Never synced for this phone: every local heart is a guest heart to add.
  const first = reconcileWishlistWithServer({ local, remote, baseIds: null });
  assert.deepEqual(first.merged.map((entry) => entry.key), ["10:red", "11", "12", "13"]);
  assert.deepEqual(first.toAdd, ["11", "12"]);
});

test("#77 Storefront keeps a per-phone wishlist base and sends only reconciled adds", () => {
  const storefront = read("src/storefront/Storefront.jsx");
  const sync = storefront.slice(storefront.indexOf("const syncCustomerLists = async () => {"), storefront.indexOf("void syncCustomerLists();"));
  assert.match(sync, /reconcileWishlistWithServer\(\{\s*local: guestWishlist,\s*remote: backendWishlist,\s*baseIds: readWishlistSyncBase\(cartPhone\),/);
  assert.match(sync, /\.\.\.wishlistSync\.toAdd\.map\(\(productId\) =>/);
  assert.doesNotMatch(sync, /missingWishlistItems/);
  assert.match(sync, /settled\[index\]\?\.status === "fulfilled"/);
  assert.match(sync, /writeWishlistSyncBase\(cartPhone, \[\.\.\.backendWishlist\.map\(\(item\) => wishlistIdOf\(item\)\), \.\.\.landed\]\)/);
  assert.match(storefront, /if \(syncedPhone && String\(readStorefrontCustomerAuth\(\)\.phone \|\| ""\) === syncedPhone\) \{\s*writeWishlistSyncBase\(syncedPhone, wishlist\.map/);
});

/* ------------------------------------------------------------------ #78 restock intents */

const fakeRestockDb = ({ existing = null } = {}) => {
  const calls = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/^\s*(CREATE|ALTER)/.test(text)) return { rows: [] };
    if (/FROM products WHERE id = \$1/.test(text)) return { rows: [{ id: params[0], name: "Shoe" }] };
    if (/FROM product_variants WHERE id = \$1/.test(text)) return { rows: [{ product_id: 5, size: "44", color: "Black" }] };
    if (/SELECT \* FROM restock_intents WHERE tenant_id = \$1 AND COALESCE\(phone,''\)/.test(text)) return { rows: existing ? [existing] : [] };
    if (/UPDATE restock_intents SET status = 'expired'/.test(text)) return { rows: [] };
    if (/INSERT INTO restock_intents/.test(text)) return { rows: [{ id: 99, status: "waiting", product_id: params[3], variant_id: params[4] }] };
    // Anything else (the stock read) fails, which readAvailability treats as out of stock.
    throw new Error(`unexpected query: ${text.slice(0, 60)}`);
  };
  return calls;
};

test("#78 asking again after a notified or followed-up request creates a fresh waiting intent", async () => {
  const { createIntent } = await import("../server/services/restockIntentService.js");
  const args = { tenantId: 1, phone: "01012345678", productId: 5, variantId: 7 };

  for (const status of ["customer_notified", "recovery_created"]) {
    const calls = fakeRestockDb({ existing: { id: 41, status } });
    const result = await createIntent(args);
    assert.equal(result.created, true, status);
    assert.equal(result.intent.id, 99);
    const close = calls.find((call) => /UPDATE restock_intents SET status = 'expired'/.test(call.sql));
    assert.ok(close, `${status} row is closed`);
    assert.deepEqual(close.params, [1, 41]);
    assert.ok(calls.findIndex((call) => /UPDATE restock_intents/.test(call.sql)) < calls.findIndex((call) => /INSERT INTO restock_intents/.test(call.sql)));
  }

  const calls = fakeRestockDb({ existing: { id: 42, status: "waiting" } });
  const reused = await createIntent(args);
  assert.equal(reused.reused, true);
  assert.equal(reused.intent.id, 42);
  assert.equal(calls.some((call) => /UPDATE restock_intents|INSERT INTO restock_intents/.test(call.sql)), false);
  db.query = originalQuery;
});

test("#78 the storefront list only reports requests a future restock will act on", () => {
  const routes = read("server/routes/storefront.js");
  const route = routes.slice(routes.indexOf('router.get("/restock-intents"'), routes.indexOf('router.delete("/restock-intents/:id"'));
  assert.match(route, /const active = rows\.filter\(\(i\) => i\.status === "waiting"\);/);
});

/* ------------------------------------------------------------------ #110 price-alert follows */

test("#110 every followed id comes back uncapped beside a detailed list that covers a real wishlist", async () => {
  const service = await import("../server/services/storefrontPriceDropAlertService.js");
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/SELECT product_id\s+FROM storefront_price_alerts/.test(sql)) return { rows: Array.from({ length: 150 }, (_, index) => ({ product_id: String(index + 1) })) };
    return { rows: [] };
  };
  try {
    const ids = await service.listPriceAlertFollowIds({ tenantId: 1, phone: "01012345678" });
    assert.equal(ids.length, 150);
    assert.equal(ids[149], 150);
    assert.equal(calls.at(-1).params[2], service.PRICE_ALERT_FOLLOW_IDS_MAX);
    assert.ok(service.PRICE_ALERT_FOLLOW_IDS_MAX >= 1000);

    await service.listPriceAlertsForCustomer({ tenantId: 1, phone: "01012345678" });
    assert.equal(calls.at(-1).params[2], 200, "default detailed cap");
    await service.listPriceAlertsForCustomer({ tenantId: 1, phone: "01012345678", limit: 10_000 });
    assert.equal(calls.at(-1).params[2], 500, "hard max");
  } finally {
    db.query = originalQuery;
  }

  const routes = read("server/routes/storefront.js");
  const route = routes.slice(routes.indexOf('router.get("/price-alerts"'), routes.indexOf('router.post("/price-alerts"'));
  assert.match(route, /listPriceAlertFollowIds\(\{ tenantId, phone \}\)/);
  assert.match(route, /res\.json\(\{ success: true, alerts, following_product_ids: followingProductIds \}\)/);
});

test("#110 the product page bell reads the uncapped ids, and falls back to the list on an older backend", async () => {
  const { isPriceAlertFollowed } = await import("../src/storefront/lib/priceDropAlertsModel.js");
  const alerts = [{ product_id: 1 }];
  assert.equal(isPriceAlertFollowed({ alerts, followingIds: [1, 300] }, 300), true, "a follow outside the detailed list");
  assert.equal(isPriceAlertFollowed({ alerts, followingIds: [1, 300] }, "300"), true);
  assert.equal(isPriceAlertFollowed({ alerts, followingIds: [1, 300] }, 301), false);
  assert.equal(isPriceAlertFollowed({ alerts, followingIds: null }, 1), true, "older backend: the list");
  assert.equal(isPriceAlertFollowed({ alerts, followingIds: null }, 300), false);
  assert.equal(isPriceAlertFollowed({ alerts, followingIds: [] }, ""), false);

  const hook = read("src/storefront/lib/priceDropAlerts.js");
  assert.match(hook, /setFollowingIds\(Array\.isArray\(res\?\.following_product_ids\) \? res\.following_product_ids : null\)/);
  assert.match(hook, /isPriceAlertFollowed\(\{ alerts, followingIds \}, productId\)/);
});

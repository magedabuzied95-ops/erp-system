import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// P0: clicking "إرسال منتج" sat on "جاري تحميل كتالوج المنتجات..." for a very
// long time. Cause: the picker called loadCustomerProductCatalog(), which asks
// /products/with-variants with NO limit — the server then omits the LIMIT clause
// entirely and returns the whole catalog with every variant (~50MB). The
// size-first work only ever protected the OTHER button ("المتاح بالمقاس"),
// because the catalog skip was gated on sizeMode.

const picker = fs.readFileSync(new URL("../src/modules/aiSupport/components/ProductCardPicker.jsx", import.meta.url), "utf8");
const service = fs.readFileSync(new URL("../src/modules/aiSupport/services/customerProductCatalog.js", import.meta.url), "utf8");
// Pure query-building was extracted into its own module so the filter contract
// is unit-testable without pulling in the api client.
const query = fs.readFileSync(new URL("../src/modules/aiSupport/services/pickerQuery.js", import.meta.url), "utf8");
const inbox = fs.readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");

const catalogEffect = picker.slice(
  picker.indexOf("if (sizeMode && !sizeCatalogFallback) return undefined;"),
  picker.indexOf("}, [open, sizeMode, sizeCatalogFallback, t]);")
);

// 2026-09: the bounded 24-row page was reverted for product-card mode. Every POS
// filter count and brand/factory chip was computed from that one page, so the
// order picker's filter drawer read 0 everywhere and most models never showed.
// It now uses the SAME warm catalog as the PWA "إرسال منتج" sheet: the IndexedDB
// snapshot paints first and the multi-MB download only runs when the catalog
// watermark moved. Search and filters run in memory over the whole catalog.

// ---- no full catalog on picker open --------------------------------------

test('"إرسال منتج" opens the picker in product-card mode (not sizeMode)', () => {
  // Regression anchor: this is why the size-first optimisation never applied here.
  assert.match(inbox, /onClick=\{\(\) => openProductCardPicker\(\)\}/);
  assert.match(inbox, /sizeMode: Boolean\(options\.sizeMode\)/);
});

test("product-card mode loads every model through the warm catalog, not one page", () => {
  assert.match(catalogEffect, /if \(sizeMode\) \{/);
  const afterSizeGuard = catalogEffect.slice(catalogEffect.indexOf("// Product-card mode"));
  assert.ok(afterSizeGuard.length > 0, "product-card branch must exist");
  assert.match(afterSizeGuard, /loadCustomerProductCatalogWarm\(\{/);
  assert.doesNotMatch(afterSizeGuard, /searchCustomerProducts\(/, "a bounded page starves the filter counts");
  assert.match(afterSizeGuard, /onSnapshot: /, "the cached snapshot must paint before the revalidation");
});

test("the rendered list grows in steps without refetching", () => {
  assert.match(picker, /const PICKER_RENDER_STEP = \d+;/);
  assert.match(picker, /visibleProducts\.slice\(0, visibleLimit\)/);
  assert.match(picker, /setVisibleLimit\(\(current\) => current \+ PICKER_RENDER_STEP\)/);
  assert.match(query, /export const PICKER_PAGE_SIZE = (\d+)/);
});

test("an absent limit is exactly what made the server return everything", () => {
  // Guards the assumption the fix rests on: no limit => no LIMIT clause.
  assert.match(controller, /const limit = requestedLimit > 0 \? Math\.min\(requestedLimit, limitCap\) : null;/);
  assert.match(controller, /const limitSql = limit \? `LIMIT \$\$\{productQueryValues\.length \+ 1\} OFFSET/);
});

// ---- pricing / stock parity ----------------------------------------------

test("the bounded path reuses the SAME pipeline, so pricing cannot drift", () => {
  // Same endpoint, same normaliser: no new price formula anywhere.
  assert.match(service, /normalizePosSellableProducts\(rows, saleModeSettings\)\.map\(\(product\) => normalizePosCatalogProduct\(product\)\)/);
  assert.match(query, /const params = \{ pos: 1, limit, page \};/);
  assert.doesNotMatch(service, /by-size/, "the by-size projection uses a raw column price — not authoritative");
});

test("sale-mode settings still resolve through the shared normaliser", () => {
  assert.match(service, /normalizeSaleModeSettings\(readSettings\(settingsPayload\)\)/);
  assert.match(service, /\/website\/settings/);
  assert.match(service, /\/settings\/public/);
});

test("no bespoke price or stock maths was introduced in the picker service", () => {
  const added = service.slice(service.indexOf("// ---- Bounded, search-first"));
  for (const banned of ["price *", "* price", "discount", "Math.round(price", "sale_price ="]) {
    assert.ok(!added.includes(banned), `unexpected pricing maths: ${banned}`);
  }
});

// ---- search behaviour ----------------------------------------------------

test("search and filters never refetch the catalog", () => {
  // Typing or picking a chip filters the loaded catalog in memory; re-running the
  // loader per keystroke would re-download or re-read the snapshot each time.
  const deps = picker.match(/\}, \[open, sizeMode, sizeCatalogFallback[^\]]*\]\);/);
  assert.ok(deps, "the catalog effect's dependency array must still be recognisable");
  for (const dep of ["open", "sizeMode", "sizeCatalogFallback"]) {
    assert.ok(deps[0].includes(dep), `dependency array must still include ${dep}`);
  }
  assert.ok(!/\bsearch\b/.test(deps[0]), "search must not retrigger the catalog load");
  assert.match(picker, /return matchesQuery\(product, search\);/);
});

test("a closed picker drops a late catalog response", () => {
  assert.match(catalogEffect, /if \(!active\) return;/);
  assert.match(catalogEffect, /active = false;/);
});

test("the server search covers name, barcode, SKU and variant article codes", () => {
  // The client matcher searched variant article codes; the server must too, or
  // searching by article code would silently return nothing.
  for (const field of ['"p.name"', '"p.sku"', '"p.barcode"', '"sv.article_code"', '"sv.barcode"']) {
    assert.ok(controller.includes(field), `server search is missing ${field}`);
  }
});

// ---- facets --------------------------------------------------------------

test("filter dropdowns use lightweight server facets, not the loaded page", () => {
  // With a bounded page, deriving facets from `products` would shrink the
  // dropdowns to whatever happens to be on screen.
  assert.match(picker, /asArray\(sizeServer\.brands\)\.length\s*\n?\s*\? uniqueTextValues\(asArray\(sizeServer\.brands\)\)/);
  assert.match(picker, /asArray\(sizeServer\.types\)\.length\s*\n?\s*\? uniqueTextValues\(asArray\(sizeServer\.types\)\)/);
});

test("product-card mode fetches facets without blocking results", () => {
  const facetEffect = picker.slice(picker.indexOf("// Product-card mode: pull the brand/type facets"), picker.indexOf("// sizeMode: fetch the in-stock size list"));
  assert.match(facetEffect, /if \(!open \|\| sizeMode\) return undefined;/);
  assert.match(facetEffect, /getAvailableProductSizes\(\{\}\)/);
  assert.doesNotMatch(facetEffect, /setLoading\(/, "facets must never gate the results spinner");
});

// ---- cache / dedup / reopen ----------------------------------------------

test("identical in-flight searches are deduped into one request", () => {
  assert.match(service, /const inFlight = searchInFlight\.get\(key\);/);
  assert.match(service, /if \(inFlight\) return inFlight;/);
  assert.match(service, /searchInFlight\.delete\(key\)/);
});

test("recent results are cached so close/reopen is instant", () => {
  assert.match(service, /const SEARCH_TTL_MS = /);
  assert.match(service, /if \(cached && Date\.now\(\) - cached\.loadedAt < SEARCH_TTL_MS\) return cached\.value;/);
});

test("sale-mode settings are cached separately, not refetched per keystroke", () => {
  assert.match(service, /if \(saleModeCache && Date\.now\(\) - saleModeCache\.loadedAt < SETTINGS_TTL_MS\) return saleModeCache\.value;/);
  assert.match(service, /if \(saleModeRequest\) return saleModeRequest;/);
});

test("nothing sensitive is cached", () => {
  const added = service.slice(service.indexOf("// ---- Bounded, search-first"));
  for (const banned of ["token", "Authorization", "password", "credential"]) {
    assert.ok(!added.toLowerCase().includes(banned.toLowerCase()), `must not cache ${banned}`);
  }
});

// ---- blast radius --------------------------------------------------------

test("the modal shell renders independently of product loading", () => {
  // The loading text used to be an Arabic literal and is now a translation key, so the
  // old anchor was absent and `indexOf` returned -1 — slicing from -700 silently
  // scanned the wrong end of the file and the assertion became meaningless rather than
  // failing honestly. Anchor on the key, and prove the anchor exists first.
  const anchor = 't("aiSupport.inbox.picker.loadingCatalog")';
  const at = picker.indexOf(anchor);
  assert.ok(at > 0, "the loading indicator must still exist to be scoped");

  // The spinner belongs inside the results scroller: hoisted into the shell it would
  // blank the whole modal — filters, search and all — on every catalog fetch.
  const enclosing = picker.slice(0, at);
  assert.ok(
    enclosing.lastIndexOf("overflow-y-auto") > enclosing.lastIndexOf("role=\"dialog\""),
    "spinner must live inside the results scroller, not the modal shell"
  );
});

test("AI Inbox routing/identity/cache were not touched by this change", () => {
  for (const marker of [
    "channelsForFilter(channelFilter)",
    "Promise.allSettled(requestedChannels.map(fetchChannelPage))",
    "inboxCache.saveList(channelPages[index], backendChannel)",
    "mergeConversationPages(cachedPages, conversationKey)",
  ]) {
    assert.ok(inbox.includes(marker), `per-channel routing marker missing: ${marker}`);
  }
});

// Asserted as an invariant rather than an exact line: the send path later returned a
// richer result than a bare `return;`, which broke this while the guard it protects
// was untouched. See ai-inbox-erp-thread-cache for the same reasoning.
test("the send path still guards against a double click", () => {
  assert.match(inbox, /if \(sendingProductCardsRef\.current\) return\b/);
  assert.match(inbox, /sendingProductCardsRef\.current = true;/);
  assert.match(inbox, /finally \{\s*\n\s*sendingProductCardsRef\.current = false;/, "release must sit in finally");
});

test("the size-first flow still works and still avoids the catalog", () => {
  assert.match(picker, /getAvailableProductSizes\(\{/);
  assert.match(picker, /getProductsBySizeCount\(\{/);
  assert.match(catalogEffect, /sizeMode fallback ONLY/);
});

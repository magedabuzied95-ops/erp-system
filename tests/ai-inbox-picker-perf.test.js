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
  picker.indexOf("}, [open, sizeMode, sizeCatalogFallback, search, serverFilters]);")
);

// ---- no full catalog on picker open --------------------------------------

test('"إرسال منتج" opens the picker in product-card mode (not sizeMode)', () => {
  // Regression anchor: this is why the size-first optimisation never applied here.
  assert.match(inbox, /onClick=\{\(\) => openProductCardPicker\(\)\}/);
  assert.match(inbox, /sizeMode: Boolean\(options\.sizeMode\)/);
});

test("product-card mode never downloads the whole catalog", () => {
  // loadCustomerProductCatalog is now reachable ONLY from the sizeMode fallback.
  assert.match(catalogEffect, /if \(sizeMode\) \{/);
  const afterSizeGuard = catalogEffect.slice(catalogEffect.indexOf("// Product-card mode"));
  assert.ok(afterSizeGuard.length > 0, "product-card branch must exist");
  assert.doesNotMatch(afterSizeGuard, /loadCustomerProductCatalog/);
  assert.match(afterSizeGuard, /searchCustomerProducts\(/);
});

test("the bounded request carries an explicit limit", () => {
  assert.match(picker, /searchCustomerProducts\(\{ search: term, filters: serverFilters, page: 1, limit: PICKER_PAGE_SIZE/);
  assert.match(query, /export const PICKER_PAGE_SIZE = (\d+)/);
  const size = Number((query.match(/export const PICKER_PAGE_SIZE = (\d+)/) || [])[1]);
  assert.ok(size > 0 && size <= 48, `page size ${size} must be within the server cap of 48`);
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
  assert.match(query, /const params = \{ compact: 1, limit, page \};/);
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

test("search is server-side, debounced, abortable and stale-guarded", () => {
  assert.match(catalogEffect, /const controller = new AbortController\(\);/);
  assert.match(catalogEffect, /signal: controller\.signal/);
  assert.match(catalogEffect, /const delay = term && isNewQuery \? 300 : 0;/);
  assert.match(catalogEffect, /requestId !== searchRequestIdRef\.current\) return;/);
  assert.match(catalogEffect, /controller\.abort\(\);/);
});

test("the effect re-runs on search AND on filter changes so both query the server", () => {
  assert.match(picker, /\}, \[open, sizeMode, sizeCatalogFallback, search, serverFilters\]\);/);
});

test("an aborted request never surfaces as an error to the user", () => {
  assert.match(catalogEffect, /err\?\.name === "AbortError"/);
  assert.match(catalogEffect, /ERR_CANCELED/);
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

test("reopening with an unchanged term skips the debounce", () => {
  // The signature now covers search AND filters, so an unchanged query — not just
  // an unchanged term — is what skips the debounce.
  assert.match(catalogEffect, /const isNewQuery = querySignature !== lastSearchTermRef\.current;/);
});

test("nothing sensitive is cached", () => {
  const added = service.slice(service.indexOf("// ---- Bounded, search-first"));
  for (const banned of ["token", "Authorization", "password", "credential"]) {
    assert.ok(!added.toLowerCase().includes(banned.toLowerCase()), `must not cache ${banned}`);
  }
});

// ---- blast radius --------------------------------------------------------

test("the modal shell renders independently of product loading", () => {
  // The spinner is scoped to the results container only.
  const spinner = picker.slice(picker.indexOf("جاري تحميل كتالوج المنتجات") - 700, picker.indexOf("جاري تحميل كتالوج المنتجات"));
  assert.match(spinner, /overflow-y-auto/, "spinner must live inside the results scroller");
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

test("the send path and its double-click guard are unchanged", () => {
  assert.match(inbox, /if \(sendingProductCardsRef\.current\) return;\s*\n\s*sendingProductCardsRef\.current = true;/);
  assert.match(inbox, /sendingProductCardsRef\.current = false;\s*\n\s*setProductCardSending\(false\);/);
});

test("the size-first flow still works and still avoids the catalog", () => {
  assert.match(picker, /getAvailableProductSizes\(\{/);
  assert.match(picker, /getProductsBySizeCount\(\{/);
  assert.match(catalogEffect, /sizeMode fallback ONLY/);
});

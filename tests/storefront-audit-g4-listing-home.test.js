import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { cutStorefrontProductsPage, findClassificationFilterOption } from "../server/controllers/storefrontController.js";
import { getCache, getOrSetCacheSWR, invalidateCachePattern, markCachePatternStale, onCacheInvalidatePattern, setCache } from "../server/services/cacheService.js";
import { hasStorefrontHomeContent, keepHomeFilterRowWhenEmpty, listingPageOutOfRange, listingPageSize, nextHomeFilterRowAudience, persistedStorefrontHomeData } from "../src/storefront/lib/listingHomeState.js";
import { homeFilterRowHref } from "../shared/siteDesign.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const controller = read("../server/controllers/storefrontController.js");
const listing = read("../src/storefront/pages/StorefrontProductListingPage.jsx");
const storefront = read("../src/storefront/Storefront.jsx");
const arLocale = JSON.parse(read("../src/locales/ar/storefront.json"));
const enLocale = JSON.parse(read("../src/locales/en/storefront.json"));

const block = (source, start, end = "\n};") => {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing ${start}`);
  return source.slice(from, source.indexOf(end, from) + end.length);
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setTimeout(done, 5));
const windows = { freshSeconds: 120, staleSeconds: 1800 };

// #40 ------------------------------------------------------------------------
test("#40 a product type sent without its underscore still names the Winter Collection option", () => {
  const options = [
    { value: "crocs", label_en: "Crocs" },
    { value: "winter_collection", label_en: "Winter Collection" },
  ];
  assert.equal(findClassificationFilterOption(options, "wintercollection")?.value, "winter_collection");
  assert.equal(findClassificationFilterOption(options, "winter_collection")?.value, "winter_collection");
  assert.equal(findClassificationFilterOption(options, "Winter Collection")?.value, "winter_collection");
  assert.equal(findClassificationFilterOption(options, "slippers"), null, "an unknown type still matches nothing");
  assert.equal(findClassificationFilterOption(options, ""), null);
  // An exact token beats the separator-insensitive one.
  const clash = [{ value: "ab" }, { value: "a_b" }];
  assert.equal(findClassificationFilterOption(clash, "a_b")?.value, "a_b");
});

test("#40 facets resolve the type through the listing's alias lookup; the client keeps the underscore", () => {
  const facetBuild = block(controller, "const buildStorefrontFacetPayload = async");
  assert.match(facetBuild, /getActiveClassificationFilterAliases\("product_type", scope\.productType\)/);
  assert.doesNotMatch(facetBuild, /productType: scope\.productType,/);
  const normalizeType = block(listing, "const normalizeStorefrontProductTypeValue = ");
  assert.match(normalizeType, /"wintercollection"\]\.includes\(normalized\)\) return "winter_collection"/);
  assert.match(normalizeType, /return normalizeFilterKey\(value\)\.replace\(\/\[\\s-\]\+\/g, "_"\);/);
});

// #41 ------------------------------------------------------------------------
test("#41 a build that was running when its key was invalidated does not write its pre-save answer", { timeout: 5000 }, async () => {
  const key = "g4test41:tenant:1:products:a";
  const gate = deferred();
  const stale = getOrSetCacheSWR(key, windows, async () => {
    await gate.promise;
    return "before-save";
  });
  await tick();
  await invalidateCachePattern("g4test41:tenant:1:*");
  // A request after the save starts its own build instead of joining the old one.
  const fresh = await getOrSetCacheSWR(key, windows, async () => "after-save");
  assert.equal(fresh, "after-save");
  gate.resolve();
  assert.equal(await stale, "before-save", "the waiting request still gets its answer");
  const cached = await getCache(key);
  assert.equal(cached?.v, "after-save", "the old build did not overwrite the new entry");
});

test("#41 the old build finishing does not unregister the newer build other requests should join", { timeout: 5000 }, async () => {
  const key = "g4test41c:tenant:1:products:a";
  const oldGate = deferred();
  const newGate = deferred();
  const oldBuild = getOrSetCacheSWR(key, windows, async () => {
    await oldGate.promise;
    return "old";
  });
  await tick();
  await invalidateCachePattern("g4test41c:*");
  const newBuild = getOrSetCacheSWR(key, windows, async () => {
    await newGate.promise;
    return "new";
  });
  await tick();
  oldGate.resolve();
  await oldBuild;
  let extraBuilds = 0;
  const joined = getOrSetCacheSWR(key, windows, async () => {
    extraBuilds += 1;
    return "duplicate";
  });
  newGate.resolve();
  assert.equal(await newBuild, "new");
  assert.equal(await joined, "new");
  assert.equal(extraBuilds, 0, "the third request joined the running build");
});

test("#41 an unrelated invalidation does not stop a build from caching", { timeout: 5000 }, async () => {
  const key = "g4test41b:tenant:1:products:a";
  const gate = deferred();
  const build = getOrSetCacheSWR(key, windows, async () => {
    await gate.promise;
    return "value";
  });
  await tick();
  await invalidateCachePattern("g4other:*");
  gate.resolve();
  await build;
  assert.equal((await getCache(key))?.v, "value");
});

test("#41 clearing the listing sections also drops the builds in flight", () => {
  const clear = block(controller, "export const clearStorefrontSectionCache = () => {");
  assert.match(clear, /storefrontSectionInflight\.clear\(\);/);
  const load = block(controller, "const loadStorefrontProductSection = async");
  assert.match(load, /if \(storefrontSectionInflight\.get\(cacheKey\) === build\) storefrontSectionInflight\.delete\(cacheKey\);/);
});

// #61 ------------------------------------------------------------------------
test("#61 marking stale keeps the last answer for the next visitor and rebuilds behind it", { timeout: 5000 }, async () => {
  const key = "g4test61:tenant:1:products:a";
  const plainKey = "g4test61:tenant:1:notifications:a";
  await getOrSetCacheSWR(key, windows, async () => "old-stock");
  await setCache(plainKey, { rows: 1 }, 60);
  const heard = [];
  const stop = onCacheInvalidatePattern((pattern) => heard.push(pattern));
  await markCachePatternStale("g4test61:tenant:1:*");
  stop();
  assert.deepEqual(heard, ["g4test61:tenant:1:*"], "process-local caches (the listing sections) still clear");
  assert.equal(await getCache(plainKey), null, "an entry with no fresh window is dropped");
  let rebuilds = 0;
  const served = await getOrSetCacheSWR(key, windows, async () => {
    rebuilds += 1;
    return "new-stock";
  });
  assert.equal(served, "old-stock", "no cold wait: the stale answer is served at once");
  await tick();
  assert.equal(rebuilds, 1);
  assert.equal(await getOrSetCacheSWR(key, windows, async () => "unused"), "new-stock");
});

test("#61 checkout marks the storefront entries stale instead of deleting them", () => {
  assert.match(controller, /await client\.query\("COMMIT"\);\s*markStorefrontTenantCacheStale\(tenantId\);/);
  assert.doesNotMatch(controller, /invalidateStorefrontTenantCache\(tenantId\)/);
  assert.match(controller, /markCachePatternStale\(buildCacheKey\("storefront", `tenant:\$\{tenantId \|\| "public"\}`, "\*"\)\)/);
});

// #42 ------------------------------------------------------------------------
test("#42 the Women's bags view-all link keeps its school-bag exclusion all the way to the API", () => {
  assert.match(homeFilterRowHref("womenBags", "women"), /exclude_bag_type=school_bag/);
  assert.match(listing, /const excludeBagType = normalizeFilterKey\(params\.get\("exclude_bag_type"\) \|\| ""\);/);
  const backend = block(listing, "const backendFilterState = useMemo(", "\n  );");
  assert.match(backend, /exclude_bag_type: excludeBagType \|\| "",/);
  const facetScope = block(listing, "const facetScope = useMemo(", "\n  );");
  assert.match(facetScope, /exclude_bag_type: excludeBagType \|\| "",/);
  const scope = block(controller, "const storefrontFacetScopeQuery = ");
  assert.match(scope, /excludeBagType: sortedTextList\(normalized\.excludeBagType\)/);
  assert.match(block(controller, "const buildStorefrontFacetPayload = async"), /excludeBagType: scope\.excludeBagType \|\| \[\],/);
  assert.match(block(controller, "const storefrontFacetCacheQuery = ", "\n});"), /exclude_bag_type: sortedTextList\(scope\.excludeBagType\),/);
});

// #43 ------------------------------------------------------------------------
test("#43 an empty opening audience moves on; a chosen or last one keeps the switch", () => {
  const genders = ["men", "women", "kids"];
  assert.equal(nextHomeFilterRowAudience({ genders, gender: "men", answeredGender: "men", cardCount: 0 }), "women");
  assert.equal(nextHomeFilterRowAudience({ genders, gender: "men", answeredGender: "men", cardCount: 3 }), "");
  assert.equal(nextHomeFilterRowAudience({ genders, gender: "men", answeredGender: "men", cardCount: 0, picked: true }), "", "a visitor's own choice is never overridden");
  assert.equal(nextHomeFilterRowAudience({ genders, gender: "women", answeredGender: "men", cardCount: 0 }), "", "never judged on another audience's answer");
  assert.equal(nextHomeFilterRowAudience({ genders, gender: "men", answeredGender: "men", cardCount: 0, loading: true }), "");
  assert.equal(nextHomeFilterRowAudience({ genders, gender: "kids", answeredGender: "kids", cardCount: 0 }), "");

  assert.equal(keepHomeFilterRowWhenEmpty({ genders, gender: "kids", picked: true }), true);
  assert.equal(keepHomeFilterRowWhenEmpty({ genders, gender: "men", picked: false }), true);
  assert.equal(keepHomeFilterRowWhenEmpty({ genders, gender: "kids", picked: false }), false, "every audience empty and nothing chosen: the row goes");
  assert.equal(keepHomeFilterRowWhenEmpty({ genders: ["women"], gender: "women", picked: true }), false);
});

test("#43 the homepage row passes keepWhenEmpty and a translated empty line", () => {
  const section = block(storefront, "function HomeFilterRowSection(", "function PremiumHomePage(");
  assert.match(section, /keepWhenEmpty=\{keepHomeFilterRowWhenEmpty\(\{ genders: row\.genders, gender, picked \}\)\}/);
  assert.match(section, /emptyLabel=\{sfText\("storefront\.home\.filterRowEmpty"\)\}/);
  assert.ok(arLocale.home.filterRowEmpty && enLocale.home.filterRowEmpty);
  const hook = block(storefront, "const useHomeFilterRow = ");
  assert.match(hook, /nextHomeFilterRowAudience\(/);
  assert.match(hook, /loading: state\.loading \|\| state\.gender !== gender/);
});

// #60 ------------------------------------------------------------------------
test("#60 cards fetch product details on intent only, and the resolver is briefly cacheable", () => {
  const card = storefront.slice(storefront.indexOf("const requestDetailPrefetch = useCallback"), storefront.indexOf("const brandFilterUrl = useMemo(() => productCardBrandFilterUrl"));
  assert.doesNotMatch(card, /IntersectionObserver/);
  assert.match(storefront, /onMouseEnter=\{requestDetailPrefetch\} onTouchStart=\{requestDetailPrefetch\}/);
  const resolve = block(controller, "export const resolveProductLink = async");
  assert.match(resolve, /res\.set\("Cache-Control", "private, max-age=15"\);\s*res\.set\("Vary", "X-Tenant-Id"\);\s*return res\.json\(\{ success: true, resolvable: true/);
});

// #90 ------------------------------------------------------------------------
test("#90 a page past the end is empty and flagged, never another page's cards", () => {
  const cards = Array.from({ length: 30 }, (_, index) => ({ id: index + 1 }));
  const past = cutStorefrontProductsPage(cards, 960, 24);
  assert.deepEqual(past, { products: [], outOfRange: true });
  const last = cutStorefrontProductsPage(cards, 24, 24);
  assert.deepEqual(last.products.map((card) => card.id), [25, 26, 27, 28, 29, 30]);
  assert.equal(last.outOfRange, false);
  assert.deepEqual(cutStorefrontProductsPage([], 0, 24), { products: [], outOfRange: false }, "an empty section is not out of range");
  assert.match(block(controller, "export const listProducts = async"), /out_of_range: outOfRange \|\| undefined,/);
});

test("#90 the listing replaces an out-of-range page and never indexes it", () => {
  assert.equal(listingPageOutOfRange({ page: 40, pageSize: 24, total: 30, settled: true }), true);
  assert.equal(listingPageOutOfRange({ page: 2, pageSize: 24, total: 30, settled: true }), false);
  assert.equal(listingPageOutOfRange({ page: 40, pageSize: 24, total: 30, settled: false }), false, "not judged on another request's total");
  assert.equal(listingPageOutOfRange({ page: 40, pageSize: 24, total: 30, settled: true, error: "502" }), false);
  assert.equal(listingPageOutOfRange({ page: 3, pageSize: 24, total: 0, settled: true }), false);
  assert.match(listing, /settled: !loading && productsApiParams === backendFilterState && productsLoadedUrl === productsRequestUrl,/);
  assert.match(listing, /if \(lastRealPageUrl\) navigate\(lastRealPageUrl, \{ replace: true \}\);/);
  // Both head effects (section pages and /products, /sale) stand aside before writing a canonical.
  assert.match(listing, /if \(pageOutOfRange\) return undefined;\s*(?:\/\/[^\n]*\n\s*)*const headCopy = categorySeoHeadCopy/);
  assert.match(listing, /if \(seoCategory \|\| typeof document === "undefined"\) return undefined;\s*if \(pageOutOfRange\) return undefined;/);
});

// #91 ------------------------------------------------------------------------
test("#91 a failed request shows the error state alone", () => {
  assert.match(listing, /const showEmptyResults = !loading && !error && !pageOutOfRange && !orderedFilteredProducts\.length;/);
});

// #92 ------------------------------------------------------------------------
test("#92 a failed home refresh keeps a painted hero; a day-old bootstrap copy is not painted", () => {
  const now = Date.parse("2026-09-15T12:00:00Z");
  assert.deepEqual(persistedStorefrontHomeData({ at: now - 60_000, data: { hero: 1 } }, now), { hero: 1 });
  assert.equal(persistedStorefrontHomeData({ at: now - 25 * 3600_000, data: { hero: 1 } }, now), null);
  assert.equal(persistedStorefrontHomeData({ data: { hero: 1 } }, now), null, "a copy with no timestamp has no known age");
  assert.equal(persistedStorefrontHomeData(null, now), null);
  assert.equal(hasStorefrontHomeContent({ hero: null, mirrorProducts: [{ id: 1 }], collections: [] }), true);
  assert.equal(hasStorefrontHomeContent({ hero: null, mirrorProducts: [], collections: [] }), false);
  const hook = block(storefront, "const useStorefrontHome = () => {");
  assert.match(hook, /setState\(\(current\) => \(hasStorefrontHomeContent\(current\)\s*\? \{ \.\.\.current, loading: false \}/);
  assert.match(storefront, /return persistedStorefrontHomeData\(JSON\.parse\(window\.localStorage\.getItem\(STOREFRONT_HOME_PERSISTED_CACHE_KEY\)/);
});

// #93 ------------------------------------------------------------------------
test("#93 the page size the customer picked answers for a listing whose URL carries none", () => {
  const options = [12, 24, 36, 48];
  const pick = (urlValue, storedValue) => listingPageSize({ urlValue, storedValue, options, fallback: 24 });
  assert.equal(pick("48", ""), 48, "a shared link reproduces its own page");
  assert.equal(pick("", "48"), 48, "a bare section page keeps the size this device chose");
  assert.equal(pick("12", "48"), 12, "the link outranks the device");
  assert.equal(pick("", ""), 24, "a crawler has no storage, so it reads the SEO page size");
  assert.equal(pick("", "40"), 24, "a size we no longer offer is not honoured");
  assert.equal(pick("nonsense", "36"), 36);
  assert.equal(listingPageSize(), 24);
  // The pick is stored before the URL changes: choosing 24 back deletes per_page,
  // and only a stored 24 stops the old 48 from answering for the bare URL left.
  assert.match(listing, /const choosePageSize = \(nextSize\) => \{\s*const size = normalizePageSize\(nextSize\);\s*setStoredPageSize\(String\(size\)\);\s*writeStoredPageSize\(size\);\s*navigate\(pageSizeUrl\(size\)\);/);
  assert.match(listing, /urlValue: params\.get\("per_page"\) \|\| params\.get\("perPage"\),\s*storedValue: storedPageSize,/);
  // It is drawn once, in the toolbar beside the count, not at the far end of the grid.
  assert.equal(listing.split("PAGE_SIZE_OPTIONS.map(").length - 1, 1);
  assert.match(listing, /onChange=\{\(event\) => choosePageSize\(event\.target\.value\)\}/);
  assert.equal(arLocale.products.perPageOption, "{{size}} في الصفحة");
  assert.ok(enLocale.products.perPageOption);
  // One bottom padding, not two: the listing reserved room for a mobile bar the
  // shop does not have, and the pagination row reserved it a second time.
  assert.ok(!listing.includes("pb-24 sm:pb-4"));
  assert.ok(!listing.includes("--mobile-bottom-nav-height"));
});

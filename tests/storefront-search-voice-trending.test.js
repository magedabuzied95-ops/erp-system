import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildTrendingSearches, trendingModelName } from "../src/storefront/lib/trendingSearches.js";
import { chooseVoiceEngine, isIosLike, nativeErrorKey, transcriptFromResults, VOICE_ERROR_KEYS } from "../src/storefront/lib/voiceSearch.js";
import { searchImageTargetSize } from "../src/storefront/lib/searchImage.js";
import { catalogueSearchQuery, parseSearchQuery } from "../src/storefront/lib/searchAliases.js";

const storefrontSource = fs.readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const readLocale = (lang) => JSON.parse(fs.readFileSync(new URL(`../src/locales/${lang}/storefront.json`, import.meta.url), "utf8"));

test("best sellers collapse to one entry per model, named without the colour or the category word", () => {
  assert.equal(trendingModelName("Nike Air Jordan 1 Low Sneakers - White & Black"), "Nike Air Jordan 1 Low");
  assert.equal(trendingModelName("Crocs - Black & Red"), "Crocs");
  assert.equal(trendingModelName("Tommy Hilfiger Sneakers for Men - Navy"), "Tommy Hilfiger");
  assert.equal(trendingModelName("Nike Air Force 1  Sneakers - White"), "Nike Air Force 1");
  // Casing differences in the catalogue are one model, not two.
  assert.equal(buildTrendingSearches([{ name: "New Balance 530 - Grey" }, { name: "New balance 530 - White" }]).length, 1);
  // Live best-seller order for men: 22 colours of the Jordan 1 Low, then Crocs, then McQueen.
  const rows = [
    ...Array.from({ length: 22 }, (_, index) => ({ name: `Nike Air Jordan 1 Low Sneakers - Colour ${index}`, sold_count: 159 })),
    { name: "Crocs - Black", sold_count: 79 },
    { name: "Crocs - Navy", sold_count: 79 },
    { name: "Alexander Mcqueen Sneakers - White", sold_count: 59 },
    { name: "Adidas Samba Sneakers - White & Green", sold_count: 52 },
  ];
  const trending = buildTrendingSearches(rows);
  assert.deepEqual(trending.map((item) => item.term), ["Nike Air Jordan 1 Low", "Crocs", "Alexander Mcqueen", "Adidas Samba"]);
  assert.equal(trending[0].colours, 22);
  assert.equal(buildTrendingSearches(rows, { max: 2 }).length, 2);
});

test("the sheet builds trending from the audience's best sellers and keeps the written list as fallback", () => {
  assert.match(storefrontSource, /sort: "best_sellers", limit: 96/);
  assert.match(storefrontSource, /setSearchTrending\(buildTrendingSearches\(/);
  assert.match(storefrontSource, /\{trendingModels\.length \? \([\s\S]*?\) : trendingSearches\.length \? \(/);
});

test("iPhone records a clip for the server; Android keeps the browser recogniser", () => {
  assert.equal(isIosLike({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isIosLike({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }), true, "iPadOS");
  assert.equal(isIosLike({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }), false);

  assert.equal(chooseVoiceEngine({ hasRecogniser: true, canRecord: true, iosLike: true }), "recorder");
  assert.equal(chooseVoiceEngine({ hasRecogniser: true, canRecord: true, iosLike: false }), "native");
  assert.equal(chooseVoiceEngine({ hasRecogniser: false, canRecord: true }), "recorder", "no recogniser at all (iOS Chrome, Firefox)");
  // The server said it has no provider: the next tap goes back to the recogniser.
  assert.equal(chooseVoiceEngine({ hasRecogniser: true, canRecord: true, iosLike: true, serverState: "unavailable" }), "native");
  assert.equal(chooseVoiceEngine({ hasRecogniser: false, canRecord: false }), "");
});

test("every recogniser failure is told to the shopper, never swallowed", () => {
  assert.equal(nativeErrorKey("not-allowed"), VOICE_ERROR_KEYS.denied);
  assert.equal(nativeErrorKey("no-speech"), VOICE_ERROR_KEYS.noSpeech);
  assert.equal(nativeErrorKey("audio-capture"), VOICE_ERROR_KEYS.noMic);
  assert.equal(nativeErrorKey("something-new"), VOICE_ERROR_KEYS.failed);
  assert.equal(nativeErrorKey("aborted"), "", "the shopper's own second tap");
  const results = [[{ transcript: "جوردن " }], Object.assign([{ transcript: "4 مقاس 42" }], { isFinal: true })];
  assert.deepEqual(transcriptFromResults(results), { text: "جوردن 4 مقاس 42", final: true });

  const handler = storefrontSource.slice(storefrontSource.indexOf("const handleVoiceSearch = () => {"), storefrontSource.indexOf("const handleImageSearch = async"));
  assert.match(handler, /onError: \(key\) => toast\.error\(sfText\(key\)\)/);
  assert.match(handler, /api\.post\("\/storefront\/voice-search"/);
  assert.doesNotMatch(handler, /recognition\.interimResults = false/);

  for (const lang of ["ar", "en"]) {
    const locale = readLocale(lang);
    for (const key of Object.values(VOICE_ERROR_KEYS)) {
      const value = key.replace(/^storefront\./, "").split(".").reduce((node, part) => node?.[part], locale);
      assert.equal(typeof value, "string", `${lang}: ${key}`);
    }
  }
});

test("a search photo is redrawn no longer than 1280px before upload", () => {
  assert.deepEqual(searchImageTargetSize(4032, 3024), { width: 1280, height: 960 });
  assert.deepEqual(searchImageTargetSize(800, 600), { width: 800, height: 600 }, "never enlarged");
  assert.match(storefrontSource, /file = await prepareSearchImage\(picked\)/);
});

test("Arabic and spoken queries become the catalogue's spelling plus filters", () => {
  // Each of these returned 0 results live before the rewrite.
  assert.equal(catalogueSearchQuery("جوردن 4"), "Jordan 4");
  assert.equal(catalogueSearchQuery("أديداس سامبا"), "Adidas Samba");
  assert.equal(catalogueSearchQuery("نيو بالانس 530"), "New Balance 530");
  assert.equal(catalogueSearchQuery("Skechers"), "Skechers", "Latin text is untouched");

  assert.deepEqual(parseSearchQuery("عايز كوتشي جوردن اسود مقاس 42 رجالي"), { q: "Jordan", color: "black", gender: "men", size: "42" });
  assert.deepEqual(parseSearchQuery("جوردن ١ لو"), { q: "Jordan 1 Low", color: "", gender: "", size: "" });
  assert.equal(parseSearchQuery("سكيتشرز رمادي").color, "grey");
  // Two-tone colourways are keyed with white last, as the catalogue keys them.
  assert.equal(parseSearchQuery("سامبا ابيض واسود").color, "black & white");
  assert.equal(parseSearchQuery("Jordan black").color, "black");
  assert.equal(parseSearchQuery("لو سمحت عندكم نايك اير فورس").q, "Nike Air Force");
});

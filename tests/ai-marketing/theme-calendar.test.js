import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  interleaveThemeAudiences,
  normalizeThemeCalendar,
  productMatchesThemeBlock,
  themeAudienceMatches,
} from "../../server/services/aiMarketingCenterService.js";

const serviceSource = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url), "utf8");
const editorSource = fs.readFileSync(new URL("../../src/modules/marketing/components/StoryThemeCalendar.jsx", import.meta.url), "utf8");

const block = (patch = {}) => ({
  key: "block",
  label_ar: "بلوك",
  days: [3],
  stories_per_day: 6,
  audiences: [],
  active: true,
  filters: { product_types: [], grades: [], styles: [], categories: [], offers_only: false, include_offers: false },
  ...patch,
  filters: {
    product_types: [],
    grades: [],
    styles: [],
    categories: [],
    offers_only: false,
    include_offers: false,
    ...(patch.filters || {}),
  },
});

test("a never-configured calendar seeds the suggested week, an emptied one stays empty", () => {
  const seeded = normalizeThemeCalendar(null);
  assert.ok(seeded.length > 0);
  assert.deepEqual(
    seeded.map((row) => row.key).sort(),
    ["bags", "local-sneakers", "mirror-sneakers", "offers", "slippers-crocs", "vietnam-sneakers"]
  );
  // Every day of the week is claimed exactly once by the seeded blocks.
  const claimed = seeded.flatMap((row) => row.days).sort((left, right) => left - right);
  assert.deepEqual(claimed, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(normalizeThemeCalendar([]), []);
});

test("seeded blocks carry the real classification values, not placeholders", () => {
  const byKey = new Map(normalizeThemeCalendar(null).map((row) => [row.key, row]));
  // These are the live grade option values; a typo here means the day runs empty.
  assert.deepEqual(byKey.get("mirror-sneakers").filters.grades, ["mirror_original"]);
  assert.deepEqual(byKey.get("vietnam-sneakers").filters.grades, ["imported_from_vietnam"]);
  assert.deepEqual(byKey.get("local-sneakers").filters.grades, ["local"]);
  assert.deepEqual(byKey.get("slippers-crocs").filters.product_types, ["slippers", "crocs"]);
  assert.deepEqual(byKey.get("bags").filters.product_types, ["bags"]);
  for (const key of ["slippers-crocs", "mirror-sneakers", "vietnam-sneakers", "bags", "local-sneakers"]) {
    assert.equal(byKey.get(key).active, true, `${key} should run out of the box`);
  }
  // Offers ships parked: it only starts once an operator gives it a day.
  assert.equal(byKey.get("offers").active, false);
  assert.deepEqual(byKey.get("offers").days, []);
  assert.equal(byKey.get("offers").filters.offers_only, true);
});

test("normalizer rejects junk days, clamps volume and de-duplicates keys", () => {
  const rows = normalizeThemeCalendar([
    { key: "A Block!", days: [3, 9, -1, 3, "4"], stories_per_day: 900 },
    { key: "a-block", days: [1] },
  ]);
  assert.equal(rows.length, 1, "duplicate slugs collapse to the first one");
  assert.deepEqual(rows[0].days, [3, 4]);
  assert.equal(rows[0].stories_per_day, 60);
});

test("grade filter survives Arabic spelling drift between product and classification", () => {
  const mirror = block({ filters: { product_types: ["sneakers"], grades: ["محلى"] } });
  assert.equal(productMatchesThemeBlock({ product_type: "sneakers", grade: "محلي" }, mirror), true);
  assert.equal(productMatchesThemeBlock({ product_type: "sneakers", grade: "مِيرور" }, mirror), false);
});

test("a block only takes the product types it asks for", () => {
  const slippers = block({ filters: { product_types: ["slippers", "crocs"] } });
  assert.equal(productMatchesThemeBlock({ product_type: "slippers" }, slippers), true);
  assert.equal(productMatchesThemeBlock({ product_type: "crocs" }, slippers), true);
  assert.equal(productMatchesThemeBlock({ product_type: "sneakers" }, slippers), false);
  assert.equal(productMatchesThemeBlock({ product_type: "bags" }, slippers), false);
});

test("offer products stay out of ordinary blocks and only an offers block takes them", () => {
  const ordinary = block({ filters: { product_types: ["sneakers"] } });
  const offers = block({ key: "offers", filters: { offers_only: true, include_offers: true } });
  const offerProduct = { product_type: "sneakers", is_offer_story: true };
  const plainProduct = { product_type: "sneakers", is_offer_story: false };

  assert.equal(productMatchesThemeBlock(offerProduct, ordinary), false, "offers must not leak into a themed day");
  assert.equal(productMatchesThemeBlock(plainProduct, ordinary), true);
  assert.equal(productMatchesThemeBlock(offerProduct, offers), true);
  assert.equal(productMatchesThemeBlock(plainProduct, offers), false);

  // Opting in brings them back without needing a separate day.
  const mixed = block({ filters: { product_types: ["sneakers"], include_offers: true } });
  assert.equal(productMatchesThemeBlock(offerProduct, mixed), true);
});

test("an offers block ignores product-type filters so nothing silently excludes an offer", () => {
  const offers = block({ key: "offers", filters: { product_types: ["bags"], offers_only: true } });
  assert.equal(productMatchesThemeBlock({ product_type: "sneakers", is_offer_story: true }, offers), true);
});

test("audience filter narrows a block, empty means every audience", () => {
  const menOnly = block({ audiences: ["men"] });
  assert.equal(themeAudienceMatches({ gender: "men" }, menOnly), true);
  assert.equal(themeAudienceMatches({ gender: "حريمي" }, menOnly), false);
  assert.equal(themeAudienceMatches({ gender: "حريمي" }, block()), true);
});

test("a themed day rotates men -> women -> kids instead of dumping one audience", () => {
  const products = [
    { id: 1, gender: "men" },
    { id: 2, gender: "men" },
    { id: 3, gender: "men" },
    { id: 4, gender: "حريمي" },
    { id: 5, gender: "حريمي" },
    { id: 6, gender: "اطفال" },
  ];
  const order = interleaveThemeAudiences(products).map((product) => product.id);
  assert.deepEqual(order.slice(0, 3), [1, 4, 6], "first three stories cover all three audiences");
  assert.equal(order.length, products.length, "nothing is dropped");
});

test("theme mode is wired end to end, not just defined", () => {
  assert.match(serviceSource, /story_selection_mode === "theme_calendar"[\s\S]{0,120}buildThemeCalendarStories/);
  // The day the calendar picked must survive the weighted scheduler.
  assert.match(serviceSource, /const forced = forcedThemeDayOffset\(item, state\);\s*\n\s*if \(forced !== null\) return forced;/);
  // Per-theme cycles, and coverage released when an item dies unpublished.
  assert.match(serviceSource, /INSERT INTO ai_marketing_theme_coverage/);
  assert.match(serviceSource, /DELETE FROM ai_marketing_theme_coverage WHERE tenant_id = \$1 AND queue_id = \$2 AND published_at IS NULL/);
  assert.match(serviceSource, /UPDATE ai_marketing_theme_coverage SET published_at/);
  // Additive migration only: a backfill here crash-loops the backend on boot.
  assert.match(serviceSource, /ADD COLUMN IF NOT EXISTS story_theme_calendar JSONB/);
  assert.doesNotMatch(serviceSource, /UPDATE ai_marketing_settings SET story_theme_calendar/);
});

test("the dashboard exposes the mode and the editor it controls", () => {
  assert.match(pageSource, /story_selection_mode: "theme_calendar"/);
  assert.match(pageSource, /<StoryThemeCalendar/);
  assert.match(pageSource, /story_theme_calendar: calendar/);
  // Editing days, volume, audiences, grades and offers all reachable from the UI.
  for (const marker of ["days:", "stories_per_day:", "audiences:", "grades:", "offers_only"]) {
    assert.ok(editorSource.includes(marker), `editor is missing control for ${marker}`);
  }
});

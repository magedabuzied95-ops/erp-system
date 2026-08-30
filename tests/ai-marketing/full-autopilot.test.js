import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  countThemeStoriesForDate,
  normalizeThemeCalendar,
  resolveGenerationPlan,
  themeBlockActiveOnDate,
} from "../../server/services/aiMarketingCenterService.js";
import { normalizeStoryAutopilotConfig } from "../../server/services/aiMarketingStoryAutopilotService.js";

const centerSource = fs.readFileSync(new URL("../../server/services/aiMarketingCenterService.js", import.meta.url), "utf8");
const autopilotSource = fs.readFileSync(new URL("../../server/services/aiMarketingStoryAutopilotService.js", import.meta.url), "utf8");
const routesSource = fs.readFileSync(new URL("../../server/routes/aiMarketingCenter.js", import.meta.url), "utf8");
const pageSource = fs.readFileSync(new URL("../../src/modules/marketing/pages/AiMarketingCenter.jsx", import.meta.url), "utf8");
const editorSource = fs.readFileSync(new URL("../../src/modules/marketing/components/StoryThemeCalendar.jsx", import.meta.url), "utf8");
const modalSource = fs.readFileSync(new URL("../../src/modules/marketing/components/StoryAutopilotSettingsModal.jsx", import.meta.url), "utf8");

const themeBlock = (patch = {}) => ({
  key: "block",
  label_ar: "بلوك",
  days: [0, 1, 2, 3, 4, 5, 6],
  stories_per_day: 6,
  audiences: [],
  active: true,
  filters: { product_types: [], grades: [], styles: [], categories: [], offers_only: false, include_offers: false },
  ...patch,
});

test("theme blocks keep their seasonal date window, junk dates are dropped", () => {
  const rows = normalizeThemeCalendar([
    themeBlock({ key: "school-bags", start_date: "2026-08-20", end_date: "2026-9-10" }),
    themeBlock({ key: "plain" }),
    themeBlock({ key: "junk", start_date: "next week", end_date: "10/9" }),
  ]);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  assert.equal(byKey.get("school-bags").start_date, "2026-08-20");
  // Single-digit month is padded so string comparison against day keys works.
  assert.equal(byKey.get("school-bags").end_date, "2026-09-10");
  assert.equal(byKey.get("plain").start_date, "");
  assert.equal(byKey.get("plain").end_date, "");
  assert.equal(byKey.get("junk").start_date, "");
  assert.equal(byKey.get("junk").end_date, "");
});

test("a date window is inclusive on both ends and open when blank", () => {
  const windowed = { start_date: "2026-08-20", end_date: "2026-09-10" };
  assert.equal(themeBlockActiveOnDate(windowed, new Date(2026, 7, 19)), false, "day before start");
  assert.equal(themeBlockActiveOnDate(windowed, new Date(2026, 7, 20)), true, "start day itself");
  assert.equal(themeBlockActiveOnDate(windowed, new Date(2026, 8, 10)), true, "end day itself still runs");
  assert.equal(themeBlockActiveOnDate(windowed, new Date(2026, 8, 11)), false, "day after end");
  assert.equal(themeBlockActiveOnDate({}, new Date(2026, 0, 1)), true, "no window = always on");
});

test("the school-bags scenario: daily until 10/9, slippers keep their weekly day, the rest continues after", () => {
  const settings = {
    story_selection_mode: "theme_calendar",
    story_theme_calendar: normalizeThemeCalendar([
      themeBlock({ key: "school-bags", label_ar: "شنط المدارس", days: [0, 1, 2, 3, 4, 5, 6], stories_per_day: 6, end_date: "2026-09-10" }),
      themeBlock({ key: "slippers", label_ar: "سليبرات", days: [3], stories_per_day: 6 }),
    ]),
  };
  // A Tuesday inside the season: school bags only.
  assert.equal(countThemeStoriesForDate(settings, new Date(2026, 8, 8)), 6);
  // Wednesday 9/9 inside the season: school bags + slippers day.
  assert.equal(countThemeStoriesForDate(settings, new Date(2026, 8, 9)), 12);
  // 10/9 is the last school-bags day (inclusive).
  assert.equal(countThemeStoriesForDate(settings, new Date(2026, 8, 10)), 6);
  // After the season the daily block is gone; the weekly slippers day survives.
  assert.equal(countThemeStoriesForDate(settings, new Date(2026, 8, 11)), 0);
  assert.equal(countThemeStoriesForDate(settings, new Date(2026, 8, 16)), 6, "next Wednesday is slippers again");
});

test("generation planning honours the expired window, not just the weekday", () => {
  // buildThemeCalendarStories must gate each planned day on the block's window.
  assert.match(centerSource, /row\.days\.includes\(dayOfWeek\) && themeBlockActiveOnDate\(row, dayDate\)/);
  // The week strip is built from the next seven REAL dates for the same reason.
  assert.match(centerSource, /themeBlockActiveOnDate\(block, date\)/);
});

test("a numeric start_offset targets one future day and pins it", () => {
  const plan = resolveGenerationPlan({ runType: "plan", overrides: { days: 1, start_offset: 2, stories_per_day: 6, posts_per_day: 0 }, settings: {} });
  assert.equal(plan.days, 1);
  assert.equal(plan.start_offset, 2);
  assert.equal(plan.horizon_days, 3);
  assert.equal(plan.pin_days, true, "a single offset day still pins, or stories scatter over the horizon");
  // Backward compatibility: the boolean start_tomorrow still means offset 1.
  const tomorrow = resolveGenerationPlan({ runType: "plan", overrides: { days: 3, start_tomorrow: true }, settings: {} });
  assert.equal(tomorrow.start_offset, 1);
});

test("autopilot config carries the full-autopilot switches with clamped bounds", () => {
  const config = normalizeStoryAutopilotConfig({ auto_generate: true, auto_generate_days_ahead: 99 });
  assert.equal(config.auto_generate, true);
  assert.equal(config.auto_generate_days_ahead, 7, "days ahead is clamped to a week");
  const defaults = normalizeStoryAutopilotConfig({});
  assert.equal(defaults.auto_generate, false, "existing tenants keep manual generation until they opt in");
  assert.equal(defaults.auto_generate_days_ahead, 1);
});

test("the scan generates upcoming days itself and aligns publishing to the queue", () => {
  // Wired into the tenant run, not a dead export.
  assert.match(autopilotSource, /if \(config\.auto_generate\) \{[\s\S]{0,200}maybeRunAutoGeneration\(tenantId, config, now\)/);
  // Sized from the theme calendar's own per-date sum.
  assert.match(autopilotSource, /countThemeStoriesForDate\(engineSettings, target\)/);
  // One generation per day, remembered in state so ticks stay idempotent.
  assert.match(autopilotSource, /auto_generated_days: ledger/);
  // Generated days can actually go out: queue_schedule + widened caps.
  assert.match(autopilotSource, /aligned\.schedule_mode = "queue_schedule"/);
  assert.match(autopilotSource, /aligned\.max_per_day = maxNeeded/);
});

test("suggested slots refresh themselves daily from Meta insights when follow_insights is on", () => {
  assert.match(autopilotSource, /maybeRefreshInsightSlots\(tenantId, config, now\)/);
  assert.match(autopilotSource, /last_insight_slot_refresh_date/);
});

test("manually pushed offers ride past the daily cap instead of blocking or being blocked", () => {
  // Published offer pushes don't consume the automatic quota…
  assert.match(autopilotSource, /COALESCE\(metadata->>'offers_push', ''\) <> 'true'/);
  // …and once the cap is spent, only pushed offers keep flowing.
  assert.match(autopilotSource, /const offersPushOnly = remainingToday === 0;/);
  assert.match(autopilotSource, /q\.metadata->>'offers_push' = 'true'/);
});

test("the offers push endpoint exists end to end", () => {
  assert.match(centerSource, /export const pushAiMarketingOffersNow/);
  // Tagged so the autopilot can recognise them, and designs render in background.
  assert.match(centerSource, /offers_push: "true"/);
  assert.match(centerSource, /selection_mode: "offers_push"/);
  assert.match(routesSource, /router\.post\("\/offers\/push-now"/);
  assert.match(pageSource, /pushAutonomousAiMarketingOffersNow/);
  assert.ok(pageSource.includes("انشر العروض"), "the header button is the whole point");
});

test("the editors expose the new controls", () => {
  for (const marker of ["start_date", "end_date", "keywords"]) {
    assert.ok(editorSource.includes(marker), `theme editor is missing ${marker}`);
  }
  for (const marker of ["auto_generate", "auto_generate_days_ahead"]) {
    assert.ok(modalSource.includes(marker), `autopilot modal is missing ${marker}`);
  }
});

test("brand keywords narrow a block to the named brands, within its other filters", async () => {
  const { productMatchesThemeBlock } = await import("../../server/services/aiMarketingCenterService.js");
  const schoolBags = themeBlock({
    key: "school-bags",
    filters: { product_types: ["bags"], grades: [], styles: [], categories: [], keywords: ["momolly", "classic"], offers_only: false, include_offers: false },
  });
  // The word can live in the NAME…
  assert.equal(productMatchesThemeBlock({ product_type: "bags", name: "Momolly Bag 15-inch" }, schoolBags), true);
  // …or in the joined brand column.
  assert.equal(productMatchesThemeBlock({ product_type: "bags", name: "School backpack", brand: "Classic" }, schoolBags), true);
  // A women's bag of the same product type stays out.
  assert.equal(productMatchesThemeBlock({ product_type: "bags", name: "Chrisbella Hand & Crossbody Bag", brand: "Chrisbella" }, schoolBags), false);
  // The type filter still applies: a "Classic" sneaker is not a school bag.
  assert.equal(productMatchesThemeBlock({ product_type: "sneakers", name: "Adidas Classic" }, schoolBags), false);
  // No keywords = the old behaviour, every bag qualifies.
  const anyBags = themeBlock({ key: "bags", filters: { product_types: ["bags"], grades: [], styles: [], categories: [], keywords: [], offers_only: false, include_offers: false } });
  assert.equal(productMatchesThemeBlock({ product_type: "bags", name: "Chrisbella Hand & Crossbody Bag" }, anyBags), true);
});

test("the calendar keeps deciding after generation, not only during it", async () => {
  const { queueItemMatchesThemeCalendar } = await import("../../server/services/aiMarketingCenterService.js");
  const settings = {
    story_selection_mode: "theme_calendar",
    story_theme_calendar: normalizeThemeCalendar([
      themeBlock({ key: "school-bags", days: [0, 1, 2, 3, 4, 5, 6], filters: { product_types: ["bags"], keywords: ["momolly"] }, end_date: "2026-09-10" }),
      themeBlock({ key: "parked", days: [0, 1, 2, 3, 4, 5, 6], active: false }),
    ]),
  };
  const item = (themeKey) => ({ metadata: { theme_key: themeKey } });
  const day = new Date(2026, 8, 1);

  // A row generated under the old, wider filter is refused once the block narrows.
  assert.equal(
    queueItemMatchesThemeCalendar({ settings, item: item("school-bags"), product: { product_type: "bags", name: "Chrisbella Hand & Crossbody" }, now: day }),
    false
  );
  assert.equal(
    queueItemMatchesThemeCalendar({ settings, item: item("school-bags"), product: { product_type: "bags", name: "Momolly Bag" }, now: day }),
    true
  );
  // Past the block's end date nothing from it goes out, whatever the product is.
  assert.equal(
    queueItemMatchesThemeCalendar({ settings, item: item("school-bags"), product: { product_type: "bags", name: "Momolly Bag" }, now: new Date(2026, 8, 11) }),
    false
  );
  // A switched-off or deleted block stops its queue immediately.
  assert.equal(queueItemMatchesThemeCalendar({ settings, item: item("parked"), product: {}, now: day }), false);
  assert.equal(queueItemMatchesThemeCalendar({ settings, item: item("deleted-block"), product: {}, now: day }), false);
  // No opinion when it cannot know: other selection modes, untagged rows, no product row.
  assert.equal(queueItemMatchesThemeCalendar({ settings: { story_selection_mode: "catalog_coverage" }, item: item("school-bags"), product: {}, now: day }), null);
  assert.equal(queueItemMatchesThemeCalendar({ settings, item: { metadata: {} }, product: {}, now: day }), null);
  assert.equal(queueItemMatchesThemeCalendar({ settings, item: item("school-bags"), product: null, now: day }), null);
});

test("the autopilot archives off-calendar rows instead of publishing or re-testing them", () => {
  assert.match(autopilotSource, /queueItemMatchesThemeCalendar\(\{[\s\S]{0,160}settings: engineSettings/);
  assert.match(autopilotSource, /if \(stillWanted === false\)/);
  assert.match(autopilotSource, /archived_reason: "theme_calendar_no_longer_matches"/);
  assert.match(autopilotSource, /SET status = 'archived'/);
  // A settings read failure must not stop the queue.
  assert.match(autopilotSource, /theme re-check unavailable/);
});

test("keyword filters survive normalization and are capped", () => {
  const rows = normalizeThemeCalendar([
    themeBlock({ key: "skechers", filters: { keywords: ["Skechers", "sketcher", "Skechers", ...Array.from({ length: 20 }, (_, i) => `word${i}`)] } }),
  ]);
  const keywords = rows[0].filters.keywords;
  assert.ok(keywords.includes("Skechers"));
  assert.ok(keywords.includes("sketcher"));
  assert.ok(keywords.length <= 12, "keywords are capped so a block can't carry an unbounded list");
});

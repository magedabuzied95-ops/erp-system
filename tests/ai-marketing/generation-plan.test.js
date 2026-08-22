import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GENERATION_PLAN_LIMITS, resolveGenerationPlan } from "../../server/services/aiMarketingCenterService.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const settings = {
  stories_per_day: 12,
  posts_per_day: 3,
  daily_content_quotas: [{ active: true, stories_per_day: 12, posts_per_day: 3 }],
};

test("legacy run types keep their fixed sizing and never pin days", () => {
  assert.deepEqual(
    resolveGenerationPlan({ runType: "monthly", settings }),
    {
      run_type: "monthly",
      days: 30,
      stories_per_day: 12,
      posts_per_day: 3,
      requested_stories: 360,
      requested_posts: 90,
      start_offset: 0,
      horizon_days: 30,
      pin_days: false,
    }
  );
  assert.equal(resolveGenerationPlan({ runType: "weekly", settings }).days, 7);
  assert.equal(resolveGenerationPlan({ runType: "daily", settings }).days, 1);
});

test("a sized plan is N days × per-day, pinned, and may start tomorrow", () => {
  const plan = resolveGenerationPlan({
    runType: "plan",
    overrides: { days: 30, stories_per_day: 10, posts_per_day: 0, start_tomorrow: true },
    settings,
  });
  assert.equal(plan.run_type, "plan");
  assert.equal(plan.requested_stories, 300);
  assert.equal(plan.requested_posts, 0);
  assert.equal(plan.pin_days, true);
  assert.equal(plan.start_offset, 1);
  assert.equal(plan.horizon_days, 31);
});

test("plan sizing is clamped to the documented limits", () => {
  const plan = resolveGenerationPlan({
    runType: "plan",
    overrides: { days: 99, stories_per_day: 999, posts_per_day: 999 },
    settings,
  });
  assert.equal(plan.days, GENERATION_PLAN_LIMITS.max_days);
  assert.equal(plan.stories_per_day, GENERATION_PLAN_LIMITS.max_stories_per_day);
  assert.equal(plan.posts_per_day, GENERATION_PLAN_LIMITS.max_posts_per_day);
  assert.equal(plan.requested_stories, GENERATION_PLAN_LIMITS.max_total_stories);
  assert.equal(plan.requested_posts, GENERATION_PLAN_LIMITS.max_total_posts);
});

test("an omitted per-day count falls back to the engine settings, an explicit 0 means none", () => {
  const fallback = resolveGenerationPlan({ runType: "plan", overrides: { days: 7 }, settings });
  assert.equal(fallback.stories_per_day, 12);
  assert.equal(fallback.posts_per_day, 3);
  const none = resolveGenerationPlan({ runType: "plan", overrides: { days: 7, posts_per_day: 0 }, settings });
  assert.equal(none.posts_per_day, 0);
  assert.equal(none.requested_posts, 0);
});

test("the plan endpoint is registered on both router mounts and the header button opens the planner", () => {
  const centerRoutes = read("../../server/routes/aiMarketingCenter.js");
  const marketingRoutes = read("../../server/routes/marketing.js");
  assert.match(centerRoutes, /router\.post\("\/generate\/plan", protect, permit\("marketing", "create"\), generateAutonomousAiMarketingPlan\)/);
  assert.match(marketingRoutes, /router\.post\("\/ai-center\/generate\/plan", protect, permit\("marketing", "create"\), generateAutonomousAiMarketingPlan\)/);

  const page = read("../../src/modules/marketing/pages/AiMarketingCenter.jsx");
  assert.match(page, /<GenerationPlanModal/);
  // The headline action sizes a plan; it must not silently fire a one-day run.
  assert.match(page, /onClick=\{\(\) => setPlanOpen\(true\)\}[\s\S]{0,400}?إنشاء الطابور/);

  const api = read("../../src/modules/marketing/services/marketingApi.js");
  assert.match(api, /api\.post\("\/marketing\/ai-center\/generate\/plan", body\)/);
});

test("the scheduler honours a pinned plan day exactly like a theme day", () => {
  const source = read("../../server/services/aiMarketingCenterService.js");
  assert.match(source, /metadata\.theme_day_offset \?\? metadata\.plan_day_offset/);
  // Day pinning is by ordinal within the content type: k-th story → day floor(k / N).
  assert.match(source, /Math\.floor\(ordinal \/ perDay\)/);
  // A sized plan's schedule state spans the horizon (days + start offset), not the run-type label.
  assert.match(source, /createScheduleState\(runType, postingInsights, plan\.horizon_days\)/);
});

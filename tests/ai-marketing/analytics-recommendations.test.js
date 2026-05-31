import test from "node:test";
import assert from "node:assert/strict";
import { __marketingAnalyticsTestHooks } from "../../server/services/marketingAnalyticsService.js";

const { calculatePerformanceScore, hasRealMetricValue, performanceLabel } = __marketingAnalyticsTestHooks;

test("performance sync skips snapshots when Meta returns no usable metrics", () => {
  assert.equal(hasRealMetricValue({ warnings: ["permission missing"] }), false);
  assert.equal(hasRealMetricValue({ reach: null, impressions: null, likes: null }), false);
});

test("performance sync stores snapshots only when real metrics exist", () => {
  assert.equal(hasRealMetricValue({ reach: 1200 }), true);
  assert.equal(hasRealMetricValue({ likes: 4 }), true);
  assert.equal(hasRealMetricValue({ clicks: 1 }), true);
});

test("performance score remains between 0 and 100 and labels map correctly", () => {
  const high = calculatePerformanceScore({ reach: 10000, impressions: 12000, likes: 600, comments: 80, shares: 40, saves: 30, clicks: 70 });
  const average = calculatePerformanceScore({ reach: 1200, impressions: 2000, likes: 30, comments: 5, shares: 2, saves: 1, clicks: 2 });
  const low = calculatePerformanceScore({ reach: 10, impressions: 1000, likes: 1 });
  for (const score of [high, average, low]) {
    assert.ok(score >= 0);
    assert.ok(score <= 100);
  }
  assert.equal(performanceLabel(0), "No Data");
  assert.equal(performanceLabel(80), "High Performer");
  assert.equal(performanceLabel(50), "Average");
  assert.equal(performanceLabel(10), "Low Performer");
});

test("recommendations are withheld until enough real snapshots exist", () => {
  const build = (snapshots) => {
    if (snapshots.length < 3) {
      return {
        recommendations: [],
        performance_insufficient_data: true,
        performance_insufficient_data_message: "Not enough performance data yet. Publish more content and sync insights to unlock recommendations.",
      };
    }
    const jordan = snapshots.filter((row) => row.brand === "Jordan");
    return {
      recommendations: jordan.length ? [{ title: "Generate more Jordan content", source: "performance_snapshots" }] : [],
      performance_insufficient_data: false,
    };
  };
  assert.equal(build([]).performance_insufficient_data_message, "Not enough performance data yet. Publish more content and sync insights to unlock recommendations.");
  const enough = build([
    { brand: "Jordan", performance_score: 80 },
    { brand: "Jordan", performance_score: 70 },
    { brand: "Adidas", performance_score: 30 },
  ]);
  assert.equal(enough.performance_insufficient_data, false);
  assert.equal(enough.recommendations[0].source, "performance_snapshots");
});

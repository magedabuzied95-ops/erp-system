import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db, { withReadOnlyDbSession } from "../database/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reportsDir = path.join(__dirname, "..", "reports");
const reportPath = path.join(reportsDir, "social-comment-latency-benchmark.json");

const REQUESTED_SAMPLE_COUNT = 20;
const METRIC_FIELDS = [
  ["webhook_to_enqueue_ms", "webhook_to_enqueue_ms"],
  ["runtime_phase_ms", "runtime_phase_ms"],
  ["public_reply_send_ms", "public_reply_send_ms"],
  ["private_reply_send_ms", "send_ms"],
  ["total_comment_reply_ms", "total_comment_reply_ms"],
];

const text = (value = "") => String(value ?? "").trim();
const asObject = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);
const numberOrNull = (value = null) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const emptyMetricSummary = () => ({
  average: null,
  median: null,
  p95: null,
  min: null,
  max: null,
});

const percentile = (values = [], ratio = 0.95) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? null;
};

const average = (values = []) => {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const median = (values = []) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const summarizeMetric = (values = []) => {
  const normalized = values.map(numberOrNull).filter((value) => value != null);
  if (!normalized.length) return emptyMetricSummary();
  return {
    average: average(normalized),
    median: median(normalized),
    p95: percentile(normalized, 0.95),
    min: Math.min(...normalized),
    max: Math.max(...normalized),
  };
};

const buildEmptyMetrics = () =>
  Object.fromEntries(METRIC_FIELDS.map(([reportKey]) => [reportKey, emptyMetricSummary()]));

const readLatestCompletedRuns = async () => withReadOnlyDbSession(async () => {
  const result = await db.query(
    `
      SELECT
        id,
        tenant_id,
        platform,
        comment_id,
        post_id,
        status,
        created_at,
        updated_at,
        processed_at,
        automation_state
      FROM social_comment_automation_runs
      WHERE LOWER(COALESCE(status, '')) = 'completed'
        AND jsonb_typeof(COALESCE(automation_state, '{}'::jsonb)) = 'object'
        AND jsonb_typeof(COALESCE(automation_state->'runtime_monitor', '{}'::jsonb)) = 'object'
        AND jsonb_typeof(COALESCE(automation_state->'runtime_monitor'->'latency_summary', '{}'::jsonb)) = 'object'
        AND NULLIF(automation_state->'runtime_monitor'->'latency_summary'->>'total_comment_reply_ms', '') IS NOT NULL
      ORDER BY COALESCE(processed_at, updated_at, created_at) DESC, id DESC
      LIMIT $1
    `,
    [REQUESTED_SAMPLE_COUNT]
  );
  return asArray(result.rows);
}, { is_regression_test: true, dry_run: true, db_read_only: true });

const buildSample = (row = {}) => {
  const automationState = asObject(row.automation_state);
  const runtimeMonitor = asObject(automationState.runtime_monitor);
  const latencySummary = asObject(runtimeMonitor.latency_summary);
  return {
    id: Number(row.id || 0) || null,
    tenant_id: Number(row.tenant_id || 0) || null,
    platform: text(row.platform || ""),
    status: text(row.status || ""),
    comment_id: text(row.comment_id || ""),
    post_id: text(row.post_id || ""),
    processed_at: row.processed_at || row.updated_at || row.created_at || null,
    webhook_to_enqueue_ms: numberOrNull(latencySummary.webhook_to_enqueue_ms),
    runtime_phase_ms: numberOrNull(latencySummary.runtime_phase_ms),
    public_reply_send_ms: numberOrNull(latencySummary.public_reply_send_ms),
    private_reply_send_ms: numberOrNull(latencySummary.send_ms),
    total_comment_reply_ms: numberOrNull(latencySummary.total_comment_reply_ms),
  };
};

const buildReport = (rows = []) => {
  const samples = rows.map(buildSample);
  const metrics = Object.fromEntries(
    METRIC_FIELDS.map(([reportKey, sourceKey]) => [
      reportKey,
      summarizeMetric(samples.map((sample) => sample[sourceKey])),
    ])
  );
  const measuredSampleCount = samples.length;
  const base = {
    report_name: "social-comment-latency-benchmark",
    generated_at: new Date().toISOString(),
    source: {
      table: "social_comment_automation_runs",
      status: "completed",
      ordering: "processed_at_desc",
      requested_sample_count: REQUESTED_SAMPLE_COUNT,
      measured_sample_count: measuredSampleCount,
    },
    status: measuredSampleCount >= REQUESTED_SAMPLE_COUNT ? "available" : "unavailable",
    reason: measuredSampleCount >= REQUESTED_SAMPLE_COUNT
      ? ""
      : measuredSampleCount === 0
        ? "No completed social comment runs with runtime_monitor.latency_summary.total_comment_reply_ms were found."
        : `Only ${measuredSampleCount} completed social comment runs with latency_summary.total_comment_reply_ms were found; ${REQUESTED_SAMPLE_COUNT} are required for the benchmark.`,
    metrics,
    samples,
    notes: measuredSampleCount >= REQUESTED_SAMPLE_COUNT
      ? [
          `Benchmark computed from the latest ${measuredSampleCount} completed social comment runs with persisted latency summary data.`,
          "private_reply_send_ms is sourced from runtime_monitor.latency_summary.send_ms.",
        ]
      : [
          "Benchmark generation requires completed social comment runs with persisted runtime_monitor.latency_summary.total_comment_reply_ms.",
          "Regenerate this file after more completed runs are available.",
        ],
  };
  if (measuredSampleCount >= REQUESTED_SAMPLE_COUNT) return base;
  return {
    ...base,
    metrics: measuredSampleCount ? metrics : buildEmptyMetrics(),
  };
};

const main = async () => {
  const rows = await readLatestCompletedRuns();
  const report = buildReport(rows);
  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log("SOCIAL_COMMENT_LATENCY_BENCHMARK_WRITTEN", {
    path: reportPath,
    status: report.status,
    measured_sample_count: report.source.measured_sample_count,
  });
};

main()
  .catch((error) => {
    console.error("SOCIAL_COMMENT_LATENCY_BENCHMARK_FAILED", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end().catch(() => {});
  });

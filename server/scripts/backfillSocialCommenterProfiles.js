/*
 * Name the people who commented on the page's posts — the backlog the live paths
 * (webhook, thread open, the one-minute sweep) will otherwise work through slowly.
 *
 * Every lookup goes through lookupSocialCommenterProfiles, i.e. the same code
 * production runs: the stored-profile cache, the shared limiter's background lane,
 * the refusal memory on the comment rows. Nothing here talks to Graph directly.
 *
 *   node server/scripts/backfillSocialCommenterProfiles.js --census          # read-only counts
 *   node server/scripts/backfillSocialCommenterProfiles.js --probe 3         # ask about 3 commenters, print what came back
 *   node server/scripts/backfillSocialCommenterProfiles.js --limit 150       # backfill up to 150 commenters
 *
 * Options: --tenant <id> (default 1), --batch <n> (default 5), --pause-ms <ms> between
 * batches (default 3000), --max-wait-ms <ms> total wait for the Graph budget (default
 * 10 min; past it the run stops with exit 75).
 *
 * Exit codes: 0 done, 1 fatal, 75 the Graph budget stayed under pressure — try later.
 */
import "dotenv/config";
import db from "../database/db.js";
import { listSocialCommenterLookupCandidates, lookupSocialCommenterProfiles } from "../services/metaIntegrationService.js";
import { getMetaGraphBudgetSnapshot, shouldDeferBackgroundGraphWork } from "../services/metaGraphRateLimiter.js";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};

const TENANT_ID = Number(option("tenant", process.env.STOREFRONT_TENANT_ID || "1")) || 1;
const CENSUS = flag("census");
const PROBE = Math.max(0, Number(option("probe", "0")) || 0);
const LIMIT = Math.max(0, Number(option("limit", "0")) || 0);
const BATCH = Math.max(1, Number(option("batch", "5")) || 5);
const PAUSE_MS = Math.max(0, Number(option("pause-ms", "3000")) || 0);
const MAX_WAIT_MS = Math.max(0, Number(option("max-wait-ms", String(10 * 60 * 1000))) || 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (...parts) => console.log(`[${stamp()}]`, ...parts);

const census = async () => {
  const result = await db.query(
    `
    SELECT
      platform,
      COUNT(*) FILTER (WHERE COALESCE(raw_payload->>'is_page_authored', '') <> 'true') AS comments,
      COUNT(*) FILTER (WHERE COALESCE(raw_payload->>'is_page_authored', '') <> 'true' AND COALESCE(commenter_id, '') <> '') AS with_id,
      COUNT(*) FILTER (WHERE COALESCE(raw_payload->>'is_page_authored', '') <> 'true' AND COALESCE(commenter_name, '') <> '' AND commenter_name !~ '^[0-9]+$') AS named,
      COUNT(*) FILTER (WHERE COALESCE(raw_payload->>'is_page_authored', '') <> 'true' AND COALESCE(commenter_profile_picture_url, '') <> '') AS pictured,
      COUNT(*) FILTER (WHERE COALESCE(raw_payload->>'is_page_authored', '') <> 'true' AND COALESCE(commenter_id, '') = '') AS no_id_at_all,
      COUNT(DISTINCT commenter_id) FILTER (WHERE COALESCE(commenter_id, '') <> '') AS distinct_commenters,
      COUNT(*) FILTER (WHERE raw_payload->'profile_lookup'->>'status' = 'ok') AS lookup_ok,
      COUNT(*) FILTER (WHERE raw_payload->'profile_lookup'->>'status' = 'incomplete') AS lookup_incomplete,
      COUNT(*) FILTER (WHERE raw_payload->'profile_lookup'->>'status' = 'refused') AS lookup_refused,
      COUNT(*) FILTER (WHERE raw_payload->'profile_lookup'->>'status' = 'failed') AS lookup_failed
    FROM social_comment_automation_runs
    WHERE tenant_id = $1
      AND platform IN ('facebook', 'instagram')
      AND COALESCE(NULLIF(raw_payload->>'item', ''), 'comment') = 'comment'
    GROUP BY platform
    ORDER BY platform
    `,
    [TENANT_ID]
  );
  log(`tenant ${TENANT_ID} — comment identity per platform (page's own replies excluded)`);
  for (const row of result.rows) log(JSON.stringify(row));
  const candidates = await listSocialCommenterLookupCandidates({ tenantId: TENANT_ID, limit: 500 });
  const byPlatform = candidates.reduce((acc, row) => ({ ...acc, [row.platform]: (acc[row.platform] || 0) + 1 }), {});
  log(`commenters worth a lookup now (missing/expired, outside backoff): ${candidates.length}`, byPlatform);

  // A row still missing a face that the lookup will never pick up: why not. Without
  // this the census says "2 candidates" while dozens of comments show initials.
  const unreachable = await db.query(
    `
    SELECT
      platform,
      COUNT(*) FILTER (WHERE commenter_id !~ '^[0-9]{5,}$') AS id_not_scoped,
      COUNT(*) FILTER (WHERE commenter_id ~ '^[0-9]{5,}$' AND COALESCE(processed_at, created_at) <= NOW() - INTERVAL '120 days') AS older_than_window,
      COUNT(*) FILTER (WHERE commenter_id ~ '^[0-9]{5,}$' AND raw_payload ? 'profile_lookup') AS in_backoff,
      COUNT(*) AS total
    FROM social_comment_automation_runs
    WHERE tenant_id = $1
      AND platform IN ('facebook', 'instagram')
      AND COALESCE(raw_payload->>'is_page_authored', '') <> 'true'
      AND COALESCE(NULLIF(raw_payload->>'item', ''), 'comment') = 'comment'
      AND COALESCE(commenter_profile_picture_url, '') = ''
    GROUP BY platform
    ORDER BY platform
    `,
    [TENANT_ID]
  );
  log("comments with no picture, by why the lookup cannot reach them:");
  for (const row of unreachable.rows) log(JSON.stringify(row));
  return 0;
};

const run = async (cap) => {
  const totals = { looked_up: 0, ok: 0, incomplete: 0, refused: 0, failed: 0, named: 0, pictured: 0 };
  const kinds = {};
  let waited = 0;
  while (totals.looked_up < cap) {
    const budget = shouldDeferBackgroundGraphWork();
    if (budget.defer) {
      if (waited >= MAX_WAIT_MS) {
        log("Graph budget still under pressure — stopping", { waited_ms: waited, budget: getMetaGraphBudgetSnapshot() });
        log("totals", totals, kinds);
        return 75;
      }
      const pause = Math.min(Math.max(5000, Number(budget.retry_after_ms) || 30000), 60000);
      log(`budget ${budget.reason} — waiting ${Math.round(pause / 1000)}s`);
      await sleep(pause);
      waited += pause;
      continue;
    }
    let seen = 0;
    await lookupSocialCommenterProfiles({
      tenantId: TENANT_ID,
      limit: Math.min(BATCH, cap - totals.looked_up),
      source: "backfill_script",
      onResult: (report) => {
        seen += 1;
        totals.looked_up += 1;
        totals[report.status] = (totals[report.status] || 0) + 1;
        if (report.has_name) totals.named += 1;
        if (report.has_picture) totals.pictured += 1;
        if (report.kind) kinds[report.kind] = (kinds[report.kind] || 0) + 1;
        log(`${report.platform}:${report.commenter} → ${report.status}${report.kind ? ` (${report.kind})` : ""} name=${report.has_name ? "yes" : "no"} picture=${report.has_picture ? "yes" : "no"} rows=${report.rows_updated}`);
      },
    });
    if (!seen) {
      // Nothing was asked: either the budget closed in the meantime (loop and wait) or
      // there is genuinely nobody left.
      if (shouldDeferBackgroundGraphWork().defer) continue;
      log("no more commenters to look up");
      break;
    }
    if (PAUSE_MS) await sleep(PAUSE_MS);
  }
  log("done", totals, Object.keys(kinds).length ? kinds : "");
  log("graph budget at exit", getMetaGraphBudgetSnapshot());
  return 0;
};

const main = async () => {
  if (CENSUS) return census();
  if (PROBE) return run(PROBE);
  if (LIMIT) return run(LIMIT);
  console.error("Usage: --census | --probe <n> | --limit <n>  [--tenant 1] [--batch 5] [--pause-ms 3000] [--max-wait-ms 600000]");
  return 1;
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error("[commenter-profile-backfill] fatal", error?.message || error);
    process.exit(1);
  });

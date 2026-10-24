// Integration background jobs (insights refresh, competitor scans and reports, CAPI retries). See ../metaAdsScheduler.js.
// One tenant / account failing never stops the others.

import db from "../../../database/db.js";
import { getAccountContext, syncInsights, syncStructure } from "../metaAdsCore.js";
import { syncCatalogRejections } from "../metaAdsCatalogRejections.js";
import { scanCompetitor } from "./competitors.js";
import { scanCompetitorPosts } from "./competitorPosts.js";
import { isScheduleDue, runReportSchedule } from "./competitorReports.js";
import { enqueuePurchaseEvents, retryFailedEvents } from "./conversions.js";
import { TOKEN_INVALID_RE, clip, log, text, warn } from "./integrationsCommon.js";

const connectedAccounts = async () => {
  const { rows } = await db.query(
    `SELECT id, tenant_id, last_sync_error FROM meta_ads_accounts
      WHERE COALESCE(user_access_token_encrypted, '') <> '' AND (token_expires_at IS NULL OR token_expires_at > NOW())
      ORDER BY last_synced_at NULLS FIRST, id`,
  );
  return rows;
};

// One pass over every connected account; `label` names the job in the log and `days` the
// insights window (0 = the account's whole history).
const syncAccounts = async (label, { days, structure, rejections = false }) => {
  const rows = await connectedAccounts();
  let ok = 0;
  let skipped = 0;
  for (const row of rows) {
    if (TOKEN_INVALID_RE.test(text(row.last_sync_error))) {
      skipped += 1;
      continue;
    }
    try {
      const ctx = await getAccountContext(row.tenant_id, row.id);
      if (structure) await syncStructure(ctx);
      await syncInsights(ctx, { days });
      if (rejections) {
        // Rejected catalogue items leave the Meta feed; a failure here never fails the insights pass.
        await syncCatalogRejections(ctx).catch((error) => warn(`${label}-catalog-rejections`, error, { tenant_id: row.tenant_id, account_id: row.id }));
      }
      await db.query(`UPDATE meta_ads_accounts SET last_synced_at = NOW(), last_sync_error = NULL WHERE tenant_id = $1 AND id = $2`, [row.tenant_id, row.id]);
      ok += 1;
    } catch (error) {
      warn(label, error, { tenant_id: row.tenant_id, account_id: row.id });
      await db.query(`UPDATE meta_ads_accounts SET last_sync_error = $3 WHERE tenant_id = $1 AND id = $2`, [row.tenant_id, row.id, clip(error?.message, 500)]).catch(() => {});
    }
  }
  if (rows.length) log(label, { accounts: rows.length, ok, skipped });
  return { ok, skipped };
};

// Hourly: the structure (statuses, verdicts) and the last three days, which is where Meta's
// numbers still move. Daily: the whole history, so a day the hourly pass never saw (a deploy, a
// token lapse, an account connected later) is filled in rather than left as a hole in the chart.
const refreshInsights = () => syncAccounts("job-insights", { days: 3, structure: true });
const backfillInsights = () => syncAccounts("job-insights-backfill", { days: 0, structure: false, rejections: true });

const scanCompetitors = async () => {
  const { rows } = await db.query(
    `SELECT id, tenant_id FROM meta_ads_competitors
      WHERE active = TRUE AND (last_scanned_at IS NULL OR last_scanned_at < NOW() - INTERVAL '20 hours')
      ORDER BY last_scanned_at NULLS FIRST, id LIMIT 100`,
  );
  let ok = 0;
  for (const row of rows) {
    try {
      await scanCompetitor(row.tenant_id, row.id);
      ok += 1;
    } catch (error) {
      warn("job-competitor", error, { tenant_id: row.tenant_id, competitor: row.id });
    }
  }
  return { scanned: ok, due: rows.length };
};

// Daily, and only with APIFY_TOKEN set: every page Apify can find (saved link, page id or Instagram account).
const scanCompetitorPostsJob = async () => {
  if (!text(process.env.APIFY_TOKEN)) return { skipped: "no APIFY_TOKEN" };
  const { rows } = await db.query(
    `SELECT id, tenant_id FROM meta_ads_competitors
      WHERE active = TRUE AND (COALESCE(facebook_url, '') <> '' OR COALESCE(page_id, '') <> '' OR COALESCE(instagram, '') <> '')
        AND (posts_scanned_at IS NULL OR posts_scanned_at < NOW() - INTERVAL '20 hours')
      ORDER BY posts_scanned_at NULLS FIRST, id LIMIT 50`,
  );
  let ok = 0;
  for (const row of rows) {
    try {
      await scanCompetitorPosts(row.tenant_id, row.id);
      ok += 1;
    } catch (error) {
      warn("job-competitor-posts", error, { tenant_id: row.tenant_id, competitor: row.id });
    }
  }
  return { scanned: ok, due: rows.length };
};

// Hourly check; each schedule sends once a week on its weekday (see isScheduleDue).
const sendCompetitorReports = async () => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_competitor_report_schedules WHERE active = TRUE ORDER BY id`);
  const now = new Date();
  let sent = 0;
  for (const schedule of rows.filter((row) => isScheduleDue(row, now))) {
    try {
      await runReportSchedule(schedule.tenant_id, schedule.id);
      sent += 1;
    } catch (error) {
      warn("job-competitor-report", error, { tenant_id: schedule.tenant_id, schedule: schedule.id });
    }
  }
  return { sent };
};

const runCapi = async () => {
  const retries = await retryFailedEvents().catch((error) => {
    warn("job-capi-retry", error);
    return null;
  });
  const { rows } = await db.query(`SELECT DISTINCT tenant_id FROM meta_ads_conversion_datasets WHERE enabled = TRUE`);
  for (const row of rows) {
    await enqueuePurchaseEvents(row.tenant_id).catch((error) => warn("job-capi-purchase", error, { tenant_id: row.tenant_id }));
  }
  return { retries, tenants: rows.length };
};

export const jobs = [
  { name: "meta-ads-insights-refresh", everyMinutes: 60, run: refreshInsights },
  { name: "meta-ads-insights-backfill", everyMinutes: 1440, run: backfillInsights },
  { name: "meta-ads-competitor-scan", everyMinutes: 1440, run: scanCompetitors },
  { name: "meta-ads-competitor-posts-scan", everyMinutes: 1440, run: scanCompetitorPostsJob },
  { name: "meta-ads-competitor-reports", everyMinutes: 60, run: sendCompetitorReports },
  { name: "meta-ads-capi", everyMinutes: 10, run: runCapi },
];

// Integration background jobs (insights refresh, competitor scans, CAPI retries). See ../metaAdsScheduler.js.
// One tenant / account failing never stops the others.

import db from "../../../database/db.js";
import { getAccountContext, syncInsights, syncStructure } from "../metaAdsCore.js";
import { scanCompetitor } from "./competitors.js";
import { enqueuePurchaseEvents, retryFailedEvents } from "./conversions.js";
import { TOKEN_INVALID_RE, clip, log, text, warn } from "./integrationsCommon.js";

const refreshInsights = async () => {
  const { rows } = await db.query(
    `SELECT id, tenant_id, last_sync_error FROM meta_ads_accounts
      WHERE COALESCE(user_access_token_encrypted, '') <> '' AND (token_expires_at IS NULL OR token_expires_at > NOW())
      ORDER BY last_synced_at NULLS FIRST, id`,
  );
  let ok = 0;
  let skipped = 0;
  for (const row of rows) {
    if (TOKEN_INVALID_RE.test(text(row.last_sync_error))) {
      skipped += 1;
      continue;
    }
    try {
      const ctx = await getAccountContext(row.tenant_id, row.id);
      await syncStructure(ctx);
      await syncInsights(ctx, { days: 3 });
      await db.query(`UPDATE meta_ads_accounts SET last_synced_at = NOW(), last_sync_error = NULL WHERE tenant_id = $1 AND id = $2`, [row.tenant_id, row.id]);
      ok += 1;
    } catch (error) {
      warn("job-insights", error, { tenant_id: row.tenant_id, account_id: row.id });
      await db.query(`UPDATE meta_ads_accounts SET last_sync_error = $3 WHERE tenant_id = $1 AND id = $2`, [row.tenant_id, row.id, clip(error?.message, 500)]).catch(() => {});
    }
  }
  if (rows.length) log("job-insights", { accounts: rows.length, ok, skipped });
  return { ok, skipped };
};

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
  { name: "meta-ads-competitor-scan", everyMinutes: 1440, run: scanCompetitors },
  { name: "meta-ads-capi", everyMinutes: 10, run: runCapi },
];

// Background sync for TikTok Ads: every hour the last 3 days (today's numbers settle
// for ~a day), and once a day the last 30 days. TIKTOK_ADS_JOBS_ENABLED=false turns both off.

import { isTikTokAdsSchemaReady } from "./tiktokAdsSchema.js";
import { connectedAccountContexts, describeTikTokAdsSetup, getAccountContext, syncAll } from "./tiktokAdsCore.js";
import { redactTikTokAds } from "./tiktokAdsApi.js";

export const TIKTOK_ADS_JOBS = Object.freeze([
  { name: "tiktok-ads-recent", everyMinutes: 60, days: 3 },
  { name: "tiktok-ads-backfill", everyMinutes: 24 * 60, days: 30 },
]);

const running = new Set();
let started = false;

export const runTikTokAdsSync = async ({ days }) => {
  if (!isTikTokAdsSchemaReady() || !describeTikTokAdsSetup().ready) return { skipped: true };
  const results = [];
  for (const { tenant_id: tenantId, id } of await connectedAccountContexts()) {
    try {
      const ctx = await getAccountContext(tenantId, id);
      results.push({ id, ...(await syncAll(ctx, { days })) });
    } catch (error) {
      console.warn("[tiktok-ads] sync failed", { account_id: id, message: redactTikTokAds(error) });
      results.push({ id, error: true });
    }
  }
  return { results };
};

const runJob = async (job) => {
  if (running.has(job.name)) return;
  running.add(job.name);
  try {
    await runTikTokAdsSync(job);
  } finally {
    running.delete(job.name);
  }
};

export const startTikTokAdsScheduler = ({ register = () => {} } = {}) => {
  if (String(process.env.TIKTOK_ADS_JOBS_ENABLED || "true").toLowerCase() === "false") {
    console.log("[tiktok-ads] background jobs disabled (TIKTOK_ADS_JOBS_ENABLED=false)");
    return;
  }
  if (started) return;
  started = true;
  TIKTOK_ADS_JOBS.forEach((job, index) => {
    const timer = setInterval(() => void runJob(job), job.everyMinutes * 60 * 1000);
    timer.unref?.();
    register(timer);
    // Staggered first run so a deploy never stampedes the API.
    setTimeout(() => void runJob(job), 120_000 + index * 60_000).unref?.();
  });
  console.log("[tiktok-ads] background jobs started", { jobs: TIKTOK_ADS_JOBS.length });
};

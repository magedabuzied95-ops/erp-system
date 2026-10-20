// Background jobs for Meta Ads. Each sub-area exports a `jobs` array of
//   { name, everyMinutes, run: async () => any }
// and this file runs them on their own interval with a per-job overlap lock.
// META_ADS_JOBS_ENABLED=false turns every job off (e.g. on a staging copy).

import { isMetaAdsSchemaReady } from "./metaAdsSchema.js";
import { jobs as managerJobs } from "./manager/manager.jobs.js";
import { jobs as integrationJobs } from "./integrations/integrations.jobs.js";

const timers = [];
const running = new Set();

const runJob = async (job) => {
  if (running.has(job.name) || !isMetaAdsSchemaReady()) return;
  running.add(job.name);
  try {
    await job.run();
  } catch (error) {
    console.warn(`[meta-ads] job ${job.name} failed`, { message: String(error?.message || error).slice(0, 300) });
  } finally {
    running.delete(job.name);
  }
};

export const startMetaAdsScheduler = ({ register = () => {} } = {}) => {
  if (String(process.env.META_ADS_JOBS_ENABLED || "true").toLowerCase() === "false") {
    console.log("[meta-ads] background jobs disabled (META_ADS_JOBS_ENABLED=false)");
    return;
  }
  if (timers.length) return;
  for (const job of [...managerJobs, ...integrationJobs]) {
    const everyMs = Math.max(1, Number(job.everyMinutes) || 15) * 60 * 1000;
    const timer = setInterval(() => void runJob(job), everyMs);
    timer.unref?.();
    register(timer);
    timers.push(timer);
    // Stagger the first run so a deploy never stampedes the Graph API.
    setTimeout(() => void runJob(job), 90_000 + timers.length * 15_000).unref?.();
  }
  console.log("[meta-ads] background jobs started", { jobs: timers.length });
};

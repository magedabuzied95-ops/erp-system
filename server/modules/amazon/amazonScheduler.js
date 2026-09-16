// Automatic order synchronization (Phase 13). OFF unless AMAZON_ORDER_AUTO_SYNC_ENABLED=true.
// Interval defaults to 15 min (min 10): searchOrders allows ~1 request / 3 min after a burst of 20,
// so a 15-minute cadence stays far inside the limit. The job lock prevents overlapping runs,
// including a manual sync started while a scheduled one is still going.

import { amazonFlags, amazonTenantId, isAmazonConfigured } from "./amazonConfig.js";
import { isAmazonSchemaReady } from "./amazonSchema.js";
import { runAmazonOrdersSync } from "./amazonOrdersSync.js";
import { projectAmazonOrder } from "./amazonOrderProjection.js";

let timer = null;
let tickRunning = false;

export const amazonSchedulerState = () => ({ running: Boolean(timer), tick_in_progress: tickRunning });

export const runScheduledAmazonOrderSync = async () => {
  if (tickRunning) return { skipped: true, reason: "tick_in_progress" };
  if (!amazonFlags().orderAutoSync || !isAmazonConfigured() || !isAmazonSchemaReady()) {
    return { skipped: true, reason: "disabled" };
  }
  tickRunning = true;
  try {
    const result = await runAmazonOrdersSync({ tenantId: amazonTenantId(), trigger: "scheduled", projectOrder: projectAmazonOrder });
    if (result?.status === "failed") {
      console.warn("[amazon] scheduled order sync failed", { run_id: result.runId, category: result.error?.category });
    }
    return result;
  } catch (error) {
    console.warn("[amazon] scheduled order sync crashed", { message: String(error?.message || error).slice(0, 200) });
    return { skipped: true, reason: "error" };
  } finally {
    tickRunning = false;
  }
};

export const startAmazonScheduler = ({ register = () => {} } = {}) => {
  const flags = amazonFlags();
  if (!flags.orderAutoSync) {
    console.log("[amazon] automatic order sync is disabled (AMAZON_ORDER_AUTO_SYNC_ENABLED is not true)");
    return null;
  }
  if (timer) return timer;
  const everyMs = flags.orderAutoSyncMinutes * 60 * 1000;
  timer = setInterval(() => {
    void runScheduledAmazonOrderSync();
  }, everyMs);
  timer.unref?.();
  register(timer);
  // First run a minute after boot so a deploy never stampedes Amazon.
  setTimeout(() => void runScheduledAmazonOrderSync(), 60_000).unref?.();
  console.log("[amazon] automatic order sync started", { every_minutes: flags.orderAutoSyncMinutes });
  return timer;
};

export const stopAmazonScheduler = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

import { getTenantId } from "../utils/requestScope.js";
import {
  archiveAiMarketingQueueItem,
  approveAiMarketingQueueItem,
  buildAiMarketingPostingInsightsResponse,
  bulkAiMarketingQueueAction,
  deleteAiMarketingQueueItem,
  duplicateAiMarketingQueueItem,
  enqueueAiMarketingBatchGeneration,
  enqueueAiMarketingQueueStoryAssetGeneration,
  generateAiMarketingVideoBatch,
  getAiMarketingOverview,
  getAiMarketingSettings,
  listAiMarketingQueueTimeline,
  listAiMarketingQueue,
  publishAiMarketingQueueItemNow,
  pushAiMarketingOffersNow,
  restoreAiMarketingQueueItem,
  setAiMarketingAutomationActive,
  updateAiMarketingSettings,
} from "../services/aiMarketingCenterService.js";
import {
  applySuggestedStorySlots,
  buildSuggestedStorySlots,
  getStoryAutopilotSettings,
  getStoryAutopilotStatus,
  runStoryAutopilotForTenant,
  updateStoryAutopilotSettings,
} from "../services/aiMarketingStoryAutopilotService.js";

const tenantScope = (req) => getTenantId(req, req.user?.tenant_id) ?? 1;

const parseQueueItemId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Meta answers an app-level throttle with HTTP 400 and "(#4) Application request
// limit reached", so the only way to tell a throttle from a rejection here is the
// message the publish persisted.
const isMetaRateLimitMessage = (message = "") =>
  /\(#4\)|\(#17\)|application request limit|rate ?limit|too many calls/i.test(String(message || ""));

const sendError = (res, error, fallback = "AI marketing center request failed") => {
  const status = Number(error?.status || error?.statusCode || 500);
  res.status(status).json({ success: false, message: error?.message || fallback });
};

export const getAutonomousAiMarketingSettings = async (req, res) => {
  try {
    const settings = await getAiMarketingSettings(tenantScope(req));
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error, "Failed to load AI marketing settings");
  }
};

export const patchAutonomousAiMarketingSettings = async (req, res) => {
  try {
    const settings = await updateAiMarketingSettings(tenantScope(req), req.body || {});
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error, "Failed to update AI marketing settings");
  }
};

export const getStoryAutopilot = async (req, res) => {
  try {
    const payload = await getStoryAutopilotStatus(tenantScope(req));
    const suggestion = await buildSuggestedStorySlots({
      tenantId: tenantScope(req),
      count: Math.min(Math.max(payload.settings.max_per_day, 3), 6),
      timezone: payload.settings.timezone,
    });
    res.json({ success: true, ...payload, suggestion });
  } catch (error) {
    sendError(res, error, "Failed to load story autopilot settings");
  }
};

export const patchStoryAutopilot = async (req, res) => {
  try {
    const settings = await updateStoryAutopilotSettings(tenantScope(req), req.body || {});
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error, "Failed to update story autopilot settings");
  }
};

export const getStoryAutopilotSuggestions = async (req, res) => {
  try {
    const current = await getStoryAutopilotSettings(tenantScope(req));
    const suggestion = await buildSuggestedStorySlots({
      tenantId: tenantScope(req),
      count: Number(req.query?.count) || Math.min(Math.max(current.max_per_day, 3), 6),
      timezone: current.timezone,
    });
    res.json({ success: true, suggestion });
  } catch (error) {
    sendError(res, error, "Failed to build story posting suggestions");
  }
};

export const applyStoryAutopilotSuggestions = async (req, res) => {
  try {
    const result = await applySuggestedStorySlots(tenantScope(req), { count: Number(req.body?.count) || undefined });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, "Failed to apply story posting suggestions");
  }
};

export const runStoryAutopilotNow = async (req, res) => {
  try {
    const summary = await runStoryAutopilotForTenant(tenantScope(req), { trigger: "manual", force: true });
    res.json({ success: true, summary });
  } catch (error) {
    sendError(res, error, "Failed to run the story autopilot");
  }
};

export const getAutonomousAiMarketingOverview = async (req, res) => {
  try {
    const overview = await getAiMarketingOverview(tenantScope(req));
    res.json({ success: true, overview });
  } catch (error) {
    sendError(res, error, "Failed to load AI marketing overview");
  }
};

export const syncAutonomousAiMarketingInsights = async (req, res) => {
  try {
    const result = await buildAiMarketingPostingInsightsResponse({ tenantId: tenantScope(req), force: true });
    res.json(result);
  } catch (error) {
    sendError(res, error, "Failed to sync AI marketing insights");
  }
};

export const getAutonomousAiMarketingQueue = async (req, res) => {
  try {
    const queue = await listAiMarketingQueue(tenantScope(req), req.query || {});
    res.json({ success: true, queue });
  } catch (error) {
    sendError(res, error, "Failed to load AI marketing queue");
  }
};

const generate = (runType) => async (req, res) => {
  try {
    const result = await enqueueAiMarketingBatchGeneration({ tenantId: tenantScope(req), runType });
    res.status(202).json({ success: true, message: "Generation queued", ...result });
  } catch (error) {
    sendError(res, error, `Failed to generate ${runType} AI marketing batch`);
  }
};

export const generateAutonomousAiMarketingDaily = generate("daily");
export const generateAutonomousAiMarketingWeekly = generate("weekly");
export const generateAutonomousAiMarketingMonthly = generate("monthly");

// A sized plan: "N days × stories/day × posts/day", every day pinned exactly.
// `align_autopilot` also points the story autopilot at the queue's own
// scheduled_at times (queue_schedule) and widens its per-day cap and minimum
// gap so the plan can actually go out — otherwise the autopilot keeps
// publishing FIFO at its three fixed slots and the calendar is decoration.
export const generateAutonomousAiMarketingPlan = async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const tenantId = tenantScope(req);
    const plan = {
      days: body.days,
      stories_per_day: body.stories_per_day,
      posts_per_day: body.posts_per_day,
      start_tomorrow: body.start_tomorrow,
    };
    const result = await enqueueAiMarketingBatchGeneration({ tenantId, runType: "plan", plan });
    let autopilot = null;
    if (body.align_autopilot === true || body.align_autopilot === "true") {
      const current = await getStoryAutopilotSettings(tenantId);
      const storiesPerDay = Math.max(1, Number(result.plan?.stories_per_day) || 1);
      const [startH, startM] = String(current.window_start || "09:00").split(":").map(Number);
      const [endH, endM] = String(current.window_end || "23:30").split(":").map(Number);
      const windowMinutes = Math.max(60, endH * 60 + endM - (startH * 60 + startM));
      // Leave room for the generator's own spread: the gap must let N stories
      // fit in the window with slack, or the tail of each day dies to catch-up grace.
      const fittingGap = Math.max(5, Math.floor(windowMinutes / (storiesPerDay * 2)));
      autopilot = await updateStoryAutopilotSettings(tenantId, {
        enabled: true,
        schedule_mode: "queue_schedule",
        max_per_day: Math.max(Number(current.max_per_day) || 0, storiesPerDay),
        min_gap_minutes: Math.min(Number(current.min_gap_minutes) || 45, fittingGap),
        catchup_grace_minutes: Math.max(Number(current.catchup_grace_minutes) || 0, 240),
      });
    }
    res.status(202).json({ success: true, message: "Generation plan queued", ...result, autopilot });
  } catch (error) {
    sendError(res, error, "Failed to generate AI marketing plan");
  }
};

// "انشر العروض" — one click queues a story per offer product, scheduled across
// the rest of today; the story autopilot publishes each as its design renders.
export const pushAutonomousAiMarketingOffersNow = async (req, res) => {
  try {
    const limit = Number(req.body?.limit) || undefined;
    const result = await pushAiMarketingOffersNow({ tenantId: tenantScope(req), limit });
    res.status(202).json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, "Failed to push offer stories");
  }
};

const generateVideos = (runType) => async (req, res) => {
  try {
    const result = await generateAiMarketingVideoBatch({
      tenantId: tenantScope(req),
      runType,
      videosPerDay: Number(req.body?.videos_per_day || req.query?.videos_per_day || 4),
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, `Failed to generate ${runType} AI marketing videos`);
  }
};

export const generateAutonomousAiMarketingVideosDaily = generateVideos("daily");
export const generateAutonomousAiMarketingVideosWeekly = generateVideos("weekly");
export const generateAutonomousAiMarketingVideosMonthly = generateVideos("monthly");

export const approveAutonomousAiMarketingQueueItem = async (req, res) => {
  try {
    const item = await approveAiMarketingQueueItem(tenantScope(req), req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    return res.json({ success: true, item });
  } catch (error) {
    return sendError(res, error, "Failed to approve queue item");
  }
};

export const publishAutonomousAiMarketingQueueItemNow = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });
    const item = await publishAiMarketingQueueItemNow(tenantScope(req), id);
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    const platformResults = item.platform_publish_results || {};
    const platformEntries = Object.entries(platformResults);
    const failedPlatforms = platformEntries
      .filter(([, result]) => result?.status && !["published", "skipped"].includes(String(result.status).toLowerCase()))
      .map(([platform]) => platform);
    const publishedPlatforms = platformEntries
      .filter(([, result]) => String(result?.status || "").toLowerCase() === "published")
      .map(([platform]) => platform);
    const publishStatus = String(item.publish_status || item.status || "").toLowerCase();
    const published = publishStatus === "published" && failedPlatforms.length === 0;
    const partial = !published && publishedPlatforms.length > 0;
    const failureMessage =
      item.platform_error_message || item.publish_error || item.error_message || `Publishing failed${failedPlatforms.length ? ` on ${failedPlatforms.join(", ")}` : ""}`;
    const message = published ? "Content published successfully" : failureMessage;
    /*
      A publish that Meta refused is NOT a gateway failure. This used to answer
      502, and 502 never reached the browser as an answer: the proxy in front of
      the API owns that status class and replaces the body with an error page
      that carries no CORS header, so the console showed
      "blocked by CORS policy" + a bare NetworkError and the real reason — the
      rate limit, the rejected media — was nowhere to be seen. Same lesson the
      social publisher route already learned. The outcome belongs in the payload,
      and a total failure is reported with a 4xx the proxy passes through.
    */
    const status = published || partial ? 200 : isMetaRateLimitMessage(failureMessage) ? 429 : 422;
    return res.status(status).json({
      success: published,
      partial,
      published_platforms: publishedPlatforms,
      failed_platforms: failedPlatforms,
      item,
      message,
    });
  } catch (error) {
    return sendError(res, error, "Failed to publish queue item");
  }
};

export const generateAutonomousAiMarketingQueueStoryAsset = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });
    const result = await enqueueAiMarketingQueueStoryAssetGeneration(tenantScope(req), id, {
      force: req.body?.force === true || req.query?.force === "true",
    });
    const item = result?.item;
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    return res.status(result?.queued ? 202 : 200).json({
      success: true,
      queued: Boolean(result?.queued),
      reused: Boolean(result?.reused),
      message: result?.queued ? "Story asset generation queued" : "Story asset ready",
      rendered_image_url: item.rendered_image_url || "",
      story_image_url: item.story_image_url || item.rendered_image_url || "",
      final_asset_url: item.final_asset_url || item.story_image_url || item.rendered_image_url || "",
      selectedPublishUrl: item.selectedPublishUrl || item.final_asset_url || item.story_image_url || item.rendered_image_url || "",
      final_asset_url_raw: item.final_asset_url_raw || item.final_asset_url || "",
      selectedPublishUrl_raw: item.selectedPublishUrl_raw || item.final_asset_url_raw || item.final_asset_url || "",
      item,
    });
  } catch (error) {
    if (Number(error?.status || error?.statusCode) === 404) {
      return res.status(404).json({ success: false, message: "Queue item not found" });
    }
    if (Number(error?.status || error?.statusCode) === 400) {
      return sendError(res, error, "Failed to generate story asset");
    }
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to generate story asset",
    });
  }
};

export const deleteAutonomousAiMarketingQueueItem = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });

    const deleted = await deleteAiMarketingQueueItem(tenantScope(req), id);
    if (!deleted) return res.status(404).json({ success: false, message: "Queue item not found" });
    return res.json({ success: true, message: "Queue item deleted" });
  } catch (error) {
    return sendError(res, error, "Failed to delete queue item");
  }
};

export const archiveAutonomousAiMarketingQueueItem = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });
    const item = await archiveAiMarketingQueueItem(tenantScope(req), id);
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    return res.json({ success: true, item });
  } catch (error) {
    return sendError(res, error, "Failed to archive queue item");
  }
};

export const restoreAutonomousAiMarketingQueueItem = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });
    const item = await restoreAiMarketingQueueItem(tenantScope(req), id);
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    return res.json({ success: true, item });
  } catch (error) {
    return sendError(res, error, "Failed to restore queue item");
  }
};

export const duplicateAutonomousAiMarketingQueueItem = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });
    const item = await duplicateAiMarketingQueueItem(tenantScope(req), id);
    if (!item) return res.status(404).json({ success: false, message: "Queue item not found" });
    return res.status(201).json({ success: true, item });
  } catch (error) {
    return sendError(res, error, "Failed to duplicate queue item");
  }
};

export const bulkAutonomousAiMarketingQueueAction = async (req, res) => {
  try {
    const result = await bulkAiMarketingQueueAction(tenantScope(req), {
      action: req.body?.action,
      ids: Array.isArray(req.body?.ids) ? req.body.ids : [],
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to run bulk queue action");
  }
};

export const getAutonomousAiMarketingQueueTimeline = async (req, res) => {
  try {
    const id = parseQueueItemId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid queue item id" });
    const timeline = await listAiMarketingQueueTimeline(tenantScope(req), id);
    return res.json({ success: true, timeline });
  } catch (error) {
    return sendError(res, error, "Failed to load content history");
  }
};

export const pauseAutonomousAiMarketing = async (req, res) => {
  try {
    const settings = await setAiMarketingAutomationActive(tenantScope(req), false);
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error, "Failed to pause AI marketing automation");
  }
};

export const resumeAutonomousAiMarketing = async (req, res) => {
  try {
    const settings = await setAiMarketingAutomationActive(tenantScope(req), true);
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error, "Failed to resume AI marketing automation");
  }
};

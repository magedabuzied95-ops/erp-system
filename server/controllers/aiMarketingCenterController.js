import { getTenantId } from "../utils/requestScope.js";
import {
  approveAiMarketingQueueItem,
  buildAiMarketingPostingInsightsResponse,
  deleteAiMarketingQueueItem,
  generateAiMarketingBatch,
  generateAiMarketingVideoBatch,
  getAiMarketingOverview,
  getAiMarketingSettings,
  listAiMarketingQueue,
  publishAiMarketingQueueItemNow,
  setAiMarketingAutomationActive,
  updateAiMarketingSettings,
} from "../services/aiMarketingCenterService.js";

const tenantScope = (req) => getTenantId(req, req.user?.tenant_id) ?? 1;

const parseQueueItemId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

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
    const result = await generateAiMarketingBatch({ tenantId: tenantScope(req), runType });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendError(res, error, `Failed to generate ${runType} AI marketing batch`);
  }
};

export const generateAutonomousAiMarketingDaily = generate("daily");
export const generateAutonomousAiMarketingWeekly = generate("weekly");
export const generateAutonomousAiMarketingMonthly = generate("monthly");

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
    return res.json({ success: true, item });
  } catch (error) {
    return sendError(res, error, "Failed to publish queue item");
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

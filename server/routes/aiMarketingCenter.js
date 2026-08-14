import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  archiveAutonomousAiMarketingQueueItem,
  approveAutonomousAiMarketingQueueItem,
  bulkAutonomousAiMarketingQueueAction,
  deleteAutonomousAiMarketingQueueItem,
  duplicateAutonomousAiMarketingQueueItem,
  generateAutonomousAiMarketingDaily,
  generateAutonomousAiMarketingMonthly,
  generateAutonomousAiMarketingQueueStoryAsset,
  generateAutonomousAiMarketingVideosDaily,
  generateAutonomousAiMarketingVideosMonthly,
  generateAutonomousAiMarketingVideosWeekly,
  generateAutonomousAiMarketingWeekly,
  getAutonomousAiMarketingOverview,
  getAutonomousAiMarketingQueue,
  getAutonomousAiMarketingQueueTimeline,
  getAutonomousAiMarketingSettings,
  patchAutonomousAiMarketingSettings,
  pauseAutonomousAiMarketing,
  publishAutonomousAiMarketingQueueItemNow,
  resumeAutonomousAiMarketing,
  restoreAutonomousAiMarketingQueueItem,
  syncAutonomousAiMarketingInsights,
  applyStoryAutopilotSuggestions,
  getStoryAutopilot,
  getStoryAutopilotSuggestions,
  patchStoryAutopilot,
  runStoryAutopilotNow,
} from "../controllers/aiMarketingCenterController.js";

const router = express.Router();

router.use((req, _res, next) => {
  _res.setHeader("X-AI-Marketing-Center-Route", "mounted");
  console.log("[ai-marketing-center] route hit", {
    method: req.method,
    path: req.originalUrl,
    requestId: req.id,
  });
  next();
});

router.get("/settings", protect, permit("marketing", "view"), getAutonomousAiMarketingSettings);
router.patch("/settings", protect, permit("marketing", "update"), patchAutonomousAiMarketingSettings);
router.get("/overview", protect, permit("marketing", "view"), getAutonomousAiMarketingOverview);
router.get("/story-autopilot", protect, permit("marketing", "view"), getStoryAutopilot);
router.patch("/story-autopilot", protect, permit("marketing", "update"), patchStoryAutopilot);
router.get("/story-autopilot/suggestions", protect, permit("marketing", "view"), getStoryAutopilotSuggestions);
router.post("/story-autopilot/suggestions/apply", protect, permit("marketing", "update"), applyStoryAutopilotSuggestions);
router.post("/story-autopilot/run-now", protect, permit("marketing", "publish"), runStoryAutopilotNow);
router.post("/insights/sync", protect, permit("marketing", "update"), syncAutonomousAiMarketingInsights);
router.get("/queue", protect, permit("marketing", "view"), getAutonomousAiMarketingQueue);
router.post("/generate/daily", protect, permit("marketing", "create"), generateAutonomousAiMarketingDaily);
router.post("/generate/weekly", protect, permit("marketing", "create"), generateAutonomousAiMarketingWeekly);
router.post("/generate/monthly", protect, permit("marketing", "create"), generateAutonomousAiMarketingMonthly);
router.post("/videos/generate/daily", protect, permit("marketing", "create"), generateAutonomousAiMarketingVideosDaily);
router.post("/videos/generate/weekly", protect, permit("marketing", "create"), generateAutonomousAiMarketingVideosWeekly);
router.post("/videos/generate/monthly", protect, permit("marketing", "create"), generateAutonomousAiMarketingVideosMonthly);
router.post("/queue/:id/approve", protect, permit("marketing", "update"), approveAutonomousAiMarketingQueueItem);
router.get("/queue/:id/timeline", protect, permit("marketing", "view"), getAutonomousAiMarketingQueueTimeline);
router.post("/queue/:id/generate-story-asset", protect, permit("marketing", "create"), generateAutonomousAiMarketingQueueStoryAsset);
console.log("[route] generate-story-asset registered");
router.post("/queue/:id/publish-now", protect, permit("marketing", "publish"), publishAutonomousAiMarketingQueueItemNow);
router.post("/queue/:id/archive", protect, permit("marketing", "update"), archiveAutonomousAiMarketingQueueItem);
router.post("/queue/:id/restore", protect, permit("marketing", "update"), restoreAutonomousAiMarketingQueueItem);
router.post("/queue/:id/duplicate", protect, permit("marketing", "create"), duplicateAutonomousAiMarketingQueueItem);
router.post("/queue/bulk", protect, permit("marketing", "update"), bulkAutonomousAiMarketingQueueAction);
router.delete("/queue/:id", protect, permit("marketing", "delete"), deleteAutonomousAiMarketingQueueItem);
router.post("/pause", protect, permit("marketing", "update"), pauseAutonomousAiMarketing);
router.post("/resume", protect, permit("marketing", "update"), resumeAutonomousAiMarketing);

export default router;

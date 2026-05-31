import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  approveAutonomousAiMarketingQueueItem,
  deleteAutonomousAiMarketingQueueItem,
  generateAutonomousAiMarketingDaily,
  generateAutonomousAiMarketingMonthly,
  generateAutonomousAiMarketingQueueStoryAsset,
  generateAutonomousAiMarketingVideosDaily,
  generateAutonomousAiMarketingVideosMonthly,
  generateAutonomousAiMarketingVideosWeekly,
  generateAutonomousAiMarketingWeekly,
  getAutonomousAiMarketingOverview,
  getAutonomousAiMarketingQueue,
  getAutonomousAiMarketingSettings,
  patchAutonomousAiMarketingSettings,
  pauseAutonomousAiMarketing,
  publishAutonomousAiMarketingQueueItemNow,
  resumeAutonomousAiMarketing,
  syncAutonomousAiMarketingInsights,
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
router.post("/insights/sync", protect, permit("marketing", "update"), syncAutonomousAiMarketingInsights);
router.get("/queue", protect, permit("marketing", "view"), getAutonomousAiMarketingQueue);
router.post("/generate/daily", protect, permit("marketing", "create"), generateAutonomousAiMarketingDaily);
router.post("/generate/weekly", protect, permit("marketing", "create"), generateAutonomousAiMarketingWeekly);
router.post("/generate/monthly", protect, permit("marketing", "create"), generateAutonomousAiMarketingMonthly);
router.post("/videos/generate/daily", protect, permit("marketing", "create"), generateAutonomousAiMarketingVideosDaily);
router.post("/videos/generate/weekly", protect, permit("marketing", "create"), generateAutonomousAiMarketingVideosWeekly);
router.post("/videos/generate/monthly", protect, permit("marketing", "create"), generateAutonomousAiMarketingVideosMonthly);
router.post("/queue/:id/approve", protect, permit("marketing", "update"), approveAutonomousAiMarketingQueueItem);
router.post("/queue/:id/generate-story-asset", protect, permit("marketing", "create"), generateAutonomousAiMarketingQueueStoryAsset);
router.post("/queue/:id/publish-now", protect, permit("marketing", "publish"), publishAutonomousAiMarketingQueueItemNow);
router.delete("/queue/:id", protect, permit("marketing", "delete"), deleteAutonomousAiMarketingQueueItem);
router.post("/pause", protect, permit("marketing", "update"), pauseAutonomousAiMarketing);
router.post("/resume", protect, permit("marketing", "update"), resumeAutonomousAiMarketing);

export default router;

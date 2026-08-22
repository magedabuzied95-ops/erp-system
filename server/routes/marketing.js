import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { publishRequestWindow } from "../middleware/publishRequestWindow.js";
import {
  createCampaign,
  approveAiCenterDraft,
  createAutoReplyRule,
  createAiCenterDraft,
  createCommentDmRule,
  createPost,
  createStoryCampaignExport,
  createTemplate,
  deleteStoryCampaign,
  deleteCampaign,
  deleteAutoReplyRule,
  deleteCommentDmRule,
  deletePost,
  deleteTemplate,
  dismissStoryTriggerSuggestion,
  generateProductPost,
  generateAiCenterWeeklyPack,
  generateStoryCampaign,
  generateStoryCampaignFromTrigger,
  getAiCenterAutomationLogs,
  getAiCenterAutomationSettings,
  getAiCenterBrandIdentity,
  getAiCenterSuggestions,
  getAiCenterDrafts,
  getCampaigns,
  getAutoReplyRules,
  getCommentDmLogs,
  getCommentDmRules,
  getCommentEvents,
  getDashboard,
  getMarketingConversations,
  getMetaWebhookStatus,
  getPostById,
  getPosts,
  getSettings,
  getStoryCampaignById,
  getStoryCampaignExports,
  getStoryCampaigns,
  getStoryTriggerSuggestions,
  getTemplates,
  processCommentDmAutomation,
  publishNowAiCenterDraft,
  publishMarketingPost,
  publishStoryForPost,
  publishStoryForProduct,
  receiveMetaMarketingWebhook,
  refreshSettingsTokens,
  refreshStoryTriggerSuggestions,
  rejectAiCenterDraft,
  runAiCenterAutoPublishNow,
  runAiCenterAutomationNow,
  scheduleMarketingPost,
  scheduleAiCenterDraft,
  scheduleStoryForPost,
  scheduleStoryForProduct,
  simulateAutomationComment,
  testFacebookPublish,
  testCommentDmRule,
  testAutoRefreshSettings,
  updateCommentDmRule,
  updateAiCenterDraft,
  updateAiCenterAutomationSettings,
  updateAiCenterBrandIdentity,
  updateAutoReplyRule,
  updateCampaign,
  updatePost,
  updateSettings,
  updateStoryCampaign,
  updateTemplate,
  verifyMetaMarketingWebhook,
} from "../controllers/marketingController.js";
import { getMarketingAnalytics, syncMarketingAnalytics } from "../controllers/marketingAnalyticsController.js";
import {
  getMarketingAttribution,
  syncMarketingAttributionNow,
} from "../controllers/marketingAttributionController.js";
import {
  archiveAutonomousAiMarketingQueueItem,
  approveAutonomousAiMarketingQueueItem,
  bulkAutonomousAiMarketingQueueAction,
  deleteAutonomousAiMarketingQueueItem,
  duplicateAutonomousAiMarketingQueueItem,
  generateAutonomousAiMarketingDaily,
  generateAutonomousAiMarketingMonthly,
  generateAutonomousAiMarketingPlan,
  generateAutonomousAiMarketingQueueStoryAsset,
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
} from "../controllers/aiMarketingCenterController.js";

const router = express.Router();

const requiredStoryRoutes = {
  storyCampaignGenerate: true,
  storyTriggers: true,
  storyTriggerRefresh: true,
  storyTriggerGenerateCampaign: true,
  storyTriggerDismiss: true,
};

router.get("/debug-routes", (_req, res) => {
  res.json({
    ok: true,
    storyCampaignGenerate: requiredStoryRoutes.storyCampaignGenerate,
    storyTriggers: requiredStoryRoutes.storyTriggers,
    storyTriggerRefresh: requiredStoryRoutes.storyTriggerRefresh,
    storyTriggerGenerateCampaign: requiredStoryRoutes.storyTriggerGenerateCampaign,
    storyTriggerDismiss: requiredStoryRoutes.storyTriggerDismiss,
  });
});

router.get("/webhooks/meta", verifyMetaMarketingWebhook);
router.post("/webhooks/meta", receiveMetaMarketingWebhook);

router.get("/dashboard", protect, permit("marketing", "view"), getDashboard);
router.get("/ai-center/settings", protect, permit("marketing", "view"), getAutonomousAiMarketingSettings);
router.patch("/ai-center/settings", protect, permit("marketing", "update"), patchAutonomousAiMarketingSettings);
router.get("/ai-center/overview", protect, permit("marketing", "view"), getAutonomousAiMarketingOverview);
router.get("/ai-center/queue", protect, permit("marketing", "view"), getAutonomousAiMarketingQueue);
router.post("/ai-center/generate/daily", protect, permit("marketing", "create"), generateAutonomousAiMarketingDaily);
router.post("/ai-center/generate/weekly", protect, permit("marketing", "create"), generateAutonomousAiMarketingWeekly);
router.post("/ai-center/generate/monthly", protect, permit("marketing", "create"), generateAutonomousAiMarketingMonthly);
router.post("/ai-center/generate/plan", protect, permit("marketing", "create"), generateAutonomousAiMarketingPlan);
router.post("/ai-center/queue/:id/approve", protect, permit("marketing", "update"), approveAutonomousAiMarketingQueueItem);
router.get("/ai-center/queue/:id/timeline", protect, permit("marketing", "view"), getAutonomousAiMarketingQueueTimeline);
router.post("/ai-center/queue/:id/generate-story-asset", protect, permit("marketing", "create"), generateAutonomousAiMarketingQueueStoryAsset);
router.post("/ai-center/queue/:id/publish-now", protect, permit("marketing", "publish"), publishRequestWindow, publishAutonomousAiMarketingQueueItemNow);
router.post("/ai-center/queue/:id/archive", protect, permit("marketing", "update"), archiveAutonomousAiMarketingQueueItem);
router.post("/ai-center/queue/:id/restore", protect, permit("marketing", "update"), restoreAutonomousAiMarketingQueueItem);
router.post("/ai-center/queue/:id/duplicate", protect, permit("marketing", "create"), duplicateAutonomousAiMarketingQueueItem);
router.post("/ai-center/queue/bulk", protect, permit("marketing", "update"), bulkAutonomousAiMarketingQueueAction);
router.delete("/ai-center/queue/:id", protect, permit("marketing", "delete"), deleteAutonomousAiMarketingQueueItem);
router.post("/ai-center/pause", protect, permit("marketing", "update"), pauseAutonomousAiMarketing);
router.post("/ai-center/resume", protect, permit("marketing", "update"), resumeAutonomousAiMarketing);
router.get("/ai-center/suggestions", protect, permit("marketing", "view"), getAiCenterSuggestions);
router.get("/ai-center/drafts", protect, permit("marketing", "view"), getAiCenterDrafts);
router.post("/ai-center/drafts", protect, permit("marketing", "create"), createAiCenterDraft);
router.patch("/ai-center/drafts/:id", protect, permit("marketing", "update"), updateAiCenterDraft);
router.post("/ai-center/drafts/:id/approve", protect, permit("marketing", "update"), approveAiCenterDraft);
router.post("/ai-center/drafts/:id/reject", protect, permit("marketing", "update"), rejectAiCenterDraft);
router.post("/ai-center/drafts/:id/schedule", protect, permit("marketing", "update"), scheduleAiCenterDraft);
router.post("/ai-center/drafts/:id/publish-now", protect, permit("marketing", "publish"), publishRequestWindow, publishNowAiCenterDraft);
router.post("/ai-center/generate-weekly-pack", protect, permit("marketing", "create"), generateAiCenterWeeklyPack);
router.get("/ai-center/automation-settings", protect, permit("marketing", "view"), getAiCenterAutomationSettings);
router.get("/ai-center/automation-logs", protect, permit("marketing", "view"), getAiCenterAutomationLogs);
router.get("/ai-center/brand-identity", protect, permit("marketing", "view"), getAiCenterBrandIdentity);
router.put("/ai-center/automation-settings", protect, permit("marketing", "update"), updateAiCenterAutomationSettings);
router.put("/ai-center/brand-identity", protect, permit("marketing", "update"), updateAiCenterBrandIdentity);
router.post("/ai-center/run-automation-now", protect, permit("marketing", "create"), runAiCenterAutomationNow);
router.post("/ai-center/auto-publish/run-now", protect, permit("marketing", "publish"), runAiCenterAutoPublishNow);
router.post("/story-campaigns/generate", protect, permit("marketing", "create"), generateStoryCampaign);
router.get("/story-campaigns", protect, permit("marketing", "view"), getStoryCampaigns);
router.post("/story-campaigns/:id/exports", protect, permit("marketing", "create"), createStoryCampaignExport);
router.get("/story-campaigns/:id/exports", protect, permit("marketing", "view"), getStoryCampaignExports);
router.get("/story-campaigns/:id", protect, permit("marketing", "view"), getStoryCampaignById);
router.patch("/story-campaigns/:id", protect, permit("marketing", "update"), updateStoryCampaign);
router.delete("/story-campaigns/:id", protect, permit("marketing", "delete"), deleteStoryCampaign);
router.get("/story-triggers/suggestions", protect, permit("marketing", "view"), getStoryTriggerSuggestions);
router.post("/story-triggers/refresh", protect, permit("marketing", "create"), refreshStoryTriggerSuggestions);
router.post("/story-triggers/:id/generate-campaign", protect, permit("marketing", "create"), generateStoryCampaignFromTrigger);
router.patch("/story-triggers/:id/dismiss", protect, permit("marketing", "update"), dismissStoryTriggerSuggestion);

router.get("/campaigns", protect, permit("marketing", "view"), getCampaigns);
router.post("/campaigns", protect, permit("marketing", "create"), createCampaign);
router.put("/campaigns/:id", protect, permit("marketing", "update"), updateCampaign);
router.delete("/campaigns/:id", protect, permit("marketing", "delete"), deleteCampaign);

router.get("/templates", protect, permit("marketing", "view"), getTemplates);
router.post("/templates", protect, permit("marketing", "create"), createTemplate);
router.put("/templates/:id", protect, permit("marketing", "update"), updateTemplate);
router.delete("/templates/:id", protect, permit("marketing", "delete"), deleteTemplate);

router.get("/posts", protect, permit("marketing", "view"), getPosts);
router.post("/posts", protect, permit("marketing", "create"), createPost);
router.get("/posts/:id", protect, permit("marketing", "view"), getPostById);
router.put("/posts/:id", protect, permit("marketing", "update"), updatePost);
router.delete("/posts/:id", protect, permit("marketing", "delete"), deletePost);

router.post("/generate-product-post/:productId", protect, permit("marketing", "create"), generateProductPost);
router.post("/publish/:postId", protect, permit("marketing", "publish"), publishMarketingPost);
router.post("/story/publish/:postId", protect, permit("marketing", "publish"), publishStoryForPost);
router.post("/story/schedule/:postId", protect, permit("marketing", "update"), scheduleStoryForPost);
router.post("/story/publish-product/:productId", protect, permit("marketing", "publish"), publishStoryForProduct);
router.post("/story/schedule-product/:productId", protect, permit("marketing", "update"), scheduleStoryForProduct);
router.post("/test-facebook-publish", protect, permit("marketing", "publish"), testFacebookPublish);
router.post("/schedule/:postId", protect, permit("marketing", "update"), scheduleMarketingPost);

router.get("/settings", protect, permit("marketing", "settings"), getSettings);
router.put("/settings", protect, permit("marketing", "settings"), updateSettings);
router.post("/settings/refresh-tokens", protect, permit("marketing", "settings"), refreshSettingsTokens);
router.post("/settings/test-auto-refresh", protect, permit("marketing", "settings"), testAutoRefreshSettings);
router.get("/automation/rules", protect, permit("marketing", "view"), getAutoReplyRules);
router.post("/automation/rules", protect, permit("marketing", "settings"), createAutoReplyRule);
router.put("/automation/rules/:id", protect, permit("marketing", "settings"), updateAutoReplyRule);
router.delete("/automation/rules/:id", protect, permit("marketing", "settings"), deleteAutoReplyRule);
router.get("/automation/comment-events", protect, permit("marketing", "view"), getCommentEvents);
router.get("/automation/conversations", protect, permit("marketing", "view"), getMarketingConversations);
router.get("/automation/webhook-status", protect, permit("marketing", "view"), getMetaWebhookStatus);
router.post("/automation/simulate-comment", protect, permit("marketing", "view"), simulateAutomationComment);
router.get("/comment-dm/rules", protect, permit("marketing", "settings"), getCommentDmRules);
router.post("/comment-dm/rules", protect, permit("marketing", "settings"), createCommentDmRule);
router.put("/comment-dm/rules/:id", protect, permit("marketing", "settings"), updateCommentDmRule);
router.delete("/comment-dm/rules/:id", protect, permit("marketing", "settings"), deleteCommentDmRule);
router.post("/comment-dm/rules/:id/test", protect, permit("marketing", "settings"), testCommentDmRule);
router.get("/comment-dm/logs", protect, permit("marketing", "settings"), getCommentDmLogs);
router.post("/comment-dm/process-comment", protect, permit("marketing", "settings"), processCommentDmAutomation);
router.get("/analytics", protect, permit("marketing", "view"), getMarketingAnalytics);
router.post("/analytics/sync", protect, permit("marketing", "update"), syncMarketingAnalytics);
router.get("/attribution", protect, permit("marketing", "view"), getMarketingAttribution);
router.post("/attribution/sync", protect, permit("marketing", "update"), syncMarketingAttributionNow);

export default router;

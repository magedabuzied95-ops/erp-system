import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createCampaign,
  createAutoReplyRule,
  createCommentDmRule,
  createPost,
  createTemplate,
  deleteCampaign,
  deleteAutoReplyRule,
  deleteCommentDmRule,
  deletePost,
  deleteTemplate,
  generateProductPost,
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
  getTemplates,
  processCommentDmAutomation,
  publishMarketingPost,
  publishStoryForPost,
  publishStoryForProduct,
  receiveMetaMarketingWebhook,
  refreshSettingsTokens,
  scheduleMarketingPost,
  scheduleStoryForPost,
  scheduleStoryForProduct,
  simulateAutomationComment,
  testFacebookPublish,
  testCommentDmRule,
  testAutoRefreshSettings,
  updateCommentDmRule,
  updateAutoReplyRule,
  updateCampaign,
  updatePost,
  updateSettings,
  updateTemplate,
  verifyMetaMarketingWebhook,
} from "../controllers/marketingController.js";
import { getMarketingAnalytics, syncMarketingAnalytics } from "../controllers/marketingAnalyticsController.js";
import {
  getMarketingAttribution,
  syncMarketingAttributionNow,
} from "../controllers/marketingAttributionController.js";

const router = express.Router();

router.get("/webhooks/meta", verifyMetaMarketingWebhook);
router.post("/webhooks/meta", receiveMetaMarketingWebhook);

router.get("/dashboard", protect, permit("marketing", "view"), getDashboard);

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

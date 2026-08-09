import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { isMetaReviewerRole, loadMetaReviewerScope, normalizeMetaReviewerChannel } from "../services/metaReviewerAccessService.js";
import { listMetaReviewerConversations, loadMetaReviewerMessages, sendMetaReviewerMessage } from "../services/metaReviewerInboxService.js";

const router = express.Router();
const modules = { messenger: "ai_inbox_messenger", instagram: "ai_inbox_instagram" };

router.use(protect);
router.use((req, res, next) => {
  if (!isMetaReviewerRole(req.user?.role || req.user?.role_name)) return res.status(403).json({ success: false, message: "Meta reviewer role required." });
  req.metaReviewerScope = loadMetaReviewerScope();
  next();
});

const authorizeChannel = (action) => (req, res, next) => {
  const channel = normalizeMetaReviewerChannel(req.params.channel);
  const moduleName = modules[channel];
  if (!moduleName) return res.status(403).json({ success: false, message: "Review channel is forbidden." });
  req.metaReviewerChannel = channel;
  return permit(moduleName, action)(req, res, next);
};

router.get("/channels/:channel/conversations", authorizeChannel("view"), async (req, res) => {
  try {
    const payload = await listMetaReviewerConversations({ channel: req.metaReviewerChannel, search: req.query?.search || "", limit: req.query?.limit || 50, scope: req.metaReviewerScope });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.status === 403 ? "Review channel is forbidden." : "Failed to load the review inbox." });
  }
});

router.get("/channels/:channel/conversations/:conversationRef/messages", authorizeChannel("view"), async (req, res) => {
  try {
    const payload = await loadMetaReviewerMessages({ channel: req.metaReviewerChannel, conversationRef: req.params.conversationRef, limit: req.query?.limit || 50, scope: req.metaReviewerScope });
    if (!payload) return res.status(403).json({ success: false, message: "Conversation is outside the Meta review scope." });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.status === 403 ? "Conversation is outside the Meta review scope." : "Failed to load the review conversation." });
  }
});

router.post("/channels/:channel/conversations/:conversationRef/send", authorizeChannel("reply"), async (req, res) => {
  try {
    const payload = await sendMetaReviewerMessage({ channel: req.metaReviewerChannel, conversationRef: req.params.conversationRef, message: req.body?.message, actorUserId: req.user?.id, scope: req.metaReviewerScope });
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: error?.status === 403 ? "Conversation is outside the Meta review scope." : "Message could not be sent." });
  }
});

// Ambiguous legacy endpoints are deliberately closed: a channel must always be explicit.
router.all(["/conversations", "/conversations/:conversationRef/messages", "/conversations/:conversationRef/send"], (_req, res) => res.status(403).json({ success: false, message: "An explicit authorized review channel is required." }));

export default router;

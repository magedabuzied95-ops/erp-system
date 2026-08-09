import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { isMetaReviewerRole, loadMetaReviewerScope } from "../services/metaReviewerAccessService.js";
import {
  listMetaReviewerConversations,
  loadMetaReviewerMessages,
  sendMetaReviewerMessage,
} from "../services/metaReviewerInboxService.js";

const router = express.Router();

router.use(protect);
router.use((req, res, next) => {
  if (!isMetaReviewerRole(req.user?.role || req.user?.role_name)) {
    return res.status(403).json({ success: false, message: "Meta reviewer role required." });
  }
  req.metaReviewerScope = loadMetaReviewerScope();
  next();
});

router.get("/conversations", permit("ai_inbox_messenger", "view"), async (req, res) => {
  try {
    const payload = await listMetaReviewerConversations({
      search: req.query?.search || "",
      limit: req.query?.limit || 50,
      scope: req.metaReviewerScope,
    });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: "Failed to load the review inbox." });
  }
});

router.get("/conversations/:conversationRef/messages", permit("ai_inbox_messenger", "view"), async (req, res) => {
  try {
    const payload = await loadMetaReviewerMessages({
      conversationRef: req.params.conversationRef,
      limit: req.query?.limit || 50,
      scope: req.metaReviewerScope,
    });
    if (!payload) return res.status(403).json({ success: false, message: "Conversation is outside the Meta review scope." });
    return res.json({ success: true, ...payload });
  } catch (error) {
    return res.status(error?.status || 500).json({ success: false, message: "Failed to load the review conversation." });
  }
});

router.post("/conversations/:conversationRef/send", permit("ai_inbox_messenger", "reply"), async (req, res) => {
  try {
    const payload = await sendMetaReviewerMessage({
      conversationRef: req.params.conversationRef,
      message: req.body?.message,
      actorUserId: req.user?.id,
      scope: req.metaReviewerScope,
    });
    return res.status(200).json({ success: true, ...payload });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.status === 403 ? "Conversation is outside the Meta review scope." : "Message could not be sent.",
    });
  }
});

export default router;

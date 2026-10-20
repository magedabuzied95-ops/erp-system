import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createInboxTag,
  deleteInboxTag,
  listInboxTagOptions,
  listInboxTags,
  updateInboxTag,
} from "../services/inboxTagsService.js";

/*
 * Inbox tags (inbox top bar → Config → Tags). Mounted at /api/inbox-config/tags.
 * The management list is settings:view, changes are settings:edit. /options is the labels
 * modal's catalogue: any signed-in inbox user can label a conversation, so it only needs a login
 * (it returns names and colours, nothing else).
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[inbox-tags:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "INBOX_TAG_ERROR",
  });
};

router.get("/options", protect, async (req, res) => {
  try {
    return res.json({ success: true, labels: await listInboxTagOptions({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load tags");
  }
});

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, tags: await listInboxTags({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load tags");
  }
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tag = await createInboxTag({ tenantId: tenantOf(req), body: req.body || {}, user: req.user || {} });
    return res.status(201).json({ success: true, tag });
  } catch (error) {
    return fail(res, error, "Failed to create tag");
  }
});

router.patch("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tag = await updateInboxTag({ tenantId: tenantOf(req), id: req.params.id, body: req.body || {} });
    return res.json({ success: true, tag });
  } catch (error) {
    return fail(res, error, "Failed to update tag");
  }
});

router.delete("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const deleted = await deleteInboxTag({ tenantId: tenantOf(req), id: req.params.id });
    return res.json({ success: true, deleted });
  } catch (error) {
    return fail(res, error, "Failed to delete tag");
  }
});

export default router;

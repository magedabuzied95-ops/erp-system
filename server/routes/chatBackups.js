import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  listBackupChannels,
  listChatBackups,
  requestChatBackup,
  resolveBackupDownload,
} from "../services/chatBackupsService.js";

/*
 * Chat backups (inbox top bar → Config → Chat backups). Mounted at /api/inbox-config/backups.
 * Listing is settings:view. Requesting and downloading are settings:edit: a backup is every
 * customer conversation the shop has, so only people who can change settings may take one out.
 * The file is only ever streamed here, after the tenant check — never linked directly.
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[chat-backups:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "CHAT_BACKUP_ERROR",
  });
};

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    const [backups, channels] = await Promise.all([
      listChatBackups({ tenantId: tenantOf(req) }),
      listBackupChannels({ tenantId: tenantOf(req) }),
    ]);
    return res.json({ success: true, backups, channels });
  } catch (error) {
    return fail(res, error, "Failed to load backups");
  }
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const backup = await requestChatBackup({ tenantId: tenantOf(req), body: req.body || {}, user: req.user || {} });
    return res.status(202).json({ success: true, backup });
  } catch (error) {
    return fail(res, error, "Failed to request a backup");
  }
});

router.get("/:id/download", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const file = await resolveBackupDownload({ tenantId: tenantOf(req), id: req.params.id });
    res.setHeader("Cache-Control", "no-store");
    return res.download(file.absolute, file.filename, (error) => {
      if (error && !res.headersSent) fail(res, error, "Failed to download the backup");
    });
  } catch (error) {
    return fail(res, error, "Failed to download the backup");
  }
});

export default router;

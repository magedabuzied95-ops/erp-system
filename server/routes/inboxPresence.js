import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { listPresenceLog } from "../services/staffPresenceLogService.js";

/*
 * Presence log (inbox top bar → Config → Presence log). Mounted at /api/inbox-config/presence.
 * Read-only: rows are written by the inbox heartbeat (aiInboxStaffPresenceService.js).
 *   GET /?preset=today|7d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD[&user_id=N]   (Cairo calendar days)
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[inbox-presence:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "INBOX_PRESENCE_ERROR",
  });
};

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    const preset = ["today", "7d", "custom"].includes(req.query.preset) ? req.query.preset : "today";
    const log = await listPresenceLog({
      tenantId: tenantOf(req),
      preset,
      from: String(req.query.from || ""),
      to: String(req.query.to || ""),
      userId: req.query.user_id,
    });
    return res.json({ success: true, ...log });
  } catch (error) {
    return fail(res, error, "Failed to load the presence log");
  }
});

export default router;

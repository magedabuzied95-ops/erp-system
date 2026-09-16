import express from "express";

import { protect, requireAdmin } from "../middleware/authMiddleware.js";
import { isSuperAdminUser, getTenantId } from "../utils/requestScope.js";
import { listSecurityEvents } from "../modules/security/securityAudit.js";
import { requireAmazonAccess } from "../modules/security/amazonAccess.js";

const router = express.Router();

// Security event log (logins, MFA, password and privilege changes, Amazon access). Admin only.
router.get("/audit-events", protect, requireAdmin, async (req, res) => {
  try {
    const rows = await listSecurityEvents({
      tenantId: getTenantId(req, req.user?.tenant_id),
      allTenants: isSuperAdminUser(req.user),
      limit: req.query.limit,
      eventType: String(req.query.event_type || "").trim(),
      userId: req.query.user_id ? Number(req.query.user_id) : null,
    });
    return res.json({ success: true, events: rows });
  } catch (error) {
    console.error("[security] audit list failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "Failed To Load Security Events" });
  }
});

// Lets the UI (and the evidence check) confirm the Amazon gate: permission + MFA + audit entry.
router.get("/amazon-access-check", protect, requireAmazonAccess("view"), (req, res) =>
  res.json({ success: true, allowed: true })
);

export default router;

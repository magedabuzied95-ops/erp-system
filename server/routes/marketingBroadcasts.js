import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  broadcastsEnabled,
  createBroadcast,
  listBroadcasts,
  previewBroadcastAudience,
  resolveSendWindow,
  sendBroadcast,
  stopBroadcast,
} from "../services/marketingBroadcastService.js";
import { recordMarketingOptIn, recordMarketingOptOut } from "../services/marketingConsentService.js";

/*
 * Broadcast campaigns.
 *
 * Reading an audience count is settings:view. Anything that puts messages in front of customers —
 * creating, sending, stopping — is settings:edit, and sending is additionally gated by
 * MARKETING_BROADCASTS_ENABLED, which ships OFF. One careless click here reaches several hundred
 * people at once, which is a different kind of mistake from every other button in the inbox.
 */

const router = express.Router();

const tenantOf = (req) => Number(getTenantId(req)) || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  const message = error?.message || fallback;
  if (status >= 500) console.error("[marketing-broadcasts]", { message, stack: error?.stack });
  return res.status(status).json({ success: false, message, code: error?.code || "" });
};

router.get("/status", protect, permit("settings", "view"), async (req, res) => {
  try {
    const window = resolveSendWindow();
    return res.json({
      success: true,
      enabled: broadcastsEnabled(),
      quiet_hours_active: window.deferred,
      next_send_at: window.scheduledAt ? window.scheduledAt.toISOString() : null,
    });
  } catch (error) {
    return fail(res, error, "Failed to load broadcast status");
  }
});

router.post("/audience/preview", protect, permit("settings", "view"), async (req, res) => {
  try {
    const preview = await previewBroadcastAudience({
      tenantId: tenantOf(req),
      audience: req.body?.audience || {},
      frequencyCapDays: req.body?.frequency_cap_days,
    });
    return res.json({ success: true, ...preview });
  } catch (error) {
    return fail(res, error, "Failed to preview the audience");
  }
});

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    const broadcasts = await listBroadcasts({ tenantId: tenantOf(req), limit: req.query?.limit });
    return res.json({ success: true, broadcasts, enabled: broadcastsEnabled() });
  } catch (error) {
    return fail(res, error, "Failed to list broadcasts");
  }
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const broadcast = await createBroadcast({
      tenantId: tenantOf(req),
      name: req.body?.name,
      messageBody: req.body?.message_body || req.body?.message,
      audience: req.body?.audience || {},
      frequencyCapDays: req.body?.frequency_cap_days,
      createdBy: req.user?.id || null,
    });
    return res.status(201).json({ success: true, broadcast });
  } catch (error) {
    return fail(res, error, "Failed to create the broadcast");
  }
});

router.post("/:id/send", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await sendBroadcast({ tenantId: tenantOf(req), broadcastId: Number(req.params.id) });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to send the broadcast");
  }
});

router.post("/:id/stop", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await stopBroadcast({ tenantId: tenantOf(req), broadcastId: Number(req.params.id) });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to stop the broadcast");
  }
});

// Consent, by hand. The automatic path is a customer replying "إلغاء" on WhatsApp; this is for the
// times someone says it on the phone or in person instead.
router.post("/consent/opt-out", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await recordMarketingOptOut({
      tenantId: tenantOf(req),
      customerId: req.body?.customer_id,
      phone: req.body?.phone,
      source: "staff",
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to record the opt-out");
  }
});

router.post("/consent/opt-in", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await recordMarketingOptIn({ tenantId: tenantOf(req), customerId: req.body?.customer_id });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to record the opt-in");
  }
});

export default router;

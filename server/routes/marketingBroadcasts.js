import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  broadcastsEnabled,
  cancelBroadcastSchedule,
  createBroadcast,
  listBroadcastRecipients,
  listBroadcasts,
  previewBroadcastAudience,
  resolveSendWindow,
  scheduleBroadcast,
  sendBroadcast,
  stopBroadcast,
  updateBroadcast,
} from "../services/marketingBroadcastService.js";
import { listApprovedTemplates } from "../services/marketingCampaignTemplateService.js";
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

// Campaigns (template mode): only templates Meta has APPROVED can be picked.
router.get("/templates/approved", protect, permit("settings", "view"), async (req, res) => {
  try {
    const templates = await listApprovedTemplates({ tenantId: tenantOf(req) });
    return res.json({ success: true, templates });
  } catch (error) {
    return fail(res, error, "Failed to load approved templates");
  }
});

// The campaign fields a create or an update may carry. Absent keys stay undefined so an update
// only touches what it was sent.
const campaignInput = (body = {}) => ({
  name: body.name,
  messageBody: body.message_body ?? body.message,
  audience: body.audience,
  frequencyCapDays: body.frequency_cap_days,
  channelMode: body.channel_mode,
  templateId: body.template_id,
  templateVariables: body.template_variables,
  groupName: body.group_name,
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const input = campaignInput(req.body || {});
    const broadcast = await createBroadcast({
      tenantId: tenantOf(req),
      name: input.name,
      messageBody: input.messageBody,
      audience: input.audience || {},
      frequencyCapDays: input.frequencyCapDays,
      createdBy: req.user?.id || null,
      channelMode: input.channelMode,
      templateId: input.templateId,
      templateVariables: input.templateVariables,
      groupName: input.groupName,
    });
    return res.status(201).json({ success: true, broadcast });
  } catch (error) {
    return fail(res, error, "Failed to create the broadcast");
  }
});

router.put("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const broadcast = await updateBroadcast({
      tenantId: tenantOf(req),
      broadcastId: Number(req.params.id),
      input: campaignInput(req.body || {}),
    });
    return res.json({ success: true, broadcast });
  } catch (error) {
    return fail(res, error, "Failed to update the broadcast");
  }
});

router.get("/:id/recipients", protect, permit("settings", "view"), async (req, res) => {
  try {
    const recipients = await listBroadcastRecipients({
      tenantId: tenantOf(req),
      broadcastId: Number(req.params.id),
      limit: req.query?.limit,
    });
    return res.json({ success: true, recipients });
  } catch (error) {
    return fail(res, error, "Failed to load the recipients");
  }
});

router.post("/:id/schedule", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const broadcast = await scheduleBroadcast({
      tenantId: tenantOf(req),
      broadcastId: Number(req.params.id),
      scheduledAt: req.body?.scheduled_at,
    });
    return res.json({ success: true, broadcast });
  } catch (error) {
    return fail(res, error, "Failed to schedule the broadcast");
  }
});

router.post("/:id/cancel-schedule", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const broadcast = await cancelBroadcastSchedule({ tenantId: tenantOf(req), broadcastId: Number(req.params.id) });
    return res.json({ success: true, broadcast });
  } catch (error) {
    return fail(res, error, "Failed to cancel the schedule");
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

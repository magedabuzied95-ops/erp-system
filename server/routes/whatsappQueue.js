import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  cancelPending,
  expireStaleMessages,
  listQueueItems,
  oldestPending,
  queueCounts,
  queueRuntimeRow,
  resumePreview,
  retryFailed,
  sentInLastMinutes,
  setQueueState,
} from "../services/whatsappQueue/queueService.js";
import { loadWhatsappQueueSettings } from "../services/whatsappQueue/config.js";
import { runWhatsappQueueTick } from "../services/whatsappQueue/worker.js";
import { ensureWhatsappQueueSchema } from "../services/whatsappQueue/schema.js";
import { getStatus, normalizeEgyptPhone, sendTextMessage } from "../services/whatsappGatewayService.js";
import { WHATSAPP_AUTOMATION_LABELS, WHATSAPP_AUTOMATION_TYPES } from "../../shared/whatsappQueueDefaults.js";

/*
 * The WhatsApp queue dashboard and its admin actions.
 *
 * Read is settings:view; anything that moves messages is settings:edit — cancelling a backlog or
 * resuming a paused queue decides what several hundred customers do or do not receive.
 */

const router = express.Router();

const tenantScope = (req) =>
  Number(req.user?.tenant_id ?? req.user?.tenantId ?? req.tenant?.id ?? req.headers?.["x-tenant-id"] ?? 0) || 0;

const sendError = (res, error, fallback = "WhatsApp queue error") => {
  console.error("[wa-queue:error]", { message: error?.message || fallback, code: error?.code || "" });
  return res.status(error?.status || 500).json({
    success: false,
    code: error?.code || "WHATSAPP_QUEUE_ERROR",
    message: error?.message || fallback,
  });
};

const idList = (value) => {
  if (!Array.isArray(value)) return null;
  const ids = value.map((entry) => Number(entry)).filter((entry) => Number.isInteger(entry) && entry > 0);
  return ids.length ? ids : null;
};

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    await ensureWhatsappQueueSchema();
    const tenantId = tenantScope(req);
    const [counts, runtime, settings, lastHour, lastDay, oldest, preview] = await Promise.all([
      queueCounts(null),
      queueRuntimeRow(tenantId),
      loadWhatsappQueueSettings(),
      sentInLastMinutes({ tenantId: null, minutes: 60 }),
      sentInLastMinutes({ tenantId: null, minutes: 60 * 24 }),
      oldestPending(null),
      resumePreview(null),
    ]);
    // Live, not the cached runtime column: what the operator needs to know is whether the session
    // is answering right now, and a stale "connected" is worse than no answer at all.
    const connection = await getStatus().catch((error) => ({ connected: false, state: "unreachable", error: error?.message || String(error) }));

    return res.json({
      success: true,
      connection: {
        connected: connection?.connected === true,
        state: connection?.state || "unknown",
        instance: connection?.instanceName || "",
        configured: connection?.configured !== false,
      },
      queue: {
        state: runtime?.state || "running",
        pause_reason: runtime?.pause_reason || "",
        pause_details: runtime?.pause_details || {},
        paused_at: runtime?.paused_at || null,
        resumed_at: runtime?.resumed_at || null,
        last_drain_at: runtime?.last_drain_at || null,
        last_connected_at: runtime?.last_connected_at || null,
        last_disconnected_at: runtime?.last_disconnected_at || null,
      },
      counts,
      throughput: { last_hour: lastHour, last_24h: lastDay },
      oldest_pending: oldest,
      resume_preview: preview,
      settings,
      automation_types: Object.entries(WHATSAPP_AUTOMATION_TYPES).map(([type, category]) => ({
        type,
        category,
        label: WHATSAPP_AUTOMATION_LABELS[type] || { en: type, ar: type },
      })),
    });
  } catch (error) {
    return sendError(res, error, "Failed to load WhatsApp queue dashboard");
  }
});

router.get("/items", protect, permit("settings", "view"), async (req, res) => {
  try {
    const rows = await listQueueItems({
      tenantId: null,
      status: req.query?.status || "",
      automationType: req.query?.automation_type || "",
      limit: req.query?.limit,
    });
    return res.json({ success: true, items: rows });
  } catch (error) {
    return sendError(res, error, "Failed to list WhatsApp queue items");
  }
});

router.post("/pause", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const row = await setQueueState({
      tenantId: tenantScope(req),
      state: "paused",
      reason: String(req.body?.reason || "manual").slice(0, 80),
      details: { by_user_id: req.user?.id || null },
    });
    return res.json({ success: true, queue: row });
  } catch (error) {
    return sendError(res, error, "Failed to pause the WhatsApp queue");
  }
});

/*
 * Resume, with the summary shown first.
 *
 * `expire_stale` defaults to true: after a long outage the whole point is that the stale backlog
 * is dropped rather than delivered. Passing false is the operator explicitly choosing to send
 * messages the settings already judged too old — allowed, but never the default.
 */
router.post("/resume", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const preview = await resumePreview(null);
    const expireStale = req.body?.expire_stale !== false;
    const expired = expireStale ? await expireStaleMessages({ tenantId: null }) : { expired: 0 };
    const row = await setQueueState({
      tenantId: tenantScope(req),
      state: "running",
      reason: "",
      details: { by_user_id: req.user?.id || null, expired_on_resume: expired.expired },
    });
    console.info("[wa-queue] resumed by admin", {
      user_id: req.user?.id || null,
      pending_before: preview.pending,
      stale_before: preview.stale,
      expired: expired.expired,
    });
    return res.json({ success: true, queue: row, preview, expired: expired.expired });
  } catch (error) {
    return sendError(res, error, "Failed to resume the WhatsApp queue");
  }
});

router.get("/resume-preview", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, preview: await resumePreview(null) });
  } catch (error) {
    return sendError(res, error, "Failed to build the resume summary");
  }
});

router.post("/cancel-pending", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await cancelPending({
      tenantId: null,
      automationType: req.body?.automation_type || "",
      ids: idList(req.body?.ids),
    });
    console.info("[wa-queue] cancel-pending", { user_id: req.user?.id || null, ...result });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to cancel pending WhatsApp messages");
  }
});

router.post("/expire-stale", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await expireStaleMessages({ tenantId: null });
    console.info("[wa-queue] expire-stale", { user_id: req.user?.id || null, expired: result.expired });
    return res.json({ success: true, expired: result.expired });
  } catch (error) {
    return sendError(res, error, "Failed to expire stale WhatsApp messages");
  }
});

router.post("/retry-failed", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await retryFailed({ tenantId: null, ids: idList(req.body?.ids) });
    console.info("[wa-queue] retry-failed", { user_id: req.user?.id || null, ...result });
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, "Failed to retry failed WhatsApp messages");
  }
});

/* One message, straight out, bypassing the queue — the point is to prove the session works. */
router.post("/test-send", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const phone = normalizeEgyptPhone(req.body?.phone);
    const message = String(req.body?.message || "").trim();
    if (!phone || !message) {
      return res.status(400).json({ success: false, message: "phone and message are required" });
    }
    const result = await sendTextMessage({ phone, message });
    console.info("[wa-queue] test-send", { user_id: req.user?.id || null, phoneSuffix: phone.slice(-4) });
    return res.json({ success: true, result });
  } catch (error) {
    return sendError(res, error, "Failed to send the test message");
  }
});

/* Run one drain immediately rather than waiting for the interval. Obeys every brake. */
router.post("/drain", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const result = await runWhatsappQueueTick({ tenantId: tenantScope(req) });
    return res.json({ success: true, result });
  } catch (error) {
    return sendError(res, error, "Failed to run the WhatsApp queue drain");
  }
});

export default router;

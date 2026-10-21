// /api/whatsapp-official/flows — chatbot flow builder + runtime admin.
//
//   GET    /                 → { flows: [{ id, name, status, version, trigger, phone_number_ids, updated_at, has_unpublished }] }
//   POST   /                 { name } → { flow }
//   GET    /meta             → { numbers: [{ phone_number_id, label }], templates: [approved templates] }
//   POST   /upload           multipart "file" → { media: { url, kind, mime_type, file_name } }
//   GET    /:id              → { flow }
//   PUT    /:id              { name?, graph?, trigger?, phone_number_ids? } → { flow }
//   DELETE /:id              → { success }
//   POST   /:id/publish      → { flow } | 422 { errors: [{ node_id, code, params }] }
//   POST   /:id/activate     → { flow } (409 when never published)
//   POST   /:id/deactivate   → { flow }
//   POST   /:id/test         { to, phone_number_id? } → { result } | 422 { code: outside_24h_window | … }
//   GET    /:id/sessions     → { sessions }
//
// Reads are settings:view; everything else is settings:edit. Every query is tenant-scoped.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";

import db from "../../../database/db.js";
import { protect } from "../../../middleware/authMiddleware.js";
import permit from "../../../middleware/permissionMiddleware.js";
import { INBOX_ATTACHMENT_DIR, INBOX_ATTACHMENT_URL_PREFIX } from "../../../config/inboxAttachmentUpload.js";
import { ensureChatbotFlowSchema } from "./flowSchema.js";
import { normalizeGraph, validateGraph } from "./flowGraph.js";
import { digitsOf, startFlowForPhone } from "./flowInbound.js";

const router = express.Router();

const str = (value) => String(value ?? "").trim();
const arr = (value) => (Array.isArray(value) ? value : []);
const tenantOf = (req) => Number(req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1) || 1;
const STATUSES = new Set(["draft", "active", "inactive"]);
const TRIGGER_TYPES = new Set(["any_message", "keywords", "first_message"]);

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[wa-flows:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({ success: false, message: error?.message || fallback, code: error?.code || "WA_FLOW_ERROR" });
};
const httpError = (message, status = 400, code = "WA_FLOW_INVALID") => Object.assign(new Error(message), { status, code });

const normalizeTrigger = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const type = TRIGGER_TYPES.has(str(source.type)) ? str(source.type) : "any_message";
  const keywords = [...new Set(arr(source.keywords).map((item) => str(item).slice(0, 60)).filter(Boolean))].slice(0, 50);
  return { type, keywords };
};
const normalizeNumbers = (value) => [...new Set(arr(value).map((item) => str(item)).filter((item) => /^\d{5,32}$/.test(item)))];

const publicFlow = (row, { withGraph = true } = {}) => {
  if (!row) return null;
  const graph = normalizeGraph(row.graph);
  const published = row.published_graph ? normalizeGraph(row.published_graph) : null;
  const stripViewport = (value) => JSON.stringify({ nodes: value.nodes, edges: value.edges });
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    version: Number(row.version || 0),
    trigger: normalizeTrigger(row.trigger),
    phone_number_ids: normalizeNumbers(row.phone_number_ids),
    published: Boolean(published),
    has_unpublished: !published || stripViewport(published) !== stripViewport(graph),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    node_count: graph.nodes.length,
    ...(withGraph ? { graph } : {}),
  };
};

const getRow = async (tenantId, id) => {
  await ensureChatbotFlowSchema();
  const result = await db.query(`SELECT * FROM wa_chatbot_flows WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(id) || 0]);
  if (!result.rows[0]) throw httpError("Flow not found", 404, "WA_FLOW_NOT_FOUND");
  return result.rows[0];
};

const listNumbers = async (tenantId) => {
  try {
    const { listIntegrations } = await import("../../../services/whatsappEmbeddedSignupService.js");
    const rows = await listIntegrations({ tenantId });
    const seen = new Set();
    return rows
      .filter((row) => str(row.phone_number_id) && str(row.status || "connected") !== "disconnected")
      .filter((row) => (seen.has(str(row.phone_number_id)) ? false : seen.add(str(row.phone_number_id))))
      .map((row) => ({
        phone_number_id: str(row.phone_number_id),
        label: [str(row.verified_name || row.display_name || row.business_name), str(row.display_phone_number || row.phone_number)].filter(Boolean).join(" · ")
          || str(row.phone_number_id),
      }));
  } catch {
    return [];
  }
};

const approvedTemplates = async (tenantId) => {
  try {
    const { ensureWhatsappTemplateSchema } = await import("../../../services/whatsappTemplateStudioService.js");
    await ensureWhatsappTemplateSchema();
    const result = await db.query(
      `SELECT id, name, language, category, status, header_format, header_text, header_media_url, body_text, footer_text, buttons
         FROM whatsapp_message_templates WHERE tenant_id = $1 AND status = 'APPROVED' ORDER BY name ASC, language ASC`,
      [tenantId]
    );
    return result.rows;
  } catch {
    return [];
  }
};

/* ------------------------------------------------------------------ list / create */

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    await ensureChatbotFlowSchema();
    const result = await db.query(`SELECT * FROM wa_chatbot_flows WHERE tenant_id = $1 ORDER BY updated_at DESC, id DESC`, [tenantOf(req)]);
    return res.json({ success: true, flows: result.rows.map((row) => publicFlow(row, { withGraph: false })) });
  } catch (error) {
    return fail(res, error, "Failed to load flows");
  }
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    await ensureChatbotFlowSchema();
    const name = str(req.body?.name).slice(0, 120) || "New flow";
    // Optional: the numbers the new flow runs on (the Meta review account's flows are bound to
    // the WhatsApp test number from the start). Absent = all numbers, as before.
    const numbers = normalizeNumbers(req.body?.phone_number_ids);
    const result = await db.query(
      `INSERT INTO wa_chatbot_flows (tenant_id, name, created_by, phone_number_ids) VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
      [tenantOf(req), name, Number(req.user?.id) || null, JSON.stringify(numbers)]
    );
    return res.status(201).json({ success: true, flow: publicFlow(result.rows[0]) });
  } catch (error) {
    return fail(res, error, "Failed to create the flow");
  }
});

router.get("/meta", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const [numbers, templates] = await Promise.all([listNumbers(tenantId), approvedTemplates(tenantId)]);
    return res.json({ success: true, numbers, templates });
  } catch (error) {
    return fail(res, error, "Failed to load builder data");
  }
});

/* ------------------------------------------------------------------ media upload */

const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv"]);
const AUDIO_EXTENSIONS = new Set([".ogg", ".opus", ".mp3", ".m4a", ".aac", ".amr"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".3gp", ".3gpp"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const kindOf = (file = {}) => {
  const extension = path.extname(str(file.originalname)).toLowerCase();
  const mime = str(file.mimetype).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension) || ["image/jpeg", "image/png", "image/webp"].includes(mime)) return "image";
  if (VIDEO_EXTENSIONS.has(extension) || ["video/mp4", "video/3gpp"].includes(mime)) return "video";
  if (AUDIO_EXTENSIONS.has(extension) || mime.startsWith("audio/")) return "audio";
  if (DOCUMENT_EXTENSIONS.has(extension) || mime === "application/pdf") return "document";
  return "";
};

const flowMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      fs.mkdir(INBOX_ATTACHMENT_DIR, { recursive: true }, () => cb(null, INBOX_ATTACHMENT_DIR));
    },
    filename: (req, file, cb) => {
      const safe = str(file.originalname || "media").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 100);
      cb(null, `flow-${Date.now()}-${safe}`);
    },
  }),
  fileFilter: (req, file, cb) => (kindOf(file)
    ? cb(null, true)
    : cb(Object.assign(new Error("This file type cannot be sent on WhatsApp"), { code: "WA_FLOW_MEDIA_TYPE" }))),
  // WhatsApp's own ceilings: image 5 MB, audio/video 16 MB, document 100 MB — held to 16 MB here.
  limits: { fileSize: 16 * 1024 * 1024, files: 1 },
});

router.post(
  "/upload",
  protect,
  permit("settings", "edit"),
  (req, res, next) => {
    flowMediaUpload.single("file")(req, res, (error) => {
      if (!error) return next();
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, message: error.message || "Upload rejected", code: error.code || "UPLOAD_REJECTED" });
    });
  },
  async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "A file is required" });
    const kind = kindOf(req.file);
    if (kind === "image" && req.file.size > 5 * 1024 * 1024) {
      fs.unlink(req.file.path, () => {});
      return res.status(413).json({ success: false, message: "WhatsApp images must be 5 MB or less", code: "LIMIT_FILE_SIZE" });
    }
    return res.status(201).json({
      success: true,
      media: {
        url: `${INBOX_ATTACHMENT_URL_PREFIX}/${req.file.filename}`,
        kind,
        mime_type: req.file.mimetype || "",
        file_name: req.file.originalname || req.file.filename,
      },
    });
  }
);

/* ------------------------------------------------------------------ one flow */

router.get("/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, flow: publicFlow(await getRow(tenantOf(req), req.params.id)) });
  } catch (error) {
    return fail(res, error, "Failed to load the flow");
  }
});

router.put("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const row = await getRow(tenantId, req.params.id);
    const body = req.body || {};
    const name = body.name !== undefined ? str(body.name).slice(0, 120) || row.name : row.name;
    const graph = body.graph !== undefined ? normalizeGraph(body.graph) : normalizeGraph(row.graph);
    if (JSON.stringify(graph).length > 1_000_000) throw httpError("The flow is too large", 413, "WA_FLOW_TOO_LARGE");
    const trigger = body.trigger !== undefined ? normalizeTrigger(body.trigger) : normalizeTrigger(row.trigger);
    const numbers = body.phone_number_ids !== undefined ? normalizeNumbers(body.phone_number_ids) : normalizeNumbers(row.phone_number_ids);
    const result = await db.query(
      `UPDATE wa_chatbot_flows SET name = $3, graph = $4::jsonb, trigger = $5::jsonb, phone_number_ids = $6::jsonb, updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, row.id, name, JSON.stringify(graph), JSON.stringify(trigger), JSON.stringify(numbers)]
    );
    return res.json({ success: true, flow: publicFlow(result.rows[0]) });
  } catch (error) {
    return fail(res, error, "Failed to save the flow");
  }
});

router.delete("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const row = await getRow(tenantId, req.params.id);
    await db.query(`UPDATE wa_chatbot_sessions SET status = 'ended', end_reason = 'flow_deleted', ended_at = NOW() WHERE tenant_id = $1 AND flow_id = $2 AND status = 'active'`, [tenantId, row.id]);
    await db.query(`DELETE FROM wa_chatbot_flows WHERE tenant_id = $1 AND id = $2`, [tenantId, row.id]);
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error, "Failed to delete the flow");
  }
});

router.post("/:id/publish", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const row = await getRow(tenantId, req.params.id);
    const graph = normalizeGraph(row.graph);
    const templates = new Map((await approvedTemplates(tenantId)).map((item) => [Number(item.id), item]));
    const errors = validateGraph(graph, { templates });
    if (errors.length) return res.status(422).json({ success: false, code: "WA_FLOW_INVALID", message: "The flow has problems to fix", errors });
    const result = await db.query(
      `UPDATE wa_chatbot_flows SET published_graph = graph, version = version + 1, published_at = NOW(), updated_at = NOW()
        WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, row.id]
    );
    return res.json({ success: true, flow: publicFlow(result.rows[0]) });
  } catch (error) {
    return fail(res, error, "Failed to publish the flow");
  }
});

const setStatus = (status) => async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const row = await getRow(tenantId, req.params.id);
    if (!STATUSES.has(status)) throw httpError("Unknown status");
    if (status === "active" && !row.published_graph) throw httpError("Publish the flow before activating it", 409, "WA_FLOW_NOT_PUBLISHED");
    const result = await db.query(
      `UPDATE wa_chatbot_flows SET status = $3, updated_at = NOW() WHERE tenant_id = $1 AND id = $2 RETURNING *`,
      [tenantId, row.id, status]
    );
    if (status !== "active") {
      await db.query(
        `UPDATE wa_chatbot_sessions SET status = 'ended', end_reason = 'flow_deactivated', ended_at = NOW()
          WHERE tenant_id = $1 AND flow_id = $2 AND status = 'active' AND is_test = FALSE`,
        [tenantId, row.id]
      );
    }
    return res.json({ success: true, flow: publicFlow(result.rows[0]) });
  } catch (error) {
    return fail(res, error, "Failed to change the flow status");
  }
};

router.post("/:id/activate", protect, permit("settings", "edit"), setStatus("active"));
router.post("/:id/deactivate", protect, permit("settings", "edit"), setStatus("inactive"));

router.post("/:id/test", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const row = await getRow(tenantId, req.params.id);
    const to = digitsOf(req.body?.to);
    if (to.length < 8) return res.status(400).json({ success: false, code: "invalid_phone", message: "A valid phone number is required" });
    const errors = validateGraph(row.graph);
    if (errors.length) return res.status(422).json({ success: false, code: "WA_FLOW_INVALID", message: "The flow has problems to fix", errors });
    let phoneNumberId = str(req.body?.phone_number_id);
    if (!phoneNumberId) phoneNumberId = normalizeNumbers(row.phone_number_ids)[0] || "";
    if (!phoneNumberId) phoneNumberId = (await listNumbers(tenantId))[0]?.phone_number_id || str(process.env.WHATSAPP_PHONE_NUMBER_ID);
    if (!phoneNumberId) return res.status(409).json({ success: false, code: "no_number", message: "No official WhatsApp number is connected" });
    const result = await startFlowForPhone({ tenantId, flow: row, phone: to, phoneNumberId });
    if (!result.ok) {
      return res.status(result.status || 502).json({ success: false, code: result.code, message: result.error || result.code });
    }
    return res.json({ success: true, result });
  } catch (error) {
    return fail(res, error, "Failed to start the test");
  }
});

router.get("/:id/sessions", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const row = await getRow(tenantId, req.params.id);
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    const result = await db.query(
      `SELECT id, phone_number_id, conversation_key, customer_phone, current_node_id, status, is_test, end_reason,
              started_at, last_at, ended_at, run_count, vars->>'name' AS customer_name
         FROM wa_chatbot_sessions WHERE tenant_id = $1 AND flow_id = $2 ORDER BY last_at DESC LIMIT $3`,
      [tenantId, row.id, limit]
    );
    return res.json({ success: true, sessions: result.rows });
  } catch (error) {
    return fail(res, error, "Failed to load sessions");
  }
});

export default router;

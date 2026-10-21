import express from "express";
import multer from "multer";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  submitTemplate,
  syncTemplates,
  updateTemplate,
  uploadHeaderSample,
} from "../services/whatsappTemplateStudioService.js";

/*
 * WhatsApp message templates (inbox top bar → WhatsApp → Templates).
 * Read is settings:view; anything that changes a template or talks to Meta is settings:edit —
 * a submitted template is what every proactive message to a customer is built from.
 */

const router = express.Router();

const MEDIA_LIMIT_BYTES = 16 * 1024 * 1024;
const headerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MEDIA_LIMIT_BYTES } });

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[whatsapp-templates:error]", { code: error?.code, message: error?.message });
  return res.status(status).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WHATSAPP_TEMPLATE_ERROR",
    meaning: error?.details?.meaning || "",
  });
};

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, templates: await listTemplates({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load templates");
  }
});

// The store's automation templates (order confirmation, payment card, shipping, carousels…) with
// Meta's verdict on each, and one action that submits every one Meta does not have yet.
router.get("/automation", protect, permit("settings", "view"), async (req, res) => {
  try {
    const { listAutomationTemplates } = await import("../modules/whatsappOfficial/automationTemplates.js");
    return res.json({ success: true, templates: await listAutomationTemplates({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to load the automation templates");
  }
});

router.post("/automation/submit", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const { submitAutomationTemplates } = await import("../modules/whatsappOfficial/automationTemplates.js");
    const keys = Array.isArray(req.body?.automation_types) ? req.body.automation_types : [];
    return res.json({ success: true, ...(await submitAutomationTemplates({ tenantId: tenantOf(req), keys })) });
  } catch (error) {
    return fail(res, error, "Failed to submit the automation templates to Meta");
  }
});

router.post("/sync", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const summary = await syncTemplates({ tenantId: tenantOf(req) });
    return res.json({ success: true, summary, templates: await listTemplates({ tenantId: tenantOf(req) }) });
  } catch (error) {
    return fail(res, error, "Failed to sync templates from Meta");
  }
});

router.post(
  "/header-sample",
  protect,
  permit("settings", "edit"),
  (req, res, next) => {
    headerUpload.single("file")(req, res, (error) => {
      if (!error) return next();
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ success: false, message: error.message || "Upload rejected" });
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: "A sample file is required" });
      const result = await uploadHeaderSample({
        tenantId: tenantOf(req),
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        fileName: req.file.originalname,
      });
      return res.status(201).json({ success: true, ...result });
    } catch (error) {
      return fail(res, error, "Failed to upload the sample file");
    }
  }
);

router.get("/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, template: await getTemplate({ tenantId: tenantOf(req), id: req.params.id }) });
  } catch (error) {
    return fail(res, error, "Failed to load the template");
  }
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const template = await createTemplate({ tenantId: tenantOf(req), userId: req.user?.id || null, input: req.body || {} });
    return res.status(201).json({ success: true, template });
  } catch (error) {
    return fail(res, error, "Failed to save the template");
  }
});

router.patch("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, template: await updateTemplate({ tenantId: tenantOf(req), id: req.params.id, input: req.body || {} }) });
  } catch (error) {
    return fail(res, error, "Failed to save the template");
  }
});

router.post("/:id/submit", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, template: await submitTemplate({ tenantId: tenantOf(req), id: req.params.id }) });
  } catch (error) {
    return fail(res, error, "Meta rejected the template");
  }
});

router.delete("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await deleteTemplate({ tenantId: tenantOf(req), id: req.params.id })) });
  } catch (error) {
    return fail(res, error, "Failed to delete the template");
  }
});

export default router;

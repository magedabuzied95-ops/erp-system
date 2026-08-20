import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { getTenantId } from "../utils/requestScope.js";
import {
  createInvoiceTemplate,
  deleteInvoiceTemplate,
  duplicateInvoiceTemplate,
  getInvoiceTemplate,
  listInvoiceTemplates,
  resolveInvoiceTemplateForOrder,
  updateInvoiceTemplate,
} from "../services/invoiceTemplateService.js";
import {
  INVOICE_TEMPLATE_CHANNELS,
  INVOICE_TEMPLATE_DEFAULTS,
  INVOICE_TEMPLATE_OUTPUTS,
} from "../../shared/invoiceTemplate.js";

const router = express.Router();

const fail = (res, error, fallbackMessage) => {
  const status = error?.status || 500;
  if (status === 500) console.error("[invoice-templates] error", error);
  res.status(status).json({ success: false, message: status === 500 ? fallbackMessage : error.message });
};

const requireTenant = (req, res) => {
  const tenantId = getTenantId(req, req.user?.tenant_id);
  if (!tenantId) {
    res.status(400).json({ success: false, message: "Tenant context missing" });
    return null;
  }
  return tenantId;
};

// The studio needs the vocabulary (channels, outputs) and the baseline config to show
// "what you get if you change nothing" beside every field.
router.get("/meta", protect, permit("settings", "view"), (req, res) => {
  res.json({
    success: true,
    channels: INVOICE_TEMPLATE_CHANNELS,
    outputs: INVOICE_TEMPLATE_OUTPUTS,
    defaults: INVOICE_TEMPLATE_DEFAULTS,
  });
});

router.get("/resolve", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const resolved = await resolveInvoiceTemplateForOrder(tenantId, {
      templateId: req.query.template_id || null,
      channel: req.query.channel || "all",
      branchId: req.query.branch_id || null,
    });
    res.json({ success: true, ...resolved });
  } catch (error) {
    fail(res, error, "Failed to resolve invoice template");
  }
});

router.get("/", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const templates = await listInvoiceTemplates(tenantId);
    res.json({ success: true, templates });
  } catch (error) {
    fail(res, error, "Failed to load invoice templates");
  }
});

router.get("/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const template = await getInvoiceTemplate(tenantId, req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Invoice template not found" });
    res.json({ success: true, template });
  } catch (error) {
    fail(res, error, "Failed to load invoice template");
  }
});

router.post("/", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const template = await createInvoiceTemplate(tenantId, req.body || {}, req.user?.id || null);
    res.status(201).json({ success: true, template });
  } catch (error) {
    fail(res, error, "Failed to create invoice template");
  }
});

router.post("/:id/duplicate", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const template = await duplicateInvoiceTemplate(tenantId, req.params.id, req.body || {}, req.user?.id || null);
    res.status(201).json({ success: true, template });
  } catch (error) {
    fail(res, error, "Failed to duplicate invoice template");
  }
});

router.patch("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const template = await updateInvoiceTemplate(tenantId, req.params.id, req.body || {});
    res.json({ success: true, template });
  } catch (error) {
    fail(res, error, "Failed to update invoice template");
  }
});

router.delete("/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const removed = await deleteInvoiceTemplate(tenantId, req.params.id);
    res.json({ success: true, ...removed });
  } catch (error) {
    fail(res, error, "Failed to delete invoice template");
  }
});

// The customer opens /invoice/:token logged out, so the page that renders their invoice
// cannot reach any of the routes above. This mirrors how /api/settings/public serves the
// public half of the settings registry: resolution only, never the template list, and
// never anything the operator did not intend a customer to see.
export const publicInvoiceTemplateRouter = express.Router();

publicInvoiceTemplateRouter.get("/", async (req, res) => {
  try {
    const raw = req.headers?.["x-tenant-id"] || req.query?.tenant_id || req.query?.tenantId || 1;
    const parsed = Number(raw);
    const tenantId = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const resolved = await resolveInvoiceTemplateForOrder(tenantId, {
      templateId: req.query.template_id || null,
      channel: req.query.channel || "all",
      branchId: req.query.branch_id || null,
    });
    // The row id/name are operator-side metadata; the customer's page only needs the config.
    res.json({ success: true, config: resolved.config });
  } catch (error) {
    console.error("[invoice-templates] public resolve error", error);
    res.status(500).json({ success: false, message: "Failed to resolve invoice template" });
  }
});

export default router;

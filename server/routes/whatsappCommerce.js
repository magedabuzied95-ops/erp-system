import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  getWhatsappOrder,
  listCatalogProducts,
  listWhatsappCatalogs,
  listWhatsappOrders,
  syncWhatsappCatalogs,
  updateWhatsappCommerceSettings,
  updateWhatsappOrderStatus,
} from "../services/whatsappCatalogService.js";

/*
 * WhatsApp commerce (inbox → WhatsApp → Catalogs / Products / Orders), mounted at
 * /api/whatsapp/commerce. Reads are settings:view; anything that talks to Meta's write side or
 * changes an order's state is settings:edit.
 */

const router = express.Router();

const tenantOf = (req) => req.user?.tenant_id || req.user?.tenantId || req.tenant?.id || 1;

const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error("[whatsapp-commerce:error]", { code: error?.code, message: error?.message });
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || "WHATSAPP_COMMERCE_ERROR",
    meaning: error?.details?.meaning || "",
  });
};

router.get("/catalogs", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, ...(await listWhatsappCatalogs({ tenantId: tenantOf(req) })) });
  } catch (error) {
    return fail(res, error, "Failed to load WhatsApp catalogues");
  }
});

router.post("/catalogs/sync", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const summary = await syncWhatsappCatalogs({ tenantId: tenantOf(req) });
    return res.json({ success: true, summary, ...(await listWhatsappCatalogs({ tenantId: tenantOf(req) })) });
  } catch (error) {
    return fail(res, error, "Failed to sync WhatsApp catalogues");
  }
});

router.post("/catalogs/settings", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const body = req.body || {};
    const settings = await updateWhatsappCommerceSettings({
      tenantId: tenantOf(req),
      phoneNumberId: body.phone_number_id,
      isCatalogVisible: typeof body.is_catalog_visible === "boolean" ? body.is_catalog_visible : undefined,
      isCartEnabled: typeof body.is_cart_enabled === "boolean" ? body.is_cart_enabled : undefined,
    });
    return res.json({ success: true, settings });
  } catch (error) {
    return fail(res, error, "Failed to update WhatsApp commerce settings");
  }
});

router.get("/catalogs/:catalogId/products", protect, permit("settings", "view"), async (req, res) => {
  try {
    const result = await listCatalogProducts({
      tenantId: tenantOf(req),
      catalogId: req.params.catalogId,
      search: req.query.search,
      after: req.query.after,
      before: req.query.before,
      limit: req.query.limit,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to load catalogue products");
  }
});

router.get("/orders", protect, permit("settings", "view"), async (req, res) => {
  try {
    const result = await listWhatsappOrders({
      tenantId: tenantOf(req),
      status: req.query.status,
      search: req.query.search,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    return fail(res, error, "Failed to load WhatsApp orders");
  }
});

router.get("/orders/:id", protect, permit("settings", "view"), async (req, res) => {
  try {
    return res.json({ success: true, order: await getWhatsappOrder({ tenantId: tenantOf(req), id: req.params.id }) });
  } catch (error) {
    return fail(res, error, "Failed to load WhatsApp order");
  }
});

router.patch("/orders/:id", protect, permit("settings", "edit"), async (req, res) => {
  try {
    const order = await updateWhatsappOrderStatus({
      tenantId: tenantOf(req),
      id: req.params.id,
      status: req.body?.status,
      erpOrderId: req.body?.erp_order_id,
    });
    return res.json({ success: true, order });
  } catch (error) {
    return fail(res, error, "Failed to update WhatsApp order");
  }
});

export default router;

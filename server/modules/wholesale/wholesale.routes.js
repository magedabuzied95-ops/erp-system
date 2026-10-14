import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";
import { getTenantId } from "../../utils/requestScope.js";
import { requireWholesaleMode } from "./wholesaleMode.js";
import {
  createWholesaleInvoice,
  deletePriceList,
  getWholesaleInvoiceLines,
  getWholesaleProduct,
  listPriceLists,
  listWholesaleCustomers,
  listWholesaleProducts,
  previewWholesaleInvoice,
  saveCustomerTerms,
  savePriceList,
  saveWholesaleProduct,
} from "./wholesale.service.js";

// Mounted on every backend, answers only where BUSINESS_MODE=wholesale (404 on retail).
const router = express.Router();
router.use(requireWholesaleMode);

const tenantOf = (req) => getTenantId(req, req.user?.tenant_id);
const handle = (fallback, fn) => async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    if (!tenantId) return res.status(400).json({ success: false, message: "Tenant context is required" });
    const data = await fn(req, tenantId);
    return res.json({ success: true, data });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status >= 500) console.error(`[wholesale] ${fallback}`, { message: error?.message || String(error) });
    return res.status(status).json({
      success: false,
      code: error?.code || undefined,
      message: status >= 500 ? fallback : error.message,
      shortages: error?.shortages || undefined,
    });
  }
};

router.get("/price-lists", protect, permit("products", "view"), handle("Unable to load price lists", (req, tenantId) => listPriceLists({ tenantId })));
router.post("/price-lists", protect, permit("products", "edit"), handle("Unable to save price list", (req, tenantId) => savePriceList({ tenantId, ...req.body, id: null })));
router.put("/price-lists/:id", protect, permit("products", "edit"), handle("Unable to save price list", (req, tenantId) => savePriceList({ tenantId, ...req.body, id: req.params.id })));
router.delete("/price-lists/:id", protect, permit("products", "edit"), handle("Unable to delete price list", (req, tenantId) => deletePriceList({ tenantId, id: req.params.id })));

router.get("/products", protect, permit("products", "view"), handle("Unable to load products", (req, tenantId) => listWholesaleProducts({ tenantId, search: req.query.search, limit: req.query.limit })));
router.get("/products/:id", protect, permit("products", "view"), handle("Unable to load product", (req, tenantId) => getWholesaleProduct({ tenantId, productId: req.params.id })));
router.put("/products/:id", protect, permit("products", "edit"), handle("Unable to save product", (req, tenantId) => saveWholesaleProduct({ tenantId, productId: req.params.id, pack: req.body?.pack, prices: req.body?.prices })));

router.get("/customers", protect, permit("customers", "view"), handle("Unable to load customers", (req, tenantId) => listWholesaleCustomers({ tenantId, search: req.query.search, limit: req.query.limit })));
router.put("/customers/:id/terms", protect, permit("customers", "edit"), handle("Unable to save customer terms", (req, tenantId) => saveCustomerTerms({ tenantId, customerId: req.params.id, ...req.body })));

router.post("/invoices/preview", protect, permit("orders", "create"), handle("Unable to price the invoice", (req, tenantId) =>
  previewWholesaleInvoice({ tenantId, customerId: req.body?.customer_id, priceListId: req.body?.price_list_id, lines: req.body?.lines })));
router.post("/invoices", protect, permit("orders", "create"), handle("Unable to save the invoice", (req, tenantId) => createWholesaleInvoice({ req, tenantId, body: req.body || {} })));
router.get("/invoices/:orderId/lines", protect, permit("orders", "view"), handle("Unable to load invoice lines", (req, tenantId) => getWholesaleInvoiceLines({ tenantId, orderId: req.params.orderId })));

export default router;

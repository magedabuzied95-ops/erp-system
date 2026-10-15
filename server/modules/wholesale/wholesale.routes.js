import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";
import { getTenantId } from "../../utils/requestScope.js";
import paymentProofUpload from "../../config/paymentProofUpload.js";
import { requireWholesaleMode } from "./wholesaleMode.js";
import { buildWholesaleStatement } from "./wholesale.statement.js";
import {
  getCustomerReminder,
  getReminderLineOptions,
  saveCustomerReminder,
  sendCustomerReminderNow,
  setReminderLine,
} from "./wholesale.reminders.js";
import {
  approveSubmission,
  customerCreditPosition,
  getStatementLink,
  listSubmissions,
  recordStaffPayment,
  rejectSubmission,
} from "./wholesale.payments.js";
import {
  getCustomerTerms,
  getWholesalePrices,
  listAllWholesalePrices,
  getWholesaleProduct,
  listWholesaleCustomers,
  listWholesaleProducts,
  previewWholesaleInvoice,
  saveCustomerTerms,
  saveWholesaleProduct,
  setWholesalePrices,
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

router.get("/products", protect, permit("products", "view"), handle("Unable to load products", (req, tenantId) => listWholesaleProducts({ tenantId, search: req.query.search, limit: req.query.limit })));
router.get("/products/:id", protect, permit("products", "view"), handle("Unable to load product", (req, tenantId) => getWholesaleProduct({ tenantId, productId: req.params.id })));
router.put("/products/:id", protect, permit("products", "edit"), handle("Unable to save product", (req, tenantId) => saveWholesaleProduct({ tenantId, productId: req.params.id, settings: req.body?.settings })));
// POS: every model's tier piece prices (the cart and the cards price from these).
router.get("/prices", protect, permit("pos", "view"), handle("Unable to load prices", (req, tenantId) => listAllWholesalePrices({ tenantId })));
// Purchases: read / write the two tier prices of many models at once.
router.post("/prices/lookup", protect, permit("purchases", "view"), handle("Unable to load prices", (req, tenantId) => getWholesalePrices({ tenantId, productIds: req.body?.product_ids })));
router.put("/prices", protect, permit("products", "edit"), handle("Unable to save prices", (req, tenantId) => setWholesalePrices({ tenantId, prices: req.body?.prices })));

router.get("/customers", protect, permit("customers", "view"), handle("Unable to load customers", (req, tenantId) => listWholesaleCustomers({ tenantId, search: req.query.search, limit: req.query.limit })));
router.get("/customers/:id/terms", protect, permit("customers", "view"), handle("Unable to load customer terms", (req, tenantId) => getCustomerTerms({ tenantId, customerId: req.params.id })));
router.put("/customers/:id/terms", protect, permit("customers", "edit"), handle("Unable to save customer terms", (req, tenantId) => saveCustomerTerms({ tenantId, customerId: req.params.id, ...req.body })));

// Credit customers: their ledger, private link, POS warning, and payments with screenshots.
router.get("/customers/:id/statement", protect, permit("customers", "view"), handle("Unable to load the statement", (req, tenantId) =>
  buildWholesaleStatement({ tenantId, customerId: Number(req.params.id) })));
router.post("/customers/:id/statement-link", protect, permit("customers", "view"), handle("Unable to create the link", (req, tenantId) =>
  getStatementLink({ tenantId, customerId: req.params.id, rotate: req.body?.rotate === true })));
router.get("/customers/:id/credit", protect, permit("pos", "view"), handle("Unable to load the customer balance", (req, tenantId) =>
  customerCreditPosition({ tenantId, customerId: req.params.id })));
router.get("/payments", protect, permit("customers", "view"), handle("Unable to load payments", (req, tenantId) =>
  listSubmissions({ tenantId, status: req.query.status || "pending", limit: req.query.limit })));
router.post(
  "/payments",
  protect,
  permit("customers", "edit"),
  (req, res, next) => paymentProofUpload.single("screenshot")(req, res, (error) => (
    error ? res.status(400).json({ success: false, message: "صورة التحويل لازم تكون PNG أو JPG أو WEBP وأصغر من 10 ميجا." }) : next()
  )),
  handle("Unable to record the payment", (req, tenantId) => recordStaffPayment({
    req,
    tenantId,
    customerId: req.body?.customer_id,
    amount: req.body?.amount,
    method: req.body?.method,
    reference: req.body?.reference,
    note: req.body?.note,
    imageUrl: req.file ? `/uploads/payment-proofs/${req.file.filename}` : "",
  }))
);
router.post("/payments/:id/approve", protect, permit("customers", "edit"), handle("Unable to approve the payment", (req, tenantId) =>
  approveSubmission({ req, tenantId, id: req.params.id, amount: req.body?.amount })));
router.post("/payments/:id/reject", protect, permit("customers", "edit"), handle("Unable to reject the payment", (req, tenantId) =>
  rejectSubmission({ req, tenantId, id: req.params.id, reason: req.body?.reason })));

// Weekly balance reminder: each customer's own day / hour (Customer 360), one shop-wide line.
router.get("/reminders/line", protect, permit("customers", "view"), handle("Unable to load the reminder line", (req, tenantId) =>
  getReminderLineOptions({ tenantId })));
router.put("/reminders/line", protect, permit("customers", "edit"), handle("Unable to save the reminder line", (req, tenantId) =>
  setReminderLine({ tenantId, instance: req.body?.instance })));
router.get("/customers/:id/reminder", protect, permit("customers", "view"), handle("Unable to load the reminder", (req, tenantId) =>
  getCustomerReminder({ tenantId, customerId: req.params.id })));
router.put("/customers/:id/reminder", protect, permit("customers", "edit"), handle("Unable to save the reminder", (req, tenantId) =>
  saveCustomerReminder({ tenantId, customerId: req.params.id, settings: req.body?.settings || req.body })));
router.post("/customers/:id/reminder/send", protect, permit("customers", "edit"), handle("Unable to send the reminder", (req, tenantId) =>
  sendCustomerReminderNow({ tenantId, customerId: req.params.id })));

// POS unit picker: splits a series / carton / dozen into pieces per colour and checks stock.
router.post("/invoices/preview", protect, permit("pos", "view"), handle("Unable to price the selection", (req, tenantId) =>
  previewWholesaleInvoice({ tenantId, customerId: req.body?.customer_id, tier: req.body?.tier, lines: req.body?.lines })));

export default router;

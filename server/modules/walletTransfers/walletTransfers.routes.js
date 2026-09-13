import express from "express";
import { protect } from "../../middleware/authMiddleware.js";
import permit from "../../middleware/permissionMiddleware.js";
import { getPublicBackendUrl } from "../../utils/publicUrl.js";
import {
  getWalletSmsSecret,
  ignoreWalletTransfer,
  ingestTransferSms,
  listWalletTransfers,
  matchWalletTransferManually,
  rotateWalletSmsSecret,
  walletSmsSecretMatches,
} from "./walletTransfers.service.js";

const router = express.Router();
const DEFAULT_TENANT_ID = 1;

const text = (value = "") => String(value ?? "").trim();
const tenantOf = (req) => {
  const value = Number(req.user?.tenant_id ?? req.get("x-tenant-id"));
  return Number.isFinite(value) && value > 0 ? value : null;
};
const fail = (res, error, fallback) => {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(`[wallet-transfers] ${fallback}`, { message: error?.message || String(error) });
  return res.status(status).json({ success: false, message: status >= 500 ? fallback : error.message });
};

// The owner's iPhone Shortcuts post every Vodafone Cash / bank SMS here: { text, sender }.
// No session, so the shared secret is the whole gate. A message the server keeps but
// cannot use still answers 200 — the Shortcut has nothing useful to do with an error.
router.post("/sms", async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const auth = await walletSmsSecretMatches(req.get("x-wallet-secret") || req.query?.token || body.secret);
  if (!auth.configured) return res.status(503).json({ success: false, message: "Wallet SMS webhook is not configured" });
  if (!auth.ok) return res.status(401).json({ success: false, message: "Invalid wallet SMS secret" });
  try {
    const tenantHeader = Number(req.get("x-tenant-id"));
    const result = await ingestTransferSms({
      tenantId: Number.isFinite(tenantHeader) && tenantHeader > 0 ? tenantHeader : DEFAULT_TENANT_ID,
      rawText: body.text ?? body.message ?? body.body ?? (typeof req.body === "string" ? req.body : ""),
      sender: body.sender ?? body.from ?? "",
    });
    return res.json({
      success: true,
      outcome: result.outcome,
      transfer_id: result.transfer?.id || null,
      order_id: result.transfer?.order_id || null,
    });
  } catch (error) {
    return fail(res, error, "Failed to record wallet SMS");
  }
});

router.get("/", protect, permit("orders", "view"), async (req, res) => {
  try {
    const data = await listWalletTransfers({ tenantId: tenantOf(req), status: text(req.query.status) || "review", limit: req.query.limit });
    return res.json({ success: true, ...data });
  } catch (error) {
    return fail(res, error, "Failed to load wallet transfers");
  }
});

router.post("/:id/match", protect, permit("orders", "edit"), async (req, res) => {
  try {
    const result = await matchWalletTransferManually({
      tenantId: tenantOf(req),
      transferId: Number(req.params.id),
      orderId: req.body?.order_id || null,
      invoiceNumber: req.body?.invoice_number || "",
      userId: req.user?.id || null,
    });
    return res.json({ success: true, transfer: result?.transfer, order_id: result?.order?.id || null, confirmed: Boolean(result?.confirmed) });
  } catch (error) {
    return fail(res, error, "Failed to match wallet transfer");
  }
});

router.post("/:id/ignore", protect, permit("orders", "edit"), async (req, res) => {
  try {
    const transfer = await ignoreWalletTransfer({ tenantId: tenantOf(req), transferId: Number(req.params.id), userId: req.user?.id || null });
    return res.json({ success: true, transfer });
  } catch (error) {
    return fail(res, error, "Failed to ignore wallet transfer");
  }
});

// What the owner types into the Shortcut. The key is shown only to settings editors.
const setupPayload = async (req, secret) => {
  const base = text(getPublicBackendUrl()) || `${req.protocol}://${req.get("host")}`;
  return { success: true, webhook_url: `${base.replace(/\/+$/, "")}/api/wallet-transfers/sms`, header_name: "X-Wallet-Secret", secret };
};

router.get("/setup", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json(await setupPayload(req, await getWalletSmsSecret()));
  } catch (error) {
    return fail(res, error, "Failed to load wallet SMS setup");
  }
});

router.post("/setup/rotate", protect, permit("settings", "edit"), async (req, res) => {
  try {
    return res.json(await setupPayload(req, await rotateWalletSmsSecret(req.user?.id || null)));
  } catch (error) {
    return fail(res, error, "Failed to create wallet SMS key");
  }
});

export default router;

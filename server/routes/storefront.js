import express from "express";
import multer from "multer";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import {
  accountByPhone,
  createShipment,
  createWebsiteOrder,
  getProduct,
  getProductByToken,
  latestShippingAddress,
  listGenderClassifications,
  listLastPieceProducts,
  listNotifications,
  listProducts,
  resolveProductLink,
  listShippingProviders,
  buildStorefrontHomeFromProducts,
  saveRecentlyViewed,
  saveWishlist,
  searchProducts,
  trackOrder,
  visualSearchProducts,
} from "../controllers/storefrontController.js";
import paymentProofUpload from "../config/paymentProofUpload.js";
import { getWebsiteSettings } from "../services/liveActivityService.js";
import {
  createOrRestoreStorefrontCustomerSession,
  getStorefrontCustomerSession,
  readStorefrontCustomerToken,
  restoreStorefrontCustomerCart,
  setStorefrontCustomerCookie,
} from "../services/storefrontCustomerSessionService.js";

const router = express.Router();
const IMAGE_TOO_LARGE_MESSAGE = "\u062d\u062c\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u0643\u0628\u064a\u0631. \u0627\u0631\u0641\u0639 \u0635\u0648\u0631\u0629 \u0623\u0635\u063a\u0631";
const UNSUPPORTED_IMAGE_MESSAGE = "\u0646\u0648\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u063a\u064a\u0631 \u0645\u062f\u0639\u0648\u0645. \u0627\u0633\u062a\u062e\u062f\u0645 JPG \u0623\u0648 PNG \u0623\u0648 WEBP";
const visualSearchUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.STOREFRONT_VISUAL_SEARCH_MAX_BYTES || 8 * 1024 * 1024),
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) return cb(null, true);
    return cb(new Error("Unsupported image type"));
  },
});
const checkoutUpload = (req, res, next) => {
  paymentProofUpload.single("shipping_payment_screenshot")(req, res, (error) => {
    if (error) {
      const receivedPayload = {
        checkout: req.body?.checkout || null,
        items: req.body?.items || null,
        delivery_fee: req.body?.delivery_fee || null,
        discount: req.body?.discount || null,
        bodyKeys: Object.keys(req.body || {}),
      };
      return res.status(400).json({
        success: false,
        message: "يرجى رفع صورة إثبات تحويل صالحة",
        field: "shipping_payment_screenshot",
        details: {
          code: error.code || "invalid_upload",
          reason: error.message || "invalid_payment_proof",
        },
        receivedPayload,
      });
    }
    next();
  });
};
const visualUpload = (req, res, next) => {
  visualSearchUpload.single("image")(req, res, (error) => {
    console.log("[visual-search] route upload", {
      req_file_exists: Boolean(req.file),
      mimetype: req.file?.mimetype || "",
      size: req.file?.size || req.file?.buffer?.length || 0,
      tenant_id: req.headers?.["x-tenant-id"] || req.body?.tenant_id || req.query?.tenant_id || "",
      error: error?.message || "",
    });
    if (!error) return next();
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE" ? IMAGE_TOO_LARGE_MESSAGE : UNSUPPORTED_IMAGE_MESSAGE,
    });
  });
};

const customerSessionBuckets = new Map();
const customerSessionRateLimit = (req, res, next) => {
  const key = `${req.ip || req.socket?.remoteAddress || "unknown"}:${req.headers?.["x-tenant-id"] || req.body?.tenant_id || req.query?.tenant_id || "1"}`;
  const now = Date.now();
  const windowMs = 60_000;
  const maxAttempts = 8;
  const bucket = customerSessionBuckets.get(key) || [];
  const recent = bucket.filter((time) => now - time < windowMs);
  if (recent.length >= maxAttempts) {
    customerSessionBuckets.set(key, recent);
    return res.status(429).json({ success: false, message: "محاولات كثيرة. جرّب بعد دقيقة." });
  }
  recent.push(now);
  customerSessionBuckets.set(key, recent);
  next();
};

const publicTenantId = (req) => {
  const raw = req.headers?.["x-tenant-id"] || req.body?.tenant_id || req.query?.tenant_id || req.body?.tenantId || req.query?.tenantId || 1;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const firstSettingValue = (settings = {}, ...keys) => keys.map((key) => settings?.[key]).find((value) => value !== undefined && value !== null) ?? null;

const settingObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) return value;
  return null;
};

const settingArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return [];
};

const configuredHomeFromSettings = (settings = {}) => ({
  hero: settingObject(firstSettingValue(settings, "homepage_hero", "storefront_homepage_hero", "storefront.homepage_hero")),
  featured_collections: settingArray(firstSettingValue(settings, "featured_collections", "storefront_featured_collections", "storefront.featured_collections")),
});

const resolveStorefrontHome = async ({ tenantId, settings }) => {
  const configured = configuredHomeFromSettings(settings);
  if (configured.hero && configured.featured_collections.length) {
    return { ...configured, source: "settings" };
  }
  const generated = await buildStorefrontHomeFromProducts({ tenantId, settings });
  return {
    ...generated,
    hero: configured.hero || generated.hero,
    featured_collections: configured.featured_collections.length ? configured.featured_collections : generated.featured_collections,
    source: configured.hero || configured.featured_collections.length ? "settings_with_product_fallback" : generated.source,
  };
};

const getPublicStorefrontSettings = async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const settings = await getWebsiteSettings({ tenantId });
    const home = await resolveStorefrontHome({ tenantId, settings });
    return res.json({ success: true, settings, home });
  } catch (error) {
    console.error("[storefront] settings", {
      requestId: req.id,
      tenant_id: publicTenantId(req),
      message: error?.message || String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to load storefront settings" });
  }
};

const getPublicStorefrontHome = async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const settings = await getWebsiteSettings({ tenantId });
    const home = await resolveStorefrontHome({ tenantId, settings });
    return res.json({
      success: true,
      settings,
      home,
    });
  } catch (error) {
    console.error("[storefront] home", {
      requestId: req.id,
      tenant_id: publicTenantId(req),
      message: error?.message || String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to load storefront home" });
  }
};

router.post("/customer/session", customerSessionRateLimit, async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const payload = await createOrRestoreStorefrontCustomerSession({
      tenantId,
      name: req.body?.name || req.body?.full_name || "",
      phone: req.body?.phone || req.body?.mobile || "",
      cartItems: Array.isArray(req.body?.cart_items) ? req.body.cart_items : [],
      wishlistItems: Array.isArray(req.body?.wishlist_items) ? req.body.wishlist_items : [],
      req,
    });
    setStorefrontCustomerCookie(res, payload.token, req);
    return res.json({ success: true, ...payload });
  } catch (error) {
    const status = error.status || 500;
    console.error("[storefront-customer-session] submit failed", {
      requestId: req.id,
      status,
      tenant_id: publicTenantId(req),
      has_name: Boolean(req.body?.name || req.body?.full_name),
      phone_suffix: String(req.body?.phone || req.body?.mobile || "").replace(/\D/g, "").slice(-4),
      cart_count: Array.isArray(req.body?.cart_items) ? req.body.cart_items.length : 0,
      message: error?.message || String(error),
      code: error?.code || "",
      detail: error?.detail || "",
      query_location: error?.queryLocation || "",
      table: error?.table || "",
      column: error?.column || "",
      constraint: error?.constraint || "",
      insert_payload_keys: error?.insertPayloadKeys || undefined,
    });
    return res.status(status).json({
      success: false,
      message: error.message === "INVALID_PHONE" ? "اكتب رقم موبايل مصري صحيح" : "تعذر حفظ بيانات العميل حاليا",
      error_code: error.message === "INVALID_PHONE" ? "invalid_phone" : error.publicCode || "customer_session_failed",
    });
  }
});

router.get("/customer/me", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const token = readStorefrontCustomerToken(req);
    const session = await getStorefrontCustomerSession({ tenantId, token });
    if (!session) return res.json({ success: true, identified: false });
    return res.json({ success: true, identified: true, ...session });
  } catch (error) {
    console.warn("[storefront-customer-session] restore identity failed", {
      requestId: req.id,
      tenant_id: publicTenantId(req),
      message: error?.message || String(error),
    });
    return res.json({ success: true, identified: false });
  }
});

router.post("/customer/restore-cart", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const token = readStorefrontCustomerToken(req);
    const restored = await restoreStorefrontCustomerCart({
      tenantId,
      token,
      cartItems: Array.isArray(req.body?.cart_items) ? req.body.cart_items : [],
      wishlistItems: Array.isArray(req.body?.wishlist_items) ? req.body.wishlist_items : [],
    });
    if (!restored) return res.json({ success: true, restored: false });
    return res.json({ success: true, restored: true, ...restored });
  } catch (error) {
    console.error("[storefront-customer-session] cart restore failed", {
      requestId: req.id,
      tenant_id: publicTenantId(req),
      message: error?.message || String(error),
      code: error?.code || "",
    });
    return res.status(500).json({ success: false, message: "تعذر استرجاع السلة حاليا" });
  }
});

router.get("/settings", getPublicStorefrontSettings);
router.get("/home", getPublicStorefrontHome);
router.get("/products", listProducts);
router.get("/classifications/gender", listGenderClassifications);
router.get("/last-piece", listLastPieceProducts);
router.get("/products/search", searchProducts);
router.post("/products/visual-search", visualUpload, visualSearchProducts);
router.get("/product/by-token/:token", getProductByToken);
router.get("/products/resolve/:slugOrId", resolveProductLink);
router.get("/products/:identifier", getProduct);
router.post("/checkout", checkoutUpload, createWebsiteOrder);
router.get("/track", trackOrder);
router.post("/track", trackOrder);
router.get("/account", accountByPhone);
router.get("/customers/latest-shipping-address", latestShippingAddress);
router.post("/wishlist", saveWishlist);
router.delete("/wishlist", saveWishlist);
router.post("/recently-viewed", saveRecentlyViewed);
router.get("/notifications", listNotifications);
router.get("/shipping/providers", listShippingProviders);
router.post("/shipping/orders/:orderId/create-shipment", protect, permit("orders", "edit"), createShipment);

export default router;

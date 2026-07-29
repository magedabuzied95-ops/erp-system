import express from "express";
import multer from "multer";
import db from "../database/db.js";
import { protect } from "../middleware/authMiddleware.js";
import permit from "../middleware/permissionMiddleware.js";
import { ensureBrandsTable } from "../controllers/brandsController.js";
import {
  accountByPhone,
  createShipment,
  createWebsiteOrder,
  getProduct,
  getProductByToken,
  getShippingQuote,
  getStorefrontCustomerCart,
  getStorefrontCustomerPreferences,
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
  updateStorefrontCustomerCart,
  updateStorefrontCustomerPreferences,
  searchProducts,
  imageSearchProducts,
  trackOrder,
  visualSearchProducts,
} from "../controllers/storefrontController.js";
import {
  loginStorefrontCustomerEmailAuth,
  registerStorefrontCustomerEmailAuth,
  requestStorefrontCustomerPasswordReset,
  resetStorefrontCustomerPassword,
} from "../services/storefrontCustomerEmailAuthService.js";
import paymentProofUpload from "../config/paymentProofUpload.js";
import { getWebsiteSettings } from "../services/liveActivityService.js";
import { getSetting } from "../services/settingsService.js";
import {
  createOrRestoreStorefrontCustomerSession,
  getStorefrontCustomerSession,
  readStorefrontCustomerToken,
  restoreStorefrontCustomerCart,
  setStorefrontCustomerCookie,
} from "../services/storefrontCustomerSessionService.js";
import { requestCustomerOtp, verifyCustomerOtp } from "../services/customerOtpAuthService.js";
import { hasStorefrontCustomerToken, requireStorefrontCustomerAuth } from "../middleware/storefrontCustomerAuth.js";
import { sendStorefrontMetaEvent } from "../services/metaConversionsApiService.js";
import {
  storefrontRobotsHandler,
  storefrontSitemapHandler,
} from "../services/storefrontSeoService.js";
import { storefrontProductSeoPageHandler } from "../services/storefrontProductSeoPageService.js";
import { storefrontCategorySeoPageHandler } from "../services/storefrontCategorySeoPageService.js";

const router = express.Router();
const publicStorefrontHomeCache = new Map();
const PUBLIC_STOREFRONT_HOME_CACHE_TTL_MS = Math.max(5_000, Number(process.env.STOREFRONT_HOME_CACHE_TTL_MS || 60_000));
const IMAGE_TOO_LARGE_MESSAGE = "\u062d\u062c\u0645 \u0627\u0644\u0635\u0648\u0631\u0629 \u0643\u0628\u064a\u0631. \u0627\u0631\u0641\u0639 \u0635\u0648\u0631\u0629 \u0623\u0635\u063a\u0631";
const UNSUPPORTED_IMAGE_MESSAGE = "\u0646\u0648\u0639 \u0627\u0644\u0635\u0648\u0631\u0629 \u063a\u064a\u0631 \u0645\u062f\u0639\u0648\u0645. \u0627\u0633\u062a\u062e\u062f\u0645 JPG \u0623\u0648 PNG \u0623\u0648 WEBP";
const toText = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};
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

const storefrontCustomerTransitionAuth = (req, res, next) => {
  if (!hasStorefrontCustomerToken(req)) {
    req.storefrontCustomer = null;
    return next();
  }
  return requireStorefrontCustomerAuth(req, res, next);
};

const storefrontCustomerAuthRequired = [requireStorefrontCustomerAuth, (req, _res, next) => {
  const jwtPhone = toText(req.storefrontCustomer?.phone || "");
  if (req.query && typeof req.query === "object") {
    req.query.phone = jwtPhone;
  }
  if (req.body && typeof req.body === "object") {
    req.body.phone = jwtPhone;
  }
  if (req.params && typeof req.params === "object") {
    req.params.phone = jwtPhone;
  }
  logProtectedCustomerEndpoint(req, jwtPhone);
  return next();
}];

const resolveStorefrontCustomerPhone = (req = {}) => {
  const jwtPhone = toText(req.storefrontCustomer?.phone || "");
  if (jwtPhone) return jwtPhone;
  return toText(req.query?.phone || req.body?.phone || req.body?.mobile || req.params?.phone || "");
};

const logProtectedCustomerEndpoint = (req, phone = "") => {
  console.log("[customer-auth] protected-endpoint", {
    endpoint: req.originalUrl || req.path || "",
    phone_jwt: phone || "",
  });
};

const publicTenantId = (req) => {
  const raw = req.headers?.["x-tenant-id"] || req.body?.tenant_id || req.query?.tenant_id || req.body?.tenantId || req.query?.tenantId || 1;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
};

const slugifyBrandName = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "") || "";

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

const cachedPublicStorefrontHome = async (tenantId) => {
  const key = String(tenantId || 1);
  const now = Date.now();
  const cached = publicStorefrontHomeCache.get(key);
  if (cached?.data && now - cached.at < PUBLIC_STOREFRONT_HOME_CACHE_TTL_MS) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const settings = await getWebsiteSettings({ tenantId });
    const home = await resolveStorefrontHome({ tenantId, settings });
    const data = { settings, home };
    publicStorefrontHomeCache.set(key, { at: Date.now(), data });
    return data;
  })().catch((error) => {
    publicStorefrontHomeCache.delete(key);
    throw error;
  });
  publicStorefrontHomeCache.set(key, { at: now, promise });
  return promise;
};

const setPublicStorefrontHomeCacheHeaders = (res) => {
  res.vary("X-Tenant-Id");
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
};

const getPublicStorefrontSettings = async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const [
      websiteSettings,
      returnExchangeWindowDays,
      returnPolicyEnabled,
      returnMethod,
      customerRemorseReturnFees,
      defectReturnFees,
      returnPolicyUrl,
      returnPolicyConditions,
    ] = await Promise.all([
      getWebsiteSettings({ tenantId }),
      getSetting("orders.return_exchange_window_days"),
      getSetting("storefront.return_policy_enabled"),
      getSetting("storefront.return_method"),
      getSetting("storefront.customer_remorse_return_fees"),
      getSetting("storefront.defect_return_fees"),
      getSetting("storefront.return_policy_url"),
      getSetting("storefront.return_policy_conditions"),
    ]);
    const settings = {
      ...websiteSettings,
      return_exchange_window_days: returnExchangeWindowDays,
      return_policy_enabled: returnPolicyEnabled,
      return_method: returnMethod,
      customer_remorse_return_fees: customerRemorseReturnFees,
      defect_return_fees: defectReturnFees,
      return_policy_url: returnPolicyUrl,
      return_policy_conditions: returnPolicyConditions,
    };
    const home = await resolveStorefrontHome({ tenantId, settings });
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    console.debug("[storefront:public-settings-response]", {
      tenant_id: tenantId,
      sale_mode_enabled: settings.sale_mode_enabled,
    });
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
    const { settings, home } = await cachedPublicStorefrontHome(tenantId);
    setPublicStorefrontHomeCacheHeaders(res);
    console.debug("[storefront:public-home-response]", {
      tenant_id: tenantId,
      sale_mode_enabled: settings.sale_mode_enabled,
    });
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

const normalizeStorefrontBrand = (row = {}) => {
  const logoUrl = String(row.logo_url || row.image_url || row.logo || row.image || row.logoUrl || row.imageUrl || "").trim();
  return {
    id: row.id,
    name: String(row.name || "").trim(),
    slug: String(row.slug || row.brand_slug || row.brandSlug || slugifyBrandName(row.name) || row.id || "").trim(),
    logo_url: logoUrl,
    image_url: logoUrl,
    sort_order: Number(row.sort_order || 0) || 0,
  };
};

const getPublicStorefrontBrands = async (req, res) => {
  try {
    await ensureBrandsTable();
    const tenantId = publicTenantId(req);
    const result = await db.query(
      `
      SELECT id, name, slug, logo_url, image_url, sort_order, status
      FROM brands
      WHERE ($1::bigint IS NULL OR tenant_id = $1::bigint OR tenant_id IS NULL)
        AND COALESCE(NULLIF(LOWER(TRIM(status)), ''), 'active') = 'active'
        AND COALESCE(NULLIF(TRIM(logo_url), ''), NULLIF(TRIM(image_url), '')) IS NOT NULL
      ORDER BY COALESCE(sort_order, 0) ASC, LOWER(TRIM(name)) ASC, id ASC
      `,
      [tenantId]
    );
    const brands = result.rows.map(normalizeStorefrontBrand).filter((brand) => brand.logo_url);
    return res.json({ success: true, brands, data: brands });
  } catch (error) {
    console.error("[storefront] brands", {
      requestId: req.id,
      tenant_id: publicTenantId(req),
      message: error?.message || String(error),
    });
    return res.status(500).json({ success: false, message: "Failed to load storefront brands" });
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

router.post("/auth/request-otp", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const result = await requestCustomerOtp({
      tenantId,
      phone: req.body?.phone || req.body?.mobile || "",
    });
    if (result?.cooldown) {
      return res.status(429).json({
        success: false,
        message: "رجاءً انتظر قليلًا قبل طلب كود جديد",
        retry_after_seconds: result.retry_after_seconds || 60,
      });
    }
    return res.json({ success: true, sent: true });
  } catch (error) {
    if (error?.code === "OTP_RATE_LIMITED") {
      return res.status(429).json({
        success: false,
        error: "OTP_RATE_LIMITED",
        message: "تم طلب كود الدخول عدة مرات. حاول مرة أخرى بعد قليل.",
        retry_after_seconds: Number(error?.retry_after_seconds || 60),
      });
    }
    return res.status(error?.status || 500).json({
      success: false,
      message: "تعذر إرسال كود الدخول حاليًا",
    });
  }
});

router.post("/auth/register", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const result = await registerStorefrontCustomerEmailAuth({
      tenantId,
      name: req.body?.name || "",
      email: req.body?.email || "",
      phone: req.body?.phone || req.body?.mobile || "",
      password: req.body?.password || "",
    });
    return res.status(201).json({
      success: true,
      token: result.token,
      customer: result.customer,
    });
  } catch (error) {
    return res.status(error?.status || 400).json({
      success: false,
      message: error?.message || "تعذر إنشاء الحساب حاليا",
      error: error?.code || "EMAIL_AUTH_REGISTER_FAILED",
    });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const result = await loginStorefrontCustomerEmailAuth({
      tenantId,
      email: req.body?.email || "",
      password: req.body?.password || "",
    });
    return res.json({
      success: true,
      token: result.token,
      customer: result.customer,
    });
  } catch (error) {
    return res.status(error?.status || 400).json({
      success: false,
      message: error?.message || "البريد أو كلمة المرور غير صحيحة",
      error: error?.code || "EMAIL_AUTH_LOGIN_FAILED",
    });
  }
});

router.post("/auth/request-reset", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    await requestStorefrontCustomerPasswordReset({
      tenantId,
      email: req.body?.email || "",
    });
    return res.json({
      success: true,
      sent: true,
      message: "إذا كان الحساب موجودًا، فستصلك رسالة إعادة التعيين خلال دقائق.",
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      success: false,
      message: error?.message || "تعذر إرسال رسالة إعادة التعيين حاليا",
      error: error?.code || "PASSWORD_RESET_REQUEST_FAILED",
    });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    await resetStorefrontCustomerPassword({
      tenantId,
      token: req.body?.token || "",
      password: req.body?.password || "",
    });
    return res.json({
      success: true,
      message: "تم تحديث كلمة المرور بنجاح",
    });
  } catch (error) {
    return res.status(error?.status || 400).json({
      success: false,
      message: error?.message || "تعذر تحديث كلمة المرور",
      error: error?.code || "PASSWORD_RESET_FAILED",
    });
  }
});

router.post("/auth/verify-otp", async (req, res) => {
  try {
    const tenantId = publicTenantId(req);
    const result = await verifyCustomerOtp({
      tenantId,
      phone: req.body?.phone || req.body?.mobile || "",
      otp: req.body?.otp || "",
    });
    if (!result?.success) {
      return res.status(400).json({
        success: false,
        message: "كود الدخول غير صحيح أو منتهي",
      });
    }
    return res.json({
      success: true,
      token: result.token,
      customer: { phone: result.customer?.phone || "" },
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "كود الدخول غير صحيح أو منتهي",
    });
  }
});

router.get("/settings", getPublicStorefrontSettings);
router.get("/home", getPublicStorefrontHome);
router.get("/brands", getPublicStorefrontBrands);
router.get("/seo/sitemap.xml", storefrontSitemapHandler);
router.get("/seo/robots.txt", storefrontRobotsHandler);
router.get("/seo/product/:identifier", storefrontProductSeoPageHandler);
router.get("/seo/category/:categoryKey", storefrontCategorySeoPageHandler);
router.get("/products", listProducts);
router.get("/classifications/gender", listGenderClassifications);
router.get("/last-piece", listLastPieceProducts);
router.get("/products/search", searchProducts);
router.post("/products/visual-search", visualUpload, visualSearchProducts);
router.post("/image-search", visualUpload, imageSearchProducts);
router.get("/product/by-token/:token", getProductByToken);
router.get("/products/resolve/:slugOrId", resolveProductLink);
router.get("/products/:identifier", getProduct);
router.get("/shipping/quote", getShippingQuote);
router.post("/meta/events", storefrontCustomerTransitionAuth, async (req, res) => {
  const eventName = toText(req.body?.event_name);
  if (!["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"].includes(eventName)) {
    return res.status(400).json({ success: false, message: "Unsupported Meta event" });
  }
  try {
    const authenticatedCustomer = req.storefrontCustomer || {};
    const authenticatedNameParts = toText(authenticatedCustomer.name).split(/\s+/).filter(Boolean);
    const result = await sendStorefrontMetaEvent({
      req,
      event: {
        ...(req.body || {}),
        email: authenticatedCustomer.email || req.body?.email,
        phone: authenticatedCustomer.phone || req.body?.phone,
        first_name: authenticatedNameParts[0] || req.body?.first_name,
        last_name: authenticatedNameParts.slice(1).join(" ") || req.body?.last_name,
        city: req.body?.city,
        state: req.body?.state,
        country: req.body?.country,
        external_id: authenticatedCustomer.customer_id || req.body?.external_id,
      },
      tenantId: publicTenantId(req),
    });
    return res.status(202).json({ success: true, capi_sent: Boolean(result.sent), reason: result.reason || "" });
  } catch {
    // Browser Pixel is already sent; avoid exposing Meta details or customer data.
    return res.status(202).json({ success: true, capi_sent: false, reason: "delivery_unavailable" });
  }
});
router.post("/checkout", checkoutUpload, createWebsiteOrder);
router.get("/track", storefrontCustomerTransitionAuth, async (req, res, next) => {
  const jwtPhone = toText(req.storefrontCustomer?.phone || "");
  const resolvedPhone = resolveStorefrontCustomerPhone(req);
  if (req.query && typeof req.query === "object") {
    req.query.phone = jwtPhone || resolvedPhone;
  }
  if (req.body && typeof req.body === "object") {
    req.body.phone = jwtPhone || resolvedPhone;
  }
  logProtectedCustomerEndpoint(req, jwtPhone);
  return trackOrder(req, res, next);
});
router.post("/track", storefrontCustomerTransitionAuth, async (req, res, next) => {
  const jwtPhone = toText(req.storefrontCustomer?.phone || "");
  const resolvedPhone = resolveStorefrontCustomerPhone(req);
  if (req.query && typeof req.query === "object") {
    req.query.phone = jwtPhone || resolvedPhone;
  }
  if (req.body && typeof req.body === "object") {
    req.body.phone = jwtPhone || resolvedPhone;
  }
  logProtectedCustomerEndpoint(req, jwtPhone);
  return trackOrder(req, res, next);
});
router.get("/account", ...storefrontCustomerAuthRequired, async (req, res, next) => accountByPhone(req, res, next));
router.get("/customer/preferences", ...storefrontCustomerAuthRequired, async (req, res, next) => getStorefrontCustomerPreferences(req, res, next));
router.put("/customer/preferences", ...storefrontCustomerAuthRequired, async (req, res, next) => updateStorefrontCustomerPreferences(req, res, next));
router.get("/customer/cart", ...storefrontCustomerAuthRequired, async (req, res, next) => getStorefrontCustomerCart(req, res, next));
router.put("/customer/cart", ...storefrontCustomerAuthRequired, async (req, res, next) => updateStorefrontCustomerCart(req, res, next));
router.get("/customers/latest-shipping-address", storefrontCustomerTransitionAuth, async (req, res, next) => {
  const jwtPhone = toText(req.storefrontCustomer?.phone || "");
  const resolvedPhone = resolveStorefrontCustomerPhone(req);
  if (req.query && typeof req.query === "object") {
    req.query.phone = jwtPhone || resolvedPhone;
    req.query.primary_phone = jwtPhone || resolvedPhone;
    req.query.email = jwtPhone ? "" : toText(req.query?.email || req.query?.customer_email || "");
    req.query.customer_email = jwtPhone ? "" : toText(req.query?.email || req.query?.customer_email || "");
  }
  logProtectedCustomerEndpoint(req, jwtPhone);
  return latestShippingAddress(req, res, next);
});
router.post("/wishlist", ...storefrontCustomerAuthRequired, async (req, res, next) => saveWishlist(req, res, next));
router.delete("/wishlist", ...storefrontCustomerAuthRequired, async (req, res, next) => saveWishlist(req, res, next));
router.post("/recently-viewed", ...storefrontCustomerAuthRequired, async (req, res, next) => saveRecentlyViewed(req, res, next));
router.get("/notifications", ...storefrontCustomerAuthRequired, async (req, res, next) => listNotifications(req, res, next));
router.get("/shipping/providers", listShippingProviders);
router.post("/shipping/orders/:orderId/create-shipment", protect, permit("orders", "edit"), createShipment);

export default router;

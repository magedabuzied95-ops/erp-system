import express from "express";
import jwt from "jsonwebtoken";
import { buildAiSupportTrustedContext, detectAiSupportIntent } from "../services/aiSupportContextService.js";
import {
  clearAiSupportTestHistory,
  listAiSupportHistory,
  logAiSupportMessage,
} from "../services/aiSupportLogService.js";
import { getWebsiteSettings, updateWebsiteSettings } from "../services/liveActivityService.js";
import { generateSupportAnswer } from "../services/openaiSupportService.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const RATE_LIMIT_WINDOW_MS = positiveNumber(process.env.AI_SUPPORT_RATE_LIMIT_WINDOW_MS, 60_000);
const RATE_LIMIT_MAX = positiveNumber(process.env.AI_SUPPORT_RATE_LIMIT_MAX, 20);
const rateLimitBuckets = new Map();

const toText = (value, fallback = "") => String(value ?? fallback).trim();
const isDevelopment = process.env.NODE_ENV !== "production";

const normalizeRole = (value = "") => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

const isAdminUser = (user = {}) => {
  const role = normalizeRole(user.role_name || user.role);
  return ["admin", "super admin", "superadmin"].includes(role) || user.is_super_admin === true || user.permissions?.includes?.("*");
};

const resolveTenantId = (req) => {
  const rawTenant =
    req.headers?.["x-tenant-id"] ??
    req.body?.tenant_id ??
    req.body?.tenantId ??
    req.query?.tenant_id ??
    req.query?.tenantId ??
    req.optionalUser?.tenant_id ??
    req.optionalUser?.tenantId ??
    req.optionalUser?.tenant?.id ??
    req.optionalUser?.company_id;
  const tenantId = Number(rawTenant);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const getClientIp = (req) => {
  const forwarded = toText(req.headers?.["x-forwarded-for"]);
  return forwarded ? forwarded.split(",")[0].trim() : req.ip || req.socket?.remoteAddress || "unknown";
};

const rateLimitKey = (req) => {
  const tenantId = req.aiSupportTenantId;
  const sessionId = toText(req.body?.metadata?.session_id || req.body?.session_id || req.headers?.["x-session-id"]);
  return `${tenantId}:${getClientIp(req)}:${sessionId || "anonymous"}`;
};

const attachOptionalUser = (req, _res, next) => {
  const raw = toText(req.headers?.authorization);
  const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
  if (!token) return next();
  try {
    req.optionalUser = jwt.verify(token, process.env.JWT_SECRET || "SECRET_KEY");
  } catch {
    req.optionalUser = null;
  }
  next();
};

const resolveAuthenticatedTenantId = (req) => {
  const rawTenant =
    req.user?.tenant_id ??
    req.user?.tenantId ??
    req.headers?.["x-tenant-id"] ??
    req.query?.tenant_id ??
    req.query?.tenantId;
  const tenantId = Number(rawTenant);
  return Number.isFinite(tenantId) && tenantId > 0 ? tenantId : null;
};

const requireAiSupportAdmin = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
  next();
};

const logSupportExchange = async ({ req, tenantId, metadata, message, context, response }) => {
  try {
    await logAiSupportMessage({
      tenantId,
      userId: req.user?.id || req.optionalUser?.id || req.optionalUser?.user_id || null,
      sessionId: metadata.session_id || req.id,
      customerMessage: message,
      response,
      detectedIntent: context.intent?.type || "",
      fallbackReason: context.fallbackReason || "",
      source: req.user || req.optionalUser ? "admin_console" : "api",
    });
  } catch (error) {
    console.warn("[ai-support] log skipped", {
      requestId: req.id,
      message: error?.message,
    });
  }
};

const aiSupportRateLimit = (req, res, next) => {
  const now = Date.now();
  const key = rateLimitKey(req);
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      success: false,
      message: "Too many AI support requests. Please try again shortly.",
    });
  }

  next();
};

const cleanupExpiredRateLimitBuckets = () => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
};

const AI_KB_KEY = "ai_support_knowledge_base";
const AI_KB_DEFAULTS = Object.freeze({
  store_name: "",
  phone: "",
  whatsapp: "",
  branch_working_hours: "",
  payment_methods: "",
  shipping_policy: "",
  return_exchange_policy: "",
  delivery_notes: "",
  warranty_notes: "",
  human_support_message: "",
  brand_tone_instructions: "",
});

const normalizePhone = (value = "") => toText(value).replace(/[\s().-]/g, "");

const validateOptionalPhone = (value = "", label = "Phone") => {
  const text = normalizePhone(value);
  if (!text) return "";
  if (!/^\+?[0-9]{7,15}$/.test(text)) {
    const error = new Error(`${label} must be 7-15 digits and may start with +`);
    error.status = 400;
    throw error;
  }
  return text;
};

const normalizeKnowledgeBase = (payload = {}) => ({
  store_name: toText(payload.store_name).slice(0, 160),
  phone: validateOptionalPhone(payload.phone, "Public phone"),
  whatsapp: validateOptionalPhone(payload.whatsapp, "WhatsApp number"),
  branch_working_hours: toText(payload.branch_working_hours).slice(0, 4000),
  working_hours: toText(payload.branch_working_hours || payload.working_hours).slice(0, 4000),
  payment_methods: toText(payload.payment_methods).slice(0, 4000),
  shipping_policy: toText(payload.shipping_policy).slice(0, 6000),
  return_exchange_policy: toText(payload.return_exchange_policy).slice(0, 6000),
  delivery_notes: toText(payload.delivery_notes).slice(0, 4000),
  warranty_notes: toText(payload.warranty_notes).slice(0, 4000),
  human_support_message: toText(payload.human_support_message).slice(0, 2000),
  brand_tone_instructions: toText(payload.brand_tone_instructions).slice(0, 3000),
});

const publicKnowledgeBase = (settings = {}) => ({
  ...AI_KB_DEFAULTS,
  ...(settings?.[AI_KB_KEY] && typeof settings[AI_KB_KEY] === "object" ? settings[AI_KB_KEY] : {}),
});

router.get("/knowledge-base", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const settings = await getWebsiteSettings({ tenantId });
    return res.json({ success: true, knowledge_base: publicKnowledgeBase(settings) });
  } catch (error) {
    console.error("[ai-support] knowledge base load error", { requestId: req.id, message: error?.message });
    return res.status(500).json({ success: false, message: "Failed to load AI support knowledge base" });
  }
});

router.put("/knowledge-base", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const normalized = normalizeKnowledgeBase(req.body?.knowledge_base || req.body || {});
    const settings = await updateWebsiteSettings({ tenantId, settings: { [AI_KB_KEY]: normalized } });
    return res.json({ success: true, knowledge_base: publicKnowledgeBase(settings) });
  } catch (error) {
    const status = error?.status || 500;
    console.error("[ai-support] knowledge base save error", { requestId: req.id, status, message: error?.message });
    return res.status(status).json({ success: false, message: error?.message || "Failed to save AI support knowledge base" });
  }
});

router.delete("/knowledge-base", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({ success: false, message: "Tenant context is required" });
    }
    const settings = await updateWebsiteSettings({ tenantId, settings: { [AI_KB_KEY]: { ...AI_KB_DEFAULTS } } });
    return res.json({ success: true, knowledge_base: publicKnowledgeBase(settings) });
  } catch (error) {
    console.error("[ai-support] knowledge base reset error", { requestId: req.id, message: error?.message });
    return res.status(500).json({ success: false, message: "Failed to reset AI support knowledge base" });
  }
});

router.post("/chat", attachOptionalUser, (req, res, next) => {
  console.log("[ai-support] tenant debug", {
    requestId: req.id,
    received_tenant_id: req.body?.tenant_id ?? req.body?.tenantId ?? null,
    received_x_tenant_id: req.headers?.["x-tenant-id"] ?? null,
  });
  const tenantId = resolveTenantId(req);
  const earlyIntent = detectAiSupportIntent(req.body?.message);
  if (!tenantId && earlyIntent.type !== "conversational") {
    return res.status(400).json({
      success: false,
      message: "A valid tenant id is required for AI support.",
    });
  }
  req.aiSupportTenantId = tenantId;
  next();
}, aiSupportRateLimit, async (req, res) => {
  try {
    const message = toText(req.body?.message);
    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Customer message is required.",
      });
    }

    const tenantId = req.aiSupportTenantId;
    const metadata = {
      ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
      session_id: req.body?.metadata?.session_id || req.body?.session_id || null,
      customer_id: req.body?.metadata?.customer_id || null,
      customer_phone: req.body?.metadata?.customer_phone || null,
      locale: req.body?.metadata?.locale || req.headers?.["accept-language"] || null,
      tenant_id: tenantId,
    };

    const context = await buildAiSupportTrustedContext({
      tenantId,
      message,
    });

    if (isDevelopment) {
      console.log("[ai-support] context", {
        requestId: req.id,
        tenantId,
        detectedIntent: context.intent?.type || "unknown",
        contextSourceCount: context.trustedContext?.sources?.length || 0,
        fallbackReason: context.fallbackReason || "",
      });
    }

    if (context.directResponse) {
      const responsePayload = {
        ...context.directResponse,
        detected_intent: context.intent?.type || "",
        context_source_count: context.trustedContext?.sources?.length || 0,
        source_previews: context.source_previews || [],
        fallback_reason: context.fallbackReason || "",
      };
      await logSupportExchange({ req, tenantId, metadata, message, context, response: responsePayload });
      return res.json({
        success: true,
        ...responsePayload,
      });
    }

    if (!context.trustedContext?.sources?.length) {
      const responsePayload = {
        answer: "I do not have enough verified information to answer that. Please contact support so a team member can help you.",
        confidence: 0,
        needs_human_support: true,
        sources_used: [],
        suggested_products: context.suggested_products || [],
        suggested_actions: context.suggested_actions || ["contact_support"],
        detected_intent: context.intent?.type || "",
        context_source_count: 0,
        source_previews: context.source_previews || [],
        fallback_reason: context.fallbackReason || "no_trusted_context",
      };
      await logSupportExchange({ req, tenantId, metadata, message, context, response: responsePayload });
      return res.json({
        success: true,
        ...responsePayload,
      });
    }

    const result = await generateSupportAnswer({
      message,
      trustedContext: context.trustedContext,
      metadata,
      suggestedProducts: context.suggested_products,
      suggestedActions: context.suggested_actions,
    });

    const responsePayload = {
      ...result,
      detected_intent: context.intent?.type || "",
      context_source_count: context.trustedContext?.sources?.length || 0,
      source_previews: context.source_previews || [],
      fallback_reason: context.fallbackReason || "",
    };
    await logSupportExchange({ req, tenantId, metadata, message, context, response: responsePayload });

    return res.json({
      success: true,
      ...responsePayload,
    });
  } catch (error) {
    const tenantId = req.aiSupportTenantId || resolveTenantId(req);
    const message = toText(req.body?.message);
    const metadata = {
      ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}),
      session_id: req.body?.metadata?.session_id || req.body?.session_id || req.id,
      tenant_id: tenantId,
    };
    const responsePayload = {
      answer: "AI support is temporarily unavailable. Please contact support so a team member can help you.",
      confidence: 0,
      needs_human_support: true,
      sources_used: [],
      suggested_products: [],
      suggested_actions: ["contact_support"],
      detected_intent: "route_error",
      context_source_count: 0,
      fallback_reason: "route_error",
    };
    await logSupportExchange({
      req,
      tenantId,
      metadata,
      message,
      context: { intent: { type: "route_error" }, fallbackReason: "route_error" },
      response: responsePayload,
    });
    console.error("[ai-support] route error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      ...responsePayload,
    });
  }
});

router.get("/history", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant context is required",
      });
    }

    const history = await listAiSupportHistory({
      tenantId,
      needsHumanSupport: req.query?.needs_human_support ?? "",
      lowConfidence: ["1", "true", "yes"].includes(String(req.query?.low_confidence || "").toLowerCase()),
      limit: req.query?.limit,
    });

    return res.json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("[ai-support] history error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to load AI support history",
    });
  }
});

router.delete("/history/test", protect, requireAiSupportAdmin, async (req, res) => {
  try {
    const tenantId = resolveAuthenticatedTenantId(req);
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant context is required",
      });
    }

    const result = await clearAiSupportTestHistory({ tenantId });
    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("[ai-support] clear history error", {
      requestId: req.id,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to clear AI support history",
    });
  }
});

setInterval(cleanupExpiredRateLimitBuckets, RATE_LIMIT_WINDOW_MS).unref?.();

export default router;

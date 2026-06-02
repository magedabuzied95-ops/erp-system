import crypto from "crypto";

import db from "../database/db.js";
import { buildWhatsappTextDebug } from "../utils/whatsapp.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import {
  AI_AGENT_CHANNELS,
  logChannelEvent,
  upsertChannelConversationMapping,
} from "./aiChannelAdapterService.js";
import { generateWhatsappAiAutoReply, logWhatsappAiOutbound } from "./aiInboxService.js";
import { appendAiGeneratedSupportReply } from "./aiSupportLogService.js";
import { addTraceStep, failTrace, finishTrace, setTraceInboundMessage, startTrace } from "./aiReplyTraceService.js";
import { emitToRooms } from "../utils/socket.js";

const provider = () => String(process.env.WHATSAPP_GATEWAY_PROVIDER || "evolution").trim().toLowerCase();
const apiUrl = () => String(process.env.EVOLUTION_API_URL || "").trim().replace(/\/+$/g, "");
const apiKey = () => String(process.env.EVOLUTION_API_KEY || "").trim();
const instanceName = () => String(process.env.WHATSAPP_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_NAME || process.env.instanceName || "m1-store").trim();
const webhookSecret = () => String(process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();
const sentImageDuplicateCache = new Map();

const text = (value, fallback = "") => String(value ?? fallback).trim();
const money = (value) => {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
};

const config = () => ({
  provider: provider(),
  apiUrl: apiUrl(),
  apiKeyConfigured: Boolean(apiKey()),
  instanceName: instanceName(),
  webhookSecretConfigured: Boolean(webhookSecret()),
});

const gatewayError = (message, code = "WHATSAPP_GATEWAY_ERROR", status = 500, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

const normalizeDuplicateImageUrl = (value = "") => {
  const normalized = resolvePublicImageUrl(value);
  return text(normalized).toLowerCase().replace(/[?#].*$/, "");
};

const duplicateCacheKeyForImage = ({ phone = "", imageUrl = "" } = {}) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  const normalizedUrl = normalizeDuplicateImageUrl(imageUrl);
  if (!normalizedPhone || !normalizedUrl) return "";
  return `${normalizedPhone}|${normalizedUrl}`;
};

const getSentImageDuplicateEntry = ({ phone = "", imageUrl = "" } = {}) => {
  const duplicate_cache_key = duplicateCacheKeyForImage({ phone, imageUrl });
  return {
    duplicate_cache_key,
    entry: duplicate_cache_key ? sentImageDuplicateCache.get(duplicate_cache_key) || null : null,
  };
};

const markSentImageDuplicateEntry = ({ phone = "", imageUrl = "", status = "success", timestamp = new Date().toISOString() } = {}) => {
  const duplicate_cache_key = duplicateCacheKeyForImage({ phone, imageUrl });
  if (!duplicate_cache_key) return "";
  sentImageDuplicateCache.set(duplicate_cache_key, {
    status: text(status || "success"),
    timestamp: text(timestamp || new Date().toISOString()),
  });
  return duplicate_cache_key;
};

const clearSentImageDuplicateEntry = ({ phone = "", imageUrl = "" } = {}) => {
  const duplicate_cache_key = duplicateCacheKeyForImage({ phone, imageUrl });
  if (!duplicate_cache_key) return "";
  sentImageDuplicateCache.delete(duplicate_cache_key);
  return duplicate_cache_key;
};

const requireEvolutionConfig = () => {
  const current = config();
  if (current.provider !== "evolution") throw gatewayError("Unsupported WhatsApp gateway provider", "WHATSAPP_PROVIDER_UNSUPPORTED", 409);
  if (!current.apiUrl) throw gatewayError("EVOLUTION_API_URL is not configured", "EVOLUTION_API_URL_MISSING", 409);
  if (!apiKey()) throw gatewayError("EVOLUTION_API_KEY is not configured", "EVOLUTION_API_KEY_MISSING", 409);
  if (!current.instanceName) throw gatewayError("EVOLUTION_INSTANCE_NAME or WHATSAPP_INSTANCE_NAME is not configured", "EVOLUTION_INSTANCE_MISSING", 409);
  return current;
};

const evolutionFetch = async (path, options = {}) => {
  const current = requireEvolutionConfig();
  const url = `${current.apiUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: apiKey(),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = { raw };
  }
  if (!response.ok) {
    throw gatewayError(data?.message || data?.error || `Evolution API returned ${response.status}`, "EVOLUTION_API_ERROR", response.status, { data });
  }
  return data;
};

export const normalizeEgyptPhone = (phone = "") => {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("20") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `20${digits.slice(1)}`;
  if (digits.startsWith("1") && digits.length === 10) return `20${digits}`;
  return digits;
};

export const getStatus = async () => {
  const current = config();
  if (current.provider !== "evolution" || !current.apiUrl || !current.apiKeyConfigured || !current.instanceName) {
    console.info("[whatsapp:status]", { ...current, connected: false, configured: false });
    return { ...current, configured: false, connected: false, state: "not_configured" };
  }
  const data = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(current.instanceName)}`, { method: "GET" });
  const state = text(data?.instance?.state || data?.state || data?.status || data?.connectionState || "");
  const connected = ["open", "connected", "online"].includes(state.toLowerCase());
  console.info("[whatsapp:status]", { provider: current.provider, instanceName: current.instanceName, connected, state });
  return { ...current, configured: true, connected, state: state || "unknown", raw: data };
};

export const sendTextMessage = async ({ phone, message } = {}) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  const body = String(message ?? "");
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!body.trim()) throw gatewayError("Message body is required", "WHATSAPP_MESSAGE_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const requestBody = JSON.stringify({ number: normalizedPhone, text: body });
  const messageDebug = buildWhatsappTextDebug(body, 300);
  const jsonDebug = buildWhatsappTextDebug(requestBody, 500);
  console.info("[whatsapp:evolution-payload-preview]", {
    instanceName: current.instanceName,
    phoneSuffix: normalizedPhone.slice(-4),
    hasEmojis: messageDebug.hasEmojis,
    codePoints: messageDebug.codePoints,
    textFirst300Chars: messageDebug.firstChars,
    jsonHasEmojis: jsonDebug.hasEmojis,
    jsonBodyFirst500Chars: jsonDebug.firstChars,
  });
  if (messageDebug.hasEmojis && !jsonDebug.hasEmojis) {
    console.warn("[whatsapp:evolution-payload-emoji-serialization-warning]", {
      instanceName: current.instanceName,
      phoneSuffix: normalizedPhone.slice(-4),
    });
  }
  const data = await evolutionFetch(`/message/sendText/${encodeURIComponent(current.instanceName)}`, {
    method: "POST",
    body: requestBody,
  });
  return { success: true, provider: current.provider, instanceName: current.instanceName, phone: normalizedPhone, result: data };
};

export const sendImageMessage = async ({ phone, imageUrl, caption = "" } = {}) => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  const media = resolvePublicImageUrl(imageUrl);
  const safeCaption = text(caption).slice(0, 500);
  const mimetype = imageMimeType(media) || "image/jpeg";
  if (!normalizedPhone) throw gatewayError("A valid WhatsApp phone number is required", "WHATSAPP_PHONE_REQUIRED", 400);
  if (!isPublicImageUrl(media)) throw gatewayError("A valid public image URL is required", "WHATSAPP_IMAGE_URL_REQUIRED", 400);
  const current = requireEvolutionConfig();
  const endpoint = `/message/sendMedia/${encodeURIComponent(current.instanceName)}`;
  const payload = {
    number: normalizedPhone,
    mediatype: "image",
    mimetype,
    media,
    caption: safeCaption,
  };
  const requestBody = JSON.stringify(payload);
  const captionDebug = buildWhatsappTextDebug(safeCaption, 220);
  console.info("[whatsapp:evolution-image-send-start]", {
    instanceName: current.instanceName,
    phoneSuffix: normalizedPhone.slice(-4),
    imageUrl: media,
    captionLength: safeCaption.length,
  });
  console.info("[whatsapp:evolution-image-payload-preview]", {
    instanceName: current.instanceName,
    phoneSuffix: normalizedPhone.slice(-4),
    imageUrl: media,
    captionFirst220Chars: captionDebug.firstChars,
    captionHasEmojis: captionDebug.hasEmojis,
  });
  const payloadLogBase = {
    endpoint,
    instance: current.instanceName,
    number: normalizedPhone,
    request_payload: payload,
    payload_shape: {
      keys: Object.keys(payload),
      number: "string",
      mediatype: "string",
      mimetype: "string",
      media: "string",
      caption: "string",
    },
    mediatype: payload.mediatype,
    mimetype: payload.mimetype,
    media: payload.media,
    caption: payload.caption,
    image_url_length: media.length,
    caption_length: safeCaption.length,
  };
  let response = null;
  let raw = "";
  let data = null;
  try {
    response = await fetch(`${current.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        apikey: apiKey(),
        "Content-Type": "application/json",
      },
      body: requestBody,
    });
    raw = await response.text();
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }
    console.info("[whatsapp-image-send-payload]", {
      ...payloadLogBase,
      response_status: response.status,
      response_body: data,
      response_raw: raw,
    });
    if (!response.ok) {
      throw gatewayError(data?.message || data?.error || `Evolution API returned ${response.status}`, "EVOLUTION_API_ERROR", response.status, {
        data,
        responseBody: data,
        responseRaw: raw,
      });
    }
    console.info("[whatsapp:evolution-image-sent]", {
      instanceName: current.instanceName,
      phoneSuffix: normalizedPhone.slice(-4),
      imageUrl: media,
    });
    return { success: true, provider: current.provider, instanceName: current.instanceName, phone: normalizedPhone, imageUrl: media, result: data };
  } catch (error) {
    console.error("[whatsapp:evolution-image-error]", {
      instanceName: current.instanceName,
      phoneSuffix: normalizedPhone.slice(-4),
      imageUrl: media,
      message: error?.message || String(error),
      code: error?.code || "",
      status: error?.status || "",
      response_body: error?.data || error?.responseBody || null,
      response_raw: error?.responseRaw || "",
    });
    if (!response) {
      console.error("[whatsapp-image-send-payload]", {
        ...payloadLogBase,
        response_status: error?.status || "",
        response_body: error?.data || null,
        response_raw: error?.responseRaw || "",
      });
    }
    throw error;
  }
};

export const buildOrderConfirmationMessage = (order = {}) => {
  const customerName = text(order.customer_name || order.customerName || order.name, "عميلنا");
  const orderNumber = text(order.public_order_number || order.display_order_number || order.invoice_number || order.order_number || order.id, "-");
  const totalAmount = money(order.total_amount ?? order.grand_total ?? order.total ?? order.net_total);
  return `أهلاً يا ${customerName} 
طلبك من M1 Store جاهز للتأكيد.

رقم الطلب: ${orderNumber}
الإجمالي: ${totalAmount} جنيه

للتاكيد رد بـ 1
للإلغاء رد بـ 2`;
};

export const sendOrderConfirmationMessage = async ({ order } = {}) => {
  if (!order) throw gatewayError("Order is required", "WHATSAPP_ORDER_REQUIRED", 400);
  const phone = order.customer_phone || order.phone || order.whatsapp || order.mobile;
  const message = buildOrderConfirmationMessage(order);
  return sendTextMessage({ phone, message });
};

export const loadOrderForWhatsapp = async ({ orderId, tenantId = null } = {}) => {
  const id = Number(orderId);
  if (!Number.isFinite(id) || id <= 0) throw gatewayError("Invalid order id", "WHATSAPP_ORDER_ID_INVALID", 400);
  const columnsResult = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders'`
  );
  const columns = new Set(columnsResult.rows.map((row) => row.column_name));
  const col = (name, fallback = "NULL") => columns.has(name) ? `o.${name}` : `${fallback} AS ${name}`;
  const clauses = ["o.id = $1"];
  const params = [id];
  if (tenantId && columns.has("tenant_id")) {
    params.push(tenantId);
    clauses.push(`(o.tenant_id = $${params.length} OR o.tenant_id IS NULL)`);
  }
  const result = await db.query(
    `SELECT
       o.id,
       ${col("tenant_id")},
       ${col("invoice_number")},
       ${col("public_order_number")},
       ${col("display_order_number")},
       ${col("order_number")},
       ${col("customer_name", "''")},
       ${col("customer_phone", "''")},
       ${col("total_amount", "0")},
       ${col("grand_total", "0")},
       ${col("total", "0")},
       ${col("created_at", "NULL")}
     FROM orders o
     WHERE ${clauses.join(" AND ")}
     LIMIT 1`,
    params
  );
  const order = result.rows[0] || null;
  if (!order) throw gatewayError("Order not found", "WHATSAPP_ORDER_NOT_FOUND", 404);
  return order;
};

const headerValue = (req, names = []) => {
  for (const name of names) {
    const value = req.get?.(name) || req.headers?.[String(name).toLowerCase()];
    if (value) return String(value);
  }
  return "";
};

export const verifyWebhookSecret = (req) => {
  const secret = webhookSecret();
  if (!secret) return true;
  const provided =
    headerValue(req, ["x-whatsapp-webhook-secret", "x-webhook-secret", "x-evolution-secret"]) ||
    text(req.query?.secret || req.body?.secret);
  return provided === secret;
};

const findFirstString = (value, keys = []) => {
  if (!value || typeof value !== "object") return "";
  for (const key of keys) {
    const found = value[key];
    if (typeof found === "string" || typeof found === "number") return text(found);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      const found = findFirstString(child, keys);
      if (found) return found;
    }
  }
  return "";
};

const errorSummary = (error = {}) => ({
  message: error?.message || String(error),
  causeMessage: error?.cause?.message || "",
  code: error?.code || "",
  status: error?.status || "",
  data: error?.data || error?.responseBody || error?.metaResponse || null,
  responseRaw: error?.responseRaw || "",
});

const asArray = (value) => (Array.isArray(value) ? value : []);

const trimSlashes = (value = "") => text(value).replace(/^\/+|\/+$/g, "");

const publicBaseUrl = () => {
  const candidates = [
    process.env.PUBLIC_BACKEND_URL,
    process.env.BACKEND_PUBLIC_URL,
    process.env.PUBLIC_APP_URL,
    process.env.STORE_FRONT_URL,
    process.env.API_PUBLIC_URL,
    process.env.VITE_API_BASE_URL,
  ];
  for (const candidate of candidates) {
    const safe = text(candidate).replace(/\/+$/g, "");
    if (/^https?:\/\//i.test(safe) && !/localhost|127\.0\.0\.1/i.test(safe)) return safe;
  }
  return "";
};

export const isPublicImageUrl = (url = "") => {
  const safe = text(url);
  if (!safe) return false;
  if (/^file:\/\//i.test(safe)) return false;
  if (/^[a-z]:[\\/]/i.test(safe) || /^\\\\/.test(safe)) return false;
  if (!/^https?:\/\//i.test(safe)) return false;
  if (/localhost|127\.0\.0\.1/i.test(safe)) return false;
  return true;
};

const imageMimeType = (url = "") => {
  const clean = text(url).split(/[?#]/)[0].toLowerCase();
  if (clean.endsWith(".png")) return "image/png";
  if (clean.endsWith(".webp")) return "image/webp";
  if (clean.endsWith(".gif")) return "image/gif";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg";
  return "";
};

const resolvePublicImageUrl = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) {
    if (/^http:\/\//i.test(raw)) {
      const https = raw.replace(/^http:\/\//i, "https://");
      return isPublicImageUrl(https) ? https : raw;
    }
    return raw;
  }
  if (/^file:\/\//i.test(raw) || /^[a-z]:[\\/]/i.test(raw) || /^\\\\/.test(raw)) return raw;
  const base = publicBaseUrl();
  if (!base) return raw;
  const path = trimSlashes(raw);
  if (!path) return "";
  return `${base}/${path}`;
};

const isCloudinaryUrl = (value = "") => /cloudinary\.com/i.test(text(value));

const buildImageCandidate = (value, source) => {
  const raw = imageCandidateValue(value);
  if (!raw) return null;
  const resolved = resolvePublicImageUrl(raw);
  return {
    source,
    raw,
    resolved,
    is_cloudinary: isCloudinaryUrl(raw) || isCloudinaryUrl(resolved),
    is_tunnel: /trycloudflare\.com/i.test(raw) || /trycloudflare\.com/i.test(resolved),
    is_public: isPublicImageUrl(resolved),
    is_absolute_public: /^https?:\/\//i.test(resolved) && isPublicImageUrl(resolved),
    is_local_upload: Boolean(raw && !/^https?:\/\//i.test(raw) && !/^file:\/\//i.test(raw) && !/^[a-z]:[\\/]/i.test(raw) && !/^\\\\/.test(raw)),
  };
};

const selectPreferredImage = (product = {}) => {
  const prioritizedCandidates = [
    buildImageCandidate(product.cloudinary_url, "cloudinary_url"),
    buildImageCandidate(product.secure_url, "secure_url"),
    buildImageCandidate(product.cloudinary?.secure_url, "cloudinary.secure_url"),
    buildImageCandidate(asArray(product.images)[0]?.secure_url, "images[0].secure_url"),
    buildImageCandidate(product.product?.cloudinary_url, "product.cloudinary_url"),
    buildImageCandidate(product.product?.secure_url, "product.secure_url"),
    buildImageCandidate(asArray(product.product?.images)[0]?.secure_url, "product.images[0].secure_url"),
    buildImageCandidate(asArray(product.product?.product_images)[0]?.secure_url, "product.product_images[0].secure_url"),
    buildImageCandidate(asArray(product.media)[0]?.secure_url, "media[0].secure_url"),
  ].filter(Boolean);
  const publicCdnCandidates = [
    buildImageCandidate(product.image_url, "image_url"),
    buildImageCandidate(product.imageUrl, "imageUrl"),
    buildImageCandidate(product.image, "image"),
    buildImageCandidate(product.main_image, "main_image"),
    buildImageCandidate(product.mainImage, "mainImage"),
    buildImageCandidate(product.variant_image, "variant_image"),
    buildImageCandidate(product.variant_image_url, "variant_image_url"),
    buildImageCandidate(product.color_image, "color_image"),
    buildImageCandidate(product.color_image_url, "color_image_url"),
    buildImageCandidate(product.product_image_url, "product_image_url"),
    buildImageCandidate(product.matched_variant_image, "matched_variant_image"),
    buildImageCandidate(product.matched_image_url, "matched_image_url"),
    buildImageCandidate(product.matched_visual_candidate?.image_url, "matched_visual_candidate.image_url"),
    buildImageCandidate(product.matched_visual_candidate?.secure_url, "matched_visual_candidate.secure_url"),
    buildImageCandidate(product.product?.image_url, "product.image_url"),
    buildImageCandidate(product.product?.main_image, "product.main_image"),
    buildImageCandidate(product.product?.image, "product.image"),
    buildImageCandidate(product.variant?.image_url, "variant.image_url"),
    buildImageCandidate(product.variant?.main_image, "variant.main_image"),
    buildImageCandidate(product.variant?.variant_image, "variant.variant_image"),
    buildImageCandidate(product.variant?.variant_image_url, "variant.variant_image_url"),
    buildImageCandidate(product.variant?.color_image, "variant.color_image"),
    buildImageCandidate(product.variant?.color_image_url, "variant.color_image_url"),
    buildImageCandidate(product.color?.image_url, "color.image_url"),
    buildImageCandidate(product.color?.main_image, "color.main_image"),
    buildImageCandidate(product.color?.color_image, "color.color_image"),
    buildImageCandidate(product.color?.color_image_url, "color.color_image_url"),
    buildImageCandidate(asArray(product.images)[0], "images[0]"),
    buildImageCandidate(asArray(product.images)[0]?.url, "images[0].url"),
    buildImageCandidate(asArray(product.media)[0], "media[0]"),
    buildImageCandidate(asArray(product.media)[0]?.url, "media[0].url"),
    buildImageCandidate(asArray(product.product_images)[0]?.image_url, "product_images[0].image_url"),
    buildImageCandidate(asArray(product.product_images)[0]?.url, "product_images[0].url"),
    buildImageCandidate(asArray(product.product?.images)[0], "product.images[0]"),
    buildImageCandidate(asArray(product.product?.product_images)[0], "product.product_images[0]"),
    buildImageCandidate(asArray(product.variant?.images)[0], "variant.images[0]"),
    buildImageCandidate(asArray(product.variant?.media)[0], "variant.media[0]"),
    buildImageCandidate(asArray(product.color?.images)[0], "color.images[0]"),
    buildImageCandidate(asArray(product.variants)[0]?.image_url, "variants[0].image_url"),
    buildImageCandidate(asArray(product.variants)[0]?.variant_image_url, "variants[0].variant_image_url"),
    buildImageCandidate(asArray(product.variants)[0]?.color_image_url, "variants[0].color_image_url"),
  ].filter(Boolean);
  const candidates = [...prioritizedCandidates, ...publicCdnCandidates];
  const selected =
    prioritizedCandidates.find((candidate) => candidate.is_cloudinary && candidate.is_public) ||
    publicCdnCandidates.find((candidate) => candidate.is_absolute_public) ||
    publicCdnCandidates.find((candidate) => candidate.is_local_upload && candidate.is_public) ||
    candidates.find((candidate) => candidate.is_public) ||
    null;
  const fallback_used = Boolean(selected && !selected.is_cloudinary);
  if (selected) {
    console.info("[image-url-selection]", {
      selected_url: selected.resolved,
      source: selected.source,
      is_cloudinary: selected.is_cloudinary,
      is_tunnel: selected.is_tunnel,
      fallback_used,
    });
    if (selected.is_tunnel) {
      console.warn("[image-url-warning]", {
        reason: "tunnel_url_used",
        selected_url: selected.resolved,
        source: selected.source,
      });
    }
  }
  return {
    selected_url: selected?.resolved || "",
    raw_url: selected?.raw || "",
    source: selected?.source || "",
    is_cloudinary: selected?.is_cloudinary === true,
    fallback_used,
  };
};

const imageCandidateValue = (value) => {
  if (Array.isArray(value)) return imageCandidateValue(value[0]);
  if (value && typeof value === "object") {
    return text(
      value.cloudinary_url ||
        value.secure_url ||
        value.image_url ||
        value.main_image ||
        value.variant_image ||
        value.variant_image_url ||
        value.color_image ||
        value.color_image_url ||
        value.url ||
        value.path ||
        value.src ||
        value.image
    );
  }
  return text(value);
};

const productImageCandidates = (product = {}) => {
  const selected = selectPreferredImage(product);
  return [selected.raw_url || selected.selected_url].filter(Boolean);
};

const productCardImageUrl = (product = {}) =>
  text(selectPreferredImage(product).selected_url || "");

const productCardImagesCount = (product = {}) =>
  [
    product.images,
    product.media,
    product.product_images,
    product.product?.images,
    product.product?.product_images,
    product.variant?.images,
    product.variant?.media,
    product.color?.images,
    product.variants,
  ].reduce((total, value) => total + asArray(value).length, 0);

const productCardName = (product = {}) =>
  text(product.name || product.title || product.product_name || product.base_name || "Product").slice(0, 120);

const productCardPrice = (product = {}) => {
  const parsed = Number(product.final_price || product.sale_price || product.price || product.regular_price || product.product_price || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed).toLocaleString("en-US") : "";
};

const productCardSizes = (product = {}) =>
  [
    ...asArray(product.available_sizes),
    ...asArray(product.sizes),
    ...asArray(product.inventory_profile?.available_sizes),
    ...asArray(product.variants).map((variant) => variant?.size),
    product.size,
    product.requested_size,
  ]
    .flatMap((value) => text(value).split(","))
    .map(text)
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index)
    .slice(0, 8);

const productCardUrl = (product = {}) => text(product.product_url || product.url || product.productUrl);

const productImageCaption = (product = {}) =>
  [
    productCardName(product),
    productCardPrice(product) ? `السعر: ${productCardPrice(product)} جنيه` : "",
    productCardSizes(product).length ? `المقاسات: ${productCardSizes(product).join("، ")}` : "",
    productCardUrl(product),
  ].filter(Boolean).join("\n").slice(0, 1024);

const productImageUrlFallbackMessage = ({ imageUrl = "", productUrl = "" } = {}) =>
  [
    "دي صورة المنتج يا فندم:",
    text(imageUrl),
    text(productUrl),
  ].filter(Boolean).join("\n");

const productImageDebugCard = (item = {}) => {
  const product = item.product || item;
  const rawImageUrl = item.raw_image_url || text(productImageCandidates(product).find((candidate) => text(candidate)) || "");
  const resolvedImageUrl = item.resolved_image_url || resolvePublicImageUrl(rawImageUrl);
  const publicImageUrl = isPublicImageUrl(resolvedImageUrl);
  return {
    product_id: product?.product_id || product?.id || product?.product?.id || null,
    product_name: productCardName(product),
    color: text(product?.color || product?.matched_variant_color || product?.variant?.color || product?.color?.name),
    image_url: text(product?.image_url),
    image: text(product?.image),
    main_image: text(product?.main_image || product?.product?.main_image),
    variant_image: text(product?.variant_image || product?.variant?.variant_image || product?.variant?.image_url),
    color_image: text(product?.color_image || product?.color?.image_url || product?.color?.color_image),
    cloudinary_url: text(product?.cloudinary_url || product?.product?.cloudinary_url),
    images_count: productCardImagesCount(product),
    resolved_image_url: resolvedImageUrl,
    is_public_image_url: publicImageUrl,
    skip_reason: item.skip_reason || (publicImageUrl ? "" : (resolvedImageUrl ? "invalid_private_url" : "missing_image_url")),
  };
};

const collectProductImageCards = ({ generated = {} } = {}) => {
  const cards = [
    ...asArray(generated.reply?.product_cards),
    ...asArray(generated.aiPayload?.channel_reply?.product_cards),
    ...asArray(generated.aiPayload?.suggested_products),
    ...asArray(generated.aiPayload?.product_cards),
  ];
  return cards.map((product, cardIndex) => {
      const rawImageUrl = text(productImageCandidates(product).find((candidate) => text(candidate)) || "");
      const resolvedImageUrl = resolvePublicImageUrl(rawImageUrl);
      const valid = isPublicImageUrl(resolvedImageUrl);
      return {
        product,
        card_index: cardIndex,
        imageUrl: resolvedImageUrl,
        raw_image_url: rawImageUrl,
        resolved_image_url: resolvedImageUrl,
        mime_type: imageMimeType(resolvedImageUrl),
        valid,
        normalized_image_url: normalizeDuplicateImageUrl(resolvedImageUrl),
        skip_reason: valid ? "" : (resolvedImageUrl ? "invalid_private_url" : "missing_image_url"),
      };
    });
};

const shouldSendProductImages = (generated = {}) => {
  const responseType = text(
    generated.aiPayload?.response_type ||
      generated.aiPayload?.reply_generation?.response_type ||
      generated.aiPayload?.debug?.response_type ||
      generated.aiPayload?.channel_reply?.response_type ||
      generated.reply?.response_type
  ).toLowerCase();
  const intent = text(generated.aiPayload?.detected_intent || generated.aiPayload?.intent?.type || generated.aiPayload?.intent).toLowerCase();
  const hasCards = Boolean(
    generated.reply?.product_cards?.length ||
      generated.aiPayload?.channel_reply?.product_cards?.length ||
      generated.aiPayload?.suggested_products?.length ||
      generated.aiPayload?.product_cards?.length
  );
  if (!hasCards) return false;
  if (["greeting", "greeting_only", "general", "fallback", "conversational", "sales_discovery"].includes(intent)) return false;
  if (["fallback", "greeting", "discovery", "sales_discovery"].includes(responseType)) return false;
  return responseType === "product_card" || Boolean(generated.reply?.product_cards?.length || generated.aiPayload?.channel_reply?.product_cards?.length);
};

const imageFailureLogPayload = ({
  generated = {},
  product = {},
  cardIndex = 0,
  imageUrl = "",
  resolvedImageUrl = "",
  mimeType = "",
  error = null,
  reason = "",
} = {}) => {
  const summary = error ? errorSummary(error) : {};
  const safeResolved = text(resolvedImageUrl || imageUrl);
  return {
    conversation_id: generated.sessionId || "",
    session_id: generated.sessionId || "",
    product_id: product?.id || product?.product_id || null,
    product_name: productCardName(product),
    card_index: cardIndex,
    image_url: text(imageUrl),
    resolved_image_url: safeResolved,
    mime_type: mimeType || imageMimeType(safeResolved),
    http_status: summary.status || "",
    error_message: reason || summary.message || "",
    evolution_response: summary.data || null,
    has_image_url: Boolean(text(imageUrl || resolvedImageUrl)),
    is_cloudinary_url: /cloudinary\.com/i.test(safeResolved),
    is_public_http_url: isPublicImageUrl(safeResolved),
  };
};

const firstProductLink = (cards = []) =>
  asArray(cards).map((item) => productCardUrl(item.product || item)).find(Boolean) || "";

const number = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const json = (value) => JSON.stringify(value === undefined ? null : value);

const boolValue = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const normalized = text(value).toLowerCase();
  return ["true", "1", "yes"].includes(normalized);
};

const tenantIdForWhatsapp = (payload = {}) => number(payload?.tenant_id || payload?.tenantId || process.env.WHATSAPP_TENANT_ID || 1, 1);

const parseWhatsappTimestamp = (value) => {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric < 100000000000 ? numeric * 1000 : numeric;
    return new Date(millis).toISOString();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
};

const extractMessageText = (data = {}) => {
  const message = data?.message || data?.messages?.[0]?.message || {};
  return text(
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.buttonsResponseMessage?.selectedButtonId ||
    message?.listResponseMessage?.title ||
    message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    data?.text ||
    data?.body ||
    data?.messageText ||
    data?.caption ||
    findFirstString(data, ["conversation", "text", "body", "messageText", "caption"])
  );
};

const extractIncomingWhatsapp = (payload = {}) => {
  const data = payload?.data || payload?.body?.data || payload;
  const key = data?.key || payload?.key || {};
  const remoteJid = text(
    key?.remoteJid ||
    data?.remoteJid ||
    data?.remote_jid ||
    data?.from ||
    data?.sender ||
    data?.participant ||
    data?.number ||
    findFirstString(data, ["remoteJid", "remote_jid", "from", "sender", "participant", "number", "phone"]) ||
    findFirstString(payload, ["remoteJid", "remote_jid", "from", "sender", "number", "phone"])
  );
  const phone = normalizeEgyptPhone(remoteJid.split("@")[0]);
  const messageId = text(
    key?.id ||
    data?.messageId ||
    data?.message_id ||
    data?.id ||
    data?.messages?.[0]?.id ||
    findFirstString(data, ["messageId", "message_id", "message_id", "id", "mid"])
  );
  const timestamp = parseWhatsappTimestamp(
    data?.messageTimestamp ||
    data?.timestamp ||
    data?.date_time ||
    payload?.date_time ||
    payload?.timestamp
  );
  const instance = text(payload?.instance || payload?.instanceName || data?.instance || data?.instanceName || instanceName());
  const senderName = text(
    data?.pushName ||
    data?.pushname ||
    data?.profileName ||
    data?.profile_name ||
    data?.senderName ||
    data?.sender_name ||
    payload?.pushName ||
    payload?.profileName ||
    findFirstString(data, ["pushName", "pushname", "profileName", "profile_name", "senderName", "sender_name"])
  );
  return {
    event: text(payload?.event || payload?.type || data?.event || ""),
    phone,
    remoteJid,
    text: extractMessageText(data),
    senderName,
    messageId,
    timestamp,
    instance,
    fromMe: boolValue(key?.fromMe ?? data?.fromMe ?? data?.from_me ?? payload?.fromMe),
    raw: payload,
  };
};

const dedupeHash = (value = "") => crypto.createHash("sha256").update(text(value)).digest("hex");

const saveWhatsappIncomingToAiInbox = async (message = {}) => {
  const tenantId = tenantIdForWhatsapp(message.raw || {});
  const sessionId = `whatsapp:${message.phone}`;
  const customerName = text(message.senderName);
  const body = text(message.text);
  const receivedAt = message.timestamp || new Date().toISOString();
  const externalMessageId = text(message.messageId);
  const dedupeKey = dedupeHash([tenantId, sessionId, externalMessageId || message.remoteJid, receivedAt, body].join("|"));

  await ensureAiSupportLogSchema();
  await upsertChannelConversationMapping({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    externalConversationId: sessionId,
    externalCustomerId: message.phone,
    customerName,
    metadata: {
      phone: message.phone,
      remote_jid: message.remoteJid,
      instance: message.instance,
      source: "evolution_api",
      last_message: body,
      external_message_id: externalMessageId,
      dedupe_key: dedupeKey,
    },
    lastMessageAt: receivedAt,
  });

  const session = await db.query(
    `
    INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, last_message, updated_at)
    VALUES ($1, $2, 'whatsapp', 'whatsapp', $3::text, $4::text, NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = 'whatsapp',
      channel = 'whatsapp',
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
      last_message = EXCLUDED.last_message,
      updated_at = NOW()
    RETURNING id
    `,
    [tenantId, sessionId, customerName, body]
  );

  const inserted = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id, tenant_id, session_id, channel, customer_name, last_message, message_text,
      customer_message, ai_answer, confidence, needs_human_support, sources_used, suggested_products,
      visual_attachments, suggested_actions, detected_intent, fallback_reason, sender_type, external_message_id, dedupe_key
    )
    VALUES ($1, $2, $3::text, 'whatsapp', $4::text, $5::text, $5::text, $5::text, '', 0, FALSE, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '', 'ai_status:pending', 'customer', $6::text, $7::text)
    ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
    RETURNING *
    `,
    [session.rows[0]?.id || null, tenantId, sessionId, customerName, body, externalMessageId, dedupeKey]
  );

  if (!inserted.rows[0]) {
    console.info("[whatsapp:inbox-skipped]", {
      reason: "duplicate",
      tenantId,
      session_id: sessionId,
      message_id: externalMessageId,
      dedupe_key: dedupeKey,
    });
    return { saved: false, duplicate: true, session_id: sessionId, dedupe_key: dedupeKey };
  }

  await logChannelEvent({
    tenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    direction: "inbound",
    externalCustomerId: message.phone,
    conversationId: sessionId,
    messagePreview: body,
    status: "saved_to_ai_inbox",
    metadata: {
      source: "evolution_api",
      instance: message.instance,
      remote_jid: message.remoteJid,
      external_message_id: externalMessageId,
      dedupe_key: dedupeKey,
    },
  }).catch(() => {});

  emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", {
    tenant_id: tenantId,
    session_id: sessionId,
    message: inserted.rows[0] || null,
    at: new Date().toISOString(),
  });
  emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", {
    tenant_id: tenantId,
    session_id: sessionId,
    at: new Date().toISOString(),
  });

  console.info("[whatsapp:inbox-saved]", {
    tenantId,
    session_id: sessionId,
    message_id: inserted.rows[0]?.id || null,
    external_message_id: externalMessageId,
    phoneSuffix: message.phone.slice(-4),
  });
  return { saved: true, session_id: sessionId, message: inserted.rows[0] || null, dedupe_key: dedupeKey };
};

export const handleIncomingWebhook = async (payload = {}) => {
  const normalized = extractIncomingWhatsapp(payload);
  const traceTenantId = tenantIdForWhatsapp(normalized.raw || {});
  let trace = null;
  console.info("[whatsapp:inbox-received]", {
    event: normalized.event,
    instance: normalized.instance,
    remoteJid: normalized.remoteJid,
    phoneSuffix: normalized.phone ? normalized.phone.slice(-4) : "",
    senderName: normalized.senderName,
    messageId: normalized.messageId,
    timestamp: normalized.timestamp,
    fromMe: normalized.fromMe,
    textLength: normalized.text.length,
  });
  trace = await startTrace({
    tenantId: traceTenantId,
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    sessionId: normalized.phone ? `whatsapp:${normalized.phone}` : "",
    externalMessageId: normalized.messageId,
    metadata: { source: "evolution_api_webhook" },
  });
  await addTraceStep(trace, "webhook_received", {
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    instance: normalized.instance,
    remoteJid: normalized.remoteJid,
    normalized_phone: normalized.phone,
    message_text: normalized.text,
    message_id: normalized.messageId,
    fromMe: normalized.fromMe,
  });

  if (normalized.fromMe) {
    console.info("[whatsapp:inbox-skipped]", { reason: "from_me", message_id: normalized.messageId, instance: normalized.instance });
    await finishTrace(trace, { status: "skipped", reason: "from_me" });
    return { ...normalized, received_at: normalized.timestamp, trace_id: trace?.id || null, inbox: { saved: false, reason: "from_me" }, text: "" };
  }
  if (!normalized.phone) {
    console.info("[whatsapp:inbox-skipped]", { reason: "missing_phone", remoteJid: normalized.remoteJid, message_id: normalized.messageId });
    await finishTrace(trace, { status: "skipped", reason: "missing_phone" });
    return { ...normalized, received_at: normalized.timestamp, trace_id: trace?.id || null, inbox: { saved: false, reason: "missing_phone" } };
  }
  if (!normalized.text) {
    console.info("[whatsapp:inbox-skipped]", { reason: "missing_text", phoneSuffix: normalized.phone.slice(-4), message_id: normalized.messageId });
    await finishTrace(trace, { status: "skipped", reason: "missing_text" });
    return { ...normalized, received_at: normalized.timestamp, trace_id: trace?.id || null, inbox: { saved: false, reason: "missing_text" } };
  }

  try {
    const inbox = await saveWhatsappIncomingToAiInbox(normalized);
    await setTraceInboundMessage(trace, inbox?.message?.id || null);
    await addTraceStep(trace, "inbox_saved", {
      session_id: inbox?.session_id || `whatsapp:${normalized.phone}`,
      conversation_id: inbox?.session_id || `whatsapp:${normalized.phone}`,
      ai_support_message_id: inbox?.message?.id || null,
      saved: inbox?.saved === true,
      duplicate: inbox?.duplicate === true,
    });
    return {
      ...normalized,
      received_at: normalized.timestamp,
      customer_name: normalized.senderName,
      message_id: normalized.messageId,
      instanceName: normalized.instance,
      trace_id: trace?.id || null,
      inbox,
    };
  } catch (error) {
    console.error("[whatsapp:inbox-error]", {
      message: error?.message || String(error),
      code: error?.code || "",
      phoneSuffix: normalized.phone ? normalized.phone.slice(-4) : "",
      message_id: normalized.messageId,
    });
    await failTrace(trace, error, { phase: "inbox_saved", message_id: normalized.messageId });
    throw error;
  }
};

export const triggerWhatsappAiAutoReply = async (message = {}) => {
  if (!message?.text || message?.fromMe || message?.inbox?.saved === false) {
    console.info("[whatsapp:ai-skipped]", {
      reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : "inbox_not_saved",
      message_id: message?.message_id || message?.messageId || "",
    });
    await addTraceStep(message?.trace_id, "ai_mode_check", {
      shouldAutoSend: false,
      skip_reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : "inbox_not_saved",
    });
    await finishTrace(message?.trace_id, { status: "skipped", reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : "inbox_not_saved" });
    return { triggered: false, sent: false, reason: !message?.text ? "missing_text" : message?.fromMe ? "from_me" : "inbox_not_saved" };
  }
  const generated = await generateWhatsappAiAutoReply({
    tenantId: message.raw?.tenant_id || message.raw?.tenantId || process.env.WHATSAPP_TENANT_ID || 1,
    phone: message.phone,
    sessionId: message.inbox?.session_id || `whatsapp:${message.phone}`,
    customerName: message.customer_name || message.senderName || "",
    messageText: message.text,
    timestamp: message.received_at || message.timestamp,
    traceId: message.trace_id || null,
  });
  if (!generated.replyText) return generated;

  console.info("[whatsapp:ai-send-start]", {
    target: "evolution-sendText",
    tenantId: generated.tenantId,
    sessionId: generated.sessionId,
    phoneSuffix: (generated.phone || message.phone || "").slice(-4),
    replyLength: generated.replyText.length,
  });
  await addTraceStep(message.trace_id, "send_to_whatsapp", {
    target_phone_suffix: (generated.phone || message.phone || "").slice(-4),
    evolution_instance: instanceName(),
    delivery_status: "sending",
    error: "",
  });
  try {
    const isImageFollowup = ["image_request", "more_images"].includes(text(generated.aiPayload?.detected_intent));
    const allImageCards = shouldSendProductImages(generated) ? collectProductImageCards({ generated }) : [];
    console.info("[whatsapp-image-cards-input]", {
      cards_count: allImageCards.length,
      first_5_cards: allImageCards.slice(0, 5).map(productImageDebugCard),
    });
    const validImageCards = allImageCards.filter((card) => card.valid && !card.skip_reason);
    const imageCards = [];
    const skippedImageCards = allImageCards.filter((card) => !card.valid || card.skip_reason);
    for (const card of validImageCards) {
      const cacheState = getSentImageDuplicateEntry({
        phone: generated.phone || message.phone,
        imageUrl: card.resolved_image_url || card.imageUrl,
      });
      const duplicateDebugPayload = {
        image_url: card.raw_image_url || card.resolved_image_url || card.imageUrl,
        normalized_url: card.normalized_image_url || normalizeDuplicateImageUrl(card.resolved_image_url || card.imageUrl),
        duplicate_cache_key: cacheState.duplicate_cache_key,
        marked_sent_before: Boolean(cacheState.entry),
        previous_send_status: cacheState.entry?.status || "",
        previous_send_timestamp: cacheState.entry?.timestamp || "",
      };
      console.info("[duplicate-cache-state]", {
        ...duplicateDebugPayload,
        conversation_id: generated.sessionId || "",
        session_id: generated.sessionId || "",
        card_index: card.card_index,
      });
      if (cacheState.entry?.status === "success") {
        skippedImageCards.push({
          ...card,
          skip_reason: "duplicate_image_url",
          duplicate_cache_key: cacheState.duplicate_cache_key,
          previous_send_status: cacheState.entry?.status || "",
          previous_send_timestamp: cacheState.entry?.timestamp || "",
          marked_sent_before: true,
        });
        continue;
      }
      imageCards.push(card);
    }
    const sendableImageCards = imageCards.slice(0, 1);
    const imageMessages = [];
    const imageSendErrors = [];
    let result = null;
    const deferImageFollowupText = isImageFollowup && allImageCards.length > 0;
    if (!deferImageFollowupText) {
      result = await sendTextMessage({ phone: generated.phone || message.phone, message: generated.replyText });
    }
    for (const skipped of skippedImageCards) {
      if (skipped.skip_reason === "duplicate_image_url") {
        console.info("[duplicate-image-debug]", {
          image_url: skipped.raw_image_url || skipped.resolved_image_url || skipped.imageUrl,
          normalized_url: skipped.normalized_image_url || normalizeDuplicateImageUrl(skipped.resolved_image_url || skipped.imageUrl),
          duplicate_cache_key: skipped.duplicate_cache_key || "",
          marked_sent_before: skipped.marked_sent_before === true,
          previous_send_status: skipped.previous_send_status || "",
          previous_send_timestamp: skipped.previous_send_timestamp || "",
        });
      }
      const payload = imageFailureLogPayload({
        generated,
        product: skipped.product,
        cardIndex: skipped.card_index,
        imageUrl: skipped.raw_image_url,
        resolvedImageUrl: skipped.resolved_image_url,
        mimeType: skipped.mime_type,
        reason: skipped.skip_reason || "invalid_private_url",
      });
      imageSendErrors.push({
        image_url: skipped.raw_image_url,
        resolved_image_url: skipped.resolved_image_url,
        product_id: skipped.product?.id || skipped.product?.product_id || null,
        error: { message: payload.error_message, status: "", code: skipped.skip_reason || "INVALID_IMAGE_URL" },
      });
      console.error("[whatsapp-image-send-failed]", payload);
    }
    for (const { product, imageUrl, resolved_image_url, raw_image_url, card_index, mime_type, normalized_image_url } of sendableImageCards) {
      const imageSourceUrl = resolved_image_url || imageUrl;
      const productUrl = productCardUrl(product);
      const duplicateCacheKey = duplicateCacheKeyForImage({
        phone: generated.phone || message.phone,
        imageUrl: imageSourceUrl,
      });
      try {
        const imageResult = await sendImageMessage({
          phone: generated.phone || message.phone,
          imageUrl: imageSourceUrl,
          caption: productImageCaption(product),
        });
        markSentImageDuplicateEntry({
          phone: generated.phone || message.phone,
          imageUrl: imageSourceUrl,
          status: "success",
          timestamp: new Date().toISOString(),
        });
        imageMessages.push({
          image_url: imageSourceUrl,
          normalized_url: normalized_image_url || normalizeDuplicateImageUrl(imageSourceUrl),
          duplicate_cache_key: duplicateCacheKey,
          product_id: product?.id || product?.product_id || null,
          result: imageResult?.result || null,
        });
      } catch (imageError) {
        const summary = errorSummary(imageError);
        clearSentImageDuplicateEntry({
          phone: generated.phone || message.phone,
          imageUrl: imageSourceUrl,
        });
        console.error("[whatsapp-image-send-failed]", imageFailureLogPayload({
          generated,
          product,
          cardIndex: card_index,
          imageUrl: raw_image_url || imageUrl,
          resolvedImageUrl: imageSourceUrl,
          mimeType: mime_type,
          error: imageError,
        }));
        imageSendErrors.push({
          image_url: raw_image_url || imageUrl,
          normalized_url: normalized_image_url || normalizeDuplicateImageUrl(imageSourceUrl),
          resolved_image_url: imageSourceUrl,
          duplicate_cache_key: duplicateCacheKey,
          product_id: product?.id || product?.product_id || null,
          error: summary,
        });
        if (Number(summary.status) === 500) {
          const fallbackMessage = productImageUrlFallbackMessage({
            imageUrl: imageSourceUrl,
            productUrl,
          });
          try {
            await sendTextMessage({
              phone: generated.phone || message.phone,
              message: fallbackMessage,
            });
            console.info("[whatsapp-image-send-fallback-text]", {
              conversation_id: generated.sessionId || "",
              session_id: generated.sessionId || "",
              image_url: imageSourceUrl,
              product_url: productUrl,
              duplicate_cache_key: duplicateCacheKey,
              evolution_status: summary.status || "",
              evolution_response: summary.data || null,
              evolution_response_raw: summary.responseRaw || "",
            });
          } catch (fallbackError) {
            console.error("[whatsapp-image-send-fallback-text-failed]", {
              conversation_id: generated.sessionId || "",
              session_id: generated.sessionId || "",
              image_url: imageSourceUrl,
              product_url: productUrl,
              duplicate_cache_key: duplicateCacheKey,
              evolution_status: summary.status || "",
              evolution_response: summary.data || null,
              evolution_response_raw: summary.responseRaw || "",
              fallback_error: errorSummary(fallbackError),
            });
          }
        }
      }
    }
    const firstFailureReason = imageSendErrors[0]?.error?.message || imageSendErrors[0]?.error?.code || "";
    if (allImageCards.length > 0 && sendableImageCards.length === 0) {
      console.info("[whatsapp-image-cards-skipped]", {
        reason: "product_cards_present_but_no_sendable_public_image_url",
        cards_count: allImageCards.length,
        first_5_cards: allImageCards.slice(0, 5).map(productImageDebugCard),
        skipped_cards: skippedImageCards.map(productImageDebugCard),
      });
    }
    console.info("[product-images-send-summary]", {
      attempted_count: sendableImageCards.length,
      sent_count: imageMessages.length,
      failed_count: imageSendErrors.length,
      skipped_count: skippedImageCards.length,
      first_failure_reason: firstFailureReason,
      successful_urls_count: new Set(imageMessages.map((item) => text(item.image_url)).filter(Boolean)).size,
      invalid_urls_count: skippedImageCards.length,
    });
    await addTraceStep(message.trace_id, "product_images_send", {
      attempted_count: sendableImageCards.length,
      sent_count: imageMessages.length,
      failed_count: imageSendErrors.length,
      skipped_count: skippedImageCards.length,
      first_failure_reason: firstFailureReason,
      successful_urls_count: new Set(imageMessages.map((item) => text(item.image_url)).filter(Boolean)).size,
      invalid_urls_count: skippedImageCards.length,
    });
    let finalReplyText = generated.replyText;
    if (deferImageFollowupText && imageMessages.length > 0) {
      result = await sendTextMessage({ phone: generated.phone || message.phone, message: generated.replyText });
    } else if (deferImageFollowupText && imageMessages.length === 0) {
      const link = firstProductLink(allImageCards);
      finalReplyText = ["\u0627\u0644\u0635\u0648\u0631 \u0645\u0634 \u0638\u0627\u0647\u0631\u0629 \u0639\u0646\u062f\u064a \u062f\u0644\u0648\u0642\u062a\u064a \u064a\u0627 \u0641\u0646\u062f\u0645\u060c \u062a\u062d\u0628 \u0623\u0628\u0639\u062a\u0644\u0643 \u0644\u064a\u0646\u0643 \u0627\u0644\u0645\u0646\u062a\u062c\u061f", link].filter(Boolean).join("\n");
      console.info("[whatsapp-image-send-fallback-link]", {
        conversation_id: generated.sessionId || "",
        session_id: generated.sessionId || "",
        attempted_count: sendableImageCards.length,
        failed_count: imageSendErrors.length,
        product_link: link,
        first_failure_reason: firstFailureReason,
      });
      result = await sendTextMessage({ phone: generated.phone || message.phone, message: finalReplyText });
    } else if (!deferImageFollowupText && sendableImageCards.length > 0 && imageMessages.length === 0) {
      const link = firstProductLink(allImageCards);
      if (link) {
        console.info("[whatsapp-image-send-fallback-link]", {
          conversation_id: generated.sessionId || "",
          session_id: generated.sessionId || "",
          attempted_count: sendableImageCards.length,
          failed_count: imageSendErrors.length,
          product_link: link,
          first_failure_reason: firstFailureReason,
        });
        await sendTextMessage({ phone: generated.phone || message.phone, message: link });
      }
    }
    if (["image_request", "more_images"].includes(text(generated.aiPayload?.detected_intent))) {
      console.info("[ai-followup:image-request]", {
        used_memory: generated.aiPayload?.followup_memory_used === true,
        card_count: sendableImageCards.length,
        sent_count: imageMessages.length,
      });
    }
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: generated.phone || message.phone,
      sessionId: generated.sessionId,
      replyText: finalReplyText,
      sent: true,
      metadata: {
        result: result?.result || null,
        image_card_count: sendableImageCards.length,
        image_messages: imageMessages,
        image_send_errors: imageSendErrors,
      },
    });
    console.info("[whatsapp:ai-sent]", {
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      phoneSuffix: (generated.phone || message.phone || "").slice(-4),
      replyLength: finalReplyText.length,
      image_card_count: sendableImageCards.length,
      image_sent_count: imageMessages.length,
      image_failed_count: imageSendErrors.length,
    });
    await addTraceStep(message.trace_id, "send_to_whatsapp", {
      target_phone_suffix: (generated.phone || message.phone || "").slice(-4),
      evolution_instance: result?.instanceName || instanceName(),
      delivery_status: "sent",
      error: "",
      result: result?.result || null,
    });
    await finishTrace(message.trace_id, {
      status: "sent",
      replyLength: finalReplyText.length,
      image_card_count: sendableImageCards.length,
      image_sent_count: imageMessages.length,
      image_failed_count: imageSendErrors.length,
    });
    return {
      ...generated,
      replyText: finalReplyText,
      sent: true,
      result,
      image_card_count: sendableImageCards.length,
      image_messages: imageMessages,
      image_send_errors: imageSendErrors,
    };
  } catch (error) {
    const summary = errorSummary(error);
    console.error("[whatsapp:ai-send-error]", {
      ...summary,
      target: "evolution-sendText",
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      phoneSuffix: (generated.phone || message.phone || "").slice(-4),
    });
    await appendAiGeneratedSupportReply({
      tenantId: generated.tenantId,
      sessionId: generated.sessionId,
      answer: generated.replyText,
      confidence: generated.aiPayload?.confidence || 0,
      detectedIntent: generated.aiPayload?.detected_intent || "whatsapp_ai_reply",
      suggestedProducts: generated.aiPayload?.suggested_products || [],
      visualAttachments: generated.aiPayload?.visual_attachments || [],
      suggestedActions: generated.aiPayload?.suggested_actions || [],
      channel: AI_AGENT_CHANNELS.WHATSAPP,
      deliveryStatus: "failed",
      deliveryError: summary.causeMessage ? `${summary.message} / cause: ${summary.causeMessage}` : summary.message,
    }).catch(() => {});
    await logWhatsappAiOutbound({
      tenantId: generated.tenantId,
      phone: generated.phone || message.phone,
      sessionId: generated.sessionId,
      replyText: generated.replyText,
      sent: false,
      metadata: { error: summary, target: "evolution-sendText" },
    });
    console.error("[whatsapp:ai-error]", {
      ...summary,
      phase: "send",
      target: "evolution-sendText",
      sessionId: generated.sessionId,
      phoneSuffix: (generated.phone || message.phone || "").slice(-4),
    });
    await addTraceStep(message.trace_id, "send_to_whatsapp", {
      target_phone_suffix: (generated.phone || message.phone || "").slice(-4),
      evolution_instance: instanceName(),
      delivery_status: "failed",
      error: summary,
    });
    await addTraceStep(message.trace_id, "product_images_send", {
      attempted_count: 0,
      sent_count: 0,
      failed_count: 0,
      skip_reason: "text_send_failed",
    });
    await failTrace(message.trace_id, error, { phase: "send_to_whatsapp", sessionId: generated.sessionId });
    return { ...generated, sent: false, reason: "evolution_send_failed", error: summary };
  }
};

export default {
  getStatus,
  sendTextMessage,
  sendOrderConfirmationMessage,
  normalizeEgyptPhone,
  verifyWebhookSecret,
  handleIncomingWebhook,
  triggerWhatsappAiAutoReply,
};

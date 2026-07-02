import db from "../database/db.js";
import { getPublishingAccessToken, validateMetaToken } from "./metaTokenService.js";
import ensureMarketingSchema from "../utils/marketingSchema.js";

const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const GRAPH_API_PRIVATE_REPLY_VERSIONS = [GRAPH_API_VERSION, "v19.0", "v20.0", "v21.0"];

const DEFAULT_KEYWORDS = ["بكام", "السعر", "سعر", "كام", "متاح", "موجود", "مقاس", "الوان", "لون", "price", "how much", "available", "size", "color"];
const DEFAULT_PUBLIC_REPLY = "تم الرد على حضرتك في الرسائل ❤️";
const DEFAULT_PRIVATE_REPLY = `أهلاً بحضرتك ❤️
الموديل {{product_name}} سعره: {{price}} ج.م

المتاح حاليًا:
{{variants}}

تحب أأكد لحضرتك المقاس واللون؟`;

const trimString = (value) => String(value || "").trim();
const nullableString = (value) => {
  const normalized = trimString(value);
  return normalized || null;
};
const isDevelopment = () => process.env.NODE_ENV !== "production";
const devLog = (...args) => {
  if (isDevelopment()) console.log(...args);
};
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsLog = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.log(...args);
};
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};

const maskSecretStatus = (value) => Boolean(trimString(value));
const normalizeWebhookField = (value = "") => trimString(value).toLowerCase();
const COMMENT_WEBHOOK_FIELDS = new Set(["feed", "comments", "mentions"]);
const COMMENT_WEBHOOK_VERBS = new Set(["add", "created", "edited", "edit"]);
const pickFirstText = (...values) => {
  for (const value of values) {
    const normalized = trimString(value);
    if (normalized) return normalized;
  }
  return "";
};

const META_WEBHOOK_SECRET_KEYS = new Set([
  "access_token",
  "app_secret",
  "appsecret_proof",
  "authorization",
  "client_secret",
  "code",
  "password",
  "refresh_token",
  "secret",
  "signed_request",
  "token",
  "verify_token",
  "webhook_secret",
]);

const sanitizeMetaWebhookPayload = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 6) return Array.isArray(value) ? [] : {};
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeMetaWebhookPayload(item, depth + 1));
  if (typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (META_WEBHOOK_SECRET_KEYS.has(normalizeWebhookField(key))) continue;
    result[key] = sanitizeMetaWebhookPayload(item, depth + 1);
  }
  return result;
};

const collectMetaWebhookRawEventData = (payload = {}) => {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const fields = [];
  const itemTypes = [];
  const verbs = [];
  let hasCommentLike = false;

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const field = normalizeWebhookField(change?.field);
      const item = normalizeWebhookField(change?.value?.item);
      const verb = normalizeWebhookField(change?.value?.verb);
      const postId = trimString(change?.value?.post_id);
      const commentId = trimString(change?.value?.comment_id);
      const parentId = trimString(change?.value?.parent_id);
      const message = trimString(change?.value?.message);
      if (field) {
        fields.push(field);
        if (field.includes("comment")) hasCommentLike = true;
      }
      if (item) itemTypes.push(item);
      if (verb) verbs.push(verb);
      if (field?.includes("comment") || item === "comment" || commentId || parentId || (message && postId)) {
        hasCommentLike = true;
      }
    }
    const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const messageEvent of messaging) {
      const message = messageEvent?.message || {};
      if (trimString(messageEvent?.postback?.title || "") || trimString(message?.mid || "") || trimString(message?.text || "")) {
        // keep payload context below
      }
      if (trimString(message?.post_id || "") || trimString(message?.comment_id || "") || trimString(message?.parent_id || "")) {
        hasCommentLike = true;
      }
    }
  }

  return {
    fields: [...new Set(fields)],
    itemTypes: [...new Set(itemTypes)],
    verbs: [...new Set(verbs)],
    hasCommentLike,
    payload: sanitizeMetaWebhookPayload(payload),
    bodyPreview: JSON.stringify(sanitizeMetaWebhookPayload(payload)).slice(0, 3000),
  };
};

export const recordMetaWebhookRawEvent = async ({ req = null, payload = {}, tenantId = 1 } = {}) => {
  await ensureMarketingSchema();
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  const eventData = collectMetaWebhookRawEventData(payload);
  const payloadRecord = {
    timestamp: new Date().toISOString(),
    path: trimString(req?.originalUrl || req?.url || ""),
    method: trimString(req?.method || ""),
    headers: {
      user_agent: trimString(req?.headers?.["user-agent"] || ""),
      has_x_hub_signature_256: Boolean(req?.headers?.["x-hub-signature-256"]),
    },
    body_preview: eventData.bodyPreview,
    object: trimString(payload?.object || ""),
    entry_ids: entries.map((entry) => trimString(entry?.id)).filter(Boolean),
    changes: entries.flatMap((entry) =>
      (Array.isArray(entry?.changes) ? entry.changes : []).map((change) => ({
        field: trimString(change?.field),
        value: {
          item: trimString(change?.value?.item),
          verb: trimString(change?.value?.verb),
          post_id: trimString(change?.value?.post_id),
          comment_id: trimString(change?.value?.comment_id),
          parent_id: trimString(change?.value?.parent_id),
          message: trimString(change?.value?.message),
        },
      }))
    ),
    messaging_keys: entries.flatMap((entry) => {
      const messaging = Array.isArray(entry?.messaging) ? entry.messaging : [];
      return messaging.flatMap((messageEvent = {}) => Object.keys(messageEvent || {}));
    }),
    ...eventData,
  };
  const result = await db.query(
    `
    INSERT INTO meta_webhook_raw_events (
      tenant_id,
      path,
      object,
      fields,
      item_types,
      verbs,
      has_comment_like,
      payload
    )
    VALUES ($1::int, $2::text, $3::text, $4::text[], $5::text[], $6::text[], $7::boolean, $8::jsonb)
    RETURNING id, received_at
    `,
    [
      Number(tenantId || 1) || 1,
      payloadRecord.path,
      payloadRecord.object,
      eventData.fields,
      eventData.itemTypes,
      eventData.verbs,
      eventData.hasCommentLike,
      JSON.stringify(payloadRecord),
    ]
  );
  return { id: result.rows[0]?.id || null, received_at: result.rows[0]?.received_at || null, ...payloadRecord };
};

export const listMetaWebhookRawEvents = async ({ limit = 20 } = {}) => {
  await ensureMarketingSchema();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const result = await db.query(
    `
    SELECT id, tenant_id, received_at, path, object, fields, item_types, verbs, has_comment_like, payload
    FROM meta_webhook_raw_events
    ORDER BY received_at DESC, id DESC
    LIMIT $1
    `,
    [safeLimit]
  );
  return result.rows || [];
};

export const clearMetaWebhookRawEvents = async () => {
  await ensureMarketingSchema();
  await db.query(`DELETE FROM meta_webhook_raw_events`);
  return { cleared: true };
};

const recordMarketingWebhookRequest = async ({ businessId = null, object = "", entriesCount = 0 } = {}) => {
  await db.query(
    `
    INSERT INTO marketing_meta_webhook_requests (
      business_id,
      object,
      entries_count
    )
    VALUES ($1::bigint, $2::varchar, $3::int)
    `,
    [businessId || null, trimString(object) || "", Number(entriesCount || 0)]
  );
};

export const countMarketingWebhookRequestsLast24h = async (businessId) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM marketing_meta_webhook_requests
    WHERE business_id = $1::bigint
      AND created_at >= NOW() - INTERVAL '24 hours'
    `,
    [businessId || 1]
  );
  return Number(result.rows[0]?.count || 0);
};

export const countMarketingCommentEventsLast24h = async (businessId) => {
  const result = await db.query(
    `
    SELECT COUNT(*)::int AS count
    FROM marketing_comment_events
    WHERE business_id = $1::bigint
      AND created_at >= NOW() - INTERVAL '24 hours'
    `,
    [businessId || 1]
  );
  return Number(result.rows[0]?.count || 0);
};

const getPublicBackendUrl = () => trimString(process.env.PUBLIC_BACKEND_URL).replace(/\/+$/g, "");
const getMetaAppAccessToken = () => {
  const appId = trimString(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
  const appSecret = trimString(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET);
  return appId && appSecret ? `${appId}|${appSecret}` : "";
};

const buildMetaWebhookStatusDefaults = () => {
  const verifyTokenConfigured = maskSecretStatus(process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN);
  const signatureValidationEnabled = maskSecretStatus(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET);
  const publicBackendUrl = getPublicBackendUrl();
  return {
    verify_token_configured: verifyTokenConfigured,
    signature_validation_enabled: signatureValidationEnabled,
    last_event_at: null,
    recent_payload_preview: null,
    webhook_url: publicBackendUrl ? `${publicBackendUrl}/api/marketing/webhooks/meta` : "/api/marketing/webhooks/meta",
    connected: Boolean(verifyTokenConfigured && signatureValidationEnabled),
    app_secret_configured: signatureValidationEnabled,
    subscribed_fields: ["messages", "messaging_postbacks", "feed"],
  };
};

const safeJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return value.split(/[،,]/).map((item) => item.trim()).filter(Boolean);
    }
  }
  return fallback;
};

const parseMetaResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const getMetaErrorMessage = (payload, fallback = "Meta automation request failed") => {
  if (payload?.error?.message) return payload.error.message;
  if (payload?.error) return JSON.stringify(payload.error);
  if (payload?.message) return payload.message;
  return fallback;
};

const getSettingsRow = async (businessId) => {
  const result = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [businessId]
  );
  return result.rows[0] || null;
};

const callMetaPost = async ({ businessId, endpoint, params, label }) => {
  const settings = await getSettingsRow(businessId);
  validateMetaToken(settings || {});
  const target = `${GRAPH_API_BASE_URL}${endpoint}`;
  devLog("[marketing-auto-reply] Meta request", { target, label });

  const response = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      access_token: getPublishingAccessToken(settings),
    }),
  });
  const payload = await parseMetaResponse(response);

  if (response.ok) {
    devLog(`[meta-action] ${label} success`, { endpoint, status: response.status, response: payload });
    return payload;
  }

  const error = new Error(getMetaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  console.error(`[meta-action] ${label} error`, { endpoint, status: response.status, response: payload, message: error.message });
  throw error;
};

const getGraphBaseUrlForVersion = (version = GRAPH_API_VERSION) => `https://graph.facebook.com/${trimString(version || GRAPH_API_VERSION)}`;

const callMetaPostWithShape = async ({ businessId, endpoint, label, contentType, body, bodyShape, graphVersion = GRAPH_API_VERSION, tokenDelivery = "form_body" }) => {
  const settings = await getSettingsRow(businessId);
  validateMetaToken(settings || {});
  const accessToken = getPublishingAccessToken(settings);
  const target = new URL(`${getGraphBaseUrlForVersion(graphVersion)}${endpoint}`);
  const params = body instanceof URLSearchParams ? new URLSearchParams(body) : new URLSearchParams(body || {});
  if (tokenDelivery === "query") target.searchParams.set("access_token", accessToken);
  else params.set("access_token", accessToken);
  const requestBody = params;
  const requestHeaders = { "Content-Type": contentType };

  const bodyPreview = requestBody instanceof URLSearchParams
    ? requestBody.toString()
    : typeof requestBody === "string"
      ? requestBody
      : JSON.stringify(requestBody || {});
  const safeBodyPreview = bodyPreview.replace(/(access_token=)[^&]+/g, "$1***");

  debugSocialCommentsWarn("[social-comments:private-reply-payload-shape-debug]", {
    graph_path: endpoint,
    graph_base: getGraphBaseUrlForVersion(graphVersion),
    graph_version: trimString(graphVersion || GRAPH_API_VERSION),
    method: "POST",
    content_type: contentType,
    body_shape: bodyShape,
    token_delivery: tokenDelivery,
    body_preview: safeBodyPreview.slice(0, 500),
    label,
  });

  const response = await fetch(target.toString(), {
    method: "POST",
    headers: requestHeaders,
    body: requestBody,
  });
  const payload = await parseMetaResponse(response);

  if (response.ok) {
    debugSocialCommentsWarn("[social-comments:private-reply-payload-shape-debug]", {
      graph_path: endpoint,
      graph_base: getGraphBaseUrlForVersion(graphVersion),
      graph_version: trimString(graphVersion || GRAPH_API_VERSION),
      method: "POST",
      content_type: contentType,
      body_shape: bodyShape,
      token_delivery: tokenDelivery,
      body_preview: safeBodyPreview.slice(0, 500),
      label,
      meta_status: "ok",
      meta_error_code: "",
      meta_error_subcode: "",
      meta_error_message: "",
    });
    return payload;
  }

  const error = new Error(getMetaErrorMessage(payload));
  error.status = response.status;
  error.metaResponse = payload;
  debugSocialCommentsWarn("[social-comments:private-reply-payload-shape-debug]", {
    graph_path: endpoint,
    graph_base: getGraphBaseUrlForVersion(graphVersion),
    graph_version: trimString(graphVersion || GRAPH_API_VERSION),
    method: "POST",
    content_type: contentType,
    body_shape: bodyShape,
    token_delivery: tokenDelivery,
    body_preview: safeBodyPreview.slice(0, 500),
    label,
    meta_status: String(response.status || ""),
    meta_error_code: String(payload?.error?.code || ""),
    meta_error_subcode: String(payload?.error?.error_subcode || payload?.error?.subcode || ""),
    meta_error_message: error.message || "",
  });
  throw error;
};

const callMetaGet = async ({ accessToken, endpoint, params, label }) => {
  const target = new URL(`${GRAPH_API_BASE_URL}${endpoint}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const normalized = nullableString(value);
    if (normalized !== null) target.searchParams.set(key, normalized);
  });
  target.searchParams.set("access_token", accessToken);

  const safeTarget = target.toString().replace(/(access_token|input_token)=[^&]+/g, "$1=***");
  devLog("[meta-action] token validation requested", { target: safeTarget, label });
  const response = await fetch(target);
  const payload = await parseMetaResponse(response);
  if (response.ok) return payload;

  const error = new Error(getMetaErrorMessage(payload, "Meta token permission validation failed"));
  error.status = response.status;
  error.metaResponse = payload;
  console.error("[meta-action] token validation error", { status: response.status, response: payload, message: error.message });
  throw error;
};

const extractMetaErrorDetails = (error = {}) => ({
  status: error?.status ?? null,
  code: error?.metaResponse?.error?.code ?? error?.code ?? "",
  subcode: error?.metaResponse?.error?.error_subcode ?? error?.metaResponse?.error?.subcode ?? "",
  message: error?.metaResponse?.error?.message || error?.message || "",
});

const loadPrivateReplyCapabilityDebug = async ({ businessId, commentId } = {}) => {
  const settings = await getSettingsRow(businessId);
  validateMetaToken(settings || {});
  const accessToken = getPublishingAccessToken(settings);
  const pageId = trimString(settings?.page_id || settings?.facebook_page_id || "");
  const tokenMe = { id: "", name: "" };
  let pageName = "";
  let canReplyPrivately = null;
  let canReplyPrivatelyError = "";
  let commentProbeSuccess = false;

  try {
    const mePayload = await callMetaGet({
      accessToken,
      endpoint: "/me",
      label: "private_reply_me_probe",
      params: { fields: "id,name" },
    });
    tokenMe.id = trimString(mePayload?.id || "");
    tokenMe.name = trimString(mePayload?.name || "");
  } catch (error) {
    const details = extractMetaErrorDetails(error);
    tokenMe.id = "";
    tokenMe.name = "";
    canReplyPrivatelyError = canReplyPrivatelyError || details.message;
  }

  if (pageId) {
    try {
      const pagePayload = await callMetaGet({
        accessToken,
        endpoint: `/${encodeURIComponent(pageId)}`,
        label: "private_reply_page_probe",
        params: { fields: "id,name,access_token" },
      });
      pageName = trimString(pagePayload?.name || "");
    } catch (error) {
      const details = extractMetaErrorDetails(error);
      canReplyPrivatelyError = canReplyPrivatelyError || details.message;
    }
  }

  try {
    const commentPayload = await callMetaGet({
      accessToken,
      endpoint: `/${encodeURIComponent(trimString(commentId))}`,
      label: "private_reply_comment_probe",
      params: { fields: "id,message,from,parent,permalink_url,can_reply_privately" },
    });
    commentProbeSuccess = true;
    if (Object.prototype.hasOwnProperty.call(commentPayload || {}, "can_reply_privately")) {
      canReplyPrivately = Boolean(commentPayload.can_reply_privately);
    }
  } catch (error) {
    const details = extractMetaErrorDetails(error);
    if (Number(details.code) === 100) {
      canReplyPrivatelyError = canReplyPrivatelyError || details.message || "unsupported field";
      console.warn("[social-comments:private-reply-capability-debug]", {
        token_me_id: tokenMe.id,
        token_me_name: tokenMe.name,
        page_id: pageId,
        page_name: pageName,
        comment_id: trimString(commentId),
        comment_probe_success: false,
        can_reply_privately: null,
        can_reply_privately_error: details.message || "unsupported field",
        private_reply_status: "",
        private_reply_error_code: details.code || "",
        private_reply_error_subcode: details.subcode || "",
        private_reply_error_message: details.message || "",
      });
    } else {
      canReplyPrivatelyError = canReplyPrivatelyError || details.message;
    }
  }

  return {
    settings,
    accessToken,
    pageId,
    pageName,
    tokenMeId: tokenMe.id,
    tokenMeName: tokenMe.name,
    canReplyPrivately,
    canReplyPrivatelyError,
    commentProbeSuccess,
  };
};

export const normalizeCommentText = (value = "") =>
  trimString(value)
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/[ى]/g, "ي")
    .replace(/[ة]/g, "ه")
    .replace(/[ؤئ]/g, "ء")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeKeywords = (value = []) => safeJsonArray(value, []).map(trimString).filter(Boolean);

const includesAny = (message, terms) => {
  const text = normalizeCommentText(message);
  return terms.some((term) => text.includes(normalizeCommentText(term)));
};

export const detectPriceIntent = (message = "") =>
  includesAny(message, ["بكام", "كام", "السعر", "سعر", "تمن", "ثمن", "بقد ايه", "بقد إيه", "price", "how much", "cost"]);

export const detectAvailabilityIntent = (message = "") =>
  includesAny(message, ["متاح", "موجود", "لسه", "فيه", "في من", "available", "in stock", "stock"]);

export const detectVariantIntent = (message = "") =>
  includesAny(message, ["مقاس", "مقاسات", "لون", "الوان", "ألوان", "نمرة", "size", "color", "colour"]);

const getMatchedKeyword = (rule = {}, message = "") => {
  const text = normalizeCommentText(message);
  const keywords = normalizeKeywords(rule.keywords?.length ? rule.keywords : DEFAULT_KEYWORDS);
  return keywords.find((keyword) => text.includes(normalizeCommentText(keyword))) || null;
};

const getLeadScore = (message = "", hasRule = false) => {
  if (includesAny(message, ["عاوز", "عايز", "احجز", "ابعت", "فين", "محتاج", "اطلب", "order", "reserve", "send"])) return "high";
  if (includesAny(message, ["بكام", "كام", "متاح", "السعر", "price", "available"]) || hasRule) return "medium";
  return "low";
};

const extractRequestedSize = (message = "") => {
  const normalized = normalizeCommentText(message);
  const match = normalized.match(/(?:مقاس|نمره|نمرة|size)\s*([a-z0-9\u0621-\u064a]+)/i);
  return match?.[1] || null;
};

export const commentMatchesRule = (rule = {}, message = "") => {
  const text = normalizeCommentText(message);
  if (!text) return false;
  const keywords = normalizeKeywords(rule.keywords?.length ? rule.keywords : DEFAULT_KEYWORDS).map(normalizeCommentText);
  if (detectPriceIntent(message) || detectAvailabilityIntent(message) || detectVariantIntent(message)) return true;
  if (!keywords.length) return true;
  const mode = trimString(rule.match_mode || "any").toLowerCase();
  if (mode === "all") return keywords.every((keyword) => text.includes(keyword));
  if (mode === "exact") return keywords.some((keyword) => text === keyword);
  return keywords.some((keyword) => text.includes(keyword));
};

export const renderTemplate = (template = "", context = {}) =>
  trimString(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => trimString(context[key]));

export const likeComment = async (platform, commentId, businessId) => {
  return callMetaPost({
    businessId,
    endpoint: `/${encodeURIComponent(commentId)}/likes`,
    label: "like",
    params: {},
  });
};

export const replyToComment = async (platform, commentId, message, businessId) => {
  const endpoint = platform === "instagram"
    ? `/${encodeURIComponent(commentId)}/replies`
    : `/${encodeURIComponent(commentId)}/comments`;
  return callMetaPost({
    businessId,
    endpoint,
    label: "public reply",
    params: { message: trimString(message) },
  });
};

export const sendPrivateReply = async (platform, commentId, message, businessId) => {
  const settings = await getSettingsRow(businessId);
  const tokenStatus = validateMetaToken(settings || {});
  const capabilityDebug = await loadPrivateReplyCapabilityDebug({ businessId, commentId }).catch((error) => ({
    settings,
    accessToken: tokenStatus?.accessToken || "",
    pageId: trimString(settings?.page_id || settings?.facebook_page_id || ""),
    pageName: trimString(settings?.page_name || settings?.facebook_page_name || ""),
    tokenMeId: "",
    tokenMeName: "",
    canReplyPrivately: null,
    canReplyPrivatelyError: error?.message || "",
    commentProbeSuccess: false,
  }));
  const initialProbe = capabilityDebug?.commentProbe?.raw || null;
  const resolvedTarget = await resolvePrivateReplyTargetCommentId({
    businessId,
    commentId,
    initialProbe,
  });
  const graphCommentId = trimString(resolvedTarget?.resolvedCommentId || commentId);
  const graphProbe = resolvedTarget?.probe || initialProbe || null;
  const probeFields = graphProbe
    ? {
        id: trimString(graphProbe?.id || ""),
        parent: graphProbe?.parent || null,
        from: graphProbe?.from || null,
        can_reply_privately: capabilityDebug?.canReplyPrivately ?? null,
        permalink_url: trimString(graphProbe?.permalink_url || ""),
        created_time: trimString(graphProbe?.created_time || ""),
      }
    : {
        id: "",
        parent: null,
        from: null,
        can_reply_privately: capabilityDebug?.canReplyPrivately ?? null,
        permalink_url: "",
        created_time: "",
      };
  const probeParent = graphProbe?.parent && typeof graphProbe.parent === "object" ? graphProbe.parent : null;
  const probeObject = trimString(graphProbe?.object || graphProbe?.type || graphProbe?.attachment?.type || "");
  const probePermalink = trimString(graphProbe?.permalink_url || "");
  const probeText = `${probePermalink} ${probeObject} ${probeParent?.type || ""}`.toLowerCase();
  const probeMediaText = `${probeObject} ${probeParent?.type || ""}`.toLowerCase();
  const isReel = /\/reel(s)?\//i.test(probePermalink) || probeText.includes("reel");
  const isFeedPost = !isReel && (probeText.includes("facebook.com/") || probeText.includes("/posts/") || probeText.includes("/permalink.php") || probeText.includes("/videos/") || probeText.includes("/photo") || probeText.includes("feed"));
  const isVideo = probeMediaText.includes("video") || /\/videos\//i.test(probePermalink);
  const isPhoto = probeMediaText.includes("photo") || /\/photos\//i.test(probePermalink);
  const isStory = probeText.includes("/stories/") || probeMediaText.includes("story");
  const isCrosspost = probeText.includes("crosspost") || probeMediaText.includes("crosspost");
  if (isReel) {
    debugSocialCommentsWarn("REEL_COMMENT_DETECTED", {
      comment_id: trimString(commentId),
      probe_id: trimString(graphProbe?.id || ""),
      permalink_url: probePermalink,
    });
  } else if (isFeedPost) {
    debugSocialCommentsWarn("FEED_COMMENT_DETECTED", {
      comment_id: trimString(commentId),
      probe_id: trimString(graphProbe?.id || ""),
      permalink_url: probePermalink,
    });
  }
  debugSocialCommentsWarn("[social-comments:private-reply-comment-probe-debug]", {
    comment_id: trimString(commentId),
    resolved_comment_id: graphCommentId,
    probe_success: Boolean(capabilityDebug?.commentProbeSuccess || graphProbe),
    probe_error: resolvedTarget?.probeError || capabilityDebug?.commentProbeError || "",
    probe_fields: probeFields,
    comment: {
      id: trimString(graphProbe?.id || ""),
      parent: {
        id: trimString(probeParent?.id || ""),
        type: trimString(probeParent?.type || ""),
      },
      object: probeObject,
      from: graphProbe?.from || null,
      permalink_url: probePermalink,
      created_time: trimString(graphProbe?.created_time || ""),
    },
    object_type_resolution: {
      is_feed_post: isFeedPost,
      is_reel: isReel,
      is_video: isVideo,
      is_photo: isPhoto,
      is_story: isStory,
      is_crosspost: isCrosspost,
    },
  });
  const normalizedPlatform = trimString(platform || "").toLowerCase().includes("instagram") ? "instagram" : "facebook";
  const pageId = trimString(capabilityDebug?.pageId || settings?.page_id || settings?.facebook_page_id || settings?.instagram_business_account_id || "");
  const activeImplementationFinalUrl = normalizedPlatform === "facebook"
    ? `${getGraphBaseUrlForVersion(GRAPH_API_VERSION)}/${encodeURIComponent(pageId)}/messages`
    : `${getGraphBaseUrlForVersion(GRAPH_API_VERSION)}/${encodeURIComponent(graphCommentId)}/private_replies`;
  debugSocialCommentsWarn("ACTIVE_PRIVATE_REPLY_IMPLEMENTATION", {
    implementation: "page_messages_v2",
    file: "server/services/marketingCommentAutomationService.js",
    page_id: pageId,
    comment_id: graphCommentId,
    final_url_without_token: activeImplementationFinalUrl,
    platform: normalizedPlatform,
  });
  debugSocialCommentsWarn("[social-comments:private-reply-meta-call-debug]", {
    comment_id: graphCommentId,
    graph_path: normalizedPlatform === "facebook"
      ? `/${encodeURIComponent(pageId)}/messages`
      : `/${encodeURIComponent(graphCommentId)}/private_replies`,
    method: "POST",
    payload_keys: normalizedPlatform === "facebook" ? ["recipient", "message"] : ["message"],
    page_id: pageId,
    token_present: Boolean(tokenStatus?.accessToken),
    meta_status: "",
    meta_error_message: "",
    resolved_comment_id: graphCommentId,
    recipient_shape: normalizedPlatform === "facebook" ? "comment_id" : "",
  });
  if (normalizedPlatform === "facebook") {
    const fixedMessage = "تم الرد على حضرتك في الخاص ✅";
    const endpoint = `/${encodeURIComponent(pageId)}/messages`;
    const finalUrlWithoutToken = `${getGraphBaseUrlForVersion(GRAPH_API_VERSION)}${endpoint}`;
    const requestBody = {
      recipient: {
        comment_id: graphCommentId,
      },
      message: {
        text: fixedMessage,
      },
    };
    debugSocialCommentsWarn("GRAPH_PRIVATE_REPLY_REQUEST", {
      target_comment_id: graphCommentId,
      graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
      graph_version: trimString(GRAPH_API_VERSION),
      graph_path: endpoint,
      token_delivery: "query",
      body_shape: "recipient_comment_id_message_text_json",
      recipient_shape: "comment_id",
      final_url_without_token: finalUrlWithoutToken,
    });
    debugSocialCommentsWarn("[social-comments:private-reply-version-debug]", {
      graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
      graph_version: trimString(GRAPH_API_VERSION),
      graph_path: endpoint,
      content_type: "application/json",
      token_delivery: "query",
      meta_status: "attempting",
      meta_error_code: "",
      meta_error_subcode: "",
      meta_error_message: "",
    });
    try {
      const accessToken = tokenStatus?.accessToken || getPublishingAccessToken(settings);
      const target = new URL(finalUrlWithoutToken);
      target.searchParams.set("access_token", accessToken);
      const response = await fetch(target.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = await parseMetaResponse(response);
      if (!response.ok) {
        const error = new Error(getMetaErrorMessage(payload));
        error.status = response.status;
        error.metaResponse = payload;
        throw error;
      }
      debugSocialCommentsWarn("GRAPH_PRIVATE_REPLY_RESPONSE", {
        target_comment_id: graphCommentId,
        graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
        graph_version: trimString(GRAPH_API_VERSION),
        graph_path: endpoint,
        token_delivery: "query",
        meta_status: "ok",
        meta_error_code: "",
        meta_error_subcode: "",
        meta_error_message: "",
      });
      debugSocialCommentsWarn("[social-comments:private-reply-version-debug]", {
        graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
        graph_version: trimString(GRAPH_API_VERSION),
        graph_path: endpoint,
        content_type: "application/json",
        token_delivery: "query",
        meta_status: "ok",
        meta_error_code: "",
        meta_error_subcode: "",
        meta_error_message: "",
      });
      debugSocialCommentsWarn("[social-comments:private-reply-meta-call-debug]", {
        comment_id: graphCommentId,
        graph_path: endpoint,
        method: "POST",
        payload_keys: ["recipient", "message"],
        page_id: pageId,
        token_present: Boolean(accessToken),
        meta_status: "ok",
        meta_error_message: "",
        payload_shape: "recipient_comment_id_message_text_json",
        resolved_comment_id: graphCommentId,
        token_delivery: "query",
        final_url_without_token: finalUrlWithoutToken,
        recipient_shape: "comment_id",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_SENT", {
        comment_id: graphCommentId,
        page_id: pageId,
        token_delivery: "query",
      });
      return payload;
    } catch (error) {
      const details = extractMetaErrorDetails(error);
      debugSocialCommentsWarn("GRAPH_PRIVATE_REPLY_RESPONSE", {
        target_comment_id: graphCommentId,
        graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
        graph_version: trimString(GRAPH_API_VERSION),
        graph_path: endpoint,
        token_delivery: "query",
        meta_status: String(error?.status || details.status || ""),
        meta_error_code: details.code || "",
        meta_error_subcode: details.subcode || "",
        meta_error_message: details.message || "",
      });
      debugSocialCommentsWarn("[social-comments:private-reply-version-debug]", {
        graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
        graph_version: trimString(GRAPH_API_VERSION),
        graph_path: endpoint,
        content_type: "application/json",
        token_delivery: "query",
        meta_status: String(error?.status || details.status || ""),
        meta_error_code: details.code || "",
        meta_error_subcode: details.subcode || "",
        meta_error_message: details.message || "",
      });
      debugSocialCommentsWarn("[social-comments:private-reply-meta-call-debug]", {
        comment_id: graphCommentId,
        graph_path: endpoint,
        method: "POST",
        payload_keys: ["recipient", "message"],
        page_id: pageId,
        token_present: Boolean(tokenStatus?.accessToken || getPublishingAccessToken(settings)),
        meta_status: String(error?.status || details.status || ""),
        meta_error_message: String(error?.message || details.message || ""),
        payload_shape: "recipient_comment_id_message_text_json",
        resolved_comment_id: graphCommentId,
        token_delivery: "query",
        final_url_without_token: finalUrlWithoutToken,
        recipient_shape: "comment_id",
      });
      console.log("SOCIAL_COMMENT_PRIVATE_REPLY_FAILED", {
        comment_id: graphCommentId,
        page_id: pageId,
        token_delivery: "query",
        status: error?.status || details.status || null,
        message: details.message || error?.message || "",
      });
      const mappedCode = Number(details.code) === 100 && Number(details.subcode) === 33
        ? "META_PRIVATE_REPLY_UNSUPPORTED_OR_PERMISSION_DENIED"
        : "";
      console.warn("[social-comments:private-reply-capability-debug]", {
        token_me_id: capabilityDebug?.tokenMeId || "",
        token_me_name: capabilityDebug?.tokenMeName || "",
        page_id: pageId,
        page_name: trimString(capabilityDebug?.pageName || settings?.page_name || settings?.facebook_page_name || ""),
        comment_id: graphCommentId,
        comment_probe_success: Boolean(capabilityDebug?.commentProbeSuccess),
        can_reply_privately: capabilityDebug?.canReplyPrivately,
        can_reply_privately_error: capabilityDebug?.canReplyPrivatelyError || "",
        private_reply_status: String(error?.status || details.status || ""),
        private_reply_error_code: details.code || "",
        private_reply_error_subcode: details.subcode || "",
        private_reply_error_message: details.message || "",
      });
      if (mappedCode) {
        error.code = mappedCode;
        error.publicCode = mappedCode;
      }
      throw error;
    }
  }
  const fixedMessage = "تم الرد على حضرتك في الخاص ✅";
  const endpoint = `/${encodeURIComponent(graphCommentId)}/private_replies`;
  const finalUrlWithoutToken = `${getGraphBaseUrlForVersion(GRAPH_API_VERSION)}${endpoint}`;
  debugSocialCommentsWarn("GRAPH_PRIVATE_REPLY_REQUEST", {
    target_comment_id: graphCommentId,
    graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
    graph_version: trimString(GRAPH_API_VERSION),
    graph_path: endpoint,
    token_delivery: "query",
    body_shape: "minimal_text_only",
    final_url_without_token: finalUrlWithoutToken,
  });
  debugSocialCommentsWarn("[social-comments:private-reply-version-debug]", {
    graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
    graph_version: trimString(GRAPH_API_VERSION),
    graph_path: endpoint,
    content_type: "application/x-www-form-urlencoded",
    token_delivery: "query",
    meta_status: "attempting",
    meta_error_code: "",
    meta_error_subcode: "",
    meta_error_message: "",
  });

  let lastError = null;
  try {
    const payload = await callMetaPostWithShape({
      businessId,
      endpoint,
      label: "private reply",
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ message: fixedMessage }),
      bodyShape: "minimal_text_only",
      graphVersion: GRAPH_API_VERSION,
      tokenDelivery: "query",
    });
    debugSocialCommentsWarn("GRAPH_PRIVATE_REPLY_RESPONSE", {
      target_comment_id: graphCommentId,
      graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
      graph_version: trimString(GRAPH_API_VERSION),
      graph_path: endpoint,
      token_delivery: "query",
      meta_status: "ok",
      meta_error_code: "",
      meta_error_subcode: "",
      meta_error_message: "",
    });
    debugSocialCommentsWarn("[social-comments:private-reply-version-debug]", {
      graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
      graph_version: trimString(GRAPH_API_VERSION),
      graph_path: endpoint,
      content_type: "application/x-www-form-urlencoded",
      token_delivery: "query",
      meta_status: "ok",
      meta_error_code: "",
      meta_error_subcode: "",
      meta_error_message: "",
    });
    debugSocialCommentsWarn("[social-comments:private-reply-meta-call-debug]", {
      comment_id: graphCommentId,
      graph_path: endpoint,
      method: "POST",
      payload_keys: ["message"],
      page_id: trimString(capabilityDebug?.pageId || settings?.page_id || settings?.facebook_page_id || settings?.instagram_business_account_id || ""),
      token_present: Boolean(tokenStatus?.accessToken),
      meta_status: "ok",
      meta_error_message: "",
      payload_shape: "minimal_text_only",
      resolved_comment_id: graphCommentId,
      token_delivery: "query",
      final_url_without_token: finalUrlWithoutToken,
    });
    return payload;
  } catch (error) {
    const details = extractMetaErrorDetails(error);
    lastError = error;
    debugSocialCommentsWarn("GRAPH_PRIVATE_REPLY_RESPONSE", {
      target_comment_id: graphCommentId,
      graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
      graph_version: trimString(GRAPH_API_VERSION),
      graph_path: endpoint,
      token_delivery: "query",
      meta_status: String(error?.status || details.status || ""),
      meta_error_code: details.code || "",
      meta_error_subcode: details.subcode || "",
      meta_error_message: details.message || "",
    });
    debugSocialCommentsWarn("[social-comments:private-reply-version-debug]", {
      graph_base: getGraphBaseUrlForVersion(GRAPH_API_VERSION),
      graph_version: trimString(GRAPH_API_VERSION),
      graph_path: endpoint,
      content_type: "application/x-www-form-urlencoded",
      token_delivery: "query",
      meta_status: String(error?.status || details.status || ""),
      meta_error_code: details.code || "",
      meta_error_subcode: details.subcode || "",
      meta_error_message: details.message || "",
    });
    debugSocialCommentsWarn("[social-comments:private-reply-meta-call-debug]", {
      comment_id: graphCommentId,
      graph_path: endpoint,
      method: "POST",
      payload_keys: ["message"],
      page_id: trimString(capabilityDebug?.pageId || settings?.page_id || settings?.facebook_page_id || settings?.instagram_business_account_id || ""),
      token_present: Boolean(tokenStatus?.accessToken),
      meta_status: String(error?.status || details.status || ""),
      meta_error_message: String(error?.message || details.message || ""),
      payload_shape: "minimal_text_only",
      resolved_comment_id: graphCommentId,
      token_delivery: "query",
      final_url_without_token: finalUrlWithoutToken,
    });
  }

  const details = extractMetaErrorDetails(lastError || {});
  const mappedCode = Number(details.code) === 100 && Number(details.subcode) === 33
    ? "META_PRIVATE_REPLY_UNSUPPORTED_OR_PERMISSION_DENIED"
    : "";
  console.warn("[social-comments:private-reply-capability-debug]", {
    token_me_id: capabilityDebug?.tokenMeId || "",
    token_me_name: capabilityDebug?.tokenMeName || "",
    page_id: trimString(capabilityDebug?.pageId || settings?.page_id || settings?.facebook_page_id || ""),
    page_name: trimString(capabilityDebug?.pageName || settings?.page_name || settings?.facebook_page_name || ""),
    comment_id: graphCommentId,
    comment_probe_success: Boolean(capabilityDebug?.commentProbeSuccess),
    can_reply_privately: capabilityDebug?.canReplyPrivately,
    can_reply_privately_error: capabilityDebug?.canReplyPrivatelyError || "",
    private_reply_status: String(lastError?.status || details.status || ""),
    private_reply_error_code: details.code || "",
    private_reply_error_subcode: details.subcode || "",
    private_reply_error_message: details.message || "",
  });
  if (mappedCode && lastError) {
    lastError.code = mappedCode;
    lastError.publicCode = mappedCode;
  }
  throw lastError;
};

export const probePrivateReplyComment = async ({ businessId, commentId } = {}) => {
  const settings = await getSettingsRow(businessId);
  const tokenStatus = validateMetaToken(settings || {});
  const graphPath = `/${encodeURIComponent(trimString(commentId))}`;
  const payload = await callMetaGet({
    accessToken: tokenStatus.accessToken,
    endpoint: graphPath,
    label: "private_reply_comment_probe",
    params: {
      fields: "id,message,from,parent,permalink_url,created_time",
    },
  });
  return payload;
};

const resolvePrivateReplyTargetCommentId = async ({ businessId, commentId = "", initialProbe = null } = {}) => {
  const settings = await getSettingsRow(businessId);
  const tokenStatus = validateMetaToken(settings || {});
  const accessToken = tokenStatus.accessToken || "";
  const visited = new Set();
  let resolvedCommentId = trimString(commentId);
  let probe = initialProbe || null;
  let probeError = "";

  if (!resolvedCommentId) {
    return { resolvedCommentId: "", probe: null, probeError: "missing_comment_id" };
  }

  if (!accessToken) {
    return { resolvedCommentId, probe, probeError: "missing_access_token" };
  }

  for (let depth = 0; depth < 5 && resolvedCommentId && !visited.has(resolvedCommentId); depth += 1) {
    visited.add(resolvedCommentId);
    if (!probe) {
      try {
        probe = await callMetaGet({
          accessToken,
          endpoint: `/${encodeURIComponent(resolvedCommentId)}`,
          label: "private_reply_comment_probe",
          params: {
            fields: "id,message,from,parent,permalink_url,created_time",
          },
        });
      } catch (error) {
        probeError = error?.message || "";
        break;
      }
    }

    const parentId = trimString(probe?.parent?.id || "");
    if (!parentId || parentId === resolvedCommentId) break;

    resolvedCommentId = parentId;
    probe = null;
  }

  return { resolvedCommentId, probe, probeError };
};

export const savePostProductLinks = async ({ businessId, platform, postId, mediaId, productId, createdBy }) => {
  const normalizedPostId = nullableString(postId);
  const normalizedProductId = productId ? Number(productId) : null;
  if (!businessId || !normalizedPostId || !normalizedProductId) return null;
  const result = await db.query(
    `
    INSERT INTO marketing_post_product_links (
      business_id,
      platform,
      post_id,
      media_id,
      product_id,
      created_by
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (business_id, platform, post_id, product_id)
    DO UPDATE SET media_id = COALESCE(EXCLUDED.media_id, marketing_post_product_links.media_id)
    RETURNING *
    `,
    [businessId, platform || "facebook", normalizedPostId, nullableString(mediaId), normalizedProductId, createdBy || null]
  );
  return result.rows[0] || null;
};

export const saveLinksForPublishedPost = async ({ post, publishResult, createdBy }) => {
  if (!post?.product_id) return [];
  const platformResults = publishResult?.platform_publish_results || {};
  const rows = [];
  const requestedChannel = trimString(post.channel || "facebook").toLowerCase();
  const candidates = [];

  if (platformResults.facebook?.platform_post_id) {
    candidates.push({ platform: "facebook", postId: platformResults.facebook.platform_post_id });
  }
  if (platformResults.instagram?.platform_post_id) {
    candidates.push({ platform: "instagram", postId: platformResults.instagram.platform_post_id, mediaId: platformResults.instagram.platform_post_id });
  }
  if (!candidates.length && (publishResult?.platform_post_id || publishResult?.external_post_id)) {
    const platform = requestedChannel === "instagram" ? "instagram" : "facebook";
    candidates.push({ platform, postId: publishResult.platform_post_id || publishResult.external_post_id, mediaId: platform === "instagram" ? publishResult.platform_post_id || publishResult.external_post_id : null });
  }

  for (const candidate of candidates) {
    const row = await savePostProductLinks({
      businessId: post.tenant_id,
      platform: candidate.platform,
      postId: candidate.postId,
      mediaId: candidate.mediaId,
      productId: post.product_id,
      createdBy,
    });
    if (row) rows.push(row);
  }
  return rows;
};

const findBusinessIdForEntry = async ({ entryId }) => {
  const result = await db.query(
    `
    SELECT tenant_id
    FROM marketing_settings
    WHERE ($1::text IS NULL)
      OR page_id = $1::text
      OR instagram_account_id = $1::text
    ORDER BY CASE WHEN page_id = $1::text OR instagram_account_id = $1::text THEN 0 ELSE 1 END
    LIMIT 1
    `,
    [nullableString(entryId)]
  );
  return Number(result.rows[0]?.tenant_id || 1);
};

const extractWebhookEvents = async (payload = {}) => {
  const events = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      const value = change.value || {};
      const field = normalizeWebhookField(change.field);
      const object = trimString(payload.object).toLowerCase();
      const platform = object.includes("instagram") || field.includes("instagram") || value.media || value.media_id || value.from?.username ? "instagram" : "facebook";
      const item = normalizeWebhookField(value.item);
      const verb = normalizeWebhookField(value.verb || "add");
      const isRelevantField = COMMENT_WEBHOOK_FIELDS.has(field) || field.includes("comment");
      if (!(field === "feed" || isRelevantField) || item !== "comment" || !COMMENT_WEBHOOK_VERBS.has(verb)) continue;

      console.log("[COMMENT_WEBHOOK_HIT]", {
        platform,
        field,
        object,
        entry_id: entry.id || "",
      });

      const commentId = pickFirstText(
        value.comment_id,
        value.commentId,
        value.comment?.id,
        value.comment?.comment_id,
        value.id
      );
      const message = pickFirstText(value.message, value.text, value.comment?.message, value.comment?.text);
      if (!commentId || !message) continue;

      const postId = pickFirstText(value.post_id, value.postId, value.media_id, value.media?.id, value.post?.id);
      const mediaId = nullableString(value.media_id || value.media?.id || (platform === "instagram" ? postId : null));
      const pageId = pickFirstText(entry.id, value.page_id, value.metadata?.page_id, value.account_id);
      const fromId = pickFirstText(value.from?.id, value.sender_id, value.user_id);
      const fromName = pickFirstText(value.from?.name, value.sender_name, value.username, value.from?.username);

      console.log("[COMMENT_EVENT_PARSED]", {
        platform,
        page_id: pageId,
        post_id: postId,
        comment_id: commentId,
        from_id: fromId,
        text_length: message.length,
      });

      events.push({
        businessId: await findBusinessIdForEntry({ entryId: entry.id, platform }),
        platform,
        postId,
        mediaId,
        commentId,
        parentCommentId: pickFirstText(value.parent_id, value.parent_comment_id, value.parent?.id),
        userPlatformId: fromId,
        username: fromName,
        message,
        createdTime: pickFirstText(value.created_time, value.createdTime),
        rawPayload: { entry, change },
      });
    }
  }
  return events;
};

const resolveProductId = async ({ businessId, platform, postId, mediaId }) => {
  const result = await db.query(
    `
    SELECT product_id
    FROM marketing_post_product_links
    WHERE business_id = $1::bigint
      AND platform = $2::varchar
      AND (post_id = $3::text OR ($4::text IS NOT NULL AND media_id = $4::text))
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [businessId, platform, postId || "", mediaId || null]
  );
  return result.rows[0]?.product_id || null;
};

const upsertMarketingCommentEvent = async (normalized = {}) => {
  const result = await db.query(
    `
    INSERT INTO marketing_comment_events (
      business_id,
      platform,
      post_id,
      comment_id,
      parent_comment_id,
      user_platform_id,
      username,
      message,
      matched_rule_id,
      matched_keyword,
      product_id,
      status,
      lead_score,
      automation_actions,
      error_message,
      raw_payload,
      processed_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::bigint,$10::text,$11::bigint,$12::varchar,$13::varchar,$14::jsonb,$15::text,$16::jsonb,$17::timestamp)
    ON CONFLICT (platform, comment_id) DO UPDATE SET
      business_id = COALESCE(marketing_comment_events.business_id, EXCLUDED.business_id),
      post_id = COALESCE(NULLIF(EXCLUDED.post_id, ''), marketing_comment_events.post_id),
      parent_comment_id = COALESCE(NULLIF(EXCLUDED.parent_comment_id, ''), marketing_comment_events.parent_comment_id),
      user_platform_id = COALESCE(NULLIF(EXCLUDED.user_platform_id, ''), marketing_comment_events.user_platform_id),
      username = COALESCE(NULLIF(EXCLUDED.username, ''), marketing_comment_events.username),
      message = COALESCE(NULLIF(EXCLUDED.message, ''), marketing_comment_events.message),
      matched_rule_id = COALESCE(EXCLUDED.matched_rule_id, marketing_comment_events.matched_rule_id),
      matched_keyword = COALESCE(NULLIF(EXCLUDED.matched_keyword, ''), marketing_comment_events.matched_keyword),
      product_id = COALESCE(EXCLUDED.product_id, marketing_comment_events.product_id),
      status = COALESCE(NULLIF(EXCLUDED.status, ''), marketing_comment_events.status),
      lead_score = COALESCE(NULLIF(EXCLUDED.lead_score, ''), marketing_comment_events.lead_score),
      automation_actions = COALESCE(EXCLUDED.automation_actions, marketing_comment_events.automation_actions),
      error_message = COALESCE(NULLIF(EXCLUDED.error_message, ''), marketing_comment_events.error_message),
      raw_payload = COALESCE(marketing_comment_events.raw_payload, '{}'::jsonb) || COALESCE(EXCLUDED.raw_payload, '{}'::jsonb),
      processed_at = COALESCE(EXCLUDED.processed_at, marketing_comment_events.processed_at)
    RETURNING *
    `,
    [
      normalized.business_id,
      normalized.platform,
      normalized.post_id,
      normalized.comment_id,
      normalized.parent_comment_id,
      normalized.user_platform_id,
      normalized.username,
      normalized.message,
      normalized.matched_rule_id,
      normalized.matched_keyword,
      normalized.product_id,
      normalized.status,
      normalized.lead_score,
      JSON.stringify(normalized.automation_actions || {}),
      normalized.error_message || null,
      JSON.stringify(normalized.raw_payload || {}),
      normalized.processed_at || new Date().toISOString(),
    ]
  );
  return result.rows[0] || null;
};

const loadMatchingRule = async ({ businessId, platform, message }) => {
  const result = await db.query(
    `
    SELECT *
    FROM marketing_auto_reply_rules
    WHERE business_id = $1::bigint
      AND enabled = TRUE
      AND platform = $2::varchar
    ORDER BY created_at DESC
    `,
    [businessId, platform]
  );
  return result.rows.find((rule) => commentMatchesRule(rule, message)) || null;
};

const loadProductContext = async ({ businessId, productId }) => {
  if (!productId) return null;
  const productResult = await db.query(
    `
    SELECT p.*, b.name AS brand_name, COALESCE(cp.company_name, t.name) AS store_name
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN tenants t ON t.id = p.tenant_id
    LEFT JOIN company_profiles cp ON cp.tenant_id = p.tenant_id
    WHERE p.id = $1::bigint
      AND p.tenant_id = $2::bigint
    LIMIT 1
    `,
    [productId, businessId]
  );
  const product = productResult.rows[0];
  if (!product) return null;
  const variantsResult = await db.query(
    `
    SELECT color, size, stock, price, sale_price
    FROM product_variants
    WHERE product_id = $1::bigint
      AND tenant_id = $2::bigint
    ORDER BY id ASC
    `,
    [productId, businessId]
  );
  const variants = variantsResult.rows || [];
  const priceCandidates = [product.sale_price, product.price, ...variants.map((variant) => variant.sale_price || variant.price)]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const price = priceCandidates.length ? Math.min(...priceCandidates) : Number(product.price || 0);
  const totalStock = variants.length
    ? variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
    : Number(product.stock || 0);
  const available_variants = variants.filter((variant) => Number(variant.stock || 0) > 0);
  const variantLines = variants.length
    ? variants.map((variant) => {
        const parts = [variant.color, variant.size].map(trimString).filter(Boolean);
        const label = parts.length ? parts.join(" / ") : "Variant";
        const stock = Number(variant.stock || 0);
        return `${label}: ${stock > 0 ? `متاح (${stock})` : "غير متاح"}`;
      }).join("\n")
    : Number(product.stock || 0) > 0 ? `متاح (${product.stock})` : "يرجى تأكيد التوفر مع الفريق";
  return {
    product_name: product.name || "",
    price: String(price || ""),
    variants: variantLines,
    brand: product.brand_name || "",
    invoice_link: "",
    store_name: product.store_name || "",
    product_image: product.image_url || "",
    stock: totalStock,
    available_variants,
  };
};

const getNearestSizeSuggestion = (message = "", context = {}) => {
  const requestedSize = extractRequestedSize(message);
  if (!requestedSize || !Array.isArray(context.available_variants)) return "";
  const requested = normalizeCommentText(requestedSize);
  const exactAvailable = context.available_variants.some((variant) => normalizeCommentText(variant.size) === requested);
  if (exactAvailable) return "";
  const nearest = context.available_variants.find((variant) => trimString(variant.size));
  return nearest?.size ? `\n\nالمقاس المطلوب قد لا يكون متاح حاليًا. أقرب مقاس متاح: ${nearest.size}.` : "";
};

const buildPrivateMessage = ({ rule, context, message }) => {
  const baseTemplate = Number(context?.stock || 0) <= 0
    ? "أهلاً بحضرتك ❤️\nالموديل {{product_name}} غير متاح حاليًا.\nنقدر نقترح لحضرتك بدائل قريبة من نفس الستايل. تحب نرشح لك المتاح؟"
    : rule.private_reply_template || DEFAULT_PRIVATE_REPLY;
  return `${renderTemplate(baseTemplate, context)}${getNearestSizeSuggestion(message, context)}`;
};

const buildFallbackContext = (event = {}) => ({
  product_name: "the requested item",
  price: "",
  variants: "Please send us the size and color you want and we will confirm availability.",
  brand: "",
  invoice_link: "",
  store_name: "",
  product_image: "",
  stock: 1,
  available_variants: [],
  commenter_name: event.username || "Customer",
});

const REQUIRED_META_PERMISSIONS = {
  facebook: {
    liked: ["pages_manage_engagement", "pages_read_engagement"],
    public_reply: ["pages_manage_engagement", "pages_read_engagement"],
    private_reply: ["pages_manage_engagement", "pages_messaging"],
  },
  instagram: {
    liked: ["instagram_manage_comments", "pages_manage_engagement"],
    public_reply: ["instagram_manage_comments", "pages_manage_engagement"],
    private_reply: ["instagram_manage_comments", "pages_messaging"],
  },
};

const getGrantedPermissions = async (businessId) => {
  const settings = await getSettingsRow(businessId);
  const tokenState = validateMetaToken(settings || {});
  const appAccessToken = getMetaAppAccessToken();
  if (appAccessToken) {
    const payload = await callMetaGet({
      accessToken: appAccessToken,
      endpoint: "/debug_token",
      label: "debug_token_permissions",
      params: { input_token: tokenState.accessToken },
    });
    const scopes = [
      ...(Array.isArray(payload?.data?.scopes) ? payload.data.scopes : []),
      ...(Array.isArray(payload?.data?.granular_scopes) ? payload.data.granular_scopes.map((scope) => scope?.scope) : []),
    ];
    return new Set(scopes.map((scope) => trimString(scope)).filter(Boolean));
  }

  const payload = await callMetaGet({
    accessToken: tokenState.accessToken,
    endpoint: "/me/permissions",
    label: "permissions",
  });
  return new Set(
    (Array.isArray(payload?.data) ? payload.data : [])
      .filter((permission) => permission?.status === "granted")
      .map((permission) => trimString(permission.permission))
      .filter(Boolean)
  );
};

const validateMetaActionPermissions = async ({ businessId, platform, actions }) => {
  const requested = new Set();
  const required = REQUIRED_META_PERMISSIONS[platform] || REQUIRED_META_PERMISSIONS.facebook;
  Object.entries(actions || {}).forEach(([key, action]) => {
    if (action?.requested) (required[key] || []).forEach((permission) => requested.add(permission));
  });
  if (!requested.size) return { all: [], byAction: {} };

  const granted = await getGrantedPermissions(businessId);
  const missing = [...requested].filter((permission) => !granted.has(permission));
  if (missing.length) {
    console.warn("[meta-action] missing permissions", { platform, business_id: businessId, missing_permissions: missing });
  }
  const byAction = {};
  Object.entries(actions || {}).forEach(([key, action]) => {
    if (!action?.requested) return;
    byAction[key] = (required[key] || []).filter((permission) => !granted.has(permission));
  });
  return { all: missing, byAction };
};

const skippedAction = (reason = "not_requested") => ({ status: "skipped", reason });

const markSkippedForMissingPermissions = (actions, missingPermissions = {}, fallbackPermissions = []) => {
  Object.keys(actions).forEach((key) => {
    const missing = missingPermissions[key] || fallbackPermissions;
    if (!actions[key]?.requested || !missing.length) return;
    const message = `Missing Meta permissions: ${missing.join(", ")}`;
    actions[key] = { status: "error", error: message, missing_permissions: missing };
  });
};

const executeAction = async ({ actions, key, requestedLog, successLog, errorLog, run, logContext }) => {
  if (!actions[key]?.requested) {
    actions[key] = skippedAction();
    return null;
  }
  devLog(requestedLog, logContext);
  try {
    const response = await run();
    actions[key] = { status: "success", response };
    devLog(successLog, logContext);
    return null;
  } catch (error) {
    const message = error?.message || `${key} failed`;
    actions[key] = {
      status: "error",
      error: message,
      meta: error?.metaResponse || null,
    };
    console.error(errorLog, { ...logContext, message, meta: error?.metaResponse || null });
    return message;
  }
};

export const sendTrackedSocialCommentPrivateReply = async ({
  platform,
  commentId,
  message,
  businessId,
  callsite = "",
  postId = "",
  productContext = null,
} = {}) => {
  console.log("SOCIAL_COMMENT_PRIVATE_REPLY_CALLSITE", {
    callsite: trimString(callsite),
    comment_id: trimString(commentId),
    post_id: trimString(postId),
    has_product_context: Boolean(productContext?.found || productContext?.has_product_context),
    message_preview: trimString(message).slice(0, 280),
  });
  return sendPrivateReply(platform, commentId, message, businessId);
};

const buildPersistedActionResults = (actions = {}, errorMessage = null) => ({
  liked: actions.liked?.status || "skipped",
  public_reply: actions.public_reply?.status || "skipped",
  private_reply: actions.private_reply?.status || "skipped",
  error_message: errorMessage || actions.liked?.error || actions.public_reply?.error || actions.private_reply?.error || null,
  details: actions,
});

const upsertConversation = async ({ event, productId, matchedKeyword, leadScore }) => {
  const userPlatformId = event.userPlatformId || `comment:${event.commentId}`;
  await db.query(
    `
    INSERT INTO marketing_conversations (
      business_id,
      platform,
      user_platform_id,
      username,
      product_id,
      post_id,
      comment_id,
      status,
      last_message,
      last_customer_message,
      matched_keyword,
      lead_score
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,'new',$8,$8,$9,$10)
    ON CONFLICT (business_id, platform, user_platform_id)
    DO UPDATE SET
      username = COALESCE(EXCLUDED.username, marketing_conversations.username),
      product_id = COALESCE(EXCLUDED.product_id, marketing_conversations.product_id),
      post_id = COALESCE(EXCLUDED.post_id, marketing_conversations.post_id),
      comment_id = COALESCE(EXCLUDED.comment_id, marketing_conversations.comment_id),
      status = CASE
        WHEN marketing_conversations.status IN ('closed', 'converted') THEN marketing_conversations.status
        ELSE 'waiting_customer'
      END,
      last_message = EXCLUDED.last_message,
      last_customer_message = EXCLUDED.last_customer_message,
      matched_keyword = COALESCE(EXCLUDED.matched_keyword, marketing_conversations.matched_keyword),
      lead_score = EXCLUDED.lead_score,
      updated_at = CURRENT_TIMESTAMP
    `,
    [event.businessId, event.platform, userPlatformId, event.username, productId || null, event.postId || null, event.commentId, event.message, matchedKeyword || null, leadScore || "low"]
  );
};

export const processCommentEvent = async (event = {}) => {
  devLog("[meta-webhook] comment received", {
    platform: event.platform,
    tenant_id: event.businessId ?? null,
    post_id: event.postId,
    media_id: event.mediaId,
    comment_id: event.commentId,
    commenter_id: event.userPlatformId,
    commenter_name: event.username,
    text_length: String(event.message || "").length,
  });

  const inserted = await upsertMarketingCommentEvent({
    business_id: event.businessId,
    platform: event.platform,
    post_id: event.postId || "",
    comment_id: event.commentId,
    parent_comment_id: event.parentCommentId || "",
    user_platform_id: event.userPlatformId || "",
    username: event.username || "",
    message: event.message || "",
    matched_rule_id: null,
    matched_keyword: null,
    product_id: null,
    status: "processed",
    lead_score: "low",
    automation_actions: {},
    error_message: null,
    raw_payload: event.rawPayload || {},
    processed_at: event.createdTime || new Date().toISOString(),
  });
  console.log("[COMMENT_EVENT_SAVED]", {
    platform: inserted?.platform || event.platform,
    page_id: inserted?.raw_payload?.entry?.[0]?.id || inserted?.raw_payload?.entry?.id || inserted?.raw_payload?.entry?.changes?.[0]?.value?.page_id || "",
    post_id: inserted?.post_id || event.postId || "",
    comment_id: inserted?.comment_id || event.commentId || "",
    from_id: inserted?.user_platform_id || event.userPlatformId || "",
    text_length: String(inserted?.message || event.message || "").length,
  });

  let status = "processed";
  let errorMessage = null;
  let rule = null;
  let productId = null;
  let matchedKeyword = null;
  let leadScore = "low";
  const automationActions = {
    liked: skippedAction(),
    public_reply: skippedAction(),
    private_reply: skippedAction(),
  };

  try {
    productId = await resolveProductId(event);
    rule = await loadMatchingRule(event);
    if (rule) {
      devLog("[automation] rule matched", {
        platform: event.platform,
        comment_id: event.commentId,
        rule_id: rule.id,
      });
    } else {
      devLog("[automation] no rule matched", { platform: event.platform, comment_id: event.commentId });
    }
    matchedKeyword = rule ? getMatchedKeyword(rule, event.message) : null;
    leadScore = getLeadScore(event.message, Boolean(rule));
    await upsertConversation({ event, productId, matchedKeyword, leadScore });

    if (!rule) {
      status = "ignored";
    } else {
      const actionsRequested = {
        liked: { requested: Boolean(rule.like_comment) },
        public_reply: { requested: Boolean(rule.reply_publicly) },
        private_reply: { requested: Boolean(rule.send_private_reply) },
      };
      Object.assign(automationActions, actionsRequested);
      const logContext = {
        platform: event.platform,
        comment_id: event.commentId,
        rule_id: rule.id,
        product_id: productId || null,
      };

      let context = null;
      if (productId) {
        context = await loadProductContext({ businessId: event.businessId, productId });
      }
      if (!context) {
        devLog("[automation] product missing", logContext);
        context = buildFallbackContext(event);
        status = "manual_follow_up";
      } else {
        devLog("[automation] product linked", logContext);
      }

      let actionErrors = [];
      try {
        const missingPermissions = await validateMetaActionPermissions({
          businessId: event.businessId,
          platform: event.platform,
          actions: automationActions,
        });
        markSkippedForMissingPermissions(automationActions, missingPermissions.byAction);
        if (missingPermissions.all.length) {
          actionErrors.push(`Missing Meta permissions: ${missingPermissions.all.join(", ")}`);
        }
      } catch (error) {
        const message = error?.message || "Meta token permission validation failed";
        console.error("[meta-action] permission validation error", { ...logContext, message, meta: error?.metaResponse || null });
        markSkippedForMissingPermissions(automationActions, {}, [message]);
        actionErrors.push(message);
      }

      if (automationActions.liked?.status !== "error") {
        const error = await executeAction({
          actions: automationActions,
          key: "liked",
          requestedLog: "[automation] like requested",
          successLog: "[meta-action] like success",
          errorLog: "[meta-action] like error",
          logContext,
          run: () => likeComment(event.platform, event.commentId, event.businessId),
        });
        if (error) actionErrors.push(error);
      }

      if (automationActions.public_reply?.status !== "error") {
        const publicMessage = renderTemplate(rule.public_reply_template || DEFAULT_PUBLIC_REPLY, context);
        const error = await executeAction({
          actions: automationActions,
          key: "public_reply",
          requestedLog: "[automation] public reply requested",
          successLog: "[meta-action] public reply success",
          errorLog: "[meta-action] public reply error",
          logContext,
          run: () => replyToComment(event.platform, event.commentId, publicMessage, event.businessId),
        });
        if (error) actionErrors.push(error);
      }

      if (automationActions.private_reply?.status !== "error") {
        const privateMessage = buildPrivateMessage({ rule, context, message: event.message });
        const error = await executeAction({
          actions: automationActions,
          key: "private_reply",
          requestedLog: "[automation] private reply requested",
          successLog: "[meta-action] private reply success",
          errorLog: "[meta-action] private reply error",
          logContext,
          run: () => sendTrackedSocialCommentPrivateReply({
            platform: event.platform,
            commentId: event.commentId,
            message: privateMessage,
            businessId: event.businessId,
            callsite: "marketingCommentAutomationService.executeAutomationRule.private_reply",
            postId: event.postId || event.mediaId || "",
            productContext: context?.product ? { has_product_context: true } : null,
          }),
        });
        if (error) actionErrors.push(error);
      }

      if (actionErrors.length) {
        status = "failed";
        errorMessage = actionErrors.join("; ");
      }
    }
  } catch (error) {
    status = "failed";
    errorMessage = error?.message || "Comment automation failed";
    console.error("[marketing-auto-reply] processing error", {
      comment_id: event.commentId,
      platform: event.platform,
      message: errorMessage,
      meta: error?.metaResponse || null,
    });
  }

  await db.query(
    `
    UPDATE marketing_comment_events
    SET matched_rule_id = $1::bigint,
        matched_keyword = $2::text,
        product_id = $3::bigint,
        status = $4::varchar,
        lead_score = $5::varchar,
        automation_actions = $6::jsonb,
        error_message = $7::text,
        processed_at = CURRENT_TIMESTAMP
    WHERE platform = $8::varchar
      AND comment_id = $9::text
    `,
    [rule?.id || null, matchedKeyword, productId || null, status, leadScore, JSON.stringify(buildPersistedActionResults(automationActions, errorMessage)), errorMessage, event.platform, event.commentId]
  );

  return { status, errorMessage };
};

export const processMetaWebhookPayload = async (payload = {}) => {
  const events = await extractWebhookEvents(payload);
  let processed = 0;
  let skipped = 0;
  for (const event of events) {
    const result = await processCommentEvent(event);
    if (result?.skipped) skipped += 1;
    else processed += 1;
  }
  return { received: events.length, processed, skipped };
};

export const recordMetaWebhookRequest = async ({ payload = {} } = {}) => {
  const object = trimString(payload.object).toLowerCase();
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const entriesCount = entries.length;
  const entryId = entries[0]?.id || "";
  const businessId = await findBusinessIdForEntry({ entryId });
  await recordMarketingWebhookRequest({ businessId, object, entriesCount });
  return { businessId, object, entriesCount };
};

export const getMetaWebhookStatus = async (businessId) => {
  const defaults = buildMetaWebhookStatusDefaults();
  try {
    const result = await db.query(
      `
      SELECT created_at, raw_payload
      FROM marketing_comment_events
      WHERE business_id = $1::bigint
        AND platform IN ('facebook', 'instagram')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [businessId || 1]
    );
    const latest = result.rows[0] || null;
    return {
      ...defaults,
      last_event_at: latest?.created_at || null,
      recent_payload_preview: latest?.raw_payload || null,
      comments_delivery_mode: defaults.subscribed_fields.includes("feed") ? "facebook_feed" : "webhook",
      comments_delivery_ready: defaults.subscribed_fields.includes("feed"),
    };
  } catch (error) {
    console.warn("[meta-webhook] status defaults returned", { message: error?.message });
    return defaults;
  }
};

export const getAutoReplyRules = async (businessId) => {
  const result = await db.query(
    `
    SELECT *
    FROM marketing_auto_reply_rules
    WHERE business_id = $1::bigint
    ORDER BY enabled DESC, created_at DESC
    `,
    [businessId]
  );
  return result.rows;
};

export const createAutoReplyRule = async (businessId, payload = {}) => {
  const result = await db.query(
    `
    INSERT INTO marketing_auto_reply_rules (
      business_id,
      branch_id,
      platform,
      enabled,
      name,
      keywords,
      match_mode,
      public_reply_template,
      private_reply_template,
      like_comment,
      reply_publicly,
      send_private_reply
    )
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)
    RETURNING *
    `,
    [
      businessId,
      payload.branch_id || null,
      payload.platform || "facebook",
      payload.enabled !== false,
      nullableString(payload.name) || "Auto reply rule",
      JSON.stringify(normalizeKeywords(payload.keywords?.length ? payload.keywords : DEFAULT_KEYWORDS)),
      payload.match_mode || "any",
      nullableString(payload.public_reply_template) || DEFAULT_PUBLIC_REPLY,
      nullableString(payload.private_reply_template) || DEFAULT_PRIVATE_REPLY,
      payload.like_comment !== false,
      payload.reply_publicly !== false,
      payload.send_private_reply !== false,
    ]
  );
  return result.rows[0];
};

export const updateAutoReplyRule = async (businessId, id, payload = {}) => {
  const result = await db.query(
    `
    UPDATE marketing_auto_reply_rules
    SET branch_id = $1::bigint,
        platform = $2::varchar,
        enabled = $3::boolean,
        name = $4::varchar,
        keywords = $5::jsonb,
        match_mode = $6::varchar,
        public_reply_template = $7::text,
        private_reply_template = $8::text,
        like_comment = $9::boolean,
        reply_publicly = $10::boolean,
        send_private_reply = $11::boolean,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $12::bigint
      AND business_id = $13::bigint
    RETURNING *
    `,
    [
      payload.branch_id || null,
      payload.platform || "facebook",
      payload.enabled !== false,
      nullableString(payload.name) || "Auto reply rule",
      JSON.stringify(normalizeKeywords(payload.keywords)),
      payload.match_mode || "any",
      nullableString(payload.public_reply_template) || DEFAULT_PUBLIC_REPLY,
      nullableString(payload.private_reply_template) || DEFAULT_PRIVATE_REPLY,
      payload.like_comment !== false,
      payload.reply_publicly !== false,
      payload.send_private_reply !== false,
      id,
      businessId,
    ]
  );
  return result.rows[0] || null;
};

export const deleteAutoReplyRule = async (businessId, id) => {
  const result = await db.query(
    `
    DELETE FROM marketing_auto_reply_rules
    WHERE id = $1::bigint
      AND business_id = $2::bigint
    RETURNING id
    `,
    [id, businessId]
  );
  return result.rows[0] || null;
};

export const simulateCommentAutomation = async (businessId, payload = {}) => {
  if (payload.webhook_mode === "facebook_feed" || payload.use_webhook_payload === true) {
    const webhookPayload = {
      object: "page",
      entry: [
        {
          id: nullableString(payload.page_id) || "1234567890",
          time: Date.now(),
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                post_id: nullableString(payload.post_id) || "9876543210",
                comment_id: nullableString(payload.comment_id) || `sim_${Date.now()}`,
                parent_id: nullableString(payload.parent_id) || undefined,
                from: {
                  id: nullableString(payload.user_platform_id) || `sim-user-${Date.now()}`,
                  name: nullableString(payload.username) || "Simulated Customer",
                },
                message: nullableString(payload.message) || "عايز المقاس متاح؟",
                created_time: nullableString(payload.created_time) || new Date().toISOString(),
              },
            },
          ],
        },
      ],
    };
    const result = await processMetaWebhookPayload(webhookPayload);
    return {
      webhook_payload: webhookPayload,
      result,
      conversation_status: "saved",
    };
  }
  const event = {
    businessId,
    platform: nullableString(payload.platform) || "facebook",
    postId: nullableString(payload.post_id) || "simulated-post",
    mediaId: nullableString(payload.media_id),
    commentId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    parentCommentId: null,
    userPlatformId: nullableString(payload.user_platform_id) || `sim-user-${Date.now()}`,
    username: nullableString(payload.username) || "Simulated Customer",
    message: nullableString(payload.message) || "",
    rawPayload: { simulated: true, payload },
  };

  const productId = await resolveProductId(event);
  const rule = await loadMatchingRule(event);
  const matchedKeyword = rule ? getMatchedKeyword(rule, event.message) : null;
  const leadScore = getLeadScore(event.message, Boolean(rule));
  const status = rule ? "simulated" : "ignored";
  const automationActions = {
    liked: rule?.like_comment ? "success" : "skipped",
    public_reply: rule?.reply_publicly ? "success" : "skipped",
    private_reply: rule?.send_private_reply ? "success" : "skipped",
    error_message: null,
    details: { simulated: true },
  };

  await upsertConversation({ event, productId, matchedKeyword, leadScore });

  const inserted = await db.query(
    `
    INSERT INTO marketing_comment_events (
      business_id,
      platform,
      post_id,
      comment_id,
      parent_comment_id,
      user_platform_id,
      username,
      message,
      matched_rule_id,
      matched_keyword,
      product_id,
      status,
      lead_score,
      automation_actions,
      raw_payload,
      processed_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,CURRENT_TIMESTAMP)
    RETURNING *
    `,
    [
      event.businessId,
      event.platform,
      event.postId,
      event.commentId,
      event.parentCommentId,
      event.userPlatformId,
      event.username,
      event.message,
      rule?.id || null,
      matchedKeyword,
      productId || null,
      status,
      leadScore,
      JSON.stringify(automationActions),
      JSON.stringify(event.rawPayload),
    ]
  );

  return {
    event: inserted.rows[0],
    matched_rule: rule || null,
    conversation_status: "saved",
  };
};

export const getCommentEvents = async (businessId) => {
  const result = await db.query(
    `
    SELECT e.*, p.name AS product_name, p.image_url AS product_image, r.name AS rule_name
    FROM marketing_comment_events e
    LEFT JOIN products p ON p.id = e.product_id
    LEFT JOIN marketing_auto_reply_rules r ON r.id = e.matched_rule_id
    WHERE e.business_id = $1::bigint
    ORDER BY e.created_at DESC
    LIMIT 50
    `,
    [businessId]
  );
  return result.rows;
};

export const getMarketingConversations = async (businessId) => {
  const result = await db.query(
    `
    SELECT c.*, p.name AS product_name, p.image_url AS product_image
    FROM marketing_conversations c
    LEFT JOIN products p ON p.id = c.product_id
    WHERE c.business_id = $1::bigint
    ORDER BY c.updated_at DESC
    LIMIT 50
    `,
    [businessId]
  );
  return result.rows;
};

import db from "../database/db.js";
import { getPublishingAccessToken, validateMetaToken } from "./metaTokenService.js";

const GRAPH_API_VERSION = "v19.0";
const GRAPH_API_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

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

const maskSecretStatus = (value) => Boolean(trimString(value));

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
    subscribed_fields: ["comments", "feed", "instagram_manage_comments"],
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
  return callMetaPost({
    businessId,
    endpoint: `/${encodeURIComponent(commentId)}/private_replies`,
    label: "private reply",
    params: { message: trimString(message) },
  });
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
      const field = trimString(change.field).toLowerCase();
      const object = trimString(payload.object).toLowerCase();
      const platform = object.includes("instagram") || field.includes("instagram") || value.media || value.media_id || value.from?.username ? "instagram" : "facebook";
      const isComment = field.includes("comment") || value.item === "comment" || value.comment_id || value.id;
      const verb = trimString(value.verb || "add").toLowerCase();
      if (!isComment || (verb && !["add", "created"].includes(verb))) continue;

      const commentId = nullableString(value.comment_id || value.id);
      const message = nullableString(value.message || value.text) || "";
      if (!commentId || !message) continue;

      const postId = nullableString(value.post_id || value.media_id || value.media?.id || value.parent_id) || "";
      const mediaId = nullableString(value.media_id || value.media?.id || (platform === "instagram" ? postId : null));

      events.push({
        businessId: await findBusinessIdForEntry({ entryId: entry.id, platform }),
        platform,
        postId,
        mediaId,
        commentId,
        parentCommentId: nullableString(value.parent_id || value.parent_comment_id),
        userPlatformId: nullableString(value.from?.id || value.sender_id || value.user_id),
        username: nullableString(value.from?.name || value.from?.username || value.username),
        message,
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
    post_id: event.postId,
    media_id: event.mediaId,
    comment_id: event.commentId,
    commenter_id: event.userPlatformId,
    commenter_name: event.username,
  });

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
      raw_payload
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    ON CONFLICT (platform, comment_id) DO NOTHING
    RETURNING *
    `,
    [
      event.businessId,
      event.platform,
      event.postId || "",
      event.commentId,
      event.parentCommentId,
      event.userPlatformId,
      event.username,
      event.message || "",
      JSON.stringify(event.rawPayload || {}),
    ]
  );
  if (!inserted.rows[0]) {
    devLog("[meta-webhook] duplicate skipped", { platform: event.platform, comment_id: event.commentId });
    return { skipped: true, reason: "duplicate_comment" };
  }

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
          run: () => sendPrivateReply(event.platform, event.commentId, privateMessage, event.businessId),
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

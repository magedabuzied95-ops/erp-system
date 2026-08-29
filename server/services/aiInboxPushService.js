import webPush from "web-push";
import db from "../database/db.js";
import { ensurePortalPushSchema } from "./managerPortalPushService.js";

// Web push for the AI Inbox. Both surfaces (`/admin/ai-inbox` on desktop and the
// `/inbox` PWA on mobile) register ONE root-scope worker, `ai-inbox-push-sw.js`,
// so a browser holds a single subscription no matter which surface opened it.
// Subscriptions live in `portal_push_subscriptions` under portal_type 'ai_inbox',
// keyed on the ERP user rather than a portal token — inbox users are authenticated
// staff, not token-bearing portal visitors.

const PORTAL_TYPE = "ai_inbox";
const DEFAULT_FRONTEND_ORIGIN = "https://erp-system-ten-green.vercel.app";

const text = (value = "") => String(value ?? "").trim();
const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const jsonObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const vapidPublicKey = () => text(process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY);
const vapidPrivateKey = () => text(process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY);
const webPushSubject = () =>
  text(
    process.env.VAPID_SUBJECT ||
      process.env.WEB_PUSH_SUBJECT ||
      process.env.PUBLIC_FRONTEND_URL ||
      process.env.FRONTEND_URL ||
      DEFAULT_FRONTEND_ORIGIN
  ).replace(/\/+$/, "");

const hasVapidConfig = () => Boolean(vapidPublicKey() && vapidPrivateKey() && webPushSubject());

const endpointHost = (endpoint = "") => {
  try {
    return new URL(text(endpoint)).host;
  } catch {
    return "";
  }
};
const endpointPrefix = (endpoint = "", length = 64) => text(endpoint).slice(0, length);

const configureWebPush = () => {
  if (!hasVapidConfig()) return false;
  try {
    webPush.setVapidDetails(webPushSubject(), vapidPublicKey(), vapidPrivateKey());
    return true;
  } catch (error) {
    console.warn("[ai-inbox-push:vapid-invalid]", {
      message: error?.message || String(error),
      hasPublicKey: Boolean(vapidPublicKey()),
      hasPrivateKey: Boolean(vapidPrivateKey()),
      hasSubject: Boolean(webPushSubject()),
    });
    return false;
  }
};

export const getAiInboxPushPublicKey = async () => {
  await ensurePortalPushSchema(db);
  return { publicKey: vapidPublicKey(), enabled: hasVapidConfig() };
};

export const subscribeAiInboxPush = async ({ user = {}, subscription = {}, userAgent = "", surface = "" } = {}) => {
  await ensurePortalPushSchema(db);
  const endpoint = text(subscription.endpoint);
  const keys = jsonObject(subscription.keys);
  const p256dh = text(keys.p256dh);
  const auth = text(keys.auth);
  if (!endpoint || !p256dh || !auth) {
    const error = new Error("Invalid push subscription");
    error.status = 400;
    throw error;
  }
  const userId = numberOrNull(user.id);
  if (!userId) {
    const error = new Error("Missing user context");
    error.status = 401;
    throw error;
  }
  // `portal_url` records which surface subscribed so notificationclick can reopen
  // the right one — the PWA and the desktop page are different destinations.
  const resolvedSurface = text(surface).startsWith("/admin") ? "/admin/ai-inbox" : "/inbox";
  const result = await db.query(
    `
    INSERT INTO portal_push_subscriptions (
      portal_type, portal_token, manager_employee_id, user_id, tenant_id, branch_id,
      endpoint, p256dh, auth, user_agent, portal_url, revoked_at, created_at, updated_at, last_seen_at
    )
    VALUES ($1, '', NULL, $2, $3, $4, $5, $6, $7, $8, $9, NULL, NOW(), NOW(), NOW())
    ON CONFLICT (portal_type, endpoint)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      tenant_id = EXCLUDED.tenant_id,
      branch_id = EXCLUDED.branch_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      user_agent = EXCLUDED.user_agent,
      portal_url = EXCLUDED.portal_url,
      revoked_at = NULL,
      updated_at = NOW(),
      last_seen_at = NOW()
    RETURNING id, endpoint, portal_url, created_at, updated_at, last_seen_at
    `,
    [
      PORTAL_TYPE,
      userId,
      numberOrNull(user.tenant_id ?? user.tenantId),
      numberOrNull(user.branch_id ?? user.branchId),
      endpoint,
      p256dh,
      auth,
      text(userAgent).slice(0, 1000),
      resolvedSurface,
    ]
  );
  const row = result.rows[0] || null;
  console.info("[ai-inbox-push:db-saved]", {
    subscription_id: row?.id || null,
    user_id: userId,
    tenant_id: numberOrNull(user.tenant_id ?? user.tenantId),
    surface: resolvedSurface,
    endpoint_host: endpointHost(endpoint),
    endpoint_prefix: endpointPrefix(endpoint),
  });
  return { subscription: row, endpoint_host: endpointHost(endpoint) };
};

export const unsubscribeAiInboxPush = async ({ user = {}, endpoint = "" } = {}) => {
  await ensurePortalPushSchema(db);
  const userId = numberOrNull(user.id);
  if (!userId) return { count: 0, subscriptions: [] };
  const safeEndpoint = text(endpoint);
  const params = [PORTAL_TYPE, userId];
  let endpointClause = "";
  if (safeEndpoint) {
    params.push(safeEndpoint);
    endpointClause = `AND endpoint = $${params.length}`;
  }
  const result = await db.query(
    `
    UPDATE portal_push_subscriptions
    SET revoked_at = COALESCE(revoked_at, NOW()),
        updated_at = NOW(),
        last_seen_at = NOW()
    WHERE portal_type = $1
      AND user_id = $2
      ${endpointClause}
    RETURNING id, endpoint, revoked_at
    `,
    params
  );
  console.info("[ai-inbox-push:unsubscribed]", { user_id: userId, count: result.rowCount || 0, scoped: Boolean(safeEndpoint) });
  return { count: result.rowCount || 0, subscriptions: result.rows };
};

export const getAiInboxPushStatus = async ({ user = {} } = {}) => {
  await ensurePortalPushSchema(db);
  const userId = numberOrNull(user.id);
  if (!userId) return { active_count: 0, subscriptions: [], vapid_configured: hasVapidConfig() };
  const result = await db.query(
    `
    SELECT id, endpoint, portal_url, user_agent, revoked_at, created_at, updated_at, last_seen_at
    FROM portal_push_subscriptions
    WHERE portal_type = $1 AND user_id = $2
    ORDER BY revoked_at NULLS FIRST, last_seen_at DESC, id DESC
    LIMIT 50
    `,
    [PORTAL_TYPE, userId]
  );
  const subscriptions = result.rows.map((row) => ({
    id: row.id,
    endpoint_host: endpointHost(row.endpoint),
    endpoint_prefix: endpointPrefix(row.endpoint),
    surface: row.portal_url,
    user_agent: row.user_agent,
    revoked_at: row.revoked_at,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
  }));
  return {
    active_count: subscriptions.filter((row) => !row.revoked_at).length,
    subscriptions,
    vapid_configured: hasVapidConfig(),
  };
};

// web-push validates the `Topic` header as URL-safe base64 and throws before it
// ever sends. Our notification tags embed the conversation id, and those carry a
// colon (`whatsapp:201024960585`, `facebook_messenger:987...`) — passing the tag
// through raw makes EVERY push fail with "Unsupported characters set". The tag
// itself keeps the colon (the worker groups notifications by it); only the header
// is folded down to the charset the push services accept.
export const pushTopic = (tag = "") => {
  const safe = text(tag).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32);
  return safe || undefined;
};

const deactivateSubscription = async (id, statusCode = 0, reason = "") => {
  await db.query(
    `
    UPDATE portal_push_subscriptions
    SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW(), last_seen_at = NOW()
    WHERE id = $1
    `,
    [id]
  );
  console.warn("[ai-inbox-push:subscription-revoked]", { subscriptionId: id, statusCode, reason });
};

const loadInboxSubscriptions = async ({ tenantId = null, excludeUserId = null } = {}) => {
  await ensurePortalPushSchema(db);
  const result = await db.query(
    `
    SELECT s.id AS subscription_id, s.endpoint, s.p256dh, s.auth, s.user_id, s.portal_url
    FROM portal_push_subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.portal_type = $1
      AND s.revoked_at IS NULL
      AND ($2::bigint IS NULL OR s.tenant_id = $2::bigint OR u.tenant_id = $2::bigint)
      AND COALESCE(u.is_active, TRUE) = TRUE
      AND ($3::bigint IS NULL OR s.user_id <> $3::bigint)
    ORDER BY s.last_seen_at DESC
    LIMIT 200
    `,
    [PORTAL_TYPE, tenantId, excludeUserId]
  );
  return result.rows;
};

const sendToInboxSubscriptions = async ({ tenantId = null, excludeUserId = null, buildPayload } = {}) => {
  if (!configureWebPush()) {
    console.warn("[ai-inbox-push:vapid-missing]", {
      tenantId,
      hasPublicKey: Boolean(vapidPublicKey()),
      hasPrivateKey: Boolean(vapidPrivateKey()),
      hasSubject: Boolean(webPushSubject()),
    });
    return { sent: 0, failed: 0, deactivated: 0, skipped: true };
  }
  const rows = await loadInboxSubscriptions({ tenantId, excludeUserId });
  if (!rows.length) return { sent: 0, failed: 0, deactivated: 0, skipped: false };

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  for (const row of rows) {
    const payloadObject = buildPayload?.(row) || {};
    const payload = JSON.stringify({
      icon: "/icons/employee-portal-192.png",
      badge: "/icons/employee-portal-192.png",
      renotify: true,
      ...payloadObject,
      data: {
        ...(payloadObject.data || {}),
        url: payloadObject.data?.url || payloadObject.url || row.portal_url || "/inbox",
        tag: payloadObject.data?.tag || payloadObject.tag || "ai-inbox",
      },
    });
    try {
      const sendOptions = { TTL: 60 * 60 };
      // Apple's push service rejects the `topic` header shape the others accept.
      if (endpointHost(row.endpoint) !== "web.push.apple.com") {
        sendOptions.topic = pushTopic(payloadObject.tag || payloadObject.data?.tag);
      }
      await webPush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        sendOptions
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = Number(error.statusCode || error.status || 0);
      console.warn("[ai-inbox-push:send-failed]", {
        subscriptionId: row.subscription_id,
        user_id: row.user_id,
        statusCode,
        message: error?.message || String(error),
        endpointHost: endpointHost(row.endpoint),
      });
      if ([400, 404, 410].includes(statusCode)) {
        deactivated += 1;
        await deactivateSubscription(row.subscription_id, statusCode, `web-push ${statusCode}`);
      }
    }
  }
  console.info("[ai-inbox-push:send-summary]", { tenantId, recipients: rows.length, sent, failed, deactivated });
  return { sent, failed, deactivated, skipped: false };
};

export const sendAiInboxTestPush = async ({ user = {} } = {}) => {
  const userId = numberOrNull(user.id);
  return sendToInboxSubscriptions({
    tenantId: numberOrNull(user.tenant_id ?? user.tenantId),
    // A test must reach the tester, so nobody is excluded here.
    excludeUserId: null,
    buildPayload: (row) =>
      row.user_id === userId
        ? {
            title: "اختبار إشعارات الإنبوكس",
            body: "لو وصلك الإشعار ده يبقى البوش شغال تمام",
            tag: "ai-inbox-test",
            data: { type: "ai_inbox_test", url: row.portal_url || "/inbox" },
          }
        : null,
  });
};

const CHANNEL_LABELS = {
  whatsapp: "واتساب",
  facebook: "ماسنجر",
  facebook_messenger: "ماسنجر",
  messenger: "ماسنجر",
  instagram: "إنستجرام",
  telegram: "تليجرام",
  web_chat: "شات الموقع",
  webchat: "شات الموقع",
};

const channelLabel = (channel = "") => CHANNEL_LABELS[text(channel).toLowerCase()] || "";

const messagePreview = (message = {}) => {
  const body = text(message.customer_message || message.message_text || message.body || message.text);
  if (body) return body.slice(0, 140);
  const type = text(message.message_type || message.attachment_type || message.media_type).toLowerCase();
  const mime = text(message.attachment_mime || message.mime_type).toLowerCase();
  if (type.includes("image") || mime.startsWith("image/")) return "📷 صورة";
  if (type.includes("voice") || type.includes("audio") || mime.startsWith("audio/")) return "🎤 رسالة صوتية";
  if (type.includes("video") || mime.startsWith("video/")) return "🎬 فيديو";
  if (type.includes("location")) return "📍 موقع";
  if (type === "product_card") return "🛍️ كارت منتج";
  if (type) return "📎 مرفق";
  return "رسالة جديدة";
};

// The AI Inbox files both directions of a conversation through the same socket
// event, so "a message arrived" has to mean an INBOUND customer message. Pushing
// our own AI/staff replies back at the operator would fire on every outbound send.
export const isInboundCustomerMessage = (message = {}) => {
  if (!message || typeof message !== "object") return false;
  const senderType = text(message.sender_type).toLowerCase();
  if (senderType === "staff" || senderType === "ai" || senderType === "agent" || senderType === "system") return false;
  if (message.is_echo === true || message.echo === true) return false;
  if (senderType === "customer") return true;
  // No sender_type at all: fall back to the field that only inbound rows carry.
  return Boolean(text(message.customer_message));
};

// A message can reach the socket twice (live webhook + a sync pass replaying it).
// A short-lived key set keeps the operator from getting the same buzz twice.
const recentPushKeys = new Map();
const RECENT_PUSH_TTL_MS = 5 * 60 * 1000;
const RECENT_PUSH_MAX = 2000;

const alreadyPushed = (key = "") => {
  if (!key) return false;
  const now = Date.now();
  if (recentPushKeys.size > RECENT_PUSH_MAX) {
    for (const [existingKey, expiry] of recentPushKeys) {
      if (expiry <= now) recentPushKeys.delete(existingKey);
    }
  }
  const expiry = recentPushKeys.get(key);
  if (expiry && expiry > now) return true;
  recentPushKeys.set(key, now + RECENT_PUSH_TTL_MS);
  return false;
};

export const notifyAiInboxInboundMessage = async ({ tenantId = null, sessionId = "", message = {}, channel = "" } = {}) => {
  if (!isInboundCustomerMessage(message)) return { sent: 0, skipped: true, reason: "not-inbound" };
  const resolvedTenantId = numberOrNull(tenantId);
  const resolvedChannel = text(channel || message.channel || message.source);
  const dedupeKey = [
    resolvedTenantId || "",
    text(message.id || message.dedupe_key || message.external_message_id || message.provider_message_id),
    text(sessionId),
  ].join("|");
  if (!text(message.id || message.dedupe_key || message.external_message_id || message.provider_message_id)) {
    return { sent: 0, skipped: true, reason: "no-message-identity" };
  }
  if (alreadyPushed(dedupeKey)) return { sent: 0, skipped: true, reason: "duplicate" };

  const customerName = text(message.customer_name || message.sender_name || message.contact_name) || "عميل";
  const label = channelLabel(resolvedChannel);
  const title = label ? `${customerName} · ${label}` : customerName;
  const body = messagePreview(message);
  const conversationId = text(sessionId || message.session_id || message.conversation_id);

  return sendToInboxSubscriptions({
    tenantId: resolvedTenantId,
    excludeUserId: null,
    buildPayload: (row) => {
      const base = text(row.portal_url) || "/inbox";
      const url = conversationId
        ? base === "/admin/ai-inbox"
          ? `/admin/ai-inbox?conversation=${encodeURIComponent(conversationId)}`
          : `/inbox/${encodeURIComponent(conversationId)}`
        : base;
      return {
        title,
        body,
        // One tag per conversation: a burst from the same customer collapses into
        // one notification instead of stacking a wall of them.
        tag: `ai-inbox-${conversationId || "message"}`,
        data: {
          type: "ai_inbox_message",
          conversation_id: conversationId,
          message_id: text(message.id || ""),
          channel: resolvedChannel,
          customer_name: customerName,
          url,
        },
      };
    },
  });
};

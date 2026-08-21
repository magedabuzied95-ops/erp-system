import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import db from "../../database/db.js";
import { getSetting, setSetting } from "../../services/settingsService.js";
import { ensureWhatsappShippingSchema, sendShipmentCreated, sendShipmentNotificationForStatus } from "../../services/whatsappShippingService.js";
import { getPublicBackendUrl } from "../../utils/publicUrl.js";
import { createBostaClient } from "./providers/bosta.client.js";
import { bostaStateText, buildBostaAddressLine, mapOrderToBostaDeliveryPayload, normalizeBostaAwbResponse, normalizeBostaDeliveryResponse, normalizeBostaMasterLocations, normalizeBostaStatus } from "./providers/bosta.mapper.js";

const text = (value = "") => String(value ?? "").trim();
const nowIso = () => new Date().toISOString();
const normalizeKey = (value = "") => text(value).toLowerCase().replace(/[\s-]+/g, "_");
let shippingSchemaEnsured = false;
let shippingSchemaEnsurePromise = null;

const BOSTA_SUBSCRIPTION_REQUIRED_MESSAGE = "حساب بوسطة متصل بنجاح، لكن يلزم تفعيل باقة شحن لإنشاء الشحنات.";
const BOSTA_NOT_CONFIGURED_MESSAGE = "لم يتم إنشاء أي شحنة على بوسطة: مفتاح الـ API غير مضبوط. أضفه من إعدادات الشحن ثم أعد المحاولة.";
const BOSTA_DISABLED_MESSAGE = "تكامل بوسطة معطّل في إعدادات الشحن. فعّله أولاً قبل إنشاء الشحنات.";
const BOSTA_NO_LABEL_MESSAGE = "مفيش شحنة على بوسطة للطلبات المختارة، فمافيش ملصق يتطبع. أنشئ الشحنة الأول ثم اطبع الملصق.";
const BOSTA_ZERO_COLLECTION_MESSAGE = "الطلب لسه عليه مبلغ متبقّي، لكن طريقة الدفع مسجّلة كمدفوعة مسبقاً — فالشحنة هتروح لبوسطة بتحصيل صفر. صحّح بيانات الدفع أو اكتب مبلغ التحصيل في تبويب التكاليف قبل إنشاء الشحنة.";
const BOSTA_SHIPMENT_EXISTS_MESSAGE = "الطلب ده عنده شحنة قايمة على بوسطة بالفعل. إنشاء شحنة تانية مش بيعدّل القديمة — بوسطة بتطلّع طرد جديد مستقل، والمندوب يبقى معاه اتنين. لو عايز تعيد إنشاءها، ألغِ الشحنة الحالية الأول.";

// Turning the integration off has to actually stop new deliveries, otherwise the
// toggle is decoration. Refresh and cancel stay open on purpose: shipments already
// with the courier still need tracking and cancelling after the switch is flipped.
const bostaDisabledError = () => {
  const error = new Error(BOSTA_DISABLED_MESSAGE);
  error.status = 409;
  error.code = "BOSTA_DISABLED";
  return error;
};

// A shipment that never reached Bosta must never look like one that did. This used
// to write a `manual-bosta-<id>` number and report success, so an order could sit
// in the ERP as "shipment created" while the courier had never heard of it.
const bostaNotConfiguredError = (reason = "bosta_credentials_missing") => {
  const error = new Error(BOSTA_NOT_CONFIGURED_MESSAGE);
  error.status = 409;
  error.code = "BOSTA_NOT_CONFIGURED";
  error.payload = { reason };
  return error;
};

const bostaErrorCode = (payload = {}) => {
  const nestedError = payload?.error && typeof payload.error === "object" ? payload.error : {};
  return text(payload?.errorCode || payload?.code || nestedError?.errorCode || nestedError?.code);
};

const bostaErrorMessage = (payload = {}, fallback = "") => {
  const nestedError = payload?.error && typeof payload.error === "object" ? payload.error : {};
  return text(payload?.message || nestedError?.message || (typeof payload?.error === "string" ? payload.error : "") || fallback);
};

const isBostaSubscriptionRequiredError = (payload = {}, fallbackMessage = "") => {
  const code = bostaErrorCode(payload);
  const message = bostaErrorMessage(payload, fallbackMessage).toLowerCase();
  return code === "8000002" && message.includes("active bundle subscription required");
};

const bostaDeliveryError = (payload = {}, fallbackMessage = "Bosta delivery creation failed", fallbackStatus = 400) => {
  const subscriptionRequired = isBostaSubscriptionRequiredError(payload, fallbackMessage);
  const error = new Error(subscriptionRequired ? BOSTA_SUBSCRIPTION_REQUIRED_MESSAGE : bostaErrorMessage(payload, fallbackMessage));
  error.status = subscriptionRequired ? 409 : fallbackStatus;
  error.code = subscriptionRequired ? "BOSTA_SUBSCRIPTION_REQUIRED" : (bostaErrorCode(payload) || "BOSTA_CREATE_FAILED");
  error.payload = payload;
  return error;
};

const isBostaCredentialsMissingError = (error = {}) => {
  const code = text(error?.code || error?.payload?.code || error?.payload?.errorCode).toUpperCase();
  const message = text(error?.message || error?.payload?.message).toLowerCase();
  return code === "BOSTA_API_KEY_MISSING" || message.includes("bosta api key is missing") || message.includes("bosta credentials are missing");
};

const BOSTA_WEBHOOK_STATUS_MAP = {
  created: "shipment_created",
  shipment_created: "shipment_created",
  picked_up: "picked_up",
  pickup_done: "picked_up",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  returned: "returned",
  cancelled: "cancelled",
  canceled: "cancelled",
  failed: "failed_delivery",
  failed_delivery: "failed_delivery",
};

const ERP_SHIPPING_STATUSES = new Set(Object.values(BOSTA_WEBHOOK_STATUS_MAP));

export const BOSTA_WEBHOOK_SAMPLE_PAYLOAD = {
  event: "delivery.status_changed",
  deliveryId: "BOSTA_DELIVERY_ID",
  trackingNumber: "BOSTA_TRACKING_NUMBER",
  status: "in_transit",
  timestamp: "2026-05-30T12:00:00.000Z",
};

const safeJson = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
};

const pickFirst = (source = {}, keys = []) => {
  for (const key of keys) {
    const parts = String(key).split(".");
    let current = source;
    for (const part of parts) {
      current = current?.[part];
    }
    if (current !== undefined && current !== null && text(current)) return current;
  }
  return "";
};

const extractBostaWebhook = (payload = {}) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const delivery = payload?.delivery && typeof payload.delivery === "object" ? payload.delivery : {};
  const order = payload?.order && typeof payload.order === "object" ? payload.order : {};
  const source = { ...payload, data, delivery, order };
  const rawStatusValue = pickFirst(source, [
    "status",
    "state",
    "deliveryStatus",
    "eventStatus",
    "newStatus",
    "newState",
    "data.status",
    "data.state",
    "data.deliveryStatus",
    "data.newStatus",
    "delivery.status",
    "delivery.state",
    "order.status",
  ]);
  // Bosta sends state as `{code, value}` on some events and as a plain string on
  // others; unwrap before matching or every object-shaped event reads as unsupported.
  const rawStatus = bostaStateText(rawStatusValue);
  const aliased = normalizeBostaStatus(rawStatusValue);
  const mappedStatus = (ERP_SHIPPING_STATUSES.has(aliased) ? aliased : "") ||
    BOSTA_WEBHOOK_STATUS_MAP[normalizeKey(rawStatus)] ||
    BOSTA_WEBHOOK_STATUS_MAP[normalizeKey(payload?.event)] ||
    "";
  return {
    rawStatus,
    status: mappedStatus,
    deliveryId: text(pickFirst(source, [
      "shipping_provider_delivery_id",
      "deliveryId",
      "delivery_id",
      "_id",
      "id",
      "data.deliveryId",
      "data.delivery_id",
      "data._id",
      "data.id",
      "delivery.deliveryId",
      "delivery._id",
      "delivery.id",
    ])),
    trackingNumber: text(pickFirst(source, [
      "trackingNumber",
      "tracking_number",
      "trackingNo",
      "trackingCode",
      "data.trackingNumber",
      "data.tracking_number",
      "data.trackingNo",
      "delivery.trackingNumber",
      "delivery.tracking_number",
    ])),
    eventId: text(pickFirst(source, ["eventId", "event_id", "id", "data.eventId", "data.event_id"])),
    eventType: text(pickFirst(source, ["event", "type", "eventType", "data.event", "data.type"])),
    occurredAt: text(pickFirst(source, ["timestamp", "createdAt", "updatedAt", "data.timestamp", "data.updatedAt", "delivery.updatedAt"])) || nowIso(),
  };
};

const webhookSecret = async () => text(
  (await getSetting("orders.bosta_webhook_secret", "")) ||
  process.env.BOSTA_WEBHOOK_SECRET ||
  process.env.BOSTA_WEBHOOK_TOKEN ||
  ""
);

// The per-delivery callback Bosta's own clients attach to a shipment. The token rides in
// the query string because that is the shape this field takes — there is no header to
// set on a URL — and `verifyBostaWebhookAuth` already accepts `req.query.token`. It is
// therefore a secret in a URL, so it must never reach a log: see redactBostaPayload.
// Returns "" rather than a half-built URL when the public backend URL or the secret is
// missing, because a callback that looks configured and is not is the worse failure.
const bostaWebhookCallbackUrl = async () => {
  const base = text(getPublicBackendUrl());
  const secret = await webhookSecret();
  if (!base || !secret) {
    console.warn("[bosta] no per-delivery webhook attached", { has_public_backend_url: Boolean(base), has_webhook_secret: Boolean(secret) });
    return "";
  }
  return `${base.replace(/\/+$/, "")}/api/shipping/bosta/webhook?token=${encodeURIComponent(secret)}`;
};

export const redactBostaPayload = (payload = {}) => (
  payload?.webHook
    ? { ...payload, webHook: String(payload.webHook).replace(/([?&]token=)[^&]*/i, "$1***") }
    : payload
);

const requestBaseUrl = (req) => {
  const envUrl = getPublicBackendUrl();
  if (envUrl) return envUrl;
  if (!req) return "";
  return `${req.protocol || "http"}://${req.get?.("host") || ""}`.replace(/\/+$/g, "");
};

const verifyBostaWebhookAuth = async ({ req, payload }) => {
  const secret = await webhookSecret();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      const error = new Error("Bosta webhook secret is not configured");
      error.status = 500;
      error.code = "BOSTA_WEBHOOK_SECRET_MISSING";
      throw error;
    }
    return { verified: true, mode: "development-no-secret" };
  }

  const signature = text(req.get("x-bosta-signature") || req.get("x-webhook-signature") || req.get("x-hub-signature-256"));
  if (signature) {
    const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(safeJson(payload));
    const digest = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expected = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    const left = Buffer.from(digest);
    const right = Buffer.from(expected);
    if (left.length === right.length && timingSafeEqual(left, right)) return { verified: true, mode: "signature" };
  }

  const token = text(req.get("x-bosta-webhook-token") || req.get("x-webhook-token") || req.query?.token || payload?.token);
  if (token && token === secret) return { verified: true, mode: "token" };

  const error = new Error("Invalid Bosta webhook signature or token");
  error.status = 401;
  error.code = "BOSTA_WEBHOOK_UNAUTHORIZED";
  throw error;
};

export const ensureShippingSchema = async (client = db) => {
  if (shippingSchemaEnsured) return;
  if (shippingSchemaEnsurePromise) {
    await shippingSchemaEnsurePromise;
    return;
  }
  shippingSchemaEnsurePromise = (async () => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_providers (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      api_base_url TEXT,
      api_key_encrypted TEXT,
      api_key TEXT,
      last_locations_sync_at TIMESTAMP NULL,
      last_locations_sync_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_cities (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES shipping_providers(id) ON DELETE CASCADE,
      provider_city_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT,
      code TEXT,
      pickup_available BOOLEAN NOT NULL DEFAULT TRUE,
      dropoff_available BOOLEAN NOT NULL DEFAULT TRUE,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, provider_city_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_zones (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES shipping_providers(id) ON DELETE CASCADE,
      city_id BIGINT NOT NULL REFERENCES shipping_cities(id) ON DELETE CASCADE,
      provider_zone_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT,
      pickup_available BOOLEAN NOT NULL DEFAULT TRUE,
      dropoff_available BOOLEAN NOT NULL DEFAULT TRUE,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, provider_zone_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_districts (
      id BIGSERIAL PRIMARY KEY,
      provider_id BIGINT NOT NULL REFERENCES shipping_providers(id) ON DELETE CASCADE,
      city_id BIGINT NOT NULL REFERENCES shipping_cities(id) ON DELETE CASCADE,
      zone_id BIGINT NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
      provider_district_id TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_ar TEXT,
      pickup_available BOOLEAN NOT NULL DEFAULT TRUE,
      dropoff_available BOOLEAN NOT NULL DEFAULT TRUE,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider_id, provider_district_id)
    )
  `);
  await client.query("CREATE INDEX IF NOT EXISTS idx_shipping_cities_provider_dropoff ON shipping_cities(provider_id, dropoff_available)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_shipping_zones_city_dropoff ON shipping_zones(city_id, dropoff_available)");
  await client.query("CREATE INDEX IF NOT EXISTS idx_shipping_districts_zone_dropoff ON shipping_districts(zone_id, dropoff_available)");
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_city_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_zone_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_district_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_address_line TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS street_address TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS building_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS floor_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS apartment_number VARCHAR(80)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_tracking_number VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_provider_delivery_id VARCHAR(160)`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_last_synced_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS last_shipping_sync_at TIMESTAMP NULL`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipping_raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tracking_url TEXT`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS shipment_timeline JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS cod_amount NUMERIC(12,2) NOT NULL DEFAULT 0`);
  // NULL is "follow the shop default", which is why this is not a defaulted boolean.
  await client.query(`ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS allow_open_package BOOLEAN NULL`);
  await ensureWhatsappShippingSchema(client);
  await client.query(`
    CREATE TABLE IF NOT EXISTS shipping_events (
      id BIGSERIAL PRIMARY KEY,
      order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
      provider VARCHAR(80) NOT NULL,
      status VARCHAR(80) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      event_key TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`ALTER TABLE IF EXISTS shipping_events ADD COLUMN IF NOT EXISTS order_id BIGINT`);
  await client.query(`ALTER TABLE IF EXISTS shipping_events ADD COLUMN IF NOT EXISTS provider VARCHAR(80) NOT NULL DEFAULT 'bosta'`);
  await client.query(`ALTER TABLE IF EXISTS shipping_events ADD COLUMN IF NOT EXISTS status VARCHAR(80) NOT NULL DEFAULT 'pending'`);
  await client.query(`ALTER TABLE IF EXISTS shipping_events ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE IF EXISTS shipping_events ADD COLUMN IF NOT EXISTS event_key TEXT`);
  await client.query(`ALTER TABLE IF EXISTS shipping_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_shipping_events_provider_event_key ON shipping_events(provider, event_key) WHERE event_key IS NOT NULL AND event_key <> ''`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_shipping_events_order_id ON shipping_events(order_id, created_at DESC)`);
  shippingSchemaEnsured = true;
  })().catch((error) => {
    shippingSchemaEnsurePromise = null;
    throw error;
  });
  await shippingSchemaEnsurePromise;
};

export const upsertShippingProvider = async (client, { code, name, is_enabled = false, api_base_url = "", api_key = "" }) => {
  const result = await client.query(
    `
    INSERT INTO shipping_providers (code, name, is_enabled, api_base_url, api_key, updated_at)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      is_enabled = COALESCE(EXCLUDED.is_enabled, shipping_providers.is_enabled),
      api_base_url = COALESCE(NULLIF(EXCLUDED.api_base_url, ''), shipping_providers.api_base_url),
      api_key = COALESCE(NULLIF(EXCLUDED.api_key, ''), shipping_providers.api_key),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [code, name, Boolean(is_enabled), api_base_url, api_key]
  );
  return result.rows[0];
};

const getProvider = async (client, code = "bosta") => {
  await ensureShippingSchema(client);
  const result = await client.query("SELECT * FROM shipping_providers WHERE code = $1 LIMIT 1", [code]);
  if (result.rows[0]) return result.rows[0];
  return upsertShippingProvider(client, { code, name: code === "bosta" ? "Bosta" : code, is_enabled: false });
};

// One row per carrier the ERP knows about. `integrated` is the honest bit: only Bosta
// has an API client behind it, so a card that lets you save a Mylerz key must still say
// the key books nothing. Hiding that is how a shipment nobody created gets waited on.
export const SHIPPING_PROVIDER_CATALOG = [
  { code: "bosta", name: "Bosta", integrated: true, supports_webhook: true, default_base_url: "https://app.bosta.co/api/v2" },
  { code: "mylerz", name: "Mylerz", integrated: false, supports_webhook: false, default_base_url: "" },
  { code: "aramex", name: "Aramex", integrated: false, supports_webhook: false, default_base_url: "" },
  { code: "shipblu", name: "ShipBlu", integrated: false, supports_webhook: false, default_base_url: "" },
];

const providerCatalogEntry = (code) => SHIPPING_PROVIDER_CATALOG.find((entry) => entry.code === text(code).toLowerCase()) || null;

export const listShippingProviders = async () => {
  await ensureShippingSchema();
  const { rows } = await db.query("SELECT * FROM shipping_providers");
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const bostaFallbackKey = (await getSetting("orders.bosta_api_key", "")) || process.env.BOSTA_API_KEY || "";
  const bostaFallbackBaseUrl = (await getSetting("orders.bosta_api_base_url", "")) || process.env.BOSTA_API_BASE_URL || "";
  const bostaSecret = await webhookSecret();
  return SHIPPING_PROVIDER_CATALOG.map((entry) => {
    const row = byCode.get(entry.code) || {};
    const isBosta = entry.code === "bosta";
    return {
      code: entry.code,
      name: entry.name,
      integrated: entry.integrated,
      supports_webhook: entry.supports_webhook,
      enabled: Boolean(row.is_enabled),
      api_base_url: row.api_base_url || (isBosta ? bostaFallbackBaseUrl : "") || entry.default_base_url,
      has_api_key: Boolean(row.api_key || (isBosta && bostaFallbackKey)),
      has_webhook_secret: isBosta ? Boolean(bostaSecret) : false,
      last_locations_sync_at: row.last_locations_sync_at || null,
      last_locations_sync_counts: row.last_locations_sync_counts || {},
    };
  });
};

export const saveShippingProviderSettings = async ({ code, enabled, apiKey, apiBaseUrl, webhookSecret: nextWebhookSecret, updatedBy } = {}) => {
  const entry = providerCatalogEntry(code);
  if (!entry) {
    const error = new Error(`شركة شحن غير معروفة: ${text(code) || "(فارغ)"}`);
    error.status = 400;
    error.code = "SHIPPING_PROVIDER_UNKNOWN";
    throw error;
  }
  // Bosta keeps its own path: it also mirrors the key into the legacy settings rows and
  // owns the webhook secret, and dropping that would silently unhook live shipments.
  if (entry.code === "bosta") {
    return saveBostaSettings({ enabled, apiKey, apiBaseUrl, webhookSecret: nextWebhookSecret, updatedBy });
  }
  await ensureShippingSchema();
  const client = await db.connect();
  try {
    const provider = await upsertShippingProvider(client, {
      code: entry.code,
      name: entry.name,
      is_enabled: Boolean(enabled),
      api_base_url: text(apiBaseUrl),
      api_key: text(apiKey),
    });
    const { api_key: _apiKey, api_key_encrypted: _apiKeyEncrypted, ...safeProvider } = provider;
    return { ...safeProvider, has_api_key: Boolean(provider.api_key), has_webhook_secret: false };
  } finally {
    client.release();
  }
};

export const getBostaSettings = async () => {
  await ensureShippingSchema();
  const provider = await getProvider(db, "bosta");
  const settingsKey = await getSetting("orders.bosta_api_key", "");
  const settingsBaseUrl = await getSetting("orders.bosta_api_base_url", "");
  return {
    enabled: Boolean(provider.is_enabled),
    api_base_url: provider.api_base_url || settingsBaseUrl || process.env.BOSTA_API_BASE_URL || "https://app.bosta.co/api/v2",
    has_api_key: Boolean(provider.api_key || settingsKey || process.env.BOSTA_API_KEY),
    has_webhook_secret: Boolean(await webhookSecret()),
    last_locations_sync_at: provider.last_locations_sync_at,
    last_locations_sync_counts: provider.last_locations_sync_counts || {},
  };
};

export const getBostaIntegrationStatus = async ({ req } = {}) => {
  await ensureShippingSchema();
  const provider = await getProvider(db, "bosta");
  const settingsKey = await getSetting("orders.bosta_api_key", "");
  const secret = await webhookSecret();
  const locationCounts = await db.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM shipping_cities c WHERE c.provider_id = $1) AS cities,
      (SELECT COUNT(*)::int FROM shipping_zones z WHERE z.provider_id = $1) AS zones,
      (SELECT COUNT(*)::int FROM shipping_districts d WHERE d.provider_id = $1) AS districts
    `,
    [provider.id]
  );
  const lastWebhook = await db.query(
    `
    SELECT order_id, status, created_at
    FROM shipping_events
    WHERE provider = 'bosta'
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `
  );
  // Bosta's vocabulary is wider than the eight statuses the ERP tracks, and guessing the
  // rest is how a wrong status becomes unfalsifiable. Unknown states are recorded under
  // their real spelling instead, so this is the list to map from — evidence, not guesses.
  const webhookStatusMix = await db.query(
    `
    SELECT status, COUNT(*)::int AS events, MAX(created_at) AS last_seen
    FROM shipping_events
    WHERE provider = 'bosta'
    GROUP BY status
    ORDER BY MAX(created_at) DESC
    LIMIT 20
    `
  );
  const counts = locationCounts.rows[0] || { cities: 0, zones: 0, districts: 0 };
  const webhookUrl = `${requestBaseUrl(req) || ""}/api/shipping/bosta/webhook`;
  return {
    provider: "bosta",
    api_connected: Boolean(provider.is_enabled && (provider.api_key || settingsKey || process.env.BOSTA_API_KEY)),
    locations_synced: Number(counts.cities || 0) > 0 && Number(counts.zones || 0) > 0 && Number(counts.districts || 0) > 0,
    webhook_registered: Boolean(webhookUrl && (secret || process.env.NODE_ENV !== "production")),
    webhook_secret_configured: Boolean(secret),
    webhook_url: webhookUrl,
    last_webhook_received_at: lastWebhook.rows[0]?.created_at || null,
    last_webhook_status: lastWebhook.rows[0]?.status || "",
    last_webhook_order_id: lastWebhook.rows[0]?.order_id || null,
    webhook_status_mix: webhookStatusMix.rows.map((row) => ({
      status: row.status,
      events: Number(row.events || 0),
      last_seen: row.last_seen,
      tracked: ERP_SHIPPING_STATUSES.has(row.status),
    })),
    webhook_untracked_statuses: webhookStatusMix.rows.filter((row) => !ERP_SHIPPING_STATUSES.has(row.status)).map((row) => row.status),
    last_locations_sync_at: provider.last_locations_sync_at || null,
    location_counts: {
      cities: Number(counts.cities || 0),
      zones: Number(counts.zones || 0),
      districts: Number(counts.districts || 0),
    },
    last_locations_sync_counts: provider.last_locations_sync_counts || {},
  };
};

export const saveBostaSettings = async ({ enabled, apiKey, apiBaseUrl, webhookSecret: nextWebhookSecret, updatedBy } = {}) => {
  await ensureShippingSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (apiKey !== undefined) await setSetting("orders.bosta_api_key", apiKey, "shipping", updatedBy);
    if (apiBaseUrl !== undefined) await setSetting("orders.bosta_api_base_url", apiBaseUrl, "shipping", updatedBy);
    // Without this the webhook secret had no UI at all, so every Bosta status
    // callback was rejected in production for a missing secret.
    if (nextWebhookSecret !== undefined) await setSetting("orders.bosta_webhook_secret", nextWebhookSecret, "shipping", updatedBy);
    const provider = await upsertShippingProvider(client, {
      code: "bosta",
      name: "Bosta",
      is_enabled: Boolean(enabled),
      api_base_url: text(apiBaseUrl),
      api_key: text(apiKey),
    });
    await client.query("COMMIT");
    const { api_key: _apiKey, api_key_encrypted: _apiKeyEncrypted, ...safeProvider } = provider;
    return { ...safeProvider, has_api_key: Boolean(provider.api_key || apiKey), has_webhook_secret: Boolean(await webhookSecret()) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const bostaConfig = async () => {
  const provider = await getProvider(db, "bosta");
  return {
    enabled: Boolean(provider.is_enabled),
    apiKey: provider.api_key || (await getSetting("orders.bosta_api_key", "")) || process.env.BOSTA_API_KEY || "",
    apiBaseUrl: provider.api_base_url || (await getSetting("orders.bosta_api_base_url", "")) || process.env.BOSTA_API_BASE_URL || "https://app.bosta.co/api/v2",
    allowOpenPackage: await getSetting("orders.bosta_allow_open_package", "inherit"),
  };
};

export const syncBostaLocations = async () => {
  await ensureShippingSchema();
  const config = await bostaConfig();
  const client = createBostaClient(config);
  console.log("[bosta] syncing master locations");
  const payload = await client.getMasterLocations();
  const { cities, skippedInvalidRows } = normalizeBostaMasterLocations(payload);
  const pg = await db.connect();
  const counts = { citiesSynced: 0, zonesSynced: 0, districtsSynced: 0, skippedInvalidRows };
  try {
    await pg.query("BEGIN");
    const provider = await upsertShippingProvider(pg, { code: "bosta", name: "Bosta", is_enabled: true, api_base_url: config.apiBaseUrl, api_key: config.apiKey });
    for (const city of cities) {
      const cityResult = await pg.query(
        `
        INSERT INTO shipping_cities (provider_id, provider_city_id, name_en, name_ar, code, pickup_available, dropoff_available, raw_payload, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT (provider_id, provider_city_id) DO UPDATE SET
          name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar, code = EXCLUDED.code,
          pickup_available = EXCLUDED.pickup_available, dropoff_available = EXCLUDED.dropoff_available,
          raw_payload = EXCLUDED.raw_payload, updated_at = CURRENT_TIMESTAMP
        RETURNING *
        `,
        [provider.id, city.provider_city_id, city.name_en, city.name_ar, city.code, city.pickup_available, city.dropoff_available, JSON.stringify(city.raw_payload)]
      );
      counts.citiesSynced += 1;
      const cityRow = cityResult.rows[0];
      const zonesByProviderId = new Map();
      for (const district of city.districts) {
        let zoneRow = zonesByProviderId.get(district.provider_zone_id);
        if (!zoneRow) {
          const zoneResult = await pg.query(
            `
            INSERT INTO shipping_zones (provider_id, city_id, provider_zone_id, name_en, name_ar, pickup_available, dropoff_available, raw_payload, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,CURRENT_TIMESTAMP)
            ON CONFLICT (provider_id, provider_zone_id) DO UPDATE SET
              city_id = EXCLUDED.city_id, name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
              pickup_available = EXCLUDED.pickup_available, dropoff_available = EXCLUDED.dropoff_available,
              raw_payload = EXCLUDED.raw_payload, updated_at = CURRENT_TIMESTAMP
            RETURNING *
            `,
            [provider.id, cityRow.id, district.provider_zone_id, district.zone_name_en, district.zone_name_ar, district.pickup_available, district.dropoff_available, JSON.stringify(district.raw_payload)]
          );
          zoneRow = zoneResult.rows[0];
          zonesByProviderId.set(district.provider_zone_id, zoneRow);
          counts.zonesSynced += 1;
        }
        await pg.query(
          `
          INSERT INTO shipping_districts (provider_id, city_id, zone_id, provider_district_id, name_en, name_ar, pickup_available, dropoff_available, raw_payload, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CURRENT_TIMESTAMP)
          ON CONFLICT (provider_id, provider_district_id) DO UPDATE SET
            city_id = EXCLUDED.city_id, zone_id = EXCLUDED.zone_id, name_en = EXCLUDED.name_en, name_ar = EXCLUDED.name_ar,
            pickup_available = EXCLUDED.pickup_available, dropoff_available = EXCLUDED.dropoff_available,
            raw_payload = EXCLUDED.raw_payload, updated_at = CURRENT_TIMESTAMP
          `,
          [provider.id, cityRow.id, zoneRow.id, district.provider_district_id, district.district_name_en, district.district_name_ar, district.pickup_available, district.dropoff_available, JSON.stringify(district.raw_payload)]
        );
        counts.districtsSynced += 1;
      }
    }
    await pg.query(
      "UPDATE shipping_providers SET last_locations_sync_at = CURRENT_TIMESTAMP, last_locations_sync_counts = $2::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [provider.id, JSON.stringify(counts)]
    );
    await pg.query("COMMIT");
    console.log("[bosta] location sync complete", counts);
    return counts;
  } catch (error) {
    await pg.query("ROLLBACK");
    console.error("[bosta] location sync failed", { message: error.message });
    throw error;
  } finally {
    pg.release();
  }
};

const providerWhere = async (providerCode) => {
  const provider = await getProvider(db, providerCode);
  return provider.id;
};

export const listShippingCities = async ({ provider = "bosta", dropoffOnly = false, pickupOnly = false } = {}) => {
  const providerId = await providerWhere(provider);
  const filters = ["provider_id = $1"];
  if (dropoffOnly) filters.push("dropoff_available IS TRUE");
  if (pickupOnly) filters.push("pickup_available IS TRUE");
  const result = await db.query(`SELECT * FROM shipping_cities WHERE ${filters.join(" AND ")} ORDER BY name_en`, [providerId]);
  return result.rows;
};

export const listShippingZones = async ({ provider = "bosta", cityId, dropoffOnly = false, pickupOnly = false } = {}) => {
  const providerId = await providerWhere(provider);
  const filters = ["provider_id = $1"];
  const params = [providerId];
  if (cityId) {
    params.push(cityId);
    filters.push("city_id = $" + params.length);
  }
  if (dropoffOnly) filters.push("dropoff_available IS TRUE");
  if (pickupOnly) filters.push("pickup_available IS TRUE");
  const result = await db.query(`SELECT * FROM shipping_zones WHERE ${filters.join(" AND ")} ORDER BY name_en`, params);
  return result.rows;
};

export const listShippingDistricts = async ({ provider = "bosta", zoneId, dropoffOnly = false, pickupOnly = false } = {}) => {
  const providerId = await providerWhere(provider);
  const filters = ["provider_id = $1"];
  const params = [providerId];
  if (zoneId) {
    params.push(zoneId);
    filters.push("zone_id = $" + params.length);
  }
  if (dropoffOnly) filters.push("dropoff_available IS TRUE");
  if (pickupOnly) filters.push("pickup_available IS TRUE");
  const result = await db.query(`SELECT * FROM shipping_districts WHERE ${filters.join(" AND ")} ORDER BY name_en`, params);
  return result.rows;
};

export const searchShippingLocations = async ({ provider = "bosta", q = "", limit = 50 } = {}) => {
  const providerId = await providerWhere(provider);
  const pattern = `%${text(q)}%`;
  const result = await db.query(
    `
    SELECT
      c.id AS city_id, c.provider_city_id, c.name_en AS city_name_en, c.name_ar AS city_name_ar, c.code AS city_code,
      z.id AS zone_id, z.provider_zone_id, z.name_en AS zone_name_en, z.name_ar AS zone_name_ar,
      d.id AS district_id, d.provider_district_id, d.name_en AS district_name_en, d.name_ar AS district_name_ar,
      c.pickup_available AS city_pickup_available, c.dropoff_available AS city_dropoff_available,
      z.pickup_available AS zone_pickup_available, z.dropoff_available AS zone_dropoff_available,
      d.pickup_available AS district_pickup_available, d.dropoff_available AS district_dropoff_available
    FROM shipping_districts d
    JOIN shipping_zones z ON z.id = d.zone_id
    JOIN shipping_cities c ON c.id = d.city_id
    WHERE d.provider_id = $1
      AND ($2 = '%%' OR c.name_en ILIKE $2 OR c.name_ar ILIKE $2 OR z.name_en ILIKE $2 OR z.name_ar ILIKE $2 OR d.name_en ILIKE $2 OR d.name_ar ILIKE $2)
    ORDER BY c.name_en, z.name_en, d.name_en
    LIMIT $3
    `,
    [providerId, pattern, Math.max(1, Math.min(Number(limit) || 50, 200))]
  );
  return result.rows;
};

// `cash_on_delivery` is what the POS and the AI inbox composer actually write, and
// it does not contain the substring "cod" — so the old check read every one of them
// as prepaid and handed Bosta cod: 0. The courier would deliver and collect nothing.
const isCodPayment = (value = "") => {
  const key = normalizeKey(value);
  if (!key) return false;
  return key.includes("cash_on_delivery") || key.includes("cashondelivery") || /(^|_)cod(_|$)/.test(key);
};

// Money that has already moved. Only a recorded electronic payment lets a parcel
// leave with nothing to collect.
const PREPAID_PAYMENT_KEYS = ["instapay", "vodafone_cash", "paymob", "fawry", "valu", "visa", "mastercard", "credit_card", "debit_card", "card", "bank_transfer", "transfer", "wallet", "online", "electronic"];

const isPrepaidPayment = (value = "") => {
  const key = normalizeKey(value);
  if (!key) return false;
  return PREPAID_PAYMENT_KEYS.some((entry) => key === entry || key.includes(entry));
};

const isSettledPaymentStatus = (value = "") =>
  ["paid", "completed", "complete", "settled", "success", "succeeded", "refunded", "fully_refunded"].includes(normalizeKey(value));

// What the customer still owes. `total - paid` is computed from the two columns the
// money flows through; `remaining_amount` is a denormalized mirror that only some
// writers keep in sync, so it is the fallback, not the source.
export const orderOwedAmount = (order = {}) => {
  const total = Number(order.total_amount ?? order.total_price ?? order.total ?? 0);
  const paid = Number(order.paid_amount ?? 0);
  const stored = order.remaining_amount === null || order.remaining_amount === undefined || order.remaining_amount === ""
    ? null
    : Number(order.remaining_amount);
  const owed = Number.isFinite(total) && Number.isFinite(paid) && total > 0
    ? total - paid
    : (stored !== null && Number.isFinite(stored) ? stored : 0);
  return Math.max(0, Math.round(owed * 100) / 100);
};

// The courier collects what the customer still owes. The old rule inverted the
// burden of proof: it collected only when `payment_method` spelled out cash on
// delivery, so an AI inbox draft (`payment_method: "pending"`), a credit sale, or a
// blank method all shipped as prepaid and Bosta was handed cod: 0 — the parcel is
// delivered and nobody pays. Now silence means "still owed"; only a payment we can
// actually point at zeroes the collection.
export const orderCodAmount = (order = {}) => {
  const explicit = Number(order.cod_amount || 0);
  if (explicit > 0) return Math.round(explicit * 100) / 100;
  const owed = orderOwedAmount(order);
  if (owed <= 0) return 0;
  if (isCodPayment(order.payment_method) || isCodPayment(order.payment_status)) return owed;
  // A part payment already on the record — an Instapay deposit, prepaid shipping —
  // proves this order collects money, so the balance is collected at the door no
  // matter what the method is called.
  if (Number(order.paid_amount ?? 0) > 0) return owed;
  if (isPrepaidPayment(order.payment_method) || isPrepaidPayment(order.payment_type) || isSettledPaymentStatus(order.payment_status)) return 0;
  return owed;
};

// A shipment that collects nothing is either a settled order or a mistake, and the
// two are told apart here rather than at the courier's door. `override` is the
// operator deciding on the order screen — including an explicit 0, which is how a
// genuinely prepaid parcel with an unrecorded payment gets out.
export const resolveBostaCollection = ({ order = {}, override } = {}) => {
  const owed = orderOwedAmount(order);
  const overrideProvided = override !== undefined && override !== null && String(override).trim() !== "" && Number.isFinite(Number(override));
  if (overrideProvided) {
    return { amount: Math.max(0, Math.round(Number(override) * 100) / 100), owed, source: "operator", blocked: false, reason: "" };
  }
  const amount = orderCodAmount(order);
  if (amount > 0) return { amount, owed, source: Number(order.cod_amount || 0) > 0 ? "order_cod_amount" : "amount_owed", blocked: false, reason: "" };
  if (owed <= 0) return { amount: 0, owed, source: "settled", blocked: false, reason: "" };
  return { amount: 0, owed, source: "prepaid_method", blocked: true, reason: "unpaid_order_marked_prepaid" };
};

const bostaZeroCollectionError = (collection = {}) => {
  const error = new Error(BOSTA_ZERO_COLLECTION_MESSAGE);
  error.status = 409;
  error.code = "BOSTA_ZERO_COLLECTION";
  error.payload = { amount_owed: collection.owed, reason: collection.reason };
  return error;
};

// A second create on the same order is not an edit. Bosta answers it with a brand new
// parcel, and the create used to overwrite tracking_number with the new one — so the
// parcel the courier is actually carrying became invisible to every screen we have.
// On 2026-08-19 three orders went out twice this way (INV-413/516/517): the originals
// moved to "In progress" while the ERP sat watching three "New" parcels nobody would
// ever collect, and Bosta phoned each customer about both.
const LIVE_BOSTA_SHIPMENT_ENDED = new Set(["cancelled", "canceled", "returned", "failed_delivery", "failed"]);

const bostaShipmentExistsError = ({ trackingNumber = "", deliveryId = "", status = "" } = {}) => {
  const error = new Error(trackingNumber ? `${BOSTA_SHIPMENT_EXISTS_MESSAGE} (${trackingNumber})` : BOSTA_SHIPMENT_EXISTS_MESSAGE);
  error.status = 409;
  error.code = "BOSTA_SHIPMENT_EXISTS";
  error.payload = { tracking_number: trackingNumber, delivery_id: deliveryId, shipment_status: status };
  return error;
};

// The one shipment an order already has, or null. A cancelled/returned/failed parcel is
// finished business, so re-shipping over it is legitimate.
export const liveBostaShipmentOf = (order = {}) => {
  const deliveryId = text(order.shipping_provider_delivery_id);
  const trackingNumber = text(order.shipping_tracking_number || order.tracking_number || order.shipment_id);
  if (!deliveryId && !trackingNumber) return null;
  const status = normalizeKey(order.shipment_status || order.shipping_status);
  if (LIVE_BOSTA_SHIPMENT_ENDED.has(status)) return null;
  return { deliveryId, trackingNumber, status };
};

// Bosta's own default lives in the business account, so "inherit" means send no
// field at all and let the account decide. Anything else is this shop overruling it.
const OPEN_PACKAGE_MODES = { inherit: null, default: null, account: null, allow: true, allowed: true, deny: false, denied: false, block: false };

const toOpenPackageTriState = (value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const key = normalizeKey(value);
  if (!key) return undefined;
  if (key in OPEN_PACKAGE_MODES) return OPEN_PACKAGE_MODES[key];
  if (["1", "true", "yes", "on"].includes(key)) return true;
  if (["0", "false", "no", "off"].includes(key)) return false;
  return undefined;
};

// Order override first, then the order's stored preference, then the shop default.
// `null` at the end of that chain means the payload carries no flag.
export const resolveOpenPackagePreference = ({ order = {}, defaultMode = "inherit", override } = {}) => {
  const fromOverride = toOpenPackageTriState(override);
  if (fromOverride !== undefined) return fromOverride;
  const fromOrder = toOpenPackageTriState(order.allow_open_package);
  if (fromOrder !== undefined) return fromOrder;
  const fromSettings = toOpenPackageTriState(defaultMode);
  return fromSettings === undefined ? null : fromSettings;
};

const loadOrderShipmentContext = async (client, orderId) => {
  const orderResult = await client.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  const itemsResult = await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);
  const cityResult = await client.query("SELECT * FROM shipping_cities WHERE id::text = $1 OR provider_city_id = $1 LIMIT 1", [text(order.shipping_city_id || order.city_id)]);
  const zoneResult = await client.query("SELECT * FROM shipping_zones WHERE id::text = $1 OR provider_zone_id = $1 LIMIT 1", [text(order.shipping_zone_id)]);
  const districtResult = await client.query("SELECT * FROM shipping_districts WHERE id::text = $1 OR provider_district_id = $1 OR id::text = $2 LIMIT 1", [text(order.shipping_district_id || order.area_id), text(order.area_id)]);
  return { order, items: itemsResult.rows, city: cityResult.rows[0], zone: zoneResult.rows[0], district: districtResult.rows[0] };
};

export const createBostaShipmentForOrder = async (orderId, options = {}) => {
  await ensureShippingSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const context = await loadOrderShipmentContext(client, orderId);
    const { order, items, city, zone, district } = context;
    const config = await bostaConfig();
    if (!config.enabled) {
      console.error("[bosta] refusing to create a shipment while the integration is disabled", { orderId: order.id });
      throw bostaDisabledError();
    }
    if (!text(config.apiKey)) {
      console.error("[bosta] refusing to create a shipment without credentials", { orderId: order.id });
      throw bostaNotConfiguredError("bosta_credentials_missing");
    }

    // Re-issuing has to retire the old parcel first, otherwise "fix the COD and create
    // again" quietly leaves the courier holding two. Cancelling before the create is
    // the safer order: a failed create leaves nothing extra with the courier.
    const existing = liveBostaShipmentOf(order);
    if (existing && !options.replaceExisting) {
      console.error("[bosta] refusing to create a second delivery for an order that already has one", { orderId: order.id, ...existing });
      throw bostaShipmentExistsError({ trackingNumber: existing.trackingNumber, deliveryId: existing.deliveryId, status: existing.status });
    }
    if (existing && options.replaceExisting && existing.deliveryId) {
      console.log("[bosta] cancelling the existing delivery before re-issuing", { orderId: order.id, ...existing });
      await createBostaClient(config).cancelDelivery(existing.deliveryId);
    }

    const missing = [];
    if (!text(order.customer_name)) missing.push("customer name");
    if (!text(order.customer_phone)) missing.push("customer phone");
    if (!city) missing.push("Bosta city");
    if (!zone) missing.push("Bosta zone");
    if (!district) missing.push("Bosta district");
    const fullAddress = buildBostaAddressLine(order);
    if (!fullAddress) missing.push("detailed address");
    if (missing.length) {
      const error = new Error(`Cannot create Bosta shipment. Missing ${missing.join(", ")}`);
      error.status = 400;
      throw error;
    }
    if (fullAddress.length < 12) {
      const error = new Error("Please enter a detailed delivery address before creating a Bosta shipment.");
      error.status = 400;
      error.code = "BOSTA_ADDRESS_TOO_SHORT";
      throw error;
    }

    const collection = resolveBostaCollection({ order, override: options.codAmount });
    if (collection.blocked) {
      console.error("[bosta] refusing to ship an unpaid order with nothing to collect", { orderId: order.id, owed: collection.owed, payment_method: order.payment_method, payment_status: order.payment_status });
      throw bostaZeroCollectionError(collection);
    }
    const allowOpenPackage = resolveOpenPackagePreference({ order, defaultMode: config.allowOpenPackage, override: options.allowOpenPackage });

    const bosta = createBostaClient(config);
    const deliveryPayload = mapOrderToBostaDeliveryPayload({ order, items, city, zone, district, codAmount: collection.amount, allowOpenPackage, webhookUrl: await bostaWebhookCallbackUrl() });
    // Redacted: the callback carries the webhook secret in its query string, and this
    // line goes to the container log verbatim.
    console.log("[bosta-create-payload]", JSON.stringify(redactBostaPayload(deliveryPayload)));
    console.log("[bosta] creating delivery", { orderId: order.id, city: city.provider_city_id, zone: zone.provider_zone_id, district: district.provider_district_id, cod: collection.amount, cod_source: collection.source, allow_open_package: allowOpenPackage });
    let rawBostaResponse;
    try {
      rawBostaResponse = await bosta.createDelivery(deliveryPayload);
      console.log("[bosta-create-response]", JSON.stringify(rawBostaResponse));
    } catch (apiError) {
      if (isBostaCredentialsMissingError(apiError)) {
        console.error("[bosta] delivery rejected for missing credentials", { orderId: order.id, message: apiError?.message });
        throw bostaNotConfiguredError("bosta_credentials_rejected");
      }
      const rawErrorPayload = apiError?.payload || { message: apiError?.message, status: apiError?.status };
      console.error("[bosta-create-response]", JSON.stringify(rawErrorPayload));
      throw bostaDeliveryError(
        rawErrorPayload,
        apiError?.message || "Bosta delivery creation failed",
        apiError?.status >= 400 && apiError.status < 500 ? 400 : 502
      );
    }
    const response = normalizeBostaDeliveryResponse(rawBostaResponse);
    if (!response.success) {
      throw bostaDeliveryError(response.raw_response, response.error || "Bosta delivery creation failed", 400);
    }

    const status = response.status || "created";
    const providerDeliveryId = response.provider_delivery_id || response.shipment_id;
    const bostaShipmentNumber = response.tracking_number || response.shipment_id || providerDeliveryId;
    // The collection is written back onto the order so the shipping centre, the
    // invoice and the courier all quote the same figure — the column used to stay 0
    // while Bosta held a different number, and no screen ever showed the difference.
    const timelineEvent = {
      at: nowIso(),
      action: "bosta_create_delivery",
      provider: "bosta",
      status,
      delivery_id: providerDeliveryId,
      shipment_id: bostaShipmentNumber,
      tracking_number: response.tracking_number,
      cod_amount: collection.amount,
      cod_source: collection.source,
      allow_open_package: allowOpenPackage,
      // The overwritten parcel stays named here, so a replacement is never a tracking
      // number that simply vanished from the order.
      ...(existing ? { replaced_delivery_id: existing.deliveryId, replaced_tracking_number: existing.trackingNumber } : {}),
    };
    const updateResult = await client.query(
      `
      UPDATE orders SET
        shipping_provider = 'bosta',
        shipping_provider_id = 'bosta',
        shipping_provider_delivery_id = $2,
        shipment_id = $3,
        shipping_tracking_number = $4,
        tracking_number = $4,
        tracking_url = $5,
        shipping_label_url = $6,
        shipping_status = $7,
        shipment_status = $7,
        shipping_last_synced_at = CURRENT_TIMESTAMP,
        last_shipping_sync_at = CURRENT_TIMESTAMP,
        shipping_raw_payload = $8::jsonb,
        shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $9::jsonb,
        cod_amount = $10,
        allow_open_package = $11,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [order.id, providerDeliveryId, bostaShipmentNumber, response.tracking_number, response.tracking_url, response.label_url, status, JSON.stringify(response.raw_response), JSON.stringify([timelineEvent]), collection.amount, allowOpenPackage]
    );
    await client.query("COMMIT");
    const updatedOrder = updateResult.rows[0];
    sendShipmentCreated(updatedOrder).catch((error) => {
      console.warn("[whatsapp:shipment-notification-skipped]", { orderId: updatedOrder?.id, status, message: error?.message || String(error) });
    });
    return { ...response, order: updatedOrder };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[bosta] create shipment failed", { orderId, message: error.message });
    throw error;
  } finally {
    client.release();
  }
};

// One Bosta call prints every selected label. Reprinting is deliberately allowed while
// the integration is switched off — shipments already with the courier still need their
// airway bill, the same reason refresh and cancel stay open.
const AWB_BATCH_LIMIT = 100;

export const fetchBostaShipmentLabels = async (orderIds = []) => {
  await ensureShippingSchema();
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map((id) => Number(id)).filter(Number.isFinite))];
  if (!ids.length) {
    const error = new Error("Select at least one shipment to print");
    error.status = 400;
    throw error;
  }
  if (ids.length > AWB_BATCH_LIMIT) {
    const error = new Error(`Print at most ${AWB_BATCH_LIMIT} labels at a time`);
    error.status = 400;
    error.code = "BOSTA_AWB_BATCH_TOO_LARGE";
    throw error;
  }

  const config = await bostaConfig();
  if (!text(config.apiKey)) throw bostaNotConfiguredError("bosta_credentials_missing");

  const { rows } = await db.query(
    `
    SELECT o.id,
           COALESCE(o.public_order_number, o.display_order_number, o.invoice_number, 'ORD-' || o.id::text) AS order_number,
           COALESCE(o.shipping_provider_id, o.shipping_provider, '') AS provider,
           COALESCE(o.shipping_provider_delivery_id, '') AS delivery_id,
           COALESCE(o.shipping_tracking_number, o.tracking_number, '') AS tracking_number
    FROM orders o
    WHERE o.id = ANY($1::int[])
    ORDER BY o.id
    `,
    [ids]
  );

  const found = new Map(rows.map((row) => [Number(row.id), row]));
  const printable = [];
  const skipped = [];
  for (const id of ids) {
    const row = found.get(id);
    if (!row) {
      skipped.push({ order_id: id, order_number: "", reason: "order_not_found" });
      continue;
    }
    const entry = { order_id: Number(row.id), order_number: row.order_number, tracking_number: row.tracking_number };
    if (normalizeKey(row.provider) !== "bosta") {
      skipped.push({ ...entry, reason: "provider_unsupported", provider: text(row.provider) });
      continue;
    }
    if (!text(row.delivery_id)) {
      skipped.push({ ...entry, reason: "shipment_not_created" });
      continue;
    }
    printable.push({ ...entry, delivery_id: text(row.delivery_id) });
  }

  if (!printable.length) {
    const error = new Error(BOSTA_NO_LABEL_MESSAGE);
    error.status = 400;
    error.code = "BOSTA_NO_PRINTABLE_LABEL";
    error.payload = { skipped };
    throw error;
  }

  const bosta = createBostaClient(config);
  let rawAwbResponse;
  try {
    rawAwbResponse = await bosta.massAirwayBill(printable.map((row) => row.delivery_id), { lang: "ar" });
  } catch (apiError) {
    if (isBostaCredentialsMissingError(apiError)) {
      console.error("[bosta] awb rejected for missing credentials", { orderIds: printable.map((row) => row.order_id), message: apiError?.message });
      throw bostaNotConfiguredError("bosta_credentials_rejected");
    }
    const rawErrorPayload = apiError?.payload || { message: apiError?.message, status: apiError?.status };
    console.error("[bosta-awb-response]", JSON.stringify(rawErrorPayload));
    throw bostaDeliveryError(
      rawErrorPayload,
      apiError?.message || "Bosta airway bill request failed",
      apiError?.status >= 400 && apiError.status < 500 ? 400 : 502
    );
  }

  const awb = normalizeBostaAwbResponse(rawAwbResponse);
  if (!awb.pdf_base64) {
    console.error("[bosta] awb response carried no printable pdf", { orderIds: printable.map((row) => row.order_id), message: awb.error });
    const error = new Error(awb.error || "Bosta returned no printable airway bill");
    error.status = 502;
    error.code = "BOSTA_AWB_EMPTY";
    throw error;
  }

  return {
    pdf_base64: awb.pdf_base64,
    content_type: "application/pdf",
    byte_length: awb.byte_length,
    printed: printable,
    skipped,
  };
};

export const refreshBostaShipmentForOrder = async (orderId) => {
  await ensureShippingSchema();
  const orderResult = await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  // The status endpoint is keyed by tracking number, so that comes first — the
  // delivery id is only a fallback for rows that somehow never got one.
  const identifier = order.shipping_tracking_number || order.tracking_number || order.shipment_id || order.shipping_provider_delivery_id;
  if (!identifier) {
    const error = new Error("Order has no Bosta delivery id or tracking number");
    error.status = 400;
    throw error;
  }
  const response = normalizeBostaDeliveryResponse(await createBostaClient(await bostaConfig()).getDeliveryStatus(identifier));
  // Refusing here is the whole point: writing the "created" default over a real status
  // would look exactly like a parcel the courier has not touched, and would stamp a
  // fresh sync time on top of the lie.
  if (!response.status_parsed) {
    console.error("[bosta] refresh could not read a state out of the response", { orderId, identifier, raw: JSON.stringify(response.raw_response).slice(0, 800) });
    const error = new Error("Bosta answered without a readable shipment state, so the status was left untouched.");
    error.status = 502;
    error.code = "BOSTA_STATUS_UNREADABLE";
    error.payload = { identifier, raw_response: response.raw_response };
    throw error;
  }
  const status = response.status;
  const timelineEvent = { at: nowIso(), action: "bosta_refresh_status", provider: "bosta", status };
  const updated = await db.query(
    `
    UPDATE orders SET
      shipping_status = $2,
      shipment_status = $2,
      tracking_number = COALESCE(NULLIF($3, ''), tracking_number),
      shipping_tracking_number = COALESCE(NULLIF($3, ''), shipping_tracking_number),
      shipment_id = COALESCE(NULLIF($3, ''), NULLIF($4, ''), shipment_id),
      shipping_provider_delivery_id = COALESCE(NULLIF($4, ''), shipping_provider_delivery_id),
      tracking_url = COALESCE(NULLIF($5, ''), tracking_url),
      shipping_last_synced_at = CURRENT_TIMESTAMP,
      shipping_raw_payload = $6::jsonb,
      shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $7::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [orderId, status, response.tracking_number, response.provider_delivery_id, response.tracking_url, JSON.stringify(response.raw_response), JSON.stringify([timelineEvent])]
  );
  const updatedOrder = updated.rows[0];
  sendShipmentNotificationForStatus(updatedOrder, status).catch((error) => {
    console.warn("[whatsapp:shipment-notification-skipped]", { orderId: updatedOrder?.id, status, message: error?.message || String(error) });
  });
  return { ...response, order: updatedOrder };
};

export const cancelBostaShipmentForOrder = async (orderId) => {
  await ensureShippingSchema();
  const orderResult = await db.query("SELECT * FROM orders WHERE id = $1 LIMIT 1", [orderId]);
  const order = orderResult.rows[0];
  if (!order) {
    const error = new Error("Order not found");
    error.status = 404;
    throw error;
  }
  const identifier = order.shipping_provider_delivery_id || order.shipment_id;
  if (identifier) await createBostaClient(await bostaConfig()).cancelDelivery(identifier);
  const timelineEvent = { at: nowIso(), action: "bosta_cancel_delivery", provider: "bosta", status: "cancelled" };
  const updated = await db.query(
    `
    UPDATE orders SET shipping_status = 'cancelled', shipment_status = 'cancelled',
      shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $2::jsonb,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 RETURNING *
    `,
    [orderId, JSON.stringify([timelineEvent])]
  );
  return { success: true, provider: "bosta", status: "cancelled", order: updated.rows[0] };
};

const bostaWebhookEventKey = ({ payload = {}, parsed = {} }) => {
  const explicit = text(parsed.eventId);
  if (explicit) return explicit;
  const basis = [
    parsed.deliveryId,
    parsed.trackingNumber,
    parsed.status,
    parsed.occurredAt,
    safeJson(payload),
  ].filter(Boolean).join("|");
  return createHash("sha256").update(basis).digest("hex");
};

export const previewBostaWebhookPayload = (payload = BOSTA_WEBHOOK_SAMPLE_PAYLOAD) => {
  const parsed = extractBostaWebhook(payload);
  return {
    provider: "bosta",
    parsed,
    event_key: bostaWebhookEventKey({ payload, parsed }),
    would_update: Boolean(parsed.status && (parsed.deliveryId || parsed.trackingNumber)),
  };
};

export const testBostaWebhookPayload = async (payload = BOSTA_WEBHOOK_SAMPLE_PAYLOAD) => {
  const preview = previewBostaWebhookPayload(payload);
  const result = await processBostaWebhook({ payload });
  return { preview, result };
};

export const processBostaWebhook = async ({ req, payload = {} } = {}) => {
  await ensureShippingSchema();
  console.log("[bosta-webhook]", safeJson(payload));
  const auth = req ? await verifyBostaWebhookAuth({ req, payload }) : { verified: true, mode: "internal" };
  const parsed = extractBostaWebhook(payload);
  // A callback we cannot map is still proof that Bosta is calling. This used to answer
  // 400 and throw *before* the shipping_events INSERT, so a rejected callback left no
  // row, no last_webhook_received_at, nothing in the drawer — "no events yet" could not
  // be told apart from "Bosta never called", and a platform that keeps collecting 4xx
  // throttles or drops the subscription outright. Bosta's vocabulary is wider than the
  // eight statuses the ERP tracks, so the unknown ones are recorded under their real
  // spelling and answered 200; only a status the ERP actually tracks may move an order.
  const recordedStatus = parsed.status || normalizeKey(parsed.rawStatus) || "unmapped";

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `
      SELECT *
      FROM orders
      WHERE shipping_provider = 'bosta'
        AND (
          ($1::text <> '' AND shipping_provider_delivery_id = $1::text)
          OR ($1::text <> '' AND shipment_id = $1::text)
          OR ($2::text <> '' AND shipping_tracking_number = $2::text)
          OR ($2::text <> '' AND tracking_number = $2::text)
        )
      ORDER BY id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [parsed.deliveryId, parsed.trackingNumber]
    );
    const order = orderResult.rows[0] || null;
    const eventKey = bostaWebhookEventKey({ payload, parsed });
    const eventInsert = await client.query(
      `
      INSERT INTO shipping_events (order_id, provider, status, payload, event_key)
      VALUES ($1, 'bosta', $2, $3::jsonb, $4)
      ON CONFLICT (provider, event_key) WHERE event_key IS NOT NULL AND event_key <> '' DO NOTHING
      RETURNING *
      `,
      [order?.id || null, recordedStatus, safeJson({ ...payload, parsed }), eventKey]
    );
    const duplicate = eventInsert.rowCount === 0;

    if (!order) {
      await client.query("COMMIT");
      return { success: true, recorded: true, applied: false, matched: false, duplicate, auth, parsed, message: "No matching ERP order found for Bosta webhook" };
    }

    const orderStatus = normalizeKey(order.status);
    const shippingStatus = normalizeKey(order.shipping_status || order.shipment_status);
    if (order.cancelled_at || orderStatus === "cancelled" || shippingStatus === "cancelled") {
      await client.query("COMMIT");
      return { success: true, recorded: true, applied: false, matched: true, skipped: true, duplicate, order_id: order.id, auth, parsed, message: "ERP order is cancelled; webhook did not overwrite it" };
    }

    if (duplicate) {
      await client.query("COMMIT");
      return { success: true, recorded: true, applied: false, matched: true, duplicate: true, order_id: order.id, auth, parsed, order };
    }

    // Recorded under its real spelling so the unhandled vocabulary is visible in
    // shipping_events, but never written onto the order: guessing what an unknown
    // Bosta state means is how a wrong status becomes unfalsifiable from the UI.
    if (!parsed.status) {
      console.warn("[bosta-webhook] status not tracked by the ERP; recorded without touching the order", { orderId: order.id, raw_status: parsed.rawStatus, recorded_as: recordedStatus });
      await client.query("COMMIT");
      return { success: true, recorded: true, applied: false, matched: true, duplicate, order_id: order.id, auth, parsed, reason: "status_not_tracked" };
    }

    const timelineEvent = {
      at: parsed.occurredAt || nowIso(),
      action: "bosta_webhook",
      provider: "bosta",
      status: parsed.status,
      raw_status: parsed.rawStatus,
      delivery_id: parsed.deliveryId,
      tracking_number: parsed.trackingNumber,
    };
    const updated = await client.query(
      `
      UPDATE orders SET
        shipping_status = $2,
        shipment_status = $2,
        shipping_provider_delivery_id = COALESCE(NULLIF($3, ''), shipping_provider_delivery_id),
        shipment_id = COALESCE(NULLIF($4, ''), NULLIF($3, ''), shipment_id),
        shipping_tracking_number = COALESCE(NULLIF($4, ''), shipping_tracking_number),
        tracking_number = COALESCE(NULLIF($4, ''), tracking_number),
        shipping_last_synced_at = CURRENT_TIMESTAMP,
        last_shipping_sync_at = CURRENT_TIMESTAMP,
        shipping_raw_payload = $5::jsonb,
        shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || $6::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
      `,
      [order.id, parsed.status, parsed.deliveryId, parsed.trackingNumber, safeJson(payload), JSON.stringify([timelineEvent])]
    );
    await client.query("COMMIT");
    const updatedOrder = updated.rows[0];
    sendShipmentNotificationForStatus(updatedOrder, parsed.status).catch((error) => {
      console.warn("[whatsapp:shipment-notification-skipped]", { orderId: updatedOrder?.id, status: parsed.status, message: error?.message || String(error) });
    });
    return { success: true, recorded: true, applied: true, matched: true, duplicate: false, order_id: order.id, auth, parsed, order: updatedOrder };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

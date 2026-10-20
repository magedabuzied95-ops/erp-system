// Conversions API ("مجموعات بيانات التحويل" / "أحداث التحويل").
//
// A dataset row = one Meta dataset (pixel) per channel. Every send is logged in
// meta_ads_conversion_events (pending → sent | failed) and failed rows are retried
// by the meta-ads-capi job up to MAX_ATTEMPTS times with the payload they were
// built with.
//
// Business messaging events (WhatsApp / Messenger / Instagram) identify the person
// by the click id or the page-scoped id Meta gave us with the ad click:
//   whatsapp   user_data { whatsapp_business_account_id, ctwa_clid }
//   messenger  user_data { page_id, page_scoped_user_id }
//   instagram  user_data { ig_account_id, ig_sid }

import crypto from "crypto";

import db from "../../../database/db.js";
import { decryptSecret, graphPost } from "../metaAdsGraph.js";
import { httpError } from "../metaAdsCore.js";
import { anyTenantToken, clip, hashEmail, hashPhone, isReady, log, sha256, text, warn } from "./integrationsCommon.js";

export const MAX_ATTEMPTS = 5;
const MESSAGING = new Set(["whatsapp", "messenger", "instagram"]);
const storeCurrency = () => text(process.env.META_ADS_STORE_CURRENCY || process.env.STORE_CURRENCY) || "EGP";
const attributionWindowDays = () => Math.max(1, Number(process.env.META_ADS_ATTRIBUTION_DAYS) || 28);

const loadDataset = async (tenantId, datasetId) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_conversion_datasets WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(datasetId) || 0]);
  if (!rows[0]) throw httpError(404, "Conversion dataset not found");
  return rows[0];
};

const datasetToken = async (tenantId, dataset) => {
  const own = decryptSecret(dataset.access_token_encrypted);
  if (own) return { token: own, account: null };
  const found = await anyTenantToken(tenantId, { businessId: dataset.business_id });
  if (!found) throw httpError(409, "No connected Meta ad account with a valid token. Reconnect from \"ربط الحساب\" or give the dataset its own token.", "META_ADS_NOT_CONNECTED");
  return found;
};

const latestClick = async (tenantId, { customerId, conversationKey, channel, before = null }) => {
  if (!customerId && !conversationKey) return null;
  const { rows } = await db.query(
    `SELECT * FROM meta_ads_ad_clicks
      WHERE tenant_id = $1 AND (($2::bigint IS NOT NULL AND customer_id = $2::bigint) OR ($3::text <> '' AND conversation_key = $3::text))
        AND ($4::text = '' OR channel = $4::text) AND clicked_at <= COALESCE($5::timestamptz, NOW())
      ORDER BY clicked_at DESC LIMIT 1`,
    [tenantId, Number(customerId) || null, text(conversationKey), text(channel), before],
  );
  return rows[0] || null;
};

const loadCustomer = async (tenantId, customerId) => {
  if (!Number(customerId)) return null;
  const { rows } = await db.query(`SELECT id, name, phone, email FROM customers WHERE tenant_id = $1 AND id = $2`, [tenantId, Number(customerId)]);
  return rows[0] || null;
};

const pageAndIgFor = async (tenantId) => {
  const { rows } = await db.query(
    `SELECT page_id, instagram_user_id FROM meta_ads_accounts WHERE tenant_id = $1 AND page_id IS NOT NULL ORDER BY last_synced_at DESC NULLS LAST, id LIMIT 1`,
    [tenantId],
  );
  return rows[0] || {};
};

// Builds the single `data[]` item Meta expects.
export const buildEventPayload = async (tenantId, dataset, {
  eventName, eventId, eventTime = null, value = null, currency = null, customerId = null, conversationKey = "", click = null,
  phone = "", email = "", extraUserData = {}, actionSource = null, customData = {},
}) => {
  const channel = text(dataset.channel) || "website";
  const customer = await loadCustomer(tenantId, customerId);
  const userData = { ...extraUserData };
  const ph = hashPhone(phone || customer?.phone);
  const em = hashEmail(email || customer?.email);
  if (ph) userData.ph = [ph];
  if (em) userData.em = [em];
  if (customer?.id) userData.external_id = [sha256(`${tenantId}:${customer.id}`)];
  const item = {
    event_name: text(eventName) || "Purchase",
    event_time: Math.floor((eventTime ? new Date(eventTime).getTime() : Date.now()) / 1000),
    event_id: text(eventId) || crypto.randomUUID(),
    action_source: actionSource || (MESSAGING.has(channel) ? "business_messaging" : "website"),
  };
  if (item.action_source === "business_messaging") {
    item.messaging_channel = channel;
    const adClick = click || (await latestClick(tenantId, { customerId, conversationKey, channel }));
    const ids = await pageAndIgFor(tenantId);
    if (channel === "whatsapp") {
      const waba = text(dataset.business_id || process.env.META_ADS_WABA_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
      if (waba) userData.whatsapp_business_account_id = waba;
      if (adClick?.ctwa_clid) userData.ctwa_clid = adClick.ctwa_clid;
    } else if (channel === "messenger") {
      const pageId = text(dataset.business_id || ids.page_id);
      if (pageId) userData.page_id = pageId;
      if (adClick?.contact_handle) userData.page_scoped_user_id = adClick.contact_handle;
    } else if (channel === "instagram") {
      const igId = text(dataset.business_id || ids.instagram_user_id);
      if (igId) userData.ig_account_id = igId;
      if (adClick?.contact_handle) userData.ig_sid = adClick.contact_handle;
    }
  }
  item.user_data = userData;
  const custom = { ...customData };
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) {
    custom.value = Number(value);
    custom.currency = text(currency) || storeCurrency();
  }
  if (Object.keys(custom).length) item.custom_data = custom;
  return item;
};

// Sends one logged event row (its stored payload). Updates the row and the dataset.
export const deliverEventRow = async (tenantId, rowId, { testEventCode = "" } = {}) => {
  const { rows } = await db.query(`SELECT * FROM meta_ads_conversion_events WHERE tenant_id = $1 AND id = $2`, [tenantId, rowId]);
  const row = rows[0];
  if (!row) throw httpError(404, "Conversion event not found");
  const dataset = await loadDataset(tenantId, row.dataset_id);
  const item = row.payload?.data_item || row.payload;
  try {
    const { token } = await datasetToken(tenantId, dataset);
    const params = { data: [item] };
    const code = text(testEventCode || row.payload?.test_event_code);
    if (code) params.test_event_code = code;
    const result = await graphPost(`/${dataset.dataset_id}/events`, token, params);
    await db.query(
      `UPDATE meta_ads_conversion_events SET status = 'sent', attempts = attempts + 1, error = NULL, sent_at = NOW() WHERE id = $1`,
      [row.id],
    );
    await db.query(`UPDATE meta_ads_conversion_datasets SET last_event_at = NOW(), updated_at = NOW() WHERE id = $1`, [dataset.id]);
    return { id: row.id, status: "sent", events_received: Number(result?.events_received) || 0, fbtrace_id: text(result?.fbtrace_id) };
  } catch (error) {
    const message = clip(error?.userMessage || error?.message || "send failed", 1000);
    await db.query(`UPDATE meta_ads_conversion_events SET status = 'failed', attempts = attempts + 1, error = $2 WHERE id = $1`, [row.id, message]);
    await db.query(`UPDATE meta_ads_conversion_datasets SET failure_count = failure_count + 1, updated_at = NOW() WHERE id = $1`, [dataset.id]);
    return { id: row.id, status: "failed", error: message };
  }
};

const logEvent = async (tenantId, dataset, item, { customerId = null, leadLabel = null, testEventCode = "", meta = {} }) => {
  const { rows } = await db.query(
    `INSERT INTO meta_ads_conversion_events (tenant_id, dataset_id, event_time, event_name, event_id, status, channel, customer_id, lead_label, payload)
     VALUES ($1,$2,to_timestamp($3),$4,$5,'pending',$6,$7,$8,$9::jsonb) RETURNING id`,
    [
      tenantId, dataset.id, item.event_time, item.event_name, item.event_id, dataset.channel, Number(customerId) || null, clip(leadLabel, 255) || null,
      JSON.stringify({ data_item: item, test_event_code: text(testEventCode) || undefined, ...meta }),
    ],
  );
  return rows[0].id;
};

/**
 * sendConversionEvent(tenantId, { datasetId, eventName, customerId, value, currency, eventId, channel,
 *   conversationKey, eventTime, leadLabel, phone, email }) → { id, status }
 * `channel` picks the dataset when datasetId is not given.
 */
export const sendConversionEvent = async (tenantId, input = {}) => {
  let dataset;
  if (input.datasetId) dataset = await loadDataset(tenantId, input.datasetId);
  else {
    const { rows } = await db.query(
      `SELECT * FROM meta_ads_conversion_datasets WHERE tenant_id = $1 AND enabled = TRUE AND channel = $2 ORDER BY id LIMIT 1`,
      [tenantId, text(input.channel) || "website"],
    );
    dataset = rows[0];
    if (!dataset) throw httpError(404, "No enabled conversion dataset for this channel");
  }
  if (!dataset.enabled && !input.force) throw httpError(409, "This conversion dataset is disabled");
  if (input.eventId) {
    const { rows: existing } = await db.query(
      `SELECT id, status FROM meta_ads_conversion_events WHERE tenant_id = $1 AND dataset_id = $2 AND event_id = $3 AND event_name = $4 LIMIT 1`,
      [tenantId, dataset.id, text(input.eventId), text(input.eventName) || "Purchase"],
    );
    if (existing[0]) return { id: existing[0].id, status: existing[0].status, duplicate: true };
  }
  const item = await buildEventPayload(tenantId, dataset, input);
  const id = await logEvent(tenantId, dataset, item, { customerId: input.customerId, leadLabel: input.leadLabel, testEventCode: input.testEventCode, meta: input.meta || {} });
  const result = await deliverEventRow(tenantId, id, { testEventCode: input.testEventCode });
  return { id, status: result.status, error: result.error, events_received: result.events_received };
};

export const testConversionDataset = async (tenantId, datasetId) => {
  const dataset = await loadDataset(tenantId, datasetId);
  const messaging = MESSAGING.has(text(dataset.channel));
  const result = await sendConversionEvent(tenantId, {
    datasetId: dataset.id,
    eventName: messaging ? "LeadSubmitted" : "PageView",
    eventId: `test-${crypto.randomUUID()}`,
    testEventCode: text(process.env.META_ADS_TEST_EVENT_CODE),
    leadLabel: "Test event",
    force: true,
    // A test from the record page has no real person; website events still need one identifier.
    extraUserData: messaging ? {} : { client_user_agent: "M1 ERP connection test", external_id: [sha256(`test:${tenantId}`)] },
    actionSource: messaging ? null : "website",
  });
  if (result.status !== "sent") throw httpError(502, result.error || "Meta refused the test event");
  return { ok: true, events_received: result.events_received || 0, id: result.id };
};

// leadgen → "LeadSubmitted" when the tenant has a dataset for the lead's platform.
export const sendLeadConversion = async (tenantId, { leadId, lead = {}, contact = {}, customerId = null }) => {
  if (!isReady()) return null;
  const platform = text(lead.platform).toLowerCase();
  const wanted = platform === "ig" || platform === "instagram" ? ["instagram", "website"] : ["messenger", "website"];
  const { rows } = await db.query(
    `SELECT * FROM meta_ads_conversion_datasets WHERE tenant_id = $1 AND enabled = TRUE AND channel = ANY($2::text[])
      ORDER BY array_position($2::text[], channel), id LIMIT 1`,
    [tenantId, wanted],
  );
  const dataset = rows[0];
  if (!dataset) return null;
  // Instant-form leads are CRM events: Meta matches them by lead_id.
  return sendConversionEvent(tenantId, {
    datasetId: dataset.id,
    eventName: "LeadSubmitted",
    eventId: `lead-${text(lead.id) || leadId}`,
    customerId,
    phone: contact.phone,
    email: contact.email,
    leadLabel: contact.name || contact.phone || null,
    actionSource: "system_generated",
    extraUserData: text(lead.id) ? { lead_id: Number(lead.id) || text(lead.id) } : {},
    customData: { lead_event_source: "M1 ERP", event_source: "crm" },
  });
};

// ------------------------------------------------------------------ job work

export const retryFailedEvents = async ({ limit = 100 } = {}) => {
  const { rows } = await db.query(
    `SELECT id, tenant_id FROM meta_ads_conversion_events WHERE status = 'failed' AND attempts < $1 ORDER BY id LIMIT $2`,
    [MAX_ATTEMPTS, limit],
  );
  let sent = 0;
  for (const row of rows) {
    try {
      const result = await deliverEventRow(row.tenant_id, row.id);
      if (result.status === "sent") sent += 1;
    } catch (error) {
      warn("capi-retry", error, { tenant_id: row.tenant_id, id: row.id });
    }
  }
  return { retried: rows.length, sent };
};

const orderTotal = (order) => {
  for (const key of ["original_total", "total_amount", "total", "total_price", "grand_total"]) {
    const value = Number(order[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
};

const CANCELLED = new Set(["cancelled", "canceled", "returned", "rejected", "void", "deleted"]);

// "Purchase" for every NEW order whose customer clicked an ad (any channel) in the
// attribution window before the order. The cursor makes each order looked at once.
export const enqueuePurchaseEvents = async (tenantId) => {
  const { rows: datasets } = await db.query(
    `SELECT * FROM meta_ads_conversion_datasets WHERE tenant_id = $1 AND enabled = TRUE ORDER BY id`,
    [tenantId],
  );
  if (!datasets.length) return { orders: 0, sent: 0 };
  const { rows: cursorRows } = await db.query(`SELECT last_order_id FROM meta_ads_capi_cursors WHERE tenant_id = $1`, [tenantId]);
  if (!cursorRows[0]) {
    // First run: start from now; history is never back-filled.
    const { rows: maxRows } = await db.query(`SELECT COALESCE(MAX(id), 0) AS max_id FROM orders WHERE tenant_id = $1`, [tenantId]);
    await db.query(
      `INSERT INTO meta_ads_capi_cursors (tenant_id, last_order_id) VALUES ($1,$2) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, Number(maxRows[0]?.max_id) || 0],
    );
    return { orders: 0, sent: 0, initialised: true };
  }
  const cursor = Number(cursorRows[0].last_order_id) || 0;
  const { rows: orders } = await db.query(
    `SELECT * FROM orders WHERE tenant_id = $1 AND id > $2 ORDER BY id LIMIT 300`,
    [tenantId, cursor],
  );
  if (!orders.length) return { orders: 0, sent: 0 };
  const byChannel = new Map();
  for (const dataset of datasets) if (!byChannel.has(dataset.channel)) byChannel.set(dataset.channel, dataset);
  const { canonicalPhoneKey } = await import("../../../utils/phoneSearch.js");
  let sent = 0;
  let maxId = cursor;
  for (const order of orders) {
    maxId = Math.max(maxId, Number(order.id));
    if (CANCELLED.has(text(order.status).toLowerCase())) continue;
    const created = order.created_at || new Date();
    const phoneKey = canonicalPhoneKey(order.customer_phone);
    const { rows: clicks } = await db.query(
      `SELECT * FROM meta_ads_ad_clicks
        WHERE tenant_id = $1 AND clicked_at <= $2::timestamptz AND clicked_at >= $2::timestamptz - ($3::int * INTERVAL '1 day')
          AND (($4::bigint IS NOT NULL AND customer_id = $4::bigint)
            OR ($5::text <> '' AND channel = 'whatsapp' AND RIGHT(regexp_replace(COALESCE(contact_handle,''), '\\D', '', 'g'), 10) = $5::text)
            OR ($6::text <> '' AND conversation_key = $6::text))
        ORDER BY clicked_at DESC LIMIT 1`,
      [tenantId, created, attributionWindowDays(), Number(order.customer_id) || null, phoneKey.length === 10 ? phoneKey : "", text(order.ai_agent_conversation_id)],
    );
    const click = clicks[0];
    if (!click) continue;
    const dataset = byChannel.get(click.channel) || byChannel.get("website");
    if (!dataset) continue;
    try {
      const result = await sendConversionEvent(tenantId, {
        datasetId: dataset.id,
        eventName: "Purchase",
        eventId: `order-${order.id}`,
        eventTime: created,
        value: orderTotal(order),
        currency: storeCurrency(),
        customerId: order.customer_id || click.customer_id,
        phone: order.customer_phone,
        click,
        leadLabel: text(order.customer_name) || click.contact_name || null,
        meta: { order_id: order.id, click_id: click.id },
      });
      if (result.status === "sent") sent += 1;
    } catch (error) {
      warn("capi-purchase", error, { tenant_id: tenantId, order: order.id });
    }
  }
  await db.query(`UPDATE meta_ads_capi_cursors SET last_order_id = GREATEST(last_order_id, $2), updated_at = NOW() WHERE tenant_id = $1`, [tenantId, maxId]);
  if (sent) log("capi-purchase", { tenant_id: tenantId, sent });
  return { orders: orders.length, sent };
};

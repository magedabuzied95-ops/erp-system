/*
 * WABA-level webhook events (everything on the Cloud callback whose field is NOT "messages").
 *
 * Meta posts these to the same callback as messages, with object "whatsapp_business_account",
 * entry[].id = the WABA id. Most of them carry no phone_number_id — only the WABA and sometimes
 * the display number — so the tenant and the integration row are resolved from
 * whatsapp_cloud_integrations by waba_id (+ display number when given).
 *
 * dispatchWabaEvents is called fire-and-forget after the webhook has been acknowledged and its
 * signature verified. Every change is handled in its own try/catch: one bad event never affects
 * the others, and nothing here can throw back into the inbound message path.
 */

import db from "../../../database/db.js";
import { emitToRooms } from "../../../utils/socket.js";
import { cloudConfig } from "../../../services/whatsappCloudProvider.js";
import { appendChannelOutboundSupportReply } from "../../../services/aiSupportLogService.js";
import { autoRegisterWhatsappCustomer } from "../../../services/whatsappCustomerAutoRegistrationService.js";
import { applyTemplateWebhookEvent } from "../templateEvents.js";
import { ensureWaConnectSchema, refreshIntegrationLiveStatus } from "./connectService.js";

const text = (value) => String(value ?? "").trim();
const digits = (value) => text(value).replace(/\D/g, "");

const TEMPLATE_FIELDS = new Set(["message_template_status_update", "template_category_update", "message_template_quality_update"]);

const envTenantId = () => {
  const parsed = Number(process.env.WHATSAPP_TENANT_ID || 1);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 1;
};

/* ── Resolution ───────────────────────────────────────────────────────────────────────────── */

const rowsForWaba = async ({ wabaId = "", phoneNumberId = "", displayPhone = "" } = {}) => {
  const result = await db.query(
    `
    SELECT * FROM whatsapp_cloud_integrations
    WHERE ($1::text <> '' AND waba_id = $1::text)
       OR ($2::text <> '' AND phone_number_id = $2::text)
    ORDER BY updated_at DESC
    `,
    [text(wabaId), text(phoneNumberId)]
  );
  let rows = result.rows;
  if (text(phoneNumberId)) {
    const exact = rows.filter((row) => row.phone_number_id === text(phoneNumberId));
    if (exact.length) rows = exact;
  }
  const wanted = digits(displayPhone);
  if (wanted) {
    const matched = rows.filter((row) => digits(row.display_phone_number) && digits(row.display_phone_number) === wanted);
    // A display number that matches none of our rows is a number we do not hold; touching every
    // row of the WABA instead would mislabel the others.
    rows = matched;
  }
  return rows;
};

const tenantsFor = ({ rows, wabaId }) => {
  const tenants = [...new Set(rows.map((row) => Number(row.tenant_id) || 0).filter((id) => id > 0))];
  if (!tenants.length && text(wabaId) && text(wabaId) === cloudConfig().businessAccountId) tenants.push(envTenantId());
  return tenants;
};

const notice = (rows, payload) => {
  for (const tenantId of new Set(rows.map((row) => Number(row.tenant_id) || 0))) {
    try {
      emitToRooms([`tenant:${tenantId || envTenantId()}`], "whatsapp:account_notice", { ...payload, at: new Date().toISOString() });
    } catch {
      // Socket not ready (boot / tests) — the row update is what matters.
    }
  }
};

const updateRows = async (rows, sql, params = []) => {
  const ids = rows.map((row) => Number(row.id)).filter(Boolean);
  if (!ids.length) return 0;
  const result = await db.query(`UPDATE whatsapp_cloud_integrations SET ${sql}, updated_at = NOW() WHERE id = ANY($1::bigint[])`, [ids, ...params]);
  return result.rowCount || 0;
};

/* ── Handlers ─────────────────────────────────────────────────────────────────────────────── */

const handleTemplateEvent = async ({ wabaId, field, value }) => {
  const rows = await rowsForWaba({ wabaId });
  const tenants = tenantsFor({ rows, wabaId });
  let updated = 0;
  for (const tenantId of tenants) {
    const result = await applyTemplateWebhookEvent({ tenantId, wabaId, field, value });
    updated += Number(result?.updated || 0);
  }
  return { tenants: tenants.length, updated };
};

const handleQualityUpdate = async ({ wabaId, value }) => {
  const rows = await rowsForWaba({ wabaId, displayPhone: value?.display_phone_number });
  const event = text(value?.event).toUpperCase();
  const limit = text(value?.current_limit);
  const updated = await updateRows(
    rows,
    `quality_event = NULLIF($2::text, ''), messaging_limit_tier = COALESCE(NULLIF($3::text, ''), messaging_limit_tier)`,
    [event, limit]
  );
  notice(rows, {
    kind: "quality",
    event,
    current_limit: limit,
    old_limit: text(value?.old_limit),
    display_phone_number: text(value?.display_phone_number),
    integration_ids: rows.map((row) => String(row.id)),
  });
  // The event names the change, not the colour; read the actual quality rating back in the background.
  for (const row of rows.filter((item) => item.status === "connected")) {
    setTimeout(() => { refreshIntegrationLiveStatus(row).catch(() => {}); }, 0);
  }
  return { rows: rows.length, updated, event, limit };
};

const handleNameUpdate = async ({ wabaId, value }) => {
  const rows = await rowsForWaba({ wabaId, displayPhone: value?.display_phone_number });
  const decision = text(value?.decision).toUpperCase();
  const requested = text(value?.requested_verified_name);
  const reason = text(value?.rejection_reason);
  const updated = decision === "APPROVED"
    ? await updateRows(
      rows,
      `verified_name = COALESCE(NULLIF($2::text, ''), verified_name), name_status = 'APPROVED', new_name_status = NULL,
       requested_verified_name = NULLIF($2::text, ''), name_rejection_reason = NULL`,
      [requested]
    )
    : await updateRows(
      rows,
      `new_name_status = NULLIF($2::text, ''), requested_verified_name = NULLIF($3::text, ''), name_rejection_reason = NULLIF($4::text, '')`,
      [decision, requested, reason === "NONE" ? "" : reason]
    );
  notice(rows, { kind: "display_name", decision, requested_verified_name: requested, rejection_reason: reason, integration_ids: rows.map((row) => String(row.id)) });
  return { rows: rows.length, updated, decision };
};

const REMOVAL_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_DELETED"]);
const SUSPEND_EVENTS = new Set(["BANNED", "DISABLED_UPDATE"]);

const handleAccountUpdate = async ({ wabaId, value }) => {
  const rows = await rowsForWaba({ wabaId, displayPhone: value?.phone_number });
  const event = text(value?.event).toUpperCase();
  const banState = text(value?.ban_info?.waba_ban_state).toUpperCase();
  const detail = {
    event,
    ban_state: banState,
    ban_date: text(value?.ban_info?.waba_ban_date),
    violation_type: text(value?.violation_info?.violation_type),
    restriction_info: value?.restriction_info || null,
  };
  const reason = [event, banState, detail.violation_type].filter(Boolean).join(" · ");
  const removed = REMOVAL_EVENTS.has(event);
  const reinstated = !removed && banState === "REINSTATE";
  const suspended = !removed && !reinstated
    && (event === "BANNED" || banState === "DISABLE" || (SUSPEND_EVENTS.has(event) && banState !== "SCHEDULE_FOR_DISABLE"));
  const sets = ["last_account_event = $2::text", "last_account_event_at = NOW()", "last_account_event_detail = $3::jsonb"];
  const params = [event, JSON.stringify(detail)];
  if (removed) {
    params.push(reason);
    sets.push("status = 'disconnected'", "disconnected_at = NOW()", "webhook_subscribed = FALSE", "disconnect_reason = $4::text");
  } else if (suspended) {
    params.push(reason);
    sets.push("status = CASE WHEN status = 'connected' THEN 'suspended' ELSE status END", "disconnect_reason = $4::text");
  } else if (reinstated) {
    sets.push("status = CASE WHEN status = 'suspended' THEN 'connected' ELSE status END", "disconnect_reason = NULL");
  }
  const updated = await updateRows(rows, sets.join(", "), params);
  notice(rows, { kind: "account", ...detail, integration_ids: rows.map((row) => String(row.id)) });
  return { rows: rows.length, updated, event, ban_state: banState };
};

const handleAccountReview = async ({ wabaId, value }) => {
  const rows = await rowsForWaba({ wabaId });
  const decision = text(value?.decision).toUpperCase();
  const updated = await updateRows(rows, `account_review_status = NULLIF($2::text, '')`, [decision]);
  notice(rows, { kind: "account_review", decision, integration_ids: rows.map((row) => String(row.id)) });
  return { rows: rows.length, updated, decision };
};

const handleCapabilityUpdate = async ({ wabaId, value }) => {
  const rows = await rowsForWaba({ wabaId });
  const capabilities = {};
  for (const key of ["max_daily_conversation_per_phone", "max_phone_numbers_per_business", "max_daily_conversations_per_business", "max_phone_numbers_per_waba"]) {
    if (value?.[key] !== undefined && value?.[key] !== null) capabilities[key] = value[key];
  }
  capabilities.updated_at = new Date().toISOString();
  const updated = await updateRows(rows, `business_capabilities = COALESCE(business_capabilities, '{}'::jsonb) || $2::jsonb`, [JSON.stringify(capabilities)]);
  return { rows: rows.length, updated, capabilities };
};

const echoText = (echo = {}) => {
  const type = text(echo?.type) || "text";
  if (type === "text") return text(echo?.text?.body);
  const media = echo?.[type] || {};
  const caption = text(media?.caption);
  if (caption) return caption;
  if (type === "interactive") return text(echo?.interactive?.body?.text) || "[interactive]";
  if (type === "template") return `[template: ${text(echo?.template?.name) || "?"}]`;
  return `[${type}]`;
};

/*
 * Messages the owner typed on the phone in the WhatsApp Business app (coexistence). They are
 * OURS — stored as outbound staff rows, never as a customer writing in. Only for a number that is
 * connected here, which is the same gate the inbound Cloud path uses.
 */
const handleMessageEchoes = async ({ wabaId, value }) => {
  const phoneNumberId = text(value?.metadata?.phone_number_id);
  const rows = (await rowsForWaba({ wabaId: phoneNumberId ? "" : wabaId, phoneNumberId })).filter((row) => row.status === "connected");
  const row = rows[0];
  const echoes = Array.isArray(value?.message_echoes) ? value.message_echoes : [];
  if (!row) return { stored: 0, skipped: echoes.length, reason: "number_not_connected" };
  const tenantId = Number(row.tenant_id) || envTenantId();
  let stored = 0;
  for (const echo of echoes) {
    try {
      const to = digits(echo?.to);
      const id = text(echo?.id);
      const message = echoText(echo);
      if (!to || !message) continue;
      const sessionId = `whatsapp:${to}`;
      const saved = await appendChannelOutboundSupportReply({
        tenantId,
        sessionId,
        message,
        messageType: "text",
        channel: "whatsapp",
        senderType: "staff",
        staffMessage: message,
        staffUserName: "WhatsApp Business app",
        source: "whatsapp_cloud_smb_echo",
        sourcePath: "whatsapp_cloud_smb_echo",
        insertSource: "whatsapp_cloud_smb_echo",
        deliveryStatus: "sent",
        externalMessageId: id,
        providerMessageId: id,
        remoteJid: sessionId,
        resolvedReplyJid: sessionId,
        resolvedPhone: to,
        sessionStatus: "ai_active",
        preserveExistingOnProviderMatch: true,
      });
      if (saved) {
        stored += 1;
        try {
          emitToRooms([`tenant:${tenantId}`], "ai_inbox:message", {
            tenant_id: tenantId,
            session_id: sessionId,
            channel: "whatsapp",
            message: { ...saved, from_me: true, direction: "outbound" },
          });
        } catch {
          // socket not ready
        }
      }
    } catch (error) {
      console.warn("[wa-waba-event:echo-failed]", { message_id: text(echo?.id), message: error?.message || String(error) });
    }
  }
  return { stored, total: echoes.length };
};

// Contacts from the Business app (coexistence state sync) → the customer book.
const handleAppStateSync = async ({ wabaId, value }) => {
  const phoneNumberId = text(value?.metadata?.phone_number_id);
  const row = (await rowsForWaba({ wabaId: phoneNumberId ? "" : wabaId, phoneNumberId }))[0];
  const items = Array.isArray(value?.state_sync) ? value.state_sync : [];
  if (!row) return { upserted: 0, skipped: items.length, reason: "number_unknown" };
  const tenantId = Number(row.tenant_id) || envTenantId();
  let upserted = 0;
  for (const item of items) {
    try {
      if (text(item?.type) !== "contact" || text(item?.action).toLowerCase() === "remove") continue;
      const contact = item?.contact || {};
      const result = await autoRegisterWhatsappCustomer({
        tenantId,
        phone: contact.phone_number,
        whatsappName: text(contact.full_name) || text(contact.first_name),
      });
      if (result?.created || result?.updated) upserted += 1;
    } catch (error) {
      console.warn("[wa-waba-event:contact-sync-failed]", { message: error?.message || String(error) });
    }
  }
  return { upserted, total: items.length };
};

const HANDLERS = {
  phone_number_quality_update: handleQualityUpdate,
  phone_number_name_update: handleNameUpdate,
  account_update: handleAccountUpdate,
  account_review_update: handleAccountReview,
  business_capability_update: handleCapabilityUpdate,
  smb_message_echoes: handleMessageEchoes,
  smb_app_state_sync: handleAppStateSync,
};

/* ── Entry ────────────────────────────────────────────────────────────────────────────────── */

export const dispatchWabaEvents = async ({ body } = {}) => {
  if (!body || typeof body !== "object" || text(body.object) !== "whatsapp_business_account") return { handled: 0 };
  const entries = Array.isArray(body.entry) ? body.entry : [];
  let handled = 0;
  let schemaReady = false;
  for (const entry of entries) {
    const wabaId = text(entry?.id);
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const field = text(change?.field);
      if (!field || field === "messages") continue;
      const value = change?.value || {};
      try {
        if (!schemaReady) {
          await ensureWaConnectSchema();
          schemaReady = true;
        }
        let result;
        if (TEMPLATE_FIELDS.has(field)) result = await handleTemplateEvent({ wabaId, field, value });
        else if (HANDLERS[field]) result = await HANDLERS[field]({ wabaId, value });
        else if (field === "history") result = { logged: true, chunks: Array.isArray(value?.history) ? value.history.length : 0 };
        else result = { unhandled: true };
        handled += 1;
        console.info("[wa-waba-event]", { field, waba_id: wabaId, ...result });
      } catch (error) {
        console.warn("[wa-waba-event-failed]", { field, waba_id: wabaId, message: error?.message || String(error) });
      }
    }
  }
  return { handled };
};

export default dispatchWabaEvents;

// Campaigns in "template" mode: one APPROVED WhatsApp message template, sent through the official
// Cloud API to every customer in a broadcast's audience.
//
// Why this is not the WhatsApp queue: the queue paces Evolution (WhatsApp Web) sends and only knows
// how to pick a template per automation type. A campaign names its own template and its own variable
// mapping, so it is delivered here instead — with the same audience rules (opt-out, frequency cap,
// quiet hours: all decided by marketingBroadcastService before a recipient row exists) and its own
// pacer (~20 messages a second, well under Cloud API throughput limits).
//
// Delivery is resumable and idempotent per recipient: each row is claimed with an atomic
// UPDATE … WHERE status = 'pending' before its message is posted, so a restart (or a second server
// process) can pick a half-finished campaign up without anybody receiving it twice.

import db from "../database/db.js";
import { cloudErrorMeaning, graphRequest } from "./whatsappCloudProvider.js";
import { buildTemplateMessage, resolveSendCredentials } from "./whatsappApiAccessService.js";
import { ensureWhatsappTemplateSchema } from "./whatsappTemplateStudioService.js";
import { normalizeWhatsappPhone } from "../utils/whatsappIdentity.js";
import { recordCampaignSendsSafe } from "../modules/campaignAttribution/campaignInbox.js";

const text = (value) => String(value ?? "").trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const httpError = (message, status = 400, code = "CAMPAIGN_INVALID") => Object.assign(new Error(message), { status, code });

export const CAMPAIGN_SEND_INTERVAL_MS = 50; // ~20 messages a second
export const VARIABLE_SOURCES = Object.freeze(["customer_name", "customer_phone", "static"]);

/* ------------------------------------------------------------------ pure helpers (exported for tests) */

/** The distinct {{n}} numbers in a template text, ascending. */
export const templateVariableNumbers = (value = "") =>
  [...new Set([...String(value).matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);

export const templateVariableCount = (value = "") => {
  const numbers = templateVariableNumbers(value);
  return numbers.length ? Math.max(...numbers) : 0;
};

/** Cleans what the UI sent: an array of {source, value}, one per {{n}}, max 20. */
export const normalizeTemplateVariables = (input) =>
  (Array.isArray(input) ? input : []).slice(0, 20).map((item) => {
    const source = VARIABLE_SOURCES.includes(text(item?.source)) ? text(item.source) : "static";
    return { source, value: text(item?.value).slice(0, 500) };
  });

/**
 * One customer's values for {{1}}…{{n}}. A blank value is never sent — Meta refuses an empty
 * parameter — so a missing name falls back to the mapping's own value, then to the template's
 * approved example for that slot.
 */
export const resolveTemplateVariableValues = ({ count = 0, mapping = [], customer = {}, examples = [] } = {}) =>
  Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => {
    const item = mapping[index] || { source: "static", value: "" };
    let value = "";
    if (item.source === "customer_name") value = text(customer.name);
    else if (item.source === "customer_phone") value = text(customer.phone);
    else value = text(item.value);
    if (!value && item.source !== "static") value = text(item.value);
    if (!value) value = text(examples[index]);
    return value || "-";
  });

/** The body as the customer will read it. */
export const fillTemplateBody = (body = "", values = []) =>
  String(body).replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index) => {
    const value = values[Number(index) - 1];
    return value === undefined || value === "" ? whole : String(value);
  });

/**
 * Why a template cannot be used for a campaign, or "" when it can. Checked before a campaign is
 * created, scheduled and started — a template can be paused by Meta between any two of those.
 */
export const templateBlockReason = (template) => {
  if (!template) return "template_not_found";
  if (text(template.status).toUpperCase() !== "APPROVED") return "template_not_approved";
  if (["IMAGE", "VIDEO", "DOCUMENT"].includes(text(template.header_format)) && !text(template.header_media_url)) {
    return "template_header_media_missing";
  }
  return "";
};

/**
 * The full Graph payload for one recipient. Body parameters come from the mapping; a text-header
 * variable, a media header, a dynamic URL button and a copy-code button reuse the values the
 * template was approved with (header_example, header_media_url, button.example).
 */
export const buildCampaignTemplatePayload = ({ template = {}, to = "", bodyValues = [] } = {}) => {
  // Customers are stored as local Egyptian numbers (010…); the Cloud API needs 2010….
  const message = buildTemplateMessage({
    to: normalizeWhatsappPhone(to) || to,
    templateName: template.name,
    language: template.language || "ar",
    variables: bodyValues,
  });
  const components = [];
  const format = text(template.header_format).toUpperCase();
  if (format === "TEXT" && templateVariableCount(template.header_text) > 0) {
    components.push({ type: "header", parameters: [{ type: "text", text: text(template.header_example) || "-" }] });
  } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(format)) {
    const kind = format.toLowerCase();
    components.push({ type: "header", parameters: [{ type: kind, [kind]: { link: text(template.header_media_url) } }] });
  }
  components.push(...(message.template.components || []));
  (Array.isArray(template.buttons) ? template.buttons : []).forEach((button, index) => {
    if (button?.type === "URL" && templateVariableCount(button.url) > 0) {
      components.push({ type: "button", sub_type: "url", index: String(index), parameters: [{ type: "text", text: text(button.example) || "-" }] });
    } else if (button?.type === "COPY_CODE") {
      components.push({ type: "button", sub_type: "copy_code", index: String(index), parameters: [{ type: "coupon_code", coupon_code: text(button.example) || "-" }] });
    }
  });
  if (components.length) message.template.components = components;
  else delete message.template.components;
  return message;
};

/** A scheduled campaign is due once its time has come. Mirrors the scheduler's SQL claim. */
export const isCampaignDue = (campaign = {}, now = new Date()) => {
  if (text(campaign.status) !== "scheduled" || !campaign.scheduled_at) return false;
  const at = new Date(campaign.scheduled_at).getTime();
  return Number.isFinite(at) && at <= (now instanceof Date ? now.getTime() : Number(now));
};

/** Last 10 digits — the same key the consent service matches phones on. */
export const phoneDedupeKey = (phone = "") => text(phone).replace(/\D/g, "").slice(-10);

/* ------------------------------------------------------------------ storage */

export const getCampaignTemplate = async ({ tenantId, templateId }) => {
  await ensureWhatsappTemplateSchema();
  const id = Number(templateId) || 0;
  if (!id) return null;
  const result = await db.query(`SELECT * FROM whatsapp_message_templates WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, id]);
  return result.rows[0] || null;
};

export const assertCampaignTemplateUsable = async ({ tenantId, templateId }) => {
  const template = await getCampaignTemplate({ tenantId, templateId });
  const reason = templateBlockReason(template);
  if (reason === "template_not_found") throw httpError("Template not found", 404, "CAMPAIGN_TEMPLATE_NOT_FOUND");
  if (reason === "template_not_approved") {
    throw httpError(`Template "${template.name}" is ${template.status}, only APPROVED templates can be sent`, 409, "CAMPAIGN_TEMPLATE_NOT_APPROVED");
  }
  if (reason === "template_header_media_missing") {
    throw httpError("This template has a media header but no media link saved for it", 409, "CAMPAIGN_TEMPLATE_MEDIA_MISSING");
  }
  return template;
};

export const listApprovedTemplates = async ({ tenantId }) => {
  await ensureWhatsappTemplateSchema();
  const result = await db.query(
    `SELECT id, name, language, category, header_format, header_text, header_media_url, body_text, body_examples, footer_text, buttons
       FROM whatsapp_message_templates
      WHERE tenant_id = $1 AND status = 'APPROVED'
      ORDER BY name, language`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    language: row.language,
    category: row.category,
    header_format: row.header_format || "NONE",
    header_text: row.header_text || "",
    header_media_missing: ["IMAGE", "VIDEO", "DOCUMENT"].includes(row.header_format) && !text(row.header_media_url),
    body_text: row.body_text || "",
    body_examples: Array.isArray(row.body_examples) ? row.body_examples : [],
    footer_text: row.footer_text || "",
    variable_count: templateVariableCount(row.body_text),
  }));
};

/* ------------------------------------------------------------------ delivery */

const running = new Set();
export const isCampaignDeliveryRunning = (broadcastId) => running.has(Number(broadcastId));

const RATE_LIMIT_MEANINGS = new Set(["app_rate_limit_reached", "waba_rate_limit_reached"]);
const FATAL_MEANINGS = new Set(["access_token_expired_or_invalid", "template_not_found_or_not_approved"]);

const finishCampaign = async ({ tenantId, broadcastId, status = "", lastError = "" }) => {
  const counts = await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent') AS sent,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) AS open
       FROM marketing_broadcast_recipients WHERE broadcast_id = $1`,
    [broadcastId]
  );
  const row = counts.rows[0] || {};
  const nextStatus = status || (Number(row.open) > 0 ? "sending" : "completed");
  await db.query(
    `UPDATE marketing_broadcasts
        SET recipients_sent = $3, recipients_failed = $4,
            status = CASE WHEN status = 'sending' THEN $5::varchar ELSE status END,
            last_error = CASE WHEN $6::text = '' THEN last_error ELSE $6::text END,
            updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2`,
    [tenantId, broadcastId, Number(row.sent) || 0, Number(row.failed) || 0, nextStatus, text(lastError).slice(0, 500)]
  );
};

const markRemaining = (broadcastId, reason) =>
  db.query(
    `UPDATE marketing_broadcast_recipients SET status = 'skipped', skip_reason = $2
      WHERE broadcast_id = $1 AND status = 'pending'`,
    [broadcastId, text(reason).slice(0, 40)]
  );

/**
 * Drains one campaign's pending recipients. Never throws: it runs detached from the request that
 * started it, so every failure ends up on the recipient row or the campaign's last_error.
 */
export const deliverTemplateCampaign = async ({ tenantId, broadcast, intervalMs = CAMPAIGN_SEND_INTERVAL_MS } = {}) => {
  const broadcastId = Number(broadcast?.id) || 0;
  if (!broadcastId || running.has(broadcastId)) return { started: false };
  running.add(broadcastId);
  let sent = 0;
  let failed = 0;
  try {
    // Rows a crashed run left mid-send: whether Meta got them is unknown, so they are not resent.
    await db.query(
      `UPDATE marketing_broadcast_recipients SET status = 'failed', skip_reason = 'interrupted', error_meaning = 'interrupted'
        WHERE broadcast_id = $1 AND status = 'sending'`,
      [broadcastId]
    );

    let template;
    try {
      template = await assertCampaignTemplateUsable({ tenantId, templateId: broadcast.template_id });
    } catch (error) {
      await markRemaining(broadcastId, "template_blocked");
      await finishCampaign({ tenantId, broadcastId, status: "failed", lastError: error.message });
      return { started: false, error: error.message };
    }
    let credentials;
    try {
      credentials = await resolveSendCredentials({ tenantId });
    } catch (error) {
      await markRemaining(broadcastId, "cloud_not_connected");
      await finishCampaign({ tenantId, broadcastId, status: "failed", lastError: error.message });
      return { started: false, error: error.message };
    }

    const mapping = normalizeTemplateVariables(broadcast.template_variables);
    const count = templateVariableCount(template.body_text);
    const examples = Array.isArray(template.body_examples) ? template.body_examples : [];

    for (let round = 0; ; round += 1) {
      // Stop button: re-read the campaign every batch.
      const current = await db.query(`SELECT status FROM marketing_broadcasts WHERE id = $1`, [broadcastId]);
      if (current.rows[0]?.status !== "sending") {
        await markRemaining(broadcastId, current.rows[0]?.status === "stopped" ? "stopped" : "not_sending");
        break;
      }
      const batch = await db.query(
        `SELECT r.id FROM marketing_broadcast_recipients r
          WHERE r.broadcast_id = $1 AND r.status = 'pending'
          ORDER BY r.id LIMIT 50`,
        [broadcastId]
      );
      if (!batch.rows.length) break;

      let fatal = "";
      // This batch's delivered sends, written into the inbox after it (see flush below).
      const delivered = [];
      for (const { id: recipientId } of batch.rows) {
        // The claim also re-checks consent: a customer who replied "stop" after the campaign was
        // built is not sent to.
        const claimed = await db.query(
          `UPDATE marketing_broadcast_recipients r
              SET status = 'sending'
             FROM customers c
            WHERE r.id = $1 AND r.status = 'pending'
              AND c.id = r.customer_id AND c.tenant_id = r.tenant_id
              AND c.marketing_opt_out_at IS NULL
          RETURNING r.id, r.phone, c.name AS customer_name`,
          [recipientId]
        );
        const row = claimed.rows[0];
        if (!row) {
          await db.query(
            `UPDATE marketing_broadcast_recipients SET status = 'skipped', skip_reason = 'opted_out' WHERE id = $1 AND status = 'pending'`,
            [recipientId]
          );
          continue;
        }
        const values = resolveTemplateVariableValues({ count, mapping, customer: { name: row.customer_name, phone: row.phone }, examples });
        let attempt = 0;
        for (;;) {
          try {
            const payload = buildCampaignTemplatePayload({ template, to: row.phone, bodyValues: values });
            const result = await graphRequest({
              path: `/${credentials.graphVersion}/${credentials.phoneNumberId}/messages`,
              method: "POST",
              body: payload,
              accessToken: credentials.accessToken,
            });
            await db.query(
              `UPDATE marketing_broadcast_recipients SET status = 'sent', sent_at = NOW(), message_id = $2 WHERE id = $1`,
              [row.id, text(result?.messages?.[0]?.id).slice(0, 200)]
            );
            sent += 1;
            delivered.push({ recipient: { phone: row.phone, customer_name: row.customer_name }, values, messageId: text(result?.messages?.[0]?.id) });
          } catch (error) {
            const graphCode = error?.details?.graph_code ?? null;
            const meaning = error?.details?.meaning || cloudErrorMeaning(graphCode) || "";
            if (RATE_LIMIT_MEANINGS.has(meaning) && attempt < 2) {
              attempt += 1;
              await sleep(10000 * attempt);
              continue;
            }
            await db.query(
              `UPDATE marketing_broadcast_recipients
                  SET status = 'failed', skip_reason = $2, error_code = $3, error_meaning = $4, error_message = $5
                WHERE id = $1`,
              [
                row.id,
                text(meaning || error?.code || "send_failed").slice(0, 40),
                graphCode === null ? text(error?.code).slice(0, 80) : String(graphCode),
                text(meaning).slice(0, 80),
                text(error?.message).slice(0, 500),
              ]
            );
            failed += 1;
            if (FATAL_MEANINGS.has(meaning)) fatal = `${meaning}: ${text(error?.message)}`;
          }
          break;
        }
        if (fatal) break;
        await sleep(intervalMs);
      }
      // The template as each customer received it goes into their inbox conversation (author chip
      // "حملة: <name>", wamid kept for quoted replies) and, with auto lead generation, opens their
      // lead + attribution. Detached: the pacer never waits on the inbox.
      if (delivered.length) {
        void recordCampaignSendsSafe({ tenantId, broadcast, template, phoneNumberId: credentials.phoneNumberId, sends: delivered });
      }
      if (fatal) {
        // A dead token or a template Meta no longer accepts fails every remaining recipient the
        // same way; stop instead of burning through the list.
        await markRemaining(broadcastId, "aborted");
        await finishCampaign({ tenantId, broadcastId, status: "failed", lastError: fatal });
        console.warn("[marketing-campaign] aborted", { tenant_id: tenantId, broadcast_id: broadcastId, reason: fatal });
        return { started: true, sent, failed, aborted: true };
      }
      if (round % 5 === 4) await finishCampaign({ tenantId, broadcastId, status: "sending" });
    }
    await finishCampaign({ tenantId, broadcastId });
    console.log("[marketing-campaign] delivered", { tenant_id: tenantId, broadcast_id: broadcastId, sent, failed });
    return { started: true, sent, failed };
  } catch (error) {
    console.error("[marketing-campaign] delivery error", { broadcast_id: broadcastId, message: error?.message });
    await finishCampaign({ tenantId, broadcastId, status: "failed", lastError: error?.message || "delivery_error" }).catch(() => {});
    return { started: true, sent, failed, error: error?.message };
  } finally {
    running.delete(broadcastId);
  }
};

export default deliverTemplateCampaign;

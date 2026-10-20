// A template campaign, written into each recipient's WhatsApp conversation.
//
// GENI shows a campaign send in the chat like any other message, so an agent opening the thread
// sees what the customer is answering. deliverTemplateCampaign used to post to Graph and record
// only the recipient row; the inbox never knew. Now each delivered batch is handed here
// (fire-and-forget — the send loop never waits on it) and every recipient gets:
//   • an outbound transcript row: the template as the phone shows it (header, filled body, footer,
//     buttons — utils/whatsappCtaTranscript.templateTranscript), the provider wamid kept so a reply
//     that quotes it resolves, and source_path "wa_campaign" + staff_user_name = the campaign name
//     so the inbox draws the chip "حملة: <name>" (author kind "campaign");
//   • the conversation mapping (ai_channel_conversations), created when missing — lead stage "new"
//     for a new one, an existing stage left alone;
//   • with auto lead generation on (the default), an attribution record "whatsapp_campaign" when
//     the conversation has none (attribution.js, mode "open").
//
// A campaign send is not a conversation event: the session keeps its status (preserveSessionState
// — a human takeover stays a takeover, the AI is not woken), and a system row is never unread.

import db from "../../database/db.js";
import { templateTranscript } from "../../utils/whatsappCtaTranscript.js";
import { normalizeWhatsappSessionId } from "../../utils/whatsappIdentity.js";
import { recordConversationTouch } from "./attribution.js";

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());

export const CAMPAIGN_SOURCE = "wa_campaign";

/** auto_lead_generation defaults ON (GENI's default); only an explicit false turns it off. */
export const autoLeadGenerationOn = (broadcast = {}) => broadcast?.auto_lead_generation !== false;

/**
 * The appendChannelOutboundSupportReply input for one delivered recipient. Pure (tests).
 * recipient = { phone, customer_name }, values = the {{n}} values the send carried.
 */
export const campaignTranscriptRow = ({ tenantId, broadcast = {}, template = {}, recipient = {}, values = [], messageId = "", phoneNumberId = "" } = {}) => {
  const sessionId = normalizeWhatsappSessionId("", recipient.phone);
  if (!sessionId) return null;
  const transcript = templateTranscript({
    template,
    bodyValues: values,
    // The same values buildCampaignTemplatePayload sends for a text header and a media header.
    headerValue: text(template.header_example),
    headerMediaUrl: text(template.header_media_url),
  });
  if (!transcript.message && !transcript.attachments.length) return null;
  return {
    tenantId,
    sessionId,
    message: transcript.message || `[${text(template.name) || "template"}]`,
    messageType: "template",
    suggestedActions: transcript.actions,
    visualAttachments: transcript.attachments,
    senderType: "system",
    // Not a staff user: the campaign's name, so the inbox chip can say which campaign it was.
    staffUserName: text(broadcast.name).slice(0, 120) || `#${broadcast.id}`,
    source: CAMPAIGN_SOURCE,
    sourcePath: CAMPAIGN_SOURCE,
    insertSource: CAMPAIGN_SOURCE,
    detectedIntent: CAMPAIGN_SOURCE,
    channel: "whatsapp",
    deliveryStatus: "sent",
    externalMessageId: text(messageId),
    providerMessageId: text(messageId),
    whatsappInstance: phoneNumberId ? `cloud:${phoneNumberId}` : "",
    remoteJid: sessionId,
    resolvedReplyJid: sessionId,
    resolvedPhone: sessionId.replace(/^whatsapp:/, ""),
    preserveExactMessage: true,
    upsertSession: true,
    preserveSessionState: true,
    sessionStatus: "ai_active",
    sessionSource: "whatsapp",
    sessionChannel: "whatsapp",
    sessionCustomerName: text(recipient.customer_name),
    confidence: 1,
  };
};

const ensureMapping = async ({ tenantId, sessionId, customerName, broadcast, autoLead }) => {
  const { ensureAiChannelAdapterSchema } = await import("../../services/aiChannelAdapterService.js");
  await ensureAiChannelAdapterSchema();
  const metadata = autoLead
    ? { campaign_lead: { broadcast_id: Number(broadcast.id) || null, name: text(broadcast.name), at: new Date().toISOString() } }
    : {};
  // Not upsertChannelConversationMapping: its lead_status defaults to 'new' and would reset a
  // stage the agent already set. Here a new conversation starts at the first stage and an
  // existing one keeps its own.
  await db.query(
    `INSERT INTO ai_channel_conversations AS c
       (tenant_id, channel, external_conversation_id, external_customer_id, lead_status, customer_name, metadata, updated_at)
     VALUES ($1::bigint, 'whatsapp', $2::text, $3::text, 'new', $4::text, $5::jsonb, NOW())
     ON CONFLICT (tenant_id, channel, external_conversation_id) DO UPDATE SET
       lead_status = CASE WHEN COALESCE(c.lead_status, '') = '' THEN 'new' ELSE c.lead_status END,
       customer_name = CASE WHEN COALESCE(c.customer_name, '') = '' THEN EXCLUDED.customer_name ELSE c.customer_name END,
       metadata = COALESCE(c.metadata, '{}'::jsonb) || EXCLUDED.metadata`,
    [Number(tenantId), sessionId, sessionId.replace(/^whatsapp:/, ""), text(customerName), JSON.stringify(metadata)]
  );
};

/**
 * Writes one delivered batch into the inbox. `sends` = [{ recipient: {phone, customer_name},
 * values, messageId }]. Never throws; returns how many rows were written.
 */
export const recordCampaignSends = async ({ tenantId, broadcast = {}, template = {}, phoneNumberId = "", sends = [] } = {}) => {
  if (!Number(tenantId) || !Array.isArray(sends) || !sends.length) return 0;
  const autoLead = autoLeadGenerationOn(broadcast);
  let written = 0;
  let appendChannelOutboundSupportReply;
  try {
    ({ appendChannelOutboundSupportReply } = await import("../../services/aiSupportLogService.js"));
  } catch (error) {
    console.warn("[campaign-inbox] transcript writer unavailable", { message: text(error?.message).slice(0, 200) });
    return 0;
  }
  for (const send of sends) {
    const row = campaignTranscriptRow({ tenantId, broadcast, template, recipient: send.recipient, values: send.values, messageId: send.messageId, phoneNumberId });
    if (!row) continue;
    try {
      const saved = await appendChannelOutboundSupportReply(row);
      // preserveSessionState kept the status AND the preview; the preview should still read the
      // newest message, which this is.
      await db.query(
        `UPDATE ai_support_sessions SET last_message = $3 WHERE tenant_id = $1 AND session_id = $2`,
        [Number(tenantId), saved?.session_id || row.sessionId, row.message]
      ).catch(() => {});
      await ensureMapping({ tenantId, sessionId: saved?.session_id || row.sessionId, customerName: send.recipient?.customer_name, broadcast, autoLead });
      if (autoLead) {
        await recordConversationTouch({
          tenantId,
          sessionId: saved?.session_id || row.sessionId,
          mode: "open",
          touch: { source_type: "whatsapp_campaign", channel: "whatsapp", campaign_name: broadcast.name, broadcast_id: broadcast.id, via: "send" },
        });
      }
      written += 1;
    } catch (error) {
      console.warn("[campaign-inbox] recipient not recorded", {
        tenant_id: tenantId,
        broadcast_id: broadcast.id,
        phone_suffix: text(send.recipient?.phone).slice(-4),
        message: text(error?.message).slice(0, 200),
      });
    }
  }
  if (written) {
    try {
      const { emitToRooms } = await import("../../utils/socket.js");
      emitToRooms([`tenant:${tenantId}`], "ai_inbox:refresh", { tenant_id: tenantId, reason: "campaign_sent", at: new Date().toISOString() });
    } catch {
      // the next poll shows them
    }
  }
  return written;
};

export const recordCampaignSendsSafe = (input) => recordCampaignSends(input).catch((error) => {
  console.warn("[campaign-inbox] batch not recorded", { message: text(error?.message).slice(0, 200) });
  return 0;
});

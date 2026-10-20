// A customer answering a WhatsApp template campaign (GENI: the campaign's "Chatbot Flow" /
// "AI Workflow" handle replies to it).
//
// First handler of interceptWaOfficialInbound (official Cloud number, after the message is stored,
// before any other flow and before the AI). A message is a reply to a campaign when
//   • it quotes the campaign message (Cloud context.id = the wamid the campaign got back), or
//   • the customer received a campaign in the last 72 hours and has not written since.
// Then the conversation is attributed to that campaign (last touch "whatsapp_campaign"), and when
// the campaign names a chatbot flow that flow answers this message. The campaign's AI
// instructions reach the AI separately (attribution.js → loadCampaignAiInstructions).
//
// Returns { handled: true } only when the campaign's flow sent something; otherwise the chain
// (number's own chatbot flows → away auto reply → AI) carries on as before.

import db from "../../database/db.js";
import { recordConversationTouch, CAMPAIGN_REPLY_WINDOW_HOURS } from "./attribution.js";

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const phoneTail = (value) => text(value).replace(/\D/g, "").slice(-10);

const CAMPAIGN_COLUMNS = `b.id AS broadcast_id, b.name AS campaign_name, b.chatbot_flow_id, b.ai_instructions, b.auto_lead_generation,
       r.id AS recipient_id, r.sent_at, r.message_id`;

/**
 * The campaign this inbound message answers, or null. `via` = "quoted_reply" | "reply".
 * Missing marketing tables (a fresh install) read as "no campaign".
 */
export const findCampaignForReply = async ({ tenantId, sessionId = "", phone = "", replyToMessageId = "", currentMessageId = "" } = {}) => {
  const safeTenant = Number(tenantId) || 0;
  if (!safeTenant) return null;
  try {
    if (text(replyToMessageId)) {
      const quoted = await db.query(
        `SELECT ${CAMPAIGN_COLUMNS}
           FROM marketing_broadcast_recipients r JOIN marketing_broadcasts b ON b.id = r.broadcast_id
          WHERE r.tenant_id = $1 AND r.message_id = $2::text AND r.message_id <> ''
          LIMIT 1`,
        [safeTenant, text(replyToMessageId)]
      );
      if (quoted.rows[0]) return { ...quoted.rows[0], via: "quoted_reply" };
    }
    const tail = phoneTail(phone || text(sessionId).replace(/^whatsapp:/, ""));
    if (!tail) return null;
    const recent = await db.query(
      `SELECT ${CAMPAIGN_COLUMNS}
         FROM marketing_broadcast_recipients r JOIN marketing_broadcasts b ON b.id = r.broadcast_id
        WHERE r.tenant_id = $1 AND r.status = 'sent'
          AND r.sent_at > NOW() - ($3::int * INTERVAL '1 hour')
          AND RIGHT(regexp_replace(r.phone, '\\D', '', 'g'), 10) = $2::text
        ORDER BY r.sent_at DESC
        LIMIT 1`,
      [safeTenant, tail, CAMPAIGN_REPLY_WINDOW_HOURS]
    );
    const candidate = recent.rows[0];
    if (!candidate) return null;
    // "Their first reply since": no other customer message in this thread after the send. The
    // message being handled is already stored, so it is left out by its provider id.
    const since = await db.query(
      `SELECT 1 FROM ai_support_messages
        WHERE tenant_id = $1 AND session_id = $2::text AND sender_type = 'customer'
          AND created_at > (SELECT sent_at FROM marketing_broadcast_recipients WHERE id = $3::bigint)
          AND COALESCE(provider_message_id, '') <> $4::text
        LIMIT 1`,
      [safeTenant, text(sessionId), Number(candidate.recipient_id), text(currentMessageId)]
    );
    if (since.rows[0]) return null;
    return { ...candidate, via: "reply" };
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return null;
    throw error;
  }
};

export const handleCampaignReplyInbound = async ({ tenantId = 0, phoneNumberId = "", message = {} } = {}) => {
  const sessionId = text(message.external_conversation_id) || (text(message.external_customer_id) ? `whatsapp:${text(message.external_customer_id)}` : "");
  if (!Number(tenantId) || !sessionId) return { handled: false };
  const campaign = await findCampaignForReply({
    tenantId,
    sessionId,
    phone: message.external_customer_id,
    replyToMessageId: message.reply_to_message_id,
    currentMessageId: message.external_message_id || message.dedupe_key,
  });
  if (!campaign) return { handled: false };

  await recordConversationTouch({
    tenantId,
    sessionId,
    touch: {
      source_type: "whatsapp_campaign",
      channel: "whatsapp",
      campaign_name: campaign.campaign_name,
      broadcast_id: campaign.broadcast_id,
      via: campaign.via,
    },
  }).catch((error) => console.warn("[campaign-reply] attribution not recorded", { message: text(error?.message).slice(0, 200) }));

  if (!Number(campaign.chatbot_flow_id) || !text(phoneNumberId)) return { handled: false, reason: "campaign_reply_attributed" };
  const { startFlowForInbound } = await import("../whatsappOfficial/flows/flowInbound.js");
  const started = await startFlowForInbound({ tenantId, phoneNumberId, message, flowId: campaign.chatbot_flow_id, reason: "campaign_flow" });
  return started?.handled ? { handled: true, reason: "campaign_flow" } : { handled: false, reason: started?.reason || "campaign_flow_not_started" };
};

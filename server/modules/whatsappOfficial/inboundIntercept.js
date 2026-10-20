// One hook for official (Cloud API) inbound messages, called by the Cloud webhook handler
// AFTER the message is stored and BEFORE the AI agent sees it.
//
// Handlers run in order; the first that returns { handled: true } stops the chain and the AI
// is skipped for that message. A handler that throws is logged and treated as "not handled",
// so a bug here can never cost the customer an answer.
//
// Handler contract: async ({ tenantId, phoneNumberId, message, metadata }) => ({ handled, reason })
//   message = the normalized inbound message (external_customer_id, external_conversation_id,
//             message_text, attachments, raw — see extractWhatsAppWebhookMessages)
//   chatbot flows  → ./flows/flowInbound.js       (owned by the chatbot-flows work)
//   auto reply     → ./accounts/autoReplyInbound.js (owned by the account-settings work)

import { handleFlowInbound } from "./flows/flowInbound.js";
import { handleAutoReplyInbound } from "./accounts/autoReplyInbound.js";

const HANDLERS = [
  ["chatbot_flow", handleFlowInbound],
  ["auto_reply", handleAutoReplyInbound],
];

export const interceptWaOfficialInbound = async (input = {}) => {
  for (const [name, handler] of HANDLERS) {
    try {
      const result = await handler(input);
      if (result?.handled) return { handled: true, by: name, reason: result.reason || "" };
    } catch (error) {
      console.warn("[wa-official:intercept] handler failed", { handler: name, message: String(error?.message || error).slice(0, 200) });
    }
  }
  return { handled: false };
};

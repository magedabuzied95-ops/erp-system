import { AI_AGENT_CHANNELS } from "../aiChannelAdapterService.js";
import { sendUnifiedReplyThroughChannelAdapter } from "../aiConversationOrchestrator.js";

export const sendUnifiedWhatsAppReply = async ({ to, reply = {}, messageText = "", tenantId = null } = {}) =>
  sendUnifiedReplyThroughChannelAdapter({
    channel: AI_AGENT_CHANNELS.WHATSAPP,
    to,
    reply,
    messageText,
    tenantId,
  });

export default {
  sendUnifiedWhatsAppReply,
};

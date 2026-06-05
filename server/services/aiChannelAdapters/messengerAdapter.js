import { AI_AGENT_CHANNELS } from "../aiChannelAdapterService.js";
import { sendUnifiedReplyThroughChannelAdapter } from "../aiConversationOrchestrator.js";

export const sendUnifiedMessengerReply = async ({ to, reply = {}, messageText = "", tenantId = null } = {}) =>
  sendUnifiedReplyThroughChannelAdapter({
    channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
    to,
    reply,
    messageText,
    tenantId,
  });

export default {
  sendUnifiedMessengerReply,
};

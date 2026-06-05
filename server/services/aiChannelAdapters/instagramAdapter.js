import { AI_AGENT_CHANNELS } from "../aiChannelAdapterService.js";
import { sendUnifiedReplyThroughChannelAdapter } from "../aiConversationOrchestrator.js";

export const sendUnifiedInstagramReply = async ({ to, reply = {}, messageText = "", tenantId = null } = {}) =>
  sendUnifiedReplyThroughChannelAdapter({
    channel: AI_AGENT_CHANNELS.INSTAGRAM,
    to,
    reply,
    messageText,
    tenantId,
  });

export default {
  sendUnifiedInstagramReply,
};

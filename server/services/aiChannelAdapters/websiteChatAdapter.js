import { AI_AGENT_CHANNELS } from "../aiChannelAdapterService.js";
import { buildUnifiedAiReplyPayload } from "../aiConversationOrchestrator.js";

export const buildWebsiteChatUnifiedReply = (payload = {}) =>
  buildUnifiedAiReplyPayload({
    ...payload,
    channel: AI_AGENT_CHANNELS.WEB_CHAT,
  });

export default {
  buildWebsiteChatUnifiedReply,
};

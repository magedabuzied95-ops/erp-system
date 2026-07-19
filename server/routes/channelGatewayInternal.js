import express from 'express';
import { channelGatewayAuth } from '../middleware/channelGatewayAuth.js';
import { appendInboundAiSupportMessage, updateAiSupportMessageDeliveryStatus } from '../services/aiSupportLogService.js';
import { generateAiInboxReply } from '../services/aiSalesAgentService.js';
import { emitToRooms } from '../utils/socket.js';

const router = express.Router();
const enabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
const text = (value = '') => String(value ?? '').trim();

router.post('/inbound', channelGatewayAuth, async (req, res, next) => {
  try {
    if (!enabled(process.env.CHANNEL_GATEWAY_INBOUND_ENABLED)) return res.status(409).json({ error: 'gateway_inbound_disabled' });
    const event = req.body || {};
    if (text(event.channel) !== 'instagram' || text(event.direction) !== 'inbound') return res.status(400).json({ error: 'unsupported_pilot_event' });
    if (text(event.metadata?.channel_account_id || event.channel_account_id) !== 'instagram-test-account') return res.status(409).json({ error: 'test_account_only' });
    if (event.attachments?.length || !text(event.text)) return res.status(409).json({ error: 'text_only_pilot' });
    const tenantId = Number(event.tenant_id); const externalConversationId = text(event.external_conversation_id);
    if (!tenantId || !externalConversationId || !text(event.external_message_id)) return res.status(400).json({ error: 'invalid_event_identity' });
    const sessionId = `instagram:${text(event.connection_id)}:${externalConversationId}`;
    const message = await appendInboundAiSupportMessage({
      tenantId, sessionId, message: event.text, channel: 'instagram', messageType: 'text',
      customerName: text(event.metadata?.external_display_name || event.metadata?.external_username || event.sender_id),
      deliveryStatus: 'received', externalMessageId: event.external_message_id,
      providerMessageId: event.external_message_id, source: 'instagram_browser_bridge',
      sourcePath: 'channel_gateway', insertSource: 'instagram_browser_bridge',
    });
    let draft = null;
    let draftErrorCode = null;
    if (String(process.env.INSTAGRAM_AI_MODE || 'draft_only').toLowerCase() === 'draft_only') {
      try {
        draft = await generateAiInboxReply({ tenantId, conversationId: sessionId, persist: true });
      } catch (error) {
        draftErrorCode = text(error?.code || 'ai_draft_unavailable');
        console.warn('instagram_gateway.ai_draft_skipped', {
          tenant_id: tenantId,
          conversation_id: sessionId,
          error_code: draftErrorCode,
        });
      }
    }
    const at = new Date().toISOString();
    emitToRooms([`tenant:${tenantId}`], 'ai_inbox:message', { tenant_id: tenantId, session_id: sessionId, message, at });
    emitToRooms([`tenant:${tenantId}`], 'ai_inbox:refresh', { tenant_id: tenantId, session_id: sessionId, at });
    return res.status(202).json({
      accepted: true,
      internal_message_id: message?.id || null,
      conversation_id: sessionId,
      ai_mode: 'draft_only',
      draft_created: Boolean(draft),
      draft_error_code: draftErrorCode,
    });
  } catch (error) { return next(error); }
});

router.post('/status', channelGatewayAuth, async (req, res, next) => {
  try {
    if (!enabled(process.env.CHANNEL_GATEWAY_INBOUND_ENABLED)) return res.status(409).json({ error: 'gateway_inbound_disabled' });
    const event = req.body || {}; const tenantId = Number(event.tenant_id); const sessionId = text(event.internal_conversation_id);
    if (!tenantId || !sessionId || !text(event.provider_message_id || event.job_key)) return res.status(400).json({ error: 'invalid_status_event' });
    const message = await updateAiSupportMessageDeliveryStatus({
      tenantId, sessionId, providerMessageId: text(event.provider_message_id || event.job_key),
      deliveryStatus: text(event.delivery_status), deliveryError: text(event.delivery_error),
      errorCode: text(event.error_code), sourcePath: 'channel_gateway_status', insertSource: 'instagram_browser_bridge',
    });
    const at = new Date().toISOString();
    emitToRooms([`tenant:${tenantId}`], 'ai_inbox:message', { tenant_id: tenantId, session_id: sessionId, message, at });
    emitToRooms([`tenant:${tenantId}`], 'ai_inbox:refresh', { tenant_id: tenantId, session_id: sessionId, at });
    return res.json({ updated: Boolean(message), internal_message_id: message?.id || event.internal_message_id || null, delivery_status: event.delivery_status });
  } catch (error) { return next(error); }
});

export default router;

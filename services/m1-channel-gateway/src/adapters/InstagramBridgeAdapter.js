import { ChannelAdapter } from './ChannelAdapter.js';
import { randomUUID } from 'node:crypto';
import { signGatewayRequest } from '../security/hmac.js';

export class InstagramBridgeAdapter extends ChannelAdapter {
  constructor({ connectionId, baseUrl, secret, fetchImpl = fetch, logger }) {
    super({ channel: 'instagram', connectionId, logger });
    this.baseUrl = String(baseUrl || '').replace(/\/$/, ''); this.secret = secret; this.fetch = fetchImpl;
  }
  async request(path, { method = 'POST', body = null } = {}) {
    const rawBody = body == null ? '' : JSON.stringify(body); const timestamp = String(Date.now()); const nonce = randomUUID();
    const signature = signGatewayRequest({ secret: this.secret, timestamp, nonce, method, path, rawBody });
    const response = await this.fetch(`${this.baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', 'x-m1-timestamp': timestamp, 'x-m1-nonce': nonce, 'x-m1-signature': signature }, body: rawBody || undefined });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `Instagram bridge ${response.status}`), { code: payload.error || 'INSTAGRAM_BRIDGE_ERROR', status: response.status, needsManualReview: payload.status === 'needs_manual_review' });
    return payload;
  }
  connect() { return this.getHealth(); }
  disconnect() { return Promise.resolve({ disconnected: true }); }
  getHealth() { return this.request('/internal/v1/health', { method: 'GET' }); }
  syncConversations() { return this.request('/internal/v1/sync'); }
  syncMessages() { return this.request('/internal/v1/sync'); }
  sendText(externalConversationId, text, payload = {}) {
    return this.request('/internal/v1/messages/text', { body: { external_conversation_id: externalConversationId, text, options: { ...payload.metadata, job_key: payload.event_id || payload.metadata?.job_key } } });
  }
  async sendMedia() { throw Object.assign(new Error('Media is disabled in Instagram pilot'), { code: 'UNSUPPORTED_IN_CURRENT_PHASE', needsManualReview: true }); }
  markAsRead(externalConversationId) { return this.request(`/internal/v1/conversations/${encodeURIComponent(externalConversationId)}/read`); }
  restart() { return this.request('/internal/v1/restart'); }
  pause() { return this.request('/internal/v1/pause'); }
  resume() { return this.request('/internal/v1/resume'); }
  forceRecoverySync() { return this.request('/internal/v1/sync'); }
}

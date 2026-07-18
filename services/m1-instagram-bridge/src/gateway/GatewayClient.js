import { signedHeaders } from '../security/hmac.js';

export class GatewayClient {
  constructor({ baseUrl, secret, fetchImpl = fetch }) { this.baseUrl = baseUrl; this.secret = secret; this.fetch = fetchImpl; }
  async request(path, { method = 'POST', body = null } = {}) {
    const rawBody = body == null ? '' : JSON.stringify(body);
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method, headers: { 'content-type': 'application/json', ...signedHeaders({ secret: this.secret, method, path, rawBody }) },
      body: rawBody || undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `Gateway ${response.status}`), { code: payload.error || 'GATEWAY_REQUEST_FAILED', status: response.status });
    return payload;
  }
  importMessage(event) { return this.request('/v1/inbound/messages', { body: event }); }
  reportOutboundStatus(jobKey, status) {
    return this.request(`/v1/outbound/jobs/${encodeURIComponent(jobKey)}/reconcile`, { body: status });
  }
}

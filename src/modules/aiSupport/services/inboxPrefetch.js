import { api } from '../../../shared/api/api.js';
import { getCurrentTenant, getCurrentUser } from '../../../shared/auth/authStorage.js';
import inboxCache from './inboxCache/inboxCache.js';
import { AI_INBOX_MESSAGE_CHANNELS, channelWindow } from './inboxChannels.js';
import { createInboxPrefetch } from './inboxPrefetchState.js';

const identity = () => inboxCache.resolveNamespace();
const prefetch = createInboxPrefetch({
  channels: AI_INBOX_MESSAGE_CHANNELS,
  isCurrent: (expected) => Boolean(expected) && identity() === expected,
  fetchPage: (channel, signal) => {
    const user = getCurrentUser() || {};
    const tenant = getCurrentTenant() || {};
    const tenantId = String(tenant.id || tenant.tenant_id || user.tenant_id || user.tenantId || '');
    return api.get('/ai-inbox/conversations', {
      params: { tenant_id: tenantId, filter: 'all', channel_filter: channel, limit: channelWindow(channel), read_filter: 'all', view: 'all' },
      headers: { 'x-tenant-id': tenantId }, signal, timeoutMs: 15000,
      perfComponent: `AiInbox.prefetch.${channel}`,
    });
  },
  savePage: (channel, payload) => inboxCache.saveList(payload?.conversations || [], channel),
});

export const prefetchInbox = () => prefetch.start(identity());
export const takePrefetchedInboxPage = (channel) => prefetch.take(identity(), channel);
export const clearInboxPrefetch = () => prefetch.clear();

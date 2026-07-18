import 'dotenv/config';
import { loadConfig, assertSafePilotConfig } from '../src/config.js';
import { InstagramPlaywrightDriver } from '../src/browser/InstagramPlaywrightDriver.js';
import { BridgeStateStore } from '../src/state/BridgeStateStore.js';
import { normalizeInstagramTextEvent } from '../src/domain/messages.js';
import { validateStagingIsolation } from '../../shared/stagingIsolation.js';

validateStagingIsolation(process.env, { requireDatabaseUrl: false });
const config = loadConfig();
assertSafePilotConfig(config);
const threadId = String(process.env.INSTAGRAM_INSPECT_THREAD_ID || '').trim();
if (!threadId) throw new Error('INSTAGRAM_INSPECT_THREAD_ID is required');

const driver = new InstagramPlaywrightDriver({
  config,
  diagnostics: null,
  safety: { beforeConversationOpen: async () => {} },
});

try {
  await driver.connect();
  const identity = await driver.openConversation({ external_conversation_id: threadId });
  const messages = await driver.readMessages({ limit: 100 });
  const testTokens = messages.flatMap((message) => message.text.match(/IG-(?:A|B)-(?:001|PARALLEL)-\d{8}-\d{6}/g) || []);
  const state = new BridgeStateStore(config.statePath);
  await state.load();
  const tokenState = messages.filter((message) => /IG-(?:A|B)-(?:001|PARALLEL)-\d{8}-\d{6}/.test(message.text)).map((message) => {
    const event = normalizeInstagramTextEvent(message, {
      identity,
      tenantId: config.tenantId,
      connectionId: config.connectionId,
      channelAccountId: config.channelAccountId,
    });
    return { token: message.text, external_message_id: event.external_message_id, seen: state.hasMessage(event.external_message_id) };
  });
  console.log(JSON.stringify({
    external_conversation_id: identity.external_conversation_id,
    identity_confidence: identity.identity_confidence,
    messages_read: messages.length,
    test_tokens: testTokens,
    token_state: tokenState,
  }));
} finally {
  await driver.disconnect();
}

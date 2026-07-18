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
  const tokenPattern = /(?:IG-(?:A|B)-(?:001|PARALLEL)|ERP-(?:WEB|PWA)-TO-(?:A|B)-001)-\d{8}-\d{6}/g;
  const testTokens = messages.flatMap((message) => message.text.match(tokenPattern) || []);
  const state = new BridgeStateStore(config.statePath);
  await state.load();
  const tokenState = messages.filter((message) => new RegExp(tokenPattern.source).test(message.text)).map((message) => {
    const event = normalizeInstagramTextEvent(message, {
      identity,
      tenantId: config.tenantId,
      connectionId: config.connectionId,
      channelAccountId: config.channelAccountId,
    });
    return { token: message.text, external_message_id: event.external_message_id, seen: state.hasMessage(event.external_message_id) };
  });
  const actionLabels = await driver.page.getByRole('button').allInnerTexts().then((values) => values
    .map((value) => value.trim()).filter((value) => /^(accept|delete|block|send)$/i.test(value))).catch(() => []);
  const composerCounts = {
    message_textbox: await driver.page.getByRole('textbox', { name: /message/i }).count().catch(() => 0),
    contenteditable: await driver.page.locator('[contenteditable="true"]').count().catch(() => 0),
    textarea: await driver.page.locator('textarea').count().catch(() => 0),
  };
  console.log(JSON.stringify({
    external_conversation_id: identity.external_conversation_id,
    identity_confidence: identity.identity_confidence,
    messages_read: messages.length,
    test_tokens: testTokens,
    token_state: tokenState,
    action_labels: actionLabels,
    composer_counts: composerCounts,
  }));
} finally {
  await driver.disconnect();
}

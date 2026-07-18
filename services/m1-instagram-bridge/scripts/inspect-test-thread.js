import 'dotenv/config';
import { loadConfig, assertSafePilotConfig } from '../src/config.js';
import { InstagramPlaywrightDriver } from '../src/browser/InstagramPlaywrightDriver.js';
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
  console.log(JSON.stringify({
    external_conversation_id: identity.external_conversation_id,
    identity_confidence: identity.identity_confidence,
    messages_read: messages.length,
    test_tokens: testTokens,
  }));
} finally {
  await driver.disconnect();
}

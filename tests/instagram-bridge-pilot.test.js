import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Playwright remains isolated from ERP backend and Channel Gateway', async () => {
  const [server, gatewayPackage, bridgePackage] = await Promise.all([read('../server/server.js'), read('../services/m1-channel-gateway/package.json'), read('../services/m1-instagram-bridge/package.json')]);
  assert.doesNotMatch(server, /from ['"]playwright|require\(['"]playwright/);
  assert.doesNotMatch(gatewayPackage, /playwright/);
  assert.match(bridgePackage, /playwright/);
});

test('Instagram inbound reuses existing AI Inbox WebSocket events', async () => {
  const route = await read('../server/routes/channelGatewayInternal.js');
  assert.match(route, /'ai_inbox:message'/); assert.match(route, /'ai_inbox:refresh'/);
  assert.doesNotMatch(route, /instagram_inbox:|channel_gateway:message/);
});

test('Instagram AI path creates draft and never invokes outbound send', async () => {
  const route = await read('../server/routes/channelGatewayInternal.js');
  assert.match(route, /generateAiInboxReply\(\{ tenantId, conversationId: sessionId, persist: true \}\)/);
  assert.match(route, /ai_mode: 'draft_only'/);
  assert.doesNotMatch(route, /appendAiGeneratedSupportReply|sendText|sendMessage|auto.?send/i);
});

test('manual Instagram reply is queued without calling the official Meta send path', async () => {
  const route = await read('../server/routes/aiAgentOrders.js');
  const branchStarts = [...route.matchAll(/const instagramPilotMatch/g)].map((match) => match.index);
  assert.ok(branchStarts.length >= 2, 'both private-message and main Send now routes must use the pilot queue');
  for (const branchStart of branchStarts) {
    const transportMarker = route.indexOf('channel_transport: "instagram_browser_bridge"', branchStart);
    const branchEnd = route.indexOf('\n    }', transportMarker) + '\n    }'.length;
    const branch = route.slice(branchStart, branchEnd);
    assert.match(branch, /appendManualAiSupportReply/); assert.match(branch, /deliveryStatus: "queued"/);
    assert.doesNotMatch(branch, /sendMetaInboxOutboundMessage|replyToComment/);
  }
});

test('Web and PWA continue to consume the same conversation and message events', async () => {
  const candidates = ['../src/modules/aiSupport/pages/AiInboxPwa.jsx', '../src/modules/aiSupport/pages/AiInbox.jsx'];
  const sources = [];
  for (const candidate of candidates) { try { sources.push(await read(candidate)); } catch {} }
  assert.ok(sources.length >= 1);
  const joined = sources.join('\n');
  assert.match(joined, /ai_inbox:message|ai_inbox:refresh/);
  assert.doesNotMatch(joined, /instagram_browser_bridge_socket/);
});

test('Docker pilot is opt-in, has no public port, and preserves profile volumes', async () => {
  const compose = await read('../services/m1-channel-gateway/docker-compose.example.yml');
  const block = compose.slice(compose.indexOf('instagram-bridge:'), compose.indexOf('\n  redis:'));
  assert.match(block, /profiles: \["instagram-pilot"\]/); assert.match(block, /restart: "no"/);
  assert.doesNotMatch(block, /ports:/); assert.match(block, /instagram_bridge_profile/); assert.match(block, /read_only: true/);
});

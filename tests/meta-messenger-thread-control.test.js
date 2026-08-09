import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("../server/routes/aiAgentOrders.js", import.meta.url), "utf8");

test("Meta webhooks can verify against the deployed app secret fallback", () => {
  assert.match(serviceSource, /decryptSecret\(config\.app_secret_encrypted\) \|\| text\(process\.env\.META_APP_SECRET/);
});

test("Messenger sends recover thread control before retrying", () => {
  assert.match(serviceSource, /isMetaThreadControlConflict/);
  assert.match(serviceSource, /\/me\/take_thread_control/);
  assert.match(serviceSource, /return await send\(\)/);
});

test("Meta send config does not reject a live page token because of stale stored expiry metadata", () => {
  const sendConfigStart = serviceSource.indexOf("const resolveMetaSendConfig");
  const sendConfigEnd = serviceSource.indexOf("const resolveMessengerRecipientPsid", sendConfigStart);
  const sendConfigSource = serviceSource.slice(sendConfigStart, sendConfigEnd);
  assert.doesNotMatch(sendConfigSource, /COALESCE\(token_expires_at/);
});

test("thread-control conflicts are not mislabeled as a 24-hour window error", () => {
  const friendlyStart = routeSource.indexOf("const friendlyOutboundDeliveryError");
  const friendlyEnd = routeSource.indexOf("const regressionMockDeliveryRequested", friendlyStart);
  const friendlySource = routeSource.slice(friendlyStart, friendlyEnd);
  assert.ok(friendlySource.indexOf("another app") < friendlySource.indexOf("outside.*(?:24|window)"));
  assert.match(friendlySource, /تطبيقًا آخر يتحكم/);
});

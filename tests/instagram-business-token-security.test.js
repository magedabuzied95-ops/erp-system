import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/metaIntegration.js", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("../src/modules/marketing/pages/MarketingSettings.jsx", import.meta.url), "utf8");

test("Instagram Business Login token is stored separately and encrypted", () => {
  assert.match(serviceSource, /instagram_access_token_encrypted TEXT NOT NULL DEFAULT ''/);
  assert.match(serviceSource, /instagram_access_token_encrypted = \$4/);
  assert.match(serviceSource, /encryptSecret\(token\)/);
  assert.match(serviceSource, /instagram_access_token_configured: Boolean\(row\.instagram_access_token_encrypted\)/);
  assert.doesNotMatch(routeSource, /access_token:\s*result/);
});

test("Instagram token management is protected by settings edit permission", () => {
  assert.match(routeSource, /post\("\/instagram\/access-token", protect, permit\("settings", "edit"\)/);
  assert.match(routeSource, /delete\("\/instagram\/access-token", protect, permit\("settings", "edit"\)/);
});

test("Instagram Business Login sends use Instagram Graph without changing Messenger sends", () => {
  assert.match(serviceSource, /INSTAGRAM_GRAPH_BASE_URL/);
  assert.match(serviceSource, /instagram_business_login === true/);
  assert.match(serviceSource, /resolved_instagram_account_id/);
  assert.match(serviceSource, /return callMetaPost\(\{ endpoint: "\/me\/messages", token, body \}\)/);
});

test("admin UI treats the Instagram token as write-only", () => {
  assert.match(settingsSource, /type="password"/);
  assert.match(settingsSource, /autoComplete="new-password"/);
  assert.match(settingsSource, /لن يستبدل رمز صفحة Facebook/);
  assert.doesNotMatch(settingsSource, /value=\{metaConfig\.instagram_access_token/);
});

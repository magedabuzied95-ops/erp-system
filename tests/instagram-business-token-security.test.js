import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const serviceSource = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../server/routes/metaIntegration.js", import.meta.url), "utf8");
// Token entry moved out of MarketingSettings.jsx into the AI Inbox integrations center (that
// file's header says why: two screens able to rewrite the same Meta credentials meant neither
// could be trusted). The write-only rules below follow the inputs to where they live now.
const panelSource = readFileSync(new URL("../src/modules/aiSupport/components/integrations/MetaIntegrationPanel.jsx", import.meta.url), "utf8");
const arSupport = JSON.parse(readFileSync(new URL("../src/locales/ar/aiSupport.json", import.meta.url), "utf8"));
const instagramCopy = arSupport?.integrations?.meta?.instagram || {};
// The <TextInput … /> element that sits under a card's title — the exact element, not the file,
// so one password field elsewhere cannot vouch for a plain-text one here.
const inputUnder = (titleKey) => {
  const title = panelSource.indexOf(`t("aiSupport.integrations.meta.instagram.${titleKey}")`);
  assert.ok(title > 0, `the ${titleKey} card is gone from the integrations panel`);
  const open = panelSource.indexOf("<TextInput", title);
  const close = panelSource.indexOf("/>", open);
  assert.ok(open > title && open - title < 1200 && close > open, `no input under ${titleKey}`);
  return panelSource.slice(open, close + 2);
};
const serverSource = readFileSync(new URL("../server/server.js", import.meta.url), "utf8");

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

test("Instagram App Secret is write-only, encrypted, and isolated from the Facebook secret", () => {
  assert.match(serviceSource, /instagram_app_secret_encrypted TEXT NOT NULL DEFAULT ''/);
  assert.match(serviceSource, /instagram_app_secret_encrypted = \$2/);
  assert.match(serviceSource, /\[scopedTenantId, encryptSecret\(secret\)\]/);
  assert.match(serviceSource, /instagram_app_secret_configured: Boolean\(row\.instagram_app_secret_encrypted\)/);
  assert.match(serviceSource, /lower\(payload\?\.object\) === "instagram"/);
  assert.match(serviceSource, /decryptSecret\(config\.instagram_app_secret_encrypted\)/);
  assert.match(routeSource, /post\("\/instagram\/app-secret", protect, permit\("settings", "edit"\)/);
  assert.match(routeSource, /delete\("\/instagram\/app-secret", protect, permit\("settings", "edit"\)/);
  assert.doesNotMatch(routeSource, /app_secret:\s*result/);
});

test("Instagram Business Login sends use Instagram Graph without changing Messenger sends", () => {
  assert.match(serviceSource, /INSTAGRAM_GRAPH_BASE_URL/);
  assert.match(serviceSource, /instagram_business_login === true/);
  assert.match(serviceSource, /resolved_instagram_account_id/);
  assert.match(serviceSource, /return callMetaPost\(\{ endpoint: "\/me\/messages", token, body \}\)/);
});

test("admin UI treats the Instagram token as write-only", () => {
  const input = inputUnder("tokenTitle");
  assert.match(input, /type="password"/);
  assert.match(input, /autoComplete="new-password"/);
  // Bound to what the operator is typing now, never to anything the server sent back.
  assert.match(input, /value=\{instagramAccessToken\}/);
  assert.match(instagramCopy.tokenHint || "", /لا يستبدل رمز صفحة فيسبوك/, "the card says this token leaves the Facebook page token alone");
});

test("admin UI treats the Instagram App Secret as write-only", () => {
  const input = inputUnder("secretTitle");
  assert.match(input, /type="password"/);
  assert.match(input, /autoComplete="new-password"/);
  assert.match(input, /value=\{instagramAppSecret\}/);
  assert.match(instagramCopy.secretHint || "", /توقيع Webhook/, "the card says what the secret is for");
  assert.match(instagramCopy.subtitle || "", /لا تظهر مرة أخرى بعد الحفظ/, "and that a saved credential is never shown again");
});

test("no admin input anywhere is bound to a stored Meta credential", () => {
  // The API only ever returns *_configured booleans; an input bound to a stored value would be
  // the first thing to leak one the day that contract slips.
  assert.doesNotMatch(
    panelSource,
    /value=\{metaConfig\.(instagram_access_token|instagram_app_secret|app_secret|page_access_token)\b/,
  );
});

test("Meta webhook diagnostics never log signatures or raw message bodies", () => {
  assert.match(serverSource, /signature_present: Boolean\(req\.headers\["x-hub-signature-256"\]\)/);
  assert.match(serverSource, /rawBodyCaptured: rawBodyText\.length > 0/);
  assert.doesNotMatch(serverSource, /"x-hub-signature-256": req\.headers\["x-hub-signature-256"\]/);
  assert.doesNotMatch(serverSource, /rawBodyPreview: rawBodyText\.slice/);
});

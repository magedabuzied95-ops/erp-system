import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// The colour cards on an Instagram comment go out through the Page's /messages with the
// marketing_settings Page token, and that app then owns the thread. The size step after a card
// tap went through graph.instagram.com with the Instagram Business Login token — another app —
// and Instagram refused it: code 100, subcode 2534037, "not the thread owner" (2026-10-18).
// These guards keep the resend through the owner's Page token.

const meta = fs.readFileSync(
  new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8"
);

const wrapper = meta.slice(
  meta.indexOf("const postMetaMessageWithThreadControl = async ({"),
  meta.indexOf("const postMetaMessage = async ({")
);

test("the not-thread-owner refusal is recognised by its subcode", () => {
  assert.match(meta, /subcode === 2534037/);
});

test("an Instagram Business Login send refused as not-owner is resent through the Page", () => {
  assert.ok(wrapper.length > 0, "postMetaMessageWithThreadControl not found");
  assert.match(wrapper, /if \(isInstagramBusinessLogin && isInstagramNotThreadOwnerError\(error\)\)/);
  assert.match(wrapper, /endpoint: `\/\$\{encodeURIComponent\(owner\.pageId\)\}\/messages`/);
  assert.match(wrapper, /token: owner\.pageToken/);
});

test("the Page sender is the marketing_settings token the cards were sent with", () => {
  const loader = meta.slice(
    meta.indexOf("const loadInstagramThreadOwnerPageSender = async"),
    meta.indexOf("const postMetaMessageWithThreadControl = async ({")
  );
  assert.match(loader, /FROM marketing_settings/);
  // marketing_settings has no access_token column: naming it made the lookup throw, the catch
  // turned that into "no Page sender", and the resend never happened (first live tap, 2026-10-18).
  assert.match(loader, /SELECT \*\s+FROM marketing_settings/);
  assert.match(loader, /getPublishingAccessToken\(row \|\| \{\}\)/);
  assert.match(meta, /import \{ getPublishingAccessToken \} from "\.\/metaTokenService\.js";/);
});

test("every Meta send retries a network blip once before anything falls back", () => {
  // In the shared sender, so cards, size buttons and receipts all get it (2026-10-18: the
  // Messenger size buttons went out as text after one "fetch failed").
  assert.match(wrapper, /const sendWithNetworkRetry = async \(\) => \{/);
  assert.match(wrapper, /if \(error\?\.status \|\| !\/fetch failed\/i\.test\(text\(error\?\.message \|\| ""\)\)\) throw error;[\s\S]{0,400}return send\(\);/);
  assert.match(wrapper, /return await sendWithNetworkRetry\(\);/);
});

test("a size typed in answer to the size step is the size button, past the reply switches", () => {
  const helper = meta.slice(
    meta.indexOf("const typedSalesFlowSize = ({"),
    meta.indexOf("const isSocialCommentSalesFlowTapPayload = ")
  );
  assert.match(helper, /!== "awaiting_size"\) return "";/);
  assert.match(helper, /offered\.find\(\(option\) => option && option === typed\)/);
  assert.match(meta, /\|\| Boolean\(!socialCommentTapPayload && typedSalesFlowSize\(\{/);
  assert.match(meta, /const sizePayload = parseSocialCommentSizeQuickReplyPayload\(rawPayload\) \|\| typedSizePayload;/);
});

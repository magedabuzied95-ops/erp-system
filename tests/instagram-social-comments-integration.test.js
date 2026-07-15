import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const metaSource = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");
const automationSource = readFileSync(new URL("../server/services/socialCommentAutomationService.js", import.meta.url), "utf8");
const centerSource = readFileSync(new URL("../server/services/socialCommentsCenterService.js", import.meta.url), "utf8");
const desktopSource = readFileSync(new URL("../src/modules/aiSupport/pages/AiInbox.jsx", import.meta.url), "utf8");
const pwaSource = readFileSync(new URL("../src/modules/aiSupport/pages/AiInboxPwa.jsx", import.meta.url), "utf8");

test("Instagram media and historical comments are loaded from the connected business account", () => {
  assert.match(metaSource, /encodeURIComponent\(text\(instagramAccountId\)\)\}\/media/);
  assert.match(metaSource, /encodeURIComponent\(text\(mediaId\)\)\}\/comments/);
  assert.match(metaSource, /syncMetaInstagramCommentsForTenant = async \(\{[\s\S]*?skipAutomation = true/);
  assert.match(metaSource, /storeSocialCommentAutomationRuns\(\{[\s\S]*?skipAutomation,/);
  assert.match(metaSource, /filterNewInstagramCommentEvents/);
  assert.match(metaSource, /comment_id = ANY\(\$2::text\[\]\)/);
  assert.match(metaSource, /INSTAGRAM_COMMENT_SYNC_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(metaSource, /META_INSTAGRAM_COMMENTS_POLL_ERROR/);
  assert.match(metaSource, /syncMetaInstagramCommentsForTenant\(\{[\s\S]*?skipAutomation: false/);
  assert.match(metaSource, /SELECT id, tenant_id, facebook_page_id, instagram_business_account_id/);
});

test("Instagram comment webhooks use the media id and accept the native comments payload", () => {
  assert.match(metaSource, /instagramBusinessAccountId[\s\S]*?subscribed_apps[\s\S]*?subscribed_fields: "comments"/);
  assert.match(automationSource, /value\.media\?\.id/);
  assert.match(automationSource, /lower\(body\.object\) === "instagram"[\s\S]*?field === "comments"/);
});

test("social comments API merges Facebook and Instagram posts", () => {
  assert.match(centerSource, /listSocialCommentPostsForPlatform\(\{ tenantId, platform: "facebook"/);
  assert.match(centerSource, /listSocialCommentPostsForPlatform\(\{ tenantId, platform: "instagram"/);
  assert.match(centerSource, /const perPlatformLimit = Math\.min\(safeLimit, 24\)/);
  assert.match(centerSource, /platform: "instagram", limit: perPlatformLimit/);
  assert.match(centerSource, /const key = `\$\{postPlatform\}:\$\{postId\}`/);
  assert.match(centerSource, /syncMetaInstagramCommentsForTenant\(\{[\s\S]*?mediaIds: \[safePostId\]/);
});

test("post enrichment defines the raw Meta payload before using its permalink fields", () => {
  const enrichStart = centerSource.indexOf("const enrichSocialCommentPostRow");
  const enrichEnd = centerSource.indexOf("const resolvePostIdentityFromRow", enrichStart);
  const enrichSource = centerSource.slice(enrichStart, enrichEnd > enrichStart ? enrichEnd : enrichStart + 12000);
  const definitionIndex = enrichSource.indexOf("const rawPayload = metadataObject(");
  const usageIndex = enrichSource.indexOf("rawPayload.permalink_url");
  assert.ok(definitionIndex >= 0, "rawPayload must be defined in post enrichment");
  assert.ok(usageIndex > definitionIndex, "rawPayload must be defined before permalink lookup");
});

test("post enrichment keeps graph fallback diagnostics available to its catch handler", () => {
  const enrichStart = centerSource.indexOf("const enrichSocialCommentPostRow");
  const enrichEnd = centerSource.indexOf("const resolvePostIdentityFromRow", enrichStart);
  const enrichSource = centerSource.slice(enrichStart, enrichEnd > enrichStart ? enrichEnd : enrichStart + 100000);
  const definitionIndex = enrichSource.indexOf('let resolvedGraphId = "";');
  const tryIndex = enrichSource.indexOf("try {", definitionIndex);
  const catchUsageIndex = enrichSource.indexOf("resolved_graph_id: resolvedGraphId ||", tryIndex);
  assert.ok(definitionIndex >= 0, "resolvedGraphId must be defined in post enrichment");
  assert.ok(tryIndex > definitionIndex, "resolvedGraphId must be scoped outside the try block");
  assert.ok(catchUsageIndex > tryIndex, "the catch handler must safely reuse resolvedGraphId");
});

test("desktop and PWA inboxes expose Instagram social content", () => {
  for (const source of [desktopSource, pwaSource]) {
    assert.match(source, /\{ key: "instagram", label: "Instagram" \}/);
    assert.match(source, /instagram_comment/);
  }
});

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
});

test("Instagram comment webhooks use the media id and accept the native comments payload", () => {
  assert.match(metaSource, /instagramBusinessAccountId[\s\S]*?subscribed_apps[\s\S]*?subscribed_fields: "comments"/);
  assert.match(automationSource, /value\.media\?\.id/);
  assert.match(automationSource, /lower\(body\.object\) === "instagram"[\s\S]*?field === "comments"/);
});

test("social comments API merges Facebook and Instagram posts", () => {
  assert.match(centerSource, /listSocialCommentPostsForPlatform\(\{ tenantId, platform: "facebook"/);
  assert.match(centerSource, /listSocialCommentPostsForPlatform\(\{ tenantId, platform: "instagram"/);
  assert.match(centerSource, /const key = `\$\{postPlatform\}:\$\{postId\}`/);
  assert.match(centerSource, /syncMetaInstagramCommentsForTenant\(\{[\s\S]*?mediaIds: \[safePostId\]/);
});

test("desktop and PWA inboxes expose Instagram social content", () => {
  for (const source of [desktopSource, pwaSource]) {
    assert.match(source, /\{ key: "instagram", label: "Instagram" \}/);
    assert.match(source, /instagram_comment/);
  }
});

// Social Comments Center — platform registry regression tests.
//
// The registry replaced an inline one-liner that two live Meta channels depend
// on, and roughly thirty raw-SQL CASE expressions still assume its output is
// exactly "facebook" or "instagram". These tests pin that contract so the
// refactor cannot drift, and so a future TikTok enablement cannot quietly route
// TikTok rows through Meta queries.

import assert from "node:assert/strict";
import test from "node:test";

const {
  SOCIAL_COMMENT_PLATFORMS,
  SOCIAL_COMMENT_PLATFORM_REGISTRY,
  assertMetaPlatform,
  commentChannelForPlatform,
  commentPlatformDescriptor,
  isFacebook,
  isInstagram,
  isKnownCommentPlatform,
  normalizePlatform,
} = await import("../server/services/socialCommentPlatforms.js");

// The exact behaviour of the original inline implementation:
//   const normalizePlatform = (v) => (lower(v) === "instagram" ? "instagram" : "facebook");
const originalNormalizePlatform = (value = "") =>
  String(value ?? "").trim().toLowerCase() === "instagram" ? "instagram" : "facebook";

test("normalizePlatform is byte-for-byte identical to the implementation it replaced", () => {
  const inputs = [
    "instagram", "Instagram", "  INSTAGRAM  ", "instagram_comment",
    "facebook", "Facebook", "  facebook ", "facebook_comment",
    "tiktok", "TikTok", "whatsapp", "telegram", "web_chat",
    "", "   ", null, undefined, 0, 123, "unknown-platform",
  ];
  for (const input of inputs) {
    assert.equal(
      normalizePlatform(input),
      originalNormalizePlatform(input),
      `normalizePlatform(${JSON.stringify(input)}) changed behaviour`
    );
  }
});

test("only the literal instagram maps to instagram; everything else is facebook", () => {
  assert.equal(normalizePlatform("instagram"), "instagram");
  assert.equal(normalizePlatform("facebook"), "facebook");
  // Notably including "instagram_comment" — the channel name is not the
  // platform name, and the SQL sites rely on that distinction.
  assert.equal(normalizePlatform("instagram_comment"), "facebook");
});

test("tiktok is registered but is NOT yet reachable through normalizePlatform", () => {
  assert.equal(isKnownCommentPlatform("tiktok"), true);
  assert.equal(SOCIAL_COMMENT_PLATFORM_REGISTRY.tiktok.normalizable, false);
  assert.equal(SOCIAL_COMMENT_PLATFORM_REGISTRY.tiktok.available, false);
  // The binary SQL sites are only correct for Meta, so tiktok must not leak
  // into them via normalizePlatform before they are converted.
  assert.equal(normalizePlatform("tiktok"), "facebook");
});

test("isInstagram and isFacebook stay mutually exclusive and total", () => {
  for (const input of ["instagram", "facebook", "tiktok", "", null, "garbage"]) {
    assert.notEqual(isInstagram(input), isFacebook(input), `${input} must be exactly one of the two`);
  }
});

test("channel names match the canonical ai_channel_conversations values", () => {
  assert.equal(commentChannelForPlatform("instagram"), "instagram_comment");
  assert.equal(commentChannelForPlatform("facebook"), "facebook_comment");
  assert.equal(SOCIAL_COMMENT_PLATFORM_REGISTRY.tiktok.channel, "tiktok_comment");
});

test("Meta platforms pass the guard unchanged", () => {
  assert.equal(assertMetaPlatform("instagram", "listComments"), "instagram");
  assert.equal(assertMetaPlatform("facebook", "listComments"), "facebook");
  // Unknown input degrades to facebook exactly as before, rather than throwing —
  // throwing here would be a behaviour change for existing callers.
  assert.equal(assertMetaPlatform("garbage", "listComments"), "facebook");
  assert.equal(assertMetaPlatform("", "listComments"), "facebook");
});

test("a non-Meta platform reaching a Meta SQL path fails loudly", () => {
  assert.throws(
    () => assertMetaPlatform("tiktok", "listComments"),
    (error) => {
      assert.equal(error.code, "NON_META_COMMENT_PLATFORM");
      assert.equal(error.platform, "tiktok");
      assert.equal(error.site, "listComments");
      return true;
    },
    "silently treating TikTok as Facebook would query the wrong channel"
  );
});

test("descriptors expose which platforms the binary SQL is valid for", () => {
  assert.equal(commentPlatformDescriptor("facebook").meta, true);
  assert.equal(commentPlatformDescriptor("instagram").meta, true);
  assert.equal(commentPlatformDescriptor("tiktok").meta, false);
  assert.equal(commentPlatformDescriptor("nope"), null);
});

test("the registry covers exactly the three known platforms", () => {
  assert.deepEqual(
    Object.keys(SOCIAL_COMMENT_PLATFORM_REGISTRY).sort(),
    ["facebook", "instagram", "tiktok"]
  );
  assert.deepEqual(
    Object.values(SOCIAL_COMMENT_PLATFORMS).sort(),
    ["facebook", "instagram", "tiktok"]
  );
});

test("the comments service consumes the registry rather than its own copy", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../server/services/socialCommentsCenterService.js", import.meta.url), "utf8")
  );
  assert.match(
    source,
    /from "\.\/socialCommentPlatforms\.js"/,
    "socialCommentsCenterService must import the registry"
  );
  assert.ok(
    !/const normalizePlatform = \(value = ""\) =>/.test(source),
    "the inline binary implementation must be gone, not shadowed"
  );
});

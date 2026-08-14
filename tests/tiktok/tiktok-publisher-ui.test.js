// TikTok Social Publisher UI tests.
//
// Two layers, matching how this repo tests frontend behaviour:
//   1. The compliance/validation rules are pure functions in
//      src/modules/marketing/lib/tiktokPublishOptions.js and are exercised
//      directly — this is where the real logic lives.
//   2. The composer wiring is asserted against the source of
//      SocialMediaPublisher.jsx, which is how the existing publisher and
//      ai-inbox suites verify wiring without a DOM.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TIKTOK_POST_MODES,
  TIKTOK_VIDEO_EXTENSIONS,
  buildTikTokPublishSettings,
  defaultTikTokOptions,
  deriveTikTokOptionAvailability,
  reconcileTikTokOptions,
  tiktokAccountReadiness,
  tiktokComplianceStatementKey,
  tiktokContentLabelKey,
  tiktokStatusPresentation,
  validateTikTokComposerOptions,
  validateTikTokVideo,
} from "../../src/modules/marketing/lib/tiktokPublishOptions.js";

const publisherSource = readFileSync(
  new URL("../../src/modules/marketing/pages/SocialMediaPublisher.jsx", import.meta.url),
  "utf8"
);
const panelSource = readFileSync(
  new URL("../../src/modules/marketing/components/TikTokPublishPanel.jsx", import.meta.url),
  "utf8"
);
const enLocale = JSON.parse(readFileSync(new URL("../../src/locales/en/marketing.json", import.meta.url), "utf8"));
const arLocale = JSON.parse(readFileSync(new URL("../../src/locales/ar/marketing.json", import.meta.url), "utf8"));

const creatorInfo = {
  privacy_level_options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  comment_disabled: false,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 60,
};

const goodVideo = { mediaType: "video", fileName: "clip.mp4", fileSize: 1024, durationSec: 20, maxDurationSec: 60 };

// ---------------------------------------------------------------------------
// TikTok is a real channel now
// ---------------------------------------------------------------------------

test("TikTok is selectable in the composer instead of showing coming soon", () => {
  assert.ok(!/disabled:\s*true/.test(publisherSource.split("platformOptions")[1]?.slice(0, 700) || ""),
    "the tiktok platform option must no longer be statically disabled");
  assert.ok(!publisherSource.includes("tiktokComingSoon"), "the coming-soon label must be gone");
  assert.ok(!publisherSource.includes("connectTikTokLater"), "the connect-later placeholder panel must be gone");
  assert.ok(!publisherSource.includes('if (key === "tiktok") return;'), "togglePlatform must no longer refuse tiktok");
});

test("TikTok is included in the platforms sent to the backend", () => {
  assert.ok(!/platforms\[platform\.key\] && platform\.key !== "tiktok"/.test(publisherSource),
    "selectedPlatforms must no longer filter tiktok out");
});

test("the composer renders the TikTok options panel and the status tracker", () => {
  assert.match(publisherSource, /<TikTokPublishPanel/);
  assert.match(publisherSource, /tiktokStatusPresentation\(tiktokJob\.status\)/);
});

// ---------------------------------------------------------------------------
// Account readiness
// ---------------------------------------------------------------------------

test("a disconnected TikTok account blocks publishing and points at Channel Settings", () => {
  const readiness = tiktokAccountReadiness({ connected: false, config: { enabled: true, configured: true } });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reasonKey, "marketing.tiktok.blocked.notConnected");
  assert.equal(readiness.needsSettings, true);
});

test("a reconnect-required account blocks publishing", () => {
  const readiness = tiktokAccountReadiness({ connected: true, reconnect_required: true, config: { enabled: true, configured: true } });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reasonKey, "marketing.tiktok.blocked.reconnectRequired");
});

test("an unconfigured or disabled server blocks publishing without offering settings", () => {
  assert.equal(tiktokAccountReadiness({ config: { enabled: false } }).reasonKey, "marketing.tiktok.blocked.disabled");
  assert.equal(tiktokAccountReadiness({ config: { enabled: true, configured: false } }).reasonKey, "marketing.tiktok.blocked.notConfigured");
  assert.equal(tiktokAccountReadiness({ config: { enabled: false } }).needsSettings, false);
});

test("a connected account without video.publish is blocked with an accurate reason", () => {
  const readiness = tiktokAccountReadiness({
    connected: true,
    config: { enabled: true, configured: true },
    account: { capabilities: { direct_post: false, draft_upload: true } },
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reasonKey, "marketing.tiktok.blocked.missingPublishScope");
});

test("a connected, publish-capable account is ready", () => {
  const readiness = tiktokAccountReadiness({
    connected: true,
    config: { enabled: true, configured: true },
    account: { capabilities: { direct_post: true } },
  });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.reasonKey, "");
});

test("an unknown status is treated as not ready rather than assumed connected", () => {
  assert.equal(tiktokAccountReadiness(null).ready, false);
});

// ---------------------------------------------------------------------------
// Dynamic options
// ---------------------------------------------------------------------------

test("privacy options come from creator info, not a hardcoded list", () => {
  const availability = deriveTikTokOptionAvailability(creatorInfo, defaultTikTokOptions());
  assert.deepEqual(availability.privacy_levels.map((level) => level.value), creatorInfo.privacy_level_options);
  // FOLLOWER_OF_CREATOR exists in TikTok's vocabulary but this creator cannot
  // use it, so it must not be offered.
  assert.ok(!availability.privacy_levels.some((level) => level.value === "FOLLOWER_OF_CREATOR"));
});

test("an empty creator info yields no privacy options rather than a default list", () => {
  assert.deepEqual(deriveTikTokOptionAvailability({}, defaultTikTokOptions()).privacy_levels, []);
});

test("disabled duet is reported as unavailable and forced into the payload", () => {
  const info = { ...creatorInfo, duet_disabled: true };
  assert.equal(deriveTikTokOptionAvailability(info, defaultTikTokOptions()).canAllowDuet, false);
  assert.equal(reconcileTikTokOptions({ disable_duet: false }, info).disable_duet, true);
});

test("disabled stitch is reported as unavailable and forced into the payload", () => {
  const info = { ...creatorInfo, stitch_disabled: true };
  assert.equal(deriveTikTokOptionAvailability(info, defaultTikTokOptions()).canAllowStitch, false);
  assert.equal(reconcileTikTokOptions({ disable_stitch: false }, info).disable_stitch, true);
});

test("disabled comments are reported as unavailable and forced into the payload", () => {
  const info = { ...creatorInfo, comment_disabled: true };
  assert.equal(deriveTikTokOptionAvailability(info, defaultTikTokOptions()).canAllowComment, false);
  assert.equal(reconcileTikTokOptions({ disable_comment: false }, info).disable_comment, true);
});

test("the max duration comes from creator info", () => {
  assert.equal(deriveTikTokOptionAvailability(creatorInfo, defaultTikTokOptions()).maxDurationSec, 60);
  assert.equal(deriveTikTokOptionAvailability({}, defaultTikTokOptions()).maxDurationSec, 0);
});

test("the panel fetches posting options from the backend and never hardcodes them", () => {
  assert.match(panelSource, /api\.get\("\/tiktok\/posting-options"\)/);
  assert.ok(!/PUBLIC_TO_EVERYONE/.test(panelSource), "the panel must not hardcode privacy values");
});

test("the panel shows a loading state and surfaces API errors", () => {
  assert.match(panelSource, /loadingAccount/);
  assert.match(panelSource, /marketing\.tiktok\.loadingOptions/);
  assert.match(panelSource, /optionsLoadFailed/);
  assert.match(panelSource, /creatorError/);
});

// ---------------------------------------------------------------------------
// Commercial content
// ---------------------------------------------------------------------------

test("the disclosure toggle is off by default with nothing preselected", () => {
  const options = defaultTikTokOptions();
  assert.equal(options.commercial_content_toggle, false);
  assert.equal(options.brand_organic_toggle, false);
  assert.equal(options.brand_content_toggle, false);
  assert.equal(options.privacy_level, "", "no privacy level may be preselected");
});

test("disclosure on with neither sub-option selected blocks publishing", () => {
  const { valid, errors } = validateTikTokComposerOptions({
    options: { ...defaultTikTokOptions(), privacy_level: "PUBLIC_TO_EVERYONE", commercial_content_toggle: true },
    creatorInfo,
  });
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.key === "marketing.tiktok.errors.disclosureSelectionRequired"));
});

test("a branded flag without the disclosure toggle is rejected", () => {
  const { valid, errors } = validateTikTokComposerOptions({
    options: { ...defaultTikTokOptions(), privacy_level: "PUBLIC_TO_EVERYONE", brand_content_toggle: true },
    creatorInfo,
  });
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.key === "marketing.tiktok.errors.disclosureRequired"));
});

test("Branded Content disables the SELF_ONLY privacy option instead of rewriting it", () => {
  const availability = deriveTikTokOptionAvailability(creatorInfo, { brand_content_toggle: true });
  const selfOnly = availability.privacy_levels.find((level) => level.value === "SELF_ONLY");
  assert.equal(selfOnly.disabled, true);
  assert.equal(selfOnly.disabledReasonKey, "marketing.tiktok.brandedContentSelfOnly");
});

test("selecting Branded Content clears an already-chosen SELF_ONLY privacy", () => {
  const next = reconcileTikTokOptions(
    { privacy_level: "SELF_ONLY", commercial_content_toggle: true, brand_content_toggle: true },
    creatorInfo
  );
  assert.equal(next.privacy_level, "", "an illegal privacy choice must be cleared, not silently posted");
});

test("Branded Content with SELF_ONLY is rejected by validation", () => {
  const { valid, errors } = validateTikTokComposerOptions({
    options: { ...defaultTikTokOptions(), privacy_level: "SELF_ONLY", commercial_content_toggle: true, brand_content_toggle: true },
    creatorInfo,
  });
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.key === "marketing.tiktok.errors.brandedContentSelfOnly"));
});

test("turning the disclosure off clears both branded flags", () => {
  const next = reconcileTikTokOptions(
    { commercial_content_toggle: false, brand_organic_toggle: true, brand_content_toggle: true },
    creatorInfo
  );
  assert.equal(next.brand_organic_toggle, false);
  assert.equal(next.brand_content_toggle, false);
});

test("the compliance statement has the three official variants", () => {
  assert.equal(tiktokComplianceStatementKey({ commercial_content_toggle: false }), "marketing.tiktok.consent.music");
  assert.equal(
    tiktokComplianceStatementKey({ commercial_content_toggle: true, brand_organic_toggle: true }),
    "marketing.tiktok.consent.music"
  );
  assert.equal(
    tiktokComplianceStatementKey({ commercial_content_toggle: true, brand_content_toggle: true }),
    "marketing.tiktok.consent.brandedAndMusic"
  );
});

test("the content label matches the disclosure selection", () => {
  assert.equal(tiktokContentLabelKey({ commercial_content_toggle: true, brand_content_toggle: true }), "marketing.tiktok.label.paidPartnership");
  assert.equal(tiktokContentLabelKey({ commercial_content_toggle: true, brand_organic_toggle: true }), "marketing.tiktok.label.promotionalContent");
  assert.equal(tiktokContentLabelKey({ commercial_content_toggle: false }), "");
});

// ---------------------------------------------------------------------------
// Video validation
// ---------------------------------------------------------------------------

test("an image is rejected before any upload", () => {
  const { valid, errors } = validateTikTokVideo({ mediaType: "image", fileName: "photo.jpg" });
  assert.equal(valid, false);
  assert.equal(errors[0].key, "marketing.tiktok.errors.videoRequired");
  assert.equal(errors.length, 1, "video-specific errors must not be reported for an image");
});

test("an unsupported video container is rejected", () => {
  const { valid, errors } = validateTikTokVideo({ ...goodVideo, fileName: "clip.avi" });
  assert.equal(valid, false);
  assert.ok(errors.some((error) => error.key === "marketing.tiktok.errors.unsupportedFormat"));
  assert.ok(TIKTOK_VIDEO_EXTENSIONS.includes("mp4"));
});

test("a video longer than the creator's cap is rejected with the cap in the message", () => {
  const { valid, errors } = validateTikTokVideo({ ...goodVideo, durationSec: 120 });
  assert.equal(valid, false);
  const tooLong = errors.find((error) => error.key === "marketing.tiktok.errors.tooLong");
  assert.equal(tooLong.params.max, 60);
});

test("an unknown duration or missing cap does not fabricate a duration error", () => {
  assert.equal(validateTikTokVideo({ ...goodVideo, durationSec: 0 }).valid, true);
  assert.equal(validateTikTokVideo({ ...goodVideo, maxDurationSec: 0, durationSec: 9999 }).valid, true);
});

test("a valid video passes", () => {
  assert.equal(validateTikTokVideo(goodVideo).valid, true);
});

// ---------------------------------------------------------------------------
// Direct Post vs Draft
// ---------------------------------------------------------------------------

test("a complete Direct Post payload carries every TikTok option", () => {
  const settings = buildTikTokPublishSettings({
    options: { ...defaultTikTokOptions(), privacy_level: "PUBLIC_TO_EVERYONE", commercial_content_toggle: true, brand_organic_toggle: true },
    creatorInfo,
    durationSec: 20,
  });
  assert.equal(settings.post_mode, "DIRECT_POST");
  assert.equal(settings.privacy_level, "PUBLIC_TO_EVERYONE");
  assert.equal(settings.brand_organic_toggle, true);
  assert.equal(settings.video_duration_sec, 20);
});

test("a draft payload carries only the post mode, never a caption or privacy", () => {
  const settings = buildTikTokPublishSettings({
    options: { ...defaultTikTokOptions(), privacy_level: "PUBLIC_TO_EVERYONE" },
    creatorInfo,
    postMode: TIKTOK_POST_MODES.INBOX_UPLOAD,
  });
  assert.deepEqual(settings, { post_mode: "INBOX_UPLOAD" });
});

test("draft validation skips privacy and disclosure but still checks the video", () => {
  const ok = validateTikTokComposerOptions({ options: defaultTikTokOptions(), creatorInfo, postMode: TIKTOK_POST_MODES.INBOX_UPLOAD });
  assert.equal(ok.valid, true, "a draft must not require a privacy level");

  const badVideo = validateTikTokComposerOptions({
    options: defaultTikTokOptions(),
    creatorInfo,
    postMode: TIKTOK_POST_MODES.INBOX_UPLOAD,
    video: { mediaType: "image", fileName: "a.jpg" },
  });
  assert.equal(badVideo.valid, false);
});

test("Draft is a separate action from Publish in the composer", () => {
  assert.match(publisherSource, /handleUploadTikTokDraft/);
  assert.match(publisherSource, /marketing\.tiktok\.uploadDraft/);
  assert.match(publisherSource, /TIKTOK_POST_MODES\.INBOX_UPLOAD/);
  assert.ok(publisherSource.includes("handlePublishNow") && publisherSource.includes("handleUploadTikTokDraft"),
    "publish and draft must be distinct handlers");
});

test("publishing requires an explicit user action, not media selection", () => {
  // handleMediaChange must not trigger any publish path.
  const mediaChange = publisherSource.split("const handleMediaChange")[1]?.split("};")[0] || "";
  assert.ok(!/publishSocialPublisherPost|handlePublishNow|handleUploadTikTokDraft/.test(mediaChange),
    "selecting a video must never auto-publish");
});

// ---------------------------------------------------------------------------
// Publish status
// ---------------------------------------------------------------------------

test("uploaded is reported as processing, never as published", () => {
  const uploaded = tiktokStatusPresentation("uploaded");
  assert.equal(uploaded.labelKey, "marketing.tiktok.status.processing");
  assert.equal(uploaded.terminal, false, "the tracker must keep polling after upload");
  assert.notEqual(uploaded.tone, "success");
});

test("uploading, published, draft_ready and failed map to distinct terminal states", () => {
  assert.equal(tiktokStatusPresentation("uploading").terminal, false);
  assert.equal(tiktokStatusPresentation("published").terminal, true);
  assert.equal(tiktokStatusPresentation("published").tone, "success");
  assert.equal(tiktokStatusPresentation("draft_ready").labelKey, "marketing.tiktok.status.draftReady");
  assert.equal(tiktokStatusPresentation("failed").tone, "error");
  assert.equal(tiktokStatusPresentation("failed").terminal, true);
});

test("an unknown status keeps polling instead of claiming success", () => {
  const unknown = tiktokStatusPresentation("something_new");
  assert.equal(unknown.terminal, false);
  assert.notEqual(unknown.tone, "success");
});

test("the composer polls the real publish status endpoint", () => {
  assert.match(publisherSource, /getTikTokPublishStatus/);
  assert.match(publisherSource, /tiktok_result/);
});

// ---------------------------------------------------------------------------
// Multi-channel isolation
// ---------------------------------------------------------------------------

test("TikTok settings are nested under a tiktok key and never mixed with Meta keys", () => {
  const settings = buildTikTokPublishSettings({
    options: { ...defaultTikTokOptions(), privacy_level: "PUBLIC_TO_EVERYONE" },
    creatorInfo,
  });
  for (const metaKey of ["facebook_page_id", "instagram_account_id", "facebook_page_name", "instagram_username"]) {
    assert.ok(!(metaKey in settings), `${metaKey} must not appear in the TikTok payload`);
  }
});

test("the TikTok block is only added to publish_settings when TikTok is selected", () => {
  assert.match(publisherSource, /if \(tiktokSelected\) \{\s*publishSettingsPayload\.tiktok =/);
});

test("Meta account checks are scoped to Meta platforms so TikTok-only posts are not blocked", () => {
  assert.match(publisherSource, /selectedMetaPlatforms\.length && !hasFacebookAccount/);
  assert.match(publisherSource, /selectedMetaPlatforms\.includes\("instagram"\) && !hasInstagramAccount/);
  assert.ok(!/selectedPlatforms\.includes\("instagram"\) && !hasInstagramAccount/.test(publisherSource),
    "the Instagram check must no longer look at the full platform list");
});

test("a TikTok draft refuses to run alongside Meta platforms", () => {
  assert.match(publisherSource, /marketing\.tiktok\.draftTikTokOnly/);
});

// ---------------------------------------------------------------------------
// Localization
// ---------------------------------------------------------------------------

test("every TikTok string used by the UI exists in both AR and EN", () => {
  const used = new Set();
  for (const source of [publisherSource, panelSource]) {
    for (const match of source.matchAll(/t\("(marketing\.tiktok\.[a-zA-Z0-9_.]+)"/g)) used.add(match[1]);
  }
  // Keys produced indirectly by the pure helpers.
  for (const key of [
    "marketing.tiktok.consent.music", "marketing.tiktok.consent.brandedAndMusic",
    "marketing.tiktok.label.paidPartnership", "marketing.tiktok.label.promotionalContent",
    "marketing.tiktok.privacy.public", "marketing.tiktok.privacy.friends",
    "marketing.tiktok.privacy.followers", "marketing.tiktok.privacy.selfOnly",
    "marketing.tiktok.status.uploading", "marketing.tiktok.status.processing",
    "marketing.tiktok.status.published", "marketing.tiktok.status.draftReady", "marketing.tiktok.status.failed",
    "marketing.tiktok.blocked.notConnected", "marketing.tiktok.errors.privacyRequired",
    "marketing.tiktok.errors.videoRequired",
  ]) used.add(key);

  assert.ok(used.size > 20, `expected a meaningful number of TikTok keys, found ${used.size}`);
  const resolve = (bundle, key) => key.replace(/^marketing\./, "").split(".").reduce((node, part) => (node ?? {})[part], bundle);
  for (const key of used) {
    assert.equal(typeof resolve(enLocale, key), "string", `missing EN string: ${key}`);
    assert.equal(typeof resolve(arLocale, key), "string", `missing AR string: ${key}`);
  }
});

test("no user-facing TikTok string is hardcoded in the panel", () => {
  // Every rendered string goes through t(); the only bare text is JSX structure.
  const jsxText = panelSource.match(/>[A-Za-z][A-Za-z ,.'"-]{6,}</g) || [];
  assert.deepEqual(jsxText, [], `hardcoded UI text found: ${jsxText.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Temporal dead zone regression
// ---------------------------------------------------------------------------
// A production crash ("can't access lexical declaration 'Wn' before
// initialization") was caused by hoisting the publish/schedule/draft gating
// constants above hasFacebookAccount/hasInstagramAccount, which are `const`
// declared ~550 lines further down the same component scope. Reading a `const`
// before its declaration is a TDZ error that throws on every render — and it is
// invisible to lint and to any test that never renders the component.
test("no gating constant is used before it is declared (temporal dead zone)", () => {
  const lines = publisherSource.split("\n");
  const codeOnly = lines.map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line));

  // String.raw: in a plain template literal `\s` collapses to `s`, which would
  // silently make these regexes match nothing and the whole test vacuous.
  // Matches both `const x =` and the array-destructured `const [x, setX] =`
  // that useState produces — both are lexical and both can hit a TDZ.
  const declarationLine = (name) =>
    codeOnly.findIndex((line) =>
      new RegExp(String.raw`^\s*(?:const|let)\s+(?:\[\s*)?` + name + String.raw`\s*[,\]=]`).test(line)
    );

  for (const name of [
    "metaAccountsMissing",
    "tiktokBlocksPublish",
    "publishDisabled",
    "scheduleDisabled",
    "tiktokDraftDisabled",
    "hasFacebookAccount",
    "hasInstagramAccount",
    "selectedMetaPlatforms",
    "tiktokSelected",
    "tiktokReadiness",
  ]) {
    const declaredAt = declarationLine(name);
    assert.ok(declaredAt >= 0, `${name}: declaration not found`);
    const usedAt = codeOnly.findIndex(
      (line, index) => index !== declaredAt && new RegExp(String.raw`\b` + name + String.raw`\b`).test(line)
    );
    if (usedAt === -1) continue;
    assert.ok(
      usedAt > declaredAt,
      `${name} is read at line ${usedAt + 1} but declared at line ${declaredAt + 1} — temporal dead zone crash at render`
    );
  }
});

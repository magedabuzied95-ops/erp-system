// TikTok comments — automatic public reply. Offline: every dependency is
// injected (settings, sender, persistence, clock); no network, no database.
//
// What these protect:
//   1. The TikTok switch is OFF by default, and while off nothing is written.
//   2. TikTok runs the SAME gates as Facebook/Instagram — the real
//      classifySocialCommentIntent and buildSocialCommentAutomationDecision,
//      not copies: lead label + min_confidence, the tenant public-reply switch,
//      the SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY env kill switch, banned words.
//   3. The send step goes to the TikTok sender, never a Graph call; like / DM /
//      hide are recorded as unsupported_platform and never attempted or thrown.
//   4. History is never answered (recency guard), threads are not answered,
//      own comments are not answered, a duplicate in flight writes nothing.
//   5. The ingest hook hands only first-seen customer comments to the runner,
//      and a runner failure never fails the sync.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const automation = await import("../../server/services/tiktokCommentAutomationService.js");
const metaRules = await import("../../server/services/socialCommentAutomationService.js");
const settingsModule = await import("../../server/services/socialAutomationSettingsService.js");
const syncModule = await import("../../server/services/tiktokBusinessCommentsSyncService.js");

const { runTikTokCommentAutoReply, renderTikTokCommentPublicReply, resolveTikTokPublicReplyBaseTemplate } = automation;
const { DEFAULT_SOCIAL_AUTOMATION_SETTINGS } = settingsModule;

const NOW = new Date("2026-10-20T12:00:00.000Z");
const FRESH = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();

const settingsWith = (overrides = {}) => ({
  ...DEFAULT_SOCIAL_AUTOMATION_SETTINGS,
  auto_public_reply_enabled: true,
  tiktok_auto_reply_enabled: true,
  public_reply_rotation_enabled: false,
  ...overrides,
});

const tiktokRow = (overrides = {}) => ({
  tenant_id: 7,
  platform: "tiktok",
  channel: "tiktok_comment",
  post_id: "7412000000000000001",
  comment_id: "7412000000000000099",
  parent_comment_id: "",
  commenter_id: "open-id-customer",
  commenter_name: "Mona",
  original_comment_text: "بكام",
  classification_label: null,
  classification_score: null,
  public_reply_status: null,
  raw_payload: {
    source: "tiktok_business_comment_sync",
    is_reply: false,
    comment_created_time: FRESH,
  },
  ...overrides,
});

// A recorder for every side effect the runner can have.
const harness = ({ settings = settingsWith(), sendReply, featureFlags } = {}) => {
  const persisted = [];
  const sent = [];
  const deps = {
    getSettings: async () => settings,
    persist: async (payload) => { persisted.push(payload); },
    sendReply: sendReply || (async (payload) => {
      sent.push(payload);
      return { sent: true, duplicate: false, provider_reply_id: "7412000000000000500", video_id: "7412000000000000001" };
    }),
    classify: metaRules.classifySocialCommentIntent,
    buildDecision: metaRules.buildSocialCommentAutomationDecision,
    featureFlags: featureFlags || { like: { enabled: null }, publicReply: { enabled: null }, privateMessage: { enabled: null } },
    now: () => NOW,
    log: () => {},
  };
  return { deps, persisted, sent };
};

test("the TikTok switch ships OFF, and the column defaults to FALSE", () => {
  assert.equal(DEFAULT_SOCIAL_AUTOMATION_SETTINGS.tiktok_auto_reply_enabled, false);
  assert.equal(DEFAULT_SOCIAL_AUTOMATION_SETTINGS.tiktok_public_reply_template, null);
  const source = readFileSync(new URL("../../server/services/socialAutomationSettingsService.js", import.meta.url), "utf8");
  assert.match(source, /ADD COLUMN IF NOT EXISTS tiktok_auto_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  // The upsert must write it, or saving the settings page would never turn it on.
  assert.match(source, /tiktok_auto_reply_enabled = EXCLUDED\.tiktok_auto_reply_enabled/);
});

test("switch off: nothing is sent and nothing is written, even with every Meta switch on", async () => {
  const { deps, persisted, sent } = harness({ settings: settingsWith({ tiktok_auto_reply_enabled: false, auto_like_enabled: true, auto_private_message_enabled: true }) });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "tiktok_auto_reply_disabled");
  assert.equal(sent.length, 0);
  assert.equal(persisted.length, 0);
});

test("a lead comment gets one public reply through the TikTok sender, and the run is logged", async () => {
  const { deps, persisted, sent } = harness();
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });

  assert.equal(result.skipped, false);
  assert.equal(result.public_reply_status, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].tenantId, 7);
  assert.equal(sent[0].commentId, "7412000000000000099");
  assert.equal(sent[0].text, result.reply_text);

  assert.equal(persisted.length, 1);
  const { outcome } = persisted[0];
  assert.equal(outcome.action_taken, "automation_completed");
  assert.equal(outcome.public_reply_status, "sent");
  assert.equal(outcome.like_status, "skipped");
  assert.equal(outcome.dm_status, "skipped");
  assert.equal(outcome.classification_label, "lead_price");
  const steps = Object.fromEntries(outcome.automation_state.tiktok.step_results.map((step) => [step.step, step]));
  assert.equal(steps.publicReply.status, "sent");
  assert.equal(steps.publicReply.provider_reply_id, "7412000000000000500");
  for (const unsupported of ["likeComment", "privateReply", "hideComment"]) {
    assert.deepEqual(steps[unsupported], { step: unsupported, status: "skipped", reason: "unsupported_platform" });
  }
});

test("same gates as Meta: tenant public-reply switch off → skipped, recorded, not sent", async () => {
  const { deps, persisted, sent } = harness({ settings: settingsWith({ auto_public_reply_enabled: false }) });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.reason, "tenant_automation_disabled");
  assert.equal(sent.length, 0);
  assert.equal(persisted[0].outcome.public_reply_status, "skipped");
  assert.equal(persisted[0].outcome.action_taken, "automation_skipped_tenant_automation_disabled");
});

test("same gates as Meta: the SOCIAL_COMMENTS_AUTO_PUBLIC_REPLY kill switch stops TikTok too", async () => {
  const { deps, sent } = harness({
    featureFlags: { like: { enabled: null }, publicReply: { enabled: false, explicitlyDisabled: true }, privateMessage: { enabled: null } },
  });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.reason, "feature_flags_disabled");
  assert.equal(sent.length, 0);
});

test("same gates as Meta: a non-lead comment is not answered", async () => {
  const { deps, persisted, sent } = harness();
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow({ original_comment_text: "حلو" }), deps });
  assert.equal(result.reason, "ineligible_comment");
  assert.equal(sent.length, 0);
  assert.equal(persisted[0].outcome.classification_label, "engagement_only");
});

test("same gates as Meta: a score under min_confidence is not answered", async () => {
  const { deps, sent } = harness({ settings: settingsWith({ min_confidence: 0.99 }) });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.reason, "low_confidence_comment");
  assert.equal(sent.length, 0);
});

test("a banned word is never thanked in public", async () => {
  const { deps, sent } = harness({
    settings: settingsWith({ banned_words_enabled: true, banned_words: ["نصابين"], banned_word_exceptions: [] }),
  });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow({ original_comment_text: "بكام يا نصابين" }), deps });
  assert.equal(result.reason, "banned_word");
  assert.equal(sent.length, 0);
});

test("history is never answered: a comment older than the recency window is skipped", async () => {
  const { deps, sent, persisted } = harness();
  const old = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const result = await runTikTokCommentAutoReply({
    tenantId: 7,
    row: tiktokRow({ raw_payload: { source: "tiktok_business_comment_sync", comment_created_time: old } }),
    deps,
  });
  assert.equal(result.reason, "old_comment_recency_guard");
  assert.equal(sent.length, 0);
  assert.equal(persisted[0].outcome.error_code, "old_comment_recency_guard");
});

test("replies inside a thread, own comments and other platforms are not answered", async () => {
  const thread = harness();
  const threadResult = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow({ parent_comment_id: "7412000000000000001" }), deps: thread.deps });
  assert.equal(threadResult.reason, "reply_comment");
  assert.equal(thread.sent.length, 0);

  const own = harness();
  const ownResult = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), isOwn: true, deps: own.deps });
  assert.equal(ownResult.reason, "own_comment");
  assert.equal(own.sent.length + own.persisted.length, 0);

  const meta = harness();
  const metaResult = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow({ platform: "facebook", channel: "facebook_comment" }), deps: meta.deps });
  assert.equal(metaResult.reason, "not_tiktok");
  assert.equal(meta.sent.length + meta.persisted.length, 0);
});

test("an already-answered comment is not answered again", async () => {
  const { deps, sent, persisted } = harness();
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow({ public_reply_status: "sent" }), deps });
  assert.equal(result.reason, "already_processed");
  assert.equal(sent.length + persisted.length, 0);
});

test("a failed send is recorded as failed and never thrown", async () => {
  const { deps, persisted } = harness({
    sendReply: async () => {
      throw Object.assign(new Error("comment is not visible"), { status: 400, code: "TIKTOK_BUSINESS_API_ERROR" });
    },
  });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.public_reply_status, "failed");
  assert.equal(persisted[0].outcome.action_taken, "automation_failed");
  assert.equal(persisted[0].outcome.error_code, "tiktok_reply_failed");
  assert.equal(persisted[0].outcome.like_status, "skipped");
  assert.equal(persisted[0].outcome.dm_status, "skipped");
});

test("a duplicate already in flight (poll + webhook race) writes nothing", async () => {
  const { deps, persisted } = harness({
    sendReply: async () => {
      throw Object.assign(new Error("in flight"), { status: 409, code: "TIKTOK_BUSINESS_REPLY_DUPLICATE" });
    },
  });
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.reason, "duplicate_in_flight");
  assert.equal(persisted.length, 0);
});

test("a broken dependency is contained: the runner returns, it does not throw", async () => {
  const { deps } = harness();
  deps.getSettings = async () => { throw new Error("db down"); };
  const result = await runTikTokCommentAutoReply({ tenantId: 7, row: tiktokRow(), deps });
  assert.equal(result.reason, "automation_error");
});

test("reply text: the shared reply minus its DM promise, with the customer's name", () => {
  const settings = settingsWith();
  const base = resolveTikTokPublicReplyBaseTemplate(settings);
  assert.ok(settings.public_reply_template.includes("في الخاص"), "fixture: the shared default promises a DM");
  assert.ok(!base.includes("في الخاص"), "no DM is sent on TikTok, so the promise must go");
  assert.ok(base.includes("المحافظات"), "every other line is kept");

  const rotating = settingsWith({ public_reply_rotation_enabled: true });
  const reply = renderTikTokCommentPublicReply({ row: tiktokRow(), settings: rotating });
  assert.ok(reply.includes("Mona"));
  assert.ok(!reply.includes("{{customer_name}}"));
  assert.ok(!reply.includes("في الخاص"));
});

test("reply text: the TikTok template wins when set, and is capped at the API limit", () => {
  const settings = settingsWith({ tiktok_public_reply_template: "أهلاً {{customer_name}} — ابعتلنا على واتساب" });
  assert.equal(renderTikTokCommentPublicReply({ row: tiktokRow(), settings }), "أهلاً Mona — ابعتلنا على واتساب");

  const long = settingsWith({ tiktok_public_reply_template: "ا".repeat(5000) });
  assert.equal(Array.from(renderTikTokCommentPublicReply({ row: tiktokRow(), settings: long })).length, 1200);
});

test("the Meta engine still refuses TikTok — the TikTok path is separate, not a hole in the guard", () => {
  const source = readFileSync(new URL("../../server/services/socialCommentsCenterService.js", import.meta.url), "utf8");
  assert.match(source, /assertMetaPlatform\(platform, "processSocialCommentAutoReply"\)/);
  const syncSource = readFileSync(new URL("../../server/services/tiktokBusinessCommentsSyncService.js", import.meta.url), "utf8");
  assert.match(syncSource, /skipAutomation: true/);
});

// ---------------------------------------------------------------------------
// The ingest hook
// ---------------------------------------------------------------------------

const fakeClient = (knownIds = []) => ({
  query: async (sql) => {
    if (/SELECT tiktok_comment_id, is_own_reply/.test(sql)) {
      return { rows: knownIds.map((id) => ({ tiktok_comment_id: id, is_own_reply: false })) };
    }
    return { rows: [{ id: 1, inserted: true }], rowCount: 1 };
  },
});

const normalizedComment = (overrides = {}) => ({
  external_message_id: "7412000000000000099",
  external_conversation_id: "7412000000000000001",
  parent_external_message_id: "",
  external_customer_id: "open-id-customer",
  customer_name: "Mona",
  customer_username: "mona.eg",
  body: "بكام",
  created_at: FRESH,
  is_owner: false,
  ...overrides,
});

test("ingest: a first-seen customer comment is stored with skipAutomation and handed to the TikTok runner", async () => {
  const stored = [];
  const handed = [];
  const storeDeps = {
    storeSocialCommentAutomationRuns: async ({ events, skipAutomation }) => {
      stored.push({ events, skipAutomation });
      return [{ ...events[0], id: 55 }];
    },
    runAutoReply: async (payload) => { handed.push(payload); return { skipped: true }; },
  };
  const result = await syncModule.ingestTikTokComments({
    tenantId: 7,
    businessId: "biz",
    video: { item_id: "7412000000000000001" },
    comments: [normalizedComment()],
    storeDeps,
    client: fakeClient(),
  });
  assert.equal(result.ingested, 1);
  assert.equal(stored[0].skipAutomation, true, "the Meta engine must never receive a tiktok row");
  assert.equal(handed.length, 1);
  assert.equal(handed[0].tenantId, 7);
  assert.equal(handed[0].isOwn, false);
  assert.equal(handed[0].row.platform, "tiktok");
  assert.equal(handed[0].row.id, 55, "the runner gets the stored row");
});

test("ingest: own comments and already-known comments never reach the runner", async () => {
  const handed = [];
  const storeDeps = {
    storeSocialCommentAutomationRuns: async ({ events }) => [events[0]],
    runAutoReply: async (payload) => { handed.push(payload); },
  };
  await syncModule.ingestTikTokComments({
    tenantId: 7,
    businessId: "biz",
    video: { item_id: "7412000000000000001" },
    comments: [
      normalizedComment({ external_message_id: "1", is_owner: true }),
      normalizedComment({ external_message_id: "2" }),
    ],
    storeDeps,
    client: fakeClient(["2"]),
  });
  assert.equal(handed.length, 0);
});

test("ingest: a runner failure never fails the sync", async () => {
  const storeDeps = {
    storeSocialCommentAutomationRuns: async ({ events }) => [events[0]],
    runAutoReply: () => { throw new Error("boom"); },
  };
  const result = await syncModule.ingestTikTokComments({
    tenantId: 7,
    businessId: "biz",
    video: { item_id: "7412000000000000001" },
    comments: [normalizedComment({ external_message_id: "a" }), normalizedComment({ external_message_id: "b" })],
    storeDeps,
    client: fakeClient(),
  });
  assert.equal(result.ingested, 2);
});

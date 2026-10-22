import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

import { metaReviewerApiBoundary } from "../../server/middleware/metaReviewerBoundary.js";
import {
  emitMetaReviewerInboundEvent,
  filterMetaReviewerVisibleMessages,
  loadMetaReviewerScope,
  metaReviewerWhatsappPhoneAllowed,
} from "../../server/services/metaReviewerAccessService.js";
import { metaReviewerWhatsappRowAllowed, sendWhatsappReviewerReply } from "../../server/services/metaReviewerInboxService.js";
import { applyMetaReviewerRoutePolicy } from "../../server/services/metaReviewerRoutePolicy.js";
import { prepareReviewerPublish, reviewerRecordScope } from "../../server/modules/metaAds/metaAdsReviewer.js";
import { setIo } from "../../server/utils/socket.js";

const TEST_NUMBER = "1099131296614579";
const EVOLUTION = "m1_business_v237";
const env = {
  META_REVIEWER_TENANT_ID: "1",
  META_REVIEWER_SCOPE_HMAC_KEY: "test-only-hmac-key-with-sufficient-entropy",
  META_REVIEWER_WHATSAPP_PHONE_NUMBER_IDS: TEST_NUMBER,
  META_REVIEWER_WHATSAPP_ALLOWED_PHONES: "201024960585",
  META_REVIEWER_WHATSAPP_REVIEW_SESSION_STARTED_AT: "2026-10-01T00:00:00.000Z",
};
const scope = loadMetaReviewerScope(env);
const makeResponse = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

/* ------------------------------------------------------------------ WhatsApp test tab */

test("WhatsApp review tab is closed by default (no test phone_number_id configured)", () => {
  const closed = loadMetaReviewerScope({ ...env, META_REVIEWER_WHATSAPP_PHONE_NUMBER_IDS: "" });
  assert.equal(closed.channels.whatsapp.enabled, false);
  assert.equal(scope.channels.whatsapp.enabled, true);
});

test("a mixed thread shows only the test-number rows: Evolution and other numbers are hidden", () => {
  const messages = [
    { id: 1, whatsapp_instance: `cloud:${TEST_NUMBER}`, created_at: "2026-10-20T10:00:00.000Z" },
    { id: 2, whatsapp_instance: EVOLUTION, created_at: "2026-10-20T10:01:00.000Z" },
    { id: 3, whatsapp_instance: "cloud:4410867005694052", created_at: "2026-10-20T10:02:00.000Z" },
    { id: 4, whatsapp_instance: "", created_at: "2026-10-20T10:03:00.000Z" },
    { id: 5, whatsapp_instance: `cloud:${TEST_NUMBER}`, created_at: "2026-09-01T10:00:00.000Z" },
  ];
  assert.deepEqual(filterMetaReviewerVisibleMessages(messages, scope, "whatsapp").map((row) => row.id), [1]);
});

test("WhatsApp conversations need the test number AND an allow-listed customer phone", () => {
  const base = { resolved_instance: `cloud:${TEST_NUMBER}`, external_customer_id: "201024960585", channel_metadata: {} };
  assert.equal(metaReviewerWhatsappRowAllowed(base, scope), true);
  assert.equal(metaReviewerWhatsappRowAllowed({ ...base, resolved_instance: EVOLUTION }, scope), false);
  assert.equal(metaReviewerWhatsappRowAllowed({ ...base, resolved_instance: "cloud:4410867005694052" }, scope), false);
  assert.equal(metaReviewerWhatsappRowAllowed({ ...base, external_customer_id: "201000659301" }, scope), false);
  // One identity field naming a real customer is enough to hide the thread.
  assert.equal(metaReviewerWhatsappRowAllowed({ ...base, channel_metadata: { phone: "201000000001" } }, scope), false);
  assert.equal(metaReviewerWhatsappPhoneAllowed("01024960585", scope), true);
});

test("a reviewer reply leaves only through the test number, never Evolution", async () => {
  const sent = [];
  const send = async (payload) => { sent.push(payload); return { message_id: "wamid.test" }; };
  const ok = await sendWhatsappReviewerReply({ conversation: { assetId: TEST_NUMBER, senderScopedId: "201024960585" }, scope, messageText: "hi", send });
  assert.equal(ok.sent, true);
  assert.deepEqual(sent, [{ phone: "201024960585", message: "hi", phoneNumberId: TEST_NUMBER }]);
  await assert.rejects(() => sendWhatsappReviewerReply({ conversation: { assetId: EVOLUTION, senderScopedId: "201024960585" }, scope, messageText: "x", send }), { status: 403 });
  await assert.rejects(() => sendWhatsappReviewerReply({ conversation: { assetId: TEST_NUMBER, senderScopedId: "201000659301" }, scope, messageText: "x", send }), { status: 403 });
  assert.equal(sent.length, 1);
});

test("realtime goes to the whatsapp-test room only, and only for test-number rows", () => {
  const events = [];
  setIo({ to(room) { events.push({ room }); return this; }, emit(name) { events.push({ name }); return this; } });
  const message = { whatsapp_instance: EVOLUTION, sender_type: "customer", message_text: "x", created_at: "2026-10-20T10:00:00.000Z" };
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "whatsapp", assetId: TEST_NUMBER, senderScopedId: "201024960585", sessionId: "s", message }, scope), false);
  assert.equal(events.length, 0);
  assert.equal(emitMetaReviewerInboundEvent({ tenantId: 1, channel: "whatsapp", assetId: TEST_NUMBER, senderScopedId: "201024960585", sessionId: "s", message: { ...message, whatsapp_instance: `cloud:${TEST_NUMBER}` } }, scope), true);
  assert.ok(events.every((event) => !event.room || event.room === "meta-reviewer:tenant:1:whatsapp-test"));
  setIo(null);
});

/* ------------------------------------------------------------------ campaigns */

const customers = [
  { id: 11, name: "Owner test", phone: "01024960585" },
  { id: 12, name: "Real customer", phone: "01000659301" },
];
const fakeDeps = ({ sender = TEST_NUMBER, broadcast = null } = {}) => ({
  query: async (sql) => {
    if (sql.includes("whatsapp_cloud_integrations")) return { rows: [{ id: 2, waba_id: "1259342739118035", phone_number_id: TEST_NUMBER, status: "connected" }] };
    if (sql.includes("marketing_broadcasts")) return { rows: broadcast ? [broadcast] : [] };
    return { rows: [] };
  },
  cloudEnv: () => ({ phoneNumberId: "4410867005694052", businessAccountId: "359273425997166" }),
  templateCredentials: async () => ({ wabaId: "1259342739118035" }),
  sendCredentials: async () => ({ phoneNumberId: sender }),
  // Mimics the audience query: tags narrow, restrict_customer_ids caps.
  resolveAudience: async ({ audience = {} }) => customers
    .filter((row) => !(audience.tags || []).includes("test") || row.id === 11)
    .filter((row) => !Array.isArray(audience.restrict_customer_ids) || audience.restrict_customer_ids.includes(row.id)),
});
const policyRequest = (method, url, body = {}) => ({ method, originalUrl: url, url, body, headers: {} });

test("an audience that reaches real customers is narrowed to the test phones only", async () => {
  const req = policyRequest("POST", "/api/marketing/broadcasts", { channel_mode: "template", template_id: 1, audience: {} });
  await applyMetaReviewerRoutePolicy(req, makeResponse(), { scope, deps: fakeDeps(), tenantId: 1 });
  // Only the allow-listed test customer survives; the real customers are never written into the audience.
  assert.deepEqual(req.body.audience.restrict_customer_ids, [11]);
});

test("campaign create with only the test phone is allowed and capped to that customer id", async () => {
  const req = policyRequest("POST", "/api/marketing/broadcasts", { channel_mode: "template", template_id: 1, audience: { tags: ["test"] } });
  const result = await applyMetaReviewerRoutePolicy(req, makeResponse(), { scope, deps: fakeDeps(), tenantId: 1 });
  assert.ok(result.grants.has("settings.edit"));
  assert.deepEqual(req.body.audience.restrict_customer_ids, [11]);
});

test("text-mode campaigns (Evolution transport) are refused for the reviewer", async () => {
  const req = policyRequest("POST", "/api/marketing/broadcasts", { channel_mode: "text", message_body: "x", audience: { tags: ["test"] } });
  await assert.rejects(() => applyMetaReviewerRoutePolicy(req, makeResponse(), { scope, deps: fakeDeps(), tenantId: 1 }), { status: 403, code: "META_REVIEWER_TEMPLATE_ONLY" });
});

test("campaign send needs a test-only audience AND the test number as sender", async () => {
  const broadcast = { id: 9, channel_mode: "template", audience: { restrict_customer_ids: [11] }, frequency_cap_days: 7 };
  const ok = await applyMetaReviewerRoutePolicy(policyRequest("POST", "/api/marketing/broadcasts/9/send"), makeResponse(), { scope, deps: fakeDeps({ broadcast }), tenantId: 1 });
  assert.ok(ok.grants.has("settings.edit"));
  await assert.rejects(() => applyMetaReviewerRoutePolicy(policyRequest("POST", "/api/marketing/broadcasts/9/send"), makeResponse(), { scope, deps: fakeDeps({ broadcast, sender: "4410867005694052" }), tenantId: 1 }), { status: 403, code: "META_REVIEWER_SENDER_FORBIDDEN" });
  const widened = { ...broadcast, audience: { restrict_customer_ids: [11, 12] } };
  await assert.rejects(() => applyMetaReviewerRoutePolicy(policyRequest("POST", "/api/marketing/broadcasts/9/send"), makeResponse(), { scope, deps: fakeDeps({ broadcast: widened }), tenantId: 1 }), { status: 403 });
  // The owner's campaigns (no reviewer cap) are invisible to the reviewer.
  await assert.rejects(() => applyMetaReviewerRoutePolicy(policyRequest("POST", "/api/marketing/broadcasts/9/send"), makeResponse(), { scope, deps: fakeDeps({ broadcast: { ...broadcast, audience: {} } }), tenantId: 1 }), { status: 403 });
});

test("campaigns are refused when no test-phone allowlist is configured (fail closed)", async () => {
  const noPhones = loadMetaReviewerScope({ ...env, META_REVIEWER_WHATSAPP_ALLOWED_PHONES: "" });
  const req = policyRequest("POST", "/api/marketing/broadcasts", { channel_mode: "template", template_id: 1, audience: { tags: ["test"] } });
  await assert.rejects(() => applyMetaReviewerRoutePolicy(req, makeResponse(), { scope: noPhones, deps: fakeDeps(), tenantId: 1 }), { status: 403 });
});

test("number lists are narrowed to the test number (the disconnected M1 line is hidden)", async () => {
  const res = makeResponse();
  await applyMetaReviewerRoutePolicy(policyRequest("GET", "/api/whatsapp/embedded-signup/accounts"), res, { scope, deps: fakeDeps(), tenantId: 1 });
  res.json({ success: true, accounts: [{ id: "2", phone_number_id: TEST_NUMBER }, { id: "1", phone_number_id: "4410867005694052" }, { id: "env", phone_number_id: "4410867005694052" }] });
  assert.deepEqual(res.body.accounts.map((row) => row.id), ["2"]);
  await assert.rejects(() => applyMetaReviewerRoutePolicy(policyRequest("GET", "/api/whatsapp-official/accounts/1/settings"), makeResponse(), { scope, deps: fakeDeps(), tenantId: 1 }), { status: 403 });
});

/* ------------------------------------------------------------------ boundary + Meta Ads */

const reviewerToken = () => jwt.sign({ id: 50, role: "meta_reviewer", tenant_id: 1 }, process.env.JWT_SECRET);

test("hidden inbox menus (WhatsApp Web, TikTok, Config) are refused server-side too", async () => {
  process.env.JWT_SECRET = "boundary-test-secret";
  for (const [method, originalUrl] of [
    ["GET", "/api/whatsapp/status"],
    ["GET", "/api/whatsapp/queue"],
    ["GET", "/api/tiktok/status"],
    ["GET", "/api/ai-agent/settings"],
    ["GET", "/api/inbox-config/org/tags"],
    ["POST", "/api/whatsapp/embedded-signup/callback"],
  ]) {
    const res = makeResponse();
    let nextCalls = 0;
    await metaReviewerApiBoundary({ method, originalUrl, url: originalUrl, headers: { authorization: `Bearer ${reviewerToken()}` } }, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 0, `${method} ${originalUrl} must not reach its route`);
    assert.equal(res.statusCode, 403);
  }
});

test("Meta Ads: live / money actions are refused for the reviewer; drafts pass the boundary", async () => {
  process.env.JWT_SECRET = "boundary-test-secret";
  for (const originalUrl of [
    "/api/meta-ads/manager/status",
    "/api/meta-ads/manager/rules/toggle",
    "/api/meta-ads/records/campaigns/5/actions/activate",
    "/api/meta-ads/records/campaigns/5/actions/push_to_meta",
    "/api/meta-ads/records/ads/5/actions/delete_on_meta",
  ]) {
    const res = makeResponse();
    let nextCalls = 0;
    await metaReviewerApiBoundary({ method: "POST", originalUrl, url: originalUrl, headers: { authorization: `Bearer ${reviewerToken()}` } }, res, () => { nextCalls += 1; });
    assert.equal(nextCalls, 0, originalUrl);
    assert.equal(res.statusCode, 403);
  }
  const draftRequest = () => ({ method: "POST", originalUrl: "/api/meta-ads/manager/wizard/drafts/campaign", url: "/api/meta-ads/manager/wizard/drafts/campaign", headers: { authorization: `Bearer ${reviewerToken()}` } });
  // No review scope configured on this server → even drafts are refused (fail closed).
  let nextCalls = 0;
  const closed = makeResponse();
  await metaReviewerApiBoundary(draftRequest(), closed, () => { nextCalls += 1; });
  assert.equal(nextCalls, 0);
  assert.equal(closed.statusCode, 403);
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const req = draftRequest();
    await metaReviewerApiBoundary(req, makeResponse(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.ok(req.metaReviewerGrants.has("meta_ads.manage"));
  } finally {
    for (const key of Object.keys(env)) if (!(key in saved)) delete process.env[key];
  }
});

test("Meta Ads publish: refused without an allow-listed ad account, refused for live trees, else forced PAUSED", async () => {
  const calls = [];
  const query = (row) => async (sql, params) => { calls.push(sql); return sql.trim().startsWith("UPDATE") ? { rowCount: 1 } : { rows: [row] }; };
  const fresh = { id: 7, meta_id: null, ad_account_id: "act_123", live_adsets: 0, live_ads: 0 };
  await assert.rejects(() => prepareReviewerPublish({ tenantId: 1, campaignId: 7, env: {}, query: query(fresh) }), { code: "META_REVIEWER_PUBLISH_DISABLED" });
  const allow = { META_REVIEWER_ADS_PUBLISH_AD_ACCOUNT_IDS: "123" };
  await assert.rejects(() => prepareReviewerPublish({ tenantId: 1, campaignId: 7, env: allow, query: query({ ...fresh, meta_id: "238" }) }), { code: "META_REVIEWER_LIVE_ACTION_BLOCKED" });
  await assert.rejects(() => prepareReviewerPublish({ tenantId: 1, campaignId: 7, env: allow, query: query({ ...fresh, live_ads: 1 }) }), { code: "META_REVIEWER_LIVE_ACTION_BLOCKED" });
  await assert.rejects(() => prepareReviewerPublish({ tenantId: 1, campaignId: 7, env: allow, query: query({ ...fresh, ad_account_id: "act_999" }) }), { code: "META_REVIEWER_AD_ACCOUNT_FORBIDDEN" });
  calls.length = 0;
  assert.deepEqual(await prepareReviewerPublish({ tenantId: 1, campaignId: 7, env: allow, query: query(fresh) }), { paused: true });
  assert.ok(calls.some((sql) => sql.includes('"publish_status":"PAUSED"')));
});

test("Meta Ads leads are empty for the reviewer unless a test form is allow-listed", () => {
  assert.equal(reviewerRecordScope("leads", {})(2).sql, "FALSE");
  assert.match(reviewerRecordScope("leads", { META_REVIEWER_ADS_LEAD_FORM_IDS: "555" })(2).sql, /\$2::text\[\]/);
  assert.equal(reviewerRecordScope("ad-clicks", {})(2).sql, "FALSE");
  assert.equal(reviewerRecordScope("campaigns", {}), null);
});

test("normal admin users are unaffected: no reviewer grants, no narrowing", async () => {
  process.env.JWT_SECRET = "boundary-test-secret";
  const adminToken = jwt.sign({ id: 2, role: "admin", tenant_id: 1 }, process.env.JWT_SECRET);
  for (const originalUrl of ["/api/meta-ads/manager/status", "/api/marketing/broadcasts/1/send", "/api/whatsapp/queue"]) {
    const req = { method: "POST", originalUrl, url: originalUrl, headers: { authorization: `Bearer ${adminToken}` } };
    let nextCalls = 0;
    await metaReviewerApiBoundary(req, makeResponse(), () => { nextCalls += 1; });
    assert.equal(nextCalls, 1);
    assert.equal(req.metaReviewerGrants, undefined);
    assert.equal(req.metaReviewer, undefined);
  }
});

/* ------------------------------------------------- the store's own sending setup stays hidden */

test("the reviewer cannot read, edit or submit the automation templates (Evolution routing, owner wording)", async () => {
  const { matchMetaReviewerRoute } = await import("../../server/services/metaReviewerRoutePolicy.js");
  for (const [method, path] of [
    ["GET", "/api/whatsapp/templates/automation"],
    ["PUT", "/api/whatsapp/templates/automation/delivered"],
    ["DELETE", "/api/whatsapp/templates/automation/delivered"],
    ["POST", "/api/whatsapp/templates/automation/submit"],
  ]) {
    assert.equal(matchMetaReviewerRoute(method, path), null, `${method} ${path} must not be on the reviewer allowlist`);
  }
});

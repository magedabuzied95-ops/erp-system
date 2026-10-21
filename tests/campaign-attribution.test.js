// Campaign attribution (GENI's "Campaign Tracking"): template campaigns written into the inbox,
// replies tied back to their campaign, the card's data, the order copy and the AI instructions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import db from "../server/database/db.js";
import { campaignTranscriptRow, autoLeadGenerationOn, CAMPAIGN_SOURCE } from "../server/modules/campaignAttribution/campaignInbox.js";
import { findCampaignForReply, handleCampaignReplyInbound } from "../server/modules/campaignAttribution/campaignReplyInbound.js";
import {
  buildAttributionView,
  formatCampaignInstructions,
  mergeOrderAttribution,
  normalizeTouch,
  orderAttributionFromView,
  recordConversationTouch,
} from "../server/modules/campaignAttribution/attribution.js";
import { inboxMessageAuthorKind } from "../server/services/aiSalesAgentService.js";
import { buildDynamicContext } from "../server/services/aiClaudeSalesAgentService.js";
import { messageAuthorKind } from "../src/modules/aiSupport/services/messageAuthor.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Every query goes to `handler(sql, params)`; returns the call log and a restore.
const fakeDb = (handler) => {
  const calls = [];
  const original = db.query;
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return (await handler(String(sql), params)) || { rows: [] };
  };
  return { calls, restore: () => { db.query = original; } };
};

const TEMPLATE = {
  name: "spring_offer",
  header_format: "TEXT",
  header_text: "Hi {{1}}",
  header_example: "friend",
  body_text: "Hello {{1}}, code {{2}}",
  footer_text: "M1 Store",
  buttons: [{ type: "QUICK_REPLY", text: "Show me", payload: "show" }, { type: "URL", text: "Shop", url: "https://m1.test/{{1}}", example: "spring" }],
};

test("a campaign send becomes a template row in the customer's conversation, authored by the campaign", () => {
  const row = campaignTranscriptRow({
    tenantId: 1,
    broadcast: { id: 7, name: "Spring sale" },
    template: TEMPLATE,
    recipient: { phone: "01001234567", customer_name: "Mona" },
    values: ["Mona", "SPRING10"],
    messageId: "wamid.ABC",
    phoneNumberId: "555",
  });
  assert.equal(row.sessionId, "whatsapp:201001234567", "a local number keys the same thread the customer writes from");
  assert.equal(row.message, "Hello Mona, code SPRING10");
  assert.equal(row.messageType, "template");
  assert.deepEqual(row.suggestedActions.map((action) => action.type), ["whatsapp_header", "whatsapp_footer", "whatsapp_reply_button", "whatsapp_url_button"]);
  assert.equal(row.suggestedActions[0].title, "Hi friend");
  assert.equal(row.suggestedActions[3].value, "https://m1.test/spring");
  // The wamid is the row's provider id, so a reply quoting it resolves to this bubble.
  assert.equal(row.providerMessageId, "wamid.ABC");
  assert.equal(row.whatsappInstance, "cloud:555");
  assert.equal(row.staffUserName, "Spring sale");
  assert.equal(row.sourcePath, CAMPAIGN_SOURCE);
  // A send is not a conversation event: the session keeps its status, the AI is not woken.
  assert.equal(row.preserveSessionState, true);
  assert.equal(row.senderType, "system");

  const stored = { sender_type: "system", source_path: row.sourcePath, insert_source: row.insertSource, detected_intent: row.detectedIntent };
  assert.equal(inboxMessageAuthorKind(stored), "campaign");
  assert.equal(messageAuthorKind(stored), "campaign");
  // A Cloud status tick re-stamps source_path; detected_intent still names the writer.
  assert.equal(messageAuthorKind({ ...stored, source_path: "whatsapp_cloud_status_webhook", insert_source: "" }), "campaign");
  assert.equal(inboxMessageAuthorKind({ ...stored, source_path: "whatsapp_cloud_status_webhook", insert_source: "" }), "campaign");

  assert.equal(campaignTranscriptRow({ tenantId: 1, broadcast: {}, template: TEMPLATE, recipient: { phone: "" }, values: [] }), null);
  assert.equal(autoLeadGenerationOn({}), true, "auto lead generation defaults on, like GENI");
  assert.equal(autoLeadGenerationOn({ auto_lead_generation: false }), false);
});

test("the campaign chip has a label in both languages and the transcript draws it", () => {
  for (const locale of ["ar", "en"]) {
    const json = JSON.parse(read(`src/locales/${locale}/aiSupport.json`));
    assert.ok(json.inbox.author.campaignNamed.includes("{{name}}"), locale);
    assert.ok(json.attribution.title && json.attribution.chip.metaAd.includes("{{name}}"), locale);
    assert.ok(json.campaigns.replies.autoLead, locale);
  }
  const transcript = read("src/modules/aiSupport/components/TranscriptMessage.jsx");
  assert.match(transcript, /kind === "campaign"\) return name \? t\("aiSupport\.inbox\.author\.campaignNamed"/);
  assert.match(transcript, /campaign: Megaphone/);
});

test("deliverTemplateCampaign hands each delivered batch to the inbox without waiting on it", () => {
  const source = read("server/services/marketingCampaignTemplateService.js");
  assert.match(source, /void recordCampaignSendsSafe\(\{ tenantId, broadcast, template, phoneNumberId: credentials\.phoneNumberId, sends: delivered \}\)/);
  assert.match(source, /delivered\.push\(\{ recipient: \{ phone: row\.phone, customer_name: row\.customer_name \}, values, messageId/);
  const intercept = read("server/modules/whatsappOfficial/inboundIntercept.js");
  assert.ok(intercept.indexOf('["campaign_reply"') < intercept.indexOf('["chatbot_flow"'), "a campaign reply is looked at before the number's own flows");
});

test("a reply that quotes the campaign message is that campaign's", async () => {
  const fake = fakeDb((sql) => {
    if (/r\.message_id = \$2::text/.test(sql)) return { rows: [{ broadcast_id: 7, campaign_name: "Spring sale", chatbot_flow_id: null, recipient_id: 3 }] };
    return { rows: [] };
  });
  try {
    const found = await findCampaignForReply({ tenantId: 1, sessionId: "whatsapp:201001234567", phone: "201001234567", replyToMessageId: "wamid.ABC" });
    assert.equal(found.broadcast_id, 7);
    assert.equal(found.via, "quoted_reply");
  } finally {
    fake.restore();
  }
});

test("a plain reply counts only as the first message since a campaign in the last 72 hours", async () => {
  let wroteSince = false;
  const fake = fakeDb((sql, params) => {
    if (/r\.message_id = \$2::text/.test(sql)) return { rows: [] };
    if (/RIGHT\(regexp_replace\(r\.phone/.test(sql)) {
      assert.equal(params[1], "1001234567", "matched on the last 10 digits, like the consent service");
      assert.equal(params[2], 72);
      return { rows: [{ broadcast_id: 7, campaign_name: "Spring sale", recipient_id: 3 }] };
    }
    if (/FROM ai_support_messages/.test(sql)) {
      assert.equal(params[3], "wamid.IN1", "the message being handled is not its own 'earlier reply'");
      return { rows: wroteSince ? [{ "?column?": 1 }] : [] };
    }
    return { rows: [] };
  });
  try {
    const first = await findCampaignForReply({ tenantId: 1, sessionId: "whatsapp:201001234567", phone: "201001234567", currentMessageId: "wamid.IN1" });
    assert.equal(first.via, "reply");
    wroteSince = true;
    assert.equal(await findCampaignForReply({ tenantId: 1, sessionId: "whatsapp:201001234567", phone: "201001234567", currentMessageId: "wamid.IN1" }), null);
  } finally {
    fake.restore();
  }
});

test("a reply to a campaign without a flow is attributed and left to the usual chain", async () => {
  const fake = fakeDb((sql) => {
    if (/r\.message_id = \$2::text/.test(sql)) return { rows: [{ broadcast_id: 7, campaign_name: "Spring sale", chatbot_flow_id: null, recipient_id: 3 }] };
    if (/INSERT INTO inbox_conversation_attribution/.test(sql)) return { rows: [{ id: 1 }] };
    return { rows: [] };
  });
  try {
    const result = await handleCampaignReplyInbound({
      tenantId: 1,
      phoneNumberId: "555",
      message: { external_conversation_id: "whatsapp:201001234567", external_customer_id: "201001234567", reply_to_message_id: "wamid.ABC", external_message_id: "wamid.IN1" },
    });
    assert.equal(result.handled, false);
    const insert = fake.calls.find((call) => /INSERT INTO inbox_conversation_attribution/.test(call.sql));
    assert.ok(insert, "the reply is recorded as a touch");
    assert.match(insert.sql, /DO UPDATE SET/, "a reply is a real touch: it becomes the last touch");
    assert.equal(insert.params[1], "whatsapp:201001234567");
    assert.equal(insert.params[3], "whatsapp_campaign");
    const touch = JSON.parse(insert.params[9]);
    assert.equal(touch.broadcast_id, 7);
    assert.equal(touch.via, "quoted_reply");
    assert.equal(touch.utm_source, "whatsapp");
  } finally {
    fake.restore();
  }
});

test("a campaign SEND only opens the record; it never overwrites an ad the customer clicked", async () => {
  const fake = fakeDb(() => ({ rows: [] }));
  try {
    await recordConversationTouch({ tenantId: 1, sessionId: "whatsapp:201001234567", mode: "open", touch: { source_type: "whatsapp_campaign", campaign_name: "Spring sale", broadcast_id: 7, via: "send" } });
    const insert = fake.calls.find((call) => /INSERT INTO inbox_conversation_attribution/.test(call.sql));
    assert.match(insert.sql, /ON CONFLICT \(tenant_id, session_id\) DO NOTHING/);
  } finally {
    fake.restore();
  }
});

test("the card's data: GENI's Campaign Tracking + Meta Attribution + Ad Clicks", () => {
  const clicks = [
    { id: 2, clicked_at: "2026-10-20T10:00:00Z", channel: "whatsapp", ad_headline: "New Balance 530", source_url: "https://fb.me/ad2", ctwa_clid: "clid-2", attribution_status: "resolved", campaign_id: 11, campaign_name: "Autumn", adset_id: 12, adset_name: "Cairo 18-35", ad_id: 13, ad_name: "Video A" },
    { id: 1, clicked_at: "2026-10-18T10:00:00Z", channel: "whatsapp", ad_headline: "Old", attribution_status: "unknown_ad", post_id: "123_456" },
  ];
  // A chat whose clicks predate the attribution table still gets its card, from the clicks alone.
  const fromClicks = buildAttributionView({ row: null, clicks });
  assert.equal(fromClicks.source_type, "meta_ad");
  assert.equal(fromClicks.campaign_name, "Autumn");
  assert.deepEqual(fromClicks.tracking, {
    utm_source: "meta",
    utm_medium: "click_to_whatsapp",
    utm_campaign: "Autumn",
    ad_headline: "New Balance 530",
    ad_body: "",
    ad_source_url: "https://fb.me/ad2",
  });
  assert.equal(fromClicks.meta.adset, "Cairo 18-35");
  assert.equal(fromClicks.meta.clicks_count, 2);
  assert.equal(fromClicks.meta.first_click_at, "2026-10-18T10:00:00Z");
  assert.equal(fromClicks.meta.last_click_at, "2026-10-20T10:00:00Z");
  assert.equal(fromClicks.meta.ctwa_clid, "clid-2");
  assert.deepEqual(Object.keys(fromClicks.clicks[0]), ["id", "clicked_at", "channel", "headline", "campaign", "adset", "ad", "attribution_status", "view_url"]);
  assert.equal(fromClicks.clicks[1].view_url, "https://www.facebook.com/123_456", "no ad link: the boosted post");
  assert.equal(fromClicks.whatsapp_campaign, null);

  // Ad first, WhatsApp campaign last: the chip names the campaign, the Meta block keeps the ad.
  const adTouch = normalizeTouch({ source_type: "meta_ad", channel: "whatsapp", meta_campaign_name: "Autumn", meta_ad_name: "Video A", attribution_status: "resolved" });
  const campaignTouch = normalizeTouch({ source_type: "whatsapp_campaign", channel: "whatsapp", campaign_name: "Spring sale", broadcast_id: 7, via: "reply" });
  const mixed = buildAttributionView({ row: { first_touch: adTouch, last_touch: campaignTouch, ad_clicks_count: 1 }, clicks: [] });
  assert.equal(mixed.source_type, "whatsapp_campaign");
  assert.equal(mixed.campaign_name, "Spring sale");
  assert.equal(mixed.meta.campaign, "Autumn");
  assert.equal(mixed.whatsapp_campaign.id, 7);
  assert.equal(mixed.tracking.utm_medium, "template_campaign");

  assert.equal(buildAttributionView({ row: null, clicks: [] }), null, "no campaign: the card hides");
});

test("an order created from the chat inherits its campaign in the existing marketing columns", () => {
  const view = buildAttributionView({ row: { last_touch: normalizeTouch({ source_type: "meta_ad", channel: "instagram", meta_campaign_name: "Autumn", meta_ad_id: 13 }) }, clicks: [] });
  const fields = orderAttributionFromView(view, "instagram:998");
  assert.deepEqual(fields, {
    marketing_source: "meta_ads",
    marketing_platform: "instagram",
    marketing_campaign: "Autumn",
    marketing_post_id: "13",
    attribution_type: "conversation",
    marketing_session_id: "instagram:998",
  });
  const waView = buildAttributionView({ row: { last_touch: normalizeTouch({ source_type: "whatsapp_campaign", campaign_name: "Spring sale", broadcast_id: 7 }) }, clicks: [] });
  assert.equal(orderAttributionFromView(waView, "whatsapp:2010").marketing_platform, "whatsapp");
  // orders.marketing_post_id is BIGINT, so a campaign leaves it empty and is known by name.
  assert.equal(orderAttributionFromView(waView, "whatsapp:2010").marketing_post_id, null);
  assert.equal(orderAttributionFromView(null), null);

  const order = { tenant_id: 1, ai_agent_conversation_id: "instagram:998", marketing_source: "manual_link" };
  const merged = mergeOrderAttribution(order, fields);
  assert.equal(merged.marketing_source, "manual_link", "what the caller set wins");
  assert.equal(merged.marketing_campaign, "Autumn");
  assert.equal(mergeOrderAttribution(order, null), order);

  const service = read("server/services/aiAgentOrderService.js");
  assert.match(service, /Object\.entries\(await withConversationCampaign\(payload\.order\)\)/, "the one AI-order insert copies the attribution");
});

test("campaign AI instructions reach the agent as one block in the dynamic context", () => {
  const block = formatCampaignInstructions({
    meta: [{ level: "campaign", message: "Mention free delivery" }],
    campaign: { name: "Spring sale", instructions: "Code SPRING10 is 10% off" },
  });
  assert.match(block, /\(campaign\) Mention free delivery/);
  assert.match(block, /Spring sale.*Code SPRING10/);
  assert.equal(formatCampaignInstructions({}), "");
  const context = buildDynamicContext({ customerName: "Mona", campaignInstructions: block });
  assert.match(context, /<campaign_instructions>[\s\S]*Mention free delivery[\s\S]*<\/campaign_instructions>\n<\/dynamic_context>/);
  assert.doesNotMatch(buildDynamicContext({ customerName: "Mona" }), /campaign_instructions/);
});

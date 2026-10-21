// Automatic CRM stages, the way Genie ERP moves its leads: an ad click makes a
// lead ("new"), a product card makes it interested, an order draft puts it in
// negotiation and a confirmed order wins it. Forward only, never past won/lost,
// and never by itself starting a follow-up sequence (owner's call, 2026-10-21).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AUTO_STAGE_RANK, CONVERSATION_IS_LEAD_SQL } from "../server/modules/crmStages/autoStage.js";
import { conversationLeadStage, conversationMatchesPanelFilters, panelFilterParams } from "../src/modules/aiSupport/lib/inboxFilterPanel.js";
import { appendInboxPanelFilterClauses } from "../server/services/aiSalesAgentService.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const autoStage = read("server/modules/crmStages/autoStage.js");

test("the stage order is forward-only and lost is never an automatic step", () => {
  assert.deepEqual(Object.keys(AUTO_STAGE_RANK), ["new", "contacted", "interested", "negotiation", "won"]);
  assert.ok(!("lost" in AUTO_STAGE_RANK));
  // The UPDATE refuses won/lost rows (rank >= 4) and any move that is not forward,
  // except the first one that makes a plain chat a lead.
  assert.ok(autoStage.includes("AND ${RANK_SQL} < 4"));
  assert.ok(autoStage.includes("AND (${RANK_SQL} < $4::int OR NOT ${CONVERSATION_IS_LEAD_SQL})"));
  assert.match(autoStage, /WHEN 'lost' THEN 99/);
});

test("an automatic move never starts a follow-up sequence", () => {
  assert.doesNotMatch(autoStage, /onLeadStageChanged|setConversationLeadStage|messageSequences/);
});

test("each Genie step is wired to its stage", () => {
  const ads = read("server/modules/metaAds/integrations/adClicks.js");
  assert.match(ads, /advanceConversationLeadStageLater\(\{ tenantId, sessionId: key, stage: "new", source: "ad_click"/);
  const log = read("server/services/aiSupportLogService.js");
  assert.match(log, /const persistOutboundTranscriptRow = async \(args = \{\}\) => \{\s*const row = await persistOutboundTranscriptRowUnstaged\(args\);/);
  assert.match(log, /stage: "interested", source: "product_card"/);
  const orders = read("server/services/aiAgentOrderService.js");
  assert.equal(orders.split(`stage: "negotiation", source: "order_draft"`).length - 1, 2, "both draft writers");
  assert.match(orders, /stage: "won", source: "order_confirmed"/);
  const route = read("server/routes/aiAgentOrders.js");
  assert.match(route, /crm_lead: conversation\.channel_metadata\?\.crm_lead \|\| \{ source: "manual"/);
});

test("a stage belongs to leads only; 'none' is the plain chats", () => {
  const clauses = [];
  const params = [1, 50];
  appendInboxPanelFilterClauses({ clauses, params, channelSql: "chan", stages: "new,none" });
  assert.equal(clauses.length, 1);
  assert.ok(clauses[0].includes(`= ANY($3::text[]) AND ${CONVERSATION_IS_LEAD_SQL}`));
  assert.ok(clauses[0].includes(`OR NOT ${CONVERSATION_IS_LEAD_SQL}`));
  assert.deepEqual(params[2], ["new"]);
  assert.deepEqual(panelFilterParams({ stages: ["none"] }), { stage_ids: "none" });
});

test("the browser reads the same lead rule", () => {
  assert.equal(conversationLeadStage({ lead_status: "new" }), "");
  assert.equal(conversationLeadStage({ lead_status: "new", channel_metadata: { crm_lead: { source: "ad_click" } } }), "new");
  assert.equal(conversationLeadStage({ lead_status: "new", channel_metadata: { campaign_lead: { name: "x" } } }), "new");
  assert.equal(conversationLeadStage({ lead_status: "interested" }), "interested");
  assert.equal(conversationMatchesPanelFilters({ lead_status: "new" }, { stages: ["new"] }), false);
  assert.equal(conversationMatchesPanelFilters({ lead_status: "new" }, { stages: ["none"] }), true);
  assert.equal(conversationMatchesPanelFilters({ lead_status: "won" }, { stages: ["none"] }), false);
});

test("the system's stage-named labels leave the catalogue; hand-made tags stay", () => {
  const tags = read("server/services/inboxTagsService.js");
  assert.match(tags, /SET deleted_at = NOW\(\), updated_at = NOW\(\)\s*WHERE tenant_id = \$1 AND deleted_at IS NULL AND created_by_name = 'system'\s*AND key = ANY\(\$2::text\[\]\) AND lead_status = key/);
});

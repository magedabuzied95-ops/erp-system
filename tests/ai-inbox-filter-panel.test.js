// The Genie-style inbox filter panel: accounts, labels, stages, members and
// activity, applied by the list API in SQL (OR inside a tab, AND across tabs),
// plus the same rule in the browser for rows the socket adds later.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMPTY_PANEL_FILTERS,
  conversationMatchesPanelFilters,
  panelFilterCount,
  panelFilterParams,
} from "../src/modules/aiSupport/lib/inboxFilterPanel.js";
import {
  appendInboxPanelFilterClauses,
  inboxPanelActivityClauseSql,
} from "../server/services/aiSalesAgentService.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("nothing picked sends nothing", () => {
  assert.deepEqual(panelFilterParams(EMPTY_PANEL_FILTERS), {});
  assert.equal(panelFilterCount(EMPTY_PANEL_FILTERS), 0);
});

test("each tab becomes one comma-list parameter", () => {
  const params = panelFilterParams({
    accounts: ["whatsapp:m1_business_v237", "whatsapp:cloud:4410867005694052"],
    labels: ["vip"],
    stages: ["New", "won"],
    members: ["12", "none"],
    activity: "7d",
  });
  assert.deepEqual(params, {
    account_ids: "whatsapp:m1_business_v237,whatsapp:cloud:4410867005694052",
    label_ids: "vip",
    stage_ids: "new,won",
    member_ids: "12,none",
    activity: "7d",
  });
  assert.equal(panelFilterCount({ accounts: ["a", "b"], activity: "24h" }), 3);
});

test("a custom range sends its days, an empty one sends nothing", () => {
  assert.deepEqual(panelFilterParams({ activity: "custom", activityFrom: "2026-10-01", activityTo: "2026-10-21" }), {
    activity_from: "2026-10-01",
    activity_to: "2026-10-21",
  });
  assert.deepEqual(panelFilterParams({ activity: "custom" }), {});
  assert.equal(panelFilterCount({ activity: "custom" }), 0);
});

test("the server builds one clause per tab, with typed parameters", () => {
  const clauses = [];
  const params = [1, 50];
  appendInboxPanelFilterClauses({
    clauses,
    params,
    channelSql: "chan",
    accountKeys: "whatsapp:a,facebook_messenger:123",
    labelIds: "vip",
    stages: "new,won",
    memberIds: "7,none",
  });
  assert.equal(clauses.length, 4);
  assert.match(clauses[0], /= ANY\(\$4::text\[\]\)/);
  assert.match(clauses[0], /'whatsapp:' \|\| COALESCE\(NULLIF\(c\.metadata->>'whatsapp_instance', ''\)/);
  assert.deepEqual(params[3], ["whatsapp:a", "facebook_messenger:123"]);
  assert.match(clauses[1], /conversation_labels/);
  assert.match(clauses[1], /ANY\(\$5::text\[\]\)/);
  assert.match(clauses[2], /COALESCE\(NULLIF\(c\.lead_status, ''\), 'new'\)\) = ANY\(\$6::text\[\]\)/);
  // The owner or an added participant, or nobody.
  assert.ok(clauses[3].startsWith("((s.assigned_user_id = ANY($7::bigint[]) OR EXISTS ("));
  assert.ok(clauses[3].includes("c.metadata->'participants'"));
  assert.ok(clauses[3].endsWith(" OR s.assigned_user_id IS NULL)"));
  assert.deepEqual(params[6], [7]);
});

test("no picks add no clauses", () => {
  const clauses = [];
  const params = [1, 50];
  appendInboxPanelFilterClauses({ clauses, params, channelSql: "chan" });
  assert.deepEqual(clauses, []);
  assert.equal(params.length, 2);
});

test("activity: a preset window or a Cairo day range", () => {
  const params = [];
  assert.equal(inboxPanelActivityClauseSql({ params, activitySql: "act", activity: "24h" }), "act >= NOW() - $1::interval");
  assert.deepEqual(params, ["24 hours"]);
  const range = [];
  const sql = inboxPanelActivityClauseSql({ params: range, activitySql: "act", activityFrom: "2026-10-01", activityTo: "2026-10-02" });
  assert.match(sql, /act >= \(\$1::date::timestamp AT TIME ZONE 'Africa\/Cairo'\)/);
  assert.match(sql, /act < \(\(\$2::date \+ 1\)::timestamp AT TIME ZONE 'Africa\/Cairo'\)/);
  assert.equal(inboxPanelActivityClauseSql({ params: [], activitySql: "act", activityFrom: "not-a-day" }), "");
});

test("a socket row is held to the same rule", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const row = {
    channel: "whatsapp",
    lead_status: "won",
    assigned_user_id: 7,
    last_message_at: "2026-10-21T10:00:00Z",
    channel_metadata: { conversation_labels: [{ id: "vip", name: "VIP" }] },
  };
  const opts = { accountKey: "m1_business_v237", now };
  assert.equal(conversationMatchesPanelFilters(row, { accounts: ["whatsapp:m1_business_v237"] }, opts), true);
  assert.equal(conversationMatchesPanelFilters(row, { accounts: ["whatsapp:other"] }, opts), false);
  assert.equal(conversationMatchesPanelFilters(row, { labels: ["vip", "x"] }, opts), true);
  assert.equal(conversationMatchesPanelFilters(row, { labels: ["x"] }, opts), false);
  assert.equal(conversationMatchesPanelFilters(row, { stages: ["new"] }, opts), false);
  assert.equal(conversationMatchesPanelFilters(row, { members: ["7"] }, opts), true);
  assert.equal(conversationMatchesPanelFilters(row, { members: ["none"] }, opts), false);
  assert.equal(conversationMatchesPanelFilters({ ...row, assigned_user_id: null }, { members: ["none"] }, opts), true);
  assert.equal(conversationMatchesPanelFilters(row, { activity: "24h" }, opts), true);
  assert.equal(conversationMatchesPanelFilters({ ...row, last_message_at: "2026-10-10T10:00:00Z" }, { activity: "7d" }, opts), false);
  // A thread whose line the browser cannot tell stays until the next fetch decides.
  assert.equal(conversationMatchesPanelFilters(row, { accounts: ["whatsapp:other"] }, { now }), true);
  // Tabs combine with AND.
  assert.equal(conversationMatchesPanelFilters(row, { labels: ["vip"], stages: ["new"] }, opts), false);
});

test("the list route passes every tab to the SQL loader", () => {
  const route = read("server/routes/aiAgentOrders.js");
  for (const [param, field] of [
    ["account_ids", "accountKeys"],
    ["label_ids", "labelIds"],
    ["stage_ids", "stages"],
    ["member_ids", "memberIds"],
    ["activity", "activity"],
    ["activity_from", "activityFrom"],
    ["activity_to", "activityTo"],
  ]) {
    assert.ok(route.includes(`${field}: String(req.query?.${param} || "")`), `${param} -> ${field}`);
  }
  assert.match(route, /router\.get\("\/filter-accounts", protect, inboxView\(\)/);
  const service = read("server/services/aiSalesAgentService.js");
  assert.ok(service.includes("appendInboxPanelFilterClauses({ clauses, params, channelSql: INBOX_RESOLVED_CHANNEL_SQL, accountKeys, labelIds, stages, memberIds });"));
  assert.ok(service.includes("const activityClause = inboxPanelActivityClauseSql({ params, activitySql: summaryActivitySql, activity, activityFrom, activityTo });"));
});

test("the desktop inbox sends the panel and keeps filtered pages out of the cache", () => {
  const page = read("src/modules/aiSupport/pages/AiInbox.jsx");
  assert.equal(page.split("...panelParams,").length - 1, 3, "first page, next pages, and the view counts");
  assert.ok(page.includes(`const listCacheEnabled = !reviewerMode && readFilter === "all" && assignedFilter === "all" && favoriteFilter === "all" && !panelActive && listView === "all";`));
  assert.ok(page.includes("<InboxFilterPanel"));
  assert.ok(page.includes("<ConversationCrmCard"));
});

test("every panel string exists in both locales", () => {
  const keys = ["title", "tabs.accounts", "tabs.labels", "tabs.stages", "tabs.members", "tabs.activity", "tabs.saved", "search.accounts", "unassigned", "customRange", "saveCurrent", "noSaved", "filtersCount_other", "noStage"];
  const crmKeys = ["title", "stage", "labels", "owner", "assign", "reassign", "stageError", "notLead"];
  for (const locale of ["ar", "en"]) {
    const inbox = JSON.parse(read(`src/locales/${locale}/aiSupport.json`)).inbox;
    for (const key of keys) {
      const value = key.split(".").reduce((node, part) => node?.[part], inbox.filterPanel);
      assert.ok(typeof value === "string" && value.trim(), `${locale} filterPanel.${key}`);
    }
    for (const key of crmKeys) assert.ok(inbox.crmCard?.[key], `${locale} crmCard.${key}`);
  }
});

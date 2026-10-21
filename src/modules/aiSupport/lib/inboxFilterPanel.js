/*
 * The inbox filter panel (Genie ERP's): Accounts, Labels, Stages, Members and
 * Activity, plus saved combinations. The list API applies them in SQL — the
 * list is only ever the newest N rows, so filtering in the browser would only
 * ever search those. Tabs combine with AND, the picks inside one tab with OR.
 *
 * This module is the shape of the value, the query parameters it becomes, and
 * the same rule in JS for rows that arrive over the socket after the filtered
 * page was fetched.
 */

export const EMPTY_PANEL_FILTERS = Object.freeze({
  accounts: [],
  labels: [],
  stages: [],
  members: [],
  activity: "",
  activityFrom: "",
  activityTo: "",
});

export const PANEL_ACTIVITY_PRESETS = Object.freeze(["24h", "3d", "7d"]);
const ACTIVITY_WINDOW_MS = { "24h": 24 * 3600_000, "3d": 3 * 24 * 3600_000, "7d": 7 * 24 * 3600_000 };

// "Unassigned" in the Members tab.
export const PANEL_UNASSIGNED_MEMBER = "none";
// "No stage" in the Stages tab: a conversation that is not a lead.
export const PANEL_NO_STAGE = "none";

/*
 * The conversation's CRM stage, or "" when it is not a lead (Genie: an ordinary
 * chat has no stage). Same rule as CONVERSATION_IS_LEAD_SQL on the server: a lead
 * marker (ad, campaign, a hand-picked or automatic stage) or any stage but the
 * default "new".
 */
export const conversationLeadStage = (conversation = {}) => {
  const metadata = conversation.channel_metadata || conversation.metadata || {};
  const stage = clean(conversation.lead_status || metadata.lead_status || "new").toLowerCase() || "new";
  const isLead = Boolean(metadata.crm_lead || metadata.campaign_lead) || stage !== "new";
  return isLead ? stage : "";
};

const clean = (value) => String(value ?? "").trim();
const list = (value) => [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))];

export const normalizePanelFilters = (value = {}) => {
  const activity = clean(value?.activity);
  const isDay = (day) => /^\d{4}-\d{2}-\d{2}$/.test(clean(day));
  const custom = activity === "custom";
  return {
    accounts: list(value?.accounts),
    labels: list(value?.labels),
    stages: list(value?.stages).map((stage) => stage.toLowerCase()),
    members: list(value?.members),
    activity: PANEL_ACTIVITY_PRESETS.includes(activity) || custom ? activity : "",
    activityFrom: custom && isDay(value?.activityFrom) ? clean(value.activityFrom) : "",
    activityTo: custom && isDay(value?.activityTo) ? clean(value.activityTo) : "",
  };
};

// How many picks each tab holds — the badges on the tabs and on the button.
export const panelFilterTabCounts = (value = {}) => {
  const filters = normalizePanelFilters(value);
  return {
    accounts: filters.accounts.length,
    labels: filters.labels.length,
    stages: filters.stages.length,
    members: filters.members.length,
    activity: filters.activity && (filters.activity !== "custom" || filters.activityFrom || filters.activityTo) ? 1 : 0,
  };
};

export const panelFilterCount = (value = {}) =>
  Object.values(panelFilterTabCounts(value)).reduce((sum, count) => sum + count, 0);

// The list API's query parameters; {} when nothing is picked.
export const panelFilterParams = (value = {}) => {
  const filters = normalizePanelFilters(value);
  const params = {};
  if (filters.accounts.length) params.account_ids = filters.accounts.join(",");
  if (filters.labels.length) params.label_ids = filters.labels.join(",");
  if (filters.stages.length) params.stage_ids = filters.stages.join(",");
  if (filters.members.length) params.member_ids = filters.members.join(",");
  if (PANEL_ACTIVITY_PRESETS.includes(filters.activity)) params.activity = filters.activity;
  if (filters.activity === "custom") {
    if (filters.activityFrom) params.activity_from = filters.activityFrom;
    if (filters.activityTo) params.activity_to = filters.activityTo;
  }
  return params;
};

// A stable string for effect dependencies and cache gates.
export const panelFilterSignature = (value = {}) => JSON.stringify(panelFilterParams(value));

// The account key the server matches: "<platform>:<id>".
export const conversationPanelAccountKey = (conversation = {}, accountKey = "") => {
  const channel = clean(conversation.channel || conversation.source).toLowerCase();
  const key = clean(accountKey);
  if (!key) return "";
  if (channel.includes("whatsapp")) return `whatsapp:${key}`;
  if (channel.includes("instagram")) return `instagram:${key}`;
  if (channel.includes("facebook") || channel.includes("messenger")) return `facebook_messenger:${key}`;
  return "";
};

const cairoDay = (date) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
};

/*
 * The server rule in JS, for a conversation the socket brings in after the
 * filtered page arrived. Unknowns pass rather than vanish: a thread whose line
 * the client cannot tell (an old WhatsApp row the server files under the default
 * line) stays visible until the next fetch decides it.
 */
export const conversationMatchesPanelFilters = (conversation = {}, value = {}, { accountKey = "", activityAt = "", now = Date.now() } = {}) => {
  const filters = normalizePanelFilters(value);
  const metadata = conversation.channel_metadata || conversation.metadata || {};
  if (filters.accounts.length) {
    const key = conversationPanelAccountKey(conversation, accountKey);
    if (key && !filters.accounts.includes(key)) return false;
  }
  if (filters.labels.length) {
    const labels = Array.isArray(metadata.conversation_labels) ? metadata.conversation_labels : [];
    if (!labels.some((label) => filters.labels.includes(clean(label?.id)))) return false;
  }
  if (filters.stages.length) {
    const stage = conversationLeadStage(conversation);
    if (!filters.stages.includes(stage || PANEL_NO_STAGE)) return false;
  }
  if (filters.members.length) {
    const assigned = clean(conversation.assigned_user_id ?? conversation.assigned_user?.id ?? "");
    const ok = assigned ? filters.members.includes(assigned) : filters.members.includes(PANEL_UNASSIGNED_MEMBER);
    if (!ok) return false;
  }
  if (filters.activity) {
    const at = new Date(activityAt || conversation.last_message_at || conversation.last_activity_at || conversation.updated_at || 0);
    if (Number.isNaN(at.getTime()) || at.getTime() <= 0) return false;
    if (ACTIVITY_WINDOW_MS[filters.activity] && now - at.getTime() > ACTIVITY_WINDOW_MS[filters.activity]) return false;
    if (filters.activity === "custom") {
      const day = cairoDay(at);
      if (filters.activityFrom && day < filters.activityFrom) return false;
      if (filters.activityTo && day > filters.activityTo) return false;
    }
  }
  return true;
};

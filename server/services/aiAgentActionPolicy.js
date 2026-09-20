// What the agent is allowed to DO, as opposed to what it is allowed to say.
//
// This is a view over gates that already exist, not a second set of switches beside them. Three of the
// actions below map onto flags the agent has always read (`allow_auto_draft_creation`,
// `followups_enabled`, `suggested_replies_enabled`, and the inverted `require_human_approval_before_confirm`);
// turning the switch here writes that same flag, so there is exactly one answer to "can it do this".
// The two that had no flag at all — the address link and the product carousel — get one here, stored under
// `action_policies`, and are enforced at their real call sites.
//
// `guidance` is the free-text "when should it do this" that rides into the agent's instructions.
// It shapes when an enabled action fires; it can never enable a disabled one.
//
// Risk levels mirror aiWorkflowToolRegistry: a SENSITIVE action is never executed automatically no matter
// what the switch says — the most an enabled switch can do is prepare it for a human to approve.

import db from "../database/db.js";

const bool = (value, fallback = false) => (typeof value === "boolean" ? value : fallback);
const text = (value) => String(value ?? "").trim();

export const AGENT_ACTION_RISK = Object.freeze({ READ: "READ", WRITE: "WRITE", SENSITIVE: "SENSITIVE" });

// `settingKey` — the pre-existing flag this switch is a view over.
// `invert`     — the stored flag means the opposite of "enabled" (an approval requirement, not a permission).
// `locked`     — the switch is shown but cannot be turned off, with the reason rendered beside it.
export const AGENT_ACTIONS = Object.freeze([
  {
    id: "send_product_card",
    risk: AGENT_ACTION_RISK.READ,
    settingKey: null,
    defaultEnabled: true,
    enforcedAt: "aiSupportContextService / visual search colour carousel",
  },
  {
    id: "suggested_replies",
    risk: AGENT_ACTION_RISK.READ,
    settingKey: "suggested_replies_enabled",
    defaultEnabled: true,
    enforcedAt: "inbox suggestion builder",
  },
  {
    id: "request_address",
    risk: AGENT_ACTION_RISK.WRITE,
    settingKey: null,
    defaultEnabled: true,
    enforcedAt: "metaIntegrationService.buildSocialCommentAddressLink / whatsappSalesFlowService.sendAddressLink",
  },
  {
    id: "create_draft_order",
    risk: AGENT_ACTION_RISK.WRITE,
    settingKey: "allow_auto_draft_creation",
    defaultEnabled: true,
    enforcedAt: "aiAgentOrderService draft creation",
  },
  {
    id: "followups",
    risk: AGENT_ACTION_RISK.WRITE,
    settingKey: "followups_enabled",
    defaultEnabled: true,
    enforcedAt: "scheduleAiFollowupIfNeeded",
  },
  {
    id: "confirm_order",
    risk: AGENT_ACTION_RISK.SENSITIVE,
    settingKey: "require_human_approval_before_confirm",
    invert: true,
    defaultEnabled: false,
    enforcedAt: "confirmAiOrder",
  },
  {
    id: "handoff_to_human",
    risk: AGENT_ACTION_RISK.WRITE,
    settingKey: null,
    defaultEnabled: true,
    locked: true,
    lockReason: "escalation_always_available",
    enforcedAt: "aiEscalationDetector / handoff_rules",
  },
]);

const ACTION_BY_ID = new Map(AGENT_ACTIONS.map((action) => [action.id, action]));

export const agentActionDefinition = (actionId) => ACTION_BY_ID.get(text(actionId)) || null;

const storedPolicies = (settings = {}) => {
  const value = settings?.action_policies;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};

export const isAgentActionEnabled = (settings = {}, actionId = "") => {
  const definition = agentActionDefinition(actionId);
  if (!definition) return false;
  if (definition.locked) return true;
  if (definition.settingKey) {
    const raw = settings?.[definition.settingKey];
    const resolved = bool(raw, definition.invert ? !definition.defaultEnabled : definition.defaultEnabled);
    return definition.invert ? !resolved : resolved;
  }
  const policy = storedPolicies(settings)[definition.id];
  return bool(policy?.enabled, definition.defaultEnabled);
};

export const agentActionGuidance = (settings = {}, actionId = "") =>
  text(storedPolicies(settings)[text(actionId)]?.guidance);

export const resolveAgentActions = (settings = {}) =>
  AGENT_ACTIONS.map((definition) => ({
    id: definition.id,
    risk: definition.risk,
    locked: Boolean(definition.locked),
    lock_reason: definition.lockReason || "",
    // A SENSITIVE action can be switched on, but "on" only ever means "prepare it for approval".
    never_automatic: definition.risk === AGENT_ACTION_RISK.SENSITIVE,
    setting_key: definition.settingKey || "",
    enabled: isAgentActionEnabled(settings, definition.id),
    guidance: agentActionGuidance(settings, definition.id),
  }));

// Folds a UI patch back onto the settings object, writing each switch to whichever store owns it.
export const applyAgentActionUpdates = (settings = {}, updates = {}) => {
  const next = { ...(settings || {}) };
  const policies = { ...storedPolicies(settings) };
  Object.entries(updates || {}).forEach(([actionId, patch]) => {
    const definition = agentActionDefinition(actionId);
    if (!definition || !patch || typeof patch !== "object") return;
    const current = policies[definition.id] || {};
    const entry = { ...current };
    if (patch.guidance !== undefined) entry.guidance = text(patch.guidance).slice(0, 2000);
    if (patch.enabled !== undefined && !definition.locked) {
      const enabled = patch.enabled === true;
      if (definition.settingKey) next[definition.settingKey] = definition.invert ? !enabled : enabled;
      else entry.enabled = enabled;
    }
    policies[definition.id] = entry;
  });
  next.action_policies = policies;
  return next;
};

// The lines that reach the model. Only enabled actions contribute, and only when the owner wrote
// something — an empty box must not spend tokens or invent a rule.
export const agentActionGuidanceLines = (settings = {}) =>
  AGENT_ACTIONS.filter((definition) => isAgentActionEnabled(settings, definition.id))
    .map((definition) => {
      const guidance = agentActionGuidance(settings, definition.id);
      return guidance ? `- ${definition.id}: ${guidance}` : "";
    })
    .filter(Boolean);

// Call sites deep in a channel flow have a tenantId and a message to answer, not a settings object.
// They ask here. A short TTL keeps this off the per-message hot path without making a switch feel dead:
// flipping one takes effect within half a minute, which is the same order as the owner's own reload.
const SETTINGS_TTL_MS = 30_000;
const settingsCache = new Map();

const readAgentSettingsRow = async (tenantId) => {
  const key = Number(tenantId) || 0;
  if (!key) return {};
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.settings;
  try {
    const result = await db.query(`SELECT settings FROM ai_agent_settings WHERE tenant_id = $1 LIMIT 1`, [key]);
    const raw = result.rows[0]?.settings;
    const settings = !raw ? {} : typeof raw === "string" ? JSON.parse(raw) : raw;
    settingsCache.set(key, { settings, at: Date.now() });
    return settings;
  } catch (error) {
    // An unreachable DB must never silently disable an action mid-conversation — fail OPEN to the
    // defaults, which is what the agent did before these switches existed.
    console.warn("[ai-action-policy] settings read failed; using defaults", {
      tenant_id: key,
      message: error?.message || String(error),
    });
    return {};
  }
};

/**
 * The tenant's agent settings, cached.
 *
 * Exported for the few call sites that need one flag and must not pull in aiSalesAgentService — a
 * 370KB module — to read it. This file imports only `db`, so it cannot create an import cycle.
 */
export const readAgentSettings = async ({ tenantId } = {}) => readAgentSettingsRow(tenantId);

export const agentActionAllowed = async ({ tenantId, actionId } = {}) => {
  const definition = agentActionDefinition(actionId);
  if (!definition) return false;
  if (definition.locked) return true;
  const settings = await readAgentSettingsRow(tenantId);
  return isAgentActionEnabled(settings, actionId);
};

export const __resetAgentActionPolicyCache = () => settingsCache.clear();

export default resolveAgentActions;

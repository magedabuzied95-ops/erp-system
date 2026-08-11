// AI Workflow Trigger Registry
// ---------------------------------------------------------------------------
// Central, EXPLICIT allowlist of triggers that may create workflow runs — the
// event-side counterpart to the Tool Registry. Nothing is auto-exposed: every
// executable trigger is registered here with metadata + a declarative config schema
// + a matcher. The frontend consumes this dynamically; it is the single source of
// truth for which triggers exist and whether they are available.
//
// Availability is decided SERVER-SIDE (env capability), never trusted from the browser.

export const TRIGGER_CATEGORY = Object.freeze({ MANUAL: "MANUAL", ERP_EVENT: "ERP_EVENT", SCHEDULE: "SCHEDULE", CHANNEL: "CHANNEL" });

const automationEnabled = () => String(process.env.AI_WORKFLOWS_AUTOMATION_ENABLED || "").toLowerCase() === "true";
// Phase 10 inbound intake capability (default OFF). Gates the channel.message_received trigger.
const inboundWorkflowsEnabled = () => String(process.env.AI_INBOUND_WORKFLOWS_ENABLED || "").toLowerCase() === "true";

// A matcher decides whether a given event matches a workflow's trigger-node config.
// It is PURE and server-side only. `config` is the trigger node's config; `event` is
// the sanitized envelope's data. Returns boolean.
const matchAlways = () => true;

const TRIGGERS = [
  {
    id: "manual",
    name: "Manual",
    description: "Run on demand from the builder or the Workflows list.",
    category: TRIGGER_CATEGORY.MANUAL,
    riskLevel: "READ",
    eventSource: "user",
    supportsIdempotency: true,
    // Manual is always available; automatic automation flags do not gate manual runs.
    isAvailable: () => true,
    configSchema: {},
    match: matchAlways,
  },
  {
    id: "followup.due",
    name: "Follow-up Due",
    description: "Fires when a customer follow-up becomes due (observed read-only; never sends or changes the follow-up).",
    category: TRIGGER_CATEGORY.ERP_EVENT,
    riskLevel: "READ",
    eventSource: "erp:ai_followup_tasks",
    supportsIdempotency: true,
    isAvailable: automationEnabled,
    configSchema: {
      followupType: { type: "string", required: false, label: "Follow-up type", description: "Any type, or a specific one (e.g. viewed_product_without_purchase)." },
    },
    // Match if no type filter, or the event's followup type equals the configured one.
    match: (config, event) => !config?.followupType || String(config.followupType) === String(event?.followupType || event?.triggerType || ""),
  },
  {
    id: "inventory.restocked",
    name: "Inventory Restocked",
    description: "Fires after stock crosses from 0 (or below) back to positive for a product/variant.",
    category: TRIGGER_CATEGORY.ERP_EVENT,
    riskLevel: "READ",
    eventSource: "erp:inventory_movements",
    supportsIdempotency: true,
    isAvailable: automationEnabled,
    configSchema: {
      productId: { type: "number", required: false, label: "Product", description: "Any product, or a specific product id." },
      variantId: { type: "number", required: false, label: "Variant", description: "Any variant, or a specific variant id." },
    },
    match: (config, event) => {
      if (config?.productId && Number(config.productId) !== Number(event?.productId)) return false;
      if (config?.variantId && Number(config.variantId) !== Number(event?.variantId)) return false;
      return true;
    },
  },
  {
    id: "schedule.interval",
    name: "Scheduled",
    description: "Runs on a bounded schedule (hourly, or daily at a set time).",
    category: TRIGGER_CATEGORY.SCHEDULE,
    riskLevel: "READ",
    eventSource: "scheduler",
    supportsIdempotency: true,
    isAvailable: automationEnabled,
    configSchema: {
      frequency: { type: "enum", required: true, values: ["hourly", "daily"], label: "Frequency" },
      time: { type: "string", required: false, label: "Time (daily only)", description: "HH:MM 24h, used when frequency is daily." },
    },
    // The scheduler only emits for the due slot of each workflow, so slot matching is inherent.
    match: matchAlways,
  },
  {
    id: "channel.message_received",
    name: "Channel Message Received",
    description: "Fires on an inbound TEXT customer message (WhatsApp/Messenger/Instagram) to produce a grounded reply SUGGESTION for human approval. Never sends autonomously.",
    category: TRIGGER_CATEGORY.CHANNEL,
    riskLevel: "SENSITIVE",
    eventSource: "channel",
    supportsIdempotency: true,
    // Phase 10: available only when the inbound-intake capability is enabled (default OFF).
    isAvailable: inboundWorkflowsEnabled,
    configSchema: {
      channel: { type: "enum", values: ["any", "whatsapp", "facebook_messenger", "instagram"], default: "any" },
      messageType: { type: "enum", values: ["text"], default: "text" },
    },
    // Match a persisted inbound TEXT event for the configured channel. text-only in this phase.
    match: (config = {}, event = {}) => {
      if (String(event.messageType || "text") !== "text") return false;
      const want = String(config.channel || "any");
      return want === "any" || want === String(event.channel || "");
    },
  },
];

const BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

export const listTriggers = () =>
  TRIGGERS.map((t) => ({
    id: t.id, name: t.name, description: t.description, category: t.category,
    riskLevel: t.riskLevel, eventSource: t.eventSource, supportsIdempotency: t.supportsIdempotency,
    configSchema: t.configSchema, available: Boolean(t.isAvailable()),
  }));

export const getTrigger = (id) => BY_ID.get(String(id || "")) || null;
export const isKnownTrigger = (id) => BY_ID.has(String(id || ""));
// Whether a workflow may be SAVED with this trigger. Authoring is decoupled from the
// automation kill switches (you can build an automation workflow before enabling it); only
// CHANNEL triggers are never authorable (prepared contract, no emitter exists).
// CHANNEL triggers become authorable once their inbound capability is enabled (Phase 10); other
// categories are always authorable (authoring is decoupled from the automation kill switches).
export const isAuthorableTrigger = (id) => { const t = getTrigger(id); return Boolean(t && (t.category !== TRIGGER_CATEGORY.CHANNEL || t.isAvailable())); };
export const isTriggerAvailable = (id) => { const t = getTrigger(id); return Boolean(t && t.isAvailable()); };
export const isGlobalAutomationEnabled = automationEnabled;

// Does a workflow's trigger-node config match this event's data? (server-side only)
export const triggerMatchesEvent = (triggerId, config, eventData) => {
  const t = getTrigger(triggerId);
  if (!t) return false;
  try { return Boolean(t.match(config || {}, eventData || {})); } catch { return false; }
};

// Pure (framework-free) mapping between the server's declarative workflow definition
// JSON and the visual canvas graph. No React / no @xyflow imports here so this module is
// unit-testable with node:test and reused by the editor.
//
// SOURCE OF TRUTH: the backend. This module never invents executable semantics — it mirrors
// server/services/aiWorkflowSchema.js (validateWorkflowDefinition) and the executor. The
// server validator + Tool Registry remain authoritative; everything here is UX convenience.

// ---- Node types (mirror NODE_TYPES in aiWorkflowSchema.js) ----
export const NODE_TYPES = ["trigger", "condition", "tool", "agent", "approval", "action", "end"];

// ---- Condition operators (mirror CONDITION_OPS in aiWorkflowSchema.js) ----
// `id` is SERIALIZED into condition.op and drives CONDITION_OP_IDS — never localize it.
// `label` stays as the raw English fallback; `labelKey` is resolved by the UI layer.
export const CONDITION_OPS = [
  { id: "eq", label: "equals", labelKey: "aiStudio.workflow.ops.eq", needsValue: true },
  { id: "neq", label: "not equals", labelKey: "aiStudio.workflow.ops.neq", needsValue: true },
  { id: "gt", label: "greater than", labelKey: "aiStudio.workflow.ops.gt", needsValue: true },
  { id: "lt", label: "less than", labelKey: "aiStudio.workflow.ops.lt", needsValue: true },
  { id: "gte", label: "greater or equal", labelKey: "aiStudio.workflow.ops.gte", needsValue: true },
  { id: "lte", label: "less or equal", labelKey: "aiStudio.workflow.ops.lte", needsValue: true },
  { id: "contains", label: "contains", labelKey: "aiStudio.workflow.ops.contains", needsValue: true },
  { id: "exists", label: "exists", labelKey: "aiStudio.workflow.ops.exists", needsValue: false },
  { id: "not_exists", label: "does not exist", labelKey: "aiStudio.workflow.ops.not_exists", needsValue: false },
  { id: "truthy", label: "is truthy", labelKey: "aiStudio.workflow.ops.truthy", needsValue: false },
  { id: "falsy", label: "is falsy", labelKey: "aiStudio.workflow.ops.falsy", needsValue: false },
];
export const CONDITION_OP_IDS = CONDITION_OPS.map((o) => o.id);

// Fallback capabilities if the /tools endpoint is unavailable (kept conservative).
export const DEFAULT_AGENT_MODES = [
  { id: "read_only_analysis", label: "Read-only analysis", labelKey: "aiStudio.workflow.agentModes.read_only_analysis", available: true },
  { id: "llm_grounded", label: "LLM grounded", labelKey: "aiStudio.workflow.agentModes.llm_grounded", available: false },
];
export const DEFAULT_TRIGGER_TYPES = [{ id: "manual", label: "Manual", labelKey: "aiStudio.workflow.triggerTypes.manual", available: true }];

// ---- Per-type metadata for the canvas / palette (icon resolved in the component) ----
// icon / accent / group / hasTool / branches are INTERNAL. `label` is the raw
// fallback; `labelKey` is resolved by the UI layer.
export const NODE_META = {
  trigger: { label: "Trigger", labelKey: "aiStudio.workflow.nodes.trigger", icon: "Zap", accent: "cyan", group: "TRIGGERS", hasTool: false },
  agent: { label: "Agent", labelKey: "aiStudio.workflow.nodes.agent", icon: "Bot", accent: "violet", group: "AGENTS", hasTool: false },
  condition: { label: "Condition", labelKey: "aiStudio.workflow.nodes.condition", icon: "GitBranch", accent: "amber", group: "LOGIC", hasTool: false, branches: true },
  tool: { label: "Tool", labelKey: "aiStudio.workflow.nodes.tool", icon: "Wrench", accent: "sky", group: "TOOLS", hasTool: true },
  action: { label: "Action", labelKey: "aiStudio.workflow.nodes.action", icon: "Bolt", accent: "orange", group: "ACTIONS", hasTool: true },
  approval: { label: "Approval", labelKey: "aiStudio.workflow.nodes.approval", icon: "ShieldCheck", accent: "rose", group: "APPROVAL", hasTool: false },
  end: { label: "End", labelKey: "aiStudio.workflow.nodes.end", icon: "Flag", accent: "slate", group: "LOGIC", hasTool: false },
};

export const RISK_META = {
  READ: { label: "READ", tone: "emerald", icon: "Eye", note: "Safe read-only. May auto-run." },
  WRITE: { label: "WRITE", tone: "amber", icon: "Pencil", note: "Non-destructive write. Approval by default." },
  SENSITIVE: { label: "SENSITIVE", tone: "rose", icon: "ShieldAlert", note: "Human approval required. Never auto-runs." },
};

// A canvas node ordering in the palette LOGIC group.
const LAYOUT_X = 260;
const LAYOUT_Y = 130;
const ORIGIN_X = 60;
const ORIGIN_Y = 60;

let _seq = 0;
// Unique-enough client id for a new node (app code — Date/Math are allowed here).
export const newNodeId = (type) => {
  _seq += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${type}_${Date.now().toString(36)}${_seq}${rand}`;
};

// ---- Default config for a freshly dropped node ----
export const defaultConfigFor = (type, { toolId } = {}) => {
  switch (type) {
    case "trigger": return { triggerType: "manual" };
    case "agent": return { mode: "read_only_analysis" };
    case "condition": return { condition: { left: "", op: "exists", right: "" } };
    case "tool":
    case "action": return { tool: toolId || "", input: {} };
    case "approval": return { label: "Human approval" };
    case "end": return {};
    default: return {};
  }
};

// ---- Palette built dynamically from the REAL server Tool Registry + capabilities ----
// READ tools -> `tool` nodes (TOOLS group). WRITE/SENSITIVE executable tools -> `action`
// nodes (ACTIONS group). Described-only tools (executable:false) are surfaced but DISABLED
// so an invalid executable configuration can never be serialized.
export const buildPalette = (registry = {}, capabilities = {}) => {
  const tools = Array.isArray(registry.tools) ? registry.tools : [];
  const triggerTypes = Array.isArray(capabilities.triggerTypes) ? capabilities.triggerTypes : DEFAULT_TRIGGER_TYPES;

  const triggerItems = triggerTypes.map((t) => ({
    kind: "trigger",
    nodeType: "trigger",
    label: `${t.label} trigger`,
    description: t.description || "",
    disabled: !t.available,
    disabledReason: t.available ? "" : "Coming later — not wired in this phase.",
    config: { triggerType: t.id },
  }));

  const toolItem = (t) => ({
    kind: "tool",
    nodeType: t.riskLevel === "READ" ? "tool" : "action",
    toolId: t.id,
    label: t.name || t.id,
    description: t.description || "",
    riskLevel: t.riskLevel,
    requiredPermission: t.requiredPermission || "",
    executable: t.executable !== false,
    requiresApproval: t.riskLevel === "SENSITIVE" ? true : Boolean(t.requiresApproval),
    disabled: t.executable === false,
    disabledReason: t.executable === false ? "Described-only in this phase — cannot be added as an executable node." : "",
    disabledReasonKey: t.executable === false ? "aiStudio.workflow.palette.disabledReason" : "",
  });

  return [
    // `group` is the STABLE raw id: NodePalette uses it as the React key and to
    // build item keys. Display comes from groupLabelKey, never from `group`.
    { group: "TRIGGERS", groupLabelKey: "aiStudio.workflow.palette.groups.TRIGGERS", items: triggerItems },
    { group: "AGENTS", groupLabelKey: "aiStudio.workflow.palette.groups.AGENTS", items: [{ kind: "agent", nodeType: "agent", label: "Agent", labelKey: "aiStudio.workflow.palette.items.agent.label", description: "Reuse the existing AI (read-only summary by default).", descriptionKey: "aiStudio.workflow.palette.items.agent.description" }] },
    {
      group: "LOGIC",
      groupLabelKey: "aiStudio.workflow.palette.groups.LOGIC",
      items: [
        { kind: "condition", nodeType: "condition", label: "Condition", labelKey: "aiStudio.workflow.palette.items.condition.label", description: "Branch on a value from earlier steps (true/false).", descriptionKey: "aiStudio.workflow.palette.items.condition.description" },
        { kind: "end", nodeType: "end", label: "End", labelKey: "aiStudio.workflow.palette.items.end.label", description: "Terminate this path.", descriptionKey: "aiStudio.workflow.palette.items.end.description" },
      ],
    },
    { group: "TOOLS", groupLabelKey: "aiStudio.workflow.palette.groups.TOOLS", subtitle: "READ — safe, may auto-run", subtitleKey: "aiStudio.workflow.palette.subtitles.TOOLS", items: tools.filter((t) => t.riskLevel === "READ").map(toolItem) },
    {
      group: "ACTIONS",
      groupLabelKey: "aiStudio.workflow.palette.groups.ACTIONS",
      subtitle: "WRITE / SENSITIVE — side effects", subtitleKey: "aiStudio.workflow.palette.subtitles.ACTIONS",
      items: [
        ...tools.filter((t) => t.riskLevel === "WRITE").map(toolItem),
        ...tools.filter((t) => t.riskLevel === "SENSITIVE").map(toolItem),
      ],
    },
    { group: "APPROVAL", groupLabelKey: "aiStudio.workflow.palette.groups.APPROVAL", items: [{ kind: "approval", nodeType: "approval", label: "Approval gate", labelKey: "aiStudio.workflow.palette.items.approval.label", description: "Explicit human approval before continuing.", descriptionKey: "aiStudio.workflow.palette.items.approval.description" }] },
  ];
};

// ---- Stable edge id ----
export const edgeId = (from, to, when) => `e:${from}->${to}${when ? `:${when}` : ""}`;

// ---- Layered auto-layout (pure). Used when definition nodes lack positions. ----
export const autoLayout = (nodes = [], edges = []) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    adj.get(e.from).push(e.to);
    incoming.set(e.to, (incoming.get(e.to) || 0) + 1);
  }
  const level = new Map();
  // roots: triggers first, else nodes with no incoming edges, else first node.
  const roots = nodes.filter((n) => n.type === "trigger").map((n) => n.id);
  const fallbackRoots = nodes.filter((n) => (incoming.get(n.id) || 0) === 0).map((n) => n.id);
  const starts = roots.length ? roots : fallbackRoots.length ? fallbackRoots : nodes.length ? [nodes[0].id] : [];
  const queue = [];
  for (const id of starts) { level.set(id, 0); queue.push(id); }
  let guard = 0;
  while (queue.length && guard < 10000) {
    guard += 1;
    const id = queue.shift();
    const lv = level.get(id) || 0;
    for (const next of adj.get(id) || []) {
      const cand = lv + 1;
      if (!level.has(next) || cand > level.get(next)) { level.set(next, cand); queue.push(next); }
    }
  }
  // any node never leveled (disconnected) -> put at max level + 1
  const maxLevel = Math.max(0, ...[...level.values()]);
  for (const n of nodes) if (!level.has(n.id)) level.set(n.id, maxLevel + 1);
  // assign row within each column
  const perLevelCount = new Map();
  const positions = {};
  for (const n of nodes) {
    const lv = level.get(n.id) || 0;
    const row = perLevelCount.get(lv) || 0;
    perLevelCount.set(lv, row + 1);
    positions[n.id] = { x: ORIGIN_X + lv * LAYOUT_X, y: ORIGIN_Y + row * LAYOUT_Y };
  }
  return positions;
};

// ---- definition JSON -> canvas graph ----
export const definitionToGraph = (definition = {}) => {
  const defNodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const defEdges = Array.isArray(definition.edges) ? definition.edges : [];
  const needsLayout = defNodes.some((n) => !n.position || typeof n.position.x !== "number");
  const auto = needsLayout ? autoLayout(defNodes, defEdges) : {};
  const nodes = defNodes.map((n) => ({
    id: n.id,
    type: NODE_TYPES.includes(n.type) ? n.type : "end",
    position: n.position && typeof n.position.x === "number" ? { x: n.position.x, y: n.position.y } : auto[n.id] || { x: ORIGIN_X, y: ORIGIN_Y },
    data: { nodeType: n.type, config: n.config && typeof n.config === "object" ? n.config : {} },
  }));
  const edges = defEdges.map((e) => {
    const when = e.when === "true" || e.when === "false" ? String(e.when) : null;
    return {
      id: edgeId(e.from, e.to, when),
      source: String(e.from),
      target: String(e.to),
      ...(when ? { sourceHandle: when } : {}),
      data: { when },
      label: when || undefined,
    };
  });
  return { nodes, edges, viewport: definition.viewport || null };
};

// ---- canvas graph -> definition JSON (round-trips positions + viewport) ----
export const graphToDefinition = (graph = {}, { version = 1, viewport = null } = {}) => {
  const nodes = (graph.nodes || []).map((n) => ({
    id: n.id,
    type: n.data?.nodeType || n.type,
    config: n.data?.config && typeof n.data.config === "object" ? n.data.config : {},
    position: { x: Math.round(n.position?.x || 0), y: Math.round(n.position?.y || 0) },
  }));
  const edges = (graph.edges || []).map((e) => {
    const when = e.sourceHandle === "true" || e.sourceHandle === "false" ? e.sourceHandle : e.data?.when || null;
    return { from: e.source, to: e.target, ...(when ? { when } : {}) };
  });
  const def = { version: Number(version) || 1, nodes, edges };
  if (viewport && typeof viewport.zoom === "number") def.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
  return def;
};

// ---- Blank starter (valid: exactly one trigger) ----
export const blankDefinition = () => {
  const t = newNodeId("trigger");
  const e = newNodeId("end");
  return {
    version: 1,
    nodes: [
      { id: t, type: "trigger", config: { triggerType: "manual" }, position: { x: ORIGIN_X, y: ORIGIN_Y } },
      { id: e, type: "end", config: {}, position: { x: ORIGIN_X + LAYOUT_X, y: ORIGIN_Y } },
    ],
    edges: [{ from: t, to: e }],
  };
};

// ---- Client-side structural validation (mirror of the server; server stays authoritative) ----
// Returns { valid, errors:[{ nodeId?, edgeId?, message }] } for inline UX feedback.
export const validateGraphStructure = (definition = {}, registry = {}) => {
  const errors = [];
  const toolsById = new Map((registry.tools || []).map((t) => [t.id, t]));
  const nodes = Array.isArray(definition.nodes) ? definition.nodes : [];
  const edges = Array.isArray(definition.edges) ? definition.edges : [];
  if (!Number.isInteger(definition.version) || definition.version < 1) errors.push({ message: "Version must be a positive integer.", messageKey: "aiStudio.workflow.validation.versionPositive" });

  const ids = new Set();
  let triggers = 0;
  for (const n of nodes) {
    const id = String(n.id || "");
    if (!id) { errors.push({ message: "A node is missing an id.", messageKey: "aiStudio.workflow.validation.nodeMissingId" }); continue; }
    if (ids.has(id)) errors.push({ nodeId: id, message: `Duplicate node id: ${id}`, messageKey: "aiStudio.workflow.validation.duplicateNodeId", messageParams: { id } });
    ids.add(id);
    if (!NODE_TYPES.includes(n.type)) { errors.push({ nodeId: id, message: `Unknown node type "${n.type}".`, messageKey: "aiStudio.workflow.validation.unknownNodeType", messageParams: { type: n.type } }); continue; }
    const cfg = n.config || {};
    if (n.type === "trigger") triggers += 1;
    if (n.type === "tool" || n.type === "action") {
      if (!cfg.tool) errors.push({ nodeId: id, message: "Select a tool for this node.", messageKey: "aiStudio.workflow.validation.selectTool" });
      else if (!toolsById.has(cfg.tool)) errors.push({ nodeId: id, message: `Unknown tool "${cfg.tool}".`, messageKey: "aiStudio.workflow.validation.unknownTool", messageParams: { tool: cfg.tool } });
      else {
        const tool = toolsById.get(cfg.tool);
        if (tool.riskLevel === "SENSITIVE" && cfg.requiresApproval === false) errors.push({ nodeId: id, message: "SENSITIVE tools always require approval.", messageKey: "aiStudio.workflow.validation.sensitiveNeedsApproval" });
        if (tool.executable === false && n.type === "action") errors.push({ nodeId: id, message: `"${cfg.tool}" is described-only and cannot be executed.`, messageKey: "aiStudio.workflow.validation.describedOnly", messageParams: { tool: cfg.tool } });
      }
    }
    if (n.type === "condition") {
      const c = cfg.condition;
      if (!c || typeof c !== "object") errors.push({ nodeId: id, message: "Condition needs a left path and operator.", messageKey: "aiStudio.workflow.validation.conditionNeedsLeftOp" });
      else {
        if (!c.left || typeof c.left !== "string") errors.push({ nodeId: id, message: "Condition source path is required.", messageKey: "aiStudio.workflow.validation.conditionLeftRequired" });
        if (!CONDITION_OP_IDS.includes(c.op)) errors.push({ nodeId: id, message: `Operator "${c.op}" is not supported.`, messageKey: "aiStudio.workflow.validation.operatorUnsupported", messageParams: { op: c.op } });
      }
    }
    if (n.type === "agent") {
      const mode = cfg.mode || "read_only_analysis";
      if (!["read_only_analysis", "llm_grounded"].includes(mode)) errors.push({ nodeId: id, message: `Agent mode "${mode}" is not supported.`, messageKey: "aiStudio.workflow.validation.agentModeUnsupported", messageParams: { mode } });
    }
  }
  if (triggers !== 1) errors.push({ message: `A workflow needs exactly one trigger (found ${triggers}).`, messageKey: "aiStudio.workflow.validation.exactlyOneTrigger", messageParams: { count: triggers } });

  for (const e of edges) {
    if (!ids.has(String(e.from || ""))) errors.push({ message: `An edge starts from an unknown node "${e.from}".`, messageKey: "aiStudio.workflow.validation.edgeFromUnknown", messageParams: { from: e.from } });
    if (!ids.has(String(e.to || ""))) errors.push({ message: `An edge points to an unknown node "${e.to}".`, messageKey: "aiStudio.workflow.validation.edgeToUnknown", messageParams: { to: e.to } });
    if (e.when !== undefined && !["true", "false"].includes(String(e.when))) errors.push({ message: `Branch label must be true/false.`, messageKey: "aiStudio.workflow.validation.branchLabel" });
  }
  return { valid: errors.length === 0, errors };
};

// ---- Map server validation error strings to nodes for inline display ----
// Server emits e.g. `node abc: tool node requires config.tool` or `... (node abc)`.
export const mapServerErrorsToNodes = (serverErrors = []) => {
  const nodeErrors = {};
  const general = [];
  for (const raw of serverErrors) {
    const msg = String(raw || "");
    let m = msg.match(/^node\s+([^\s:]+)\s*:\s*(.*)$/i);
    if (!m) m = msg.match(/\(node\s+([^\s)]+)\)\s*$/i) && [null, msg.match(/\(node\s+([^\s)]+)\)/i)[1], msg];
    if (m && m[1]) {
      const id = m[1];
      (nodeErrors[id] = nodeErrors[id] || []).push((m[2] || msg).trim());
    } else {
      general.push(msg);
    }
  }
  return { nodeErrors, general };
};

// ---- Live execution: run + steps -> per-node visual state ----
// step.status: ok|failed|awaiting_approval. Latest step per node wins. Returns
// { states: { nodeId: { state, status, durationMs, seq, error } }, currentNodeId }.
export const runToNodeStates = (run = {}, steps = []) => {
  const states = {};
  let currentNodeId = null;
  const ordered = [...steps].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  for (const s of ordered) {
    const nid = s.node_id;
    if (!nid) continue;
    let state = "completed";
    if (s.status === "failed") state = "failed";
    else if (s.status === "awaiting_approval") state = "awaiting_approval";
    states[nid] = { state, status: s.status, durationMs: s.duration_ms ?? null, seq: s.seq ?? null, error: s.error || null };
    currentNodeId = nid;
  }
  // Terminal run reclassification for the paused node.
  if (run.pending_node_id && states[run.pending_node_id]) {
    if (run.status === "rejected") states[run.pending_node_id].state = "rejected";
    else if (run.status === "awaiting_approval") states[run.pending_node_id].state = "awaiting_approval";
    currentNodeId = run.pending_node_id;
  }
  return { states, currentNodeId, runStatus: run.status || null };
};

// ---- Stable normalization for dirty-state comparison (positions included) ----
export const normalizeDefinition = (definition = {}) => {
  const nodes = [...(definition.nodes || [])]
    .map((n) => ({ id: n.id, type: n.type, config: n.config || {}, position: n.position ? { x: Math.round(n.position.x || 0), y: Math.round(n.position.y || 0) } : null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const edges = [...(definition.edges || [])]
    .map((e) => ({ from: e.from, to: e.to, when: e.when || null }))
    .sort((a, b) => `${a.from}>${a.to}>${a.when}`.localeCompare(`${b.from}>${b.to}>${b.when}`));
  return JSON.stringify({ version: definition.version || 1, nodes, edges });
};

export const definitionsEqual = (a, b) => normalizeDefinition(a) === normalizeDefinition(b);

// ============================================================================
// Phase 3.5 — pure UX helpers (editor-only; never change executor semantics)
// ============================================================================

// The single trigger node id (mirrors the executor's start = the one trigger node).
export const triggerNodeId = (definition = {}) => {
  const triggers = (definition.nodes || []).filter((n) => n.type === "trigger");
  return triggers.length === 1 ? triggers[0].id : triggers[0]?.id || null;
};

// Set of node ids reachable from the trigger by following edges (the executable path).
// Editor UX only — the executor traverses the same edges deterministically.
export const reachableFromTrigger = (definition = {}) => {
  const start = triggerNodeId(definition);
  const reachable = new Set();
  if (!start) return reachable;
  const ids = new Set((definition.nodes || []).map((n) => n.id));
  if (!ids.has(start)) return reachable;
  const adj = new Map();
  for (const e of definition.edges || []) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const queue = [start];
  reachable.add(start);
  let guard = 0;
  while (queue.length && guard < 10000) {
    guard += 1;
    const id = queue.shift();
    for (const next of adj.get(id) || []) {
      if (ids.has(next) && !reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }
  return reachable;
};

// Node ids present on the canvas but NOT reachable from the trigger — they will not execute.
export const disconnectedNodeIds = (definition = {}) => {
  const reachable = reachableFromTrigger(definition);
  return (definition.nodes || []).map((n) => n.id).filter((id) => !reachable.has(id));
};

// ---- Human-friendly field labels (display only; serialized keys never change) ----
export const FIELD_LABELS = {
  query: "Search query",
  productId: "Product",
  variantId: "Variant",
  sku: "SKU",
  orderId: "Order",
  orderNumber: "Order number",
  conversationId: "Conversation",
  governorate: "Governorate",
  city: "City",
  subtotal: "Subtotal",
  status: "Status",
  draftId: "Draft",
  text: "Message",
  conversation: "Conversation",
  profile: "Customer profile",
};

const camelToTitle = (s) =>
  String(s || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

export const humanizeField = (name) => FIELD_LABELS[name] || camelToTitle(name);

// Human-readable one-line summary of a condition, e.g. "IF products.length greater than 0".
export const conditionSummary = (condition = {}) => {
  const op = CONDITION_OPS.find((o) => o.id === condition.op);
  const left = condition.left || "value";
  if (!op) return `IF ${left} …`;
  return op.needsValue ? `IF ${left} ${op.label} ${condition.right ?? ""}`.trim() : `IF ${left} ${op.label}`;
};

// ---- Editor warnings (distinct from server validation errors) ----
// These are advisory: the server may still accept the definition (e.g. a disconnected node).
// Each: { nodeId?, message, kind: "warning" }.
export const computeEditorWarnings = (definition = {}, registry = {}) => {
  const warnings = [];
  const nodes = definition.nodes || [];
  const edges = definition.edges || [];
  const toolsById = new Map((registry.tools || []).map((t) => [t.id, t]));
  const nameOf = (n) => n?.config?.label || toolsById.get(n?.config?.tool)?.name || (NODE_META[n?.type]?.label ?? n?.type);

  // Disconnected-from-trigger nodes (won't execute)
  const reachable = reachableFromTrigger(definition);
  const hasTrigger = nodes.some((n) => n.type === "trigger");
  for (const n of nodes) {
    if (n.type === "trigger") continue;
    if (hasTrigger && !reachable.has(n.id)) {
      warnings.push({ nodeId: n.id, kind: "warning", message: `“${nameOf(n)}” is not connected to the Trigger and will not run.`, messageKey: "aiStudio.workflow.validation.notConnected", messageParams: { name: nameOf(n) } });
    }
  }

  // Required tool inputs left empty
  for (const n of nodes) {
    if (n.type !== "tool" && n.type !== "action") continue;
    const tool = toolsById.get(n.config?.tool);
    if (!tool || !tool.inputSchema) continue;
    const input = n.config?.input || {};
    for (const [field, spec] of Object.entries(tool.inputSchema)) {
      if (!spec?.required) continue;
      const v = input[field];
      const empty = v === undefined || v === "" || v === null || (v && typeof v === "object" && "$from" in v && !v.$from);
      if (empty) warnings.push({ nodeId: n.id, kind: "warning", message: `“${nameOf(n)}” is missing ${humanizeField(field)}.`, messageKey: "aiStudio.workflow.validation.missingField", messageParams: { name: nameOf(n), field: humanizeField(field) } });
    }
  }

  // Condition nodes missing a true/false branch
  for (const n of nodes) {
    if (n.type !== "condition") continue;
    const outs = edges.filter((e) => e.from === n.id);
    if (!outs.some((e) => String(e.when) === "true")) warnings.push({ nodeId: n.id, kind: "warning", message: `“${nameOf(n)}” has no True branch connected.`, messageKey: "aiStudio.workflow.validation.noTrueBranch", messageParams: { name: nameOf(n) } });
    if (!outs.some((e) => String(e.when) === "false")) warnings.push({ nodeId: n.id, kind: "warning", message: `“${nameOf(n)}” has no False branch connected.`, messageKey: "aiStudio.workflow.validation.noFalseBranch", messageParams: { name: nameOf(n) } });
  }

  return warnings;
};

// ---- Execution states enriched with waiting/skipped (editor visualization) ----
// Builds on runToNodeStates and classifies reachable-but-not-executed nodes:
//   active run  -> "waiting";  terminal run -> "skipped".
export const execStatesForRun = (run = {}, steps = [], definition = {}) => {
  const base = runToNodeStates(run, steps);
  const states = { ...base.states };
  const reachable = reachableFromTrigger(definition);
  const active = run.status === "running" || run.status === "awaiting_approval" || run.status === "pending";
  const terminal = run.status === "completed" || run.status === "failed" || run.status === "rejected" || run.status === "cancelled";
  for (const n of definition.nodes || []) {
    if (states[n.id]) continue;
    if (!reachable.has(n.id)) continue; // disconnected handled separately, not an exec state
    if (active) states[n.id] = { state: "waiting", status: "waiting", durationMs: null, seq: null, error: null };
    else if (terminal) states[n.id] = { state: "skipped", status: "skipped", durationMs: null, seq: null, error: null };
  }
  return { states, currentNodeId: base.currentNodeId, runStatus: run.status || null };
};

// Which edges lie on the executed path (both endpoints completed) vs lead to the current node.
// Returns { path: Set(edgeKey), current: Set(edgeKey), failed: Set(edgeKey) } keyed by `${from}->${to}`.
export const edgeExecClasses = (execStates = {}, definition = {}, currentNodeId = null) => {
  const path = new Set();
  const current = new Set();
  const failed = new Set();
  const st = (id) => execStates[id]?.state;
  for (const e of definition.edges || []) {
    const key = `${e.from}->${e.to}`;
    const from = st(e.from);
    const to = st(e.to);
    if (from === "completed" && (to === "completed" || to === "failed" || to === "awaiting_approval" || to === "rejected")) path.add(key);
    if (to === "failed" || to === "rejected") failed.add(key);
    if (e.to === currentNodeId && (to === "running" || to === "awaiting_approval")) current.add(key);
  }
  return { path, current, failed };
};

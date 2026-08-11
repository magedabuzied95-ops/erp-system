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
export const CONDITION_OPS = [
  { id: "eq", label: "equals", needsValue: true },
  { id: "neq", label: "not equals", needsValue: true },
  { id: "gt", label: "greater than", needsValue: true },
  { id: "lt", label: "less than", needsValue: true },
  { id: "gte", label: "greater or equal", needsValue: true },
  { id: "lte", label: "less or equal", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "exists", label: "exists", needsValue: false },
  { id: "not_exists", label: "does not exist", needsValue: false },
  { id: "truthy", label: "is truthy", needsValue: false },
  { id: "falsy", label: "is falsy", needsValue: false },
];
export const CONDITION_OP_IDS = CONDITION_OPS.map((o) => o.id);

// Fallback capabilities if the /tools endpoint is unavailable (kept conservative).
export const DEFAULT_AGENT_MODES = [
  { id: "read_only_analysis", label: "Read-only analysis", available: true },
  { id: "llm_grounded", label: "LLM grounded", available: false },
];
export const DEFAULT_TRIGGER_TYPES = [{ id: "manual", label: "Manual", available: true }];

// ---- Per-type metadata for the canvas / palette (icon resolved in the component) ----
export const NODE_META = {
  trigger: { label: "Trigger", icon: "Zap", accent: "cyan", group: "TRIGGERS", hasTool: false },
  agent: { label: "Agent", icon: "Bot", accent: "violet", group: "AGENTS", hasTool: false },
  condition: { label: "Condition", icon: "GitBranch", accent: "amber", group: "LOGIC", hasTool: false, branches: true },
  tool: { label: "Tool", icon: "Wrench", accent: "sky", group: "TOOLS", hasTool: true },
  action: { label: "Action", icon: "Bolt", accent: "orange", group: "ACTIONS", hasTool: true },
  approval: { label: "Approval", icon: "ShieldCheck", accent: "rose", group: "APPROVAL", hasTool: false },
  end: { label: "End", icon: "Flag", accent: "slate", group: "LOGIC", hasTool: false },
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
  });

  return [
    { group: "TRIGGERS", items: triggerItems },
    { group: "AGENTS", items: [{ kind: "agent", nodeType: "agent", label: "Agent", description: "Reuse the existing AI (read-only summary by default)." }] },
    {
      group: "LOGIC",
      items: [
        { kind: "condition", nodeType: "condition", label: "Condition", description: "Branch on a value from earlier steps (true/false)." },
        { kind: "end", nodeType: "end", label: "End", description: "Terminate this path." },
      ],
    },
    { group: "TOOLS", subtitle: "READ — safe, may auto-run", items: tools.filter((t) => t.riskLevel === "READ").map(toolItem) },
    {
      group: "ACTIONS",
      subtitle: "WRITE / SENSITIVE — side effects",
      items: [
        ...tools.filter((t) => t.riskLevel === "WRITE").map(toolItem),
        ...tools.filter((t) => t.riskLevel === "SENSITIVE").map(toolItem),
      ],
    },
    { group: "APPROVAL", items: [{ kind: "approval", nodeType: "approval", label: "Approval gate", description: "Explicit human approval before continuing." }] },
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
  if (!Number.isInteger(definition.version) || definition.version < 1) errors.push({ message: "Version must be a positive integer." });

  const ids = new Set();
  let triggers = 0;
  for (const n of nodes) {
    const id = String(n.id || "");
    if (!id) { errors.push({ message: "A node is missing an id." }); continue; }
    if (ids.has(id)) errors.push({ nodeId: id, message: `Duplicate node id: ${id}` });
    ids.add(id);
    if (!NODE_TYPES.includes(n.type)) { errors.push({ nodeId: id, message: `Unknown node type "${n.type}".` }); continue; }
    const cfg = n.config || {};
    if (n.type === "trigger") triggers += 1;
    if (n.type === "tool" || n.type === "action") {
      if (!cfg.tool) errors.push({ nodeId: id, message: "Select a tool for this node." });
      else if (!toolsById.has(cfg.tool)) errors.push({ nodeId: id, message: `Unknown tool "${cfg.tool}".` });
      else {
        const tool = toolsById.get(cfg.tool);
        if (tool.riskLevel === "SENSITIVE" && cfg.requiresApproval === false) errors.push({ nodeId: id, message: "SENSITIVE tools always require approval." });
        if (tool.executable === false && n.type === "action") errors.push({ nodeId: id, message: `"${cfg.tool}" is described-only and cannot be executed.` });
      }
    }
    if (n.type === "condition") {
      const c = cfg.condition;
      if (!c || typeof c !== "object") errors.push({ nodeId: id, message: "Condition needs a left path and operator." });
      else {
        if (!c.left || typeof c.left !== "string") errors.push({ nodeId: id, message: "Condition source path is required." });
        if (!CONDITION_OP_IDS.includes(c.op)) errors.push({ nodeId: id, message: `Operator "${c.op}" is not supported.` });
      }
    }
    if (n.type === "agent") {
      const mode = cfg.mode || "read_only_analysis";
      if (!["read_only_analysis", "llm_grounded"].includes(mode)) errors.push({ nodeId: id, message: `Agent mode "${mode}" is not supported.` });
    }
  }
  if (triggers !== 1) errors.push({ message: `A workflow needs exactly one trigger (found ${triggers}).` });

  for (const e of edges) {
    if (!ids.has(String(e.from || ""))) errors.push({ message: `An edge starts from an unknown node "${e.from}".` });
    if (!ids.has(String(e.to || ""))) errors.push({ message: `An edge points to an unknown node "${e.to}".` });
    if (e.when !== undefined && !["true", "false"].includes(String(e.when))) errors.push({ message: `Branch label must be true/false.` });
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

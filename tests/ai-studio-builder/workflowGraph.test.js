// Frontend visual-builder core: definition <-> canvas mapping and helpers.
// Pure module (no DOM / no @xyflow) so it runs under `node --test`.

import test from "node:test";
import assert from "node:assert/strict";

import {
  definitionToGraph,
  graphToDefinition,
  buildPalette,
  validateGraphStructure,
  mapServerErrorsToNodes,
  runToNodeStates,
  definitionsEqual,
  blankDefinition,
  autoLayout,
  CONDITION_OP_IDS,
} from "../../src/modules/aiStudio/lib/workflowGraph.js";

// A registry shaped like GET /api/ai-studio/tools.
const REGISTRY = {
  tools: [
    { id: "products.search", name: "Search products", riskLevel: "READ", requiredPermission: "products.view", executable: true, requiresApproval: false },
    { id: "leads.create_opportunity", name: "Create lead", riskLevel: "WRITE", requiredPermission: "settings.edit", executable: false, requiresApproval: true },
    { id: "orders.update_status", name: "Update order status", riskLevel: "SENSITIVE", requiredPermission: "orders.edit", executable: true, requiresApproval: true },
    { id: "messaging.send_customer", name: "Send message", riskLevel: "SENSITIVE", requiredPermission: "settings.edit", executable: false, requiresApproval: true },
  ],
};
const CAPS = {
  agentModes: [{ id: "read_only_analysis", available: true }, { id: "llm_grounded", available: false }],
  triggerTypes: [{ id: "manual", label: "Manual", available: true }, { id: "webhook", label: "Channel webhook", available: false }],
};

// The Phase 2 seed workflow definition (real shape).
const SEED = {
  version: 1,
  nodes: [
    { id: "trigger", type: "trigger", config: { triggerType: "manual" } },
    { id: "search", type: "tool", config: { tool: "products.search", input: { query: { $from: "trigger.input.query" } } } },
    { id: "has_results", type: "condition", config: { condition: { left: "steps.search.output.products.length", op: "gt", right: 0 } } },
    { id: "analyze", type: "agent", config: { mode: "read_only_analysis" } },
    { id: "end_found", type: "end", config: {} },
    { id: "end_none", type: "end", config: {} },
  ],
  edges: [
    { from: "trigger", to: "search" },
    { from: "search", to: "has_results" },
    { from: "has_results", to: "analyze", when: "true" },
    { from: "has_results", to: "end_none", when: "false" },
    { from: "analyze", to: "end_found" },
  ],
};

test("definition -> graph maps nodes/edges and assigns positions", () => {
  const g = definitionToGraph(SEED);
  assert.equal(g.nodes.length, 6);
  assert.equal(g.edges.length, 5);
  // every node has a numeric position (auto-layout kicked in since seed lacks positions)
  for (const n of g.nodes) {
    assert.equal(typeof n.position.x, "number");
    assert.equal(typeof n.position.y, "number");
    assert.equal(n.data.nodeType, SEED.nodes.find((s) => s.id === n.id).type);
  }
  // condition branch edges carry a sourceHandle
  const trueEdge = g.edges.find((e) => e.source === "has_results" && e.target === "analyze");
  assert.equal(trueEdge.sourceHandle, "true");
  const falseEdge = g.edges.find((e) => e.source === "has_results" && e.target === "end_none");
  assert.equal(falseEdge.sourceHandle, "false");
});

test("graph -> definition round-trips the seed (structure preserved)", () => {
  const g = definitionToGraph(SEED);
  const def = graphToDefinition(g, { version: 1 });
  // Same node ids/types/config
  assert.deepEqual(
    def.nodes.map((n) => n.id).sort(),
    SEED.nodes.map((n) => n.id).sort()
  );
  const search = def.nodes.find((n) => n.id === "search");
  assert.equal(search.type, "tool");
  assert.equal(search.config.tool, "products.search");
  // $from ref preserved verbatim
  assert.deepEqual(search.config.input, { query: { $from: "trigger.input.query" } });
  // condition when-branches preserved
  const t = def.edges.find((e) => e.from === "has_results" && e.to === "analyze");
  assert.equal(t.when, "true");
  const f = def.edges.find((e) => e.from === "has_results" && e.to === "end_none");
  assert.equal(f.when, "false");
  // positions now present and integer
  for (const n of def.nodes) {
    assert.equal(Number.isInteger(n.position.x), true);
    assert.equal(Number.isInteger(n.position.y), true);
  }
});

test("positions + viewport survive a full round-trip", () => {
  const withPos = {
    ...SEED,
    nodes: SEED.nodes.map((n, i) => ({ ...n, position: { x: i * 100, y: i * 50 } })),
    viewport: { x: 12, y: 34, zoom: 1.25 },
  };
  const g = definitionToGraph(withPos);
  assert.equal(g.nodes.find((n) => n.id === "search").position.x, 100);
  const def = graphToDefinition(g, { version: withPos.version, viewport: withPos.viewport });
  assert.deepEqual(def.viewport, { x: 12, y: 34, zoom: 1.25 });
  assert.equal(def.nodes.find((n) => n.id === "search").position.x, 100);
});

test("palette is built from the real registry (READ->tool, WRITE/SENSITIVE->action)", () => {
  const palette = buildPalette(REGISTRY, CAPS);
  const groups = Object.fromEntries(palette.map((g) => [g.group, g]));
  // READ tool present under TOOLS as a `tool` node
  const readItem = groups.TOOLS.items.find((i) => i.toolId === "products.search");
  assert.equal(readItem.nodeType, "tool");
  assert.equal(readItem.disabled, false);
  // SENSITIVE executable tool under ACTIONS as an `action` node
  const sensExec = groups.ACTIONS.items.find((i) => i.toolId === "orders.update_status");
  assert.equal(sensExec.nodeType, "action");
  assert.equal(sensExec.requiresApproval, true);
  assert.equal(sensExec.disabled, false);
});

test("described-only tools are DISABLED in the palette (cannot be dropped)", () => {
  const palette = buildPalette(REGISTRY, CAPS);
  const groups = Object.fromEntries(palette.map((g) => [g.group, g]));
  const lead = [...groups.ACTIONS.items].find((i) => i.toolId === "leads.create_opportunity");
  const send = [...groups.ACTIONS.items].find((i) => i.toolId === "messaging.send_customer");
  assert.equal(lead.disabled, true);
  assert.equal(send.disabled, true);
  assert.match(lead.disabledReason, /described-only/i);
});

test("unavailable trigger types are disabled ('coming later')", () => {
  const palette = buildPalette(REGISTRY, CAPS);
  const triggers = palette.find((g) => g.group === "TRIGGERS").items;
  assert.equal(triggers.find((t) => t.config.triggerType === "manual").disabled, false);
  assert.equal(triggers.find((t) => t.config.triggerType === "webhook").disabled, true);
});

test("SENSITIVE tool cannot serialize requiresApproval=false (client validation)", () => {
  const def = {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", config: { triggerType: "manual" } },
      { id: "a", type: "action", config: { tool: "orders.update_status", requiresApproval: false, input: {} } },
    ],
    edges: [{ from: "t", to: "a" }],
  };
  const { valid, errors } = validateGraphStructure(def, REGISTRY);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "a" && /always require approval/i.test(e.message)));
});

test("described-only tool as an action node fails client validation", () => {
  const def = {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", config: { triggerType: "manual" } },
      { id: "a", type: "action", config: { tool: "leads.create_opportunity", input: {} } },
    ],
    edges: [{ from: "t", to: "a" }],
  };
  const { valid, errors } = validateGraphStructure(def, REGISTRY);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.nodeId === "a" && /described-only/i.test(e.message)));
});

test("exactly-one-trigger rule enforced", () => {
  const zero = validateGraphStructure({ version: 1, nodes: [{ id: "e", type: "end", config: {} }], edges: [] }, REGISTRY);
  assert.equal(zero.valid, false);
  const two = validateGraphStructure({
    version: 1,
    nodes: [
      { id: "t1", type: "trigger", config: {} },
      { id: "t2", type: "trigger", config: {} },
    ],
    edges: [],
  }, REGISTRY);
  assert.equal(two.valid, false);
});

test("unsupported node type + unsupported operator rejected", () => {
  const def = {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", config: {} },
      { id: "x", type: "http_request", config: {} },
      { id: "c", type: "condition", config: { condition: { left: "a", op: "regex" } } },
    ],
    edges: [],
  };
  const { valid, errors } = validateGraphStructure(def, REGISTRY);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /Unknown node type/i.test(e.message)));
  assert.ok(errors.some((e) => /not supported/i.test(e.message)));
  assert.equal(CONDITION_OP_IDS.includes("regex"), false);
});

test("edges to unknown nodes are flagged", () => {
  const def = {
    version: 1,
    nodes: [{ id: "t", type: "trigger", config: {} }],
    edges: [{ from: "t", to: "ghost" }],
  };
  const { valid, errors } = validateGraphStructure(def, REGISTRY);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => /unknown node "ghost"/i.test(e.message)));
});

test("server validation errors map to nodes", () => {
  const { nodeErrors, general } = mapServerErrorsToNodes([
    "node search: tool node requires config.tool",
    'unknown node type "foo" (node bad)',
    "definition must contain exactly one trigger node (found 0)",
  ]);
  assert.deepEqual(nodeErrors.search, ["tool node requires config.tool"]);
  assert.ok(nodeErrors.bad);
  assert.equal(general.length, 1);
  assert.match(general[0], /exactly one trigger/);
});

test("run steps map to per-node visual states", () => {
  const run = { status: "completed", pending_node_id: null };
  const steps = [
    { seq: 1, node_id: "trigger", node_type: "trigger", status: "ok", duration_ms: 1 },
    { seq: 2, node_id: "search", node_type: "tool", status: "ok", duration_ms: 1126 },
    { seq: 3, node_id: "has_results", node_type: "condition", status: "ok", duration_ms: 1 },
  ];
  const { states, currentNodeId } = runToNodeStates(run, steps);
  assert.equal(states.trigger.state, "completed");
  assert.equal(states.search.durationMs, 1126);
  assert.equal(currentNodeId, "has_results");
});

test("awaiting-approval run marks the pending node", () => {
  const run = { status: "awaiting_approval", pending_node_id: "act" };
  const steps = [
    { seq: 1, node_id: "trigger", status: "ok" },
    { seq: 2, node_id: "act", node_type: "action", status: "awaiting_approval" },
  ];
  const { states, currentNodeId } = runToNodeStates(run, steps);
  assert.equal(states.act.state, "awaiting_approval");
  assert.equal(currentNodeId, "act");
});

test("failed step marks node failed", () => {
  const { states } = runToNodeStates({ status: "failed" }, [{ seq: 1, node_id: "a", status: "failed", error: "boom" }]);
  assert.equal(states.a.state, "failed");
  assert.equal(states.a.error, "boom");
});

test("dirty-state detection via normalized comparison", () => {
  const g = definitionToGraph(SEED);
  const def1 = graphToDefinition(g, { version: 1 });
  const def2 = graphToDefinition(g, { version: 1 });
  assert.equal(definitionsEqual(def1, def2), true);
  // move a node -> dirty
  const moved = { ...def2, nodes: def2.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: n.position.x + 40, y: n.position.y } } : n)) };
  assert.equal(definitionsEqual(def1, moved), false);
});

test("blank definition is structurally valid", () => {
  const def = blankDefinition();
  const { valid } = validateGraphStructure(def, REGISTRY);
  assert.equal(valid, true);
  assert.equal(def.nodes.filter((n) => n.type === "trigger").length, 1);
});

test("autoLayout assigns increasing x by depth", () => {
  const pos = autoLayout(SEED.nodes, SEED.edges);
  assert.ok(pos.search.x > pos.trigger.x);
  assert.ok(pos.has_results.x > pos.search.x);
});

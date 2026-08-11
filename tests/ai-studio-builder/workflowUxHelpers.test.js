// Phase 3.5 UX helpers: reachability, disconnected detection, human labels,
// editor warnings, execution-state enrichment. Pure module (node --test).

import test from "node:test";
import assert from "node:assert/strict";

import {
  reachableFromTrigger,
  disconnectedNodeIds,
  humanizeField,
  conditionSummary,
  computeEditorWarnings,
  execStatesForRun,
  edgeExecClasses,
} from "../../src/modules/aiStudio/lib/workflowGraph.js";

const REGISTRY = {
  tools: [
    { id: "products.search", name: "Search products", riskLevel: "READ", executable: true, inputSchema: { query: { type: "string", required: true } } },
    { id: "inventory.check_stock", name: "Check stock", riskLevel: "READ", executable: true, inputSchema: { productId: { type: "number", required: false } } },
  ],
};

// trigger -> search -> end ; check_stock is placed but NOT connected
const DEF = {
  version: 1,
  nodes: [
    { id: "trigger", type: "trigger", config: { triggerType: "manual" } },
    { id: "search", type: "tool", config: { tool: "products.search", input: { query: "nike" } } },
    { id: "end", type: "end", config: {} },
    { id: "check", type: "tool", config: { tool: "inventory.check_stock", input: {} } },
  ],
  edges: [
    { from: "trigger", to: "search" },
    { from: "search", to: "end" },
  ],
};

test("reachableFromTrigger walks the executable path only", () => {
  const r = reachableFromTrigger(DEF);
  assert.equal(r.has("trigger"), true);
  assert.equal(r.has("search"), true);
  assert.equal(r.has("end"), true);
  assert.equal(r.has("check"), false);
});

test("disconnectedNodeIds finds nodes not wired to the trigger", () => {
  assert.deepEqual(disconnectedNodeIds(DEF), ["check"]);
});

test("humanizeField maps known keys and camel-cases the rest", () => {
  assert.equal(humanizeField("productId"), "Product");
  assert.equal(humanizeField("query"), "Search query");
  assert.equal(humanizeField("variantId"), "Variant");
  assert.equal(humanizeField("someCustomKey"), "Some Custom Key");
});

test("conditionSummary is human-readable and hides value for value-less ops", () => {
  assert.match(conditionSummary({ left: "steps.search.output.products.length", op: "gt", right: 0 }), /greater than 0/);
  assert.match(conditionSummary({ left: "x", op: "exists" }), /IF x exists$/);
});

test("computeEditorWarnings flags disconnected node + missing required input", () => {
  const w = computeEditorWarnings(DEF, REGISTRY);
  assert.ok(w.some((x) => x.nodeId === "check" && /not connected/i.test(x.message)));
  // search has its required query filled -> no missing-input warning for search
  assert.equal(w.some((x) => x.nodeId === "search" && /missing/i.test(x.message)), false);
});

test("computeEditorWarnings flags a condition missing true/false branches", () => {
  const def = {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", config: {} },
      { id: "c", type: "condition", config: { condition: { left: "a", op: "exists" }, label: "Has results" } },
      { id: "e", type: "end", config: {} },
    ],
    edges: [{ from: "t", to: "c" }, { from: "c", to: "e", when: "true" }],
  };
  const w = computeEditorWarnings(def, REGISTRY);
  assert.ok(w.some((x) => x.nodeId === "c" && /no False branch/i.test(x.message)));
  assert.equal(w.some((x) => x.nodeId === "c" && /no True branch/i.test(x.message)), false);
});

test("missing required input is flagged when empty $from", () => {
  const def = {
    version: 1,
    nodes: [
      { id: "t", type: "trigger", config: {} },
      { id: "s", type: "tool", config: { tool: "products.search", input: { query: { $from: "" } } } },
    ],
    edges: [{ from: "t", to: "s" }],
  };
  const w = computeEditorWarnings(def, REGISTRY);
  assert.ok(w.some((x) => x.nodeId === "s" && /Search query/i.test(x.message)));
});

test("execStatesForRun marks waiting during an active run", () => {
  const run = { status: "running", pending_node_id: null };
  const steps = [{ seq: 1, node_id: "trigger", status: "ok" }];
  const { states } = execStatesForRun(run, steps, DEF);
  assert.equal(states.trigger.state, "completed");
  assert.equal(states.search.state, "waiting"); // reachable, not yet executed
  assert.equal(states.check, undefined); // disconnected -> no exec state
});

test("execStatesForRun marks skipped after a terminal run", () => {
  const run = { status: "completed", pending_node_id: null };
  const steps = [{ seq: 1, node_id: "trigger", status: "ok" }]; // search never ran (e.g. branch)
  const { states } = execStatesForRun(run, steps, DEF);
  assert.equal(states.search.state, "skipped");
  assert.equal(states.check, undefined);
});

test("edgeExecClasses marks the completed path and the current edge", () => {
  const execStates = {
    trigger: { state: "completed" },
    search: { state: "running" },
  };
  const { path, current } = edgeExecClasses(execStates, DEF, "search");
  assert.equal(current.has("trigger->search"), true);
  // trigger completed but search not completed yet -> not on finished path
  assert.equal(path.has("trigger->search"), false);
});

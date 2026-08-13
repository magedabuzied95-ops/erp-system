/**
 * Workflow Editor localization safety.
 *
 * The editor was localized with an ADDITIVE architecture: workflowGraph.js stays
 * pure and framework-free, emits raw ids plus `labelKey` / `messageKey`, and the
 * React layer resolves them. These tests pin the properties that make that safe:
 *
 *   1. serialized workflow definitions never carry a localized value,
 *   2. resolving display text cannot mutate the graph,
 *   3. the raw English `message` still exists for the assertions in
 *      workflowGraph.test.js / workflowUxHelpers.test.js and for debugging,
 *   4. every localizable validation message carries a messageKey,
 *   5. raw ids / enums / palette group ids are unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  CONDITION_OPS,
  CONDITION_OP_IDS,
  NODE_TYPES,
  NODE_META,
  DEFAULT_AGENT_MODES,
  DEFAULT_TRIGGER_TYPES,
  buildPalette,
  defaultConfigFor,
  validateGraphStructure,
  computeEditorWarnings,
  definitionToGraph,
  graphToDefinition,
  definitionsEqual,
} from "../../src/modules/aiStudio/lib/workflowGraph.js";
import { issueText } from "../../src/modules/aiStudio/lib/issueText.js";

const ar = JSON.parse(fs.readFileSync(path.resolve("src/locales/ar/aiStudio.json"), "utf8"));
const en = JSON.parse(fs.readFileSync(path.resolve("src/locales/en/aiStudio.json"), "utf8"));

/** Minimal stand-in for i18next: resolves a dotted key out of a bundle. */
const makeT = (bundle) => (key, options = {}) => {
  const parts = String(key).replace(/^aiStudio\./, "").split(".");
  let cur = bundle;
  for (const p of parts) {
    if (!cur || typeof cur !== "object" || !(p in cur)) return options.defaultValue ?? key;
    cur = cur[p];
  }
  if (typeof cur !== "string") return options.defaultValue ?? key;
  return cur.replace(/\{\{(\w+)\}\}/g, (_, name) => (options[name] !== undefined ? String(options[name]) : `{{${name}}}`));
};
const tEn = makeT(en);
const tAr = makeT(ar);

const REGISTRY = {
  tools: [
    { id: "catalog.search", name: "Catalog search", description: "Find products.", riskLevel: "READ", executable: true, inputSchema: { query: { type: "string", required: true } } },
    { id: "followup.create", name: "Create follow-up", description: "Creates a task.", riskLevel: "WRITE", executable: true, automaticExecution: "DELEGATABLE" },
    { id: "message.send", name: "Send message", description: "Messages a customer.", riskLevel: "SENSITIVE", executable: true },
  ],
};

const DEFINITION = {
  version: 3,
  nodes: [
    { id: "n_trigger", type: "trigger", config: { triggerType: "manual" }, position: { x: 0, y: 0 } },
    { id: "n_cond", type: "condition", config: { condition: { left: "steps.n_tool.output.count", op: "gt", right: 0 } }, position: { x: 200, y: 0 } },
    { id: "n_tool", type: "tool", config: { tool: "catalog.search", input: { query: { $from: "trigger.input.q" } } }, position: { x: 400, y: 0 } },
    { id: "n_appr", type: "approval", config: { label: "Human approval" }, position: { x: 600, y: 0 } },
    { id: "n_end", type: "end", config: {}, position: { x: 800, y: 0 } },
  ],
  edges: [
    { from: "n_trigger", to: "n_tool" },
    { from: "n_tool", to: "n_cond" },
    { from: "n_cond", to: "n_appr", when: "true" },
    { from: "n_cond", to: "n_end", when: "false" },
  ],
};

const clone = (v) => JSON.parse(JSON.stringify(v));

test("workflowGraph stays framework-free — no React/i18n imports", () => {
  const src = fs.readFileSync(path.resolve("src/modules/aiStudio/lib/workflowGraph.js"), "utf8");
  assert.equal(/^\s*import\s/m.test(src), false, "workflowGraph.js must not import anything");
  assert.equal(/react|i18n/i.test(src.split("\n").filter((l) => /^\s*import/.test(l)).join("\n")), false);
});

test("serialized definition is byte-identical after resolving display text in either locale", () => {
  const before = JSON.stringify(DEFINITION);

  // Resolve every display string the editor would render, in both languages.
  for (const t of [tEn, tAr]) {
    for (const op of CONDITION_OPS) t(op.labelKey, { defaultValue: op.label });
    for (const meta of Object.values(NODE_META)) t(meta.labelKey, { defaultValue: meta.label });
    for (const m of DEFAULT_AGENT_MODES) t(m.labelKey, { defaultValue: m.label });
    for (const g of buildPalette(REGISTRY, { agentModes: DEFAULT_AGENT_MODES, triggerTypes: DEFAULT_TRIGGER_TYPES })) {
      t(g.groupLabelKey, { defaultValue: g.group });
      for (const item of g.items) t(item.labelKey || "", { defaultValue: item.label });
    }
    for (const e of validateGraphStructure(DEFINITION, REGISTRY).errors) issueText(t, e);
    for (const w of computeEditorWarnings(DEFINITION, REGISTRY)) issueText(t, w);
  }

  assert.equal(JSON.stringify(DEFINITION), before, "resolving display text mutated the definition");
});

test("a graph round-trip is unchanged by the active language", () => {
  const round = (t) => {
    const graph = definitionToGraph(clone(DEFINITION));
    // Touch the display path the same way the canvas does.
    for (const node of graph.nodes) {
      const meta = NODE_META[node.data?.nodeType || node.type];
      if (meta) t(meta.labelKey, { defaultValue: meta.label });
    }
    return graphToDefinition(graph, { version: DEFINITION.version });
  };
  const asEn = round(tEn);
  const asAr = round(tAr);
  assert.deepEqual(asAr, asEn, "language changed the serialized graph");
  assert.equal(definitionsEqual(asEn, asAr), true);
  // and neither drifts from the source definition -> a language switch cannot dirty the editor
  assert.equal(definitionsEqual(asEn, DEFINITION), true);
  assert.equal(definitionsEqual(asAr, DEFINITION), true);
});

test("raw ids, enums and serialized values carry no localization", () => {
  assert.deepEqual(NODE_TYPES, ["trigger", "condition", "tool", "agent", "approval", "action", "end"]);
  assert.deepEqual(CONDITION_OP_IDS, ["eq", "neq", "gt", "lt", "gte", "lte", "contains", "exists", "not_exists", "truthy", "falsy"]);
  for (const op of CONDITION_OPS) assert.match(op.id, /^[a-z_]+$/, `operator id ${op.id} must stay a raw identifier`);
  for (const [type, meta] of Object.entries(NODE_META)) {
    assert.match(meta.group, /^[A-Z]+$/, `${type} palette group must stay a raw id`);
    assert.match(meta.labelKey, /^aiStudio\.workflow\.nodes\./);
  }
  for (const m of DEFAULT_AGENT_MODES) assert.match(m.id, /^[a-z_]+$/);
  for (const tt of DEFAULT_TRIGGER_TYPES) assert.match(tt.id, /^[a-z_.]+$/);
});

test("palette group ids stay raw and stable while headings localize", () => {
  const palette = buildPalette(REGISTRY, { agentModes: DEFAULT_AGENT_MODES, triggerTypes: DEFAULT_TRIGGER_TYPES });
  const ids = palette.map((g) => g.group);
  assert.deepEqual(ids, ["TRIGGERS", "AGENTS", "LOGIC", "TOOLS", "ACTIONS", "APPROVAL"]);
  // React keys must not move when the language does
  assert.deepEqual(palette.map((g) => g.group), ids);
  const headingsEn = palette.map((g) => tEn(g.groupLabelKey, { defaultValue: g.group }));
  const headingsAr = palette.map((g) => tAr(g.groupLabelKey, { defaultValue: g.group }));
  assert.notDeepEqual(headingsAr, headingsEn, "Arabic headings should differ from English");
  assert.deepEqual(palette.map((g) => g.group), ids, "resolving headings changed the group ids");
});

test("defaultConfigFor keeps the persisted approval label in raw English", () => {
  // cfg.label is serialized into the workflow and is user-editable, so it must
  // never become locale-dependent.
  assert.deepEqual(defaultConfigFor("approval"), { label: "Human approval" });
  assert.deepEqual(defaultConfigFor("agent"), { mode: "read_only_analysis" });
  assert.deepEqual(defaultConfigFor("condition"), { condition: { left: "", op: "exists", right: "" } });
});

test("every validation error and warning keeps its raw message AND gains a messageKey", () => {
  const broken = {
    version: 0,
    nodes: [
      { id: "", type: "tool", config: {} },
      { id: "dup", type: "nope", config: {} },
      { id: "dup", type: "tool", config: { tool: "ghost" } },
      { id: "sens", type: "tool", config: { tool: "message.send", requiresApproval: false } },
      { id: "cond", type: "condition", config: { condition: { left: "", op: "bogus" } } },
      { id: "agent", type: "agent", config: { mode: "wat" } },
    ],
    edges: [{ from: "missing", to: "alsoMissing", when: "maybe" }],
  };
  const { errors } = validateGraphStructure(broken, REGISTRY);
  assert.ok(errors.length >= 8, `expected many errors, got ${errors.length}`);
  for (const e of errors) {
    assert.equal(typeof e.message, "string");
    assert.ok(e.message.length > 0, "raw message must survive for the existing assertions");
    assert.ok(e.messageKey, `missing messageKey for: ${e.message}`);
    assert.match(e.messageKey, /^aiStudio\.workflow\.validation\./);
  }

  const warnings = computeEditorWarnings(
    {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", config: {} },
        { id: "c", type: "condition", config: { condition: { left: "x", op: "exists" } } },
        { id: "orphan", type: "tool", config: { tool: "catalog.search", input: {} } },
      ],
      edges: [{ from: "t", to: "c" }],
    },
    REGISTRY
  );
  assert.ok(warnings.length >= 3);
  for (const w of warnings) {
    assert.ok(w.message.length > 0);
    assert.ok(w.messageKey, `missing messageKey for warning: ${w.message}`);
  }
});

test("issueText renders the active locale and falls back to the raw message", () => {
  const { errors } = validateGraphStructure({ version: 0, nodes: [], edges: [] }, REGISTRY);
  const versionErr = errors.find((e) => e.messageKey?.endsWith("versionPositive"));
  assert.ok(versionErr);
  assert.equal(issueText(tEn, versionErr), "Version must be a positive integer.");
  assert.notEqual(issueText(tAr, versionErr), issueText(tEn, versionErr));
  assert.match(issueText(tAr, versionErr), /[؀-ۿ]/, "Arabic issue text should be Arabic");

  // interpolation uses the RAW value, untranslated
  const bad = validateGraphStructure(
    { version: 1, nodes: [{ id: "a", type: "zzz", config: {} }], edges: [] },
    REGISTRY
  ).errors.find((e) => e.messageKey?.endsWith("unknownNodeType"));
  assert.ok(bad);
  assert.match(issueText(tEn, bad), /zzz/);
  assert.match(issueText(tAr, bad), /zzz/, "the raw node type must stay raw inside the Arabic message");

  // no key -> raw message; plain string -> itself
  assert.equal(issueText(tAr, { message: "server said no" }), "server said no");
  assert.equal(issueText(tAr, "plain server error"), "plain server error");
});

test("aiStudio.workflow keys resolve in both locales", () => {
  const flat = (obj, prefix = "", out = []) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flat(v, key, out);
      else out.push(key);
    }
    return out;
  };
  const enKeys = flat(en.workflow).sort();
  const arKeys = flat(ar.workflow).sort();
  assert.deepEqual(arKeys, enKeys, "aiStudio.workflow parity broken");
  assert.ok(enKeys.length > 150, `expected the full editor dictionary, got ${enKeys.length}`);
});

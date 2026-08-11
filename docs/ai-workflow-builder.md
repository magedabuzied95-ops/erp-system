# AI Workflow Visual Builder (AI Studio Phase 3)

_A visual editor over the existing declarative workflow definition JSON. It is a pure
editing/visualization layer — there is **one** execution model and **one** source of truth:
the Phase 2 backend (`server/services/aiWorkflow*`). Companion to `docs/ai-workflow-engine.md`
and `docs/ai-studio-architecture.md`._

```
Visual Builder  →  workflow definition JSON  →  server validator  →  executor  →  Tool Registry  →  ERP services
```

The builder never runs anything in the browser, never invents executable semantics, and never
weakens approval/RBAC. It reads/writes the same `ai_workflows.definition` used by
`validateWorkflowDefinition` and `aiWorkflowExecutorService`.

---

## 1. Dependency

| Package | Version | License | Why |
|---|---|---|---|
| `@xyflow/react` | `^12.11.2` | MIT | The maintained **official** XYFlow/React Flow package. v12 peers `react >=17`, so it is compatible with this repo's **React 19.2**. (The legacy `reactflow` v11 peers only React 17/18 and is unsuitable here.) It bundles its own deps (`@xyflow/system`, `classcat`, `zustand`) — no companion packages were added. |

Pinned with a caret to match the repo's dependency policy. **Lazy-loaded** — see §9.

---

## 2. Route & files

- Route: **`/ai-studio/workflows/:id/edit`** (added in `src/App.jsx`, gated by `settings.view`; edit/run actions additionally require `settings.edit`, enforced server-side).
- Page: `src/modules/aiStudio/pages/AiStudioWorkflowEditor.jsx` (lazy).
- Canvas: `src/modules/aiStudio/components/editor/WorkflowCanvas.jsx` (the only file importing `@xyflow/react` + its CSS).
- Nodes: `components/editor/WorkflowNode.jsx` (one renderer for every semantic type).
- Palette: `components/editor/NodePalette.jsx`.
- Config panel: `components/editor/NodeConfigPanel.jsx`.
- Execution drawer: `components/editor/ExecutionDrawer.jsx`.
- Visual helpers: `components/editor/nodeKit.js` (static Tailwind class maps + icon resolver).
- **Pure mapping core** (framework-free, unit-tested): `src/modules/aiStudio/lib/workflowGraph.js`.
- Workflows list integration + New Workflow flow: `pages/AiStudioWorkflows.jsx`.

---

## 3. Definition ↔ canvas mapping (`workflowGraph.js`)

`definitionToGraph(def)` → `{ nodes, edges, viewport }`; `graphToDefinition(graph, {version, viewport})` → definition. The round-trip preserves node ids/types/config verbatim (including `$from` input references) and branch labels.

**Layout persistence (no schema change).** The server validator only checks `id`/`type`/`config`
per node and `from`/`to`/`when` per edge — it ignores any extra fields. So the builder stores
`position:{x,y}` on each node and an optional top-level `viewport`. These **round-trip through
save**, are **ignored by the executor**, and satisfy "never silently drop fields". When a
definition has no positions (e.g. the Phase 2 seed), `autoLayout()` computes a layered layout.

Node types (mirror `NODE_TYPES`): `trigger, condition, tool, agent, approval, action, end`.
A single `WorkflowNode` renders all types (xyflow passes `type`).

---

## 4. Node palette (dynamic, from the real registry)

`buildPalette(registry, capabilities)` builds the palette from **`GET /api/ai-studio/tools`** —
it is never hardcoded and grows automatically as tools are registered. Grouping:

- **TRIGGERS** — from `capabilities.triggerTypes`. `manual` is enabled; `webhook`/`schedule` show as **disabled "coming later"** (never serialized/executed).
- **AGENTS** — a single Agent node.
- **LOGIC** — Condition, End.
- **TOOLS** — `READ` tools → `tool` nodes.
- **ACTIONS** — `WRITE`/`SENSITIVE` executable tools → `action` nodes.
- **APPROVAL** — an explicit human-gate node.

**Described-only tools** (`executable:false`, e.g. `leads.create_opportunity`,
`messaging.send_customer`) are shown but **disabled** in the palette, so an invalid executable
configuration can never be dropped or serialized.

Search filters the palette by name/description/tool id/risk.

---

## 5. Risk & approval visualization

Risk is conveyed by **text + icon + colour** (never colour alone):

- **READ** — emerald badge, "may auto-run".
- **WRITE** — amber badge, "approval by default".
- **SENSITIVE** — rose shield badge + a **"Human approval required"** lock on the node and in the config panel.

**Approval is intrinsic, not a frontend assumption.** The executor auto-creates the approval
gate for any SENSITIVE tool/action (`node.type==='approval' || toolRequiresApproval(tool) ||
config.requiresApproval===true`) — so a SENSITIVE tool node **carries its own gate**; no separate
approval node is required before it. The standalone **Approval** node is an explicit human gate
for any path. The UI never offers a control that disables mandatory approval, and the backend
remains authoritative even if the client is tampered with.

---

## 6. Node configuration panel (schema-driven)

Selecting a node opens the right panel:

- **Trigger** — trigger type (only `manual` selectable).
- **Agent** — mode from `capabilities.agentModes`; `llm_grounded` is **disabled** unless the server reports it available (`AI_WORKFLOWS_AGENT_LLM=true`); optional prompt for LLM mode.
- **Condition** — source path + operator (**only the executor's operators**: `eq, neq, gt, lt, gte, lte, contains, exists, not_exists, truthy, falsy`) + comparison value (hidden for value-less operators). No arbitrary expressions.
- **Tool / Action** — the tool identity is read-only (chosen at drop): name, risk, required permission, output. Inputs are generated from the tool's `inputSchema`; each field is a **literal** or a **`{ $from: "context.path" }`** reference.
- **Approval** — label + explanation of pause/approve/reject behavior.
- **Advanced** — raw **config JSON** (config only — never code), validated before applying.

A display name is stored as `config.label` (safe: ignored by validator/executor).

---

## 7. Save & validation lifecycle

1. Serialize canvas → definition JSON (`graphToDefinition`, incl. positions + viewport).
2. **Client structural validation** (`validateGraphStructure`, a mirror of the server) runs live for instant inline UX — errors ring the offending nodes and appear in the status bar.
3. On Save: call the **authoritative** `POST /workflows/validate`. If invalid, server error strings are mapped to nodes (`mapServerErrorsToNodes`) and **nothing is persisted**.
4. If valid: `PUT /workflows/:id` (which validates again server-side). The trigger type is derived from the trigger node.

Server validation is always the final authority. No autosave — Save is explicit. Enabled state
is never auto-toggled.

---

## 8. Run & live execution visualization

- **Run** saves first if dirty (server is the only executor), then `POST /workflows/:id/run` with the drawer's JSON trigger input.
- The run + steps are fetched via `GET /runs/:id` and **polled** (bounded: ≤20 polls @1.2s, stops on any terminal/`awaiting_approval` state). No WebSockets.
- `runToNodeStates(run, steps)` maps steps → per-node visual state: `completed / failed / awaiting_approval / rejected`, with duration. The canvas rings each node accordingly.
- If the run reaches **`awaiting_approval`**, the drawer shows it and links to **AI Studio → Approvals** (no auto-approve).
- The **execution drawer** shows run id/status/trigger/started, per-step status + duration, and expandable **server-redacted** input/output. "View full execution" deep-links to the Executions page (not duplicated).

---

## 9. Lazy loading & bundle impact

`AiStudioWorkflowEditor` is `React.lazy`-imported in `App.jsx`, and `@xyflow/react` is imported
only inside `WorkflowCanvas`. Result (measured):

- `AiStudioWorkflowEditor-*.js` ≈ **207.5 kB (63.3 kB gzip)** + **15.4 kB CSS (2.56 kB gzip)** — a **separate chunk loaded only on the editor route**.
- Verified absent from the app entry, AI Inbox, POS, storefront, and the AI Studio Overview/list chunks (`grep` of `dist/` finds `xyflow` in the editor chunk only).

---

## 10. RBAC

Route gate `settings.view`; edit/run/approve require `settings.edit` and the tool's own
permission — all enforced by the existing Phase 2 middleware and re-checked on approval. The
builder additionally hides/disables edit controls when the user lacks `settings.edit`
(convenience only; the backend is authoritative).

---

## 11. Dirty-state protection

Unsaved changes are tracked (definition incl. positions, name, enabled). A `beforeunload` guard
covers refresh/close/hard-navigation, and the in-editor "← Workflows" back button confirms before
discarding. Undo/redo (Ctrl+Z / Ctrl+Y) is a lightweight in-session history stack (no extra
dependency) covering **canvas structure** — add / move / delete / connect nodes and edges;
per-keystroke config-field edits are intentionally not history entries (they would flood the
stack and clone the graph on every character).

---

## 12. New Workflow flow

From the Workflows list: **New workflow** creates a blank (valid: trigger → end) **disabled**
workflow and opens the editor; **From template** seeds the READ-only "Product lookup" example and
opens it. New workflows always start disabled.

---

## 13. Limitations (Phase 3)

- In-SPA sidebar navigation away from the editor is not intercepted (the app uses `BrowserRouter`, not a data router, so `useBlocker` is unavailable); `beforeunload` + the guarded back button cover the primary exits.
- Single active execution path (inherited from the executor) — no parallel/fan-out authoring.
- Live run states use bounded polling, not realtime.
- Only `manual` triggers are authorable; `webhook`/`schedule` are shown disabled.
- No workflow delete/archive from the UI (no destructive prod mutations in this phase).

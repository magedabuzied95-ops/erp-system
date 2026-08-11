# AI Workflow Engine (AI Studio Phase 2)

_Backend workflow foundation + executions + approvals. No visual node editor yet (Phase 3)._
_Companion to `docs/ai-studio-audit.md` and `docs/ai-studio-architecture.md`._

The engine is a **thin deterministic orchestrator** over the ERP's existing services. It never
implements business logic itself and never lets an LLM choose which server function to run — the
declarative definition + the server-side Tool Registry are the sole source of executable capability.

---

## 1. Workflow definition schema (declarative JSONB)

Stored in `ai_workflows.definition`. No executable code is ever stored.

> **Layout fields (Phase 3).** The visual builder persists a per-node `position:{x,y}` and an
> optional top-level `viewport`. The validator only inspects `id`/`type`/`config` (and edge
> `from`/`to`/`when`), so these layout fields round-trip untouched and are **ignored by the
> executor** — they carry no execution meaning. See `docs/ai-workflow-builder.md`.

```jsonc
{
  "version": 1,
  "nodes": [ { "id": "trigger", "type": "trigger", "config": {} }, ... ],
  "edges": [ { "from": "trigger", "to": "search" },
             { "from": "cond", "to": "a", "when": "true" },
             { "from": "cond", "to": "b", "when": "false" } ]
}
```

### Node types
| type | purpose | key config |
|---|---|---|
| `trigger` | entry point (exactly one) | `triggerType` (`manual` for Phase 2) |
| `condition` | branch | `condition: { left: "<contextPath>", op, right }` — edges carry `when: "true"\|"false"` |
| `agent` | reuse existing AI (adapter) | `mode: "read_only_analysis" \| "llm_grounded"` |
| `tool` | invoke an allowlisted READ/WRITE tool | `tool: "<toolId>"`, `input: { field: literal \| { "$from": "<contextPath>" } }` |
| `action` | invoke a WRITE/SENSITIVE tool (side-effecting) | same as `tool` |
| `approval` | explicit human gate | `label` |
| `end` | terminate |  |

**Context** available to `$from` refs and conditions: `{ trigger: { input }, steps: { <nodeId>: { output \| result } } }`.

### Server-side validation (`validateWorkflowDefinition`)
Rejects: non-object definition, bad `version`, missing/duplicate/absent-trigger, unknown node types, unknown tools, invalid edges (unknown from/to, bad `when`), missing required config (condition/tool), and **unsafe config** (a SENSITIVE tool cannot set `requiresApproval:false`; a described-only tool cannot be an executable `action`).

---

## 2. Tool Registry (`aiWorkflowToolRegistry.js`)

Explicit allowlist; every tool describes `{ id, name, description, category, riskLevel, requiredPermission, inputSchema, outputDescription, requiresApproval, executable, handler }`. Handlers only orchestrate **existing** services.

| Tool | Risk | Executable | Required perm | Wraps |
|---|---|---|---|---|
| `products.search` | READ | yes | products.view | `searchAiOrderProducts` |
| `products.facts` | READ | yes | products.view | `getProductFacts` |
| `inventory.check_stock` | READ | yes | products.view | `getInventoryFacts` |
| `orders.status` | READ | yes | orders.view | `getOrderFacts` |
| `shipping.facts` | READ | yes | orders.view | `getShippingFacts` |
| `policy.facts` | READ | yes | settings.view | `getPolicyFacts` |
| `leads.create_opportunity` | WRITE | **described-only** | settings.edit | (registered; not wired in Phase 2) |
| `orders.confirm` | SENSITIVE | yes (approval-gated) | orders.edit | `confirmAiOrder` |
| `orders.update_status` | SENSITIVE | yes (approval-gated) | orders.edit | `updateAiOrderStatus` |
| `messaging.send_customer` | SENSITIVE | **described-only** | settings.edit | (registered; not wired in Phase 2) |

### Risk model
- **READ** → may auto-execute.
- **WRITE** → `requiresApproval` defaults true (configurable later).
- **SENSITIVE** → `toolRequiresApproval()` always returns true; the executor refuses to run it without an approved approval record — *regardless of any policy or config*.

---

## 3. Executor lifecycle (`aiWorkflowExecutorService.js`)

Deterministic, single active path, cycle-guarded (`MAX_STEPS`). Injectable `store` (persistence port) and `deps` (`runAgent`, `hasPermission`, optional `getTool`/`toolRequiresApproval`) → fully unit-testable without a DB.

`startRunExecution` → set run `running` → `traverse(trigger)`. Per node:
1. **trigger** → record step, advance.
2. **condition** → evaluate declaratively, record `{result}`, follow `when` edge.
3. **agent** → `deps.runAgent` (read-only summary by default), record output, advance.
4. **tool/action/approval**:
   - **RBAC first**: `deps.hasPermission(tool.requiredPermission)` — deny ⇒ step `failed`, run `failed`.
   - **Approval gate**: if the tool requires approval (or node is `approval`) and not already approved ⇒ create a pending approval, record step `awaiting_approval`, set run `awaiting_approval` + `pending_node_id`, **stop**.
   - Otherwise execute the handler; record step (input/output **redacted**), advance.
5. **end** / no outgoing edge ⇒ run `completed`.
Any thrown error ⇒ step `failed`, run `failed` (clean stop). Evolving `context` is persisted after each node so an approval can resume accurately.

`continueRunAfterApproval` → marks the approved node executable once, resumes `traverse` at that node (re-checking RBAC before running), then continues.

---

## 4. Approval lifecycle

`ai_workflow_approvals`: states `pending → approved | rejected` (plus `cancelled/expired` reserved). A record captures tenant, workflow, run, node, tool, `risk_level`, `requested_action`, redacted `request_context`, requester, and decision (`decided_by`, `decided_at`, `decision_note`).

- **Reject** ⇒ approval `rejected`, run `rejected`.
- **Approve** ⇒ **re-check the tool's `requiredPermission` for the approver** (approval never bypasses RBAC) ⇒ mark `approved` ⇒ resume the run and execute the pending node exactly once.
- Deciding a non-pending approval returns `409`. Unique `(run_id, node_id)` prevents duplicate approvals per step.

---

## 5. Existing reply policy integration

`getAiReplyMode()` surfaces the existing `ai_channels.ai_reply_mode` (`off / suggest_only / auto_reply_after_approval / fully_automatic`) for observability. The engine does **not** create a competing policy. **SENSITIVE ERP actions always require human approval regardless of `fully_automatic`.**

---

## 6. Trigger architecture

Phase 2 supports **`manual`** only (via `POST /workflows/:id/run`). The definition carries `triggerType` and the run records its `trigger`, so future adapters (existing webhooks, follow-up tasks) can create runs without changing the executor. **Production Meta/WhatsApp/Instagram webhooks are NOT rerouted through the executor.** No Redis/Bull/cron added — reuses existing infra patterns.

---

## 7. API (mounted at `/api/ai-studio`, `protect` + `permit`)

| Method | Path | Permission |
|---|---|---|
| GET | `/tools` | settings.view |

`GET /tools` also returns `capabilities` — `agentModes` (with `read_only_analysis` always
available and `llm_grounded` gated by `AI_WORKFLOWS_AGENT_LLM`) and `triggerTypes` (`manual`
available; `webhook`/`schedule` marked unavailable) — so the visual builder renders an accurate,
non-fake palette. Read-only/additive.

| Method | Path | Permission |
|---|---|---|
| GET | `/overview` | settings.view |
| GET | `/workflows` · `/workflows/:id` | settings.view |
| POST | `/workflows` · `/workflows/:id` (PUT) · `/workflows/:id/enable` · `/workflows/seed-example` | settings.edit |
| POST | `/workflows/validate` | settings.view |
| POST | `/workflows/:id/run` | settings.edit |
| GET | `/runs` · `/runs/:id` | settings.view |
| GET | `/approvals` | settings.view |
| POST | `/approvals/:id/approve` · `/approvals/:id/reject` | settings.edit |

Tenant isolation via `getTenantId(req)`; every query is tenant-scoped.

---

## 8. Security guarantees

- Only allowlisted, registered tools are executable; the LLM cannot select arbitrary server functions.
- Per-tool RBAC is enforced by the executor **and** re-checked on approval (reusing the real `permit` middleware).
- SENSITIVE tools can never auto-execute — human approval is mandatory.
- Step input/output and approval context are **secret-redacted** (`redactSecrets`) before persistence.
- Tenant boundaries enforced on every run/step/approval query.
- Idempotency: optional `idempotency_key` uniquely per `(tenant, workflow, key)` prevents duplicate runs; approvals are single-decision.

---

## 9. Current limitations

- Manual trigger only; no webhook/scheduled trigger adapters wired yet.
- No visual builder — definitions are created/edited via API or the seed example.
- Single active execution path (no parallel/fan-out nodes).
- `agent` LLM mode is disabled unless `AI_WORKFLOWS_AGENT_LLM=true`.
- `leads.create_opportunity` and `messaging.send_customer` are registered but described-only (not wired).
- No aggregated latency dashboards beyond per-step `duration_ms`.

---

## 10. Seed / proof workflow

`seedExampleWorkflow(tenantId)` creates **"Example: Product lookup (read-only)"** (disabled, current tenant only): `manual trigger → products.search → condition(results>0) → read-only agent analysis → end`. Uses only READ capabilities and real ERP data; not auto-enabled for any tenant.

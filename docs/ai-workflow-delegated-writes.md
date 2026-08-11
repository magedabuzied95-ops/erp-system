# AI Workflow Delegated Writes (AI Studio Phase 5)

_Automatic workflows may now perform ONE vetted, low-risk internal WRITE — creating an internal
follow-up task — but only under an explicit per-workflow admin **grant**. Automatic workflows are
NEVER background superusers. Companion to `docs/ai-workflow-triggers.md`._

```
Workflow → Delegated Grants → Tool Registry → Required Permission → Risk Policy → Execute / Deny / Approval
```

---

## 1. Automatic-execution policy (Tool Registry, server-authoritative)

Every tool carries an `automaticExecution` policy (`toolAutomaticPolicy`, derived + per-tool override):

| policy | meaning | tools |
|---|---|---|
| `AUTO` | READ; automatic runs may execute freely | products.search, products.facts, inventory.check_stock, orders.status, shipping.facts, policy.facts |
| `DELEGATABLE` | low-risk WRITE; automatic execution ONLY with an admin grant | **followups.create** |
| `APPROVAL_REQUIRED` | SENSITIVE; never delegated, always human approval | orders.confirm, orders.update_status, messaging.send_customer |
| `DENIED` | not runnable automatically (e.g. described-only WRITE) | leads.create_opportunity |

`automaticDecision(toolId, hasActiveGrant)` is the pure decision: AUTO→allow; DELEGATABLE→allow iff
granted; **APPROVAL_REQUIRED→deny even if a grant is somehow present**; DENIED→deny. A grant can only
ever be *created* for a `DELEGATABLE` tool (`isDelegatableTool`), so SENSITIVE can never be granted.

---

## 2. First executable WRITE — `followups.create`

Wraps the canonical `createStaffTask(payload, actor)` with `allow_unassigned:true`. With no assignee
the staff-task service skips employee notification, so the only effects are an **internal** task row +
an internal realtime event + an `audit_logs` row. **No customer message, no order/stock/accounting/
permission change.** Inputs: `title` (required), `note`, `priority`.

---

## 3. Delegated actor (replaces Phase 4's blanket READ-only actor)

Automatic runs use `buildDelegatedDeps({tenantId, workflow})`:
- `authorizeTool({tool})` — resolves the active grant only for delegatable tools, then returns the
  pure `automaticDecision`. READ auto-allowed; DELEGATABLE allowed iff an active grant exists;
  SENSITIVE/DENIED refused (a refused SENSITIVE tool fails safely **before** the approval gate — it
  can never bypass approval). No granting user's session/JWT is impersonated or persisted.
- `reserveWriteOp(...)` — write-op idempotency (see §5).
- `onWriteExecuted(...)` — writes the automatic-write audit row.

Manual runs are unchanged: they use the authenticated user's real RBAC (`deps.hasPermission`). Manual
and automatic authorization are distinct code paths.

---

## 4. Grants — lifecycle & schema

`ai_workflow_grants(id, tenant_id, workflow_id, tool_id, granted_by, granted_at, revoked_by,
revoked_at, metadata)`; unique **active** grant per `(tenant, workflow, tool)` (`revoked_at IS NULL`).

- **Create** (`grantTool`): tool must be DELEGATABLE; workflow must belong to the tenant; the granter
  must hold `settings.edit` (route) **and** the tool's own `requiredPermission` (re-checked via the
  real `permit` middleware). Writes an `ai_workflow.grant` audit row.
- **Revoke** (`revokeGrant`): soft revoke (`revoked_at/by`); takes effect immediately for the next
  execution (authorization is evaluated at run time, not authoring time). `ai_workflow.revoke` audit.
- Archived/disabled workflows keep grant history but cannot execute (no run is created).

APIs (`protect` + `permit`, tenant-scoped): `GET /delegatable-tools`, `GET /workflows/:id/grants`,
`POST /workflows/:id/grants {toolId}`, `DELETE /workflows/:id/grants/:toolId`.

---

## 5. Write-operation idempotency

`ai_workflow_write_ops(tenant_id, run_id, node_id, idempotency_key UNIQUE)`. Before a side-effecting
(non-READ) handler runs, the executor reserves a row keyed `<runId>:<nodeId>` via
`reserveWriteOp`. A fresh reservation → execute; an existing one → **skip** the handler (idempotent).
This is in addition to run-level idempotency (one run per event), so resume/retry never duplicates the
task. DB-enforced, not in-memory.

---

## 6. Audit trail ("why was this automated write allowed?")

Each automatic WRITE writes an `audit_logs` row (`ai_workflow.auto_write`) with workflow, run, node,
tool, grant id, event id, and the created task id. Grants/revokes write their own audit rows.
Executions distinguishes READ / delegated-WRITE / SENSITIVE steps by `risk_level`.

---

## 7. SENSITIVE protection (unchanged, reinforced)

A grant can never target SENSITIVE (rejected at creation) and `automaticDecision` denies SENSITIVE
even if a grant is present. Even with grant + tenant automation + global automation + `fully_automatic`
reply mode, SENSITIVE tools still require the existing human approval — or, for an automatic run, fail
safely without executing.

---

## 8. Restock coverage (Phase 5 completion)

`inventory.restocked` now also emits from **purchase receiving** (post-COMMIT, failure-isolated):
- purchase create with received stock (`batchApplyVariantPurchaseStock` → per-variant `stockRows`),
- the "receive stock" endpoint (`adjustVariantStock` per line).

Each variant that crosses `quantityBefore<=0 && quantityAfter>0` emits a **distinct idempotent** event
(`inv:<movementId>`); non-crossing increases emit nothing. The purchase always succeeds first and never
depends on workflow success. **Uncovered (documented):** the simple-product fallback
(`updateProductFallbackStock` returns no before/after) and the `purchase_adjustment` alt path — both
can adopt the same `notifyInventoryRestock` helper later.

---

## 9. Tenant timezone & schedule slots

Per-tenant IANA timezone (`ai_workflow_tenant_settings.timezone`), resolved **tenant → env
APP_TIMEZONE/TZ → Africa/Cairo**. Only IANA names accepted (`isValidTimezone`; raw offsets like
`+03:00` rejected because DST rules change). Schedule slots (`computeScheduleSlot`) are computed in the
tenant timezone via native `Intl` (no date library), DST-safe: hourly → tz-local hour; daily → due once
the tz-local time passes the target, slot id stable per tz-local day. Idempotency unchanged
(`schedule:<wf>:<slotId>`), so a restart never double-runs a slot.

---

## 10. Limitations

- Exactly one delegatable WRITE tool (`followups.create`); other writes remain DENIED/described-only.
- Simple-product + `purchase_adjustment` restock paths uncovered (documented above).
- Schedules: hourly/daily only; per-tenant IANA tz.
- The granter permission check keys on the tool's `requiredPermission` (`settings.edit` for
  `followups.create`); finer per-tool permissions can be added later.

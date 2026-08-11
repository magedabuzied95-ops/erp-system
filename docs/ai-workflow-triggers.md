# AI Workflow Triggers — Event-Driven Automation (AI Studio Phase 4)

_Move from `Manual Run → Executor` to `ERP Event → Trigger Adapter → Workflow Run → existing
Executor`, without replacing business logic or rerouting production messaging. Companion to
`docs/ai-workflow-engine.md` and `docs/ai-workflow-builder.md`._

```
ERP operation succeeds (COMMIT)
        ↓  (post-commit, failure-isolated)
Trigger Adapter (aiWorkflowTriggerService)
        ↓  global flag AND tenant flag AND enabled AND not-archived AND config matches
Idempotent run (existing ai_workflow_runs unique key)
        ↓
existing aiWorkflowExecutorService → Tool Registry → ERP services
```

The ERP operation always happens **first** and succeeds independently. Automation reacts **after**
and can never roll it back.

---

## 1. Trigger Registry (`aiWorkflowTriggerRegistry.js`)

An explicit server-side allowlist — the event-side counterpart to the Tool Registry. The frontend
consumes it dynamically (`GET /api/ai-studio/triggers`); the browser never decides availability.

| id | category | riskLevel | available when | config schema | status |
|---|---|---|---|---|---|
| `manual` | MANUAL | READ | always | — | live |
| `followup.due` | ERP_EVENT | READ | global automation on | `followupType?` | live |
| `inventory.restocked` | ERP_EVENT | READ | global automation on | `productId?`, `variantId?` | live |
| `schedule.interval` | SCHEDULE | READ | global automation on | `frequency` (hourly\|daily), `time?` | live |
| `channel.message_received` | CHANNEL | SENSITIVE | **never** | — | **coming later (contract only, no emitter)** |

`available` is env-gated (`AI_WORKFLOWS_AUTOMATION_ENABLED`). `isAuthorableTrigger` (used by the
server validator) allows saving any trigger except CHANNEL, so a definition can never serialize an
unsupported channel trigger. Matching is a pure server-side function per trigger.

---

## 2. Event envelope

`emitWorkflowEvent({ tenantId, triggerType, eventId, occurredAt, payload })`. The payload is
**sanitized** (`redactSecrets` + explicit drop of `headers/authorization/signature/raw/webhookSecret`)
before it ever touches a run. Sanitized event data is placed at `context.trigger.input`, so
downstream nodes reference it with the **existing `$from`** syntax (e.g. `trigger.input.productId`) —
no second data-reference syntax. `context.trigger.event` carries `{ id, type, occurredAt, source }`.

---

## 3. Idempotency / duplicate protection

Reuses the existing unique index `uq_ai_workflow_runs_idem (tenant_id, workflow_id, idempotency_key)`.
The adapter's run insert is `INSERT … ON CONFLICT … DO NOTHING RETURNING *`:

- event key: `evt:<triggerType>:<eventId>` (e.g. `evt:inventory.restocked:inv:42`)
- schedule slot key: `evt:schedule.interval:schedule:<workflowId>:<slotId>`

A fresh INSERT returns a row → the run executes. A conflict returns **no row** → it is a duplicate
and is **not** re-executed. This is DB-enforced, so it survives backend restarts and concurrent
emits (no in-memory-only locks). The same event fans out to **different** matching workflows as
distinct rows (different `workflow_id`).

---

## 4. Kill switches (all required for an automatic run)

1. **Global** — env `AI_WORKFLOWS_AUTOMATION_ENABLED` (default **false**). Controls automatic runs
   only; **manual runs always work** regardless. Changing it needs a redeploy.
2. **Tenant** — `ai_workflow_tenant_settings.automation_enabled` (default **OFF**; existing tenants
   are never auto-enabled). Toggled from the Workflows page (`POST /automation/tenant`).
3. **Workflow** — `enabled = TRUE` (new workflows start disabled).
4. **Not archived** — `archived_at IS NULL`.
5. **Trigger match** — the trigger node's config must match the event (server-side).

`GET /automation/status` returns `{ active, global_enabled, tenant_enabled, active_auto_workflows,
reasons[] }` so the UI can explain exactly why automation is or isn't live.

---

## 5. Execution actor / security model

Automatic runs have **no logged-in user and no superuser**. They use a READ-only system actor
(`AUTOMATIC_READ_PERMISSIONS = products.view, orders.view, settings.view, inventory.view`). The
executor's RBAC check runs first; a WRITE/SENSITIVE tool's permission is **denied**, so an automatic
run that reaches such a node **fails safely at RBAC and can never execute it**. Therefore SENSITIVE
actions can never be auto-run, and no automatic customer message / order change / refund is possible
in this phase. **WRITE authorization for automatic runs is deferred to Phase 5** (needs a proper
delegated-actor model). All existing guarantees are preserved: tenant isolation, Tool Registry
allowlist, SENSITIVE approval, secret redaction, server validation.

---

## 6. Triggers & ERP hooks

- **inventory.restocked** — emitted **post-commit** from the canonical stock mutation (manual
  adjustment: `inventoryController.updateStock`) via `notifyInventoryRestock({ tenantId, movement })`,
  which fires **only** on a real crossing `quantityBefore <= 0 && quantityAfter > 0` using the ledger's
  own before/after (no re-query, no duplicated stock logic). The helper is failure-isolated and is a
  drop-in for the other canonical restock paths (purchase receiving, returns) — same one-line call.
- **followup.due** — the ERP has **no follow-up worker**; "due" is a time-derived read-only condition
  (`status IN (pending,snoozed) AND scheduled_at <= NOW()`). The automation tick observes newly-due
  follow-ups (bounded to *since the last tick*, idempotent per follow-up) and emits — it **never sends
  or mutates** a follow-up (it is not a follow-up scheduler).
- **schedule.interval** — the automation tick computes each schedule workflow's due slot
  (`computeScheduleSlot`) and emits with a deterministic slot id. Frequencies are bounded to **hourly
  / daily-at-time** (no arbitrary cron). Times use **server local time** (documented limitation — no
  authoritative per-tenant timezone was available to reuse).

---

## 7. Scheduler / execution mode

One `setInterval` (60s) registered in `server.js` via the existing `backgroundIntervals` convention —
**no Redis/Bull/BullMQ/node-cron added**. `runAutomationTick()` is a no-op unless global automation is
on; it iterates only tenants with automation enabled, and each tenant/workflow error is caught so it
never affects others or any ERP request. Event-hook emits are fire-and-forget (`void … .catch()`).

**Failure isolation:** a workflow failure never rolls back or breaks the ERP operation that emitted
the event — the emit is post-commit and wrapped in try/catch at every layer.

---

## 8. Archive / soft-delete

`ai_workflows.archived_at / archived_by` (never hard-delete). Archived workflows never auto-run, are
hidden from the default list (`?includeArchived=1` to show), stay in Executions history, and keep
their audit trail. `POST /workflows/:id/archive` (with confirm) / `/unarchive`. An unarchived workflow
returns **disabled**.

---

## 9. Observability / audit

Every automatic run records `trigger` (source), `event_id`, `idempotency_key`, and the sanitized
event under `context.trigger`, answering "why did this run?". Executions shows the trigger source +
event id + automatic/manual. Overview exposes `automatic_runs_today[/_succeeded/_failed]` and
`automation` status cheaply (bounded query).

---

## 10. Channel preparation only

`channel.message_received` is registered as a **prepared contract**: never available, never
authorable, no emitter. **This phase does not reroute WhatsApp / Messenger / Instagram** — existing
channel processing is untouched.

---

## 11. API

| Method | Path | Perm |
|---|---|---|
| GET | `/triggers` | settings.view |
| GET | `/automation/status` · `/automation/tenant` | settings.view |
| POST | `/automation/tenant` | settings.edit |
| POST | `/workflows/:id/archive` · `/unarchive` | settings.edit |
| GET | `/workflows?includeArchived=1` | settings.view |

---

## 12. Limitations

- Automatic runs are **READ-only** (WRITE deferred to Phase 5).
- `inventory.restocked` is wired at the manual-adjustment path; purchase-receiving/returns are
  documented drop-in points (same helper) not yet wired.
- Schedules: hourly/daily only, **server local time**.
- `followup.due` observes the time-derived due condition (bounded window + idempotency), since no
  follow-up worker exists to hook.
- Global switch is an env flag (redeploy to change).
- No channel triggers; no autonomous customer messaging/order changes.

# AI Restock Customer Recovery (AI Studio Phase 6)

_First real business automation on AI Studio: when a product comes back in stock, find customers
who asked to be notified and create **internal** employee sales follow-ups. **No customer message is
ever sent automatically**, no order/stock/accounting change. Builds on Phases 4–5._

```
inventory.restocked → check stock → find waiting customers → condition → analysis → create INTERNAL follow-ups → end
```

---

## 1. Existing "notify me" architecture (audited)

There is **no true restock waiting-list** in the ERP/storefront. The only persisted "customer wants
this product" signal is **`customer_wishlist`** (`storefrontController.saveWishlist`), columns:
`tenant_id, customer_id (nullable), phone (the real key), product_id, notify_back_in_stock bool
DEFAULT true, notify_price_drop, created_at`; UNIQUE `(tenant_id, phone, product_id)`.

Critically: it is **product-level** (no variant/size/color), has **no status/notified column**, and
**nothing currently reads `notify_back_in_stock` or notifies customers** — the storefront "Back in
stock alert" text is unimplemented copy. So there is **no sender to collide with**, and matching is
necessarily **product-granular**.

- **Secondary/overlap (not used as source):** `sales_opportunities` (variant+size+color+stock but no
  customer), `ai_followup_tasks` (conversation follow-ups, product only in free-form payload),
  `ai_channel_conversations.lead_status`.
- **Not merged, not migrated** — Phase 6 reads `customer_wishlist` and writes only its own ledger +
  internal staff tasks.

## 2. Canonical source

**`customer_wishlist`**, filtered by `COALESCE(notify_back_in_stock, TRUE) = TRUE`. It is the only
table tying a customer identity to a wanted product.

## 3. Matching (`findWaitingCustomersForRestock`)

Restocked variant → `product_variants.product_id` → `customer_wishlist.product_id` (product
granularity — the wishlist can't say a customer wanted a specific size). Tenant-scoped, ordered by
`created_at ASC`, **bounded** (default 25, hard max 100) returning `{matchedCount, returnedCount,
hasMore}`. A wishlist entry is an explicit notify-me opt-in — not "merely viewed."

## 4. Eligibility

Per candidate, before creating a follow-up: the restocked product must have **sellable stock now**
(re-checked via `getInventoryFacts`), the `(event, request)` pair must be new, and the same
`(product, phone)` must not have a `followup_created` recovery within **14 days** (anti-spam across
close-together restocks). A genuinely later restock after the window is eligible again.

## 5. Prioritization (deterministic, explainable — no fake AI score)

`scoreCandidate`: registered customer **+20**, requested within 7d **+15** (or ≤30d **+5**), opted
into back-in-stock **+10**; ties broken by oldest request first. These are the only signals the
wishlist actually provides; richer factors (variant/size match, tier, purchase history) are not
available at source and are documented as future work. AI analysis (`read_only_analysis` agent) may
add a short internal note but invents no facts and is never a dependency.

## 6. Follow-up content (`formatRecoveryTask`)

Employee-readable, no raw ids/JSON, e.g. _"Ahmed asked to be notified when 'Nike Air Max White 44'
came back in stock. It is back in stock (6 available). Requested on 8/8/2026. Priority: 45 (…).
Suggested next action: contact the customer to confirm interest. (No message was sent
automatically.)"_ Phones are masked (`01****567`). Created via `createStaffTask` unassigned (no
external notification). **Assignment:** unassigned (no reliable canonical sales-owner rule was found;
no new routing engine added).

## 7. Fan-out & the recovery WRITE tool

The executor is single-path, so per-customer node fan-out is **not** faked. Instead a bounded
server-side WRITE tool **`restock.recover`** (DELEGATABLE) processes bounded candidates internally
under the Phase 5 delegated-actor model — one internal follow-up per eligible candidate. A separate
READ tool **`restock.waiting_customers`** surfaces masked candidates for the condition/observability.

## 8. Deduplication (four layers)

1. **Event** idempotency (`evt:inventory.restocked:inv:<movementId>`).
2. **Run** idempotency (one run per event).
3. **Write-op** idempotency (`restock.recover` runs once per run+node).
4. **Business** dedup — `ai_restock_recoveries` UNIQUE `(tenant, restock_event_id, request_id)` + the
   14-day `(product, phone)` cooldown. Replaying the same restock creates no duplicate follow-up;
   `0→5→3→7` only the initial `<=0→>0` crossing qualifies; a later `7→0→4` is a new eligible event.

## 9. Grant requirement

`restock.recover` is DELEGATABLE — an automatic recovery run **denies safely** at the write unless an
admin has granted `restock.recover` to the workflow. Revoking blocks future automatic writes
immediately. SENSITIVE tools remain non-delegatable; no messaging tool is executable.

## 10. Recovery audit (`ai_restock_recoveries`)

Every candidate records: tenant, restock_event_id, request_id, customer_id, phone (masked in reads),
product/variant, `status` (`candidate | followup_created | skipped_duplicate | skipped_no_stock |
failed`), followup_task_id, priority, reason, created_at. Answers "why was this customer selected,
which request/event, what priority, was a follow-up created or skipped and why." **Creating an
employee follow-up never marks the customer's notify-me request as "notified"** — that distinction is
preserved (no customer was contacted).

## 11. Workflow template & UI

`seedRestockRecoveryWorkflow` seeds a **disabled** "Restock Customer Recovery" workflow (current
tenant only). Automatic recovery requires: workflow enabled **AND** global automation **AND** tenant
automation **AND** a `restock.recover` grant. AI Studio → **Restock Recovery**
(`/ai-studio/restock-recovery`) shows real counts + a recovery table and an explicit "why inactive"
panel (never a misleading "Active").

## 12. Production proof (bounded, then dormant-safe)

Deployed dormant-safe (global OFF). A controlled synthetic `inventory.restocked` emit (admin-only
`docker exec`, no public endpoint, no stock mutation) against a TEST wishlist entry proved: no
grant → write denied, no follow-up; grant → exactly one internal recovery follow-up (readable,
masked); replay → no duplicate run/task/recovery; revoke → denied again. Cleanup restored
dormant-safe and removed test artifacts via the app.

## 13. Limitations & future

- Matching is **product-level** (wishlist has no variant/size). Variant/size fidelity, customer tier,
  and purchase-history scoring need a richer waiting-list or a customer-facts service — future work.
- Guests are effectively unsupported at source (wishlist write is auth-gated).
- **Customer messaging remains a separate future phase** — Phase 6 stops at internal employee tasks.

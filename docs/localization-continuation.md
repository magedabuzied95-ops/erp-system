# Localization continuation — producer handoff

Post-Release-002 continuation. Records what is closed, what is deliberately held,
and exactly where the next session picks up.

Regenerate every number here with:

```bash
node scripts/i18n-bidirectional.mjs   # raw broken chrome, both directions
node scripts/i18n-nonreserved.mjs     # the closure target vs what is reserved
node scripts/i18n-hits.mjs <path>     # per-hit detail for one file
```

---

## Session 3 (this one)

| Field | Value |
| --- | --- |
| Started from | `c4424743` (`origin/main`, Release 002 recorded) |
| Branch | `feat/i18n-closure-2`, dedicated worktree |
| Tip | see `git log feat/i18n-closure-2` |
| Deployed | **no** — producer task, nothing pushed |

### Units closed

| Unit | Before (AR/EN) | After |
| --- | --- | --- |
| `AiSupportKnowledgeBase.jsx` | 32 / 0 | 0 / 0 |
| `purchases/SupplierStatement.jsx` | 7 / 0 | 0 / 0 |
| `purchases/PurchaseOrder.jsx` | 16 / 4 | 0 / 0 |

### Non-reserved safely-fixable

| | AR→EN | EN→AR |
| --- | --- | --- |
| Start of session | 160 | 125 |
| After receipt-artwork reclassification | 132 | 125 |
| End of session | **109** | **121** |

Nothing is hidden: `GRAND TOTAL 1207 = non-reserved 230 + reserved 949 +
receipt artwork 28`, and 1207 + the 27 hits closed this session = the 1234 the
bidirectional report showed at `c4424743`.

---

## Why the raw total and the closure target differ

`scripts/i18n-bidirectional.mjs` reports 467 AR→EN and 739 EN→AR. Most of that is
correctly classified and **out of scope for the localization producer**:

| Bucket | AR | EN | Why it is held |
| --- | --- | --- | --- |
| H. AI Inbox reserved | 288 | 352 | Hard freeze. Chrome, customer messages and model output share a screen. |
| I. Inbox-sensitive shared | 13 | 228 | Rendered by the Inbox *and* elsewhere; proven by import, not by directory. |
| J. Product Form hold | 31 | 27 | Visually frozen for the post-closure visual program. |
| E. print/export artwork | 2 | 7 | Barcode / label artwork. |
| E. rendered receipt artwork | 28 | 0 | `ReceiptPreview` + `ThermalReceiptFinal` inside `pos/components/CartSidebar.jsx`. |
| K. product decision | 1 | 0 | `EmployeePayrollPortal` is deliberately Arabic-only. |

`scripts/i18n-nonreserved.mjs` is the authority on which side a file falls, and
each reserved entry carries its reason inline.

### Ownership decisions worth keeping

- `src/shared/chat/*` is the **Employee and Manager portal chat**, never the AI
  Inbox — its only importers are `UnifiedEmployeeChatInbox` and `ManagerPortal`.
  It is NOT reserved; it is the largest remaining open unit.
- `CrocsSizeSelector` is rendered only by `CreateProduct` and `ProductEdit`, so it
  moves with the Product Form freeze rather than with the products module.
- `AILiveLogs` is imported by `AiInbox.jsx`, so it is Inbox-reserved despite
  living under `src/components/ai/`.

---

## Next unit

**`src/shared/chat/` — 28 AR across two files.** Do both together; they are one
surface and `employeePortal.chat.*` already carries most of the vocabulary
(including `confirmDeleteForAll`, which `SharedPortalChat.jsx:501` still
hardcodes). Neither file calls `useTranslation()` yet.

| File | AR | EN |
| --- | --- | --- |
| `SharedPortalChat.jsx` | 14 | 0 |
| `PortalChatContactInfo.jsx` | 14 | 0 |

Then, in descending size: `products/ProductsList.jsx` (17 AR),
`coupons/CouponsManager.jsx` (12 AR), `warehouse/WarehouseLivePicks.jsx` (12 AR),
`dashboard/CommandCenterDashboard.jsx` (11 EN),
`website/WebsiteSettings.jsx` (11 EN).

---

## Two scanner blind spots found this session

Both are recorded rather than fixed, because changing the scanner moves every
baseline at once and should be its own checkpoint.

1. **Multi-line JSX text is not counted.** `JSX_TEXT_RE` needs `>text<` on one
   line, so a label on its own line between two elements is invisible to the
   metric. `SupplierStatement.jsx` had three such strings next to the seven that
   were reported. The counts are therefore a floor, not a ceiling.

2. **Asymmetric bilingual halves read as correct.** `bilingualHalfRanges` accepts
   an `isArabic ? {…} : {…}` pair without checking the halves carry the same
   keys. `PurchaseOrder.jsx` defined `labels.article` in the English half of both
   purchase-quantity tables and in neither Arabic half, so Arabic mode rendered
   the `|| "Article"` fallback — a real leak, invisible to the metric. Fixed in
   the source and guarded by `tests/purchase-qty-modal-prices.test.js`.

---

## Product-decision debt — current truth on `c4424743`

Both historical decisions are **still present**. Neither was changed.

| Decision | Evidence |
| --- | --- |
| Employee Payroll Portal pinned to Arabic | `EmployeePayrollPortal.jsx:1424` — `const language = "ar";` |
| Orders payment summary pinned to Arabic | `OrdersDashboard.jsx:1438` and `:1534` — `getPaymentSummary(order, "ar")` |

---

## The ratchet

`tests/fixtures/i18n-hardcoded-baseline.json` is regenerated after every closed
unit (`node scripts/i18n-audit.mjs --write-baseline`). One regeneration this
session also absorbed drift that arrived from `main`, not from localization
work: `AiInbox.jsx` +1 English, `TranscriptMessage.jsx` +2 Arabic, and a new
`AppleEmojiPicker.jsx` string. All three are under the AI Inbox freeze, so they
could not be fixed here; they remain counted in the reserved bucket.

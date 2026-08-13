# Localization — non-reserved closure

Post-Release-002 continuation. **The non-reserved safely-fixable gate is 0/0.**

Regenerate every number here with:

```bash
node scripts/i18n-nonreserved.mjs     # the closure gate: reserved vs non-reserved
node scripts/i18n-bidirectional.mjs   # raw broken chrome, both directions
node scripts/i18n-hits.mjs <path>     # per-hit detail for one file
```

---

## Result

| | AR→EN | EN→AR |
| --- | --- | --- |
| Non-reserved at `c4424743` | 160 | 125 |
| **Non-reserved now** | **0** | **0** |

```
GRAND TOTAL 1038 = non-reserved 0 + reserved 1010 + receipt artwork 28
```

Nothing is hidden. Every remaining hit sits in a bucket with a stated reason, and
the classification is code in `scripts/i18n-nonreserved.mjs`, not prose.

| Bucket | AR | EN | Why it is held |
| --- | --- | --- | --- |
| H. AI Inbox reserved | 288 | 352 | Hard freeze. Chrome, customer messages and model output share a screen. |
| I. Inbox-sensitive shared | 13 | 228 | Rendered by the Inbox *and* elsewhere; proven by import, not by directory. |
| J. Product Form hold | 31 | 27 | Visually frozen for the post-closure visual program. |
| C. catalogue / unrendered config | 2 | 14 | Values matched against records, or config no JSX reads. |
| E. print / receipt artwork | 2 | 7 (+28) | Barcode and label artwork; `ReceiptPreview` + `ThermalReceiptFinal`. |
| G. dead / unreachable | 7 | 30 | 11 files with no import anywhere under `src/`. |
| D. generated / outbound content | 2 | 7 | Reel captions, audio-track names, AI playground and test payloads. |
| F. serialized workflow data | 0 | 1 | Default node data written into a saved workflow graph. |
| K. product decision | 1 | 0 | `EmployeePayrollPortal` is deliberately Arabic-only. |

---

## Units closed in this program

| Unit | Before (AR/EN) |
| --- | --- |
| `AiSupportKnowledgeBase.jsx` | 32 / 0 |
| `purchases/SupplierStatement.jsx` | 7 / 0 |
| `purchases/PurchaseOrder.jsx` | 16 / 4 |
| `shared/chat/*` + Employee inbox | 28 / 0 |
| Products list surface | 18 / 2 |
| Coupons export + Warehouse live picks | 24 / 0 |
| Sales (routed pages) | 13 / 14 |
| Dashboard / Command Center / activity | 0 / 36 |
| Notifications bell + Center | 13 / 1 |
| M1UI, crash boundary, mobile sheet | 7 / 4 |
| WebsiteSettings, Login, MainLayout, PublicProduct | 3 / 16 |

---

## The raw/display splits that mattered

These are the changes where translating in place would have broken behaviour, not
just copy. Each is guarded by a test.

1. **`SharedPortalChat`** focused the message-search box with
   `document.querySelector('input[placeholder="بحث"]')` — a DOM lookup keyed on a
   RENDERED label. Now a ref.
2. **`NotificationBell`** returned "اليوم"/"الأمس"/"الأقدم" from `dayGroup()` and
   used those same strings as the grouping object's keys and as `groupOrder`.
   Localizing the label would have emptied every group. Ids now.
3. **`WarehouseLivePicks`** stored the Arabic literal "غير محدد" as an alert's
   colour, and `alertKey()` merges on `productId|color|size`. A localized
   fallback would have split the merge bucket by language. Stored raw, resolved
   at render.
4. **`CommandCenterDashboard`** keyed nine KPI cards on `key={kpi.label}`.
   Translating the label would remount every card on a language switch. Stable
   `id` now.
5. **`WebsiteSettings`** keyed its Overview cards on `card.title`. Same fix.
6. **`ACTIVITY_FILTERS`** / **`activityFeedConfig`**: `id` is both the filter
   value and the React key and stays raw; only a `labelKey` was added.
7. **`PurchaseOrder`**'s `labels.article` existed in the ENGLISH half of both
   purchase-quantity tables and neither Arabic half, so Arabic fell through to
   `|| "Article"`. The per-hit bilingual detector cannot see an asymmetric pair.

Deliberately left raw: `toLocaleLowerCase("ar")` in the portal-chat search
filters (matching behaviour), the `"غير مصنف"` comparison list in ProductsList's
`isCategorized()`, and `status: "Pending"` in the CreateOrder payload.

---

## AI Inbox dedicated closure — live resume marker

The former AI Inbox freeze is now being retired owner-by-owner, with every
checkpoint deployed and verified in both AR/RTL and EN/LTR before the next owner.

| Owner | Surface | State |
| ---: | --- | --- |
| 1 | `AiInbox.jsx` | COMPLETE (`dfccaa7`) |
| 2 | `TranscriptMessage.jsx` | COMPLETE (`65a1c02`) |
| 3 | `ProductCardPicker.jsx` | COMPLETE (`3cbf3ab`); scanner 37 → 0; AR/RTL + EN/LTR runtime verified |
| 4 | `ProductCardMessage.jsx` | COMPLETE in the current checkpoint; scanner 5 → 0 |

**RESUME MARKER:** owner 5 — `PwaOrderComposer.jsx`. Do not restart owners 1–4.
The final zero gate still requires a deployed bidirectional runtime sweep and a
separate multi-line JSX check, because the legacy scanner only counts same-line
JSX text.

---

## Two scanner blind spots

Recorded, deliberately not fixed — either change moves every baseline at once and
deserves its own checkpoint.

1. **Multi-line JSX text is not counted.** `JSX_TEXT_RE` needs `>text<` on one
   line, so a label on its own line between two elements is invisible. The
   counts are a floor, not a ceiling; several units had more real strings than
   the metric reported, and all of them were migrated anyway.
2. **Asymmetric bilingual halves read as correct.** `bilingualHalfRanges` accepts
   an `isArabic ? {…} : {…}` pair without checking the halves carry the same
   keys — see the `labels.article` leak above.

---

## Product-decision debt — current truth

Both historical decisions are **still present** and were not changed.

| Decision | Evidence |
| --- | --- |
| Employee Payroll Portal pinned to Arabic | `EmployeePayrollPortal.jsx:1424` — `const language = "ar";` |
| Orders payment summary pinned to Arabic | `OrdersDashboard.jsx:1438` and `:1534` — `getPaymentSummary(order, "ar")` |

---

## Runtime wiring

One manifest branch was added this program: `notifications`. It reads the
**already-wired** `common` bundle via `pick`, exactly like `sidebar` / `language`
/ `appearance`, so no new `i18n.js` import or runtime-map entry is involved and
the Release-001 wiring incident cannot recur. Verified by build + bundle probe:
68 pairs probed, 66 reachable, 0 unreachable (the 2 skipped are the documented
empty `auth` bundle in both locales).

---

## The ratchet

`tests/fixtures/i18n-hardcoded-baseline.json` is regenerated after every closed
unit (`node scripts/i18n-audit.mjs --write-baseline`). It went 2516 → 2318 over
this program. One regeneration also absorbed drift that arrived from `main`, not
from localization: `AiInbox.jsx` +1 English, `TranscriptMessage.jsx` +2 Arabic,
and a new `AppleEmojiPicker.jsx` string — all under the AI Inbox freeze, so they
could not be fixed here and remain counted in the reserved bucket.

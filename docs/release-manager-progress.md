# Release Manager — Continuous Safe Release Ledger

Append-only record of every release candidate the Release Manager has evaluated.
Its purpose is to make releases **resumable** and to guarantee no checkpoint is
ever deployed twice.

Rules this ledger enforces:

- a candidate is recorded even when it is **rejected or rolled back** — the reason matters
- `main` always wins on concurrent product work; localization owns dictionaries
  and `t()`/`tt()` wiring only
- push **main only** (Vercel deduplicates a SHA already seen on a feature branch,
  which silently starves Production)
- every release records the exact Production SHA it replaced, as a rollback ref
- verify Production by **ancestry + served-bundle content**, never by HTTP 200

---

## Release 001 — AR/EN localization closure (`feat/i18n-closure`)

**Date:** 2026-08-13
**Status:** ⛔ **DEPLOYED, THEN ROLLED BACK** — shipped dictionaries were never
wired into the i18n runtime. See *Root cause* below.

### Source

| Field | Value |
| --- | --- |
| Source branch | `feat/i18n-closure` (dedicated worktree, not previously pushed) |
| Source tip | `23acb91` |
| Commits released | 81 not-yet-in-`main` commits (56 localization units + 25 reconciliation merges of `main`) |
| Producer scope | Bidirectional AR/EN closure, Packages 1 → 4C unit 1 |
| Excluded from source | `23acb91`'s uncommitted follow-on work (Package 4C units 2–3: `RecentOperationsDrawer`, `pos.json`, ratchet fixture) |

### Integration

| Field | Value |
| --- | --- |
| Baseline `main` at validation | `befe258` (code) / `21c7419` (docs-only tip) |
| Method | three `--no-ff` merges onto current `main`; ancestry preserved, no reset, no force-push |
| Merge commits | `8bb8e45` (candidate), `88f7995` (reconcile `befe258`), `56411b5` (reconcile `21c7419`) |
| Conflicts | zero |
| `main` after release | `56411b5` |
| Production SHA that carried it | `c383a7d` (a newer AI Inbox commit; release confirmed by ancestry) |
| Rollback ref | `rollback/pre-i18n-closure-release-20260813` → `e8d1b3c` |
| Rollback commit | `2e66f50` — `git revert -m 1 8bb8e45` |
| `main` after rollback | `2e66f50` (**live in Production**) |

Main-owned work proven byte-identical after integration and preserved through the
rollback (`AiInbox.jsx`, `aiAgentOrders.js`, `aiSupportLogService.js`,
`routePageTitles.js`, `MainLayout.jsx`, `visual-convergence-progress.md`,
4 `ai-workflows` tests, and AI Inbox Phase 13.3 `c383a7d`).

### Pre-release validation — all green, and all blind to the defect

| Guard | Result |
| --- | --- |
| `npm run build` | PASS |
| `npx eslint .` | **0 errors**, 1199 warnings |
| Full suite baseline `befe258` | 1960 tests / 24 failing identities |
| Full suite release `88f7995` | 1975 tests / **22** failing identities |
| Newly introduced failure identities | **0** |
| Failures fixed | 2 (`no file gains hardcoded UI strings`, `the localization debt baseline only shrinks`) |
| `npm run test:i18n` | 18/18 PASS |
| Dictionary parity | AR 9714 == EN 9714, delta 0, missing 0 |
| Focused guards | 33/33 (`create-product-submit-safety`, `pos-payment-integrity`, `pos-payment-routing`, `pos-invoice-selection-guard`, `pos-smart-filter-typography`, `pos-light-theme`, `payment-method-canonicalization`, `i18n-navigation-guard`, `i18n-memo-reactivity`) |
| Bidirectional classifier | genuine defects 1284 (AR→EN 547, EN→AR 737), down from 1916 |

### ⚠️ Root cause of the rollback — the manifest/runtime wiring gap

The release added **7 new locale bundles** (14 files, ar+en):
`access`, `shipping`, `aiStudio`, `aiSupport`, `loyalty`, `saas`, `attendance`.

Each was registered in `src/i18n/localeManifest.js` (`RESOURCE_BRANCHES`) but
**none was added to the explicit module map that `src/i18n/i18n.js` passes to
`buildResources(...)`**. `buildResources` resolves a branch only from the
`bundles` object it is handed, so those 7 branches resolve **empty at runtime**.

Consequences in Production:

- **1,038 `t()` call sites** hit empty branches — `access` 100, `shipping` 32,
  `aiStudio` 383, `aiSupport` 320, `loyalty` 59, `saas` 83, `attendance` 61.
- Each fell through to `readableMissingKeyFallback`, which renders the **last key
  segment title-cased in English** — e.g. `t("aiStudio.hub.title")` → "Title",
  `t("access.users.searchPlaceholder")` → "Search Placeholder" — in **both**
  languages.
- Affected surfaces: Users/Admin/Access, Shipping Center, AI Studio (hub, nav,
  Restock Recovery, workflows, Workflow Editor), aiSupport non-Inbox pages (Agent
  Analytics, Agent Settings, AI Settings, Support Console, Knowledge Base,
  Follow-ups, AI Channels, Meta Reviewer Inbox), Loyalty, SaaS, Attendance.

**Why every guard passed.** The parity, purity and missing-key guards all build
their dictionary view *from the manifest and the files on disk* — the same source
that was correct. Nothing asserts that a manifest branch is actually reachable
from the runtime module map, so a dictionary can be complete on disk, pass
parity, and still be absent from the bundle.

**How it was caught.** Bundler ground truth, not a test: sampling
dictionary-only Arabic values (strings present in a locale file but hardcoded
nowhere in `src/**`) and grepping the built `dist/assets/*.js`. Wired bundles
score 10–25/25; the 7 new bundles scored 0–3/25, versus 25/25 for the `orders`,
`products`, `pos`, `accounting`, `managerPortal` controls.

**The guard this repo is missing** (for the producing task to add):
assert that every `RESOURCE_BRANCHES` entry's `file` appears in the module map
`i18n.js` hands to `buildResources`, and/or assert a representative key from each
branch resolves through the real runtime instance. Either would have failed
before deploy.

### Post-rollback verification

Production serves `2e66f50` (asset fingerprint `2e66f501b986`). Routes `/`,
`/dashboard`, `/orders`, `/products`, `/customers`, `/inventory`, `/ai-studio`,
`/ai-inbox`, `/shipping`, `/users`, `/loyalty`, `/attendance` all HTTP 200 on the
rolled-back fingerprint; all 16 entry chunks load; storefront apex 200. The
deployed `i18n` chunk serves 10/10 sampled AR strings for each of `orders`,
`products`, `pos`, `accounting`, `managerPortal` — the pre-existing dictionaries
are intact.

Reverted-tree validation: build PASS, lint 0 errors, 1968 tests / 25 failing
identities vs 23 on `c383a7d`. The 2-identity delta is exactly the pair the
release had fixed (`no file gains hardcoded UI strings`, `the localization debt
baseline only shrinks`) — both were **already red on pre-release `main`**, so the
rollback restores the known baseline and introduces nothing new.

### Hand-back to the producing task

`feat/i18n-closure` is **unchanged and intact** — no commits were altered, and the
rollback touched only `main`. To re-release:

1. add the 7 bundles to the `buildResources({ ar: {...}, en: {...} })` module map
   in `src/i18n/i18n.js` (14 imports + 14 map entries);
2. add the manifest-reachability guard described above;
3. re-run `npm run test:i18n` **and** confirm against the built bundle;
4. hand back for release. The revert is a clean forward revert, so the branch can
   be re-merged once wired.

---

## Candidates evaluated and NOT released

| Candidate | Status | Reason |
| --- | --- | --- |
| `feature/ai-workflow-triggers` (38 ahead) | **ALREADY RELEASED** | all 38 AI Inbox/Studio Phase 8–13 commits exist in `main` as replayed SHAs (Phase 8 `378a17e`, Phase 9 `d8d03ad`, Phase 10 `2e7337e`, Phase 10.6 `ca653dd`, Phase 10.7 `7fa12fc`, Phase 11 `4c6f8f4`). 32/38 match by patch-id; the other 6 match by message with `main`'s replayed version newer. Nothing stranded. |
| `feature/m1-design-system-phase1` (23 ahead) | **ALREADY RELEASED + SUPERSEDED** | all 23 commits exist in `main` as replayed SHAs (Phase 1 `0a4016a`, Phase 1.5 `9a6be35`, Phase 2A `6df3b38`, table system `f648de2`, pagination `323aa8f`, Main-ERP accent `2c4c721`, portals accent `9685736`, control heights `8f7bc69`), and all its guard files are on `main`. `main` has since evolved those files 4–6 further commits via Visual Convergence. Releasing it would **revert newer `main` work**. |
| Package 4C units 2–3 (POS `RecentOperationsDrawer`) | **IN FLIGHT** | uncommitted in the i18n worktree; producer has not closed the unit. Half-finished POS localization is a hard exclusion. |
| `visual/convergence`, `codex/color-image-preview`, `codex/show-split-payments`, `codex/crocs-size-library`, `codex/manager-invoice-image-fix`, `codex/messenger-contrast-fix`, `release/reporting-center-v2`, `fix/batch1-visual-corrections`, `codex/fix-invoice-logo-origin`, local `main` | **ALREADY IN MAIN** | `ahead = 0` — fully merged ancestors. |
| Uncommitted changes in the shared main worktree (`M1UI.jsx`, `m1-ui.css`, 13 module pages, `AiInbox.js`/`ai*.js` scratch files) | **NOT A CANDIDATE** | unvalidated in-flight work owned by a concurrent session. |

## Reserved / held localization debt (does NOT block future releases)

AI Inbox (`AiInbox.jsx` 417, `AiInboxPwa.jsx` 129) · Inbox-sensitive shared
components (`SocialCommentsWorkspace` 77, `Customer360Drawer` 45,
`ProductCardPicker`, `TranscriptMessage`, `PwaOrderComposer`,
`PostProductLinksDrawer`, `crmIntelligence.ts`) · `ProductEdit` HOLD ·
print/export (247) · business/data (43) · technical/brand lookup identifiers
(94) · prototype/dead pages (286) · POS `RecentOperationsDrawer` + `CartSidebar`
(Package 4C units 2–3, in flight).

## Next resume state

- `main` = `2e66f50`, live in Production, healthy.
- Rollback ref `rollback/pre-i18n-closure-release-20260813` → `e8d1b3c` (retained; do not overwrite).
- **No COMPLETE + GREEN checkpoint is currently eligible.** The only substantial
  unreleased work is `feat/i18n-closure`, now **BLOCKED** on the runtime wiring
  fix above.
- Re-scan procedure: `git fetch origin --prune`, then `git worktree list` and
  `git cherry -v origin/main <branch>` per branch. Treat a message-identical
  commit in `main` as already released even when the patch-id differs — this repo
  rebases on integration, so patch-id alone over-reports stranded work.
- **Add to every future localization release:** verify the built bundle, not just
  the dictionaries on disk. Passing parity/purity/missing-key guards does not
  prove a dictionary reaches the runtime.

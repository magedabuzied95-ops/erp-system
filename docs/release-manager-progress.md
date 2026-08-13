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
---

## Release 002 — AR/EN localization closure, take 2 (`feat/i18n-closure`)

**Date:** 2026-08-13
**Status:** ✅ **RELEASED AND RUNTIME-VERIFIED IN PRODUCTION**

This is the re-release of Release 001 after the producer fixed the runtime wiring
blocker. Release 001's rollback history above is retained verbatim.

### Source

| Field | Value |
| --- | --- |
| Source branch | `feat/i18n-closure` |
| Producer READY SHA | `a397443` |
| Wiring fix | `9598ea8` — 14 imports + 14 `buildResources` map entries (7 bundles × AR/EN) |
| New guards from the producer | `tests/i18n-runtime-reachability.test.js` (23 tests) · `scripts/i18n-bundle-probe.mjs` (`npm run i18n:probe-bundle`) |
| Deferred out of this release | **`AiSupportKnowledgeBase.jsx` localization** — see *Conflict* below |

### Integration

| Field | Value |
| --- | --- |
| Baseline `main` at first reconcile | `88ce0d2` |
| `main` moved during validation | **6 times** — `88ce0d2` → `8d98598` → `4ee207c` → `7037c5e` → `e4dff8e` → `d06f6ae`, all AI Inbox / visual-convergence work |
| Method | successive `--no-ff` merges onto current `main`; ancestry preserved, no reset, no force-push |
| Release merge | `a774ca3` (validated against `main` `d06f6ae`) |
| Deploy trigger | `041a8a6` — empty commit, main only (see *Stalled deployment*) |
| Final `main` SHA | `041a8a6` |
| Production SHA | `041a8a6`, asset fingerprint `041a8a61c9fe` |
| Rollback ref | `rollback/pre-i18n-closure-release-take2-20260813` → `4ee207c` (the exact SHA Production served pre-release) |

Release 001's ref `rollback/pre-i18n-closure-release-20260813` → `e8d1b3c` is
**untouched**.

The revert of Release 001 (`2e66f50`) did **not** need replaying or re-reverting:
the producer had already neutralised it in `7513f03`, so `2e66f50` was an ancestor
of both sides and the merge base (`2f59198`) sat after it. A plain forward merge
was therefore correct — verified before merging.

Main-owned work proven byte-identical after every reconcile: `AiInbox.jsx`,
`AiInboxPwa.jsx`, `QuickReplies.jsx`, `ProductCardPicker.jsx`,
`AppleEmojiPicker.jsx`, `TranscriptMessage.jsx`, `productSelection.js`,
`aiInboxQuickRepliesService.js`, `aiSalesAgentService.js`, `schema.sql`,
`routePageTitles.js`, `M1UI.jsx`, `CreateProduct.jsx`, `ProductEdit.jsx`,
`visual-convergence-progress.md`.

### aiSupport re-check (required after every reconcile)

`main` created its own `aiSupport` bundle for quick replies while the branch
already had one, and git auto-merges the two **without reporting a conflict**.
Re-verified on every reconciled tree:

- exactly **one** `import aiSupportAr` / `aiSupportEn` and **one** map entry per
  locale (4 references total) — duplicate ES bindings are a SyntaxError;
- exactly **one** `{ branch: "aiSupport" }` in `RESOURCE_BRANCHES`, and zero
  duplicate branches overall — a duplicate silently replaces the first bundle;
- dictionary union intact: 8 top-level keys per locale (the branch's 7 plus
  main's `quickReplies`), and all **35** of main's `quickReplies` leaf keys
  present with **zero** value mismatches after `c6d8cfa` extended them.

### Conflict and ownership resolution

One real conflict, `src/modules/aiSupport/pages/AiSupportKnowledgeBase.jsx`
(4 hunks), from main's Phase 13.5 (`e4dff8e`): it adds two new business fields
(`maps_url`, `store_address`), a `mapsUrlValid` validator and its validation row
on the same lines the branch had migrated to `t()`.

Resolved to **main's version in full**, deferring the "close Knowledge Base
management chrome" localization unit out of this release:

- main owns business logic and new fields. Preserving both sides would require
  authoring new AR+EN copy for the two new fields — localization development,
  which the Release Manager must not do.
- The alternative (localized labels for the 11 old fields, hardcoded Arabic for
  the 2 new ones) is precisely the half-migrated surface the release contract
  forbids.
- Taking main's file wholesale leaves the page in one coherent state — fully
  main's, as it always was — rather than a mixed one.

Verified self-contained: no test asserts KB localization and no other file
resolves `aiSupport.knowledgeBase.*`, so its 5 now-unused dictionary sub-keys
remain harmlessly in both locales with parity intact.

**Handed back to the localization producer:** re-localize that page including
`maps_url` and `store_address`, then it can ship in a later checkpoint.

### Pre-release validation (final tree `a774ca3` vs `main` `d06f6ae`)

| Guard | Result |
| --- | --- |
| `npm run build` | PASS |
| `npx eslint .` | **0 errors**, 1206 warnings |
| Full suite — main `d06f6ae` | 2051 tests / **28** failing identities |
| Full suite — release `a774ca3` | 2089 tests / **28** failing identities |
| **Newly introduced failure identities** | **0** |
| Only-on-main identities | 0 — the two failure sets are **identical** |
| Net new tests | +38, all passing |
| `npm run test:i18n` | 41 tests, 39 pass / 2 fail |
| — the 2 failures | `no file gains hardcoded UI strings`, `the localization debt baseline only shrinks` — **red identically on `main`**; they are main's own inherited AI Inbox debt (Phase 13.4/13.5, emoji picker, reactions). Not touched: the ratchet fixture is the producer's artifact. |
| Runtime reachability guard | **23/23 PASS** |
| Bundle probe (post-build) | 68 pairs, **66 reachable, 0 unreachable**, 2 skipped (`auth` `{}` placeholders) |
| Dictionary parity | AR 9812 == EN 9812, delta **0**, missing **0** |
| POS + payment | 49/49 |
| Product Form submit-safety | 8/8 |
| AI Studio | 370/370 |
| AI Inbox safety | 10 failures, each individually confirmed pre-existing on `main` |
| Visual Convergence | 96/97, the 1 failure pre-existing on `main` |

⚠️ **False alarm worth recording.** `tests/product-label-pdf.test.js` appeared as a
new failure identity in one run. It was an **environment** artifact, not code: a
`npm install --no-save` in the release worktree replaced the junctioned
`node_modules` with a private copy that lacked the **extensionless**
`@zxing/library/esm/core/oned/Code128Reader` file the shared tree carries, and
`productLabelJobsPdf.js` imports that path without an extension. Source files were
byte-identical to main. Fixed by restoring the junction; 6/6 pass. **Never run
`npm install` in a worktree whose `node_modules` is a junction** — and compare
suites only across identical environments.

### Stalled deployment

`main` carried `a774ca3` for ~18 minutes with **no** Production build: served
fingerprint stayed `d06f6ae3369a` while `X-Vercel-Cache: HIT` with a
monotonically growing `Age` (1145 → 1515 s). Build inputs were verified sound
(`package.json`/`package-lock.json` identical to pre-release main,
`emoji-picker-react` present in both). Remedied with the documented unique-SHA
trigger — an empty commit, main only (`041a8a6`) — which deployed in ~20 seconds.

### Post-deploy PRODUCTION RUNTIME PROOF

Ancestry and HTTP 200 were **not** accepted as proof. The check that caught the
Release 001 incident was repeated against the deployed build.

**1. Deployed-bundle sentinel proof.** Crawled 137 chunks / 2,256,400 bytes of
served JS off `041a8a61c9fe` and required each dictionary-only sentinel value
(present in the locale file and nowhere in `src/**`) in raw and `\uXXXX` form:
**14/14 sentinel-locale pairs SERVED, 0 missing.**

**2. True runtime resolution in a real browser.** Dynamically imported the
deployed i18n chunk (`assets/i18n-BE4AjSPX-041a8a61c9fe.js`) on the Production
origin and resolved each sentinel through the live i18next instance via
`getFixedT(locale)`:

| Branch | Sentinel key | AR | EN | deployed branch key count |
| --- | --- | :-: | :-: | --- |
| `access` | `permissions.subtitle` | ✅ | ✅ | ar 6 / en 6 |
| `shipping` | `center.filters.search` | ✅ | ✅ | ar 1 / en 1 |
| `aiStudio` | `assisted.enabledNote` | ✅ | ✅ | ar 10 / en 10 |
| `aiSupport` | `aiSettings.masterNote` | ✅ | ✅ | ar 8 / en 8 |
| `loyalty` | `rules.subtitle` | ✅ | ✅ | ar 3 / en 3 |
| `saas` | `register.subtitle` | ✅ | ✅ | ar 6 / en 6 |
| `attendance` | `reports.tableSubtitle` | ✅ | ✅ | ar 6 / en 6 |

**7 sentinels × 2 locales — 0 failures.** Each resolved to its real dictionary
value, and AR ≠ EN in every case (so no locale is serving the other's bundle).

**3. Negative control — proves the check can fail.**
`t("notAWiredBranch.hub.title")` on the deployed instance returned **`"Title"`**,
the exact humanised-key symptom of the Release 001 incident. Under Release 001
the seven branches above would have read `ar=0 en=0` and returned such
placeholders; they now carry real keys.

**4. Full deployed branch sweep.** 37 runtime branches; the only empty one is
`auth` (`ar=0 en=0`), the documented `{}` placeholder with zero `t("auth.*")`
call sites. Deployed dictionaries: ar 364,171 bytes, en 384,312 bytes.

### Smoke

`/`, `/dashboard`, `/orders`, `/products`, `/customers`, `/inventory`,
`/ai-studio`, `/ai-inbox`, `/users`, `/access`, `/shipping`, `/loyalty`, `/saas`,
`/attendance`, `/ai-support`, `/settings` — all HTTP 200 on fingerprint
`041a8a61c9fe`. App shell mounts (`#root` has children — not the known
empty-`#root` automation artifact). Storefront apex HTTP 200, unaffected.

⚠️ **Limit of this smoke, stated plainly:** the seven affected pages are behind
authentication and no credentials were used, so page-level *visual* AR/EN
verification of those surfaces was not performed. What is proven is stronger than
route HTTP: the deployed runtime resolves every one of their dictionaries in both
locales. Route-level chunk probing by name is not possible from outside — Vercel's
build produces different content hashes than a local build, so locally derived
chunk names return the SPA fallback.

---

## Next resume state

- `main` = `041a8a6`, **live in Production** (`041a8a61c9fe`), runtime-verified.
- Rollback refs, both retained, never overwrite:
  `rollback/pre-i18n-closure-release-20260813` → `e8d1b3c` (Release 001) and
  `rollback/pre-i18n-closure-release-take2-20260813` → `4ee207c` (Release 002).
- **No further COMPLETE + GREEN checkpoint is currently eligible.**
- Remaining unreleased localization work, all owned by the producer:
  1. `AiSupportKnowledgeBase.jsx` — deferred by this release; needs the two new
     Phase 13.5 fields localized;
  2. Package 4C unit 3 and the reserved debt below.
- Re-scan procedure: `git fetch origin --prune`, then `git worktree list` and
  `git cherry -v origin/main <branch>` per branch. Treat a message-identical
  commit in `main` as already released even when the patch-id differs — this repo
  rebases on integration, so patch-id alone over-reports stranded work.
- **Every future localization release must repeat the two-sided runtime proof:**
  the reachability guard (`npm run test:i18n`) *and* the deployed-runtime check
  (bundle probe locally, then resolve sentinels through the deployed i18next
  instance). Parity/purity/missing-key guards passing does **not** prove a
  dictionary reaches the runtime — that is what Release 001 shipped broken.
- `main` moves several times an hour (AI Inbox workstream). Run the release-tree
  and main-baseline suites **in parallel** in two worktrees to keep the race
  window small, and re-fetch immediately before every push.

---

## Release 003 — non-reserved localization closure (`feat/i18n-closure-2`)

**Date:** 2026-08-13
**Status:** ✅ **RELEASED AND RUNTIME-VERIFIED IN PRODUCTION**

Completes the work Release 002 deferred, and closes the non-reserved
safely-fixable gate to **0/0** in both directions.

### Source

| Field | Value |
| --- | --- |
| Source branch | `feat/i18n-closure-2` (dedicated worktree, never pushed) |
| Producer READY SHA | `57f7cae` |
| Range | `c4424743..57f7cae` — 16 commits |
| Producer baseline | `c4424743`, the `main` that carried Release 002 |
| Included | Knowledge Base (current version, incl. `store_address` / `maps_url`), Supplier Statement, Purchase Order, shared Employee/Manager chat, Products list, Coupons, Warehouse Live Picks, routed Sales surfaces, Dashboard / Command Center / activity, Notifications, M1UI + crash boundary + mobile sheet, Website Settings, Login, MainLayout, PublicProduct |

### Integration

| Field | Value |
| --- | --- |
| Baseline `main` at validation | `dcacd94` |
| `main` moved during validation | **no** — re-fetched immediately before push, still `dcacd94` |
| Already present in `main` | **none** — no producer commit was an ancestor of `main`, and no patch-id from the range matched any of main's 10 new commits |
| Method | one `--no-ff` merge onto current `main`; ancestry preserved, no reset, no force-push |
| Release merge | `57b9a4b` |
| Conflicts | **zero** |
| Final `main` SHA | `57b9a4b` |
| Production SHA | `57b9a4b`, asset fingerprint `57b9a4b22e3b` |
| Rollback ref | `rollback/pre-i18n-closure-2-release-20260813` → `01bf264` (the exact SHA Production was serving pre-release) |

Release 001's `rollback/pre-i18n-closure-release-20260813` → `e8d1b3c` and
Release 002's `rollback/pre-i18n-closure-release-take2-20260813` → `4ee207c` are
**untouched**.

### Concurrent-main preservation

The producer's 66 files and main's 16 files since the baseline are **disjoint** —
zero overlap, which is why the merge had no conflicts. Every main-owned file
touched since `c4424743` was proven byte-identical to `origin/main` after the
merge: `AiInbox.jsx`, `AiSettings.jsx`, `productSelection.js`,
`aiInboxGroundingGate.js`, `aiSalesAgentService.js`, the four AI Studio pages,
`AiStudioNav.jsx`, `WorkflowCanvas.jsx`, `POSPro.m1.css`, `ai-surface.css`,
`visual-convergence-progress.md`, and both `ai-workflows` tests.

### aiSupport re-check (required after every reconcile)

- exactly **one** `import aiSupportAr` / `aiSupportEn` and one map entry per
  locale — 4 references total;
- exactly **one** `{ branch: "aiSupport" }`; **zero** duplicate branches among 38;
- union intact: 8 top-level keys per locale, all **35** `quickReplies` leaves
  present in both, **zero** value mismatches.

`main` introduced **no** new locale bundle and touched **no** i18n wiring since
the producer's baseline, so no extra wiring audit was owed.

### New manifest branch — audited

This release adds exactly one branch, `notifications`. It reads the
**already-wired** `common` bundle through `pick`, exactly like
`sidebar`/`language`/`appearance`, so it introduces no `i18n.js` import and no
runtime-map entry — structurally excluding the Release 001 failure mode. Proven
served and resolvable in Production below.

### Pre-release validation (release tree `57b9a4b` vs `main` `dcacd94`)

| Guard | Result |
| --- | --- |
| `npm run build` | PASS |
| `npx eslint .` | **0 errors**, 1207 warnings |
| Full suite — main `dcacd94` | 1235 tests / **27** failing identities |
| Full suite — release `57b9a4b` | 1250 tests / **27** failing identities |
| **Newly introduced failure identities** | **0** |
| Only-on-main identities | 0 — the two failure sets are **identical** |
| Net new tests | +15, all passing |
| Localization guards | 53 pass / 2 fail (see below) |
| Runtime reachability guard | PASS — every manifest bundle wired in both locales, no unwired bundle, no empty branch |
| Bundle probe | 68 pairs · **66 reachable · 0 unreachable** · 2 skipped (the documented empty `auth`) |
| AR/EN parity | **10154 = 10154**, delta 0 |
| Purity (both directions) | PASS |
| Missing keys | 0 |
| Dynamic-key / memo-reactivity / module-scope guards | PASS |
| NON-RESERVED closure gate | **AR→EN 0 · EN→AR 0** |

Focused regression, all on the reconciled tree: ai-workflows 381/0 ·
ai-studio-builder 37/0 · ai-runtime 2/0 · pos 3/0 · manager-portal 26/0 ·
coupons 5/0 · messenger-guided-shopping 7/0 · storefront-pricing 6/0 ·
meta-catalog 11/0 · meta-reviewer 13/0 · ai-marketing 81/0 · storefront-seo 33/0 ·
analytics 272/1 — the one failure (`cards are min-w-0 so grid columns can
shrink`) reproduces identically on `main` `dcacd94`.

### The two red localization guards — main's own debt, not this release

`no file gains hardcoded UI strings` and `the localization debt baseline only
shrinks` are red on the reconciled tree **and red on `main dcacd94`** — the same
two identities, so nothing is newly introduced. Cause: main's `fdbf50b`
(AI Inbox Phase 13.4.1) added 13 Arabic lines to `AiInbox.jsx`, of which 2 are
new hardcoded UI strings, after the producer last regenerated the ratchet.

Not remediated here, deliberately: `AiInbox.jsx` is under the AI Inbox freeze,
the ratchet fixture is the producer's artifact, and regenerating it would be
localization development the Release Manager must not do.

### Post-deploy PRODUCTION RUNTIME PROOF

HTTP 200 was **not** accepted as proof.

**1. Deployed-bundle sentinel proof.** Crawled **475 chunks / 9,853,823 bytes**
of served JS off fingerprint `57b9a4b22e3b`, requiring each dictionary-only
sentinel in raw and `\uXXXX` form: **18/18 sentinel-locale pairs SERVED, 0
missing** — the seven Release-002 branches plus **four for the new
`notifications` branch**.

**2. True runtime resolution in a real browser.** Imported the deployed i18n
chunk (`assets/i18n-Ck_MWs18-57b9a4b22e3b.js`) on the Production origin and
resolved every sentinel through the live i18next via `getFixedT(locale)`:

| Branch | Sentinel key | AR | EN | AR ≠ EN |
| --- | --- | :-: | :-: | :-: |
| `access` | `permissions.subtitle` | ✅ | ✅ | ✅ |
| `shipping` | `center.filters.search` | ✅ | ✅ | ✅ |
| `aiStudio` | `assisted.enabledNote` | ✅ | ✅ | ✅ |
| `aiSupport` | `aiSettings.masterNote` | ✅ | ✅ | ✅ |
| `loyalty` | `rules.subtitle` | ✅ | ✅ | ✅ |
| `saas` | `register.subtitle` | ✅ | ✅ | ✅ |
| `attendance` | `reports.tableSubtitle` | ✅ | ✅ | ✅ |
| **`notifications`** | `bell.subtitle` | ✅ | ✅ | ✅ |
| **`notifications`** | `center.emptyHint` | ✅ | ✅ | ✅ |

**9 sentinels × 2 locales — 0 failures.**

**3. Negative control.** `t("notAWiredBranch.hub.title")` on the deployed
instance returned **`"Title"`** — the exact humanised-key symptom of the Release
001 incident, proving the check can still fail.

**4. Full deployed branch sweep.** **38** runtime branches (37 + the new
`notifications`, which carries 6 keys in each locale). The only empty branch is
`auth` (`ar=0 en=0`), the documented `{}` placeholder with zero `t("auth.*")`
call sites.

### Deployment

No stall. Production moved from `01bf264654df` to `57b9a4b22e3b` within a minute
of the main-only push; the documented unique-SHA remedy was **not** needed.

### Smoke

`/`, `/dashboard`, `/orders`, `/products`, `/customers`, `/inventory`,
`/purchases`, `/coupons`, `/notifications`, `/ai-studio`, `/ai-inbox`,
`/ai-support`, `/website`, `/settings`, `/access`, `/shipping` — **16/16 HTTP
200, all on fingerprint `57b9a4b22e3b`**. App shell mounts (`#root` has
children). `<html lang="en" dir="ltr">` confirms the language machinery applies.

⚠️ **Limit, stated plainly:** the affected pages are behind authentication and no
credentials were used, so page-level *visual* AR/EN verification was not
performed. What is proven is stronger than route HTTP: the deployed runtime
resolves every one of their dictionaries in both locales.

### Reserved / held debt — preserved, NOT a gap

`0/0` means no safely-fixable **non-reserved** chrome remains. It does not mean
no literals remain. Deliberately preserved and classified, in code, by
`scripts/i18n-nonreserved.mjs`:

| Bucket | AR | EN |
| --- | --- | --- |
| AI Inbox direct | 290 | 352 |
| Inbox-sensitive shared | 13 | 228 |
| Product Form hold | 31 | 27 |
| catalogue / unrendered config | 2 | 14 |
| print + receipt artwork | 2 | 7 (+28) |
| dead / unreachable (11 files) | 7 | 30 |
| generated / outbound content | 2 | 7 |
| serialized workflow data | 0 | 1 |
| product decisions | 1 | 0 |

`GRAND TOTAL 1040 = non-reserved 0 + reserved 1012 + receipt artwork 28`.
Both product decisions were re-verified present and untouched:
`EmployeePayrollPortal.jsx:1424` `const language = "ar"` and
`OrdersDashboard.jsx:1438/:1534` `getPaymentSummary(order, "ar")`.

### ⚠️ Scanner caveat recorded

The producer documented two blind spots in the localization scanner, and
deliberately did **not** fix them (either change moves every baseline at once):

1. **multi-line JSX text may be uncounted** — `JSX_TEXT_RE` needs `>text<` on one
   line, so a label on its own line between two elements is invisible;
2. **asymmetric bilingual pairs may appear valid** — `bilingualHalfRanges`
   accepts an `isArabic ? {} : {}` pair without checking both halves carry the
   same keys. One such real leak (`labels.article`, English-only half) was found
   and fixed by hand in `PurchaseOrder.jsx`.

This does not invalidate the completed per-unit migrations — the producer
migrated the extra strings it found in every unit it touched — but the reported
counts are a **floor, not a ceiling**. A future scanner-improvement checkpoint
may reveal additional debt. That checkpoint must be its own release.

### Next resume state

- Production and `main` are both `57b9a4b`.
- Rollback refs, all three retained, never overwrite:
  `…-20260813` → `e8d1b3c` (R1), `…-take2-20260813` → `4ee207c` (R2),
  `…-2-release-20260813` → `01bf264` (R3).
- **No further COMPLETE + GREEN checkpoint is currently eligible.** Branches
  ahead of `main` — `feature/ai-workflow-triggers` (40),
  `feature/m1-design-system-phase1` (23), `wip/ai-inbox-desktop-omnichannel` (2),
  `visual/layout-geometry` (1), `codex/instagram-profile-hotfix` (2),
  `codex/meta-reviewer-hmac-inbox` (1), plus three `backup/*` and two `codex/*`
  staging branches — none carries a producer READY declaration, and several are
  live in other sessions' worktrees. Do not release unvetted work.
- Remaining known localization work, all producer-owned: the reserved buckets
  above (AI Inbox is the large one), and a scanner-improvement checkpoint.
- `feat/i18n-closure-2` is now fully merged (`ahead=0`); like `feat/i18n-closure`
  it was never pushed, and does not need to be.

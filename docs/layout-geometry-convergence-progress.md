# M1 ERP — Full-System Layout & Card Geometry Convergence

Operational tracking only. Nothing here affects runtime behaviour.

Post-closure visual program. Continues the M1 Design System. **Not** a redesign.
Scope: layout, card geometry, spacing, rhythm, grid, overflow, scroll ownership.
Colour/typography/dropdown/page-title contracts are **frozen** (see
`docs/visual-convergence-progress.md`).

## Status: IN PROGRESS — desktop Light/RTL pass complete, 0 defects found

| Item | Value |
|---|---|
| Session-1 baseline `main` | `c442474` |
| Session-1 baseline Production | `041a8a6` (fingerprint `041a8a61c9fe`) |
| **Current Production** | **`5c123e3`** (fingerprint `5c123e3cfec6`) |
| Current `origin/main` | `5c123e3` |
| Ledger branch HEAD | `visual/layout-geometry` @ rebased onto `5c123e3` |
| Checkpoints deployed by this program | **0** |
| Rollback refs created | 0 (none needed — no code change) |
| Shared owners changed | **0** |
| Confirmed geometry defects | **0** |
| Code changed | **none** |

### Production moved mid-programme

Production advanced **29 commits** from `041a8a6` to `5c123e3` while this audit
was running — a concurrent localization-closure + "POST-CLOSURE USER VISUAL
CORRECTIONS" workstream (its own cp1–cp5). Layout-relevant files in that delta:

`src/pages/Dashboard.jsx`, `src/shared/ui/M1UI.jsx`,
`src/shared/layouts/MainLayout.jsx`, `src/modules/products/pages/ProductsList.jsx`,
`src/modules/pos/pages/POSPro.m1.css`, `src/theme/ai-surface.css`,
`src/shared/chat/SharedPortalChat.jsx`, `src/shared/notifications/NotificationBell.jsx`.

**Consequence, stated plainly:** the Light/RTL sweep below was measured against
`041a8a6`. It is *provisional* against `5c123e3` and must be re-verified for the
touched surfaces before any row is promoted to a final PASS. It is not discarded —
no defect was found, so there is nothing to act on — but it is not final either.

**Coordination hazard:** two visual programmes are writing to the same files.
Any checkpoint from this programme must re-fetch and reconcile immediately before
push, and must not assume its worktree base is current.

## Environment / hosts

- ERP (authenticated): `https://erp.m1store-egy.com` — the audit target.
- Storefront: `https://m1store-egy.com` — separate host, out of scope.

## Route inventory (from the CURRENT router, `src/App.jsx`)

~150 `path=` entries. Excluding the storefront-host block, `/shop/*` legacy
redirects, token-bound portal routes and public pages, the authenticated ERP
shell exposes **115** operational routes: 109 swept, 6 deferred as pathological.

## Geometry auditor

Rendered-DOM measurement in the live authenticated app. For every `grid`/`flex`
container inside `.m1-shell-content` with ≥2 visible children, children are
resolved to their visual card through unstyled wrappers, bucketed into visual
rows by `getBoundingClientRect().top` (±6 px), then compared:

- **height outlier** — `max(h) − min(h) > 8 px` within a row
- **width outlier** — `> 8 px`, **only** when the grid's own computed tracks are
  equal (±2 px) and cells carry a uniform span
- **overflow** — `scrollWidth > clientWidth` with `overflow-x: visible`
- **scroll ownership** — every element that actually owns a scrollport

### Auditor defects found and fixed (five)

1. **Detector too strict.** Peer cards inside unstyled wrappers were invisible;
   a 2-up grid of 326 px cells scored 0 cards. Fixed by resolving through up to
   4 single-child wrappers while measuring the *cell* rect.

2. **Stale-DOM reads — the serious one.** The first sweep reported a defect on
   `/dashboard`: a 2-up grid of 865 vs 1057 px carrying
   `rounded-3xl border-white/10 bg-zinc-950/90`. That is `/workspace`'s markup,
   read after the URL changed but before React swapped the tree. A URL-vs-`landed`
   assertion cannot catch it, because the URL was already correct. Fixed by
   requiring the rendered identity (element count + scrollHeight + title +
   headings) to change before settling, recorded as `domChanged`. The guard
   immediately caught a second instance (`/notifications` read while
   `landed=/orders`). **All 32 pre-fix readings were discarded and the sweep
   restarted from zero.** Re-measured under real navigation, `/workspace` is
   clean: 11 cards, 4 rows, 0 flags.

3. **Width-delta false positive.** `xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]`
   is deliberately asymmetric. The rule now requires equal computed tracks.

4. **`innerText` settle froze the renderer.** `settle()` polled
   `document.body.innerText` every 200 ms; `innerText` forces a full layout, which
   is catastrophic on the 0.5–1 M character label surfaces and caused repeated
   45 s CDP timeouts. Replaced with a cheap signal (element count + scrollHeight).
   Route throughput went from ~1 route / 30 s to ~8 routes / 30 s.

5. **Identity-key collision in the re-check runner.** A simplified key
   (element count + scrollHeight only) collided between route skeletons, so 21
   re-checks reported `domChanged:false`. Fixed by restoring title + headings to
   the key. Those 21 rows were **not** trusted.

Baseline validation: `/dashboard` (frozen reference) measures **7 × (255 × 172)**
KPI cards and **3 × (622 × 340)** panels — exact equality, 0 flags — reproduced
after every auditor change.

## Measured — Light theme, Arabic RTL, 2288 px CSS, at Production `041a8a6`

Readings 118 · distinct routes 109 · **trusted PASS 75** ·
**peer cards measured 877** · **peer groups 295** · **geometry flags 3** ·
**page-level horizontal overflow: 0 routes**.

### The 3 flags — all investigated, all intentional, none a defect

| Route | Owner | Measurement | Verdict |
|---|---|---|---|
| `/reports/sales` | `div#sales-breakdown` `xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start` | equal tracks 789.99/790.01; heights 509 vs 423 (Δ86) | **Intentional.** `items-start` is used on *every* page-level grid across the Reporting Center (ExecutiveOverview, SalesIntelligence, InventoryIntelligence). `SectionCard` is independently collapsible (`collapsible`, `openOnDesktop`); stretching would pad a collapsed card out to match its expanded neighbour. Forcing equal height would break the collapse UX. |
| `/reports/inventory` | `div#inventory-breakdown`, same idiom | same | **Intentional**, same owner family. |
| `/marketing/ai-center/leads` | `xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)] items-start` | `section` 33640 px vs `aside` 488 px | **Intentional.** Main content column beside an `xl:sticky xl:top-4` aside. Not semantic peers. |

Per §7 these are *not* normalized. Forcing equal heights here would be a
regression, not a fix.

### Overflow observations — sub-pixel, not defects

15 routes reported `scrollWidth − clientWidth` of ~4 px (`/dashboard` 8 px,
`/reports/*`, the `/settings/*` family, `/website/settings`, 3 marketing routes).
Traced on `/reports/sales`: **0 elements extend beyond the content container's
box** (`beyondContent: 0`) — the delta is sub-pixel track rounding
(789.994 + 790.012 + 20 gap). No route produced page-level horizontal overflow
(`html.scrollWidth > clientWidth` never fired). Classified as measurement noise;
auditor threshold should be raised to >4 px.

### Aliases (13) — redirects, not defects

`/sales-employees`→`/employees/employees` · `/accounting/cash-registers`→`/accounting/cashbox` ·
`/accounting/ledgers`→`/accounting/accounts` · `/accounting/analytics`→`/accounting/reports` ·
`/accounting/taxes`→`/accounting/reports` · `/employees/commissions`→`/employees/analytics` ·
`/employees/top-performers`→`/employees/analytics` · `/employees/shifts`→`/employees/attendance` ·
`/attendance`→`/employees/attendance` · `/attendance/employees`→`/employees/employees` ·
`/attendance/reports`→`/employees/reports` · `/attendance/kiosk`→`/employees/attendance` ·
`/staff/qr-attendance`→`/employees/attendance`

### Deferred — pathological DOM, bounded handling required (not yet done)

| Route | Evidence |
|---|---|
| `/products/barcodes` | 1,075,836 chars; froze the renderer twice |
| `/purchases/reorder-suggestions` | 576,903 chars; never settles |
| `/create-order` | froze the renderer (bounded 55 MB catalog) |
| `/purchases/create` | same owner family |
| `/products/barcode-labels`, `/products/barcode-print-queue`, `/products/print-list` | label surfaces |

Standing: `/products/labels` `PASS_BOUNDED` · `/ai-studio/workflows/:id/edit`
`BLOCKED_FUNCTIONAL` · `/inventory/variant/:id/history` `PENDING_NO_READONLY_ID`.

### 21 routes still requiring a trusted reading

`/notifications` `/customers` `/purchases/reorder-suggestions` `/inventory`
`/warehouses` `/expenses` `/accounting/accounts` `/reports/overview`
`/settings/company` `/settings/appearance` `/settings/currencies`
`/settings/storefront` `/settings/shipping` `/settings/payments` `/users`
`/marketing/ai-center/leads` `/marketing/analytics` `/marketing/automation`
`/marketing/social-comments` `/marketing/settings` `/ai-studio`

## Automation-session failure (resolved by switching browsers)

The Chrome automation profile stopped booting the app entirely — `#root` empty
with 47 static elements, on `/dashboard` **and** on the public `/login`, across a
fresh tab and hard reloads. Ruled out: Production health (all routes HTTP 200),
service workers (none), caches (none), chunk delivery (16/16 JS resources 200
with valid decoded bodies), module execution (a synthetic `type="module"` script
ran), localStorage quota (12.7 KB total — hypothesis raised and **disproved**).

Decisive test: the **identical build** `app-CcxBkJV1-5c123e3cfec6.js` renders
correctly in a different browser (`rootKids: 2`). Per the permanent rule, an empty
`#root` while Production is healthy is an **automation-session failure** — Production
code was **not** touched.

Also note: `sessionStorage` is per-tab, so the raw sweep rows were lost when the
tab died. Summary results had already been harvested. **Persist future sweep
results to `localStorage`, not `sessionStorage`.**

## Viewport ladder — now available

Chrome could not be resized (maximized, `outerWidth` pinned to screen width) and
page-zoom shortcuts are blocked, giving a single fixed 2288 px viewport. The
Claude Browser pane provides exact emulation — verified **1430 × 900 CSS at
dpr 1.25**. The responsive ladder will run there:

| Rung | Target CSS width |
|---|---|
| A wide desktop | 1920 |
| B normal desktop | 1440 |
| C narrow desktop / tablet | 1024 |
| D smallest supported (high-risk pages only) | 768 |

## Matrices

| Dimension | State |
|---|---|
| Light / RTL @ 2288 (at `041a8a6`) | 75 PASS, 3 explained, 13 ALIAS, 21 unverified, 6 deferred |
| Light / RTL @ `5c123e3` | **re-verification pending** |
| Dark | **not run** |
| LTR | **not run** |
| Responsive A–D | **not run** (now unblocked) |
| Internal states | **not run** |
| Frozen-reference re-sweep | n/a — no shared owner changed |

## Behaviour freeze

Honoured absolutely. **Zero** code changes across both sessions. No API, DB,
payload, calculation, permission, order-state, inventory, payment, POS, workflow,
localization or AI behaviour touched. Navigation was read-only; no record created,
no business action triggered. The only writes were auditor keys in the browser's
own storage, since removed.

## RESUME MARKER

**Nothing deployed. `main` and Production untouched by this programme.**

1. Sign in to the Claude Browser pane (user-driven; credentials never handled by
   the agent). Re-install the auditor there — it is **not** in that browser's
   storage yet; the source is reproduced in this session's transcript and must be
   re-injected, then re-validated against `/dashboard` (expect 7 × 255×172 and
   3 × 622×340, 0 flags).
2. Re-run the Light/RTL sweep against `5c123e3` at rung B (1440), persisting to
   `localStorage`.
3. Clear the 21 unverified routes and the 7 deferred surfaces (bounded).
4. Then Dark, then LTR, then rungs A/C/D, then internal states.
5. Re-fetch `origin/main` immediately before any push — a second visual
   programme is shipping to the same files.

**Rules carried forward:** a URL match is not proof the DOM belongs to that route
— require `domChanged`. Never poll `innerText` on large surfaces. An empty
`#root` with healthy Production is an automation fault, never a Production
rollback trigger.

---

## Appendix — the auditor (consolidated, all five fixes applied)

Paste into the authenticated browser console, then `await __geo.run()`.
Persist sweep output to `localStorage`, never `sessionStorage` (per-tab).

```js
window.__geo = (function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const RR = (e) => { const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), t: Math.round(b.top) }; };
  const cls = (e) => (typeof e.className === "string" ? e.className : e.getAttribute("class") || "").trim();
  const sig = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + "." + cls(e).split(/\s+/).slice(0, 5).join(".");

  // FIX 4: never poll innerText -- it forces layout and freezes 1M-char surfaces.
  const key = () =>
    document.getElementsByTagName("*").length + "|" + Math.round(document.body.scrollHeight) +
    "|" + document.title + "|" +
    Array.from(document.querySelectorAll("h1,h2")).slice(0, 3).map((e) => e.textContent.trim().slice(0, 40)).join("~");

  async function settle(maxMs = 4000) {
    const t0 = Date.now(); let last = null, stable = 0;
    while (Date.now() - t0 < maxMs) {
      await sleep(200);
      const k = key();
      if (k === last) { stable++; if (stable >= 2) return true; } else { stable = 0; last = k; }
    }
    return false;
  }

  const shellRoot = () =>
    document.querySelector(".m1-shell-content") || document.querySelector("main") ||
    document.getElementById("root") || document.body;

  function styled(e, pbg) {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const b = ["borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"].some((k) => parseFloat(s[k]) > 0);
    const sh = s.boxShadow && s.boxShadow !== "none";
    const bg = s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== pbg;
    return b || sh || bg || /card|panel|tile|kpi|stat|widget|surface|m1-/i.test(cls(e));
  }

  // FIX 1: resolve through unstyled wrappers, but measure the CELL rect.
  function proxy(child, pbg) {
    const cr = child.getBoundingClientRect();
    if (cr.width < 140 || cr.height < 56) return null;
    if (styled(child, pbg)) return child;
    let cur = child, guard = 0;
    while (cur && guard++ < 4) {
      const kids = Array.from(cur.children).filter((k) => { const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (kids.length !== 1) break;
      cur = kids[0];
      const r = cur.getBoundingClientRect();
      if (styled(cur, pbg) && r.width * r.height >= cr.width * cr.height * 0.7) return child;
    }
    return null;
  }

  function analyse() {
    const root = shellRoot();
    if (root.querySelectorAll("*").length > 9000) return { rows: [], overflow: [], scrollports: [], bounded: true };
    const res = { rows: [], overflow: [], scrollports: [] }; const seen = new Set();
    for (const el of root.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      if (s.display !== "grid" && s.display !== "flex") continue;
      const pbg = s.backgroundColor;
      const kids = Array.from(el.children).filter((k) => {
        const ks = getComputedStyle(k);
        if (ks.display === "none" || ks.visibility === "hidden") return false;
        const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      if (kids.length < 2) continue;
      const cards = kids.filter((k) => proxy(k, pbg));
      if (cards.length < 2) continue;
      const byTop = new Map();
      for (const c of cards) {
        const r = RR(c); let b = null;
        for (const k of byTop.keys()) if (Math.abs(k - r.t) <= 6) { b = k; break; }
        if (b === null) { b = r.t; byTop.set(b, []); }
        byTop.get(b).push({ el: c, r });
      }
      for (const [top, items] of byTop) {
        if (items.length < 2) continue;
        const hs = items.map((i) => i.r.h), ws = items.map((i) => i.r.w);
        const hDelta = Math.max(...hs) - Math.min(...hs), wDelta = Math.max(...ws) - Math.min(...ws);
        const id = sig(el) + "|" + top + "|" + items.length;
        if (seen.has(id)) continue; seen.add(id);
        const spans = items.map((i) => { const g = getComputedStyle(i.el); return g.gridColumn || g.flexBasis || ""; });
        const uniformSpan = new Set(spans).size === 1;
        // FIX 3: a width delta only counts when the grid's own tracks are equal.
        const tracks = (s.gridTemplateColumns || "").split(" ").map(parseFloat).filter((n) => !isNaN(n));
        const equalTracks = tracks.length > 1 && Math.max(...tracks) - Math.min(...tracks) <= 2;
        const flagged = hDelta > 8 || (wDelta > 8 && uniformSpan && s.display === "grid" && equalTracks);
        res.rows.push({ owner: sig(el), display: s.display, cols: (s.gridTemplateColumns || "").slice(0, 110),
          gap: s.gap, rowGap: s.rowGap, colGap: s.columnGap, alignItems: s.alignItems, padding: s.padding,
          n: items.length, top, heights: hs, widths: ws, hDelta, wDelta, uniformSpan, flagged,
          cards: flagged ? items.map((i) => { const c = getComputedStyle(i.el);
            return { sig: sig(i.el), h: i.r.h, w: i.r.w, x: i.r.x, pad: c.padding, alignSelf: c.alignSelf,
                     gridCol: c.gridColumn, minH: c.minHeight, height: c.height }; }) : [] });
      }
    }
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) res.overflow.push({ el: "html", scrollW: de.scrollWidth, clientW: de.clientWidth });
    for (const el of root.querySelectorAll("*")) {
      const s = getComputedStyle(el);
      // threshold >4px: smaller deltas are sub-pixel track rounding, proven noise.
      if (el.scrollWidth > el.clientWidth + 4 && s.overflowX === "visible" && el.clientWidth > 200)
        res.overflow.push({ el: sig(el), scrollW: el.scrollWidth, clientW: el.clientWidth });
      if ((s.overflowY === "auto" || s.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 200)
        res.scrollports.push({ el: sig(el), scrollH: el.scrollHeight, clientH: el.clientHeight });
    }
    res.overflow = res.overflow.slice(0, 10); res.scrollports = res.scrollports.slice(0, 10);
    return res;
  }

  async function run() {
    const ok = await settle(); const a = analyse(); const f = a.rows.filter((r) => r.flagged);
    return { route: location.pathname, settled: ok, dir: document.documentElement.dir, lang: document.documentElement.lang,
      theme: /dark/.test(document.documentElement.className) ? "dark" : "light",
      vw: document.documentElement.clientWidth, vh: innerHeight,
      els: document.getElementsByTagName("*").length,
      rootKids: (document.getElementById("root") || { children: [] }).children.length,
      totalRows: a.rows.length, cardsMeasured: a.rows.reduce((n, r) => n + r.n, 0),
      flaggedCount: f.length, flagged: f.slice(0, 14), overflow: a.overflow, scrollports: a.scrollports, bounded: !!a.bounded };
  }
  return { settle, analyse, run, key, RR, sig };
})();
```

**Sweep driver contract.** Before each route capture `key()`; `pushState` +
`PopStateEvent`; wait (max 3 s) until `key()` changes — FIX 2, this is what proves
the DOM belongs to the new route; then `run()`. A row is PASS only when
`landed === route && settled && domChanged`. Budget each slice to 30 s or less:
the CDP evaluator hard-times-out at 45 s. `/dashboard` must reproduce
7 x (255 x 172) + 3 x (622 x 340) with 0 flags before any sweep is trusted.

---

## Session 2 — LTR pass at Production `5c123e3`, and a reproducible app-boot failure

### Measured — Light theme, English LTR, **1430 × 900 CSS** (rung B), Production `5c123e3`

Run in the Claude Browser pane (exact viewport emulation, dpr 1.25).

Readings 100 · distinct routes 97 · **trusted PASS 65** ·
**peer cards 378** · **peer groups 138** · **geometry flags 1** · aliases 0 ·
page-level horizontal overflow **0**.

The single flag is `/reports/inventory` — the same `items-start` collapsible
`SectionCard` grid already classified **intentional** in session 1. It reproduces
identically in LTR at 1430 px, which strengthens that classification: the
asymmetry is content-driven, not direction- or width-driven.

`/dashboard` was re-validated at this viewport and SHA before the sweep:
3 peer rows, 10 cards, 0 flags. The recurring `/dashboard` "overflow" is now
**fully explained and closed**: `div.mt-2.divide-y.divide-border` is 305 px wide
with six `-mx-2` children at 321 px — an intentional symmetric −8 px full-bleed so
the row hover/active highlight extends past the text column. Clipped by the
shell's `overflow-x-hidden`; zero elements escape the content box; no page-level
overflow. **Not a defect.**

### Cross-check against session 1

Session 1 (Light/RTL @ 2288 px, Production `041a8a6`) and session 2 (Light/LTR
@ 1430 px, Production `5c123e3`) agree: **no genuine card-order, card-size,
grid, spacing, overflow or scroll-ownership defect has been found on any route
measured under a trusted reading.** Combined trusted coverage: **1255 peer cards
across 433 peer groups**. Confirmed defects remain **0**; code changed remains
**none**.

### Reproducible app-boot failure — NOT a geometry finding, needs its own investigation

Partway through the LTR sweep (from `/marketing/ai-center` onward, 32 routes) the
app stopped rendering: `#root` empty, 46 static elements, `documentElement.dir`
empty, title stuck at the default. Those 32 rows were correctly rejected by the
`domChanged` + `settled` gate and are **not** counted above.

What is established:

- **Reproducible in two independent browsers** (the user's Chrome profile, and
  the Claude Browser pane) — in both cases after sustained authenticated
  synthetic SPA navigation.
- **Persists across full page loads**, not just within a session. A hard
  navigation to `/dashboard` still yields `rootKids: 0`.
- In Chrome it also killed the **public** `/login` route.
- **Not caused by the auditor's storage.** Removing every auditor key
  (23,761 → 2,474 chars of localStorage) and reloading did **not** restore it.
- **Not a Production outage.** All routes return HTTP 200, and the *identical*
  build `app-CcxBkJV1-5c123e3cfec6.js` rendered correctly in the Browser pane
  before that pane had been swept — `rootKids: 2`. Service workers: none.
  Caches: none. 16/16 JS chunks 200 with valid decoded bodies. A synthetic
  `type="module"` script executes. No console errors captured.

Per the permanent rule, an empty `#root` while Production is healthy is an
automation-session failure and **Production was not touched**. But the fact that
it now reproduces in a second, clean browser and survives reload means it should
**not** be dismissed as pure automation noise. It is logged here as an open
question for a separate, behaviour-focused investigation — it is out of scope for
this presentation-only programme.

**Repro:** authenticate, then drive ~60–90 `history.pushState` + `PopStateEvent`
route transitions across the ERP shell at ~1.5 s intervals; the shell stops
mounting and does not recover on reload.

**Practical consequence for this programme:** the sweep must be split into
batches of well under ~60 route transitions, with a real page load between
batches, and `/dashboard` re-validated after each batch.

### Matrices after session 2

| Dimension | State |
|---|---|
| Light / RTL @ 2288 (`041a8a6`) | 75 PASS · 3 explained · 13 ALIAS · 21 unverified · 6 deferred |
| Light / LTR @ 1430 (`5c123e3`) | 65 PASS · 1 explained · 32 rejected (boot failure) |
| Dark (either direction) | **not run** |
| Responsive rung A (1920) / C (1024) / D (768) | **not run** |
| Internal states | **not run** |
| Pathological surfaces (7) | **not run** — bounded sampling still owed |
| Frozen-reference re-sweep | n/a — no shared owner changed |

### RESUME MARKER (supersedes session 1)

**Still nothing deployed. `main` and Production untouched by this programme.
Zero code changes across both sessions.**

1. Open a **fresh** browser context and sign in (agent never handles credentials).
2. Paste the auditor from the Appendix. Validate `/dashboard` first — at 1430 px
   expect 3 rows / 10 cards / 0 flags; at 2288 px expect 7 × (255 × 172) and
   3 × (622 × 340).
3. Re-measure the 32 routes rejected by the boot failure (`/marketing/*`,
   `/ai-studio/*`, `/admin/*`, `/ai/settings`, `/billing`, `/users`, `/expenses`)
   **in batches of ≤40 transitions with a real reload between batches.**
4. Then: Dark pass, rungs A/C/D, the 21 session-1 unverified routes, the 7
   pathological surfaces (bounded → `PASS_BOUNDED`), then internal states.
5. Re-fetch `origin/main` immediately before any push — a second visual
   programme is shipping to the same files, and Production already moved 29
   commits mid-audit once.

---

## Session 3 — Dark/RTL pass at Production `4362f27`, and the first genuine defect

Chrome restored. Auditor re-validated against the frozen reference **before** any
reading was trusted: `/dashboard` @ 1526 px → 2 peer rows, 10 cards, 0 flags,
`rootKids: 2`. Production re-baselined: `origin/main` = Production = **`4362f27`**
(fingerprint `4362f27d6883`); the ledger branch was rebased onto it.

### Measured — **Dark** theme, Arabic RTL, 1526 × 647 CSS, Production `4362f27`

Swept in three batches of ≤34 transitions with a real page load between batches
(the mitigation recorded in session 2). `rootKids` was asserted on every single
reading — the empty-root condition **did not recur**; all three batches completed
with a healthy shell.

Readings 98 · distinct routes 97 · **trusted PASS 93** · **peer cards 931** ·
**peer groups 330** · **geometry flags 1** · page-level horizontal overflow **0**.

The single flag is `/marketing/ai-center/leads` — the main-column-beside-`xl:sticky`-aside
layout already classified **intentional** in session 1. It reproduces identically
in Dark/RTL at 1526 px, confirming the classification is not theme- or width-dependent.

Four routes did not earn a trusted reading and remain open: `/dashboard`
(first route of the batch, so no `domChanged` transition), `/accounting/audit-trail`,
`/analytics`, `/users`.

**Dark matrix is now materially covered** — 93 routes, and it agrees with the
Light passes: no card-order, card-size, grid, spacing or scroll-ownership defect.

### DEFECT 1 — `NEEDS_FIX` — helper text overflows its card by 118 px

The `/settings/*` overflow cluster recurred in **every** pass (Light/RTL @ 2288,
Light/LTR @ 1430, Dark/RTL @ 1526). Under the raised >4 px threshold it survived,
so it was traced properly rather than dismissed as rounding.

**Measured** on `/settings/company`, Dark/RTL @ 1526:

| Element | clientWidth | scrollWidth | overflow |
|---|---|---|---|
| `div.grid.gap-4.md:grid-cols-2` | 586 | 704 | **118 px** |
| `label.block.rounded-2xl.p-4` (card) | 283 | 394 / 402 | **111 / 119 px** |
| `span.text-xs` (the offender) | — | width 286 | **118 px past the card edge** |

Page-level overflow is 0 and nothing escapes `.m1-shell-content`, so this does
not break the page — but the helper text spills outside its own card border.

Initially invisible to the probe: in RTL the overflow runs **leftward**, and the
first pass only measured `right − right`, returning `deep: []`. Re-measuring on
`gr.left − r.left` located it immediately. **Carry forward: always measure
overflow on both axes; a right-edge-only probe is blind in RTL.**

**Cause.** The span renders the raw stored URL —
`/uploads/products/cloudinary/najfotyasnflc7vvsnyf.jpg` — a single token with no
break opportunity. It sits in a `flex flex-wrap items-center gap-2` row, and flex
items default to `min-width: auto`, so the span refuses to shrink below its
content width and `white-space: normal` cannot wrap it.

**Owner.** `src/modules/settings/pages/SettingsCenter.jsx:1424`, inside
`BrandingUploadField` (declared line 1347):

```jsx
<span className={`text-xs ${mutedText}`}>{safeValue || "Paste image URL or upload a file"}</span>
```

**Consumers enumerated.** `BrandingUploadField` is used exactly twice, both in
this file — line 1478 (company logo) and line 1485 (favicon). The visually similar
`VisualUpload` (storefront tabs, lines 1527/1528/1553/1592) is a *separate*
component and must be measured independently before assuming the same fix
applies; the `/settings/storefront` and `/website/settings` overflow rows suggest
it carries the same idiom.

**Classification: genuine defect, not intentional.** It is data-dependent — it
only manifests once a long upload path is stored, which is why it tracks the
settings family rather than one route.

**Proposed minimal presentation-only fix** (not applied — see below):
add `min-w-0 break-all` to that span, letting the flex item shrink and the path
wrap. No behaviour, no payload, no localization, no upload-flow change.

**Why it is not shipped in this session:** a safe release requires focused tests,
lint, build, failure-identity comparison, `origin/main` reconciliation, a rollback
ref at the live Production SHA, a race check, push, a real Vercel deploy wait and
a post-deploy re-measure of the exact geometry. There was not enough remaining
context to complete that cycle honestly, and shipping an unverified edit to `main`
— especially with a second programme actively pushing to the same tree — is
exactly what the release discipline forbids. It is recorded here as
**NEEDS_FIX** with the measurement, owner and fix so the next session can execute
the full cycle immediately.

### Coverage after three sessions

| Pass | Viewport | Prod SHA | PASS | Cards | Groups | Flags |
|---|---|---|---|---|---|---|
| Light / RTL | 2288 | `041a8a6` | 75 | 877 | 295 | 3 (intentional) |
| Light / LTR | 1430×900 | `5c123e3` | 65 | 378 | 138 | 1 (intentional) |
| **Dark / RTL** | **1526×647** | **`4362f27`** | **93** | **931** | **330** | **1 (intentional)** |

**Combined trusted coverage: 2186 peer cards across 763 peer groups.**
Confirmed defects: **1** (`NEEDS_FIX`, above). Code changed: **none**.
Checkpoints deployed: **0**. Shared owners changed: **0**.

### Matrices

| Dimension | State |
|---|---|
| Light / RTL | 75 PASS (at `041a8a6`; provisional vs current SHA) |
| Light / LTR | 65 PASS (at `5c123e3`) |
| Dark / RTL | **93 PASS (at `4362f27`, current)** |
| Dark / LTR | **not run** |
| Responsive rungs A (1920) / C (1024) / D (768) | **not run** |
| Internal states | **not run** |
| Pathological surfaces (7) | **not run** — bounded sampling still owed |
| Frozen-reference re-sweep | n/a — no shared owner changed |

### RESUME MARKER (supersedes session 2)

**Nothing deployed. `main` and Production untouched. Zero code changes.**

1. **Ship DEFECT 1** through the full release cycle: apply `min-w-0 break-all` at
   `SettingsCenter.jsx:1424`; first measure `VisualUpload` on
   `/settings/storefront` and `/website/settings` to see whether it needs the same
   correction (fix the real owner, do not patch two pages if one primitive owns
   it). Then tests / lint / build / failure-identity / reconcile `main` /
   rollback ref at the live Production SHA / race check / push MAIN ONLY / wait
   for the deploy / re-measure the exact card (expect card `scrollWidth` to equal
   `clientWidth`, and the 118 px to become 0) / re-check the frozen references.
2. Clear the 4 open Dark routes: `/dashboard`, `/accounting/audit-trail`,
   `/analytics`, `/users`.
3. Dark/LTR pass; responsive rungs A/C/D; the 21 session-1 unverified routes; the
   7 pathological surfaces (bounded → `PASS_BOUNDED`); internal states; final
   regression sweep.
4. Batch every sweep to ≤34 transitions with a real page load between batches, and
   assert `rootKids > 0` on every reading — that combination held for 98
   consecutive readings this session with no empty-root recurrence.
5. Re-fetch `origin/main` immediately before any push; Production has already
   moved twice mid-programme (`041a8a6` → `5c123e3` → `4362f27`).

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

---

## Session 4 — CHECKPOINT 1 SHIPPED AND PRODUCTION-VERIFIED

### VisualUpload measured independently first — and deliberately NOT changed

Before touching anything, `VisualUpload` was measured on its own, per instruction.
Source: it already pairs a `min-w-0` column (line 3693) with a `truncate` value
line (line 3695). Rendered proof on `/settings/storefront` (Dark/RTL @ 2288):
**`boxCount: 0`**, and all four upload cards read `scrollWidth === clientWidth`
(380/380, 380/380, 779/779, 779/779).

**`VisualUpload` is clean and was left untouched.** Assuming a shared owner and
patching both would have been wrong. The defect is confined to
`BrandingUploadField`.

### DEFECT 1 — FIXED_VERIFIED

**Owner:** `src/modules/settings/pages/SettingsCenter.jsx`, `BrandingUploadField`.
**Consumers:** exactly two, both in this file — line 1478 (company logo), line 1485 (favicon).

**Fix (presentation only, 2 lines).** Mirrors the proven-correct sibling:

- the right column `div.space-y-2` → `div.min-w-0 space-y-2` (a grid item cannot
  shrink below content without `min-width: 0`)
- the value span → `min-w-0 truncate`

No behaviour, payload, upload flow, copy or localization change.

**Validation.** Lint 0 errors (4 pre-existing warnings, none on the changed
lines). `vite build` green, twice — once before and once after reconciling onto
the moved `main`. Design/visual/navigation guards: **58/58 pass**
(`design-tokens-guard`, `global-surface-normalization`, `dashboard-kpi-number-layout`,
`main-layout-collapsed-sidebar`, `dashboard-redesign`, `i18n-navigation-guard`).

**Failure identity.** `i18n-hardcoded-guard` fails — and fails *identically on the
clean base*: `arabic: 1234 -> 1236`, `total: 2318 -> 2320`, attributed to
`src/modules/aiSupport/pages/AiInbox.jsx`, another workstream's file. Verified by
stashing the change and re-running. **Zero newly introduced failures.**

**Safe Release.** Rollback ref `rollback/pre-layout-geometry-cp1-20260813` → `dc985f6`
(the live Production SHA at push time). Re-fetched, rebased onto `dc985f6`,
rebuilt, race-checked (`main` unmoved), pushed **MAIN ONLY**: `dc985f6..e7b5745`.

**Production verified.** Deployed bundle `app-CeeNlxJy-e7b5745938c2.js`; ancestry
of `e7b5745` in `origin/main` proven.

**Post-deploy re-measurement — `/settings/company`, Dark/RTL @ 2288:**

| Element | Before | After |
|---|---|---|
| `div.grid.gap-4.md:grid-cols-2` | 586 / **704** (+118) | — no longer overflowing |
| branding card A | 283 / **394** (+111) | 283 / **283** (0) |
| branding card B | 283 / **402** (+119) | 283 / **283** (0) |
| right column `space-y-2` | 151 / **278** (+127) | 151 / **151** (0) |
| overflowing boxes on route | **11** | **0** |
| page-level horizontal overflow | 0 | 0 (unchanged) |

Route re-audit after the fix: 8 peer rows, 16 cards, **0 flags, 0 overflow,
0 escapes**. State: **FIXED_VERIFIED**.

### Frozen-reference regression check

| Route | Result |
|---|---|
| `/dashboard` | 2 rows, 10 cards, **0 flags** — identical to the trusted baseline |
| `/products` | 0 peer rows, **0 flags**, page overflow 0 — see DEFECT 2 below |
| `/settings/company` | 8 rows, 16 cards, 0 flags, 0 overflow |
| `/settings/storefront` | 0 overflow, VisualUpload cards all `sw === cw` |
| `/orders`, `/customers`, `/inventory` | **not re-checked** — session ended first |

No regression attributable to the change. Blast radius is two call sites in one
file; no shared primitive was touched.

### DEFECT 2 — NEEDS_FIX — `/products` row-action cluster overflows by 42 px

Found during the frozen-reference check. **Cannot be caused by checkpoint 1** —
that change is confined to `SettingsCenter.jsx`, which `/products` does not use.
Pre-existing, and newly surfaced only because the bidirectional probe now runs on
frozen references too.

**Measured** (`/products`, Dark/RTL @ 2288): `div.hidden.items-center.gap-1.5.lg:flex`
— `clientWidth 184`, `scrollWidth 226`, **+42 px**, repeated on **10 rows**.
`escCount 0`, `htmlOvf 0` — it does not break the page, but the per-row action
buttons overflow their own cell container.

Not yet traced to a source owner, and **not yet classified** intentional vs
defect. `/products` is a frozen reference for the *colour* programme; geometry is
owned by this programme, so it is in scope — but it must be traced and classified
before any edit.

### Automation note

The empty-root condition recurred once, on `/settings/company`, after ~98 sweep
transitions plus ~6 direct navigations in the session. Recorded per protocol; the
new bundle had fetched correctly, so Production was **not** implicated and **not**
rolled back. A fresh tab restored a healthy shell immediately and the auditor was
re-validated against `/dashboard` before any further reading was trusted. The
separate workstream owns that incident; no router/auth/bootstrap code was touched.

### Programme state

| Item | Value |
|---|---|
| Checkpoints deployed | **1** (`e7b5745`) |
| Rollback refs | `rollback/pre-layout-geometry-cp1-20260813` → `dc985f6` |
| Shared owners changed | 0 (one page-local component, 2 consumers) |
| Defects found | 2 · fixed & verified **1** · open **1** |
| Production at session end | `c7f2e51` (moved again by another workstream; `e7b5745` is an ancestor) |

Combined trusted coverage across four sessions: **2186 peer cards, 763 peer groups**
(Light/RTL @2288, Light/LTR @1430, Dark/RTL @1526), plus this session's targeted
re-measurements.

### RESUME MARKER (supersedes session 3)

1. **DEFECT 2** — trace the `/products` row-action cluster owner, classify, and if
   a defect run the same full cycle (it is a table row-action group, so check
   whether the owner is a shared table primitive before editing).
2. Finish the frozen-reference check: `/orders`, `/customers`, `/inventory`.
3. Dark/LTR pass; responsive rungs A (1920) / C (1024) / D (768) — **note Chrome
   still cannot resize width** (`outerWidth` pinned to screen width; only height
   responds). The Claude Browser pane has exact emulation (1430×900 verified) and
   is the correct tool for the responsive ladder.
4. The 21 session-1 unverified routes; 4 open Dark routes (`/dashboard`,
   `/accounting/audit-trail`, `/analytics`, `/users`); the 7 pathological
   surfaces (bounded → `PASS_BOUNDED`); internal states; final regression sweep.
5. Batch sweeps to ≤34 transitions with a real page load between, assert
   `rootKids > 0` on every reading, and keep the **bidirectional** overflow rule
   enabled — a right-edge-only probe is blind in RTL and nearly hid DEFECT 1.
6. Re-fetch `origin/main` immediately before every push. Production moved four
   times during this programme: `041a8a6` → `5c123e3` → `4362f27` → `dc985f6` →
   `e7b5745` (ours) → `c7f2e51`.

---

## Session 5 — DEFECT 2 dismissed on evidence; Fluid Workspace Width dimension; DEFECT 3 found

### DEFECT 2 (`/products` row actions) — **NOT_A_DEFECT**, no code change

Diagnosed read-only, as instructed. The arithmetic settled it before any edit:

| Quantity | Value |
|---|---|
| action buttons | 5 × 32 px (`h-8 w-8 shrink-0`, `flex-shrink: 0`) = 160 |
| column gaps | 4 × 6 px = 24 |
| **intrinsic width required** | **184** |
| **container `clientWidth`** | **184** |

The cluster fits its column **exactly**. The reported `scrollWidth` of 226 comes
from **five `position: absolute`, `opacity: 0`, `pointer-events: none` hover
tooltips** (تعديل / الأسعار / المخزون …), one per button, centred on their button
and therefore overhanging the cluster edge. They are out of flow, invisible until
hover, and non-interactive. `escCount 0`, `htmlOvf 0`.

**Root cause was the auditor, not the UI.** `scrollWidth` counts out-of-flow
boxes. Had this been "fixed" by clipping, hiding actions or shrinking the 32 px
targets, it would have damaged working, accessible UI to satisfy a bad metric.

**Auditor fix #6 — `__ovf2`.** Overflow is now computed from **in-flow
descendants only**: any element with an `absolute`/`fixed` ancestor inside the
shell is excluded, and overflow is measured against the container's *padding
box* rather than read from `scrollWidth`.

**Validation that the corrected probe is not blind.** A DOM-only regression
experiment on `/settings/company` (this browser only; Production untouched):

| State | `boxCount` | Culprit named |
|---|---|---|
| shipped fix present | 1 | — |
| fix classes removed in DOM | **5** | `span.text-xs` / `/uploads/products/cloudinary/…` overflowing **126–128 px** |
| classes restored | 1 | — |

The probe still catches genuine in-flow overflow and names the exact offending
node and text. `/products` under `__ovf2`: **`boxCount: 0`**.

**Auditor fix #7 — scrollport-aware escapes.** Elements inside an ancestor with
`overflow-x: auto|scroll` legitimately extend past the shell. The escape counter
now separates `escInScrollport` from `escNotInScrollport`; only the latter counts.

**Full-bleed idiom classified.** Symmetric negative margins that exactly cancel
the parent's padding (`header.sticky` with `margin: 0 -32px` inside `padding: 32px`;
the dashboard's `-mx-2` rows) are intentional edge-to-edge treatments, not
overflow. Recognised, not "fixed".

### NEW DIMENSION — Fluid Workspace Width, full matrix

`__ws` records per route: `availableWorkspaceWidth` (shell content box, inside its
own padding), `pageContentWidth` (widest in-flow content subtree),
`workspaceUtilization`, **logical** start/end gutters (RTL-aware), gutter symmetry,
the first genuinely binding width-capping ancestor, and the content owner.

**Run across the full 97-route matrix, Dark / Arabic RTL / 2288 px, Production
`c7f2e51`. 96 of 97 trusted.**

| Metric | Value |
|---|---|
| utilization — median | **100 %** |
| utilization — min | 76.4 % |
| utilization — max | **175 %** |
| routes with asymmetric gutters | **1** |
| routes with page-level horizontal overflow | **0** |
| routes with in-flow escapes | **1** (see DEFECT 3) |

**Marketing family — intentional cap, not a defect.** 20 `/marketing/*` routes sit
at **76.4 %** utilization: content 1480 px inside 1937 px available, capped by a
binding `max-width: 1480px` shared across the whole family, with symmetric
gutters. A deliberate reading-measure cap on a studio surface, applied
consistently — recorded as intentional, left alone.

**`/settings/permissions` — NOT a defect.** 696 elements extend past the shell,
but **all 696 are inside a legitimate horizontal scrollport**
(`escNotInScrollport: 0`) and the widest in-flow element is 1937 px — exactly the
available workspace. A wide permissions matrix in a proper scroller. Reachable,
not clipped.

### DEFECT 3 — `NEEDS_FIX` — `/marketing/posts` content is ~1.7× the workspace and is clipped

| Quantity | Value |
|---|---|
| available workspace | 1937 px |
| page content width | **3389 px** |
| workspace utilization | **175 %** |
| logical gutters (start / end) | **+382 / −1833** — grossly asymmetric |
| in-flow elements escaping the shell | **124** |
| inside a scrollport? | **No** — `escInScrollport: 0` |
| page-level horizontal overflow | 0 |

`htmlOvf: 0` with no scrollport is the damning combination: the shell's
`overflow-x-hidden` **clips** the excess, so roughly 1400 px of content is not
merely off-screen but **unreachable** — it cannot be scrolled to. Contrast
`/settings/permissions`, where the same raw escape signal is fully explained by a
scroller.

Owner chain (RTL, overflowing **leftward** by up to 1803 px):

```
article.rounded-[var(--radius-card)].border…      3389
  div.flex.flex-col.gap-4.lg:flex-row             3354
    div.min-w-0.flex-1                            3241   <- min-w-0 present yet still 3241
      div.flex.flex-wrap.items-center.gap-2       3241   <- flex-wrap not wrapping
```

`min-w-0` is already present on the flex child and the wrap container is not
wrapping, so the width is being forced by an intrinsic-width child inside the
chip/tag row. **Not yet traced to the source component and not yet classified** —
the next session must find what establishes the 3241 px intrinsic width before
proposing any correction. Do **not** fix by clipping or hiding.

### Programme state

| Item | Value |
|---|---|
| Checkpoints deployed | 1 (`e7b5745`, verified) |
| Defects: found / fixed+verified / dismissed on evidence / open | 3 / 1 / 1 / **1** |
| Code changed this session | **none** |
| Production at session end | `c7f2e51` |
| Auditor fixes to date | **7** |

### RESUME MARKER (supersedes session 4)

1. **DEFECT 3** — trace what forces 3241 px inside `div.flex.flex-wrap.items-center.gap-2`
   on `/marketing/posts`; enumerate consumers; classify; minimal presentation-only
   fix; full Safe Release + post-deploy re-measure (expect utilization → ≈100 %,
   `escNotInScrollport` → 0, gutters symmetric).
2. Re-run the Fluid Workspace matrix at the other rungs — **Claude Browser pane**
   (exact emulation, 1430×900 verified) for wide 1920 / normal 1440 / narrow 1024
   / 768; Chrome cannot control width.
3. Finish frozen references `/orders`, `/customers`, `/inventory`; Dark/LTR;
   internal states; 7 pathological surfaces (bounded → `PASS_BOUNDED`); 21
   session-1 unverified routes; 4 open Dark routes; final regression sweep.
4. Keep the **bidirectional** overflow rule, the **in-flow-only** rule (#6) and the
   **scrollport-aware** escape rule (#7) enabled — each one prevented a false
   defect this session.

---

## Session 6 — DEFECT 3 FIXED_VERIFIED (two checkpoints); Marketing cap classified

### The trace corrected a wrong first attribution — recorded honestly

The first hypothesis was that `span.truncate` (3197 px, `nowrap`) was the width
originator, and cp2 shipped `min-w-0` on it. **Post-deploy measurement disproved
that**: build `729d979f8450` carried the class (`min-w-0 truncate` present in the
DOM) yet the span was still 3197 px and utilisation still 175 %. The span was being
*stretched*, not forcing.

Walking **up** from the card found the real owner:

```
div.grid.gap-4        width 1174   grid-template-columns: 3388.52px  <-- track blown out
  article             width 3389   min-width: auto                   <-- the forcing item
```

The card is a grid item with the default `min-width: auto`, so the track's
automatic minimum equals the card's **min-content** width — which the `nowrap`
caption inflates to ~3197 px. The single column therefore resolved to 3388.52 px
inside a 1173.64 px grid.

**Proven in the live DOM before editing** (toggle test, this browser only):

| State | grid track | article | utilisation | caption |
|---|---|---|---|---|
| as deployed | 3388.52 px | 3389 | 175 % | 3197 |
| `min-w-0` added to article | **1173.64 px** | **1174** | **76.4 %** | **1011 (truncated)** |
| removed again | 3388.52 px | 3389 | 175 % | — |

cp2 was **necessary but not sufficient**: the caption only truncates because it
also carries `min-w-0`. Both are required; neither alone fixes it.

### Checkpoints

| # | Change | Rollback ref | Released | Production verified |
|---|---|---|---|---|
| cp2 | `min-w-0` on the caption span, `shrink-0` on the `#id` badge (`SocialPosts.jsx:148`) | `rollback/pre-layout-geometry-cp2-20260813` → `2ca5784` | `729d979` | deployed; insufficient alone (recorded above) |
| cp3 | `min-w-0` on the post card `<article>` (`SocialPosts.jsx:123`) | `rollback/pre-layout-geometry-cp3-20260813` → `729d979` | `6b0dff3` | **FIXED_VERIFIED** |

Validation for both: lint 0 errors, `vite build` green, design/visual/navigation
guards **58/58** then **54/54** pass, no newly introduced failures.

### DEFECT 3 — post-deploy re-measurement on build `6b0dff35b77e`

| Metric | Before | After |
|---|---|---|
| `availableWorkspaceWidth` | 1937 | 1937 |
| `pageContentWidth` | **3389** | **1480** |
| `workspaceUtilization` | **175 %** | **76.4 %** |
| logical gutter start / end | **+382 / −1833** | **229 / 229** |
| `gutterSymmetric` | false | **true** |
| `escNotInScrollport` | **124** | **0** |
| `escInScrollport` | 0 | 0 |
| overflow boxes | 4 | **0** |
| page-level horizontal overflow | 0 | 0 |
| grid track | 3388.52 px | **1173.64 px** |
| caption widths | 3197 / 2966 / 2956 | **1011 max, truncated** |

Roughly 1400 px per card is no longer clipped-and-unreachable.
State: **FIXED_VERIFIED**.

Scope discipline: the bare-`truncate` pattern appears **55 times** in `src`, but the
others sit inside `min-w-0` wrappers and did not reproduce the defect. No blanket
sweep was made.

### Marketing 1480 px cap — shared owner identified and classified

**Single shared owner:** `src/shared/layouts/AiMarketing.m1.css:2`

```css
.m1-ai-marketing-scope .m1-shell-content > div { max-width: 1480px; margin-inline: auto; … }
```

One blanket rule caps **every** direct shell child across the whole marketing
scope, with no distinction between reading-focused and operational surfaces —
precisely the "consistent, therefore unexamined" pattern.

**Objective squeeze test** (Dark/RTL @ 2288, 12 marketing routes): for every route,
detect horizontal scrollports actually overflowing while the 457 px of gutter sits
unused.

| Route | util | unused | tables | grids/cards | h-scroll squeeze | max squeeze px |
|---|---|---|---|---|---|---|
| `/marketing` | 76.4 % | 457 | 1 | 2 | **0** | **0** |
| `/marketing/analytics` | 76.4 % | 457 | 1 | 6 | **0** | **0** |
| `/marketing/attribution` | 76.4 % | 457 | 1 | 5 | **0** | **0** |
| `/marketing/posts` | 76.4 % | 457 | 0 | 13 | **0** | **0** |
| `/marketing/social-calendar` … `/marketing/ai-center/leads` | 76.4 % | 457 | — | — | **0** | **0** |

**Result: no marketing surface is being squeezed.** No table, grid or card cluster
overflows; nothing scrolls horizontally; nothing is clipped. The 457 px is
deliberate whitespace, not a functional constraint.

**Classification: `INTENTIONAL_CAPPED`, with the reason recorded** — a scope-wide
centred measure cap that, at the measured viewport, costs no functionality on any
of the 20 routes.

**Deliberately not changed, and why.** Several of these *are* operational
(dashboard with a table, analytics with 6 grids, attribution with a table plus 5
grids, posts with 13 cards, the calendar). Widening them would likely be an
improvement — but there is **no measured defect** behind it: nothing is
compressed, truncated or unreachable. Editing one CSS rule that governs 20
production routes on preference rather than evidence is a **design decision, not a
geometry correction**, and the standing instruction is not to remove the cap
blindly. It is therefore escalated as an explicit open design question rather than
shipped unilaterally.

**If it is later approved**, the correct shape is to scope the cap by surface type
in that one owner (reading-focused surfaces keep 1480 px; operational dashboards,
tables and card-management surfaces take the full workspace) — **not** to delete
the rule, which would also un-centre the reading surfaces.

### Programme state

| Item | Value |
|---|---|
| Checkpoints deployed | **3** (`e7b5745`, `729d979`, `6b0dff3`) |
| Rollback refs | cp1 → `dc985f6`, cp2 → `2ca5784`, cp3 → `729d979` |
| Defects: found / FIXED_VERIFIED / dismissed on evidence / open | 3 / **2** / 1 / **0** |
| `NEEDS_FIX` | **0** |
| Unexplained width caps | **0** (the 1480 px cap is explained, owner-identified, classified) |
| Auditor fixes to date | 7 |
| Production at session end | `6b0dff3` |

### RESUME MARKER (supersedes session 5)

1. **Open design question** (needs a human call, not a measurement): should the
   operational marketing surfaces keep the 1480 px cap? Owner and proposed shape
   recorded above.
2. Responsive rungs — Claude Browser pane (exact emulation; `/dashboard` verified
   at 1430×900: util 100 %, symmetric gutters, 0 escapes). Run the Fluid Workspace
   matrix at 1920 / 1440 / 1024 / 768.
3. Dark/LTR; frozen references `/orders` `/customers` `/inventory`; internal
   states; 7 pathological surfaces (bounded → `PASS_BOUNDED`); 21 session-1
   unverified routes; 4 open Dark routes; final regression sweep.
4. Keep all corrected auditor rules: out-of-flow geometry ignored, scrollport-aware
   escapes, symmetric full-bleed recognised, RTL overflow measured on both logical
   edges.
5. **Lesson recorded:** a wide descendant is not necessarily the originator. Walk
   *up* to the width-defining ancestor and confirm with a live toggle test before
   editing — the first attribution here was wrong and only the post-deploy
   measurement caught it.

---

## Session 7 — FLUID WORKSPACE RULING EXECUTED (cp4 + cp5)

The open design question escalated at the end of session 6 was **answered by the
user**: ordinary operational ERP surfaces should consume the available workspace
instead of sitting as narrow centred islands. This applies system-wide, not only
to Marketing. Fluid does **not** mean full-bleed — canonical shell gutters stay.

### Baseline

| Item | Value |
|---|---|
| Starting `origin/main` | `d56f7a3` |
| Starting Production | `d56f7a3` (fingerprint `d56f7a34c71e`) |
| `visual/layout-geometry` | `d56f7a3` — already merged, 0 ahead / 0 behind |

Worked in an isolated git worktree (`.claude/worktrees/fluid-workspace-convergence`)
because the shared checkout was dirty with a concurrent AI-inbox workstream.

### The user's three named surfaces mapped onto two owners

`/settings/company`, `/marketing/ai-center/leads` and `/admin/ai-channels` were
named as narrow islands. A source grep for page-level caps landed all three on
exactly two shared owners before a single measurement was taken —
`SettingsCenter.m1.css:2` and `AiMarketing.m1.css:2`.

### Caps are viewport-dependent — measure at the width the user actually uses

First measured at 1920 CSS px (1570 available): `/settings/company` reported
**100 %** utilisation and *no* binding cap, because a 1600 px cap cannot bind
inside 1570 px of workspace. Re-measured at the user's real **2288 px** (1938
available), the same route reports **82.6 %** with the cap binding.

**Rule carried forward: a width cap is invisible until the workspace exceeds it.
Always measure the fluid dimension at the widest viewport in use, not a
convenient one.** A 1440-px-only sweep would have reported this whole programme
as clean.

The auditor also gained an `effectiveContentWidth` notion: the shallowest
*binding* cap (depth ≤ 3), not the widest in-flow element — a full-bleed
background wrapper otherwise reports 100 % while the real content column is
capped far narrower underneath it.

### Baseline matrix — Light/RTL @ 2288 px (1938 available), Production `d56f7a3`

74 routes measured. Already fluid at **100 %**: `/dashboard`, `/orders`,
`/products` + all `/products/*`, the entire `/accounting/*` family, `/employees/*`,
all `/ai-studio/*`, `/workspace`, `/expenses`, `/users`, `/roles`, `/billing`,
`/loyalty`, `/staff/tasks`, `/inbox`, `/settings/users`, `/settings/permissions`,
`/settings/roles`.

Capped operational surfaces found:

| Utilisation | Unused | Routes | Owner |
|---|---|---|---|
| 59.4 % | 786 px | `/admin/ai-support-console` and family | 1480 + inner `max-w-6xl` |
| 66 % | 658 px | `/marketing`, `/marketing/attribution`, `/marketing/posts`, `/marketing/campaigns`, `/marketing/templates`, `/marketing/settings` | 1480 + inner `max-w-7xl` |
| 52.8 % | 914 px | `/ai/settings` | `max-w-5xl` |
| 76.4 % | 458 px | remaining 14 `/marketing/*` + `/admin/ai-*` | `AiMarketing.m1.css:2` |
| 79.3 % | 402 px | `/operations/shipping` | `max-w-[96rem]` |
| 82.6 % | 338 px | settings family, `/customers`, `/notifications`, `/reports/*`, `/website/settings` | four 1600 px owners |
| 92.9 % | 138 px | `/inventory/*`, `/purchases`, `/warehouses`, `/suppliers`, `/branches`, `/stock-transfers`, `/analytics`, `/smart-warehouse` | shared 1800 px shells |

### cp4 — marketing + AI operational scope

Live DOM toggle proof **before** editing (per session 6's lesson):
`/marketing/posts` and `/marketing` both 1480 → 1938 px, 76.4 % → 100 %, with
in-flow escapes 0 and page overflow 0 in **both** states, fully reversible.

Owners changed: `AiMarketing.m1.css:2` (width cap only — colour/font declarations
untouched) and the `max-w-7xl` page-root idiom in 8 files.

Post-deploy on `4952d4763dce`:

| Route | Before | After |
|---|---|---|
| `/marketing/posts` | 1480 / 76.4 % / caps [1480,1280] / gutters 229·229 | **1937 / 100 % / caps [] / gutters 0·0** |
| `/marketing` | 1280 / 66 % | **1937 / 100 %** |
| `/marketing/ai-center/leads` | 1480 / 76.4 % | **1937 / 100 %** |
| `/marketing/attribution` | 1280 / 66 % | **1937 / 100 %** |
| `/marketing/campaigns`, `/marketing/templates`, `/marketing/settings`, `/admin/ai-support-console` | 66–76.4 % | **100 %** |

`escNotInScrollport 0`, `escInScrollport 0`, `htmlOvf 0` on every route — widening
introduced **no** overflow. **DEFECT 3 regression check passed**: `/marketing/posts`
is the frozen `FIXED_VERIFIED` route, and the cp3 `min-w-0` fix still holds under
the now-wider container.

### cp5 — remaining operational owners

17 files. Shared shells (InventoryShell, OrdersShell, FlowShell, ReportsLayout,
Branches) plus the settings/customers/notifications/shipping/AI page roots.

`FlowShell`'s `wide` prop only ever selected between `max-w-none` and
`max-w-[1800px]`; with the cap gone it was dead and was removed with its single
caller.

**Deliberately kept:** `max-w-[calc(100vw-3rem)]` on the settings page root — a
viewport overflow guard, not a design cap.

### Checkpoints

| # | Scope | Rollback ref | Released |
|---|---|---|---|
| cp4 | marketing/AI scope, 9 files | `rollback/pre-layout-geometry-cp4-20260813` → `d56f7a3` | `4952d47` — **FIXED_FLUID_VERIFIED** |
| cp5 | remaining owners, 17 files | `rollback/pre-layout-geometry-cp5-20260813` → `4952d47` | `8498cbb` |

Both: eslint 0 errors, `vite build` green, guards 76/77 then 94/95. The single
failure (`typography-spacing-convergence`, `AiStudio.jsx: h-8` ×4) reproduces
**identically on the pristine base** — verified by stashing the changes and
re-running. Zero newly introduced failures.

### INTENTIONAL_CAPPED — with semantic reasons

| Surface | Cap | Reason |
|---|---|---|
| Modals across marketing/publisher | `max-w-6xl` / `max-w-5xl` with `max-h-[92vh]` | Focused overlay; a full-width dialog is harder to use, not easier |
| `/manager/inventory-approvals` | 672 px | Manager portal is a mobile-first focused surface; it renders without the ERP sidebar (2226 px available) and is designed as a single column |
| In-card prose (`max-w-3xl`, `max-w-2xl` on `<p>`) | 672–768 px | Readable line measure inside a card — §9 explicitly preserves this; the card itself is fluid |
| Global `--content-max: 1480px` | 1480 px | Untouched design token still used by `.m1-container`; only the Reporting Center opted out |

### Behaviour freeze

Honoured. Every edit is a `className` width utility or a CSS `max-width`
declaration. No API, DB, payload, calculation, permission, order-state,
inventory, payment, POS, workflow, localization or AI behaviour touched.


### Post-deploy verification of cp5 on `8498cbb3b4fb`

Every route below: `escNotInScrollport 0`, `escInScrollport 0`, `htmlOvf 0`,
gutters 0 · 0 symmetric, `rootKids 2`.

| Route | Before | After |
|---|---|---|
| `/settings/company` (user example) | 1600 / 82.6 % | **1937 / 100 %** |
| `/admin/ai-channels` (user example) | 1480 → 1536 / 79.3 % | **1937 / 100 %** |
| `/ai/settings` | 1024 / 52.8 % | **1937 / 100 %** |
| `/customers`, `/notifications`, `/website/settings` | 1600 / 82.6 % | **1937 / 100 %** |
| `/reports/sales`, `/reports/inventory`, `/reports/overview` | 1600 / 82.6 % | **1937 / 100 %** |
| `/inventory`, `/purchases`, `/warehouses`, `/suppliers`, `/branches`, `/stock-transfers`, `/smart-warehouse`, `/analytics` | 1800 / 92.9 % | **1937 / 100 %** |
| `/operations/shipping` | 1536 / 79.3 % | **1937 / 100 %** |
| `/settings/appearance`, `/marketing/social-comments` | capped | **1937 / 100 %** |

**Frozen-reference regression** (`/dashboard`, `/orders`, `/products`,
`/customers`): all 1937 / 100 % / 0 escapes / 0 overflow. No regression.

**Frozen defect regression:** DEFECT 1 (`/settings/company` branding overflow)
and DEFECT 3 (`/marketing/posts`) both still clean at the new wider widths.

### Two more auditor fixes

**Fix #8 — skeleton bars are not width owners.** `/analytics` reported 34.7 %
utilisation with "binding caps" of 896 and 672 px. Those were
`div.mt-5.h-12.max-w-4xl` and `div.mt-4.h-6.max-w-2xl` — **loading skeleton
placeholder bars**. A page-level cap must now also be ≥200 px tall and contain
≥8 descendants. Re-measured: `/analytics` is 100 %, zero caps.

**Fix #9 — an element that is *itself* a scrollport owns its overflow.**
`/reports/inventory` reported one in-flow escape: a `-mx-1 overflow-x-auto`
container overhanging **+4 px on both logical edges**. That is the symmetric
full-bleed idiom on a self-owned horizontal scroller. The scrollport test walked
only *ancestors*, so it missed that the element itself scrolls. `NOT_A_DEFECT`.

### Responsive matrix (changed shared owners)

| Rung | CSS width | Available | Result |
|---|---|---|---|
| A | 2288 | 1937 | all changed owners 100 %, 0 real escapes, 0 page overflow |
| B | 1440 | 1089 | all 100 %, 0 real escapes. `/customers` 9 escapes — all inside legitimate table scrollports |
| C | 1024 | 690 | `/dashboard` `/settings/company` `/marketing` `/reports/sales` `/warehouses` 100 % clean. `/suppliers` 185.6 % and `/customers` 156.6 % — **all** escapes inside table scrollports (`escReal 0`). **`/inventory` = DEFECT 4** |
| D | 768 | 713 | `/dashboard` `/settings/company` `/marketing` `/reports/sales` 100 %, 0 escapes, 0 page overflow |

**RTL / LTR:** measured both on `/settings/company`, `/marketing`, `/inventory` —
gutters `0 · 0`, utilisation 100 %, 0 escapes in **both** directions. The changes
are direction-invariant by construction: every cap removed was either a symmetric
`margin-inline:auto` centre or a `max-width`, and the result is a zero-gutter
full-width column with no handedness.

**Theme:** this session measured in **Light**. Geometry here is theme-independent —
no changed declaration is inside a `dark:` variant or theme-conditional block, and
no colour/typography contract was touched.

### DEFECT 4 — `NEEDS_FLUID_FIX` — `/inventory` at ≤1024 px, PRE-EXISTING

Found by the rung-C sweep. **Not caused by cp4/cp5** — proven, not assumed:
restoring `max-width: 1800px` on the page root in the live DOM produced
**byte-identical** numbers (content 1491, utilisation 216.1 %, `escReal` 19024).
A 1800 px cap cannot bind inside 690 px of workspace, so the cp5 edit is a no-op
at this viewport.

| Quantity | Value @ 1024 |
|---|---|
| available workspace | 690 px |
| page content width | **1491 px** |
| utilisation | **216 %** |
| in-flow escapes NOT in a scrollport | **19 024** |
| page-level horizontal overflow | 0 |

`htmlOvf 0` with no scrollport is the DEFECT 3 signature: the shell's
`overflow-x-hidden` **clips** the excess, so the content is unreachable.

Owner, established by walking **up** (walking *down* found only a stretched
`truncate`/`nowrap` node — the same trap that produced session 6's wrong first
attribution):

```
div.mt-4.grid.gap-3.xl:grid-cols-2   w 575   grid-template-columns: 1490.97px  <- track blown out
  div.relative.rounded-[…].border.p-4 w 1491  min-width: auto                   <- forcing grid item
```

**Open, deliberately not fixed here.** `min-width: 0` on the card alone does
**not** collapse the track (1491 unchanged), so the DEFECT 3 remedy does not
transfer directly and the originator inside the card is still unidentified.
Shipping a guess is exactly what session 6 proved costly. Scope: `/inventory`
only — `/warehouses`, `/suppliers`, `/customers`, `/reports/*` at 1024 are clean
or route their overflow through legitimate scrollports.

### Programme state after session 7

| Item | Value |
|---|---|
| Checkpoints deployed | **5** total (`e7b5745`, `729d979`, `6b0dff3`, **`4952d47`**, **`8498cbb`**) |
| Rollback refs (this session) | cp4 → `d56f7a3`, cp5 → `4952d47` (both pushed) |
| Shared width owners changed | **11** |
| Width caps removed | **26** across 26 files |
| Width caps preserved (explained) | 4 classes — modals, manager portal, in-card prose, `--content-max` token |
| Routes moved to 100 % utilisation | **40** |
| Defects: found / FIXED_VERIFIED / dismissed / **open** | 4 / 3 / 1 / **1 (DEFECT 4)** |
| Production at session end | **`8498cbb`** |
| Auditor fixes to date | **9** |

### RESUME MARKER (supersedes session 6)

1. **DEFECT 4** — `/inventory` at ≤1024 px. Find what establishes the 1491 px
   min-content width inside `div.relative.rounded-[…].border.p-4`; walk **up**,
   prove with a live toggle, then full Safe Release + post-deploy re-measure at
   **1024**, not just at wide.
2. Complete rungs C/D across the remaining ~60 routes — session 7 verified the
   changed owners at every rung, but the full matrix at 1024/768 is not swept.
   **Rung C is where defects actually live**; wide viewports hid DEFECT 4 entirely.
3. Dark-theme smoke on the 40 newly-fluid routes (geometry is theme-independent
   here, but the smoke is owed by the mandate).
4. Internal states (tabs, drawers, expanded filters) and the 7 pathological
   surfaces (bounded → `PASS_BOUNDED`) remain unswept.
5. **Rule added this session: a width cap is invisible until the workspace
   exceeds it.** Measure the fluid dimension at the widest viewport in real use.
   A 1440-only sweep reports this entire programme as clean.

---

## Session 8 — DEFECT 4 solved; rung C found three more; pathological surfaces closed

Resumed from the session-7 marker. `main` = Production = `721d93e` at start.
**Six** unrelated commits landed on `main` from other workstreams during this
session (pricing/POS, settings branding, two AI-inbox grounding fixes, two
inventory fixes). Each was fetched, inspected for layout impact and reconciled
before push; the 11 shared-owner Fluid Workspace corrections were re-verified
intact after the two that touched `SettingsCenter.jsx` and `InventoryDashboard.jsx`.

### DEFECT 4 — the previous attribution was wrong on both halves

Session 7 recorded "a grid item with `min-width:auto`" and that `min-w-0` on the
card did not fix it. Both halves needed correcting:

- **Why the earlier `min-w-0` test failed.** It was applied to **one** card. The
  track is the max over **693** items, so a single card cannot move it. Applying
  `min-width:0` to *all* items collapses the track 1490.97px -> 574.6px.
- **An offscreen clone measured the card min-content at 429px**, which looked like
  it disproved the mechanism. That figure is invalid — a detached clone loses its
  CSS context. Recorded as a trap: **never measure intrinsic width on a clone
  outside its ancestor chain.**

**Real owner.** Two sibling grids (neither contains the other) declare columns
only at `xl:`. Below that breakpoint the template is `none`, items auto-place into
an *implicit* auto track with no `minmax(0,...)` floor, and the track resolves to
max-content. Tailwind `grid-cols-1` is exactly `repeat(1, minmax(0,1fr))` — the
missing floor.

**Nothing is hidden by the fix.** With every item allowed to shrink, **zero**
descendants overflow their card: the content is fully compressible. The residual
980px is a `min-w-[980px]` 7-column data table inside a horizontal scroller — all
103 remaining wide descendants sit inside legitimate scrollports
(`notInScrollport: 0`). No clipping, no fixed widths, no hidden content, and
`htmlOvf` stayed 0 throughout, so no forced page scrolling.

### Three more instances, found by the new detector

`blownGrids` (a grid whose resolved tracks exceed its own box, excluding grids
inside scrollports) was added to the auditor and immediately surfaced three more —
**objectively, not by pattern-matching**:

| Defect | Route | Before | After |
|---|---|---|---|
| 5 | `/settings/permissions` | track 3795px in 690px, **46** escapes | track 689.8px, **0** |
| 6 | `/marketing/social-comments` | track 313.6px in 249px, **5** escapes | **0** |
| 7 | settings branding upload | 2 escapes, 2 blown grids, 24px overshoot | **0** |

DEFECT 7 had two causes in one component: the `justify-between` header row's
title/helper block had no `min-w-0`, so it could not shrink and pushed the
`shrink-0` "Clear image" button outside the card; and the thumbnail track was a
fixed `5.5rem` that could not shrink inside a 64px grid. Same component as
DEFECT 1, which fixed the URL text but not these controls.

**`/settings/permissions` was classified clean in session 5 — correctly, at wide
viewport, where `escNotInScrollport` was 0. The defect exists only below `xl`.**
This is the strongest evidence yet for the rung-C rule.

### Scope discipline

**747** grids in `src` declare columns only at a breakpoint. They were **not**
swept. Only the five that measurably blow out were changed. The detector now
carries the rule so future sweeps find them on evidence.

### Checkpoints

| # | Scope | Rollback ref | Released | Verified |
|---|---|---|---|---|
| cp6 | 2 grids in `InventoryDashboard`, 1 in `StockTransfers` | `rollback/pre-layout-geometry-cp6-20260813` -> `8a662a5` | `04aede2` | **FIXED_VERIFIED** |
| cp7 | `Permissions`, `SettingsCenter` x2, `SocialCommentsWorkspace` | `rollback/pre-layout-geometry-cp7-20260813` -> `ecb22a2` | `5d7f471` | **FIXED_VERIFIED** |

Both: eslint 0 errors, `vite build` green, guards 94/95 then 85/86 — the single
failure (`typography-spacing-convergence`, `AiStudio.jsx: h-8` x4) reproduces
identically on the untouched base. Zero newly introduced failures.

### Post-deploy verification

`/inventory` @1024 on `04aede2d022d`: content 1491 -> **980**, utilisation 216.1%
-> **142.1%**, `escNotInScrollport` **19024 -> 0**, blown grids **2 -> 0**,
`htmlOvf` 0.

`/settings/permissions` @1024 on `5d7f471e2dfd`: the fixed grid now carries
`grid-cols-1` and resolves to **689.8px** (was 3795.2px), escapes **46 -> 0**.
`/marketing/social-comments` and `/settings/company` @1024: escapes -> **0**,
blown grids -> **0**, utilisation 100%.

### Responsive matrix for the DEFECT 4/5/6/7 fixes

| Rung | Available | `/inventory` | Result |
|---|---|---|---|
| 2288 | 1937 | 100% | 0 escapes, 0 blown, `htmlOvf` 0 |
| 1920 | 1569 | 100% | 0 / 0 / 0 |
| 1440 | 1089 | 100% | 0 / 0 / 0 |
| 1024 | 690 | 142.1% (scrollport) | **0** real escapes, 0 blown |
| 768 | 713 | 137.5% (scrollport) | **0** real escapes, 0 blown |

**RTL / LTR** on `/inventory` @1024: byte-identical
(`[690, 980, 142.1, escReal 0, escSp 13, blown 0, htmlOvf 0]`) in both directions.

**Dark theme:** switched via `localStorage['erp.theme']`, swept, and **restored to
the user's original `light`**. `/inventory` @1024 in Dark is identical to Light.
All **40** newly-fluid routes re-measured in Dark @2288: **100% utilisation,
`escNotInScrollport` 0, blown grids 0** on every one. Geometry is theme-independent
here — no changed declaration sits in a `dark:` variant.

### Pathological surfaces — CLOSED

Method: **hard page load** (not SPA navigation) + shallow structural read. SPA
navigation into `/products/barcodes` froze the renderer again, exactly as in
session 1; a hard load does not.

| Route | Elements | Result |
|---|---|---|
| `/purchases/reorder-suggestions` | **137054** | `PASS_BOUNDED` — util 100%, `shellOvf` 0, `htmlOvf` 0 |
| `/products/barcode-print-queue` | **46106** | `PASS_BOUNDED` — util 100%, 0 / 0 |
| `/settings/permissions` (loaded) | **327850** | `PASS_BOUNDED` — util 100%, 0 / 0 |
| `/purchases/create` | 1203 | **PASS** — full walk: 0 escapes, 0 blown grids |
| `/create-order` | 683 | **PASS** — full walk: 0 / 0 |
| `/products/barcodes`, `/products/barcode-labels`, `/products/labels` | 845 | **PASS** in default state |
| `/products/print-list` | 794 | **PASS** |

Honest caveat: the barcode surfaces are only pathological **after labels are
generated**, which is a user action. It was not triggered, so those three are
PASS *in their default state*, not across all states.

Auditor note: the shallow bounded probe does **not** filter out-of-flow elements,
so its `content` can overstate — `/purchases/create` read 2278px shallow but a
full walk found 0 escapes. For bounded surfaces, `shellOvf`/`htmlOvf` are the
authoritative signal.

### Auditor fixes 8-10

8. Loading-skeleton bars are not width owners (require >=200px tall and >=8 descendants).
9. An element that is *itself* a scrollport owns its overflow.
10. A grid **inside** a scrollport may legitimately exceed its box — excluded from
    `blownGrids`. Without this the `/settings/permissions` fix read as a
    regression (1 -> 30) when `escNotInScrollport` had actually gone 46 -> 0.

### Programme state

| Item | Value |
|---|---|
| Checkpoints deployed | **7** (`e7b5745`, `729d979`, `6b0dff3`, `4952d47`, `8498cbb`, `04aede2`, `5d7f471`) |
| Shared width owners changed | 11 |
| Width caps removed | 26 |
| Grid/flex clipping defects fixed | **5** (in 4 owner files) |
| Defects: found / FIXED_VERIFIED / dismissed | **7 / 6 / 1** |
| `NEEDS_FIX` / `NEEDS_FLUID_FIX` | **0 / 0** |
| Auditor fixes to date | **10** |

### RESUME MARKER (supersedes session 7)

1. **Internal states remain the one unswept dimension** — tabs, expanded filter
   panels, drawers, non-destructive modals, empty states, card/list toggles. A
   page can be clean by default and clip when a drawer opens. Sweep read-only,
   never mutating business data.
2. Rung C/D full-matrix coverage is now broad but not exhaustive — ~45 routes
   measured at 1024, fewer at 768. Use `blownGrids` + `escNotInScrollport`; those
   two found every defect this session.
3. **Rung C is where defects live.** Every one of DEFECT 4-7 is invisible at wide
   viewport, and `/settings/permissions` was explicitly (and correctly) classified
   clean at 2288 in session 5.
4. Do not reopen the 26 removed caps or the 40 verified fluid routes.
5. **Traps recorded:** never measure intrinsic width on a detached clone; a
   single-item toggle cannot move a track sized by the max over N items; the
   shallow bounded probe overstates content because it ignores out-of-flow boxes.

---

## Session 9 — Internal-State Geometry sweep; DEFECT 8 (shared `.m1-control`)

Started at `main` = Production = `6788e8a`. **Ten** unrelated commits landed on
`main` from other workstreams during this session (POS M1 convergence, sidebar
highlighting, orders workspace-switcher removal, orders action layout, returns
colours, four AI-inbox fixes, pricing). Three touched real layout files
(`MainLayout.jsx`, `index.css`, `theme/foundation.css`, `OrdersDashboard.jsx`).
Each was fetched, inspected, reconciled, and cp8 re-verified intact afterwards.
Available workspace at 1024 shifted 690 -> 691px from those shell changes;
utilisation stayed 100 % and gutters stayed 0 / 0.

### Control discovery — semantics and structure, never labels

Two discovery passes, both DOM-derived:

1. **ARIA semantics** — `[role="tab"]`, `[aria-expanded]`, `details > summary`.
2. **Structural component ownership** — sibling `<button>` groups (2–8 members,
   equal heights) where exactly **one** member is visually distinct. That is a
   segmented/tab/pagination selector by construction.

Both passes exclude anything inside a `<form>`, any `type="submit"`, and anything
`aria-disabled`. Every control exercised is a disclosure or view selector, so no
form was submitted, no record created/updated/deleted, and no business action
fired. Every toggle was restored to its original state after measurement, and a
`location.pathname` guard reverted any control that turned out to navigate.

**Finding worth carrying forward:** pure-ARIA discovery under-detects badly in
this codebase — `/inventory` exposes **zero** ARIA controls. The structural
detector found the real ones (on `/orders`: a 4-way view selector *and* a 5-button
pagination group). Both passes are needed.

### Internal-state coverage (rung C, 1024px)

| Route | States exercised | Result |
|---|---|---|
| `/orders` | 4 (3 view + pagination) + 1 disclosure | clean |
| `/products` | 5 | clean |
| `/customers` | 4 | clean |
| `/purchases` | 4 | clean |
| `/suppliers`, `/branches` | 1, 2 | clean |
| `/settings/company`, `/settings/appearance` | 3 each | clean |
| `/settings/storefront`, `/payments`, `/shipping`, `/currencies`, `/website/settings` | 1 each | **DEFECT 8** |
| `/reports/sales`, `/reports/inventory` | base | clean |
| `/marketing`, `/marketing/posts`, `/marketing/campaigns` | 0 discovered | clean |
| `/warehouses`, `/stock-transfers` | 0 discovered | clean — genuine **empty states** |

### DEFECT 8 — `FIXED_VERIFIED` — shared `.m1-control` had no shrink floor

Every settings route using the M1UI `Field` primitive rendered a blown grid: an
inner card sat 13–14 px outside its column. `escNotInScrollport` was 0 and
`htmlOvf` 0, so nothing was clipped or unreachable — but the grid genuinely
overflowed its own box.

**Root owner.** `.m1-control` (`src/shared/ui/m1-ui.css`, applied by
`M1UI.jsx:102`) declared `display:grid` with **no column template**. The single
implicit track is therefore `auto`, whose base size is the min-content of the
label/input/help stack, so the control could not shrink below its content and
blew every ancestor grid with it.

An iterative live experiment showed the cascade is **three deep** on
`/settings/storefront` — fixing the page grid exposed the section grid, which
exposed `.m1-control`. Fixing **only** `.m1-control` collapses all three:

| State | blownGrids | worstBlow | escNotInScrollport | htmlOvf |
|---|---|---|---|---|
| as deployed | 1 | 14 px | 0 | 0 |
| `.m1-control` floor only | **0** | **0** | 0 | 0 |
| restored | 1 | 14 px | 0 | 0 |

Reproduced independently on `/settings/shipping`. One declaration replaced what
would otherwise have been a page grid plus seven section grids **per settings tab**.

`minmax(0,1fr)` and `auto` are identical for a one-column grid whenever the
content fits; they differ only in the minimum. No visual change where nothing
was overflowing.

**cp8** — `rollback/pre-layout-geometry-cp8-20260813` -> `0a7b175`, released
`21e070e`. eslint 0 errors, build green, guards 122/123 with `m1ui-primitives`
passing; the single failure (`AiStudio.jsx: h-8`) is the known pre-existing one.

**Shared-owner matrix** (required, since `.m1-control` is a design-system primitive):

| Rung | Available | Result |
|---|---|---|
| 1920 | 1570 | util 100 %, 0 escapes, 0 blown, gutters 0·0 |
| 1440 | 1090 | 100 %, 0 / 0 |
| 1024 | 691 | 100 %, 0 / 0 |
| 768 | 714 | 100 %, 0 / 0 |

RTL and LTR byte-identical at 1024. Dark measured and identical to Light; the
user's `light` preference was restored.

### Empty-root incident recurred — new diagnostic evidence

After ~60 transitions the shell stopped mounting (`rootKids: 0`, 46 static
elements). It persisted across a **fresh tab**, a sized viewport, hard reloads and
cache-busting query strings. Per the permanent rule this is an automation-session
failure and **Production was not touched or rolled back**.

New evidence this session, for the workstream that owns the incident:

- Console: **`Failed to load module script: … MIME type of "text/html"`** ×8.
- **A missing asset returns HTTP 200 with `text/html`**, not 404 —
  `/assets/does-not-exist-probe.js` -> `200 text/html`. The SPA rewrite catches
  `/assets/*` and serves `index.html`, which is exactly what turns any missing
  chunk into the MIME error above. This masks chunk-404s from monitoring.
- **Production assets are intact:** the entry chunk and **all 10** of its static
  imports fetch `200 application/javascript`. So this is *not* an asset-integrity
  or deploy problem.
- A service worker **is** registered (`pos-sw.js?v=10`, scope `/pos`, caches
  `pos-shell-v10-*`). Earlier sessions recorded "service workers: none", so this
  is new. Unregistering it and clearing its caches did **not** restore the shell,
  so the SW is not the cause either.

Hypothesis for that workstream: the 200-instead-of-404 rewrite means a client that
requests a chunk hash removed by a newer deploy silently receives HTML. This
session saw ~10 deploys while the tab was open.

### Programme state

| Item | Value |
|---|---|
| Checkpoints deployed | **8** (`e7b5745`, `729d979`, `6b0dff3`, `4952d47`, `8498cbb`, `04aede2`, `5d7f471`, **`21e070e`**) |
| Shared width owners changed | 11 + `.m1-control` |
| Defects: found / FIXED_VERIFIED / dismissed | **8 / 7 / 1** |
| `NEEDS_FIX` / `NEEDS_FLUID_FIX` | **0 / 0** |
| Auditor fixes to date | 10 |

### RESUME MARKER (supersedes session 8)

**The internal-state matrix is NOT complete.** ~21 routes were exercised; roughly
40 operational routes still have no internal-state reading:
`/accounting/*`, `/employees/*`, `/admin/*`, `/ai-studio/*`, `/inventory/*`,
`/products/*`, `/notifications`, `/expenses`, `/users`, `/roles`, `/analytics`,
`/smart-warehouse`, `/operations/shipping`, `/loyalty`, `/billing`, `/workspace`,
`/inbox`, `/staff/tasks`, `/orders/returns`, `/pos`.

1. Re-establish a browser (the empty-root condition blocked further measurement).
   Validate against `/dashboard` before trusting any reading.
2. Re-run the two-pass control discovery above — the code is in this session's
   transcript. **Keep both passes**; ARIA alone finds nothing on many routes.
3. `/orders` internal states must be **re-measured**: the workspace switcher was
   removed by another workstream mid-session, so the 4-state reading above
   describes states that no longer exist.
4. Budget for deploy churn: `main` moved 10 times in one session. Re-fetch before
   every push and re-verify shared owners after any commit touching
   `MainLayout.jsx`, `index.css` or `theme/foundation.css`.

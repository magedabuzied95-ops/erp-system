# M1 Storefront — Visual / Responsive / Localization Convergence Ledger

Programme start: 2026-08-17

## Current truth (baseline)
- Starting main SHA: `12dede74e2560460d69ae420ae0c91331dc6a59a` (`12dede7`)
- Starting Production SHA: `12dede74e256` (deployed asset `app-vlWmPSK--12dede74e256.js`) — **in sync with main**
- Storefront host (Production): `https://m1store-egy.com` (Vercel)
- Backend/API: `https://api.m1store-egy.com`
- Canonical origin constant: `STOREFRONT_CANONICAL_ORIGIN = "https://m1store-egy.com"` (src/App.jsx:278)

## Architecture reality
- Storefront shares one Vite build with the ERP (`src/App.jsx` router). Storefront code lives in `src/storefront/`.
- Storefront entry: `src/storefront/Storefront.jsx` — **~10,959-line monolith**, lazy-loaded, deliberately isolated from ERP heavy deps.
- Theme contract: **light AND dark both supported**; home defaults **dark** (`body.storefront-shell dark storefront-dark`). Tokens in `src/storefront/lib/themeTokens.js` (JS palettes) + scoped `src/storefront/storefront-light.css` (1453 lines).
- Localization: **inline `isRtl ? "عربى" : "English"` ternaries** (~1040 occurrences in Storefront.jsx alone) — NOT the ERP `t()` i18n key system. `isRtl` drives both language and `dir`.
- SEO: server-rendered via Vercel rewrites to `api.m1store-egy.com/api/storefront/seo/*` for `/product/:id`, `/men`, `/women`, `/kids`, `/bags`, `/crocs`, `/slippers`, `/offers`, sitemap, robots, feeds. **Do not alter (HARD FREEZE).**

## Route matrix (root paths — from src/storefront/lib/paths.js + App.jsx)
| Route | Purpose | Status |
|---|---|---|
| `/` | Home | **PASS** (see findings) |
| `/products` | Product listing (PLP) | **FIXED_VERIFIED** (gender chip i18n) |
| `/product/:slug` | Product detail (PDP) | PENDING |
| `/men` `/women` `/kids` `/bags` `/crocs` `/slippers` `/men/large-sizes` | SEO category collections | PENDING |
| `/offers` | Offers collection | PENDING |
| `/sale` | Sale collection | PENDING |
| `/c/*` | Dynamic category | PENDING |
| `/cart` | Cart | PENDING |
| `/checkout` | Checkout (behaviour HARD FROZEN) | PENDING |
| `/account` `/account/reset-password` | Account / auth / OTP | PENDING |
| `/track` | Order tracking | PENDING |
| `/wishlist` | Wishlist | PENDING |
| `/recently-viewed` | Recently viewed | PENDING |
| `/contact` | Contact | PENDING |
| `/size-guide` | Size guide | PENDING |
| `/returns` | Returns info | PENDING |
| `/faq` | FAQ | PENDING |
| `/success/:orderNumber` | Order success | PENDING |
| `/confirm/:code` | Order confirmation action | PENDING |
| `/privacy` `/terms` `/data-deletion` | Legal pages | PENDING |
| `*` (404) | Not-found | PENDING |
| Legacy `/shop/*` | Redirects → root paths | N/A (redirect only) |

Status legend: PASS / FIXED_VERIFIED / FLUID_PASS / FIXED_FLUID_VERIFIED / INTENTIONAL_CAPPED / PASS_BOUNDED / BLOCKED_FUNCTIONAL / PENDING

## Frozen reference routes (regression set)
home `/`, PLP `/products`, PDP `/product/:slug`, cart `/cart`, checkout `/checkout`

## Hard freezes
- Business behaviour: pricing, variants, sizes, colours, stock, cart maths, discounts, shipping, COD, Instapay/Vodafone, checkout, OTP, orders, wishlist, tracking, API/DB/inventory.
- SEO output, Meta Pixel / CAPI, GA4, Merchant feed, analytics events.
- Presentation / localization / responsive work ONLY.

## Findings log

### `/` Home — PASS (audited on Production 12dede7, 2026-08-17)
- Responsive: page horizontal overflow = **0px** at 375 (mobile-emulated) and 1920. Shell util 100% (full-bleed by design). Wide "culprits" are `sf-brand-marquee`/`sf-announcement-track` animations contained by parent `overflow:hidden` — intentional, not clipping.
- Theme: toggle exercised live. Dark → light flips `body` class (`storefront-dark` removed), `storefront.theme` LS → `"light"`, bg `rgb(234,231,224)` + text `rgb(27,25,21)`. Reactive, correct.
- RTL: العربية switch flips `html[dir]` → `rtl`, `html[lang]` → `ar` **reactively (no reload)**; overflow still 0.
- Localization: no leaked English chrome sampled while in Arabic (Home/Cart/Account/Offers/Wishlist/Menu/Categories all localized). Reactive.
- Mid widths (1440/1024/768/430) not yet individually swept — extremes clean; low risk. To confirm in a bounded pass.
- NOTE: pane is hidden in this environment → visual screenshots unavailable; audit is text/measurement-based (authoritative for structure, overflow, direction, theme tokens, localization residual).

### `/products` PLP — DEFECT #1 (localization) → FIXED_VERIFIED
- **Symptom**: in English mode the PLP category quick-chip row rendered mixed-language `["رجالي","حريمي","أطفال","Bags","Crocs","Slippers"]` — gender chips (Men/Women/Kids) stayed Arabic while type chips localized. Same bug on the active applied-filter chip.
- **Root cause**: `src/storefront/pages/StorefrontProductListingPage.jsx` — `CatalogQuickChips` (line 1412) used raw module-scope `item.label` (Arabic) for `field==="gender"` instead of the resolver; `CatalogAppliedFilterChips` (line 1452) hardcoded an Arabic ternary. The shared `classificationLabel` (Storefront.jsx:2536) already localizes gender correctly via `storefrontLocalizedLabels` (en: Men/Women/Kids) — proven by the filter-panel facet which uses it.
- **Ownership/blast radius**: file is lazy-imported ONLY by the PLP route (Storefront.jsx:1704). Page-local. Shared `classificationLabel` **not modified** — only the two PLP call sites were pointed at it.
- **Fix**: line 1412 gender branch → `classificationLabel(item, lang)`; line 1452 → `classificationLabel({ value: gender }, lang)`. Reactive via existing `lang` prop.
- **Verified (local dev, localhost:5173)**: EN → `["Men","Women","Kids","Bags","Crocs","Slippers"]`, applied chip `?gender=men` → "Men", no Arabic gender leak. AR → `["رجالي","حريمي","أطفال"]` (no regression). Reactive both ways.
- **Gates**: eslint clean (only pre-existing dead-code warnings), `npm run build` exit 0, `test:storefront-seo` 33/33 pass.
- Secondary observations (not defects yet, logged for later): `CatalogQuickChips` Link hardcodes `dir="rtl"` (1418) and `CatalogSortControl` select uses `text-right` (1390) — physical direction under LTR; low impact, may be intentional for Arabic sizes. Revisit in RTL/LTR pass (§21).

### `/products` PLP — DEFECT #2 (localization) → FIXED, verifying on Production
- **Symptom**: in English mode the PLP pagination rendered Arabic `التالي` (Next) / `السابق` (Previous); the pagination `<nav aria-label>` and the related-sections `<nav aria-label>` were hardcoded Arabic too (`صفحات المنتجات`, `أقسام مرتبطة`) — surfaced by the post-CP-1 Production scan.
- **Root cause**: `StorefrontProductListingPage.jsx` lines 1164/1165/1175/1178 hardcoded Arabic with no language conditional.
- **Fix**: inline `lang === "en" ? EN : AR` on all four (visible labels + both aria-labels). `lang`/`t` in scope (line 475-476). Chose inline over `t(key, arabicFallback)` because a missing key would return the Arabic fallback in BOTH languages and silently not fix EN.
- **Scope note**: after fix, source grep for hardcoded-Arabic attributes and visible JSX text nodes in this file = **0 matches**. Empirical EN Production scan to confirm no other chrome leaks.
- **Gates**: eslint 0 errors, `npm run build` exit 0.

## Checkpoints / releases
- **CP-1** ✅ DEPLOYED + PRODUCTION-VERIFIED: PLP gender chip localization. Commit `3f01866`. Deployed asset `app-BZ5mCSDl-3f01866eb8b5.js`. Verified live: EN quick-chips `Men/Women/Kids/Bags/Crocs/Slippers`, applied chip `Men`, zero AR gender leak. Rollback ref `rollback/storefront-cp0-12dede7` @ `12dede7`.
- **CP-2** (pending push): PLP pagination + nav aria localization.

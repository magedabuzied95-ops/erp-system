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
| `/products` | Product listing (PLP) | **FIXED_VERIFIED** (4 defects: gender chips, pagination+aria, currency dup, card brand aria) |
| `/product/:slug` | Product detail (PDP) | responsive/localization **PASS**; theme **NEEDS_FIX** (CP-7 light-mode contrast) |
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

## PERMANENT GATE — Product-URL backward compatibility (`/shop/product/*`)
Added 2026-08-17 per user directive. **Applies before releasing ANY Storefront checkpoint that touches product links, PDP routing, canonical product paths, catalogue URLs, navigation links, sitemap/feed URLs or SEO routing.** (Pure presentation/localization/responsive checkpoints that do NOT alter any URL/href/routing/canonical/feed are exempt — e.g. CP-1…CP-6.)

Context: a prior workstream changed Storefront product URL generation/routing (see `docs/wip-storefront-meta-canonical-urls.md`, handed off in `c7996d3`).

**Before changing anything URL-related, inspect CURRENT main and map the full ownership chain:** current canonical PDP URL format; historical `/shop/product/:...` format(s); React/router handling; Vercel/server rewrite handling; SEO canonical behaviour; Meta catalogue/feed URL generation; sitemap generation; public product-link generation.

**Compatibility contract:** every historically-valid `/shop/product/*` URL must EITHER (1) continue resolving to the correct product, OR (2) perform a deliberate permanent (301) redirect to the current canonical product URL. It must NOT fall through to a generic SPA shell that renders Not-Found, and must NOT return a false HTTP 200 while the product route is functionally missing.

**Production tests (representative real products):** canonical URL; corresponding `/shop/product/*` historical URL; cold navigation; in-app browser navigation; HTTP status/redirect chain; final rendered product identity; canonical tag; Product JSON-LD URL; OG URL; sitemap/feed destination.

**Meta Catalog = hard regression surface.** Existing catalogue items may still carry historical `/shop/product/*` destinations — do NOT invalidate them; preserve current feed identifiers and product identity (no ID regeneration for URL modernization). If canonical URLs changed, prefer backward-compatible routing/redirects over two competing canonicals.

**Required regression tests (min):** historical URL → correct product/canonical; canonical URL → correct product; invalid historical URL → genuine not-found; canonical metadata stays the current canonical; Meta/feed destination remains reachable.

**Preserve `072e070` (product-image enlargement)** as an ancestor across every reconciliation; never overwrite/revert it while resolving routing.

Failure of `/shop/product/*` compatibility is a **release blocker**, not optional SEO cleanup.

**Ownership-chain inspection (done 2026-08-17, current main `c7996d3`):**
- Current canonical PDP format: `/product/:slug` (`ROOT_PATHS.product`, paths.js). Historical: `/shop/product/:identifier`.
- Router: `App.jsx` maps `/shop/product/:identifier` → `StorefrontLegacyRedirect` (client redirect to `/product/*`).
- Vercel rewrites (vercel.json): BOTH `/product/:identifier` and `/shop/product/:identifier` → `api.m1store-egy.com/api/storefront/seo/product/:identifier` (same server SEO shell).
- **The 4-change "short canonical URL + feed pricing" feature is STRANDED (NOT on main; `docs/wip-storefront-meta-canonical-urls.md` / `stash@{0}`). This convergence programme is NOT applying it.** Its risky pieces are `storefrontProductUrlService.js` (`/shop/product`→`/product`) and the PDP canonical redirect — only relevant if that separate workstream lands.
- **Production baseline PROVEN (compat contract already met):** canonical `/product/…-759` → 200/0-redirect; historical `/shop/product/…-759` → **200/0-redirect, correct product** (`<title>Adidas Sneakers`), with `rel=canonical`, `og:url`, and Product JSON-LD all pointing to the canonical `/product/` form. Historical URLs do NOT 404 and do NOT return a false-200 empty shell.
- **Programme obligation:** preserve this. No convergence checkpoint may change product-link/routing/canonical/feed generation without re-proving this contract + the regression tests above. CP-1…CP-6 are all URL-neutral.

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

### `/products` PLP — DEFECT #3 (currency chrome) → FIXED, verifying
- **Symptom**: EN price filter showed `EGP 0 جنيه` — `money()` already emits localized currency (`EGP 0` / `0 ج.م`), so the hardcoded ` جنيه` suffix duplicated it (and was wrong-language in EN). Present in both languages (`0 ج.م جنيه` in AR).
- **Root cause**: `StorefrontProductListingPage.jsx` price-bounds spans (1348/1352) appended ` جنيه` after `money()`; applied price chip (1461) used raw numbers + hardcoded ` جنيه`.
- **Fix**: 1348/1352 drop the redundant suffix (let `money()` localize); 1461 localize the currency word `lang === "en" ? "EGP" : "جنيه"` (kept raw numbers because the range can be `∞`, which `money()` can't format).
- **Classification of remaining EN-mode Arabic on PLP** (allowed residual §23, business DATA — no app English source): `محلي`/`مستورد فيتنامي` (grade), `ميرور اوريجينال` (grade/brand), `كولكشن الشتوي` (collection). → **Product decision flagged**: whether the grade taxonomy should have EN display labels is a design call; not invented here.
- **Gates**: eslint 0 errors, build exit 0.

### SHARED `ProductCard` — DEFECT #4 (accessibility localization) → FIXED, verifying
- **Symptom**: brand link on every product card had `aria-label="عرض منتجات {brand}"` — Arabic in English mode (screen readers hear Arabic chrome). Visible brand text is fine (data, `dir="ltr"`).
- **Root cause**: `Storefront.jsx:6270` hardcoded the Arabic "Show {brand} products" wrapper. `ProductCard` (line 5880) only destructured `t`, no language.
- **Ownership/blast radius**: `ProductCard` is SHARED — renders on Home, PLP, PDP related rails, and search results. The correction (localize the aria wrapper) is unambiguously required across ALL consumers → proceeded without pause per directive. Added `i18n` to the existing `useTranslation()`; label now `normalizeLanguage(i18n.language)==="ar" ? "عرض منتجات" : "Shop"`.
- **Shared-owner protocol**: re-verify Home + PLP references post-deploy.
- **Gates**: eslint 0 errors, build exit 0.

### `/product/:slug` PDP — audit (Production `c7996d3`/`c51a014`, 2026-08-17)
- **Responsive: PASS** — page horizontal overflow = **0px** at 1920 / 1440 / 1024 / 768 / 430 / 390. Gallery main image `object-fit: contain` (642×498), 4 thumbnails, Add-to-Cart CTA full-width & in-view on mobile.
- **Localization: PASS** — EN fresh load: 0 Arabic chrome in PDP body. Live toggle EN→AR: 0 English chrome stranded (`dir=rtl`). Footer/trust badges reactive via **CP-6**. Product title/brand/description = data (preserved).
- **CP-6 footer reactivity: VERIFIED** on this PDP (live toggle both directions, no reload).
- **Theme: NEEDS_FIX → DEFECT #7 (light-mode contrast).** The PDP is an intentional self-contained **dark surface** (`data-surface-theme="dark"` at StorefrontProductDetailPage.jsx:604; documented at index.css:6510-6516 — kept dark so WebView restores without `.storefront-dark` don't break it). The contrast override (index.css:6517-6585) forces white for `h1/h2` and `.text-white`, BUT in **light global theme** several elements leak light-theme colors onto the dark surface and go invisible (verified via computed contrast, accounting for `-webkit-text-fill-color`):
  - price (`700 ج.م`), discount (`-29%`), stock badge (`باقي 2 فقط`) → dark text `rgb(15,23,42)` on `rgb(19,18,17)` → ratio **~1.05**
  - size chips (`28/29/30`) → white-ish text on a white chip bg → ratio **~1.0**
  - ~12 low-contrast nodes total. Default DARK theme is unaffected (this is light-theme-only).
  - **Owner**: `src/index.css` `.storefront-shell .sf-product-details-page[data-surface-theme="dark"]` block (scoped to PDP; safe blast radius). Fix = extend the forced-color coverage to price/discount/stock/size-chip elements. **Note:** contrast fix wants visual confirmation; pane is currently hidden → will verify via computed-contrast ratios now and pixel/screenshot later when compositing is available.
- Status: PDP responsive + localization **PASS**; **CP-7 pending** (theme contrast). PDP zero-gate not yet met until CP-7 closes.

## Checkpoints / releases
- **CP-1** ✅ DEPLOYED + PRODUCTION-VERIFIED: PLP gender chip localization. Commit `3f01866`. Deployed asset `app-BZ5mCSDl-3f01866eb8b5.js`. Verified live: EN quick-chips `Men/Women/Kids/Bags/Crocs/Slippers`, applied chip `Men`, zero AR gender leak. Rollback ref `rollback/storefront-cp0-12dede7` @ `12dede7`.
- **CP-2** ✅ DEPLOYED + PRODUCTION-VERIFIED: PLP pagination + nav aria localization. Commit `4833195`, asset `app-BjEyXvzv-4833195daff7.js`. Verified live: EN pagination `Next`.
- **CP-3** ✅ DEPLOYED + PRODUCTION-VERIFIED: PLP price-filter currency. Commit `304e5d2`, asset `app-BhKDyObO-304e5d2931b6.js`. Verified live: EN price chip `100 - 500 EGP`, bounds `EGP 300`, zero `جنيه` leaks.
- **CP-4** ✅ DEPLOYED + PRODUCTION-VERIFIED: shared ProductCard brand-link aria localization. Commit `c39aab2`, asset `app-d385fl2Z-c39aab2b3ca4.js`. Verified live: brand arias `Shop Classic/SKECHERS/Adidas/crocs`, zero Arabic leak. **Shared-owner regression**: Home overflow 0 + 0 aria leak; PLP overflow 0 + gender chips `Men/Women/Kids` intact.
- **CP-5** ✅ DEPLOYED + PRODUCTION-VERIFIED: shared `classificationLabel` grade/collection taxonomy display i18n (PD-1). Commit `199c7a1`, asset `app-Bxzbo8S2-199c7a178f76.js`. Verified live — EN: `Winter Collection / Imported from Vietnam / Mirror Original / Local`, zero AR grade leak; AR: `كولكشن الشتوي/مستورد فيتنامي/ميرور اوريجينال/محلي` preserved, zero EN leak. **Regression**: brands (`Crocs/Adidas/SKECHERS/Classic`) NOT over-localized, gender `Men/Women/Kids` intact, PLP overflow 0. **Shared-owner regression**: Home overflow 0, 17 cards, 0 broken facet labels. Reuses canonical `label_en`/`label_ar`; no new mapping; raw values/queries/URLs untouched.
- Concurrency note: a parallel session pushed `33d848e` (ERP `ProductsList.jsx` only) into this worktree mid-CP-5; disjoint from storefront files, no clobber. CP-5 = `199c7a1` on top.
- **CP-6** ✅ DEPLOYED + PRODUCTION-VERIFIED: shared footer/trust-badge **language-reactivity** fix. Commit `c51a014`, asset `app-B-1bc6WQ-c51a01476fd8.js`. Verified live **without reload** on Home + PDP: EN→AR flips footer + trust badges Arabic + `dir=rtl` instantly; AR→EN flips back instantly. PLP renders no footer (unaffected; overflow 0). Rollback ref `rollback/storefront-cp6-c7996d3` @ `c7996d3`. Released from isolated worktree `storefront/convergence-resume`; rebased onto current main (preserving `072e070`). Owner: `HomeWhySection` + `HomeSimpleFooter` (Storefront.jsx). Both derived `isRtl` from a `lang` **prop** passed by the memoized `storefrontPage` shell (deps omit language) and did not self-subscribe, so a live language toggle left the footer/trust-badges/featured-section in the initially-rendered language until reload (§25). Fix: each self-subscribes via `useTranslation()` → `isRtl = normalizeLanguage(sfI18n.language || sfI18n.resolvedLanguage || lang)`; `lang` prop kept as fallback. No second localization system introduced. **Isolation:** re-applied in a dedicated clean worktree `storefront/convergence-resume` from current `origin/main` `d3dcaec` (primary checkout left untouched — it holds an unrelated concurrent autostash-pop conflict). **Local proof (no reload):** EN→AR footer+badges flip Arabic + `dir=rtl` instantly; AR→EN flip English + `dir=ltr` instantly. **Gates:** eslint 0 errors; build exit 0; storefront-seo 33/33; i18n failure-identity IDENTICAL to pristine `d3dcaec` (55/49/6 — 6 pre-existing debt failures, 0 introduced); the guard "memoized components that translate also subscribe to language changes" PASSES.

## Open product decisions
- **PD-1 (grade/collection taxonomy EN labels)** — ✅ APPROVED & IMPLEMENTED (CP-5). The grade/collection values DO have a canonical source: `/product-classifications` returns `label_ar`+`label_en` per option (grade: `mirror_original`→"Mirror Original", `imported_from_vietnam`→"Imported from Vietnam", `local`→"Local"; product_type: `winter_collection`→"Winter Collection"). The storefront already loads these via `useProductClassifications` → `classificationGroupsToFieldOptions` (canonical `src/modules/products/lib/productClassifications.js`). No new mapping created. Root cause was resolver priority: shared `classificationLabel` (Storefront.jsx:2536) returned generic `option.label` (= `label_ar||label_en||value`, i.e. Arabic) BEFORE the locale-specific `label_en`. Fix inserts `localizedField` (label_en/label_ar by lang) ahead of `option.label`; options without a localized field (brand/colour/free-text) fall through to raw value unchanged (unknown merchant data preserved). Display-only — raw values, query params, URLs, comparisons untouched. **Note:** canonical merchant `label_en` for the Vietnamese grade is "Imported from Vietnam" (not the "Vietnamese Imported" from the request); used the canonical single-source value per the reuse directive.

### SHARED `classificationLabel` — DEFECT #5 / PD-1 (taxonomy display i18n) → FIXED, verifying
- **Owner**: `Storefront.jsx:2536` (the shared Storefront classification display resolver). **Consumers** (all benefit consistently): Storefront.jsx 4389/4417/4456/4587/4686/4720 + PLP 1011/1015/1017/1554 — home/PLP/search filter facets, applied-filter chips, selected-facet labels.
- **Blast-radius safety**: only canonical classification options carry `label_en`/`label_ar` (gender/type/grade/bag_type). Brand/colour/category free-text options (built by the page's own `buildFacetOptions`) lack those → unchanged. Gender still resolves via `storefrontLocalizedLabels` first; product types via `PRODUCT_TYPE_LABELS` first — both ahead of the new field, so no change there.
- **Gates**: eslint 0 errors, `test:storefront-seo` 33/33, build exit 0.

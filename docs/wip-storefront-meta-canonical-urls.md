# WIP handoff — storefront canonical URLs + Meta catalog feed pricing

**Branch:** `wip/storefront-meta-canonical-urls` (also still reachable as `stash@{0}`)
**Recovered:** 2026-08-17 · **Original base:** `dfa943f` (refactor(purchases): reuse POS smart filters)

## What happened

A session ran a pull/rebase whose `autostash` pop conflicted, leaving six files
in `UU` with literal `<<<<<<< Updated upstream` / `>>>>>>> Stashed changes`
markers committed to nothing — the working tree simply did not parse. The tree
sat that way while `origin/main` moved ~20 commits ahead, so every later attempt
to pop would have conflicted worse.

The working tree has been reset to `origin/main`. **No work was discarded:** the
stashed snapshot is preserved twice, as the branch above and as `stash@{0}`.

## Most of this WIP already landed on main — in a better form

Do **not** replay the whole snapshot. These parts are already on `origin/main`,
and main's versions are further along than the snapshot's:

| Snapshot change | Status on `origin/main` |
|---|---|
| `metaConversionsApiService.js`, `lib/metaPixelEvents.js` | present |
| `POST /storefront/meta/events` | present, **plus** `storefrontCustomerTransitionAuth` the snapshot lacks |
| `trackMetaPurchase` / `trackMetaAddToCart` in `Storefront.jsx` | present at 3 call sites vs the snapshot's 1 |
| `trackMetaViewContent` in `StorefrontProductDetailPage.jsx` | present |
| `ProductColorImageBadge` / `getColorImageStatusDetails` | present |
| `colorImageFilter` / `colorImageStatusJoinSql` in `productsController.js` | present |

## What is genuinely still missing

Four changes, and they form one coherent feature — short canonical product URLs
plus a catalog feed that quotes the right price:

1. **`server/services/storefrontProductUrlService.js`** — `/shop/product/<id>` →
   `/product/<id>`, and `/shop/products` → `/products`.
2. **`src/storefront/pages/StorefrontProductDetailPage.jsx`** — redirect to the
   canonical `/product/<slug>` path when the visited path differs.
3. **`server/controllers/storefrontController.js`** — in `productIdentifierOrder`,
   move numeric-id matching ahead of name-slug matching (`THEN 6` → `THEN 4`).
4. **`server/services/metaCatalogFeedService.js`** — `resolveMetaPricing`, so feed
   prices honour sale mode, plus image-URL normalisation and website settings.

**Before replaying 1 and 2:** they change live storefront URLs. Check that
`/shop/product/*` still resolves (a redirect or a kept route), or existing links
— including anything already crawled into the Meta catalog — will 404.

## Recovering it

```bash
git diff dfa943f wip/storefront-meta-canonical-urls -- server/services/storefrontProductUrlService.js
```

Take the four changes above file by file rather than merging the branch: it is
based on `dfa943f` and merging it would try to undo the newer versions of
everything in the first table.

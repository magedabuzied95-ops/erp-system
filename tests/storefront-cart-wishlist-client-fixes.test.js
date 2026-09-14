import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Four storefront client defects, guarded by source assertions (React code without a DOM here):
// 1. a coupon re-validated during submit sent the pre-discount total as paid_amount;
// 2. every product card downloaded its full-size hover photo on mount, phones included;
// 3. signing out left the wishlist behind and the next account uploaded it as a guest's;
// 4. a chunk-load failure after a deploy wiped the cart, and the cart merge then erased it server-side.

const source = fs.readFileSync(new URL("../src/storefront/Storefront.jsx", import.meta.url), "utf8");
const readLocale = (language) => JSON.parse(
  fs.readFileSync(new URL(`../src/locales/${language}/storefront.json`, import.meta.url), "utf8")
);

const between = (startMarker, endMarker, from = 0) => {
  const start = source.indexOf(startMarker, from);
  assert.ok(start > -1, `missing marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
};

test("submit prices paid_amount and remaining_amount from the validation it sends", () => {
  const submit = between("const submit = async (event) => {", "const data = await api.post(\"/storefront/checkout\"");
  assert.match(submit, /const orderTotal = Math\.max\(0, subtotal - \(couponDiscountToSend \+ bundleDiscount\) \+ deliveryFee\)/);
  assert.match(submit, /paid_amount: paidAmount/);
  assert.match(submit, /remaining_amount: Math\.max\(0, orderTotal - paidAmount\)/);
  assert.match(submit, /const paidAmount = [^;]*orderTotal;/);
  assert.doesNotMatch(submit, /const paidAmount = [^;]*amountDueNow/, "the render-time amount must not be sent");
});

test("a transfer whose amount changed on re-validation stops and names the new amount", () => {
  const submit = between("const submit = async (event) => {", "const cleanPhone = form.primary_phone");
  const guard = submit.slice(submit.indexOf("if (isShippingConfirmation && Math.abs(orderTotal - total)"));
  assert.ok(guard.length > 0, "the transfer guard exists");
  assert.match(guard, /sfText\("storefront\.checkout\.couponTotalChanged", "", \{ amount: money\(orderTotal\) \}\)/);
  assert.match(guard, /setSubmitting\(false\);\s*return;/);
});

test("the new-amount message exists in Arabic and English", () => {
  for (const language of ["ar", "en"]) {
    const value = readLocale(language).checkout?.couponTotalChanged;
    assert.equal(typeof value, "string", `${language} has the key`);
    assert.match(value, /\{\{amount\}\}/, `${language} shows the amount`);
  }
});

test("product cards fetch the hover photo only on hover intent, through the <img> itself", () => {
  const card = between("const secondaryImageUrl = useMemo(", "const brandLabel = productCardBrandLabel(product);");
  assert.ok(!card.includes("new Image()"), "no eager manual preload of the original upload");
  const intent = between("const requestSecondaryImage = (event) => {", "};");
  assert.match(intent, /matchMedia\("\(hover: hover\)"\)\.matches/);
  assert.match(intent, /pointerType === "touch"/);
  assert.match(intent, /setSecondaryImageWanted\(true\)/);
  assert.match(source, /onPointerEnter=\{requestSecondaryImage\}/);
  assert.match(source, /onFocus=\{requestSecondaryImage\}/);
  const secondary = between("{hasReadySecondaryImage && secondaryImageWanted ? (", ") : null}");
  assert.match(secondary, /responsiveImageProps\(secondaryImageUrl, imagePreset\)/, "same responsive URL as the preload");
  assert.match(secondary, /onLoad=\{\(event\) => markSecondaryImageLoaded\(event\.currentTarget\)\}/);
  // The primary only fades out once the secondary really loaded.
  assert.match(source, /hasReadySecondaryImage && secondaryImageReady \? "md:group-hover\/card-image:opacity-0"/);
});

test("signing out or switching phone clears a wishlist that belongs to an account", () => {
  const clearEffect = between("const owner = String(readStorefrontStorage(WISHLIST_OWNER_KEY", "}, [customerAuth.token, customerAuth.phone]);");
  assert.match(clearEffect, /if \(!owner\) return;/, "a true guest wishlist is kept for the first sign-in merge");
  assert.match(clearEffect, /customerAuth\.token && String\(customerAuth\.phone \|\| ""\) === owner/);
  assert.match(clearEffect, /wishlistRef\.current = \[\];/);
  assert.match(clearEffect, /writeStorefrontStorage\(WISHLIST_KEY, \[\]\)/);
  assert.match(clearEffect, /setWishlist\(\[\]\)/);
  // It must run before the sign-in sync, which reads the ref rather than its render closure.
  assert.ok(source.indexOf("const owner = String(readStorefrontStorage(WISHLIST_OWNER_KEY") < source.indexOf("const syncCustomerLists = async () => {"));
  const sync = between("const syncCustomerLists = async () => {", "void syncCustomerLists();");
  assert.match(sync, /const guestWishlist = normalizeWishlistCollection\(wishlistRef\.current\)/);
  assert.match(sync, /writeStorefrontStorage\(WISHLIST_OWNER_KEY, cartPhone\)/, "a merged wishlist is marked as the account's");
});

test("the error boundary never clears storage for a chunk-load failure", () => {
  const didCatch = between("componentDidCatch(error) {", "render() {");
  const chunkGuard = didCatch.indexOf("if (isChunkLoadError(error)) {");
  assert.ok(chunkGuard > -1, "chunk-load errors return early");
  assert.match(didCatch.slice(chunkGuard), /^if \(isChunkLoadError\(error\)\) \{\s*recoverFromChunkLoadError\(error\);\s*return;\s*\}/);
  assert.ok(chunkGuard < didCatch.indexOf("cleanupStorefrontStorage("), "the guard comes before any cleanup");
});

test("the crash cleanup keeps the cart and the wishlist", () => {
  const cleanup = between("const cleanupStorefrontStorage = () => {", "const getSuccessMessages");
  assert.doesNotMatch(cleanup, /\bCART_KEY\b/);
  assert.doesNotMatch(cleanup, /\bWISHLIST_KEY\b/);
  assert.match(cleanup, /STOREFRONT_CACHE_PREFIXES/, "caches are still cleared");
});

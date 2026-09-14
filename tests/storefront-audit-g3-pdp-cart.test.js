import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  productSelectionSearchKey,
  productShareParamEntries,
  resolveRequestedVariant,
  soldOutColorKeyToKeep,
} from "../src/storefront/lib/pdpSelection.js";
import { buildProductColorGroups, resolveColorGroup } from "../src/storefront/lib/productColorGallery.js";
import { applyProductImageFallback } from "../src/storefront/lib/productImageFallback.js";
import {
  canIncreaseCartLine,
  cartFromStorageEvent,
  cartLineComparePrice,
  cartLineIssue,
  clampCartLineQuantity,
  setCartLineQuantity,
} from "../src/storefront/lib/cartLine.js";
import { applyCartReprice, isCartLineCheckoutError } from "../src/storefront/lib/cartReprice.js";

// 2026-09-15 storefront audit, group 3 (product page and cart): #35, #36, #37, #38, #39, #88, #89.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const colorIdentity = (variant) => String(variant?.color || "").toLowerCase();
const colorName = (variant) => variant?.color || "";
const hasStock = (variant) => Number(variant?.stock || 0) > 0;
const resolve = (variants, search) => resolveRequestedVariant({ variants, search, colorIdentity, colorName, hasStock });

// Black in stock in 40-42; Beige sold out everywhere.
const shoe = [
  { id: 1, color: "Black", size: "40", stock: 3 },
  { id: 2, color: "Black", size: "41", stock: 2 },
  { id: 3, color: "Black", size: "42", stock: 1 },
  { id: 4, color: "Beige", size: "40", stock: 0 },
  { id: 5, color: "Beige", size: "41", stock: 0 },
  { id: 6, color: "White", size: "41", stock: 4 },
];

test("#37 a share link names the size only once the shopper has chosen it", () => {
  const product = { id: 9, selected_variant_id: 77, display_variant_id: 78, selected_size: "44" };
  const variant = shoe[0];
  const unchosen = Object.fromEntries(productShareParamEntries(product, variant, { sizeChosen: false }));
  assert.deepEqual(unchosen, { variant: "", color: "Black", size: "" }, "no size and no size row id — not even the product's own fallbacks");
  const chosen = Object.fromEntries(productShareParamEntries(product, variant, { sizeChosen: true }));
  assert.deepEqual(chosen, { variant: 1, color: "Black", size: "40" });

  // The friend's page: a colour-only link does not count as a chosen size.
  const opened = resolve(shoe, "?color=Black");
  assert.equal(opened.variant.color, "Black");
  assert.equal(opened.sizeChosen, false);
  assert.equal(resolve(shoe, "?variant=2&color=Black&size=41").sizeChosen, true);
});

test("#37 the page shares with the size gate, and productShareUrl leaves the params to the helper", async () => {
  const pdp = await read("../src/storefront/pages/StorefrontProductDetailPage.jsx");
  assert.match(pdp, /productShareUrl\(product, safeActiveVariant, shareVersion, \{ sizeChosen: !sizeChoiceRequired \}\)/);
  const storefront = await read("../src/storefront/Storefront.jsx");
  const share = storefront.slice(storefront.indexOf("const productShareUrl = "), storefront.indexOf("const resetStorefrontViewportScroll"));
  assert.match(share, /\.\.\.productShareParamEntries\(product, variant, \{ sizeChosen \}\)/);
  assert.ok(!share.includes('["size", variant?.size'), "no second, unconditional size param");
});

test("#38 only the variant-choosing params re-run the selection", () => {
  assert.equal(productSelectionSearchKey("?color=black&utm_source=fb&fbclid=1"), productSelectionSearchKey("?color=black"));
  assert.notEqual(productSelectionSearchKey("?variant=1"), productSelectionSearchKey("?variant=2"));
  assert.notEqual(productSelectionSearchKey("?color=black"), productSelectionSearchKey("?color=white"));
  assert.notEqual(productSelectionSearchKey(""), productSelectionSearchKey("?size=41"));
  // A bag line's link on the product already open lands on that line's colour.
  assert.equal(resolve(shoe, "?variant=6").variant.id, 6);
});

test("#38 the product page re-resolves the selection when the query changes on the same path", async () => {
  const pdp = await read("../src/storefront/pages/StorefrontProductDetailPage.jsx");
  const effect = pdp.slice(pdp.indexOf("const selectionSearchKey = productSelectionSearchKey(location.search);"));
  assert.match(
    effect,
    /if \(!state\.product \|\| appliedSelectionKeyRef\.current === null \|\| appliedSelectionKeyRef\.current === selectionSearchKey\) return;\s*initialRouteSearchRef\.current = location\.search;\s*applyRequestedSelection\(state\.product, location\.search\);[\s\S]{0,120}\}, \[selectionSearchKey, state\.product\]\);/
  );
  assert.match(pdp, /appliedSelectionKeyRef\.current = productSelectionSearchKey\(search\);/, "the load records what it resolved, so the effect does not redo it");
  assert.match(pdp, /const first = applyRequestedSelection\(product, initialRouteSearchRef\.current\);/, "the load and the query change share one resolution");
});

test("#39 a ?color= link to a sold-out colour keeps that colour's own group", () => {
  const { variant } = resolve(shoe, "?color=beige");
  assert.equal(variant.color, "Beige", "the ad's colour, so its restock button shows");
  const keep = soldOutColorKeyToKeep(variant, colorIdentity, hasStock, shoe);
  assert.equal(keep, "beige");
  assert.equal(soldOutColorKeyToKeep(shoe[0], colorIdentity, hasStock, shoe), "", "an in-stock colour needs no exception");

  const build = (keepColorKey) => buildProductColorGroups({ product: {}, variants: shoe, colorKey: colorIdentity, colorName, variantHasStock: hasStock, keepColorKey });
  assert.deepEqual(build("").map((group) => group.key), ["black", "white"], "sold-out colours are still dropped by default");
  const groups = build(keep);
  const group = resolveColorGroup(groups, keep);
  assert.equal(group.key, "beige", "not groups[0] — Black's photos and chips under Beige's name");
  assert.deepEqual(group.variants.map((row) => row.id), [4, 5], "the size chips are Beige's own, all sold out");
  assert.ok(group.variants.every((row) => !hasStock(row)));
});

test("#39 the product page passes the kept colour into its colour groups", async () => {
  const pdp = await read("../src/storefront/pages/StorefrontProductDetailPage.jsx");
  assert.match(pdp, /variantHasStock, keepColorKey \}\),\s*\[product, variants, keepColorKey\]/);
  assert.match(pdp, /setKeepColorKey\(soldOutColorKeyToKeep\(first, variantColorIdentity, variantHasStock, productVariants\)\);/);
});

test("#88 a cart line shows the compare-at price it was added with", () => {
  assert.equal(cartLineComparePrice({ compare_at_price: 800 }, null, 500), 800);
  assert.equal(cartLineComparePrice({ compare_at_price: 800 }, 900, 500), 900, "a price the rule found wins");
  assert.equal(cartLineComparePrice({ compare_at_price: 400 }, null, 500), 0, "never a compare price below the price");
  assert.equal(cartLineComparePrice({ compare_at_price: 800 }, null, 0), 0, "no saving on a line with no price");
  assert.equal(cartLineComparePrice({}, null, 500), 0);
});

test("#88 the cart display reads the fallback", async () => {
  const storefront = await read("../src/storefront/Storefront.jsx");
  const fn = storefront.slice(storefront.indexOf("const displayCartItemComparePrice = "), storefront.indexOf("const getVisibleCartActionElement"));
  assert.match(fn, /return cartLineComparePrice\(item, pricing\.comparePrice, pricing\.price\);/);
});

// A fake <img>: attribute src, dataset, and the resolved-URL property the browser keeps in step.
const fakeImage = (attrs = {}) => {
  const node = {
    attributes: { ...attrs },
    dataset: {},
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    get src() { return this.attributes.src || ""; },
    set src(value) { this.attributes.src = value; },
  };
  return node;
};
// What React does when the same <img> moves to another photo.
const reactRender = (node, { src, originalSrc }) => {
  node.attributes.src = src;
  node.attributes.srcset = `${src} 960w`;
  if (originalSrc) node.dataset.originalSrc = originalSrc; else delete node.dataset.originalSrc;
};

test("#89 a photo change starts the fallback walk over on the same <img>", () => {
  const node = fakeImage();
  reactRender(node, { src: "/a-w960.webp", originalSrc: "/a.jpg" });
  assert.equal(applyProductImageFallback(node), "original");
  assert.equal(node.src, "/a.jpg");

  // Photo B: its derivative is missing too, but its original exists.
  reactRender(node, { src: "/b-w960.webp", originalSrc: "/b.jpg" });
  assert.equal(applyProductImageFallback(node), "original", "not the logo: B's original has not been tried");
  assert.equal(node.src, "/b.jpg");

  // B's original is dead as well: the logo, once.
  assert.equal(applyProductImageFallback(node), "placeholder");
  assert.equal(applyProductImageFallback(node), "exhausted", "a failing logo does not loop");

  // Photo C after the logo: the walk runs again instead of leaving a broken image.
  reactRender(node, { src: "/c-w960.webp", originalSrc: "/c.jpg" });
  assert.equal(applyProductImageFallback(node), "original");
  assert.equal(node.src, "/c.jpg");
});

test("#89 an <img> without data-original-src (the sticky thumbnail) also resets on a new src", () => {
  const node = fakeImage({ src: "/x.jpg" });
  assert.equal(applyProductImageFallback(node), "placeholder");
  node.attributes.src = "/y.jpg";
  assert.equal(applyProductImageFallback(node), "placeholder", "walked again for the new photo");
  assert.equal(applyProductImageFallback(node), "exhausted");
  // Alternates still run in order and never repeat.
  const card = fakeImage({ src: "/dead.jpg" });
  card.dataset.fallbackSrc = "/d2.jpg|/d2.jpg|/good.jpg";
  assert.equal(applyProductImageFallback(card), "alternate");
  assert.equal(card.src, "/d2.jpg");
  assert.equal(applyProductImageFallback(card), "alternate");
  assert.equal(card.src, "/good.jpg");
});

test("#89 fallbackProductImage delegates to the resetting walk", async () => {
  const storefront = await read("../src/storefront/Storefront.jsx");
  const fn = storefront.slice(storefront.indexOf("const fallbackProductImage = "), storefront.indexOf("const safeStorefrontRecord"));
  assert.match(fn, /applyProductImageFallback\(node\);/);
  assert.ok(!fn.includes("originalTried"), "no second copy of the walk with its own flags");
});

test("#36 another tab's cart save is read from the storage event", () => {
  const key = "storefront.cart";
  assert.equal(cartFromStorageEvent({ key: "storefront.theme", newValue: "\"light\"" }, key), null);
  assert.equal(cartFromStorageEvent({ key: null, newValue: null }, key), null, "a full clear() is not an empty bag");
  assert.deepEqual(cartFromStorageEvent({ key, newValue: null }, key), [], "a removed cart is an empty bag");
  assert.deepEqual(cartFromStorageEvent({ key, newValue: "[{\"lineId\":\"a\"}]" }, key), [{ lineId: "a" }]);
  assert.equal(cartFromStorageEvent({ key, newValue: "{oops" }, key), null, "garbage never empties the bag");
  assert.equal(cartFromStorageEvent({ key, newValue: "{\"a\":1}" }, key), null);
});

test("#36 the mirrored cart is neither written back nor saved to the server by this tab", async () => {
  const storefront = await read("../src/storefront/Storefront.jsx");
  const shell = storefront.slice(storefront.indexOf("function Storefront()"));
  assert.match(
    shell,
    /const items = cartFromStorageEvent\(event, CART_KEY\);\s*if \(!items\) return;\s*const next = normalizeCartCollection\(items\);\s*cartFromOtherTabRef\.current = next;\s*cartRef\.current = next;\s*setCart\(next\);/
  );
  assert.match(shell, /if \(cart === cartFromOtherTabRef\.current\) return;\s*writeStorefrontStorage\(CART_KEY, cart\);/, "no echo back into storage");
  const save = shell.slice(shell.indexOf("if (!cartSyncReady) return undefined;"), shell.indexOf("const marker = readCartSyncMarker(phone);"));
  assert.match(save, /if \(cart === cartFromOtherTabRef\.current\) return undefined;/, "the tab that made the change owns the PUT");
});

test("#35 + stops at the stock the re-price saw; lowering always works and clears the warning", () => {
  const line = { lineId: "a", quantity: 2, price: 500, reprice_stock: 3 };
  assert.equal(clampCartLineQuantity(line, 3), 3);
  assert.equal(clampCartLineQuantity(line, 4), 3);
  assert.equal(clampCartLineQuantity({ ...line, quantity: 3 }, 4), 3);
  assert.equal(clampCartLineQuantity({ quantity: 2 }, 9), 9, "unknown stock is not capped client-side");
  assert.equal(clampCartLineQuantity({ ...line, quantity: 5 }, 6), 5, "over stock: + holds, never lowers by itself");
  assert.equal(clampCartLineQuantity({ ...line, quantity: 5 }, 4), 4);
  assert.equal(canIncreaseCartLine({ quantity: 3, reprice_stock: 3 }), false);
  assert.equal(canIncreaseCartLine({ quantity: 2, reprice_stock: 3 }), true);
  assert.equal(canIncreaseCartLine({ quantity: 1, reprice_stock: 0 }), false, "an out-of-stock line cannot grow");
  assert.equal(canIncreaseCartLine({ quantity: 9 }), true);

  const over = { lineId: "b", quantity: 4, price: 100, reprice_stock: 2, reprice_unavailable: "low_stock" };
  assert.equal(setCartLineQuantity(over, 5), over, "a refused + returns the same line");
  const lowered = setCartLineQuantity(over, 3);
  assert.equal(lowered.reprice_unavailable, "low_stock", "still over stock");
  const fixed = setCartLineQuantity(lowered, 2);
  assert.equal("reprice_unavailable" in fixed, false);
  assert.equal(fixed.total_amount, 200);
});

test("#35 the re-price stores stock on the line and a flagged line gets its own note", () => {
  const cart = [{ lineId: "a", variant_id: 1, quantity: 3, price: 500, name: "Clog" }];
  const { cart: repriced } = applyCartReprice(cart, [{ variant_id: 1, price: 500, stock: 2, available: true }]);
  assert.equal(repriced[0].reprice_stock, 2);
  assert.deepEqual(cartLineIssue(repriced[0]), { key: "storefront.cart.lineLowStock", stock: 2 });
  const again = applyCartReprice(repriced, [{ variant_id: 1, price: 500, stock: 2, available: true }]);
  assert.equal(again.cart, repriced, "unchanged stock does not re-render");
  assert.deepEqual(cartLineIssue({ reprice_unavailable: "out_of_stock" }), { key: "storefront.cart.lineOutOfStock", stock: 0 });
  assert.deepEqual(cartLineIssue({ reprice_unavailable: "unavailable" }), { key: "storefront.cart.lineUnavailable", stock: 0 });
  assert.equal(cartLineIssue({}), null);

  assert.equal(isCartLineCheckoutError({ status: 400, responseBody: { field: "items.variant_id" } }), true);
  assert.equal(isCartLineCheckoutError({ status: 400, responseBody: { field: "items.quantity" } }), true);
  assert.equal(isCartLineCheckoutError({ status: 400, responseBody: { field: "paid_amount" } }), false);
  assert.equal(isCartLineCheckoutError({ status: 500, responseBody: { field: "items.quantity" } }), false);
  assert.equal(isCartLineCheckoutError(undefined), false);
});

test("#35 the bag, the cart page and checkout use the line rules", async () => {
  const storefront = await read("../src/storefront/Storefront.jsx");
  assert.match(storefront, /prev\.map\(\(item\) => \(item\.lineId === lineId \? setCartLineQuantity\(item, nextQuantity\) : item\)\)/);
  const drawer = storefront.slice(storefront.indexOf("function CartDrawerLine("), storefront.indexOf("function CartDrawerLine(") + 4000);
  assert.match(drawer, /disabled=\{!canIncreaseCartLine\(item\)\}/);
  assert.match(drawer, /\{issue \? <p className="sfx-error sf-bag__line-issue">\{sfText\(issue\.key, undefined, \{ stock: issue\.stock \}\)\}<\/p> : null\}/);
  const cartPage = await read("../src/storefront/pages/StorefrontCartPage.jsx");
  assert.match(cartPage, /disabled=\{!canIncreaseCartLine\(item\)\}/);
  assert.match(cartPage, /const issue = cartLineIssue\(item\);/);
  const checkout = storefront.slice(storefront.indexOf("function CheckoutPage("));
  assert.match(checkout, /if \(isCartLineCheckoutError\(error\) && typeof repriceCart === "function"\) \{[\s\S]{0,300}await repriceCart\(\);\s*toast\.error\(sfText\("storefront\.cart\.lineCheckoutRefused"\)\);/);
});

test("the new copy exists in both storefront dictionaries", async () => {
  const keys = ["lineUnavailable", "lineOutOfStock", "lineLowStock", "lineCheckoutRefused"];
  for (const language of ["ar", "en"]) {
    const dictionary = JSON.parse(await read(`../src/locales/${language}/storefront.json`));
    for (const key of keys) assert.equal(typeof dictionary.cart?.[key], "string", `${language}: storefront.cart.${key}`);
    assert.ok(dictionary.cart.lineLowStock.includes("{{stock}}"), `${language}: the low-stock note names the count`);
  }
  const lib = await read("../src/storefront/lib/cartLine.js");
  assert.ok(!/[؀-ۿ]/.test(lib), "no inline Arabic in the cart line rules");
});

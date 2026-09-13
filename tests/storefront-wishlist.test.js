import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  entriesToToggleForClear,
  entriesToToggleForRestore,
  isInWishlist,
  toggleWishlistEntries,
  wishlistEntryMatches,
  wishlistIdOf,
  wishlistKeyOf,
} from "../src/storefront/lib/wishlistIdentity.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const NAVY = "6d7c8964-4e6b-41f3-aa44-5931335df00d";
const CAMEL = "53a72b0d-61bd-470f-b5fa-e24c2e2c054d";
const entry = (id, colour = "") => ({ key: colour ? `${id}:${colour}` : id, id, product_id: id, color_key: colour });

test("a listing card's product:colour id reaches the server as the model", () => {
  const card = { id: `785:${NAVY}`, product_id: `785:${NAVY}`, parent_product_id: "785", color_key: NAVY };
  assert.equal(wishlistIdOf(card), "785");
  assert.equal(wishlistKeyOf(card), `785:${NAVY}`);
  // No parent id and no color_key: both still come out of the composite id.
  assert.equal(wishlistIdOf({ id: `785:${NAVY}` }), "785");
  assert.equal(wishlistKeyOf({ id: `785:${NAVY}` }), `785:${NAVY}`);
  assert.equal(wishlistKeyOf({ id: 782 }), "782");
});

test("two colours of one model are two hearts; a colour-less entry lights every colour", () => {
  const list = [entry("785", NAVY)];
  assert.ok(isInWishlist(list, { id: `785:${NAVY}` }));
  assert.ok(!isInWishlist(list, { id: `785:${CAMEL}` }));
  // The product page product has no colour: it is saved if any colour is.
  assert.ok(isInWishlist(list, { id: "785" }));
  assert.ok(isInWishlist([entry("785")], { id: `785:${CAMEL}` }));
  assert.ok(!wishlistEntryMatches(entry("786", NAVY), { id: `785:${NAVY}` }));
});

test("the server row goes only when the last colour of the model goes", () => {
  const navyCard = { id: `785:${NAVY}`, color_key: NAVY };
  const camelCard = { id: `785:${CAMEL}`, color_key: CAMEL };

  const added = toggleWishlistEntries([], navyCard, entry("785", NAVY));
  assert.equal(added.serverChange, "add");
  const both = toggleWishlistEntries(added.next, camelCard, entry("785", CAMEL));
  assert.equal(both.next.length, 2, "hearting Camel must not un-heart Navy");
  assert.equal(both.serverChange, "add");

  const navyOff = toggleWishlistEntries(both.next, navyCard, entry("785", NAVY));
  assert.deepEqual(navyOff.next.map((item) => item.key), [`785:${CAMEL}`]);
  assert.equal(navyOff.serverChange, null, "Camel is still saved, so the model stays on the server");

  const camelOff = toggleWishlistEntries(navyOff.next, camelCard, entry("785", CAMEL));
  assert.deepEqual(camelOff.next, []);
  assert.equal(camelOff.serverChange, "remove");
});

test("clear all toggles each entry once, never adding one back", () => {
  const saved = [entry("785", NAVY), entry("785"), entry("782")];
  // Navy's toggle also takes the colour-less 785; toggling that one again would re-add it.
  assert.deepEqual(entriesToToggleForClear(saved).map((item) => item.key), [`785:${NAVY}`, "782"]);
});

test("undo puts entries back oldest first and skips what would cancel a colour", () => {
  const saved = [entry("785", NAVY), entry("785"), entry("782")];
  assert.deepEqual(entriesToToggleForRestore([], saved).map((item) => item.key), ["782", `785:${NAVY}`]);
  // Already back (e.g. hearted again before undo): not toggled off.
  assert.deepEqual(entriesToToggleForRestore([entry("782")], saved).map((item) => item.key), [`785:${NAVY}`]);
});

test("wiring: one card, one title, the live product, and the helpers everywhere", () => {
  const page = read("../src/storefront/pages/StorefrontWishlistPage.jsx");
  assert.match(page, /<ProductCard\b/, "the wishlist draws the homepage card");
  assert.match(page, /storefrontApi\.getProductDetails\(/, "tiles come from the live product, not the heart-time snapshot");
  assert.equal((page.match(/<h1\b/g) || []).length, 1);
  // No eyebrow over the title (owner decree: one title).
  const head = page.slice(page.indexOf('<header className="sfw-head">'), page.indexOf("</header>"));
  assert.ok(!/<p\b/.test(head.slice(0, head.indexOf("<h1"))), "an eyebrow label sits above the wishlist title");
  assert.ok(!/className=[^>]*\b(?:sf-wishlist-|sf-small-product-card)/.test(page), "legacy hooks carry !important rules; keep the sfw-* namespace");

  const storefront = read("../src/storefront/Storefront.jsx");
  assert.match(storefront, /import\("\.\/pages\/StorefrontWishlistPage"\)/);
  assert.ok(!/String\((?:item|entry)\??\.id\) === String\(product\??\.id\)/.test(storefront), "a raw id comparison bypasses the wishlist identity");
  assert.match(storefront, /toggleWishlistEntries\(prev, product, item\)/);
  const pdp = read("../src/storefront/pages/StorefrontProductDetailPage.jsx");
  assert.match(pdp, /isInWishlist\(wishlist, product\)/);
});

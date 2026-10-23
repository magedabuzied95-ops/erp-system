/*
 * The AI's product loaders must hand the card builder every price tier a variant can own.
 *
 * 2026-10-23, owner's test «عايز ايرفورس اسود ميرور»: the Black Air Force 1 card said 1,850 جنيه
 * while the shop sells it at 1,200. The colour is priced by MANUAL OVERRIDE on the variant, and both
 * loaders (brain V2's loadFullProductForPresentation, aiProductCards' WhatsApp image loader) built
 * their variant JSON without manual_selling_price / manual_price_override_active /
 * purchase_selling_price — so the canonical resolver saw a priceless variant and fell back to the
 * product row's 1,850.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalizeProductCards } from "../server/services/aiProductCards.js";

const variant = (id, color, extra = {}) => ({
  id, product_id: 61, color, color_name: color, size: "42", stock: 3, quantity: 3,
  price: 0, selling_price: 0, sale_price: 0, image_url: `/uploads/${color}.webp`, ...extra,
});

test("a colour priced by manual override cards at its own price, not the product row's", () => {
  const product = {
    id: 61,
    name: "Nike Air Force 1",
    price: 1850,
    selling_price: 1850,
    variants: [variant(1, "Black", { manual_selling_price: 1200, manual_price_override_active: true }), variant(2, "White")],
  };
  const cards = normalizeProductCards([product], { limit: 6 });
  assert.equal(cards.find((card) => card.color === "Black").price, 1200);
  assert.equal(cards.find((card) => card.color === "White").price, 1850, "a colour without its own price keeps the product's");
});

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

for (const [path, loader] of [
  ["server/services/aiBrainV2Service.js", "const loadFullProductForPresentation"],
  ["server/services/aiProductCards.js", "const loadFullProductForWhatsappImageRequest"],
]) {
  test(`${path}: the variant JSON carries the manual-override and purchase price tiers`, () => {
    const source = read(path);
    const body = source.slice(source.indexOf(loader), source.indexOf("AS variants", source.indexOf(loader)));
    for (const field of ["manual_selling_price", "manual_price_override_active", "purchase_selling_price"]) {
      assert.match(body, new RegExp(`'${field}', \\$\\{variantSelect\\.${field}\\}`), `${field} reaches the card builder`);
    }
  });
}

// 2026-10-23, the follow-up: «عايز ايرفورس اسود ساده» picked the Black card out of memory and sent the
// 1,850 it was stored with an hour earlier. Remembered cards take their colour's price off the shelf.
test("remembered cards take today's price for their colour, wherever memory keeps them", async () => {
  const { withLiveMemoryCardPrices } = await import("../server/services/aiBrainV2Service.js");
  const stale = { id: "61", product_id: "61", color: "Black", variant_id: "1792", price: 1850, price_text: "1,850 جنيه", display_price: 1850 };
  const memory = { last_product_cards: [stale], preferences: { lastProductCards: [stale], aiConversationMemoryV2: { lastShownProductCards: [stale] } } };
  const loadProduct = async ({ productId }) => (productId === "61" ? {
    id: 61, name: "Nike Air Force 1", price: 1850, selling_price: 1850,
    variants: [variant(1792, "Black", { manual_selling_price: 1200, manual_price_override_active: true }), variant(1800, "White")],
  } : null);
  const fresh = await withLiveMemoryCardPrices({ memory, tenantId: 1, loadProduct });
  for (const card of [fresh.last_product_cards[0], fresh.preferences.lastProductCards[0], fresh.preferences.aiConversationMemoryV2.lastShownProductCards[0]]) {
    assert.equal(card.price, 1200);
    assert.equal(card.display_price, 1200, "a stale display_price would still win in resolveCardDisplayPrice");
    assert.equal(card.price_text, "1,200 جنيه");
  }
  assert.equal(memory.last_product_cards[0].price, 1850, "the caller's memory object is not mutated");

  const unloadable = await withLiveMemoryCardPrices({ memory, tenantId: 1, loadProduct: async () => null });
  assert.equal(unloadable.last_product_cards[0].price, 1850, "a product that cannot be loaded keeps what memory had");
});

test("brain V2 reads its memory through the shelf-price refresh, before any follow-up uses it", () => {
  const source = read("server/services/aiBrainV2Service.js");
  const generate = source.slice(source.indexOf("export const generateAiBrainV2Decision"));
  assert.match(generate, /const memory = await withLiveMemoryCardPrices\(\{ memory: options\.memory/);
});

test("WhatsApp: words over product cards default to no «شوفه من هنا» link", () => {
  const source = read("server/services/aiInboxService.js");
  assert.match(source, /let replyText = repliesWithCards && !normalizeAiReplyRules\(rules\)\.ai_rules_product_link\s*\? text\(reply\.text \|\| aiPayload\.answer \|\| ""\)\s*: ensureProductLinkInReply\(/);
});

// 2026-10-23, «عايزه اسود» over a Skechers card came back Beige twice, its name growing a colour per pass.
test("a colour card normalized again stays its own colour, under its base name", () => {
  const skechers = { id: 562, name: "SKECHERS SLIP INS", price: 1550, product_url: "https://m1store-egy.com/p/562",
    // As on the shelf: Grey and Beige in 41–45, Black up to 44 — the colour with more sizes used to win.
    variants: ["Grey", "Beige", "Black"].flatMap((color, c) => (color === "Black" ? ["41", "42", "43", "44"] : ["41", "42", "43", "44", "45"])
      .map((size, s) => ({ ...variant(7913 + c * 5 + s, color), size, price: 1550 }))) };
  const black = normalizeProductCards([skechers], { limit: 24 }).find((card) => card.color === "Black");
  for (const options of [{ limit: 1 }, { limit: 1, preserveUnavailableCards: true }]) {
    const again = normalizeProductCards([black], options);
    assert.equal(again[0].color, "Black", JSON.stringify(options));
    assert.equal(again[0].name, "SKECHERS SLIP INS - Black");
    assert.equal(again[0].base_name, "SKECHERS SLIP INS");
  }
});

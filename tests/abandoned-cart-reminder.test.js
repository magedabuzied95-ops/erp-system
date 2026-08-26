import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ABANDONED_CART_DEFAULTS } from "../shared/abandonedCartDefaults.js";

// A signed-in customer's cart is saved per phone; sit on it past the delay and they get ONE
// carousel — the nudge text, then a card per product with photo, price and a complete-order
// button opening /cart, which restores itself from the same saved rows.

const service = fs.readFileSync(
  new URL("../server/services/abandonedCartReminderService.js", import.meta.url), "utf8"
);
const gateway = fs.readFileSync(
  new URL("../server/services/whatsappGatewayService.js", import.meta.url), "utf8"
);
const server = fs.readFileSync(new URL("../server/server.js", import.meta.url), "utf8");
const registry = fs.readFileSync(new URL("../shared/settingsRegistry.js", import.meta.url), "utf8");

// Execute the REAL card/carousel builder with stubs for its two imports.
const from = service.indexOf("const cardFromItem");
const to = service.indexOf("const claimCart");
assert.ok(from > -1 && to > from, "builder block found");
// eslint-disable-next-line no-new-func
const { buildAbandonedCartCarousel } = new Function(
  "ABANDONED_CART_DEFAULTS", "resolvePublicAppUrl",
  `const text=(v="")=>String(v??"").trim();\n${service.slice(from, to).replaceAll("export const", "const")}\nreturn { buildAbandonedCartCarousel };`
)(ABANDONED_CART_DEFAULTS, () => "https://m1store-egy.com");

const CART = [
  { name: "Nike Air Force 1", sale_price: 1245, image_url: "/uploads/nike.jpg", quantity: 1 },
  { name: "New Balance 530", price: 1700, image_url: "https://cdn.example.com/nb.jpg", quantity: 2 },
];

test("each cart item becomes a card with name, price and the complete-order button", () => {
  const { body, cards, cartUrl } = buildAbandonedCartCarousel(CART);
  assert.equal(cards.length, 2);
  assert.match(cards[0].body, /Nike Air Force 1/);
  assert.match(cards[0].body, /EGP 1,245/);
  assert.equal(cards[0].url, "https://m1store-egy.com/cart");
  assert.equal(cards[0].buttonText, ABANDONED_CART_DEFAULTS.button_text);
  assert.equal(cartUrl, "https://m1store-egy.com/cart");
  assert.equal(body, ABANDONED_CART_DEFAULTS.body);
});

test("a nameless item is dropped rather than sent as an empty card", () => {
  const { cards } = buildAbandonedCartCarousel([{ price: 100 }, ...CART]);
  assert.equal(cards.length, 2, "only the named items survive");
});

test("the card count is capped and the fallback text still carries the cart link", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `منتج ${i + 1}`, price: 100 }));
  const { cards, fallbackText } = buildAbandonedCartCarousel(many);
  assert.equal(cards.length, ABANDONED_CART_DEFAULTS.max_cards);
  assert.match(fallbackText, /m1store-egy\.com\/cart/);
});

test("the reminder claims BEFORE it sends, so a crash costs one reminder not two", () => {
  const tick = service.slice(service.indexOf("export const runAbandonedCartReminderTick"));
  const claimIndex = tick.indexOf("const claimed = await claimCart(row)");
  const sendIndex = tick.indexOf("await sendCartCarouselMessage(");
  assert.ok(claimIndex > -1 && sendIndex > -1);
  assert.ok(claimIndex < sendIndex, "claim first, send after");
  assert.match(tick, /if \(!claimed\) continue/);
});

test("the claim re-arms when the cart changes, and only then", () => {
  assert.match(service, /reminder_sent_at IS NULL OR reminder_sent_at < updated_at/);
});

test("the feature ships OFF and is registered as a setting", () => {
  assert.equal(ABANDONED_CART_DEFAULTS.enabled, false, "a marketing send must be opted into");
  assert.match(registry, /marketing\.abandoned_cart_reminder/);
  assert.match(service, /if \(!config\.enabled\) return/);
});

test("the carousel sender exists and falls back to text with the same link", () => {
  const fn = gateway.slice(gateway.indexOf("export const sendCartCarouselMessage"), gateway.indexOf("export const buildOrderConfirmationMessage"));
  assert.match(fn, /sendCarousel/);
  assert.match(fn, /fallbackOnNotDelivered/);
  assert.match(fn, /resolvePublicImageUrl/, "relative /uploads images are resolved to public URLs");
  // Evolution accepts a card with `image` and silently drops the picture; only `imageUrl` renders.
  assert.match(fn, /imageUrl: resolvePublicImageUrl/, "cards use the field name Evolution actually reads");
  assert.match(fn, /sendTextMessage\(\{ phone: normalizedPhone/);
});

test("the scheduler is wired and failure-isolated", () => {
  assert.match(server, /runAbandonedCartReminderTick/);
  const tick = server.slice(server.indexOf("const abandonedCartInterval"));
  assert.match(tick, /catch\(\(error\) =>/);
  assert.match(server, /backgroundIntervals\.add\(abandonedCartInterval\)/);
});

test("the setting's category is one the registry actually accepts", async () => {
  // setSetting refuses any category normalizeSettingsCategory does not know; "marketing" was not
  // one of them, which made the setting impossible to save from the very screen it was built for.
  const { normalizeSettingsCategory, settingsByKey } = await import("../shared/settingsRegistry.js");
  const def = settingsByKey["marketing.abandoned_cart_reminder"];
  assert.ok(def, "the setting is registered");
  assert.equal(normalizeSettingsCategory(def.category), def.category, "its category is a real category");
});

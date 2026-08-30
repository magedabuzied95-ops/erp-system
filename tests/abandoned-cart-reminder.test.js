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

test("card photos are swapped for the padded square variant before building", () => {
  const svc = fs.readFileSync(new URL("../server/services/abandonedCartReminderService.js", import.meta.url), "utf8");
  const tick = svc.slice(svc.indexOf("export const runAbandonedCartReminderTick"));
  const swapIndex = tick.indexOf("ensureSquareCardImageUrl");
  const buildIndex = tick.indexOf("buildAbandonedCartCarousel(items");
  assert.ok(swapIndex > -1, "the tick squares the images");
  assert.ok(buildIndex > -1 && swapIndex < buildIndex, "squaring happens before the cards are built");
  assert.match(tick, /squared \? \{ \.\.\.item, image_url: squared \} : item/, "a failed square keeps the original photo");
});

// ── The transcript side ───────────────────────────────────────────────────────────────────────
// Evolution's echo of our own send carries the carousel's BODY TEXT only, so the inbox showed the
// nudge words with no products under them while the customer was looking at a strip of photos.
// The cards are written by the reminder itself, as a `product_card` row. Same extraction trick as
// the carousel builder above: run the REAL code with stubs for its imports.
const recorded = [];
const emitted = [];
const inboxFrom = service.indexOf("const inboxCardFromItem");
const inboxTo = service.indexOf("const claimCart");
assert.ok(inboxFrom > -1 && inboxTo > inboxFrom, "inbox card block found");
// eslint-disable-next-line no-new-func
const { buildAbandonedCartInboxCards, recordAbandonedCartInboxCards } = new Function(
  "ABANDONED_CART_DEFAULTS", "appendChannelOutboundSupportReply", "emitToRooms",
  "normalizeWhatsappSessionId", "normalizeWhatsappPhone",
  `const text=(v="")=>String(v??"").trim();\n${service.slice(inboxFrom, inboxTo).replaceAll("export const", "const")}\nreturn { buildAbandonedCartInboxCards, recordAbandonedCartInboxCards };`
)(
  ABANDONED_CART_DEFAULTS,
  async (options) => { recorded.push(options); return { id: 501, message_type: options.messageType }; },
  (rooms, event, payload) => emitted.push({ rooms, event, payload }),
  (phone) => (String(phone || "").trim() ? `whatsapp:20${String(phone || "").trim().slice(-10)}` : ""),
  (phone) => String(phone || "").trim()
);

const CART_ROW = { id: 9, tenant_id: 4, customer_phone: "01011122233" };
const recordOnce = async (overrides = {}) => {
  recorded.length = 0;
  emitted.length = 0;
  return recordAbandonedCartInboxCards({
    row: CART_ROW,
    items: CART,
    config: ABANDONED_CART_DEFAULTS,
    claimedAt: "2026-08-30T15:00:00.000Z",
    sendResult: { instanceName: "m1" },
    ...overrides,
  });
};

test("the cards the customer swiped are written to the transcript, not only the nudge text", async () => {
  await recordOnce();
  assert.equal(recorded.length, 1, "one transcript row per reminder");
  const [saved] = recorded;
  assert.equal(saved.messageType, "product_card", "the inbox renders cards off this type");
  assert.equal(saved.channel, "whatsapp");
  assert.equal(saved.productCards.length, 2, "a card per cart line, same as the carousel");
  assert.equal(saved.productCards[0].product_name, "Nike Air Force 1");
  assert.equal(saved.productCards[0].price, 1245);
  assert.equal(saved.productCards[0].image_url, "/uploads/nike.jpg", "the photo is what was missing");
  assert.equal(saved.productCards[1].image_url, "https://cdn.example.com/nb.jpg");
  assert.equal(saved.sessionId, "whatsapp:201011122233", "keyed off the customer's phone");
});

test("the card row leaves the echo's text bubble alone", async () => {
  await recordOnce();
  const [saved] = recorded;
  // Claiming the send's provider id would make the echo dedupe INTO this row and the sent words
  // would vanish from the transcript. WhatsApp shows the customer text AND cards; so does the inbox.
  assert.ok(!saved.providerMessageId, "no provider id on the card row");
  assert.ok(!saved.externalMessageId, "no external id either");
  assert.equal(saved.clientRequestId, "abandoned_cart:9:2026-08-30T15:00:00.000Z", "one claim, one row");
});

test("a marketing nudge never hands a human-run conversation back to the AI", async () => {
  await recordOnce();
  const [saved] = recorded;
  assert.equal(saved.preserveSessionState, true, "status and list preview stay as the customer left them");
  assert.equal(saved.senderType, "system", "nobody sent this by hand");
});

test("the open conversation sees the cards without a reload", async () => {
  await recordOnce();
  const message = emitted.find((event) => event.event === "ai_inbox:message");
  assert.ok(message, "the transcript row is pushed to the open inbox");
  assert.deepEqual(message.rooms, ["tenant:4"]);
  assert.equal(message.payload.message.direction, "outbound");
});

test("nothing is written when there is no conversation to write to", async () => {
  await recordOnce({ row: { ...CART_ROW, customer_phone: "" } });
  assert.equal(recorded.length, 0, "an unkeyable phone writes no orphan row");
  await recordOnce({ items: [{ price: 100 }] });
  assert.equal(recorded.length, 0, "a nameless cart writes no empty card strip");
});

test("the inbox cards are capped the same way the carousel is", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ name: `منتج ${i + 1}`, price: 100 }));
  assert.equal(buildAbandonedCartInboxCards(many).length, ABANDONED_CART_DEFAULTS.max_cards);
});

test("the square variant pads instead of cropping, so no client crop can eat the product", () => {
  const variants = fs.readFileSync(new URL("../server/services/productImageVariantService.js", import.meta.url), "utf8");
  const fn = variants.slice(variants.indexOf("export const ensureSquareCardImageUrl"));
  assert.match(fn, /fit: "contain"/, "the product is contained, never cover-cropped");
  assert.match(fn, /\.extend\(\{ top: margin/, "the margin is real canvas, not a resize artifact");
  assert.match(fn, /\.jpeg\(/, "output is JPEG - Meta has rejected WebP elsewhere");
});

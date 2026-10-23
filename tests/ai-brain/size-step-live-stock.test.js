import test from "node:test";
import assert from "node:assert/strict";

import pool from "../../server/database/db.js";

/**
 * Production, 2026-10-23 ~04:20 (owner's test WhatsApp): «طيب النيو بالانس 530 ده عندكم مقاس 47؟»
 * got «مقاس 47 مش متوفر حاليًا في New Balance 530 - Navy». Product 180 "New Balance 530" had Navy
 * 47 in stock (variant 7745, stock 1); product 144 is a second "New Balance 530" with no 47 at all.
 * The size step read the sizes off the cards remembered from the earlier turn — a snapshot of one
 * of the two — and never looked at the shelf. A minute later get_inventory said Navy 47 is there.
 */

const rows = {
  144: { id: 144, name: "New Balance 530", status: "active", stock: 9, price: 1450, tenant_id: 1, image_url: "https://cdn.example.test/nb530-144.jpg" },
  180: { id: 180, name: "New Balance 530", status: "active", stock: 1, price: 1650, tenant_id: 1, image_url: "https://cdn.example.test/nb530-180.jpg" },
};
const variants = {
  144: ["41", "42", "43", "44", "45"].map((size, index) => ({ id: 14400 + index, product_id: 144, size, color: "Navy", stock: 2, is_active: true })),
  180: [
    { id: 7744, product_id: 180, size: "42", color: "Navy", stock: 0, is_active: true },
    { id: 7745, product_id: 180, size: "47", color: "Navy", stock: 1, is_active: true },
  ],
};
const queries = [];
pool.query = async (sql, params = []) => {
  const query = String(sql);
  queries.push(query);
  if (query.includes("information_schema.columns")) {
    const columns = {
      products: ["id", "name", "status", "stock", "price", "tenant_id", "image_url", "is_active", "deleted_at"],
      product_variants: ["id", "product_id", "size", "color", "stock", "is_active"],
    }[params[0]] || [];
    return { rows: columns.map((column_name) => ({ column_name })) };
  }
  if (query.includes("same_name_product_id")) {
    const wanted = asLower(params[1]);
    return { rows: Object.values(rows).filter((row) => wanted.includes(row.name.toLowerCase())).map((row) => ({ same_name_product_id: row.id })) };
  }
  if (query.includes("AS variants")) {
    const row = rows[Number(params[0])];
    return { rows: row ? [{ ...row, variants: variants[row.id] || [], product_variant_images: [] }] : [] };
  }
  return { rows: [] };
};
const asLower = (values) => (Array.isArray(values) ? values : []).map((value) => String(value).toLowerCase());

const { generateAiBrainV2Decision } = await import("../../server/services/aiBrainV2Service.js");
const { normalizeArabicIntentPayload } = await import("../../server/utils/arabicTextNormalizer.js");

const navyCard = (productId, sizes) => ({
  id: productId,
  product_id: productId,
  name: "New Balance 530 - Navy",
  title: "New Balance 530 - Navy",
  base_name: "New Balance 530",
  color: "Navy",
  available_sizes: sizes,
  sizes,
  price: rows[productId].price,
  image_url: rows[productId].image_url,
});

const ask = (raw, card) => {
  const memory = {
    active_product_id: String(card.product_id),
    selected_product_id: String(card.product_id),
    activeColor: "Navy",
    selectedColor: "Navy",
    last_product_cards: [card],
    preferences: { active_product_id: String(card.product_id), activeColor: "Navy", last_product_cards: [card] },
  };
  return generateAiBrainV2Decision(
    { channel: "whatsapp", text: normalizeArabicIntentPayload(raw).normalizedForIntent, metadata: { original_message: raw, tenant_id: 1, ai_memory: memory } },
    { tenantId: 1, memory },
  );
};

const MESSAGE = "طيب النيو بالانس 530 ده عندكم مقاس 47؟ لو مش موجود بلّغني لما ينزل";

test("the size step finds 47 on the other «New Balance 530» when the card on screen has none", async () => {
  const decision = await ask(MESSAGE, navyCard(144, ["41", "42", "43", "44", "45"]));
  assert.equal(decision.intent, "post_product_size_selected");
  assert.doesNotMatch(decision.text, /مش متوفر/, decision.text);
  assert.match(decision.text, /مقاس 47 متوفر/);
  assert.equal(String(decision.active_product_id), "180");
  assert.ok(decision.product_cards.every((card) => card.available_sizes.includes("47")));
});

test("the size step reads the shelf, not the sizes remembered on the card", async () => {
  // The same product, its card remembered before Navy 47 came in.
  const decision = await ask("عندكم مقاس 47؟", navyCard(180, ["42"]));
  assert.equal(decision.intent, "post_product_size_selected");
  assert.match(decision.text, /مقاس 47 متوفر/, decision.text);
  assert.equal(String(decision.active_product_id), "180");
});

test("a size nobody has is still answered as not available", async () => {
  const decision = await ask("عندكم مقاس 48؟", navyCard(144, ["41", "42", "43", "44", "45"]));
  assert.equal(decision.intent, "post_product_size_selected");
  assert.match(decision.text, /مقاس 48 مش متوفر/, decision.text);
});

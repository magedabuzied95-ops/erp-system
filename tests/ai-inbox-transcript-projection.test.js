import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { slimTranscriptMessage } from "../server/lib/inboxTranscriptProjection.js";

const card = (id) => ({
  id,
  product_id: id,
  name: `Samba ${id}`,
  image_url: `https://cdn.example.test/${id}.jpg`,
  color: "Black",
  variant_id: id * 10,
  variants: Array.from({ length: 12 }, (_, index) => ({ id: id * 100 + index, size: String(38 + index), stock: 1 })),
});

const fullMessage = (overrides = {}) => ({
  id: 1,
  session_id: "whatsapp:201000000000",
  channel: "whatsapp",
  external_message_id: "wamid.A",
  provider_message_id: "wamid.A",
  external_reply_id: "",
  quoted_message: null,
  dedupe_key: "whatsapp:wamid.A",
  customer_message: "",
  ai_answer: "متاح",
  staff_message: "",
  sender_type: "assistant",
  direction: "outbound",
  delivery_status: "",
  delivery_error: "",
  error_code: "",
  message_type: "product_cards",
  original_message_text: "",
  edit_history: [],
  deleted_at: null,
  deleted_scope: null,
  suggested_products: [card(7)],
  product_cards: [card(7), card(8)],
  productCards: [card(7), card(8)],
  visual_attachments: [],
  suggested_actions: [],
  post_id: "",
  post_full_picture: "",
  commenter_name: "",
  source_comment_text: "",
  system_events: [],
  created_at: "2026-10-21T10:00:00.000Z",
  ...overrides,
});

test("the transcript page drops the card copy, the variant lists and the redundant suggested products", () => {
  const slim = slimTranscriptMessage(fullMessage());
  assert.equal("productCards" in slim, false);
  assert.equal("suggested_products" in slim, false, "product_cards is read first everywhere");
  assert.equal(slim.product_cards.length, 2);
  for (const item of slim.product_cards) {
    assert.equal("variants" in item, false);
    assert.equal(item.variant_id, item.id * 10, "the chosen variant stays");
    assert.ok(item.image_url && item.name);
  }
  assert.ok(JSON.stringify(slim).length < JSON.stringify(fullMessage()).length / 2);
});

test("suggested products stay when they are the only cards a message has", () => {
  const slim = slimTranscriptMessage(fullMessage({ product_cards: [], productCards: [] }));
  assert.equal(slim.suggested_products.length, 1);
  assert.equal("variants" in slim.suggested_products[0], false);
});

test("empty origin fields that are fixed at write time are dropped", () => {
  const slim = slimTranscriptMessage(fullMessage());
  for (const field of ["external_reply_id", "quoted_message", "deleted_scope", "post_id", "post_full_picture", "commenter_name", "source_comment_text", "system_events"]) {
    assert.equal(field in slim, false, `${field} should be dropped when empty`);
  }
  // Present values are never dropped.
  const quoted = slimTranscriptMessage(fullMessage({ external_reply_id: "wamid.Q", quoted_message: { text: "hi" }, post_id: "123" }));
  assert.equal(quoted.external_reply_id, "wamid.Q");
  assert.deepEqual(quoted.quoted_message, { text: "hi" });
  assert.equal(quoted.post_id, "123");
});

test("fields that can be cleared later are always sent, even empty", () => {
  // The client merges a page over the bubble it holds with an object spread, so a field
  // missing from the page would keep a stale value (an old delivery error, a deleted photo).
  const slim = slimTranscriptMessage(fullMessage());
  for (const field of ["delivery_status", "delivery_error", "error_code", "deleted_at", "customer_message", "ai_answer", "staff_message", "original_message_text", "edit_history", "visual_attachments", "suggested_actions", "product_cards", "dedupe_key", "provider_message_id", "external_message_id"]) {
    assert.equal(field in slim, true, `${field} must stay on the page`);
  }
});

test("a deleted message still tells the client its cards and attachments are gone", () => {
  const slim = slimTranscriptMessage(fullMessage({ deleted_at: "2026-10-21T11:00:00.000Z", product_cards: [], productCards: [], suggested_products: [] }));
  assert.deepEqual(slim.product_cards, []);
  assert.deepEqual(slim.suggested_products, []);
  assert.deepEqual(slim.visual_attachments, []);
});

test("only the transcript route is slimmed; other loadAiInboxMessages callers keep the full shape", () => {
  const route = readFileSync("server/routes/aiAgentOrders.js", "utf8");
  const handler = route.slice(route.indexOf('router.get("/conversations/:conversationId/messages"'), route.indexOf('router.get("/debug/regression-lookup"'));
  assert.match(handler, /payload\.messages\.map\(slimTranscriptMessage\)/);
  const service = readFileSync("server/services/aiSalesAgentService.js", "utf8");
  assert.doesNotMatch(service, /slimTranscriptMessage/);
});

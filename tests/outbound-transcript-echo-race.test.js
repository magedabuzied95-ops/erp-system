// A product card sent from the AI Inbox and WhatsApp's own echo of it carry the SAME provider id,
// and the echo lands within milliseconds. When it slips in between the card writer's lookup and its
// INSERT, the INSERT hits the unique provider-id index and does nothing. The writer used to return
// the echo row as it was — bare text, no cards — so the inbox showed "Skechers Max Cushion" and
// never the card the customer actually got (2026-10-19, live). The writer that knows the message
// must win the row; a writer that defers to an existing row (the echo) must keep deferring.
import test from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import { appendManualAiSupportReply, appendChannelOutboundSupportReply } from "../server/services/aiSupportLogService.js";

const ECHO_ROW = {
  id: 9001,
  session_id: "whatsapp:201000000001",
  message_type: "text",
  message_text: "Skechers Max Cushion",
  product_cards: [],
};

// Every lookup misses (the echo is not committed yet), the INSERT loses the race (ON CONFLICT DO
// NOTHING returns no row), and only then does the echo row exist.
const raceDb = () => {
  const calls = [];
  const original = db.query;
  db.query = async (sql, params = []) => {
    const text = String(sql);
    calls.push(text);
    if (/INSERT INTO ai_support_messages/i.test(text)) return { rows: [] };
    if (/SELECT \*\s+FROM ai_support_messages[\s\S]*provider_message_id = \$3/i.test(text)) return { rows: [ECHO_ROW] };
    if (/UPDATE ai_support_messages\s+SET\s+session_ref_id/i.test(text)) {
      return { rows: [{ ...ECHO_ROW, id: params[0], message_type: params[36], product_cards: JSON.parse(params[37] || "[]") }] };
    }
    return { rows: [] };
  };
  return { calls, restore: () => { db.query = original; } };
};

test("the card writer wins the row the echo grabbed first", async () => {
  const { calls, restore } = raceDb();
  try {
    const row = await appendManualAiSupportReply({
      tenantId: 1,
      sessionId: "whatsapp:201000000001",
      message: "Skechers Max Cushion - Black & Gray",
      messageType: "product_card",
      productCards: [{ product_id: "5", name: "Skechers Max Cushion", color: "Black & Gray", price: 1300, image_url: "https://api.example.com/uploads/products/variants/a-card1200.jpg" }],
      channel: "whatsapp",
      providerMessageId: "3EB0826033B17577DA81A8",
      externalMessageId: "3EB0826033B17577DA81A8",
      upsertSession: false,
    });
    assert.ok(calls.some((sql) => /UPDATE ai_support_messages\s+SET\s+session_ref_id/i.test(sql)), "the echo row is rewritten with the card");
    assert.equal(row.id, ECHO_ROW.id, "one row, not two bubbles");
    assert.equal(row.message_type, "product_card");
    assert.ok(Array.isArray(row.product_cards) && row.product_cards.length === 1, "the card survives");
  } finally {
    restore();
  }
});

test("the echo still defers when it is the one that loses the race", async () => {
  const { calls, restore } = raceDb();
  try {
    const row = await appendChannelOutboundSupportReply({
      tenantId: 1,
      sessionId: "whatsapp:201000000001",
      message: "Skechers Max Cushion",
      messageType: "text",
      channel: "whatsapp",
      senderType: "staff",
      providerMessageId: "3EB0826033B17577DA81A8",
      externalMessageId: "3EB0826033B17577DA81A8",
      preserveExistingOnProviderMatch: true,
    });
    assert.ok(!calls.some((sql) => /UPDATE ai_support_messages\s+SET\s+session_ref_id/i.test(sql)), "the echo never overwrites");
    assert.equal(row.id, ECHO_ROW.id);
  } finally {
    restore();
  }
});

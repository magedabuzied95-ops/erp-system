import test from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import { extractWhatsappCallEvent, handleWhatsappCallEvent } from "../server/services/whatsappGatewayService.js";

/*
 * A WhatsApp call rings from the caller's LID, never from their number — even for a customer
 * we have been messaging on that number for months. Keying the call row on the raw LID opened
 * a second, nameless `whatsapp:lid:<id>` thread beside the real conversation: the owner saw
 * "مكالمة من العميل" from an account with no name, no avatar and no history, and the customer's
 * own thread showed nothing at all.
 *
 * The call must resolve the LID to the phone we already stored, exactly as an inbound message
 * does, and land in that customer's thread.
 */

const CUSTOMER_PHONE = "201098765432";
const CALLER_LID = "42164046287101";
const LID_JID = `${CALLER_LID}@lid`;

/**
 * Answers every query the call path fires by shape. The two that decide the thread are the
 * LID lookups; everything else is schema chatter that must not decide anything.
 */
const stubCallDb = ({ knownLid = true } = {}) => {
  const original = db.query;
  const writes = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/INSERT INTO ai_channel_conversations/i.test(text)) {
      writes.push({ kind: "conversation", params });
      return { rows: [{ id: 1, inserted: true }] };
    }
    if (/INSERT INTO ai_support_messages/i.test(text)) {
      writes.push({ kind: "message", params });
      return { rows: [{ id: 99 }] };
    }
    // The stored mapping: a phone-keyed conversation that remembered this caller's LID.
    if (/FROM ai_channel_conversations/i.test(text) && /metadata->>'lid_jid'/.test(text)) {
      if (!knownLid) return { rows: [] };
      return {
        rows: [
          {
            external_customer_id: CUSTOMER_PHONE,
            external_conversation_id: `whatsapp:${CUSTOMER_PHONE}`,
            metadata: { phone: CUSTOMER_PHONE, lid_jid: LID_JID, resolved_phone: CUSTOMER_PHONE },
            updated_at: new Date().toISOString(),
          },
        ],
      };
    }
    if (/FROM ai_support_messages/i.test(text)) return { rows: [] };
    if (/to_regclass|information_schema|pg_indexes|CREATE |ALTER |COMMENT ON/i.test(text)) {
      return { rows: [{ exists: 1, regclass: "public.exists" }] };
    }
    return { rows: [] };
  };
  return {
    writes,
    restore: () => {
      db.query = original;
    },
  };
};

const callPayload = (id) => ({
  event: "call",
  instance: "m1",
  tenant_id: 1,
  data: [{ id, from: LID_JID, isVideo: false, status: "offer" }],
});

const conversationKeyOf = (writes) => {
  const row = writes.find((entry) => entry.kind === "conversation");
  // (tenant_id, channel, external_conversation_id, external_customer_id, ...)
  return { sessionId: row?.params?.[2] || "", customerId: row?.params?.[3] || "" };
};

test("a call from a customer we know by number lands in that customer's thread, not a new LID one", async () => {
  const { writes, restore } = stubCallDb({ knownLid: true });
  try {
    const payload = callPayload("CALL-KNOWN-1");
    const result = await handleWhatsappCallEvent({ payload, call: extractWhatsappCallEvent(payload) });
    assert.equal(result.handled, true);
    assert.equal(
      result.inbox.session_id,
      `whatsapp:${CUSTOMER_PHONE}`,
      "the call was filed under the LID instead of the customer's own thread"
    );
    assert.equal(result.phone, CUSTOMER_PHONE, "the resolved number must travel with the call");

    const { sessionId, customerId } = conversationKeyOf(writes);
    assert.equal(sessionId, `whatsapp:${CUSTOMER_PHONE}`);
    assert.equal(customerId, CUSTOMER_PHONE);
  } finally {
    restore();
  }
});

test("a stranger's call still gets its own LID thread rather than a guessed number", async () => {
  const { writes, restore } = stubCallDb({ knownLid: false });
  try {
    const payload = callPayload("CALL-STRANGER-1");
    const result = await handleWhatsappCallEvent({ payload, call: extractWhatsappCallEvent(payload) });
    assert.equal(result.handled, true);
    assert.equal(result.inbox.session_id, `whatsapp:lid:${CALLER_LID}`);
    // A LID is 13-15 digits and passes for an international number. Never write it as a phone.
    assert.equal(result.phone, "", "LID digits must never be stored as the customer's phone");
    const { customerId } = conversationKeyOf(writes);
    assert.equal(customerId, "", "an empty customer id is correct; a LID in that column is not");
  } finally {
    restore();
  }
});

test("the call's metadata never blanks a phone the thread already knew", async () => {
  const { writes, restore } = stubCallDb({ knownLid: false });
  try {
    const payload = callPayload("CALL-STRANGER-2");
    await handleWhatsappCallEvent({ payload, call: extractWhatsappCallEvent(payload) });
    const row = writes.find((entry) => entry.kind === "conversation");
    const metadata = JSON.parse(String(row.params[11] || "{}"));
    // The upsert merges metadata with jsonb `||`, so a key present-but-empty overwrites.
    assert.equal("phone" in metadata, false, "an unresolved call must not write phone: '' over a real number");
    assert.equal(metadata.lid_jid, LID_JID, "the caller's LID is still remembered for next time");
  } finally {
    restore();
  }
});

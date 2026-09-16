import test from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import { chooseMergeTarget, isUsablePhone, main } from "../server/scripts/mergeWhatsappLidThreadIntoPhone.js";

/*
 * The repair that folds a stray LID thread into the customer's number thread.
 *
 * Every assertion here exists because the wrong answer is worse than no answer:
 * a guessed number files one customer's missed call into a different customer's
 * conversation, and the session_ref_id cascade turns a careless drop into
 * deleted messages.
 */

const LID = "42164046287101";
const CUSTOMER = "201098765432";
const OWN_NUMBER = "201000659301";

test("a LID is never accepted as the number it superficially resembles", () => {
  // 14 digits, all numeric — it passes for an international number and is not one.
  assert.equal(isUsablePhone(LID, LID), false);
  assert.equal(isUsablePhone(LID, "999"), false, "even against another chat, a bare LID is not an Egyptian mobile");
  assert.equal(isUsablePhone(OWN_NUMBER, LID), false, "the store's own number is never a merge target");
  assert.equal(isUsablePhone("", LID), false);
  assert.equal(isUsablePhone(CUSTOMER, LID), true);
});

test("a number is chosen only on stored evidence, never on a hunch", () => {
  assert.equal(chooseMergeTarget({ lidId: LID }).target, null, "no evidence must mean no merge");
  assert.equal(chooseMergeTarget({ lidId: LID }).reason, "no_stored_number");

  const fromMessage = chooseMergeTarget({
    lidId: LID,
    messageRows: [{ resolved_phone: CUSTOMER, hits: 4 }],
  });
  assert.equal(fromMessage.target.phone, CUSTOMER);

  const fromConversation = chooseMergeTarget({
    lidId: LID,
    conversationRows: [{ external_conversation_id: `whatsapp:${CUSTOMER}`, external_customer_id: CUSTOMER, metadata: {} }],
  });
  assert.equal(fromConversation.target.phone, CUSTOMER);

  // A LID sitting in resolved_phone is exactly the damage this repair must not repeat.
  const poisoned = chooseMergeTarget({ lidId: LID, messageRows: [{ resolved_phone: LID, hits: 9 }] });
  assert.equal(poisoned.target, null, "LID digits in a phone column must be rejected, not merged on");
});

test("two different numbers for one LID stops the merge instead of picking one", () => {
  const other = "201234567890";
  const outcome = chooseMergeTarget({
    lidId: LID,
    messageRows: [
      { resolved_phone: CUSTOMER, hits: 3 },
      { resolved_phone: other, hits: 1 },
    ],
  });
  assert.equal(outcome.target, null);
  assert.equal(outcome.reason, "ambiguous");
  assert.deepEqual(outcome.numbers.sort(), [CUSTOMER, other].sort());
});

test("a dry run reads the database and writes nothing", async () => {
  const original = db.query;
  const originalConnect = db.connect;
  const statements = [];
  db.query = async (sql) => {
    const text = String(sql);
    statements.push(text);
    if (/regexp_replace\(session_id/.test(text)) return { rows: [{ tenant_id: 1, lid_id: LID }] };
    if (/COUNT\(\*\)::int AS messages/.test(text)) return { rows: [{ messages: 1 }] };
    if (/resolved_phone, COUNT/.test(text)) return { rows: [{ resolved_phone: CUSTOMER, hits: 2 }] };
    return { rows: [] };
  };
  db.connect = async () => {
    throw new Error("a dry run must never open a write transaction");
  };
  try {
    const outcome = await main({ apply: false, onlyLid: LID });
    assert.equal(outcome.merged, 0, "a dry run reports what it would do and merges nothing");
    const wrote = statements.some((sql) => /^\s*(UPDATE|DELETE|INSERT)/i.test(sql));
    assert.equal(wrote, false, "no write statement may be issued during a dry run");
  } finally {
    db.query = original;
    db.connect = originalConnect;
  }
});

test("an unidentifiable LID thread is left untouched even with --apply", async () => {
  const original = db.query;
  const originalConnect = db.connect;
  db.query = async (sql) => {
    const text = String(sql);
    if (/regexp_replace\(session_id/.test(text)) return { rows: [{ tenant_id: 1, lid_id: LID }] };
    if (/COUNT\(\*\)::int AS messages/.test(text)) return { rows: [{ messages: 1 }] };
    return { rows: [] }; // no evidence anywhere
  };
  db.connect = async () => {
    throw new Error("a thread with no stored number must not be written to");
  };
  try {
    const outcome = await main({ apply: true, onlyLid: LID });
    assert.equal(outcome.merged, 0);
    assert.equal(outcome.leftAlone, 1);
  } finally {
    db.query = original;
    db.connect = originalConnect;
  }
});

test("the merge repoints every message reference before dropping the old session row", async () => {
  const original = db.query;
  const originalConnect = db.connect;
  const order = [];
  db.query = async (sql) => {
    const text = String(sql);
    if (/regexp_replace\(session_id/.test(text)) return { rows: [{ tenant_id: 1, lid_id: LID }] };
    if (/COUNT\(\*\)::int AS messages/.test(text)) return { rows: [{ messages: 1 }] };
    if (/resolved_phone, COUNT/.test(text)) return { rows: [{ resolved_phone: CUSTOMER, hits: 2 }] };
    return { rows: [] };
  };
  db.connect = async () => ({
    query: async (sql, params = []) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      order.push(text);
      if (/SELECT id, session_id FROM ai_support_sessions/.test(text)) {
        return {
          rows: [
            { id: 11, session_id: `whatsapp:lid:${LID}` },
            { id: 22, session_id: `whatsapp:${CUSTOMER}` },
          ],
        };
      }
      if (/UPDATE ai_support_messages SET session_id/.test(text)) return { rows: [{ id: 1 }], rowCount: 1 };
      // Every reference was repointed, so nothing is left pointing at the old row.
      if (/COUNT\(\*\)::int AS n FROM ai_support_messages WHERE session_ref_id/.test(text)) return { rows: [{ n: 0 }] };
      if (/SELECT LEFT\(/.test(text)) return { rows: [{ last_message: "📞 مكالمة من العميل", created_at: new Date().toISOString() }] };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  });
  try {
    const outcome = await main({ apply: true, onlyLid: LID });
    assert.equal(outcome.merged, 1);
    assert.equal(outcome.movedMessages, 1);

    const repointAt = order.findIndex((sql) => /UPDATE ai_support_messages SET session_ref_id = \$2 WHERE session_ref_id = \$1/.test(sql));
    const verifyAt = order.findIndex((sql) => /COUNT\(\*\)::int AS n FROM ai_support_messages WHERE session_ref_id/.test(sql));
    const dropAt = order.findIndex((sql) => /DELETE FROM ai_support_sessions/.test(sql));
    assert.ok(repointAt >= 0, "references must be repointed");
    assert.ok(verifyAt > repointAt, "the repoint must be verified before anything is dropped");
    assert.ok(dropAt > verifyAt, "session_ref_id is ON DELETE CASCADE — dropping first deletes the messages");
    assert.equal(order[order.length - 1], "COMMIT");
  } finally {
    db.query = original;
    db.connect = originalConnect;
  }
});

test("a reference that survives the repoint aborts the merge instead of deleting messages", async () => {
  const original = db.query;
  const originalConnect = db.connect;
  const issued = [];
  db.query = async (sql) => {
    const text = String(sql);
    if (/regexp_replace\(session_id/.test(text)) return { rows: [{ tenant_id: 1, lid_id: LID }] };
    if (/COUNT\(\*\)::int AS messages/.test(text)) return { rows: [{ messages: 1 }] };
    if (/resolved_phone, COUNT/.test(text)) return { rows: [{ resolved_phone: CUSTOMER, hits: 2 }] };
    return { rows: [] };
  };
  db.connect = async () => ({
    query: async (sql) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      issued.push(text);
      if (/SELECT id, session_id FROM ai_support_sessions/.test(text)) {
        return {
          rows: [
            { id: 11, session_id: `whatsapp:lid:${LID}` },
            { id: 22, session_id: `whatsapp:${CUSTOMER}` },
          ],
        };
      }
      if (/UPDATE ai_support_messages SET session_id/.test(text)) return { rows: [{ id: 1 }], rowCount: 1 };
      if (/COUNT\(\*\)::int AS n FROM ai_support_messages WHERE session_ref_id/.test(text)) return { rows: [{ n: 3 }] };
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  });
  try {
    const outcome = await main({ apply: true, onlyLid: LID });
    assert.equal(outcome.merged, 0, "the merge must fail rather than cascade-delete");
    assert.equal(issued.includes("ROLLBACK"), true);
    assert.equal(issued.some((sql) => /DELETE FROM ai_support_sessions/.test(sql)), false, "nothing may be dropped once a reference survives");
  } finally {
    db.query = original;
    db.connect = originalConnect;
  }
});

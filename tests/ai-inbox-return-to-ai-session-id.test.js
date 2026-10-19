import test from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import { resolveConversationSessionId } from "../server/routes/aiAgentOrders.js";

// LIVE 2026-10-20: "Return to AI" sent "whatsapp:2391" (the row id) instead of the session id. The
// state update upserts by session id, so each click created an empty phantom chat — ten of them,
// chained — and the owner's real chat never left human takeover.

const rows = {
  2391: "whatsapp:201024960585",
  2752417: "whatsapp:2391",
  2752420: "whatsapp:2752417",
};

const withFakeDb = async (fn) => {
  const original = db.query.bind(db);
  const queries = [];
  db.query = async (sql, params) => {
    queries.push(params);
    const sessionId = rows[String(params?.[1])];
    return { rows: sessionId ? [{ session_id: sessionId }] : [] };
  };
  try {
    return { result: await fn(), queries };
  } finally {
    db.query = original;
  }
};

test("a row id is followed to the real session, through a phantom chain", async () => {
  const { result } = await withFakeDb(() => resolveConversationSessionId(1, "whatsapp:2391"));
  assert.equal(result, "whatsapp:201024960585");
  const chained = await withFakeDb(() => resolveConversationSessionId(1, "whatsapp:2752420"));
  assert.equal(chained.result, "whatsapp:201024960585");
});

test("real session ids are left alone and never looked up", async () => {
  for (const id of ["whatsapp:201024960585", "whatsapp:lid:121272830808259", "facebook_messenger:2534037112345678"]) {
    const { result, queries } = await withFakeDb(() => resolveConversationSessionId(1, id));
    assert.equal(result, id);
    assert.equal(queries.length, 0, `${id} is a session id, not a row id`);
  }
});

test("an unknown row id passes through unchanged", async () => {
  const { result } = await withFakeDb(() => resolveConversationSessionId(1, "whatsapp:999"));
  assert.equal(result, "whatsapp:999");
});

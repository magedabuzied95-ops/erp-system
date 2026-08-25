import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Every "delivered" callback from Bosta died on a statement timeout, so the parcel never reached
// delivered, the COD money was never marked collected off the courier, the customer never got the
// arrival message and the tracking bar never completed. Cause: ensureCourierSettlementSchema runs
// ALTER TABLE on `orders` (ACCESS EXCLUSIVE) on the pool, and it was being awaited INSIDE a
// transaction that already held a FOR UPDATE row lock on that same table. Each waited on the other.

const source = fs.readFileSync(
  new URL("../server/modules/shipping/shipping.service.js", import.meta.url), "utf8"
);
const settlements = fs.readFileSync(
  new URL("../server/modules/shipping/shipping.settlements.service.js", import.meta.url), "utf8"
);

const fnStart = source.indexOf("export const processBostaWebhook");
assert.ok(fnStart > -1, "processBostaWebhook exists");
const fnSource = source.slice(fnStart, source.indexOf("\nexport const", fnStart + 10));

test("the settlement schema is ensured before the transaction, never inside it", () => {
  const ensureIndex = fnSource.indexOf("ensureCourierSettlementSchema()");
  const connectIndex = fnSource.indexOf("await db.connect()");
  const beginIndex = fnSource.indexOf('client.query("BEGIN")');
  assert.ok(ensureIndex > -1, "the webhook still ensures the settlement schema");
  assert.ok(connectIndex > -1 && beginIndex > -1, "the webhook still opens a transaction");
  assert.ok(ensureIndex < connectIndex, "ensure must run before the client is checked out");
  assert.ok(ensureIndex < beginIndex, "ensure must run before BEGIN");
});

test("no DDL-bearing ensure is awaited between BEGIN and COMMIT", () => {
  const begin = fnSource.indexOf('client.query("BEGIN")');
  const lastCommit = fnSource.lastIndexOf('client.query("COMMIT")');
  assert.ok(begin > -1 && lastCommit > begin);
  const inTransaction = fnSource.slice(begin, lastCommit);
  for (const ensure of ["ensureCourierSettlementSchema", "ensureShippingSchema", "ensureWhatsappShippingSchema"]) {
    assert.ok(
      !inTransaction.includes(`${ensure}(`),
      `${ensure} runs ALTER TABLE and must not be awaited while the transaction holds a row lock`
    );
  }
});

test("the settlement schema really does take a table-level lock on orders", () => {
  // documents WHY the ordering matters: if this ever stops touching `orders`, the constraint
  // above is no longer load-bearing and can be revisited deliberately rather than by accident.
  assert.match(settlements, /ALTER TABLE IF EXISTS orders ADD COLUMN/);
});

test("the delivered branch still settles the money inside the transaction", () => {
  // the fix must not have moved the settlement itself out of the transaction: a parcel may never
  // read as delivered while the customer still owes for it.
  const delivered = fnSource.slice(fnSource.indexOf('if (parsed.status === "delivered")'));
  assert.match(delivered, /markCourierCollected\(client,/, "settlement uses the transaction client");
  const begin = fnSource.indexOf('client.query("BEGIN")');
  const markIndex = fnSource.indexOf("markCourierCollected(client,");
  const lastCommit = fnSource.lastIndexOf('client.query("COMMIT")');
  assert.ok(markIndex > begin && markIndex < lastCommit, "settlement stays between BEGIN and COMMIT");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_CUSTOMER_CACHE_SCHEMA_VERSION,
  buildPosCustomerSnapshot,
  mergePosCustomerRows,
  searchPosCustomerSnapshot,
} from "../src/modules/pos/lib/posCustomerCache.js";

test("POS customer snapshot is tenant-scoped and stores checkout identity fields", () => {
  const snapshot = buildPosCustomerSnapshot([
    {
      id: 44,
      name: "Ahmed Ali",
      phone: "+20 100 555 1234",
      email: "ahmed@example.com",
      credit_balance: "150",
      private_notes: "must not be cached",
    },
  ], { tenantId: 9 });

  assert.equal(snapshot.schema_version, POS_CUSTOMER_CACHE_SCHEMA_VERSION);
  assert.equal(snapshot.tenant_id, "9");
  assert.equal(snapshot.customers[0].id, 44);
  assert.equal(snapshot.customers[0].credit_balance, 150);
  assert.equal(snapshot.customers[0].private_notes, undefined);
});

test("offline customer search finds Arabic names and normalized phone digits", () => {
  const snapshot = buildPosCustomerSnapshot([
    { id: 1, name: "أحمد محمد", phone: "+20 100 555 1234" },
    { id: 2, name: "Maged Ali", phone: "0111222333" },
  ], { tenantId: 9 });

  assert.deepEqual(searchPosCustomerSnapshot(snapshot, "أحمد").map((item) => item.id), [1]);
  assert.deepEqual(searchPosCustomerSnapshot(snapshot, "1005551234").map((item) => item.id), [1]);
  assert.deepEqual(searchPosCustomerSnapshot(snapshot, "maged").map((item) => item.id), [2]);
});

test("online search results merge into the existing offline customer snapshot", () => {
  const merged = mergePosCustomerRows(
    [{ id: 1, name: "Old Name", phone: "0100" }],
    [{ id: 1, name: "Updated Name", phone: "0100" }, { id: 2, name: "New Customer" }]
  );

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === 1).name, "Updated Name");
});

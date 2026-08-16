import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const sliceExport = (source, name, nextName) => {
  const start = source.indexOf(`export const ${name}`);
  const end = source.indexOf(`export const ${nextName}`, start);
  return source.slice(start, end);
};

test("customer creation checks and inserts under one advisory lock", async () => {
  const source = await readSource("server/controllers/customersController.js");
  const createSource = sliceExport(source, "createCustomer", "updateCustomer");

  assert.match(createSource, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.match(createSource, /customers:create:\$\{tenantId \?\? "global"\}:\$\{normalizedPhoneDigits\}/);

  const lockIndex = createSource.indexOf("pg_advisory_xact_lock");
  const existingIndex = createSource.indexOf("client.query(existingSql, existingParams)");
  const insertIndex = createSource.indexOf("client.query(insertSql, insertValues)");

  assert.ok(lockIndex > -1 && existingIndex > lockIndex, "existence check must run after the lock");
  assert.ok(insertIndex > existingIndex, "insert must run after the existence check");
  assert.match(createSource, /await client\.query\("COMMIT"\)/);
  assert.match(createSource, /await client\.query\("ROLLBACK"\)/);
  assert.match(createSource, /client\.release\(\)/);
});

test("updating a customer refuses a phone another customer already owns", async () => {
  const source = await readSource("server/controllers/customersController.js");
  const updateSource = sliceExport(source, "updateCustomer", "getCustomerOrders");

  assert.match(updateSource, /id <> \$1::bigint/);
  assert.match(updateSource, /res\.status\(409\)/);
});

test("the customers form cannot submit twice while a save is in flight", async () => {
  const source = await readSource("src/modules/sales/pages/Customers.jsx");

  assert.match(source, /if \(submitInFlightRef\.current\) return;/);
  assert.match(source, /submitInFlightRef\.current = true;/);
  assert.match(source, /disabled=\{customerSaving\}/);

  const guardIndex = source.indexOf("submitInFlightRef.current = true;");
  const postIndex = source.indexOf('api.post("/customers", customerData)');
  assert.ok(guardIndex > -1 && postIndex > guardIndex, "the guard must be set before the request");
});

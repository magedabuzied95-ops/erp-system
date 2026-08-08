import assert from "node:assert/strict";
import test from "node:test";

// GET /api/storefront/brands previously executed CREATE TABLE + ALTER TABLE + a
// full-table UPDATE on every public request. These tests pin the process-idempotent
// guard so that regression cannot return.

const freshBrandsModule = (tag) =>
  import(`../server/controllers/brandsController.js?brands-schema-init=${tag}`);

const querySpy = () => {
  const calls = [];
  return {
    calls,
    query: async (sql) => {
      calls.push(String(sql).trim().replace(/\s+/g, " "));
      return { rows: [], rowCount: 0 };
    },
  };
};

const DDL = /^(ALTER TABLE|CREATE TABLE|CREATE INDEX|DROP TABLE|DROP INDEX)/i;

test("20 concurrent ensureBrandsTable() calls execute the migration body exactly once", async () => {
  const { ensureBrandsTable } = await freshBrandsModule("concurrent");
  const db = querySpy();

  await Promise.all(Array.from({ length: 20 }, () => ensureBrandsTable(db)));

  assert.equal(db.calls.filter((sql) => /^CREATE TABLE IF NOT EXISTS brands/i.test(sql)).length, 1);
  assert.equal(db.calls.filter((sql) => /^ALTER TABLE IF EXISTS brands/i.test(sql)).length, 1);
  assert.equal(db.calls.filter((sql) => /^UPDATE brands/i.test(sql)).length, 1);
  assert.equal(db.calls.length, 3, "concurrent callers must share one in-flight migration");
});

test("after successful initialization, 100 further calls execute zero database queries", async () => {
  const { ensureBrandsTable } = await freshBrandsModule("noop");
  const db = querySpy();

  await ensureBrandsTable(db);
  const afterInitialization = db.calls.length;
  assert.ok(afterInitialization > 0, "initialization must actually run once");

  await Promise.all(Array.from({ length: 100 }, () => ensureBrandsTable(db)));

  assert.equal(db.calls.length, afterInitialization, "steady state must be a pure in-memory no-op");
});

test("steady-state brands initialization issues no DDL at all", async () => {
  const { ensureBrandsTable } = await freshBrandsModule("steady");
  const db = querySpy();

  await ensureBrandsTable(db);
  const beforeSteadyState = db.calls.length;
  await ensureBrandsTable(db);

  const steadyStateStatements = db.calls.slice(beforeSteadyState);
  assert.deepEqual(steadyStateStatements, [], "no SQL may be issued once initialized");
  assert.equal(steadyStateStatements.some((sql) => DDL.test(sql)), false);
});

test("initialization failure stays explicit and never marks the schema ready", async () => {
  const { ensureBrandsTable } = await freshBrandsModule("failure");
  const failing = { query: async () => { throw new Error("brands migration boom"); } };

  await assert.rejects(() => ensureBrandsTable(failing), /brands migration boom/);

  // A failed migration must not silently flip the ready flag: the next call has to
  // attempt the work again rather than pretend the schema exists.
  const recovering = querySpy();
  await ensureBrandsTable(recovering);
  assert.ok(recovering.calls.length > 0, "failed initialization must not mark schema ready");
});

test("migration statements are unchanged, so the brands schema contract is preserved", async () => {
  const { ensureBrandsTable } = await freshBrandsModule("contract");
  const db = querySpy();

  await ensureBrandsTable(db);

  assert.match(db.calls[0], /CREATE TABLE IF NOT EXISTS brands/i);
  assert.match(db.calls[1], /ADD COLUMN IF NOT EXISTS tenant_id BIGINT/i);
  assert.match(db.calls[1], /ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0/i);
  assert.match(db.calls[1], /ADD COLUMN IF NOT EXISTS status VARCHAR\(50\) NOT NULL DEFAULT 'active'/i);
  assert.match(db.calls[2], /UPDATE brands/i);
});

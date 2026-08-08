import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Steady-state contract for the PUBLIC storefront request path:
// after startup initialization, serving a storefront request must never issue
// schema DDL. Confirmed production defect: GET /api/storefront/brands was running
// CREATE TABLE + ALTER TABLE (+ a full-table UPDATE) on every live public request.

const DDL_PREFIX = /^\s*(ALTER TABLE|CREATE TABLE|CREATE INDEX|DROP TABLE|DROP INDEX)/i;

const readSource = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const querySpy = () => {
  const calls = [];
  return {
    calls,
    ddl: () => calls.filter((sql) => DDL_PREFIX.test(sql)),
    query: async (sql) => {
      calls.push(String(sql).trim().replace(/\s+/g, " "));
      return { rows: [], rowCount: 0 };
    },
  };
};

test("brands: post-initialization requests issue zero DDL (runtime spy)", async () => {
  const { ensureBrandsTable } = await import(
    "../server/controllers/brandsController.js?storefront-ddl=brands"
  );
  const db = querySpy();

  // Startup initialization.
  await ensureBrandsTable(db);
  const initialized = db.calls.length;

  // Simulate concurrent public traffic hitting the same guarded entry point.
  await Promise.all(Array.from({ length: 25 }, () => ensureBrandsTable(db)));

  assert.equal(db.calls.length, initialized, "no SQL may run per request after startup");
  assert.deepEqual(db.calls.slice(initialized).filter((sql) => DDL_PREFIX.test(sql)), []);
});

test("brands schema initialization is registered in the startup sequence before listen", () => {
  const server = readSource("../server/server.js");

  assert.match(server, /import \{ ensureBrandsTable \} from "\.\/controllers\/brandsController\.js";/);
  assert.match(server, /await ensureBrandsTable\(\);/);

  // The boot call must precede server.listen(), which lives inside bootstrapServer().
  const bootCall = server.indexOf("await ensureBrandsTable();");
  const listenCall = server.indexOf("await bootstrapServer(");
  assert.ok(bootCall > -1 && listenCall > -1);
  assert.ok(bootCall < listenCall, "schema init must complete before HTTP traffic is accepted");
});

test("public storefront handlers contain no inline schema DDL", () => {
  // Secondary guard only - the runtime spy above is the primary protection.
  const routes = readSource("../server/routes/storefront.js");
  const publicHandlers = routes.slice(
    routes.indexOf("const getPublicStorefrontHome"),
    routes.indexOf("export default router")
  );

  for (const statement of ["CREATE TABLE", "ALTER TABLE", "CREATE INDEX", "DROP TABLE", "DROP INDEX"]) {
    assert.equal(
      publicHandlers.includes(statement),
      false,
      `public storefront handlers must not contain inline ${statement}`
    );
  }
});

test("guarded storefront ensures keep their ready flag and shared in-flight promise", () => {
  const controller = readSource("../server/controllers/storefrontController.js");

  // These already no-op after startup; this pins that property rather than removing them.
  assert.match(controller, /let storefrontSchemaReady = false;/);
  assert.match(controller, /if \(storefrontSchemaReady\) return;/);
  assert.match(controller, /if \(!storefrontSchemaReadyPromise\)/);
});

test("brands guard follows the same established pattern", () => {
  const brands = readSource("../server/controllers/brandsController.js");

  assert.match(brands, /let brandsTableReady = false;/);
  assert.match(brands, /let brandsTableReadyPromise = null;/);
  assert.match(brands, /if \(brandsTableReady\) return;/);
  // Failure must never mark the schema ready.
  assert.doesNotMatch(brands, /catch[\s\S]{0,120}brandsTableReady = true/);
});

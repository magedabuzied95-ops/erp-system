/**
 * ALTER TABLE on the request path (growth audit, 2026-09-14).
 *
 * ALTER TABLE ... ADD COLUMN IF NOT EXISTS takes ACCESS EXCLUSIVE on the table even when every
 * column already exists. Inside a transaction the lock is held until COMMIT, so every reader of
 * that table waits: the 2026-08-26 pool-starvation outage was this shape.
 *
 *   purchases receive/reverse/delete  ~12 ALTERs on products/product_variants inside the txn
 *   login                             two ALTER TABLE users on every sign-in
 *   permit(loyalty|attendance|...)    ALTER TABLE permissions on every request (POS checkout)
 *
 * Each now runs once per process. These are source checks because the three modules import the
 * database at load time.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Line endings normalised: a Windows checkout has CRLF and the multi-line patterns below use \n.
const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the purchase schema ensure returns at once after the pool run verified it", () => {
  const source = read("../server/routes/purchases.js");
  const start = source.indexOf("const ensurePurchaseCreateSchema = async (client) => {");
  assert.ok(start > -1);
  const firstStatement = source.slice(start, start + 200);
  assert.match(firstStatement, /^const ensurePurchaseCreateSchema = async \(client\) => \{\s*if \(purchaseCreateSchemaVerified\) return;/);

  const ready = source.slice(source.indexOf("const ensurePurchaseSchemaReady = () => {"));
  const body = ready.slice(0, ready.indexOf("\n};\n"));
  assert.match(body, /await ensurePurchaseCreateSchema\(pool\);/, "verified on the pool, which auto-commits");
  assert.match(body, /await ensurePurchaseCreateIndexes\(pool\);\s*purchaseCreateSchemaVerified = true;/, "flag set only after the pool run succeeds");

  // Nothing else may set the flag: a run inside a request transaction can roll back.
  assert.equal((source.match(/purchaseCreateSchemaVerified = true/g) || []).length, 1);
});

test("the server warms the purchase schema right after listen", () => {
  const server = read("../server/server.js");
  const listen = server.indexOf("server.listen(PORT, HOST, () => {");
  const warm = server.indexOf('import("./routes/purchases.js")\n        .then((module) => module.warmPurchaseSchema())');
  assert.ok(listen > -1 && warm > listen, "warm-up runs inside the listen callback");
  assert.match(read("../server/routes/purchases.js"), /export const warmPurchaseSchema = \(\) => ensurePurchaseSchemaReady\(\);/);
});

test("login no longer re-runs the users ALTERs once boot verified them", () => {
  const source = read("../server/controllers/authController.js");
  const start = source.indexOf("export const ensureUsersLoginSchema = async () => {");
  assert.match(source.slice(start, start + 120), /\{\s*if \(usersLoginSchemaVerified\) return;/);
  const body = source.slice(start, source.indexOf("\n};\n", start));
  assert.match(body, /usersLoginSchemaVerified = true;\s*$/);
});

test("permit() runs each module's permission seed once per process", () => {
  const source = read("../server/middleware/permissionMiddleware.js");
  for (const name of ["Branches", "Attendance", "Loyalty", "Marketing"]) {
    assert.match(source, new RegExp(`const ensure${name}PermissionsOnce = oncePerProcess\\(ensure${name}Permissions\\);`));
    assert.match(source, new RegExp(`await ensure${name}PermissionsOnce\\(\\);`));
    assert.doesNotMatch(source, new RegExp(`await ensure${name}Permissions\\(\\);`), `${name} must not be called unwrapped`);
  }
  // A failed seed must be retried, not cached as a rejection forever.
  assert.match(source, /ready = ensure\(\)\.catch\(\(error\) => \{\s*ready = null;\s*throw error;/);
});

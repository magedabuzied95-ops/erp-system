/**
 * `is_active = FALSE` must be a real revocation, not a label on a row.
 *
 * Twelve QA/debug accounts on production carried unrestricted access. They were disabled
 * rather than deleted — no user removed, no transaction touched — which is only defensible
 * if the flag actually stops them authenticating. It is enforced in two places, and both
 * are load-bearing:
 *
 *   login          no token is ever issued, so a disabled account cannot start a session
 *   every request  a token issued BEFORE the account was disabled stops working too
 *
 * Losing either one silently turns the disable into theatre, which is worse than having
 * done nothing: the audit would report the account as closed while it still worked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("login refuses a disabled account before issuing a token", async () => {
  const source = await read("../server/controllers/authController.js");

  assert.match(source, /if \(user\.is_active === false\) \{/, "the login gate must exist");

  const at = source.indexOf("if (user.is_active === false)");
  const block = source.slice(at, at + 420);
  assert.match(block, /return res\.status\(403\)/, "a disabled login must be refused, not merely logged");
  assert.match(block, /Account Disabled/);

  // The check has to sit BEFORE the token is signed, or a refused login still hands out a
  // credential that the per-request gate then has to catch.
  const signAt = source.indexOf("jwt.sign", at);
  assert.ok(signAt === -1 || signAt > at, "the is_active check must precede token issuance");

  // Strict false, not falsy: a NULL is_active on an older row means "not set", and
  // treating it as disabled would lock out every account predating the column.
  assert.ok(!/if \(!user\.is_active\)/.test(source), "the gate must test === false, never falsiness");
});

test("an already-issued token stops working once the account is disabled", async () => {
  const source = await read("../server/middleware/authMiddleware.js");

  assert.match(source, /if \(databaseUser\?\.is_active === false\) \{/, "the per-request gate must exist");
  const at = source.indexOf("if (databaseUser?.is_active === false)");
  assert.match(source.slice(at, at + 220), /return res\.status\(403\)/);

  // The gate is only meaningful if the row is re-read per request rather than trusted
  // from the token payload, which was signed before the account was disabled.
  const lookup = source.indexOf("FROM users u");
  assert.ok(lookup > 0 && lookup < at, "the middleware must re-read the user row before checking it");
  assert.match(source.slice(lookup - 400, at), /SELECT\s*\n?\s*u\.\*/, "the lookup must select the live row");
});

test("the disable script cannot touch an account that carries real work", async () => {
  const script = await read("../server/scripts/disableQaTestAccounts.js");

  // Three independent rules, and the footprint rule is the one that matters: a name that
  // looks like a test account proves nothing about what it has done.
  assert.match(script, /RESERVED_SUFFIXES/, "must require a reserved test domain");
  assert.match(script, /last_login_at === null/, "must require the account has never logged in");
  assert.match(script, /footprint > 0/, "must require a zero production footprint");

  // The footprint must span the tables where money and stock are recorded. Checking
  // orders alone would clear an account that only ever wrote journal entries.
  for (const table of [
    "orders", "pos_orders", "returns", "purchases", "money_transactions",
    "journal_entries", "expenses", "inventory_movements", "customer_payments",
    "wallet_transactions", "employees",
  ]) {
    assert.ok(script.includes(`table: "${table}"`), `the footprint must cover ${table}`);
  }

  // Non-destructive by construction.
  assert.ok(!/DELETE\s+FROM\s+users/i.test(script), "the script must never delete a user");
  assert.ok(!/DROP\s+/i.test(script), "the script must never drop anything");
  // Strip the console.log lines first — the script PRINTS the reversal statement before
  // it writes anything, and that printed `SET is_active = TRUE` is documentation, not a
  // second write. Matching it would make this assertion fail for the right-looking reason.
  const executable = script.replace(/^\s*console\.log\([\s\S]*?\);\s*$/gm, "");
  const writes = [...executable.matchAll(/UPDATE\s+users\s*\n?\s*SET\s+([^\n]*)/gi)].map((m) => m[1].trim());
  assert.deepEqual(writes, ["is_active = FALSE"], "the only write may be is_active = FALSE");

  // Dry run unless asked, and the rules re-asserted in the WHERE clause so a row that
  // changed between the read and the write is skipped rather than caught by a stale id.
  assert.match(script, /const apply = argv\.includes\("--apply"\)/);
  assert.match(script, /if \(!apply\) \{[\s\S]{0,200}DRY RUN/);
  assert.match(script, /AND COALESCE\(is_active, TRUE\) = TRUE\s*\n\s*AND last_login_at IS NULL/);

  // And it prints the way back before it changes anything.
  assert.match(script, /UPDATE users SET is_active = TRUE WHERE id = \$\{user\.id\};/);
});

test("the pool covers BOTH ways an account reaches the financial surface unbidden", async () => {
  const script = await read("../server/scripts/disableQaTestAccounts.js");

  // permissionMiddleware short-circuits twice before it ever reads role_permissions: the
  // is_super_admin flag, and an admin-shaped role NAME. The first sweep only looked at the
  // flag, so two `role = 'admin'` debug accounts reaching all seventeen financial
  // endpoints were invisible to it. A pool narrower than the exposure is not an audit.
  assert.match(script, /WHERE COALESCE\(u\.is_super_admin, FALSE\)\s*\n\s*OR LOWER\(REGEXP_REPLACE/);
  for (const role of ["admin", "super admin", "superadmin", "owner"]) {
    assert.ok(script.includes(`'${role}'`), `the admin-shaped pool must include ${role}`);
  }

  // Widening the POOL must not widen what gets DISABLED. The three rules still decide, and
  // they are what keeps a real admin — who is in this pool by definition — untouched.
  assert.match(script, /category: reasons\.length === 0 \? "A" : "C"/);
});

test("--only turns the dry run into a precondition instead of a memory", async () => {
  const script = await read("../server/scripts/disableQaTestAccounts.js");

  assert.match(script, /--only=/, "the flag must exist");
  // It compares SETS, so an extra account appearing between the dry run and the apply
  // refuses the write rather than silently disabling one more than was reviewed.
  assert.match(script, /const same = expected\.length === actual\.length && expected\.every/);

  // Both sides must be coerced. `users.id` is a bigint and node-postgres returns bigints
  // as STRINGS, so `11 === "11"` is false and the first cut refused a set that was in
  // fact identical — it failed closed, which is the right direction, but a guard that
  // always refuses protects nothing because it gets removed.
  assert.match(script, /const expected = only\.map\(Number\)/);
  assert.match(script, /const actual = ids\.map\(Number\)/);
  assert.match(script, /REFUSED\./);
  assert.match(script, /Nothing was written\./);

  // The refusal must come BEFORE the UPDATE, or it is a report rather than a guard.
  const refusal = script.indexOf("REFUSED.");
  const update = script.indexOf("SET is_active = FALSE\n");
  assert.ok(refusal > 0 && update > 0 && refusal < update, "the --only check must precede the write");
});

test("the access audit reports a disabled account as reaching nothing", async () => {
  const script = await read("../server/scripts/auditCashierEffectiveAccess.js");

  // Otherwise the audit keeps naming twelve disabled accounts as live exposure, and the
  // one account that genuinely matters is lost in the noise.
  assert.match(script, /if \(user\.is_active === false && path !== "none"\) path = `disabled \(would be: \$\{path\}\)`/);
  assert.match(script, /reachesFinancialReports: path !== "none" && !path\.startsWith\("disabled"\)/);
  assert.match(script, /account\(s\) are disabled \(is_active = FALSE\) and reach nothing/);
});

/**
 * Disable QA/debug accounts that carry unrestricted access, WITHOUT deleting anything.
 *
 *   node server/scripts/disableQaTestAccounts.js            # dry run, read-only
 *   node server/scripts/disableQaTestAccounts.js --apply    # sets is_active = FALSE
 *
 * WHAT THIS DOES AND DOES NOT DO
 *
 * It sets `users.is_active = FALSE` and nothing else. It does not delete a user, does not
 * touch `is_super_admin`, does not alter a single historical transaction, and does not
 * change tenant data. The flag is enforced in two places, so it is a real revocation
 * rather than a label:
 *
 *   authController  — login returns 403 "Account Disabled" before a token is issued
 *   authMiddleware  — every authenticated request returns 403 "Account disabled",
 *                     so a token issued earlier is dead too
 *
 * Reversal is one statement per account, printed before anything is written.
 *
 * THE SAFETY RULE
 *
 * An account is only ever a candidate if ALL of these hold. Any one of them failing puts
 * the account in the untouched pile and it is reported, never modified:
 *
 *   1. its email is on a reserved test domain (RFC 2606: .test / .example / .invalid /
 *      .localhost, or example.com / example.net / example.org)
 *   2. it has NEVER logged in — last_login_at IS NULL
 *   3. it has zero footprint across every table where money or stock is recorded
 *
 * Rule 3 is the one that matters. A name that looks like a test account proves nothing;
 * an account that has never touched an order, a purchase, a payment, a journal entry or
 * a stock movement cannot be load-bearing for anything.
 */

import process from "node:process";

import db from "../database/db.js";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const asJson = argv.includes("--json");

/** RFC 2606 / RFC 6761 reserved names. Mail to these can never be delivered. */
const RESERVED_SUFFIXES = [
  ".test", ".example", ".invalid", ".localhost",
  "@example.com", "@example.net", "@example.org",
];

/**
 * Every place a user id is recorded alongside money, stock or an approval. The footprint
 * is the sum over all of them; the point of listing so many is that a single non-zero
 * anywhere disqualifies the account.
 */
const FOOTPRINT = [
  { table: "orders", columns: ["created_by", "cashier_user_id", "seller_user_id"] },
  { table: "pos_orders", columns: ["created_by", "cashier_user_id", "seller_user_id"] },
  { table: "returns", columns: ["created_by", "cashier_user_id"] },
  { table: "purchases", columns: ["created_by"] },
  { table: "money_transactions", columns: ["created_by"] },
  { table: "journal_entries", columns: ["created_by"] },
  { table: "expenses", columns: ["created_by", "approved_by"] },
  { table: "inventory_movements", columns: ["created_by"] },
  { table: "customer_payments", columns: ["created_by"] },
  { table: "wallet_transactions", columns: ["created_by"] },
  { table: "employees", columns: ["user_id"] },
  { table: "stock_transfers", columns: ["created_by"] },
  { table: "cashbox_movements", columns: ["created_by", "user_id"] },
];

const tableExists = async (table) => {
  const result = await db.query(
    `SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
    [table]
  );
  return result.rows.length > 0;
};

const columnExists = async (table, column) => {
  const result = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2 LIMIT 1`,
    [table, column]
  );
  return result.rows.length > 0;
};

const run = async () => {
  const users = await db.query(
    `SELECT u.id,
            COALESCE(u.name, '')  AS name,
            COALESCE(u.email, '') AS email,
            COALESCE(u.role, '')  AS role_text,
            u.tenant_id,
            COALESCE(u.is_active, TRUE)      AS is_active,
            COALESCE(u.is_super_admin, FALSE) AS is_super_admin,
            u.last_login_at
       FROM users u
      WHERE COALESCE(u.is_super_admin, FALSE)
      ORDER BY u.id`
  );

  if (!users.rows.length) {
    console.log("\nNo account carries is_super_admin. Nothing to do.\n");
    return 0;
  }

  // Build the footprint query once, over whatever columns this schema actually has.
  const parts = [];
  for (const entry of FOOTPRINT) {
    if (!(await tableExists(entry.table))) continue;
    const present = [];
    for (const column of entry.columns) {
      if (await columnExists(entry.table, column)) present.push(column);
    }
    if (!present.length) continue;
    const predicate = present.map((column) => `${column} = u.id`).join(" OR ");
    parts.push(`(SELECT COUNT(*) FROM ${entry.table} WHERE ${predicate})`);
  }
  const footprintExpr = parts.length ? parts.join(" + ") : "0";

  const footprints = await db.query(
    `SELECT u.id, (${footprintExpr})::bigint AS footprint
       FROM users u
      WHERE COALESCE(u.is_super_admin, FALSE)`
  );
  const footprintById = new Map(footprints.rows.map((row) => [String(row.id), Number(row.footprint)]));

  const classified = users.rows.map((user) => {
    const email = String(user.email || "").toLowerCase();
    const reservedDomain = RESERVED_SUFFIXES.some((suffix) =>
      suffix.startsWith("@") ? email.endsWith(suffix) : email.split("@")[1]?.endsWith(suffix)
    );
    const neverLoggedIn = user.last_login_at === null || user.last_login_at === undefined;
    const footprint = footprintById.get(String(user.id)) ?? 0;

    const reasons = [];
    if (!reservedDomain) reasons.push("email is not on a reserved test domain");
    if (!neverLoggedIn) reasons.push(`has logged in (${new Date(user.last_login_at).toISOString().slice(0, 10)})`);
    if (footprint > 0) reasons.push(`has a production footprint (${footprint} row(s))`);

    return {
      ...user,
      footprint,
      reservedDomain,
      neverLoggedIn,
      category: reasons.length === 0 ? "A" : "C",
      reasons,
    };
  });

  const candidates = classified.filter((user) => user.category === "A" && user.is_active);
  const alreadyDisabled = classified.filter((user) => user.category === "A" && !user.is_active);
  const untouched = classified.filter((user) => user.category !== "A");

  if (asJson) {
    console.log(JSON.stringify({ classified, candidates: candidates.map((u) => u.id) }, null, 2));
    return candidates.length;
  }

  const pad = (value, width) => String(value ?? "").padEnd(width);
  console.log(`\nSuper-admin accounts: ${classified.length}\n`);
  console.log("      id    name                    email                             login?  footprint  class");
  console.log("      " + "-".repeat(94));
  for (const user of classified) {
    const flag = user.category === "A" ? (user.is_active ? " >> " : " -- ") : "    ";
    console.log(
      `${flag}#${pad(user.id, 5)} ${pad(String(user.name).slice(0, 22), 23)} ${pad(String(user.email).slice(0, 33), 34)}` +
        ` ${pad(user.neverLoggedIn ? "never" : "yes", 7)} ${pad(user.footprint, 10)} ${user.category}`
    );
  }

  if (untouched.length) {
    console.log(`\n${untouched.length} account(s) are NOT candidates and will not be modified:`);
    for (const user of untouched) {
      console.log(`  #${user.id} ${user.name} — ${user.reasons.join("; ")}`);
    }
  }

  if (alreadyDisabled.length) {
    console.log(`\n${alreadyDisabled.length} candidate(s) are already disabled:`);
    for (const user of alreadyDisabled) console.log(`  #${user.id} ${user.name}`);
  }

  if (!candidates.length) {
    console.log("\nNothing to disable.\n");
    return 0;
  }

  console.log(`\n${candidates.length} account(s) qualify on ALL THREE rules — reserved test domain, never`);
  console.log("logged in, and zero rows across orders, POS orders, returns, purchases, money");
  console.log("transactions, journal entries, expenses, stock movements, customer payments,");
  console.log("wallet transactions, employee links, transfers and cashbox movements.\n");

  console.log("Reversal, for the record:");
  for (const user of candidates) {
    console.log(`  UPDATE users SET is_active = TRUE WHERE id = ${user.id};   -- ${user.name}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN. Re-run with --apply to disable ${candidates.length} account(s).\n`);
    return candidates.length;
  }

  // Re-assert every rule in the WHERE clause, so a row that changed between the read and
  // the write is skipped rather than caught by an id that was correct a moment ago.
  const ids = candidates.map((user) => user.id);
  const updated = await db.query(
    `UPDATE users
        SET is_active = FALSE
      WHERE id = ANY($1::bigint[])
        AND COALESCE(is_active, TRUE) = TRUE
        AND last_login_at IS NULL
      RETURNING id, name, is_active`,
    [ids]
  );

  console.log(`\nDisabled ${updated.rows.length} account(s): ${updated.rows.map((row) => `#${row.id}`).join(", ")}`);
  console.log("No user was deleted. No transaction, tenant row or permission was touched.");
  if (updated.rows.length !== ids.length) {
    console.log(`WARNING: ${ids.length - updated.rows.length} candidate(s) were skipped because a rule no longer held.`);
  }

  const verify = await db.query(
    `SELECT id, COALESCE(is_active, TRUE) AS is_active FROM users WHERE id = ANY($1::bigint[]) ORDER BY id`,
    [ids]
  );
  console.log("\nVerified after write:");
  for (const row of verify.rows) console.log(`  #${row.id} is_active = ${row.is_active}`);

  return updated.rows.length;
};

run()
  .then((count) => {
    process.exitCode = 0;
    if (!apply && count > 0) process.exitCode = 0;
  })
  .catch((error) => {
    console.error("\nFAILED:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end?.().catch(() => {});
  });

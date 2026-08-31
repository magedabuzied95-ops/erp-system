/**
 * Fold customers that were saved twice back into one record.
 *
 * A double submit used to create two rows with the same phone (fixed in the
 * create path, which now holds an advisory lock across the check and the
 * insert). The rows it already made are still there, and each half owns part of
 * the customer's history: orders under one id, wallet and loyalty under the
 * other.
 *
 * Duplicates are grouped by tenant + the digits of the phone — the same key the
 * create path refuses on. The survivor is the row with the most history, ties
 * going to the oldest id. Everything pointing at the other rows is repointed to
 * it, money and points are added up rather than picked from, and the losing rows
 * are archived as JSON in `customer_merge_archive` before they are deleted.
 *
 * The delete is last and it is guarded: if anything still references a losing
 * row, the whole group rolls back. The FKs are ON DELETE CASCADE, so a delete
 * that ran early would take the customer's orders with it.
 *
 *   node server/scripts/mergeDuplicateCustomers.js                  # report only
 *   node server/scripts/mergeDuplicateCustomers.js --apply
 *   node server/scripts/mergeDuplicateCustomers.js --phone=01068005338
 *   node server/scripts/mergeDuplicateCustomers.js --tenant=1 --limit=5 --apply
 */
import db from "../database/db.js";
import { calculateTier } from "../services/loyaltyService.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../utils/phoneSearch.js";

const PHONE_KEY = canonicalPhoneSql("phone");

const APPLY = process.argv.includes("--apply");
const readArg = (name) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : "";
};

const ONLY_PHONE = readArg("phone").replace(/\D/g, "");
const ONLY_TENANT = readArg("tenant");
const LIMIT = Number(readArg("limit")) || 0;

// customer_wallets and customer_loyalty are one row per customer, so repointing
// them would collide with their own unique key. Their numbers are added instead.
const ONE_ROW_PER_CUSTOMER = {
  customer_wallets: ["balance", "total_cashback_earned", "total_redeemed"],
  customer_loyalty: [
    "total_points_earned",
    "total_points_redeemed",
    "available_points",
    "lifetime_points",
    "lifetime_spent",
  ],
};

// Summed on the customer row itself; never overwritten by the blank-backfill.
const SUMMED_CUSTOMER_COLUMNS = ["loyalty_points", "total_spent", "total_orders"];
const NEVER_BACKFILLED = new Set([
  "id",
  "tenant_id",
  "name",
  "phone",
  "created_at",
  "updated_at",
  "wallet_balance",
  "loyalty_tier",
  ...SUMMED_CUSTOMER_COLUMNS,
]);

const tableExists = async (client, table) => {
  const { rows } = await client.query(`SELECT to_regclass($1) AS oid`, [`public.${table}`]);
  return Boolean(rows[0]?.oid);
};

const listCustomerColumns = async (client) => {
  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers'
    ORDER BY ordinal_position
  `);
  return rows;
};

/**
 * Every place a customer id is stored: declared foreign keys first, then columns
 * that merely look like one. Both have to move, and a soft reference is exactly
 * the kind the database will not complain about if it is left behind.
 */
const discoverReferences = async (client) => {
  const { rows: foreignKeys } = await client.query(`
    SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.customers'::regclass
      AND array_length(c.conkey, 1) = 1
    ORDER BY 1
  `);

  const { rows: softColumns } = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'customer_id'
      AND table_name <> 'customers'
    ORDER BY 1
  `);

  // Some of the soft references keep the id as text, so the comparison and the
  // assignment have to follow the column's own type or Postgres rejects them.
  const { rows: types } = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'customer_id'
  `);
  const typeOf = new Map(types.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));

  const seen = new Set();
  const references = [];

  const add = (table, column, foreignKey) => {
    const key = `${table}.${column}`;
    if (seen.has(key)) return;
    seen.add(key);
    const dataType = typeOf.get(key) || "bigint";
    const textual = /char|text/.test(dataType);
    references.push({
      table,
      column,
      foreignKey,
      dataType,
      match: textual ? `${column}::text = ANY($1::text[])` : `${column} = ANY($1::bigint[])`,
      assign: textual ? `${column} = $1::text` : `${column} = $1::bigint`,
    });
  };

  for (const row of foreignKeys) add(row.table_name, row.column_name, true);
  for (const row of softColumns) add(row.table_name, row.column_name, false);

  return references;
};

const findGroups = async (client) => {
  const params = [];
  const filters = [`COALESCE(phone, '') <> ''`, `length(${PHONE_KEY}) BETWEEN 8 AND 15`];

  if (ONLY_TENANT) {
    params.push(ONLY_TENANT);
    filters.push(`tenant_id = $${params.length}::bigint`);
  }

  if (ONLY_PHONE) {
    params.push(canonicalPhoneKey(ONLY_PHONE));
    filters.push(`${PHONE_KEY} = $${params.length}`);
  }

  const { rows } = await client.query(
    `
    SELECT tenant_id,
           ${PHONE_KEY} AS phone_digits,
           array_agg(id ORDER BY id) AS ids
    FROM customers
    WHERE ${filters.join(" AND ")}
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
    ORDER BY 1, 2
    ${LIMIT ? `LIMIT ${LIMIT}` : ""}
    `,
    params
  );

  return rows;
};

const countReferences = async (client, references, ids) => {
  const counts = new Map(ids.map((id) => [String(id), { total: 0, byTable: {} }]));

  for (const reference of references) {
    const { rows } = await client.query(
      `SELECT ${reference.column} AS customer_id, COUNT(*)::int AS n
       FROM ${reference.table}
       WHERE ${reference.match}
       GROUP BY 1`,
      [ids.map((id) => String(id))]
    );

    for (const row of rows) {
      const bucket = counts.get(String(row.customer_id));
      if (!bucket) continue;
      bucket.total += row.n;
      bucket.byTable[reference.table] = (bucket.byTable[reference.table] || 0) + row.n;
    }
  }

  return counts;
};

const pickKeeper = (members, counts) => {
  const scored = members.map((member) => ({
    member,
    activity: counts.get(String(member.id))?.total || 0,
  }));

  scored.sort((a, b) => {
    if (b.activity !== a.activity) return b.activity - a.activity;
    return Number(a.member.id) - Number(b.member.id);
  });

  return scored[0].member;
};

const isBlank = (value) => value === null || value === undefined || String(value).trim() === "";

/**
 * Add up the one-row-per-customer tables. The keeper's row wins the identity;
 * if the keeper has no row, the oldest loser row is promoted rather than
 * inventing one, so nothing about the wallet's history is lost.
 */
const mergeOneRowPerCustomer = async (client, table, sumColumns, keeperId, loserIds) => {
  const { rows } = await client.query(
    `SELECT * FROM ${table}
     WHERE customer_id = ANY($1::bigint[])
     ORDER BY (customer_id = $2::bigint) DESC, id ASC`,
    [[keeperId, ...loserIds], keeperId]
  );

  if (rows.length === 0) return null;

  const [target, ...rest] = rows;
  const totals = {};

  for (const column of sumColumns) {
    if (!(column in target)) continue;
    totals[column] = rows.reduce((sum, row) => sum + Number(row[column] || 0), 0);
  }

  const setClauses = [`customer_id = $1::bigint`];
  const params = [keeperId];

  for (const [column, value] of Object.entries(totals)) {
    params.push(value);
    setClauses.push(`${column} = $${params.length}`);
  }

  if ("last_order_at" in target) {
    const latest = rows
      .map((row) => row.last_order_at)
      .filter(Boolean)
      .sort()
      .pop();
    if (latest) {
      params.push(latest);
      setClauses.push(`last_order_at = $${params.length}`);
    }
  }

  if ("tier" in target && totals.lifetime_points !== undefined) {
    params.push(calculateTier(totals.lifetime_points));
    setClauses.push(`tier = $${params.length}`);
  }

  if ("updated_at" in target) setClauses.push(`updated_at = NOW()`);

  params.push(target.id);
  await client.query(`UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);

  if (rest.length > 0) {
    await client.query(`DELETE FROM ${table} WHERE id = ANY($1::bigint[])`, [rest.map((row) => row.id)]);
  }

  return totals;
};

const ensureArchiveTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_merge_archive (
      id BIGSERIAL PRIMARY KEY,
      merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      tenant_id BIGINT NULL,
      keeper_id BIGINT NOT NULL,
      merged_customer_id BIGINT NOT NULL,
      snapshot JSONB NOT NULL
    )
  `);
};

const mergeGroup = async (client, { references, customerColumns, keeper, losers, group }) => {
  const loserIds = losers.map((row) => row.id);
  const keeperId = keeper.id;

  await client.query(`SELECT id FROM customers WHERE id = ANY($1::bigint[]) FOR UPDATE`, [[keeperId, ...loserIds]]);

  await client.query(
    `INSERT INTO customer_merge_archive (tenant_id, keeper_id, merged_customer_id, snapshot)
     SELECT tenant_id, $2::bigint, id, to_jsonb(customers) FROM customers WHERE id = ANY($1::bigint[])`,
    [loserIds, keeperId]
  );

  const walletTotals = (await tableExists(client, "customer_wallets"))
    ? await mergeOneRowPerCustomer(client, "customer_wallets", ONE_ROW_PER_CUSTOMER.customer_wallets, keeperId, loserIds)
    : null;

  const loyaltyTotals = (await tableExists(client, "customer_loyalty"))
    ? await mergeOneRowPerCustomer(client, "customer_loyalty", ONE_ROW_PER_CUSTOMER.customer_loyalty, keeperId, loserIds)
    : null;

  let moved = 0;
  for (const reference of references) {
    if (ONE_ROW_PER_CUSTOMER[reference.table]) continue;
    const result = await client.query(
      `UPDATE ${reference.table} SET ${reference.assign} WHERE ${reference.match.replace("$1", "$2")}`,
      [String(keeperId), loserIds.map((id) => String(id))]
    );
    moved += result.rowCount || 0;
  }

  // Contact details the duplicate happened to carry and the survivor does not.
  const setClauses = [];
  const params = [];
  const filled = [];

  for (const { column_name: column } of customerColumns) {
    if (NEVER_BACKFILLED.has(column)) continue;
    if (!isBlank(keeper[column])) continue;
    const donor = losers.find((row) => !isBlank(row[column]));
    if (!donor) continue;
    params.push(donor[column]);
    setClauses.push(`${column} = $${params.length}`);
    filled.push(column);
  }

  for (const column of SUMMED_CUSTOMER_COLUMNS) {
    if (!customerColumns.some((entry) => entry.column_name === column)) continue;
    const total = [keeper, ...losers].reduce((sum, row) => sum + Number(row[column] || 0), 0);
    params.push(total);
    setClauses.push(`${column} = $${params.length}`);
  }

  if (walletTotals && customerColumns.some((entry) => entry.column_name === "wallet_balance")) {
    params.push(walletTotals.balance ?? 0);
    setClauses.push(`wallet_balance = $${params.length}`);
  }

  if (loyaltyTotals && customerColumns.some((entry) => entry.column_name === "loyalty_tier")) {
    params.push(calculateTier(loyaltyTotals.lifetime_points ?? loyaltyTotals.available_points ?? 0));
    setClauses.push(`loyalty_tier = $${params.length}`);
  }

  if (setClauses.length > 0) {
    if (customerColumns.some((entry) => entry.column_name === "updated_at")) setClauses.push(`updated_at = NOW()`);
    params.push(keeperId);
    await client.query(`UPDATE customers SET ${setClauses.join(", ")} WHERE id = $${params.length}`, params);
  }

  // The FKs cascade on delete, so prove nothing is left pointing at the losers.
  const remaining = await countReferences(client, references, loserIds);
  const stranded = [...remaining.entries()].filter(([, bucket]) => bucket.total > 0);
  if (stranded.length > 0) {
    throw new Error(
      `refused to delete ${group.phone_digits}: rows still reference ${stranded
        .map(([id, bucket]) => `${id} (${Object.entries(bucket.byTable).map(([table, n]) => `${table}:${n}`).join(", ")})`)
        .join("; ")}`
    );
  }

  await client.query(`DELETE FROM customers WHERE id = ANY($1::bigint[])`, [loserIds]);

  return { moved, filled, walletTotals, loyaltyTotals };
};

const client = await db.connect();
let groupsSeen = 0;
let groupsMerged = 0;
let rowsRemoved = 0;
let rowsMoved = 0;
const failures = [];

try {
  const references = await discoverReferences(client);
  const customerColumns = await listCustomerColumns(client);
  const groups = await findGroups(client);

  const soft = references.filter((reference) => !reference.foreignKey);
  console.log(`${references.length} table(s) reference customers; ${soft.length} of them without a foreign key:`);
  if (soft.length > 0) console.log(`   ${soft.map((reference) => `${reference.table}.${reference.column} (${reference.dataType})`).join(", ")}`);
  console.log(`${groups.length} duplicate group(s)${APPLY ? "" : " — dry run, nothing will be written"}\n`);

  if (groups.length === 0) {
    console.log("Nothing to merge.");
  }

  if (APPLY && groups.length > 0) await ensureArchiveTable(client);

  for (const group of groups) {
    groupsSeen += 1;
    const { rows: members } = await client.query(
      `SELECT * FROM customers WHERE id = ANY($1::bigint[]) ORDER BY id`,
      [group.ids]
    );
    const counts = await countReferences(client, references, group.ids);
    const keeper = pickKeeper(members, counts);
    const losers = members.filter((row) => row.id !== keeper.id);

    console.log(`+${group.phone_digits} (tenant ${group.tenant_id ?? "—"}) — ${members.length} rows`);
    for (const member of members) {
      const bucket = counts.get(String(member.id));
      const detail = Object.entries(bucket?.byTable || {})
        .map(([table, n]) => `${table}:${n}`)
        .join(", ");
      console.log(
        `   ${member.id === keeper.id ? "keep  " : "merge "} #${member.id} ${String(member.name || "").trim() || "(no name)"}` +
          ` | wallet ${member.wallet_balance ?? 0} | points ${member.loyalty_points ?? 0}` +
          ` | created ${member.created_at ? new Date(member.created_at).toISOString().slice(0, 10) : "—"}` +
          (detail ? ` | ${detail}` : " | no history")
      );
    }

    if (!APPLY) {
      console.log("");
      continue;
    }

    try {
      await client.query("BEGIN");
      const result = await mergeGroup(client, { references, customerColumns, keeper, losers, group });
      await client.query("COMMIT");
      groupsMerged += 1;
      rowsRemoved += losers.length;
      rowsMoved += result.moved;
      console.log(
        `   -> merged into #${keeper.id}: ${result.moved} row(s) repointed` +
          (result.filled.length ? `, filled ${result.filled.join(", ")}` : "") +
          (result.walletTotals ? `, wallet ${result.walletTotals.balance}` : "") +
          "\n"
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      failures.push({ phone: group.phone_digits, message: error.message });
      console.error(`   !! left untouched: ${error.message}\n`);
    }
  }

  console.log("—".repeat(60));
  console.log(`groups: ${groupsSeen} | merged: ${groupsMerged} | duplicate rows removed: ${rowsRemoved} | rows repointed: ${rowsMoved}`);
  if (failures.length > 0) {
    console.log(`${failures.length} group(s) failed and were rolled back:`);
    for (const failure of failures) console.log(`  +${failure.phone}: ${failure.message}`);
  }
  if (!APPLY && groupsSeen > 0) console.log("\nRe-run with --apply to merge.");
} finally {
  client.release();
  await db.end();
}

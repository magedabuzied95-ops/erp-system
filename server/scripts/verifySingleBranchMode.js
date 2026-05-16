import process from "node:process";
import db from "../database/db.js";
import { ensureBranchSchema } from "../utils/branchSchema.js";
import { SINGLE_BRANCH_NAME, ensureSingleBranchMode } from "../utils/singleBranchMode.js";

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const qPath = (path) => String(path).split(".").map(q).join(".");

const main = async () => {
  await ensureBranchSchema();
  const singleBranch = await ensureSingleBranchMode();

  const branches = await db.query(
    `
    SELECT id, name, is_active
    FROM branches
    ORDER BY id
    `
  );

  const branchTables = await db.query(
    `
    SELECT table_schema, table_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'branch_id'
      AND table_name <> 'branches'
    ORDER BY table_name
    `
  );

  const orphanChecks = [];
  for (const { table_schema: schema, table_name: table } of branchTables.rows) {
    const result = await db.query(`
      SELECT COUNT(*)::int AS orphan_count
      FROM ${q(schema)}.${q(table)} source
      LEFT JOIN branches b ON b.id = source.branch_id
      WHERE source.branch_id IS NOT NULL
        AND b.id IS NULL
    `);

    const drift = await db.query(
      `
      SELECT COUNT(*)::int AS drift_count
      FROM ${q(schema)}.${q(table)}
      WHERE branch_id IS DISTINCT FROM $1
      `,
      [singleBranch.branchId]
    );

    orphanChecks.push({
      table: `${schema}.${table}`,
      orphan_count: Number(result.rows[0]?.orphan_count || 0),
      drift_count: Number(drift.rows[0]?.drift_count || 0),
    });
  }

  const foreignKeys = await db.query(`
    SELECT
      c.conname,
      c.conrelid::regclass::text AS child_table,
      c.confrelid::regclass::text AS parent_table,
      json_agg(child_att.attname ORDER BY keys.ordinality) AS child_columns,
      json_agg(parent_att.attname ORDER BY keys.ordinality) AS parent_columns
    FROM pg_constraint c
    JOIN unnest(c.conkey, c.confkey) WITH ORDINALITY AS keys(child_attnum, parent_attnum, ordinality) ON TRUE
    JOIN pg_attribute child_att ON child_att.attrelid = c.conrelid AND child_att.attnum = keys.child_attnum
    JOIN pg_attribute parent_att ON parent_att.attrelid = c.confrelid AND parent_att.attnum = keys.parent_attnum
    WHERE c.contype = 'f'
      AND c.connamespace = current_schema()::regnamespace
    GROUP BY c.oid, c.conname, c.conrelid, c.confrelid
    ORDER BY child_table, c.conname
  `);

  const foreignKeyChecks = [];
  for (const fk of foreignKeys.rows) {
    const childColumns = fk.child_columns || [];
    const parentColumns = fk.parent_columns || [];
    const joinClause = childColumns
      .map((column, index) => `child.${q(column)} = parent.${q(parentColumns[index])}`)
      .join(" AND ");
    const populatedClause = childColumns.map((column) => `child.${q(column)} IS NOT NULL`).join(" AND ");
    const parentMissingClause = parentColumns.map((column) => `parent.${q(column)} IS NULL`).join(" AND ");

    const result = await db.query(`
      SELECT COUNT(*)::int AS violation_count
      FROM ${qPath(fk.child_table)} child
      LEFT JOIN ${qPath(fk.parent_table)} parent ON ${joinClause}
      WHERE ${populatedClause}
        AND ${parentMissingClause}
    `);

    foreignKeyChecks.push({
      constraint: fk.conname,
      child_table: fk.child_table,
      parent_table: fk.parent_table,
      violation_count: Number(result.rows[0]?.violation_count || 0),
    });
  }

  const failures = [];
  if (branches.rows.length !== 1) failures.push(`Expected 1 branch, found ${branches.rows.length}`);
  if (branches.rows[0]?.name !== SINGLE_BRANCH_NAME) failures.push(`Expected branch name ${SINGLE_BRANCH_NAME}`);
  if (branches.rows[0]?.is_active === false) failures.push("Single branch is inactive");

  for (const check of orphanChecks) {
    if (check.orphan_count > 0) failures.push(`${check.table} has ${check.orphan_count} orphan branch_id values`);
    if (check.drift_count > 0) failures.push(`${check.table} has ${check.drift_count} non-default branch_id values`);
  }
  for (const check of foreignKeyChecks) {
    if (check.violation_count > 0) {
      failures.push(`${check.constraint} has ${check.violation_count} foreign key violations`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        branch: branches.rows[0] || null,
        checked_tables: orphanChecks,
        foreign_keys: foreignKeyChecks,
        failures,
      },
      null,
      2
    )
  );

  if (failures.length > 0) {
    process.exitCode = 1;
  }
};

main()
  .catch((error) => {
    console.error("[verify-single-branch] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

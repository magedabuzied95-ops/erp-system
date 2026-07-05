import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import db from "../database/db.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const serverDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(serverDir, "..");

dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(serverDir, ".env"), quiet: true });

const CONFIRM_FLAG = "--confirm-factory-reset";
const UNDERSTAND_FLAG = "--i-understand-this-deletes-data";

const protectedNameFragments = [
  "setting",
  "settings",
  "config",
  "token",
  "secret",
  "credential",
  "integration",
  "meta",
  "ai",
  "openai",
  "webhook",
  "user",
  "role",
  "permission",
  "branch",
];

const explicitProtectedTables = [
  "tenants",
  "subscriptions",
  "users",
  "roles",
  "permissions",
  "role_permissions",
  "branches",
  "settings",
  "system_settings",
  "app_settings",
  "site_settings",
  "website_settings",
  "ai_settings",
  "ai_agent_settings",
  "ai_marketing_settings",
  "social_automation_settings",
  "marketing_settings",
  "meta_settings",
  "integrations",
  "meta_integrations",
  "evolution_instances",
  "whatsapp_instances",
  "company_profile",
  "company_profiles",
  "categories",
  "brands",
  "product_types",
  "manufacturers",
  "units",
  "warehouses",
  "warehouse_sections",
  "accounts",
  "cashbox",
  "loyalty_rules",
  "commission_rules",
  "employees",
  "employee_sales_profiles",
  "staff_task_templates",
  "staff_task_assignments",
  "staff_task_history",
  "staff_task_comments",
  "staff_task_email_logs",
  "staff_task_notification_queue",
  "coupon_campaigns",
  "coupons",
  "master_qr_models",
  "marketing_comment_dm_rules",
  "social_comment_post_automation_configs",
];

const operationalTargetCandidates = [
  "orders",
  "order_items",
  "returns",
  "return_items",
  "order_confirmation_codes",
  "accounting_order_item_cost_overrides",
  "purchases",
  "purchase_items",
  "products",
  "product_variants",
  "product_variant_images",
  "variants",
  "product_audiences",
  "warehouse_inventory",
  "inventory_movements",
  "stock_transfers",
  "inventory_count_sessions",
  "inventory_count_items",
  "inventory_counts",
  "customers",
  "customer_loyalty",
  "customer_loyalty_history",
  "customer_wallets",
  "wallet_transactions",
  "loyalty_transactions",
  "suppliers",
  "customer_otps",
  "coupon_redemptions",
  "journal_entries",
  "journal_entry_lines",
  "journal_lines",
  "ledger_entries",
  "transactions",
  "payment_transactions",
  "payment_transaction_events",
  "expenses",
  "expense_approvals",
  "expense_attachments",
  "income",
  "shipping_events",
  "storefront_customer_carts",
  "storefront_customer_sessions",
  "storefront_customer_events",
  "notifications",
  "cashbox_movements",
  "cash_drawer_shifts",
  "cash_drawer_shift_events",
  "employee_sales",
  "employee_commissions",
  "sales_opportunities",
  "barcode_print_queue",
  "audit_logs",
  "marketing_attribution_events",
  "marketing_automation_logs",
  "marketing_comment_dm_logs",
  "marketing_comment_events",
  "marketing_content_drafts",
  "marketing_conversations",
  "marketing_post_analytics",
  "marketing_post_product_links",
  "marketing_posts",
  "marketing_story_exports",
  "marketing_story_trigger_suggestions",
  "task_activity_logs",
  "task_assignments",
  "task_attachments",
  "ai_shoe_cover_jobs",
];

const lowercaseSet = (items = []) => new Set(items.map((item) => String(item || "").toLowerCase()));

const explicitProtectedTableSet = lowercaseSet(explicitProtectedTables);
const operationalTargetSet = lowercaseSet(operationalTargetCandidates);
const explicitOperationalOverrides = lowercaseSet(["ai_shoe_cover_jobs"]);

const flags = new Set(process.argv.slice(2).map((value) => String(value || "").trim().toLowerCase()));
const hasConfirmFlag = flags.has(CONFIRM_FLAG);
const hasUnderstandFlag = flags.has(UNDERSTAND_FLAG);
const requestedLiveRun = hasConfirmFlag || hasUnderstandFlag;
const canExecuteLiveRun = hasConfirmFlag && hasUnderstandFlag;
const isProduction = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";

const quoteIdentifier = (value = "") => `"${String(value || "").replace(/"/g, "\"\"")}"`;
const formatInt = (value = 0) => new Intl.NumberFormat("en-US").format(Number(value || 0));
const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const sortStrings = (items = []) => [...items].sort((left, right) => left.localeCompare(right));
const parsePgTextArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text || text === "{}") return [];
  if (text.startsWith("{") && text.endsWith("}")) {
    return text
      .slice(1, -1)
      .split(",")
      .map((item) => item.replace(/^"(.*)"$/, "$1").trim())
      .filter(Boolean);
  }
  return [text];
};

const DELETE_ACTION_LABELS = {
  a: "NO ACTION",
  r: "RESTRICT",
  c: "CASCADE",
  n: "SET NULL",
  d: "SET DEFAULT",
};

const logSection = (title, lines = []) => {
  console.log(`\n=== ${title} ===`);
  for (const line of lines) {
    console.log(line);
  }
};

const listLines = (items = [], emptyLabel = "(none)") => {
  if (!items.length) return [emptyLabel];
  return items.map((item) => `- ${item}`);
};

const classifyTable = (tableName = "") => {
  const normalized = String(tableName || "").toLowerCase();
  if (explicitOperationalOverrides.has(normalized)) return "operational";
  if (explicitProtectedTableSet.has(normalized) || protectedNameFragments.some((fragment) => normalized.includes(fragment))) {
    return "protected";
  }
  if (operationalTargetSet.has(normalized)) return "operational";
  return "other";
};

const countTableRows = async (client, tableName) => {
  const result = await client.query(`SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(tableName)}`);
  return Number(result.rows[0]?.count || 0);
};

const loadExistingTables = async (client) => {
  const result = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
    ORDER BY tablename ASC
  `);
  return result.rows.map((row) => String(row.tablename || "").toLowerCase());
};

const loadForeignKeys = async (client) => {
  const result = await client.query(`
    SELECT
      constraint_def.conname AS constraint_name,
      dependent.relname AS dependent_table,
      referenced.relname AS referenced_table,
      constraint_def.confdeltype AS delete_action,
      array_agg(dependent_attr.attname ORDER BY key_map.ordinality) AS dependent_columns,
      array_agg(referenced_attr.attname ORDER BY key_map.ordinality) AS referenced_columns,
      bool_and(NOT dependent_attr.attnotnull) AS all_dependent_columns_nullable
    FROM pg_constraint constraint_def
    INNER JOIN pg_class dependent ON dependent.oid = constraint_def.conrelid
    INNER JOIN pg_namespace dependent_schema ON dependent_schema.oid = dependent.relnamespace
    INNER JOIN pg_class referenced ON referenced.oid = constraint_def.confrelid
    INNER JOIN pg_namespace referenced_schema ON referenced_schema.oid = referenced.relnamespace
    INNER JOIN unnest(constraint_def.conkey, constraint_def.confkey) WITH ORDINALITY AS key_map(dependent_attnum, referenced_attnum, ordinality)
      ON TRUE
    INNER JOIN pg_attribute dependent_attr
      ON dependent_attr.attrelid = dependent.oid
     AND dependent_attr.attnum = key_map.dependent_attnum
    INNER JOIN pg_attribute referenced_attr
      ON referenced_attr.attrelid = referenced.oid
     AND referenced_attr.attnum = key_map.referenced_attnum
    WHERE constraint_def.contype = 'f'
      AND dependent_schema.nspname = current_schema()
      AND referenced_schema.nspname = current_schema()
    GROUP BY
      constraint_def.conname,
      dependent.relname,
      referenced.relname,
      constraint_def.confdeltype
    ORDER BY dependent.relname, referenced.relname, constraint_def.conname
  `);

  return result.rows
    .map((row) => ({
      constraintName: String(row.constraint_name || ""),
      dependentTable: String(row.dependent_table || "").toLowerCase(),
      referencedTable: String(row.referenced_table || "").toLowerCase(),
      deleteAction: String(row.delete_action || ""),
      deleteActionLabel: DELETE_ACTION_LABELS[String(row.delete_action || "")] || String(row.delete_action || "").toUpperCase(),
      dependentColumns: parsePgTextArray(row.dependent_columns),
      referencedColumns: parsePgTextArray(row.referenced_columns),
      allDependentColumnsNullable: Boolean(row.all_dependent_columns_nullable),
    }))
    .filter(
      (fk) =>
        fk.dependentTable &&
        fk.referencedTable &&
        fk.dependentColumns.length > 0 &&
        fk.dependentColumns.length === fk.referencedColumns.length
    );
};

const buildBackupFilePath = () => {
  const backupDir = path.join(repoRoot, "backups", "factory-reset-operational");
  fs.mkdirSync(backupDir, { recursive: true });
  return path.join(backupDir, `operational-data-${timestamp()}.dump`);
};

const runPgDumpBackup = (backupFile) => {
  const candidates = Array.from(
    new Set(
      [
        process.env.PG_DUMP_PATH,
        process.platform === "win32" ? "pg_dump.exe" : "pg_dump",
        "pg_dump",
      ].filter(Boolean)
    )
  );
  const dumpArgs = ["--format=custom", "--file", backupFile, "--no-owner", "--no-privileges"];
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();

  if (databaseUrl) {
    dumpArgs.push(databaseUrl);
  } else {
    const databaseName = String(process.env.PGDATABASE || "").trim();
    if (!databaseName) {
      throw new Error("DATABASE_URL or PGDATABASE is required before backup can run.");
    }
    dumpArgs.push(databaseName);
  }

  let lastFailure = null;
  for (const command of candidates) {
    const result = spawnSync(command, dumpArgs, {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    });

    if (!result.error && result.status === 0) {
      return {
        command,
        backupFile,
      };
    }

    lastFailure = result.error
      ? `${command}: ${result.error.message}`
      : `${command}: exit ${result.status}\n${String(result.stderr || result.stdout || "").trim()}`;
  }

  throw new Error(`pg_dump backup failed. ${lastFailure || "No pg_dump candidate succeeded."}`);
};

const buildExistsJoinPredicate = (dependentAlias, referencedAlias, dependentColumns = [], referencedColumns = []) =>
  dependentColumns
    .map(
      (columnName, index) =>
        `${quoteIdentifier(dependentAlias)}.${quoteIdentifier(columnName)} = ${quoteIdentifier(referencedAlias)}.${quoteIdentifier(referencedColumns[index])}`
    )
    .join(" AND ");

const buildNotNullPredicate = (alias, columns = []) =>
  columns.map((columnName) => `${quoteIdentifier(alias)}.${quoteIdentifier(columnName)} IS NOT NULL`).join(" AND ");

const countReferencingRows = async (client, fk) => {
  if (!fk.dependentColumns.length || fk.dependentColumns.length !== fk.referencedColumns.length) {
    return 0;
  }
  const notNullPredicate = buildNotNullPredicate("d", fk.dependentColumns);
  const joinPredicate = buildExistsJoinPredicate("d", "r", fk.dependentColumns, fk.referencedColumns);
  const sql = `
    SELECT COUNT(*)::bigint AS count
    FROM ${quoteIdentifier(fk.dependentTable)} d
    WHERE ${notNullPredicate}
      AND EXISTS (
        SELECT 1
        FROM ${quoteIdentifier(fk.referencedTable)} r
        WHERE ${joinPredicate}
      )
  `;
  const result = await client.query(sql);
  return Number(result.rows[0]?.count || 0);
};

const buildDeleteOrder = (targetTables = [], foreignKeys = []) => {
  const targetSet = lowercaseSet(targetTables);
  const outgoing = new Map(targetTables.map((tableName) => [tableName, new Set()]));
  const indegree = new Map(targetTables.map((tableName) => [tableName, 0]));

  for (const fk of foreignKeys) {
    if (!targetSet.has(fk.dependentTable) || !targetSet.has(fk.referencedTable)) continue;
    if (fk.dependentTable === fk.referencedTable) continue;
    const tableEdges = outgoing.get(fk.dependentTable);
    if (!tableEdges.has(fk.referencedTable)) {
      tableEdges.add(fk.referencedTable);
      indegree.set(fk.referencedTable, Number(indegree.get(fk.referencedTable) || 0) + 1);
    }
  }

  const ready = sortStrings(targetTables.filter((tableName) => Number(indegree.get(tableName) || 0) === 0));
  const order = [];

  while (ready.length) {
    const currentTable = ready.shift();
    order.push(currentTable);
    const neighbors = sortStrings(Array.from(outgoing.get(currentTable) || []));
    for (const neighbor of neighbors) {
      indegree.set(neighbor, Number(indegree.get(neighbor) || 0) - 1);
      if (Number(indegree.get(neighbor) || 0) === 0) {
        ready.push(neighbor);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  const cycleTables = targetTables.filter((tableName) => !order.includes(tableName));
  return {
    order,
    cycleTables: sortStrings(cycleTables),
  };
};

const analyzeExternalDependencies = async (client, targetTables = [], foreignKeys = []) => {
  const targetSet = lowercaseSet(targetTables);
  const protectedDependencies = [];
  const blockedDependencies = [];
  const safeExternalDependencies = [];

  for (const fk of foreignKeys) {
    if (!targetSet.has(fk.referencedTable) || targetSet.has(fk.dependentTable)) continue;

    const dependentType = classifyTable(fk.dependentTable);
    const referencedCount = await countReferencingRows(client, fk);
    const baseRecord = {
      table: fk.dependentTable,
      references: fk.referencedTable,
      constraint: fk.constraintName,
      action: fk.deleteActionLabel,
      actionCode: fk.deleteAction,
      dependentColumns: [...fk.dependentColumns],
      referencedColumns: [...fk.referencedColumns],
      columns: fk.dependentColumns.join(", "),
      rowCount: referencedCount,
      allNullable: fk.allDependentColumnsNullable,
      type: dependentType,
    };

    const canPreNullify = fk.allDependentColumnsNullable;
    const isBlocked = referencedCount > 0 && !canPreNullify;

    if (dependentType === "protected") {
      protectedDependencies.push({
        ...baseRecord,
        status: isBlocked ? "blocked_not_nullable" : referencedCount > 0 ? "requires_pre_nullify" : "no_active_rows",
      });
      if (isBlocked) blockedDependencies.push({ ...baseRecord, status: "blocked_protected" });
      continue;
    }

    if (isBlocked) {
      blockedDependencies.push({ ...baseRecord, status: "blocked_external" });
      continue;
    }

    if (referencedCount > 0 || dependentType === "other") {
      safeExternalDependencies.push({
        ...baseRecord,
        status: referencedCount > 0 ? "requires_pre_nullify" : "no_active_rows",
      });
    }
  }

  return {
    protectedDependencies: sortStrings(protectedDependencies.map((item) => JSON.stringify(item)))
      .map((serialized) => JSON.parse(serialized)),
    blockedDependencies: sortStrings(blockedDependencies.map((item) => JSON.stringify(item)))
      .map((serialized) => JSON.parse(serialized)),
    safeExternalDependencies: sortStrings(safeExternalDependencies.map((item) => JSON.stringify(item)))
      .map((serialized) => JSON.parse(serialized)),
  };
};

const formatDependencyLine = (dependency) =>
  `${dependency.table} -> ${dependency.references} | action=${dependency.action} | rows=${formatInt(dependency.rowCount)} | columns=${dependency.columns} | status=${dependency.status}`;

const buildProtectedNullifyUpdateSql = (dependency) => {
  const setClause = dependency.dependentColumns.map((columnName) => `${quoteIdentifier(columnName)} = NULL`).join(", ");
  const notNullPredicate = buildNotNullPredicate("d", dependency.dependentColumns);
  const joinPredicate = buildExistsJoinPredicate("d", "r", dependency.dependentColumns, dependency.referencedColumns);

  return `
    UPDATE ${quoteIdentifier(dependency.table)} d
    SET ${setClause}
    WHERE ${notNullPredicate}
      AND EXISTS (
        SELECT 1
        FROM ${quoteIdentifier(dependency.references)} r
        WHERE ${joinPredicate}
      )
  `;
};

const loadSequenceResets = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT
      column_name,
      pg_get_serial_sequence(format('%I.%I', current_schema(), $1::text), column_name) AS sequence_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    ORDER BY ordinal_position
    `,
    [tableName]
  );

  return result.rows
    .map((row) => String(row.sequence_name || "").trim())
    .filter(Boolean);
};

const resetOwnedSequences = async (client, tableName) => {
  const sequenceNames = await loadSequenceResets(client, tableName);
  for (const sequenceName of sequenceNames) {
    await client.query(`ALTER SEQUENCE ${sequenceName} RESTART WITH 1`);
  }
  return sequenceNames.length;
};

const printPlan = ({
  protectedTables,
  targetTables,
  missingTargetTables,
  rowCounts,
  deleteOrder,
  protectedDependencies,
  blockedDependencies,
  mode,
}) => {
  logSection("Mode", [
    `- ${mode === "live" ? "LIVE EXECUTION" : "DRY RUN ONLY"}`,
    `- NODE_ENV=${process.env.NODE_ENV || "(unset)"}`,
  ]);
  logSection("Protected Name Filters", listLines(protectedNameFragments));
  logSection("Protected Tables", listLines(protectedTables));
  logSection("Target Tables", listLines(targetTables));
  logSection("Missing Target Tables", listLines(missingTargetTables));
  logSection("Delete Order", listLines(deleteOrder));
  logSection(
    "Target Row Counts",
    deleteOrder.map((tableName) => `- ${tableName}: ${formatInt(rowCounts.get(tableName) || 0)}`)
  );
  logSection("Blocked Dependencies", listLines(blockedDependencies.map(formatDependencyLine)));
  logSection("Protected Dependencies", listLines(protectedDependencies.map(formatDependencyLine)));
  logSection("Warning", [
    "!!! FACTORY RESET OPERATIONAL DATA ONLY !!!",
    "!!! NO TRUNCATE CASCADE. NO DELETE CASCADE RELIANCE OUTSIDE THE APPROVED TARGET DELETE ORDER !!!",
    "!!! PROTECTED TABLES MAY ONLY BE TOUCHED WITH SAFE FK NULLIFICATION WHEN THE FK COLUMNS ARE NULLABLE !!!",
    "!!! LIVE EXECUTION REFUSES TO RUN IF ANY BLOCKED DEPENDENCY REMAINS !!!",
  ]);
};

const resolvePlan = async (client) => {
  const existingTables = await loadExistingTables(client);
  const existingTableSet = lowercaseSet(existingTables);
  const protectedTables = existingTables.filter((tableName) => classifyTable(tableName) === "protected");

  const targetTables = operationalTargetCandidates
    .map((tableName) => String(tableName || "").toLowerCase())
    .filter((tableName, index, items) => items.indexOf(tableName) === index)
    .filter((tableName) => existingTableSet.has(tableName))
    .filter((tableName) => classifyTable(tableName) !== "protected");

  const missingTargetTables = operationalTargetCandidates
    .map((tableName) => String(tableName || "").toLowerCase())
    .filter((tableName, index, items) => items.indexOf(tableName) === index)
    .filter((tableName) => !existingTableSet.has(tableName));

  if (!targetTables.length) {
    throw new Error("Refusing to continue because no approved operational target tables were found in the current schema.");
  }

  const foreignKeys = await loadForeignKeys(client);
  const { order: deleteOrder, cycleTables } = buildDeleteOrder(targetTables, foreignKeys);
  if (cycleTables.length) {
    throw new Error(`Refusing to continue because target delete order contains FK cycles: ${cycleTables.join(", ")}`);
  }

  const { protectedDependencies, blockedDependencies } = await analyzeExternalDependencies(client, targetTables, foreignKeys);
  const rowCounts = new Map();
  for (const tableName of deleteOrder) {
    rowCounts.set(tableName, await countTableRows(client, tableName));
  }

  return {
    protectedTables,
    targetTables: deleteOrder,
    deleteOrder,
    missingTargetTables,
    protectedDependencies,
    blockedDependencies,
    rowCounts,
  };
};

const runProtectedPreNullify = async (client, plan) => {
  const updates = [];
  for (const dependency of plan.protectedDependencies) {
    if (dependency.status !== "requires_pre_nullify" || Number(dependency.rowCount || 0) <= 0) continue;
    const sql = buildProtectedNullifyUpdateSql(dependency);
    const result = await client.query(sql);
    updates.push({
      table: dependency.table,
      references: dependency.references,
      columns: dependency.columns,
      updatedRows: Number(result.rowCount || 0),
    });
  }
  return updates;
};

const run = async () => {
  if (requestedLiveRun && !canExecuteLiveRun) {
    throw new Error(
      `Both ${CONFIRM_FLAG} and ${UNDERSTAND_FLAG} are required for live execution. Without both flags, this script only supports dry-run mode.`
    );
  }

  if (canExecuteLiveRun && !isProduction) {
    throw new Error(`Live execution is blocked because NODE_ENV must be production. Current value: ${process.env.NODE_ENV || "(unset)"}`);
  }

  const mode = canExecuteLiveRun ? "live" : "dry-run";
  const planningClient = await db.connect();
  let plan;

  try {
    plan = await resolvePlan(planningClient);
  } finally {
    planningClient.release();
  }

  printPlan({ ...plan, mode });

  if (plan.blockedDependencies.length) {
    if (mode === "live") {
      throw new Error(
        `Live execution is blocked because unsafe FK dependencies still reference target tables:\n${plan.blockedDependencies
          .map(formatDependencyLine)
          .join("\n")}`
      );
    }

    logSection("Dry Run Result", [
      "- No data was deleted.",
      "- Live execution is currently BLOCKED by dependency checks.",
      "- Review blocked dependencies above before any production reset.",
    ]);
    return;
  }

  if (mode === "dry-run") {
    logSection("Dry Run Result", [
      "- No data was deleted.",
      "- Delete order and row counts above are the exact live-reset plan if no new blockers appear.",
    ]);
    return;
  }

  const backupFile = buildBackupFilePath();
  logSection("Backup", [`- Creating backup at: ${backupFile}`]);
  const backupResult = runPgDumpBackup(backupFile);
  logSection("Backup Result", [
    "- Backup completed successfully.",
    `- Command: ${backupResult.command}`,
    `- File: ${backupResult.backupFile}`,
  ]);

  const executionClient = await db.connect();
  const deletedCounts = new Map();
  const postCounts = new Map();
  const resetSequenceCounts = new Map();

  try {
    await executionClient.query("BEGIN");

    const protectedPreNullifyUpdates = await runProtectedPreNullify(executionClient, plan);
    if (protectedPreNullifyUpdates.length) {
      logSection(
        "Protected FK Nullify",
        protectedPreNullifyUpdates.map(
          (item) => `- ${item.table} -> ${item.references} | columns=${item.columns} | updated=${formatInt(item.updatedRows)}`
        )
      );
    }

    const recheckedPlan = await resolvePlan(executionClient);
    if (recheckedPlan.blockedDependencies.length) {
      throw new Error(
        `Live execution remains blocked after protected FK nullification:\n${recheckedPlan.blockedDependencies
          .map(formatDependencyLine)
          .join("\n")}`
      );
    }

    for (const tableName of recheckedPlan.deleteOrder) {
      deletedCounts.set(tableName, await countTableRows(executionClient, tableName));
      await executionClient.query(`DELETE FROM ${quoteIdentifier(tableName)}`);
      postCounts.set(tableName, await countTableRows(executionClient, tableName));

      if (Number(postCounts.get(tableName) || 0) === 0) {
        resetSequenceCounts.set(tableName, await resetOwnedSequences(executionClient, tableName));
      } else {
        resetSequenceCounts.set(tableName, 0);
      }
    }

    await executionClient.query("COMMIT");
  } catch (error) {
    try {
      await executionClient.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[factory-reset] rollback failed", rollbackError);
    }
    throw error;
  } finally {
    executionClient.release();
  }

  logSection(
    "Final Report",
    plan.deleteOrder.map(
      (tableName) =>
        `- ${tableName}: deleted ${formatInt(deletedCounts.get(tableName) || 0)}, remaining ${formatInt(postCounts.get(tableName) || 0)}, sequences_reset=${formatInt(resetSequenceCounts.get(tableName) || 0)}`
    )
  );
};

run()
  .catch((error) => {
    console.error("\n[factory-reset-operational-data] FAILED");
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch (error) {
      console.error("[factory-reset-operational-data] database shutdown warning", error?.message || String(error));
    }
  });

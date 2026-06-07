import db from "../database/db.js";

const CONSTRAINT_NAME = "orders_shift_id_fkey";
const ORDERS_TABLE = "orders";
const SHIFT_COLUMN = "shift_id";
const TARGET_TABLE = "cash_drawer_shifts";
const LEGACY_TARGET_TABLE = "cashbox";

const transientLockCodes = new Set(["40P01", "55P03", "57014"]);

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const normalizeTableName = (value) => String(value || "").split(".").pop();

const isTransientLockError = (error) => transientLockCodes.has(error?.code);

const safeStatementTimeouts = new Set(["15000ms", "20000ms"]);

const applyDdlTimeouts = async (client, statementTimeout = "15000ms") => {
  const timeout = safeStatementTimeouts.has(statementTimeout) ? statementTimeout : "15000ms";
  await client.query(`SET LOCAL lock_timeout = '5000ms'`);
  await client.query(`SET LOCAL statement_timeout = '${timeout}'`);
};

const getRequiredSchemaState = async (client) => {
  const result = await client.query(`
    SELECT
      to_regclass('public.orders') IS NOT NULL AS orders_exists,
      to_regclass('public.cash_drawer_shifts') IS NOT NULL AS cash_drawer_shifts_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'shift_id'
      ) AS orders_shift_id_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'cash_drawer_shifts'
          AND column_name = 'id'
      ) AS cash_drawer_shifts_id_exists
  `);

  return result.rows[0] || {};
};

const readOrdersShiftFkDefinition = async (client) => {
  const result = await client.query(
    `
    SELECT
      c.conname AS constraint_name,
      c.convalidated AS validated,
      c.confdeltype AS delete_action_code,
      CASE c.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE c.confdeltype::text
      END AS delete_action,
      c.confrelid::regclass::text AS referenced_table,
      pg_get_constraintdef(c.oid, true) AS definition,
      ARRAY(
        SELECT a.attname
        FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
        ORDER BY key.ordinality
      ) AS columns,
      ARRAY(
        SELECT a.attname
        FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = key.attnum
        ORDER BY key.ordinality
      ) AS referenced_columns
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.orders')
      AND c.conname = $1
    LIMIT 1
    `,
    [CONSTRAINT_NAME]
  );

  return result.rows[0] || null;
};

export const logOrdersShiftFkDefinition = async (
  clientOrPool = db,
  label = "[orders-shift-fk-migration:definition]",
  context = {}
) => {
  const definition = await readOrdersShiftFkDefinition(clientOrPool);
  console.info(label, {
    ...context,
    table: ORDERS_TABLE,
    column: SHIFT_COLUMN,
    constraint: CONSTRAINT_NAME,
    definition,
  });
  return definition;
};

const shouldReplaceConstraint = (definition) => {
  if (!definition) return { replace: false, reason: "constraint_missing" };

  const referencedTable = normalizeTableName(definition.referenced_table);
  const columns = Array.isArray(definition.columns) ? definition.columns : [];
  const referencedColumns = Array.isArray(definition.referenced_columns) ? definition.referenced_columns : [];
  const pointsToExpectedTarget =
    referencedTable === TARGET_TABLE &&
    columns.length === 1 &&
    columns[0] === SHIFT_COLUMN &&
    referencedColumns.length === 1 &&
    referencedColumns[0] === "id";

  const pointsToLegacyTarget =
    referencedTable === LEGACY_TARGET_TABLE &&
    columns.length === 1 &&
    columns[0] === SHIFT_COLUMN &&
    referencedColumns.length === 1 &&
    referencedColumns[0] === "id";

  if (pointsToLegacyTarget) {
    return { replace: true, reason: "legacy_cashbox_reference" };
  }

  if (pointsToExpectedTarget && definition.delete_action_code !== "n") {
    return { replace: true, reason: "expected_target_wrong_delete_action" };
  }

  if (pointsToExpectedTarget) {
    return { replace: false, reason: "already_correct" };
  }

  return { replace: false, reason: "unexpected_existing_definition" };
};

const replaceOrdersShiftFk = async (client, context = {}) => {
  await client.query("BEGIN");
  try {
    await applyDdlTimeouts(client, "15000ms");
    await client.query(`LOCK TABLE ${quoteIdentifier(ORDERS_TABLE)} IN SHARE ROW EXCLUSIVE MODE`);
    const current = await readOrdersShiftFkDefinition(client);
    const decision = shouldReplaceConstraint(current);
    if (!decision.replace) {
      await client.query("COMMIT");
      console.info("[orders-shift-fk-migration:replace-skipped-after-lock]", {
        ...context,
        reason: decision.reason,
        definition: current,
      });
      return false;
    }

    await client.query(`
      ALTER TABLE ${quoteIdentifier(ORDERS_TABLE)}
      DROP CONSTRAINT IF EXISTS ${quoteIdentifier(CONSTRAINT_NAME)}
    `);
    await client.query(`
      ALTER TABLE ${quoteIdentifier(ORDERS_TABLE)}
      ADD CONSTRAINT ${quoteIdentifier(CONSTRAINT_NAME)}
      FOREIGN KEY (${quoteIdentifier(SHIFT_COLUMN)})
      REFERENCES ${quoteIdentifier(TARGET_TABLE)}(id)
      ON DELETE SET NULL
      NOT VALID
    `);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.error("[orders-shift-fk-migration:error]", {
      ...context,
      step: "replace_constraint",
      code: error?.code || null,
      message: error?.message || String(error),
    });
    throw error;
  }
};

const validateOrdersShiftFk = async (client, context = {}) => {
  await client.query("BEGIN");
  try {
    await applyDdlTimeouts(client, "20000ms");
    await client.query(`
      ALTER TABLE ${quoteIdentifier(ORDERS_TABLE)}
      VALIDATE CONSTRAINT ${quoteIdentifier(CONSTRAINT_NAME)}
    `);
    await client.query("COMMIT");
    console.info("[orders-shift-fk-migration:validated]", {
      ...context,
      table: ORDERS_TABLE,
      constraint: CONSTRAINT_NAME,
    });
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    console.warn("[orders-shift-fk-migration:validation-skipped]", {
      ...context,
      table: ORDERS_TABLE,
      constraint: CONSTRAINT_NAME,
      code: error?.code || null,
      message: error?.message || String(error),
    });
    return false;
  }
};

export const repairOrdersShiftForeignKey = async (clientOrPool = db, context = {}) => {
  const ownsClient = typeof clientOrPool.connect === "function";
  const client = ownsClient ? await clientOrPool.connect() : clientOrPool;
  const logContext = { source: "startup", ...context };

  try {
    const schemaState = await getRequiredSchemaState(client);
    const before = await logOrdersShiftFkDefinition(client, "[orders-shift-fk-migration:before]", logContext);

    if (
      !schemaState.orders_exists ||
      !schemaState.orders_shift_id_exists ||
      !schemaState.cash_drawer_shifts_exists ||
      !schemaState.cash_drawer_shifts_id_exists
    ) {
      console.warn("[orders-shift-fk-migration:skipped]", {
        ...logContext,
        reason: "required_table_or_column_missing",
        schemaState,
      });
      await logOrdersShiftFkDefinition(client, "[orders-shift-fk-migration:after]", {
        ...logContext,
        skipped: true,
      });
      return { skipped: true, reason: "required_table_or_column_missing", before };
    }

    const decision = shouldReplaceConstraint(before);
    if (!decision.replace) {
      console.info("[orders-shift-fk-migration:skipped]", {
        ...logContext,
        reason: decision.reason,
      });
      if (decision.reason === "already_correct" && before && !before.validated) {
        await validateOrdersShiftFk(client, { ...logContext, reason: "already_correct_not_validated" });
      }
      const after = await logOrdersShiftFkDefinition(client, "[orders-shift-fk-migration:after]", logContext);
      return { skipped: true, reason: decision.reason, before, after };
    }

    console.warn("[orders-shift-fk-migration:replace]", {
      ...logContext,
      reason: decision.reason,
      from: before,
      to: {
        table: ORDERS_TABLE,
        column: SHIFT_COLUMN,
        referenced_table: TARGET_TABLE,
        referenced_column: "id",
        delete_action: "SET NULL",
      },
    });

    const replaced = await replaceOrdersShiftFk(client, { ...logContext, reason: decision.reason });
    if (replaced) {
      await validateOrdersShiftFk(client, { ...logContext, reason: decision.reason });
    }
    const after = await logOrdersShiftFkDefinition(client, "[orders-shift-fk-migration:after]", logContext);

    return { skipped: !replaced, reason: decision.reason, before, after };
  } catch (error) {
    if (isTransientLockError(error)) {
      console.warn("[orders-shift-fk-migration:skipped-transient-lock]", {
        ...logContext,
        code: error?.code || null,
        message: error?.message || String(error),
      });
      await logOrdersShiftFkDefinition(client, "[orders-shift-fk-migration:after]", {
        ...logContext,
        skipped: true,
        reason: "transient_lock",
      }).catch(() => null);
      return { skipped: true, reason: "transient_lock" };
    }

    console.error("[orders-shift-fk-migration:error]", {
      ...logContext,
      code: error?.code || null,
      message: error?.message || String(error),
    });
    throw error;
  } finally {
    if (ownsClient) client.release();
  }
};

export default repairOrdersShiftForeignKey;

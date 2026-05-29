export const ensureForeignKeyConstraint = async (clientOrPool, tableName, constraintName, alterSql) => {
  const exists = await clientOrPool.query(
    `
    SELECT 1
    FROM pg_constraint
    WHERE conname = $1
      AND conrelid = to_regclass($2)
    LIMIT 1
    `,
    [constraintName, tableName]
  );

  if (exists.rows.length > 0) return false;

  try {
    await clientOrPool.query(alterSql);
    return true;
  } catch (error) {
    if (error?.code === "42710") return false;
    throw error;
  }
};

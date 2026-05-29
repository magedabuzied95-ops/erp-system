import pool from "../database/db.js";

const formatPurchaseCode = (sequence) => `PO-${String(sequence).padStart(3, "0")}`;

const tableColumns = async (client, tableName) => {
  const result = await client.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
};

const main = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const columns = await tableColumns(client, "purchases");
    if (!columns.has("id") || !columns.has("purchase_number")) {
      throw new Error("purchases table must include id and purchase_number columns");
    }

    if (!columns.has("legacy_purchase_number")) {
      await client.query("ALTER TABLE purchases ADD COLUMN legacy_purchase_number VARCHAR(100)");
    }

    await client.query("ALTER TABLE purchases ALTER COLUMN purchase_number SET DEFAULT 'PO-PENDING'");

    const result = await client.query(
      `
      SELECT id, purchase_number, legacy_purchase_number
      FROM purchases
      ORDER BY id ASC
      FOR UPDATE
      `
    );

    let updated = 0;
    const preview = [];

    for (const row of result.rows) {
      const nextCode = formatPurchaseCode(row.id);
      if (row.purchase_number === nextCode) continue;

      const legacyCode = row.legacy_purchase_number || row.purchase_number || "";
      const invoiceNumberSet = columns.has("invoice_number") ? ", invoice_number = $3" : "";
      await client.query(
        `
        UPDATE purchases
        SET legacy_purchase_number = NULLIF($2, ''),
            purchase_number = $3
            ${invoiceNumberSet},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        `,
        [row.id, legacyCode, nextCode]
      );
      updated += 1;
      if (preview.length < 10) {
        preview.push({
          id: row.id,
          legacy_purchase_number: legacyCode,
          purchase_number: nextCode,
        });
      }
    }

    const tenantScoped = columns.has("tenant_id");
    if (tenantScoped) {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS purchases_tenant_purchase_number_uidx
          ON purchases (tenant_id, purchase_number)
          WHERE purchase_number IS NOT NULL AND purchase_number <> '' AND purchase_number <> 'PO-PENDING'
      `);
    } else {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS purchases_purchase_number_uidx
          ON purchases (purchase_number)
          WHERE purchase_number IS NOT NULL AND purchase_number <> '' AND purchase_number <> 'PO-PENDING'
      `);
    }

    await client.query("COMMIT");
    console.log("[purchase-number-backfill] complete", {
      scanned: result.rowCount,
      updated,
      preview,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[purchase-number-backfill] failed", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack,
    });
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

main();

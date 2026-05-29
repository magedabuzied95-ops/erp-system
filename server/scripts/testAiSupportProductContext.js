import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
process.env.AI_SUPPORT_DEBUG = process.env.AI_SUPPORT_DEBUG || "1";

const { default: db } = await import("../database/db.js");
const { buildAiSupportTrustedContext } = await import("../services/aiSupportContextService.js");

const compact = (value, limit = 180) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const unique = (items = []) => [...new Set(items.map((item) => compact(item)).filter(Boolean))];

const main = async () => {
  const tenantId = Number(process.env.TEST_TENANT_ID || process.argv[2] || 0);
  const tenantResult = tenantId
    ? await db.query(`SELECT id, name FROM tenants WHERE id = $1 LIMIT 1`, [tenantId])
    : await db.query(
        `
        SELECT t.id, t.name, COUNT(p.id)::int AS product_count
        FROM tenants t
        JOIN products p ON p.tenant_id = t.id
        GROUP BY t.id, t.name
        ORDER BY COUNT(p.id) DESC, t.id ASC
        LIMIT 1
        `
      );
  const tenant = tenantResult.rows[0];
  if (!tenant) throw new Error("No tenant with products found. Pass TEST_TENANT_ID or a tenant id argument.");

  const columnResult = await db.query(
    `
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('products', 'product_variants')
    ORDER BY table_name, ordinal_position
    `
  );
  console.log("Tenant:", { id: tenant.id, name: tenant.name });
  console.log("Product/variant columns:");
  for (const row of columnResult.rows) console.log(`- ${row.table_name}.${row.column_name}: ${row.data_type}`);

  const sampleResult = await db.query(
    `
    SELECT
      p.id,
      p.name,
      p.sku,
      p.barcode,
      pv.sku AS variant_sku,
      pv.barcode AS variant_barcode,
      pv.color,
      pv.size
    FROM products p
    LEFT JOIN product_variants pv
      ON pv.product_id = p.id
     AND (pv.tenant_id = p.tenant_id OR pv.tenant_id IS NULL)
    WHERE p.tenant_id = $1
    ORDER BY p.updated_at DESC NULLS LAST, p.id DESC, pv.id ASC
    LIMIT 12
    `,
    [tenant.id]
  );
  if (!sampleResult.rows.length) throw new Error(`Tenant ${tenant.id} has no products to test.`);

  const queries = unique(
    sampleResult.rows.flatMap((row) => [
      row.name && `هل ${row.name} متاح؟`,
      row.sku && `Do you have SKU ${row.sku}?`,
      row.barcode && `barcode ${row.barcode}`,
      row.variant_sku && `Do you have variant SKU ${row.variant_sku}?`,
      row.variant_barcode && `variant barcode ${row.variant_barcode}`,
      row.color && row.size && `${row.name} ${row.color} size ${row.size}`,
    ])
  ).slice(0, 6);

  console.log("\nQueries:");
  for (const query of queries) console.log(`- ${query}`);

  for (const query of queries) {
    const context = await buildAiSupportTrustedContext({ tenantId: tenant.id, message: query });
    console.log("\n---");
    console.log("Query:", query);
    console.log("Intent:", context.intent.type);
    console.log("Fallback:", context.fallbackReason || "(none)");
    console.log(
      "Suggested products:",
      context.suggested_products.map((product) => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        availability: product.availability,
        total_stock: product.total_stock,
        has_image: Boolean(product.image_url),
      }))
    );
    console.log(
      "Sources:",
      context.trustedContext.sources.map((source) => ({
        id: source.id,
        title: source.title,
        content: compact(source.content, 500),
      }))
    );
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controllerUrl = new URL("../server/controllers/productsController.js", import.meta.url);
const purchasesUrl = new URL("../server/routes/purchases.js", import.meta.url);

const countOf = (source, needle) => source.split(needle).length - 1;

test("products.last_stocked_at exists and is what the lists order by", async () => {
  const source = await readFile(controllerUrl, "utf8");

  assert.match(
    source,
    /ADD COLUMN IF NOT EXISTS last_stocked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP/,
    "ensureProductSchema must add products.last_stocked_at"
  );
  assert.match(
    source,
    /const productRecencyOrderSql = \(alias = "p"\) =>\s*`COALESCE\(\$\{alias\}\.last_stocked_at, to_timestamp\(0\)\) DESC, \$\{alias\}\.id DESC`/,
    "the shared ordering must be last_stocked_at first, id as the tie-break"
  );
  assert.match(
    source,
    /CREATE INDEX IF NOT EXISTS idx_products_last_stocked_at ON products \(last_stocked_at DESC, id DESC\)/,
    "the recency ordering needs its own index"
  );
});

test("the products page and the POS grid both sort newest-arrival first", async () => {
  const source = await readFile(controllerUrl, "utf8");

  // GET /products/admin-list (products page), GET /products, GET /products/with-variants (POS).
  assert.equal(
    countOf(source, "ORDER BY ${productRecencyOrderSql(\"p\")}"),
    3,
    "admin-list, /products and /with-variants must all order by arrival recency"
  );

  for (const [label, marker] of [
    ["admin-list", "COUNT(*) OVER()::int AS total_count"],
    ["with-variants", 'label: "list-products-base"'],
  ]) {
    const start = source.indexOf(marker);
    assert.ok(start > 0, `${label} query should still be findable`);
    const body = source.slice(start, start + 6000);
    assert.ok(
      !/ORDER BY p\.id DESC/.test(body),
      `${label} must not fall back to raw id ordering, which buries a restocked product`
    );
  }
});

test("every purchase path that brings stock in stamps last_stocked_at", async () => {
  const source = await readFile(purchasesUrl, "utf8");

  assert.match(
    source,
    /const stampProductsRestocked = async \(client, \{ tenantId, productIds = \[\] \}\) => \{/,
    "the stamp helper must exist"
  );
  assert.match(
    source,
    /UPDATE products\s*\n\s*SET last_stocked_at = CURRENT_TIMESTAMP/,
    "the helper must write last_stocked_at"
  );

  // create-received, POST /:id/receive, POST /:id/adjustments, PATCH /:id received-line edits.
  assert.ok(
    countOf(source, "stampProductsRestocked(client, {") >= 4,
    "all four stock-in paths must stamp the product"
  );

  // Stock leaving is not an arrival: a reversal must never float the product back up.
  const reversalStart = source.indexOf("const reverseReceivedPurchase = async (client,");
  assert.ok(reversalStart > 0, "reverseReceivedPurchase should still be findable");
  const reversalEnd = source.indexOf("\nrouter.get(", reversalStart);
  assert.ok(
    !source.slice(reversalStart, reversalEnd > 0 ? reversalEnd : undefined).includes("stampProductsRestocked"),
    "reversing a purchase must not stamp last_stocked_at"
  );
});

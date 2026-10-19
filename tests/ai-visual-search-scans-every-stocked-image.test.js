import test from "node:test";
import assert from "node:assert/strict";

import db from "../server/database/db.js";
import { searchAiVisualProductsPro, visualScanStockFilterSql } from "../server/services/aiVisualSearchProService.js";

// LIVE 2026-10-19: the photo index held 12,377 images (11,071 of shoes in stock) and the scan stopped
// at 2500, so a customer's photo of a shoe we had was never scored and came back "not found".

const TABLE_COLUMNS = {
  products: ["id", "tenant_id", "name", "slug", "status", "is_active"],
  product_variants: ["id", "product_id", "stock", "deleted_at"],
};

const withFakeDb = async (handler, fn) => {
  const originalQuery = db.query.bind(db);
  db.query = async (sql, params) => handler(String(sql), params || []);
  try {
    return await fn();
  } finally {
    db.query = originalQuery;
  }
};

const silenced = async (fn) => {
  const { log, info, warn } = console;
  console.log = console.info = console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, info, warn });
  }
};

const indexRow = (n) => ({
  id: n,
  tenant_id: 1,
  product_id: 1000 + n,
  variant_id: 5000 + n,
  product_name: `Adidas Samba ${n}`,
  brand: "Adidas",
  color: "white",
  image_url: `https://cdn.example/${n}.jpg`,
  stock: 3,
  price: 1500,
});

test("the photo scan scores every stocked, active image — no row cap", async () => {
  const scanSql = [];
  const rows = Array.from({ length: 3000 }, (_, i) => indexRow(i + 1));
  const search = await silenced(() => withFakeDb((sql, params) => {
    if (sql.includes("information_schema.columns")) {
      return { rows: (TABLE_COLUMNS[params[0]] || []).map((column_name) => ({ column_name })) };
    }
    if (sql.includes("FROM ai_product_image_visual_index idx")) {
      scanSql.push(sql);
      return { rows };
    }
    return { rows: [] };
  }, () => searchAiVisualProductsPro({ tenantId: 1, detected: { brand: "Adidas", model_guess: "Samba" }, limit: 5 })));

  assert.equal(scanSql.length, 1);
  const sql = scanSql[0];
  assert.doesNotMatch(sql, /\bLIMIT\b/i, "the scan must not cap the rows it scores");
  assert.doesNotMatch(sql, /2500/);
  assert.match(sql, /EXISTS \(\s*SELECT 1 FROM product_variants pv\s+WHERE pv\.product_id = p\.id/);
  assert.match(sql, /pv\.deleted_at IS NULL/);
  assert.match(sql, /pv\.stock > 0/);
  assert.match(sql, /COALESCE\(NULLIF\(LOWER\(TRIM\(p\.status::text\)\), ''\), 'active'\) = 'active'/);
  assert.match(sql, /p\.is_active IS DISTINCT FROM FALSE/);
  assert.equal(search.searchedCount, 3000, "every returned row is scored");
});

test("the stock filter only names columns the tables have", () => {
  const bare = visualScanStockFilterSql({ productColumns: new Set(["id"]), variantColumns: new Set(["id", "stock"]) });
  assert.match(bare, /pv\.stock > 0/);
  assert.doesNotMatch(bare, /deleted_at|p\.status|is_active/);
  assert.equal(visualScanStockFilterSql({}), "");
});

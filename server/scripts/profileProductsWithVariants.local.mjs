// LOCAL-ONLY profiler for GET /api/products/with-variants?pos=1.
// No database: the pool is replaced by an in-memory fake that returns synthetic rows
// shaped like production (699 products, ~9k variants, ~2 colours x ~6.5 sizes each).
// Run: node --cpu-prof --cpu-prof-dir=<dir> server/scripts/profileProductsWithVariants.local.mjs
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const PRODUCTS = Number(process.env.PROFILE_PRODUCTS || 699);
const COLOURS = 2;
const SIZES = ["36", "37", "38", "39", "40", "41", "42"];
const IMAGES_PER_COLOUR = 5;

const pad = (prefix, count) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}_extra_${i}`, i % 3 ? `value-${i}` : null]));
const productRows = [];
const variantRows = [];
const imageRows = [];
const colourRows = [];
let variantId = 1;
let imageId = 1;
for (let p = 1; p <= PRODUCTS; p += 1) {
  productRows.push({
    id: p, tenant_id: 1, name: `Product ${p}`, sku: `SKU-${p}`, barcode: `B${p}`, brand_id: (p % 12) + 1, brand_name: `Brand ${p % 12}`,
    category_id: 1, category_name: "Shoes", selling_price: 1500, sale_price: p % 4 ? 0 : 1200, sale_price_enabled: p % 4 === 0,
    variation_mode: "variants", product_type: "sneakers", grade: "mirror", gender: "men", is_active: true, status: "active",
    image_url: `/uploads/products/${p}.webp`, thumbnail_url: "", photo_url: "", image: "", gallery_images: [],
    active_variant_count: COLOURS * SIZES.length, total_variant_stock: 20, created_at: new Date(), updated_at: new Date(),
    description: "Lorem ipsum ".repeat(20), meta_title: `Product ${p}`, ...pad("p", 90),
  });
  for (let c = 0; c < COLOURS; c += 1) {
    const colour = ["Black", "White", "Grey"][c];
    const groupKey = `grp-${p}-${c}`;
    colourRows.push({ product_id: p, color_group_key: groupKey, color_name: colour, color_article_code: `A${p}${c}`, article_codes: [`A${p}${c}`] });
    for (let i = 0; i < IMAGES_PER_COLOUR; i += 1) {
      imageRows.push({ id: imageId++, product_id: p, variant_id: null, color_group_key: groupKey, color_name: colour, color_value: colour, image_url: `/uploads/v/${p}-${c}-${i}.webp`, sort_order: i, is_primary: i === 0, generated_by_ai: false, created_at: new Date() });
    }
    for (const size of SIZES) {
      variantRows.push({
        id: variantId, variant_id: variantId, product_id: p, color: colour, size, color_group_key: groupKey, color_sort_order: c,
        sku: `SKU-${p}-${c}-${size}`, barcode: `BV${variantId}`, stock: (variantId % 5), selling_price: 1500, sale_price: 0,
        cost_price: 700, purchase_price: 700, article_code: "", manufacturer_id: (p % 5) + 1, variant_manufacturer_id: (p % 5) + 1,
        variant_manufacturer_name: `Factory ${p % 5}`, manufacturer_name: `Factory ${p % 5}`, is_active: true, deleted_at: null,
        image_url: "", thermal_image_url: "", thermal_image_status: null, audience: "men", ...pad("v", 60),
      });
      variantId += 1;
    }
  }
}

const respond = (sql) => {
  if (/FROM products p[\s\S]*ORDER BY/i.test(sql) && /active_variant_count/.test(sql)) return productRows;
  if (/FROM product_variants v[\s\S]*ANY\(\$1::bigint\[\]\)/i.test(sql)) return variantRows;
  if (/FROM product_variant_images/i.test(sql)) return imageRows;
  if (/FROM product_color_groups/i.test(sql)) return colourRows;
  if (/information_schema\.columns/i.test(sql) && /'products'/.test(sql)) {
    return ["id", "tenant_id", "is_active", "deleted_at", "status"].map((column_name) => ({ column_name }));
  }
  return [];
};
const fakeQuery = async (q) => {
  const sql = typeof q === "string" ? q : q?.text || "";
  const rows = respond(sql);
  return { rows, rowCount: rows.length };
};
const fakeClient = { query: fakeQuery, release() {} };

const { default: pool } = await import("../database/db.js");
pool.query = fakeQuery;
pool.connect = async (cb) => {
  if (typeof cb === "function") { cb(null, fakeClient, () => {}); return undefined; }
  return fakeClient;
};

const { getProductsWithVariants } = await import("../controllers/productsController.js");

const runOnce = async (label) => {
  let stringifyMs = 0;
  let bytes = 0;
  let count = 0;
  const req = {
    method: "GET", originalUrl: "/api/products/with-variants?pos=1", url: "/api/products/with-variants?pos=1",
    query: { pos: "1" }, params: {}, headers: {},
    user: { id: 1, role: "admin", tenant_id: 1, tenantId: 1, isSuperAdmin: true }, tenantId: 1, tenant_id: 1,
  };
  const res = {
    statusCode: 200,
    set() { return this; },
    setHeader() { return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      const t = performance.now();
      const body = JSON.stringify(payload);
      stringifyMs = performance.now() - t;
      bytes = body.length;
      count = payload?.products?.length || 0;
      if (process.env.PROFILE_HASH) {
        // Key-order-independent fingerprint, so an optimisation can prove it changed no value.
        const canonical = (value) => {
          if (Array.isArray(value)) return value.map(canonical);
          if (value && typeof value === "object" && !(value instanceof Date)) {
            return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
          }
          return value;
        };
        const hash = createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
        process.stderr.write(`PROFILE hash=${hash}\n`);
      }
      return this;
    },
  };
  const t0 = performance.now();
  await getProductsWithVariants(req, res);
  process.stderr.write(`PROFILE ${label}: status=${res.statusCode} products=${count} total=${(performance.now() - t0).toFixed(0)}ms stringify=${stringifyMs.toFixed(0)}ms bytes=${bytes}\n`);
};

const quiet = () => {};
console.log = quiet;
console.info = quiet;
console.warn = quiet;
await runOnce("warmup");
await runOnce("run1");
await runOnce("run2");
process.exit(0);

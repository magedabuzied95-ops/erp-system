import test from "node:test";
import assert from "node:assert/strict";
import { projectPosCatalogProducts } from "../../server/controllers/productsController.js";

// The POS catalog (?pos=1) projection must keep every field the POS client consumes
// (pricing inputs, stock, ids, barcode/sku/article, colour/size, classification, images,
// favourite + search-meta) and drop only unused heavy fields (cost/purchase/supplier,
// descriptions/SEO, thermal, image galleries/arrays, timestamps). These tests pin that
// contract so a future edit can't silently drop a pricing/stock/filter field.

const sampleFull = [{
  id: 5, product_id: 5, name: "حذاء", product_name: "حذاء", variation_mode: "full_variations",
  brand_id: 2, brand: "Nike", brand_name: "Nike",
  category_id: 3, category: "أحذية", category_name: "أحذية",
  manufacturer_id: 7, gender: "men", product_type: "shoes", grade: "A",
  is_pos_favorite: true, is_offer_story: false,
  image_url: "u/p.jpg", product_image_url: "u/p.jpg", thumbnail_url: "u/t.jpg",
  regular_price: 500, current_selling_price: 500, purchase_selling_price: 480,
  sale_price: 400, sale_price_enabled: true, sale_start_at: "2026-08-01", sale_end_at: "2026-08-31",
  total_variant_stock: 12, active_variant_count: 3,
  matched_variant_id: 99, search_match_type: "barcode",
  // heavy / unused -> must be dropped:
  cost_price: 300, purchase_price: 290, wholesale_price: 310, tax_rate: 14, supplier_id: 1,
  description: "x".repeat(200), description_ar: "ي".repeat(200), seo_description: "s".repeat(100),
  meta_title: "t", slug: "shoe", canonical_slug: "shoe",
  gallery_images: [{ url: "g1" }, { url: "g2" }], color_images: [{ color: "red", images: [{}] }],
  thermal_image_url: "th", thermal_image_status: "done", created_at: "2020", updated_at: "2021", tenant_id: 1,
  variants: [{
    id: 99, variant_id: 99, product_id: 5, color: "أحمر", size: "42",
    sku: "SKU-1", barcode: "6221000000001", article_code: "ART-1", color_article_code: "CA-1",
    image_url: "u/v.jpg", variant_image_url: "u/v.jpg", product_image_url: "u/p.jpg", thumbnail_url: "u/t.jpg",
    regular_price: 500, current_selling_price: 500, purchase_selling_price: 480, price: 500,
    sale_price: 400, sale_price_enabled: true, stock: 4, low_stock_alert: 2,
    manufacturer_id: 7, variant_manufacturer_id: 7, audience: "men",
    // heavy / unused -> dropped:
    cost_price: 300, purchase_price: 290, wholesale_price: 310, supplier_id: 1,
    images: [{ url: "vi1" }, { url: "vi2" }], color_image_url: "u/c.jpg", primary_image_url: "u/pr.jpg",
    colorPrimaryImageUrl: "u/cp.jpg", thermal_image_url: "th", thermal_image_status: "done",
    created_at: "2020", updated_at: "2021", deleted_at: null, tenant_id: 1, branch_id: 2,
    purchase_pack_qty: 6, reorder_trigger_percent: 20, size_distribution_json: "{}",
  }],
}];

test("pos projection is a no-op unless the pos flag is truthy", () => {
  assert.equal(projectPosCatalogProducts(sampleFull, undefined), sampleFull);
  assert.equal(projectPosCatalogProducts(sampleFull, "0"), sampleFull);
});

test("pos projection KEEPS every pricing/stock/id/classification/image/scan field", () => {
  const [p] = projectPosCatalogProducts(sampleFull, "1");
  for (const k of [
    "id", "product_id", "name", "variation_mode",
    "brand_id", "category_id", "manufacturer_id", "gender", "product_type", "grade",
    "is_pos_favorite", "image_url", "product_image_url", "thumbnail_url",
    "regular_price", "current_selling_price", "purchase_selling_price",
    "sale_price", "sale_price_enabled", "sale_start_at", "sale_end_at",
    "total_variant_stock", "active_variant_count", "matched_variant_id", "search_match_type",
  ]) assert.ok(k in p, `product must keep ${k}`);

  const [v] = p.variants;
  for (const k of [
    "id", "variant_id", "product_id", "color", "size", "sku", "barcode", "article_code", "color_article_code",
    "image_url", "variant_image_url", "product_image_url",
    "regular_price", "current_selling_price", "purchase_selling_price", "price", "sale_price", "sale_price_enabled",
    "stock", "low_stock_alert", "manufacturer_id", "variant_manufacturer_id", "audience",
  ]) assert.ok(k in v, `variant must keep ${k}`);

  // values must be untouched (identical to source)
  assert.equal(p.current_selling_price, 500);
  assert.equal(v.sale_price, 400);
  assert.equal(v.stock, 4);
  assert.equal(v.barcode, "6221000000001");
});

test("pos projection DROPS heavy/unused fields (cost, description, thermal, galleries, timestamps)", () => {
  const [p] = projectPosCatalogProducts(sampleFull, "1");
  for (const k of [
    "cost_price", "purchase_price", "wholesale_price", "tax_rate", "supplier_id",
    "description", "description_ar", "seo_description", "meta_title", "slug", "canonical_slug",
    "gallery_images", "color_images", "thermal_image_url", "thermal_image_status",
    "created_at", "updated_at", "tenant_id",
  ]) assert.ok(!(k in p), `product must drop ${k}`);

  const [v] = p.variants;
  for (const k of [
    "cost_price", "purchase_price", "wholesale_price", "supplier_id",
    "images", "color_image_url", "primary_image_url", "colorPrimaryImageUrl",
    "thermal_image_url", "thermal_image_status", "created_at", "updated_at", "deleted_at",
    "tenant_id", "branch_id", "purchase_pack_qty", "reorder_trigger_percent", "size_distribution_json",
  ]) assert.ok(!(k in v), `variant must drop ${k}`);
});

import test from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { register } from "node:module";

import { isLeanCatalogRequest, projectPosCatalogProducts } from "../server/controllers/productsController.js";

// posProductsApi pulls the HTTP client through productsApi, which Node cannot load
// directly — the same test-only loader the POS tests use stubs that module and adds
// the .js extensions the src tree omits. Everything touched here is pure.
register("./helpers/pos-products-api-loader.mjs", import.meta.url);
const { normalizePosCatalogProduct, normalizePosSellableProducts } = await import(
  "../src/modules/pos/services/posProductsApi.js"
);

// The AI Inbox product picker used to ask for ?compact=1, a DENYLIST of ~19 fields
// (cost/description/SEO). That barely dented a payload dominated by the ~100 product
// and ~62 variant fields nobody reads, so the sheet still downloaded close to the full
// catalog.
//
// It can safely use the POS allowlist (?pos=1) instead, because the picker and the POS
// run the SAME client pipeline — getPosSellableProducts -> normalizePosSellableProducts
// -> normalizePosCatalogProduct — and that pipeline emits a CLOSED shape
// (buildProductFromVariants returns an explicit object, never a spread of the raw row).
// Any field the projection drops that normalization does not read is invisible to the
// UI by construction.
//
// This test is the gate on that claim: normalize(full) must be deep-equal to
// normalize(pos-projected). If someone ever trims POS_PRODUCT_KEEP_FIELDS in a way the
// picker cares about, this fails before a product card can render a wrong price, a
// missing colour, or a broken image.

const saleModeSettings = { sale_mode_enabled: true, sale_excluded_product_ids: [], sale_excluded_category_ids: [] };

// A row shaped like the real /products/with-variants response: everything the pipeline
// reads, plus a fat tail of fields ?compact=1 keeps and ?pos=1 drops.
const rawProducts = () => [
  {
    id: 5, product_id: 5, name: "حذاء رياضي", product_name: "حذاء رياضي",
    variation_mode: "full_variations", fixed_size_label: "",
    sku: "SKU-P5", product_sku: "SKU-P5", barcode: "6221000000005", product_barcode: "6221000000005",
    qr_token: "qr5", article_code: "ART-P5", articleCode: "ART-P5", color_article_code: "CA-P5",
    brand_id: 2, brand: "Nike", brand_name: "Nike",
    category_id: 3, category: "أحذية", category_name: "أحذية", category_path: "رجالي/أحذية",
    parent_category_id: 1,
    main_category_id: 1, main_category_name: "رجالي",
    sub_category_id: 3, sub_category_name: "أحذية",
    child_category_id: 8, child_category_name: "سنيكرز",
    subcategory: "سنيكرز", subcategory_name: "سنيكرز",
    gender: "men", product_type: "shoes", grade: "mirror",
    audiences: ["men"], product_audiences: ["men"],
    manufacturer_id: 7, manufacturer: "مصنع 7", manufacturer_name: "مصنع 7",
    image_url: "uploads/p5.jpg", product_image_url: "uploads/p5.jpg", thumbnail_url: "uploads/t5.jpg",
    cover_image_url: "uploads/p5.jpg", featured_image_url: "uploads/p5.jpg", main_image_url: "uploads/p5.jpg",
    regular_price: 2000, original_price: 2000, selling_price: 2000, price: 1750,
    current_selling_price: 2000, purchase_selling_price: 1900,
    sale_price: 1750, stored_sale_price: 1750, raw_sale_price: 1750, sale_price_enabled: true,
    sale_start_at: "2026-08-01", sale_end_at: "2026-12-31", sale_reason: "offer",
    is_offer_story: true, isOfferStory: true, is_offer: true, show_in_offers: true, promotion_enabled: true,
    is_pos_favorite: true, isPosFavorite: true,
    low_stock_threshold: 10, low_stock_alert: 10,
    total_variant_stock: 7, active_variant_count: 2, stock: 7, is_active: true, status: "active",
    matched_variant_id: 99, matched_color: "أحمر", matched_article: "ART-1", matched_sku: "SKU-1",
    search_match_type: "barcode",

    // ---- the fat tail ?compact=1 keeps and ?pos=1 drops ----
    slug: "sneaker", canonical_slug: "sneaker", meta_title: "t", seo_description: "s", seo_keywords: "k",
    description: "x".repeat(400), description_ar: "ي".repeat(400), description_en: "e".repeat(400),
    gallery_images: [{ url: "g1" }, { url: "g2" }, { url: "g3" }],
    color_images: [{ color: "أحمر", images: [{ image_url: "uploads/red.jpg" }] }],
    images_by_color: { "أحمر": "uploads/red.jpg" },
    thermal_image_url: "th", thermal_image_status: "done", thermal_artwork_json: "{}",
    created_at: "2020-01-01", updated_at: "2021-01-01", deleted_at: null, tenant_id: 1,
    warehouse_stock: [{ warehouse_id: 1, stock: 7 }],
    purchase_pack_qty: 6, reorder_trigger_percent: 20, size_distribution_json: "{}",
    notes: "n".repeat(200), internal_reference: "ref",

    variants: [
      {
        id: 99, variant_id: 99, product_id: 5, name: "حذاء رياضي", product_name: "حذاء رياضي",
        color: "أحمر", variant_color: "أحمر", color_group_key: "cg-red", colorGroupKey: "cg-red",
        size: "42", variant_size: "42",
        sku: "SKU-1", variant_sku: "SKU-1", barcode: "6221000000001", variant_barcode: "6221000000001",
        article_code: "ART-1", articleCode: "ART-1", variant_article_code: "ART-1",
        color_article_code: "CA-1", colorArticleCode: "CA-1", qr_token: "qr99",
        image_url: "uploads/v99.jpg", variant_image_url: "uploads/v99.jpg",
        product_image_url: "uploads/p5.jpg", thumbnail_url: "uploads/t99.jpg",
        regular_price: 2000, variant_regular_price: 2000, original_price: 2000, selling_price: 2000,
        price: 1750, current_selling_price: 2000, purchase_selling_price: 1900,
        sale_price: 1750, variant_sale_price: 1750, stored_sale_price: 1750, sale_price_enabled: true,
        sale_start_at: "2026-08-01", sale_end_at: "2026-12-31", sale_reason: "offer",
        stock: 4, variant_stock: 4, quantity: 4, low_stock_alert: 2, low_stock_threshold: 2,
        manufacturer_id: 7, variant_manufacturer_id: 7, manufacturer_name: "مصنع 7",
        audience: "men", gender: "men", product_type: "shoes", grade: "mirror",
        brand_id: 2, brand: "Nike", brand_name: "Nike", category_id: 3, category: "أحذية", category_name: "أحذية",
        is_pos_favorite: true, is_offer_story: true, is_offer: true, show_in_offers: true, promotion_enabled: true,

        // ---- fat tail ----
        cost_price: 1200, purchase_price: 1150, wholesale_price: 1300, supplier_id: 1, tax_rate: 14,
        images: [{ url: "vi1" }, { url: "vi2" }], gallery_images: [{ url: "vg1" }],
        color_image_url: "uploads/c99.jpg", primary_image_url: "uploads/pr99.jpg",
        thermal_image_url: "th", thermal_image_status: "done",
        created_at: "2020-01-01", updated_at: "2021-01-01", deleted_at: null,
        tenant_id: 1, branch_id: 2, purchase_pack_qty: 6, size_distribution_json: "{}",
      },
      {
        id: 100, variant_id: 100, product_id: 5, name: "حذاء رياضي", product_name: "حذاء رياضي",
        color: "أزرق", variant_color: "أزرق", color_group_key: "cg-blue", colorGroupKey: "cg-blue",
        size: "43", variant_size: "43",
        sku: "SKU-2", barcode: "6221000000002", article_code: "ART-2", color_article_code: "CA-2",
        image_url: "", variant_image_url: "", product_image_url: "uploads/p5.jpg", thumbnail_url: "",
        regular_price: 2200, original_price: 2200, selling_price: 2200, price: 2200,
        current_selling_price: 2200, purchase_selling_price: 2100,
        sale_price: 0, stored_sale_price: 0, sale_price_enabled: false,
        stock: 3, variant_stock: 3, quantity: 3, low_stock_alert: 2,
        manufacturer_id: 7, variant_manufacturer_id: 7, audience: "men",
        gender: "men", product_type: "shoes", grade: "mirror",
        brand_id: 2, brand: "Nike", brand_name: "Nike", category_id: 3, category: "أحذية",
        cost_price: 1400, description: "d".repeat(200), images: [{ url: "vi3" }],
        created_at: "2020-01-01", updated_at: "2021-01-01", tenant_id: 1,
      },
    ],
  },
];

// The picker's pipeline, verbatim: what searchCustomerProducts and
// loadCustomerProductCatalog both run over whatever the endpoint returned.
const pickerPipeline = (rows) =>
  normalizePosSellableProducts(rows, saleModeSettings).map((product) => normalizePosCatalogProduct(product));

test("the picker sees byte-identical products whether or not the POS projection ran", () => {
  const fromFull = pickerPipeline(rawProducts());
  const fromProjected = pickerPipeline(projectPosCatalogProducts(rawProducts(), "1"));
  assert.deepEqual(fromProjected, fromFull);
});

test("the projection actually removes the bulk it claims to", () => {
  const [projected] = projectPosCatalogProducts(rawProducts(), "1");
  for (const dropped of [
    "description", "description_ar", "seo_description", "gallery_images", "color_images",
    "images_by_color", "thermal_image_url", "created_at", "updated_at", "tenant_id",
    "warehouse_stock", "notes", "slug",
  ]) {
    assert.equal(dropped in projected, false, `product should not carry ${dropped}`);
  }
  for (const dropped of ["cost_price", "purchase_price", "supplier_id", "images", "gallery_images", "created_at"]) {
    assert.equal(dropped in projected.variants[0], false, `variant should not carry ${dropped}`);
  }
  const fullBytes = JSON.stringify(rawProducts()).length;
  const projectedBytes = JSON.stringify(projectPosCatalogProducts(rawProducts(), "1")).length;
  assert.ok(projectedBytes < fullBytes * 0.6, `expected a real cut, got ${projectedBytes}/${fullBytes}`);
});

test("cost data never reaches the inbox client", () => {
  const [projected] = projectPosCatalogProducts(rawProducts(), "1");
  const serialized = JSON.stringify(projected);
  for (const secret of ["cost_price", "purchase_price", "wholesale_price", "supplier_id"]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be serialized to the client`);
  }
});

test("pricing, stock, colour and image survive the projection", () => {
  const [product] = pickerPipeline(projectPosCatalogProducts(rawProducts(), "1"));
  assert.equal(product.price, 1750);
  assert.equal(product.min_price, 1750);
  assert.equal(product.total_stock, 7);
  assert.deepEqual(product.variants.map((v) => v.color), ["أحمر", "أزرق"]);
  assert.deepEqual(product.variants.map((v) => v.size), ["42", "43"]);
  assert.ok(product.variants[0].image_url.includes("v99.jpg"));
  // The blue variant carries no image of its own and must fall back to the product's,
  // exactly as it does without the projection.
  assert.equal(product.variants[1].image_url, product.variants[1].product_image_url);
  assert.equal(product.brand, "Nike");
  assert.equal(product.grade, "mirror");
  assert.deepEqual(product.audiences, ["men"]);
});

test("the picker asks for the POS allowlist, not the compact denylist", async () => {
  const { buildPickerParams } = await import("../src/modules/aiSupport/services/pickerQuery.js");
  const params = buildPickerParams({ search: "nike" });
  assert.equal(params.pos, 1);
  assert.equal("compact" in params, false);
});

// ---- the legacy ?compact=1 flag ------------------------------------------
//
// The denylist projection is deleted, but the PARAMETER survives as an alias. A phone
// still running a pre-`feebe62` bundle keeps sending ?compact=1, and if the server
// stopped recognising it those clients would get the FULL response — the rollout would
// make exactly the users we were fixing slower.

test("a stale client still sending ?compact=1 gets the lean payload, not the full one", () => {
  assert.equal(isLeanCatalogRequest({ compact: "1" }), true);
  assert.equal(isLeanCatalogRequest({ compact: 1 }), true);
  assert.equal(isLeanCatalogRequest({ compact: "true" }), true);
});

test("?pos=1 still selects the lean payload", () => {
  assert.equal(isLeanCatalogRequest({ pos: "1" }), true);
  assert.equal(isLeanCatalogRequest({ pos: true }), true);
});

test("the POS and admin default response is untouched", () => {
  assert.equal(isLeanCatalogRequest({}), false);
  assert.equal(isLeanCatalogRequest({ limit: "24" }), false);
});

test("an explicitly-off flag is off, so the colour build and the projection agree", () => {
  // The colour-image gate used to test req.query.pos for truthiness while the
  // projection parsed the value: ?pos=0 skipped the (expensive) colour build without
  // projecting, i.e. a response that paid nothing and kept everything.
  for (const off of ["0", "false", "no", "off", ""]) {
    assert.equal(isLeanCatalogRequest({ pos: off }), false, `pos=${off} must not be lean`);
    assert.equal(isLeanCatalogRequest({ compact: off }), false, `compact=${off} must not be lean`);
  }
});

test("the resolved boolean drives the projection the same way the string did", () => {
  assert.deepEqual(
    projectPosCatalogProducts(rawProducts(), isLeanCatalogRequest({ compact: "1" })),
    projectPosCatalogProducts(rawProducts(), "1")
  );
  assert.equal(projectPosCatalogProducts(rawProducts(), isLeanCatalogRequest({})).length, rawProducts().length);
  assert.ok("description" in projectPosCatalogProducts(rawProducts(), isLeanCatalogRequest({}))[0]);
});

test("the compact denylist is gone, not merely unused", () => {
  const controller = readFileSync(new URL("../server/controllers/productsController.js", import.meta.url), "utf8");
  for (const dead of ["PICKER_COMPACT_STRIP_FIELDS", "stripPickerFields", "projectCompactPickerProducts"]) {
    assert.equal(controller.includes(dead), false, `${dead} should have been deleted`);
  }
});

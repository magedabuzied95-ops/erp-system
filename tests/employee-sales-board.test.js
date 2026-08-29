import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { loadEmployeeSalesBoard } from "../server/services/salesOpportunityService.js";

const source = (path) => fs.readFile(path, "utf8");

// One aggregated colour row, shaped exactly like loadSalesBoardColorRows returns it.
const colorRow = ({
  productId,
  colorKey,
  color = "Black",
  productName = "Model",
  grade = "",
  gender = "",
  audienceText = null,
  isOffer = false,
  sizes = ["41", "42"],
  lastOneSizes = [],
  price = 1000,
  salePrice = 0,
} = {}) => ({
  product_id: String(productId),
  color_key: colorKey,
  product_name: productName,
  grade,
  gender,
  is_offer: isOffer,
  has_last_one: lastOneSizes.length > 0,
  color_stock: sizes.length * 3,
  product_image_url: "https://cdn.example/product.jpg",
  product_pricing: {
    selling_price: price,
    price,
    regular_price: price,
    purchase_selling_price: null,
    manual_selling_price: null,
    manual_price_override_active: false,
    sale_price: salePrice,
    is_offer_story: isOffer,
    use_custom_compare_price: false,
  },
  color,
  variant_image_url: "",
  representative_variant_id: String(productId * 100),
  variant_pricing: {
    selling_price: 0,
    price: 0,
    regular_price: 0,
    purchase_selling_price: null,
    manual_selling_price: null,
    manual_price_override_active: false,
    sale_price: 0,
  },
  sizes,
  last_one_sizes: lastOneSizes,
  audience_text: audienceText,
});

const board = (rows, query = {}) =>
  loadEmployeeSalesBoard({
    employee: { tenant_id: 1 },
    query,
    clientOrPool: { query: async () => ({ rows }) },
    // Global Sale Mode stays OFF, exactly as production runs it.
    saleModeSettings: { sale_mode_enabled: false },
  });

const ROWS = [
  colorRow({
    productId: 1,
    colorKey: "offer-black",
    productName: "Offer Sneaker",
    color: "Black",
    grade: "مستورد فيتنامي",
    gender: "men",
    isOffer: true,
    sizes: ["41", "42", "43"],
    price: 1800,
    salePrice: 1500,
  }),
  colorRow({
    productId: 2,
    colorKey: "lastone-brown",
    productName: "Last Piece Sneaker",
    color: "Brown",
    grade: "ميرور اوريجينال",
    gender: "men",
    audienceText: "women",
    sizes: ["38", "39", "40"],
    lastOneSizes: ["39"],
    price: 800,
  }),
  colorRow({
    productId: 3,
    colorKey: "wildcard-white",
    productName: "Unclassified Sneaker",
    color: "White",
    grade: "local",
    sizes: ["44"],
    lastOneSizes: ["44"],
    price: 600,
  }),
];

test("the board carries both kinds the owner asked for: العروض and stock-of-one", async () => {
  const result = await board(ROWS);
  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.offers, 1);
  assert.equal(result.counts.last_one, 2);
  assert.deepEqual(
    result.items.map((item) => item.kind),
    ["offer", "last_one", "last_one"]
  );
});

test("an offer prices at its sale price with the global Sale Mode toggle OFF", async () => {
  const result = await board(ROWS);
  const offer = result.items.find((item) => item.is_offer);
  assert.equal(offer.price, 1500);
  assert.equal(offer.compare_price, 1800);
  assert.equal(offer.offer_price_applied, true);

  const lastOne = result.items.find((item) => !item.is_offer);
  assert.equal(lastOne.price, 800);
  assert.equal(lastOne.compare_price, 0);
});

test("the size filter matches every size of an offer but only the last-piece size of a running-out model", async () => {
  // 41 is an offer size and belongs to no last-piece card.
  const offerSize = await board(ROWS, { size: "41" });
  assert.deepEqual(offerSize.items.map((item) => item.product_id), [1]);

  // 39 is the size that actually has one left.
  const lastOneSize = await board(ROWS, { size: "39" });
  assert.deepEqual(lastOneSize.items.map((item) => item.product_id), [2]);

  // 38 is in stock on that same colour but is NOT the opportunity — the card
  // would otherwise claim a last piece in a size that has plenty.
  const stockedSize = await board(ROWS, { size: "38" });
  assert.equal(stockedSize.counts.total, 0);
});

test("الجمهور comes from the colour first, then the product, and nothing at all stays a wildcard", async () => {
  const women = await board(ROWS, { audience: "women" });
  // Product 2 carries audience=women on the colour even though the product says men.
  // Product 3 resolves to nothing at all, so it matches every audience.
  assert.deepEqual(women.items.map((item) => item.product_id), [2, 3]);

  const men = await board(ROWS, { audience: "men" });
  assert.deepEqual(men.items.map((item) => item.product_id), [1, 3]);

  const kids = await board(ROWS, { audience: "kids" });
  assert.deepEqual(kids.items.map((item) => item.product_id), [3]);
});

test("الفئة buckets free-text grades into مستورد فيتنامي / ميرور / محل", async () => {
  const result = await board(ROWS);
  assert.deepEqual(
    result.items.map((item) => [item.grade_key, item.grade_label]),
    [
      ["imported_vietnam", "مستورد فيتنامي"],
      ["mirror_original", "ميرور"],
      ["egyptian", "محل"],
    ]
  );

  const mirror = await board(ROWS, { grade: "mirror_original" });
  assert.deepEqual(mirror.items.map((item) => item.product_id), [2]);
});

test("the dropdowns keep every option while a filter is applied", async () => {
  const filtered = await board(ROWS, { size: "39", audience: "women", grade: "mirror_original" });
  assert.equal(filtered.counts.total, 1);
  // Facets are built off the full candidate set, so narrowing one dropdown can
  // never empty the others. The size list offers only sizes the filter can
  // actually match — 38 and 40 sit on a last-piece colour without being the
  // last piece, so picking them would return nothing.
  assert.deepEqual(filtered.facets.sizes, ["39", "41", "42", "43", "44"]);
  assert.deepEqual(
    filtered.facets.audiences.map((option) => option.value),
    ["men", "women", "kids"]
  );
  assert.deepEqual(
    filtered.facets.grades.map((option) => option.value),
    ["imported_vietnam", "mirror_original", "egyptian"]
  );
});

test("sizes are ordered numerically, not as text", async () => {
  const result = await board(
    [colorRow({ productId: 9, colorKey: "wide", sizes: ["9", "10", "38"], lastOneSizes: ["10"] })],
    {}
  );
  assert.deepEqual(result.items[0].sizes, ["9", "10", "38"]);
  assert.deepEqual(result.facets.sizes, ["10"]);
});

test("the list pages instead of shipping the whole catalogue to a phone", async () => {
  const first = await board(ROWS, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.has_more, true);
  assert.equal(first.counts.total, 3);

  const second = await board(ROWS, { limit: 2, page: 2 });
  assert.equal(second.items.length, 1);
  assert.equal(second.has_more, false);
});

test("the card explains the opportunity in Arabic", async () => {
  const result = await board(ROWS);
  const [offer, lastOne] = result.items;
  assert.equal(offer.message, "Offer Sneaker - Black ضمن العروض الآن.");
  assert.equal(lastOne.message, "باقي آخر قطعة مقاس 39 من Last Piece Sneaker - Brown.");

  const twoSizes = await board([
    colorRow({ productId: 4, colorKey: "two", productName: "Pair", color: "Red", sizes: ["41", "42"], lastOneSizes: ["41", "42"] }),
  ]);
  assert.equal(twoSizes.items[0].message, "باقي آخر قطعة في المقاسات 41، 42 من Pair - Red.");
});

test("the board reads variant stock, the column the rest of the portal reads", async () => {
  const service = await source("server/services/salesOpportunityService.js");
  const boardQuery = service.slice(service.indexOf("const loadSalesBoardColorRows"));
  assert.match(boardQuery, /JOIN product_variants v ON v\.product_id = p\.id/);
  assert.match(boardQuery, /COALESCE\(v\.stock, 0\) > 0/);
  assert.match(boardQuery, /HAVING bool_or\(is_offer\) OR bool_or\(stock = 1\)/);
  // The branch-scoped warehouse_inventory path belongs to the push sync above,
  // not to the board.
  assert.doesNotMatch(boardQuery, /warehouse_inventory/);
});

test("the push-notification sync survives a warehouse_inventory without tenant_id", async () => {
  const service = await source("server/services/salesOpportunityService.js");
  assert.match(service, /inventoryHasTenantId = inventoryColumns\.has\("tenant_id"\)/);
  assert.match(service, /WHERE \$\{inventoryTenantClause\}/);
  assert.doesNotMatch(service, /WHERE \(\$1::bigint IS NULL OR wi\.tenant_id = \$1::bigint\)/);
});

test("the portal renders the board behind three dropdowns and still triggers the sync", async () => {
  const [page, routes, api] = await Promise.all([
    source("src/modules/employees/pages/EmployeePayrollPortal.jsx"),
    source("server/routes/employeePortal.js"),
    source("src/modules/employees/services/salesOpportunitiesApi.js"),
  ]);
  assert.match(routes, /router\.get\("\/:token\/sales-board"/);
  assert.match(api, /\/sales-board/);
  assert.match(page, /salesBoardFilters\.size/);
  assert.match(page, /salesBoardFilters\.audience/);
  assert.match(page, /salesBoardFilters\.grade/);
  assert.match(page, /<SalesBoardFilter/);
  // getEmployeeSalesOpportunities is still called: it is what runs the sync that
  // emits the "فرصة بيع" push.
  assert.match(page, /getEmployeeSalesOpportunities\(token/);
});

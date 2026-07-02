import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const normalize = (value = "") =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064b-\u065f\u0640]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const card = (overrides = {}) => ({
  id: overrides.id || overrides.product_id || overrides.variant_id || overrides.title || overrides.name,
  product_id: overrides.product_id || overrides.id || overrides.title || overrides.name,
  name: overrides.name || overrides.title || "Product",
  title: overrides.title || overrides.name || "Product",
  brand: overrides.brand || "",
  category: overrides.category || "",
  model_name: overrides.model_name || "",
  variant_id: overrides.variant_id || "",
  selected_variant_id: overrides.selected_variant_id || overrides.variant_id || "",
  matched_variant_id: overrides.matched_variant_id || overrides.variant_id || "",
  color: overrides.color || "",
  selected_color: overrides.selected_color || overrides.color || "",
  selected_variant: overrides.selected_variant || {},
  variant: overrides.variant || {},
  matched_variant: overrides.matched_variant || {},
  total_stock: overrides.total_stock ?? 1,
  stock: overrides.stock ?? 1,
  availability: overrides.availability || "available",
  stock_status: overrides.stock_status || "available",
  ...overrides,
});

const tokenMatch = (source = "", needle = "") => {
  const haystack = normalize(source);
  const target = normalize(needle);
  return Boolean(haystack && target && haystack.includes(target));
};

const applyDesiredMatrix = ({ products = [], rejection = {} } = {}) =>
  products.filter((product) => {
    const productId = String(product.id || product.product_id || "");
    const variantIds = [
      product.variant_id,
      product.selected_variant_id,
      product.matched_variant_id,
      product.variant?.id,
      product.selected_variant?.id,
      product.matched_variant?.id,
    ].map((value) => String(value || "")).filter(Boolean);
    const variantTokens = [
      product.color,
      product.selected_color,
      product.selected_variant?.color,
      product.selected_variant?.color_name,
      product.selected_variant?.color_value,
      product.matched_variant?.color,
      product.matched_variant?.color_name,
      product.matched_variant?.color_value,
    ].map((value) => String(value || "")).filter(Boolean);
    const productBlob = [
      product.name,
      product.title,
      product.brand,
      product.category,
      product.model_name,
      product.base_name,
      product.slug,
    ].join(" ");

    const rejectedVariantIds = new Set((rejection.rejectedVariantIds || []).map(String));
    const rejectedVariantNames = (rejection.rejectedVariantNames || []).map(normalize).filter(Boolean);
    const rejectedVariantColors = (rejection.rejectedVariantColors || []).map(normalize).filter(Boolean);
    const rejectedProductIds = new Set((rejection.rejectedProductIds || []).map(String));
    const rejectedModelNames = (rejection.rejectedModelNames || []).map(normalize).filter(Boolean);
    const rejectedBrandNames = (rejection.rejectedBrandNames || rejection.rejectedBrand || []).flat ? (rejection.rejectedBrandNames || rejection.rejectedBrand || []).map(normalize).filter(Boolean) : [normalize(rejection.rejectedBrandNames || rejection.rejectedBrand || "")].filter(Boolean);
    const rejectedCategoryNames = (rejection.rejectedCategoryNames || rejection.rejectedCategory || []).flat ? (rejection.rejectedCategoryNames || rejection.rejectedCategory || []).map(normalize).filter(Boolean) : [normalize(rejection.rejectedCategoryNames || rejection.rejectedCategory || "")].filter(Boolean);

    if (variantIds.some((value) => rejectedVariantIds.has(value))) return false;
    if (variantTokens.some((value) => rejectedVariantNames.some((needle) => tokenMatch(value, needle) || tokenMatch(needle, value)))) return false;
    if (variantTokens.some((value) => rejectedVariantColors.some((needle) => tokenMatch(value, needle)))) return false;
    if (productId && rejectedProductIds.has(productId)) return false;
    if (rejectedModelNames.some((needle) => tokenMatch(productBlob, needle))) return false;
    if (rejectedBrandNames.some((needle) => tokenMatch(product.brand, needle) || tokenMatch(productBlob, needle))) return false;
    if (rejectedCategoryNames.some((needle) => tokenMatch(product.category, needle) || tokenMatch(productBlob, needle))) return false;
    return true;
  });

const matrixCases = [
  {
    level: 1,
    name: "Variant rejection",
    rejection: {
      rejectedVariantIds: ["v-grey"],
      rejectedVariantNames: ["Grey"],
      rejectedVariantColors: ["Grey"],
    },
    products: [
      card({ id: "p1-black", product_id: "p1", title: "Adidas Terrex X Goretex-2 Black", name: "Adidas Terrex X Goretex-2", brand: "Adidas", category: "Running", model_name: "Terrex", variant_id: "v-black", color: "Black", selected_variant_id: "v-black" }),
      card({ id: "p1-grey", product_id: "p1", title: "Adidas Terrex X Goretex-2 Grey", name: "Adidas Terrex X Goretex-2", brand: "Adidas", category: "Running", model_name: "Terrex", variant_id: "v-grey", color: "Grey", selected_variant_id: "v-grey" }),
      card({ id: "p2", product_id: "p2", title: "Adidas Running Pro", name: "Adidas Running Pro", brand: "Adidas", category: "Running", model_name: "Running Pro", variant_id: "v-run", color: "Black" }),
    ],
    expectedKept: ["p1-black", "p2"],
  },
  {
    level: 2,
    name: "Product rejection",
    rejection: {
      rejectedProductIds: ["p1-black"],
    },
    products: [
      card({ id: "p1-black", product_id: "p1-black", title: "Nike Dunk Low Black", name: "Nike Dunk Low Black", brand: "Nike", category: "Casual", model_name: "Dunk", variant_id: "v-black" }),
      card({ id: "p1-grey", product_id: "p1-grey", title: "Nike Dunk Low Grey", name: "Nike Dunk Low Grey", brand: "Nike", category: "Casual", model_name: "Dunk", variant_id: "v-grey" }),
      card({ id: "p2", product_id: "p2", title: "Nike Air Max", name: "Nike Air Max", brand: "Nike", category: "Running", model_name: "Air Max" }),
    ],
    expectedKept: ["p1-grey", "p2"],
  },
  {
    level: 3,
    name: "Model rejection",
    rejection: {
      rejectedModelNames: ["Terrex"],
    },
    products: [
      card({ id: "terrex-black", product_id: "terrex-black", title: "Adidas Terrex X Goretex-2 Black", name: "Adidas Terrex X Goretex-2", brand: "Adidas", category: "Running", model_name: "Terrex", variant_id: "v-black" }),
      card({ id: "terrex-grey", product_id: "terrex-grey", title: "Adidas Terrex X Goretex-2 Grey", name: "Adidas Terrex X Goretex-2", brand: "Adidas", category: "Running", model_name: "Terrex", variant_id: "v-grey" }),
      card({ id: "adidas-run", product_id: "adidas-run", title: "Adidas Black White Running Sneakers", name: "Adidas Black White Running Sneakers", brand: "Adidas", category: "Running", model_name: "Running Sneakers" }),
      card({ id: "nike-run", product_id: "nike-run", title: "Nike Running Pro", name: "Nike Running Pro", brand: "Nike", category: "Running", model_name: "Running Pro" }),
    ],
    expectedKept: ["adidas-run", "nike-run"],
  },
  {
    level: 4,
    name: "Brand rejection",
    rejection: {
      rejectedBrand: ["Adidas"],
      rejectedBrandNames: ["Adidas"],
    },
    products: [
      card({ id: "adidas-terrex", product_id: "adidas-terrex", title: "Adidas Terrex X Goretex-2", name: "Adidas Terrex X Goretex-2", brand: "Adidas", category: "Running", model_name: "Terrex" }),
      card({ id: "adidas-run", product_id: "adidas-run", title: "Adidas Running Pro", name: "Adidas Running Pro", brand: "Adidas", category: "Running", model_name: "Running Pro" }),
      card({ id: "nike-run", product_id: "nike-run", title: "Nike Running Pro", name: "Nike Running Pro", brand: "Nike", category: "Running", model_name: "Running Pro" }),
    ],
    expectedKept: ["nike-run"],
  },
  {
    level: 5,
    name: "Category rejection",
    rejection: {
      rejectedCategory: ["Running"],
      rejectedCategoryNames: ["Running"],
    },
    products: [
      card({ id: "adidas-running", product_id: "adidas-running", title: "Adidas Running Pro", name: "Adidas Running Pro", brand: "Adidas", category: "Running", model_name: "Running Pro" }),
      card({ id: "nike-running", product_id: "nike-running", title: "Nike Running Pro", name: "Nike Running Pro", brand: "Nike", category: "Running", model_name: "Running Pro" }),
      card({ id: "casual-white", product_id: "casual-white", title: "Casual White Leather", name: "Casual White Leather", brand: "Generic", category: "Casual", model_name: "Leather" }),
    ],
    expectedKept: ["casual-white"],
  },
];

for (const testCase of matrixCases) {
  const actual = applyDesiredMatrix(testCase).map((product) => String(product.id || product.product_id || ""));
  assert.deepEqual(actual, testCase.expectedKept, `${testCase.name} should keep only the expected products`);
}

const harnessPath = path.resolve("server/routes/aiRegressionHarness.js");
const harnessSource = fs.readFileSync(harnessPath, "utf8");

const currentCoverage = {
  hasRejectContextMatchesProduct: /const\s+rejectContextMatchesProduct\s*=\s*\(/.test(harnessSource),
  usesRejectedProductIds: /rejectedProductIds/.test(harnessSource),
  usesRejectedModelNames: /rejectedModelNames/.test(harnessSource),
  usesRejectedVariant: /rejectedVariant/.test(harnessSource),
  usesRejectedBrand: /rejectedBrand/.test(harnessSource),
  usesRejectedCategory: /rejectedCategory/.test(harnessSource),
};

console.log("AI rejection matrix spec passed");
console.log(JSON.stringify({ currentCoverage }, null, 2));


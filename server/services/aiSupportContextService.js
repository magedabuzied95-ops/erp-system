import db from "../database/db.js";
import { getWebsiteSettings } from "./liveActivityService.js";

const PRODUCT_LIMIT = 6;
const VARIANT_LIMIT = 12;
const SOURCE_TEXT_LIMIT = 4_000;
const DEBUG_PRODUCT_CONTEXT =
  process.env.AI_SUPPORT_DEBUG === "1" || process.env.NODE_ENV !== "production";

const PRODUCT_INTENT_TERMS = [
  "product",
  "item",
  "sku",
  "barcode",
  "color",
  "colour",
  "size",
  "stock",
  "available",
  "availability",
  "price",
  "discount",
  "sale",
  "similar",
  "بديل",
  "متاح",
  "مقاس",
  "لون",
  "سعر",
  "خصم",
  "منتج",
];

const STORE_INTENT_TERMS = [
  "branch",
  "store",
  "hours",
  "working",
  "open",
  "close",
  "address",
  "phone",
  "shipping",
  "delivery",
  "return",
  "exchange",
  "refund",
  "payment",
  "policy",
  "\u0641\u0631\u0639",
  "\u0641\u0631\u0648\u0639",
  "\u0639\u0646\u0648\u0627\u0646",
  "\u0645\u0648\u0627\u0639\u064a\u062f",
  "\u0633\u0627\u0639\u0627\u062a",
  "\u0639\u0645\u0644",
  "\u0645\u0641\u062a\u0648\u062d",
  "\u0645\u0642\u0641\u0648\u0644",
  "\u0634\u062d\u0646",
  "\u062a\u0648\u0635\u064a\u0644",
  "\u0627\u0633\u062a\u0631\u062c\u0627\u0639",
  "\u0627\u0633\u062a\u0628\u062f\u0627\u0644",
  "\u062f\u0641\u0639",
  "\u0633\u064a\u0627\u0633\u0629",
  "\u0648\u0627\u062a\u0633",
  "\u062a\u0644\u064a\u0641\u0648\u0646",
  "\u0645\u0648\u0628\u0627\u064a\u0644",
  "فرع",
  "عنوان",
  "شحن",
  "توصيل",
  "استرجاع",
  "استبدال",
  "دفع",
  "سياسة",
];

const INTERNAL_INTENT_TERMS = [
  "admin",
  "supplier",
  "cost",
  "wholesale",
  "profit",
  "margin",
  "inventory movement",
  "internal",
  "password",
  "token",
  "secret",
  "api key",
  "customer data",
  "بيانات عميل",
  "مورد",
  "تكلفة",
  "هامش",
  "داخلي",
];

const CONVERSATIONAL_RESPONSE_SETS = Object.freeze({
  greeting: [
    "\u0623\u0647\u0644\u0627\u064b \u0628\u064a\u0643 \u2764\ufe0f \u0625\u0632\u0627\u064a \u0623\u0642\u062f\u0631 \u0623\u0633\u0627\u0639\u062f\u0643\u061f",
    "\u0645\u0646\u0648\u0631\u0646\u0627 \u2728 \u062a\u062d\u0628 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0645\u0646\u062a\u062c \u0623\u0648 \u0627\u0633\u062a\u0641\u0633\u0627\u0631 \u0645\u0639\u064a\u0646\u061f",
  ],
  thanks: [
    "\u0627\u0644\u0639\u0641\u0648 \u2764\ufe0f \u062a\u062d\u0628 \u0623\u0633\u0627\u0639\u062f\u0643 \u0641\u064a \u0623\u064a \u062d\u0627\u062c\u0629 \u062a\u0627\u0646\u064a\u0629\u061f",
    "\u062a\u062d\u062a \u0623\u0645\u0631\u0643 \u2728 \u0644\u0648 \u0639\u0646\u062f\u0643 \u0623\u064a \u0633\u0624\u0627\u0644 \u0627\u0628\u0639\u062a\u0644\u064a.",
  ],
  goodbye: [
    "\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629 \u2764\ufe0f \u0645\u0633\u062a\u0646\u064a\u064a\u0646\u0643 \u0623\u064a \u0648\u0642\u062a.",
    "\u064a\u0648\u0645\u0643 \u062c\u0645\u064a\u0644 \u2728 \u0644\u0648 \u0627\u062d\u062a\u062c\u062a \u0623\u064a \u0645\u0633\u0627\u0639\u062f\u0629 \u0627\u0628\u0639\u062a\u0644\u0646\u0627.",
  ],
  help: [
    "\u062a\u062d\u062a \u0623\u0645\u0631\u0643 \u2728 \u0627\u0628\u0639\u062a\u0644\u064a \u0633\u0624\u0627\u0644\u0643 \u0648\u0647\u062d\u0627\u0648\u0644 \u0623\u0633\u0627\u0639\u062f\u0643.",
    "\u0623\u0643\u064a\u062f \u2764\ufe0f \u0642\u0648\u0644\u064a \u062a\u062d\u0628 \u062a\u0633\u0623\u0644 \u0639\u0646 \u0625\u064a\u0647\u061f",
  ],
});

const CONVERSATIONAL_PATTERNS = Object.freeze({
  greeting: [
    "hi",
    "hello",
    "hey",
    "good morning",
    "good evening",
    "\u0647\u0627\u064a",
    "\u0647\u0627\u0649",
    "\u0647\u0644\u0627",
    "\u0627\u0647\u0644\u0627",
    "\u0623\u0647\u0644\u0627",
    "\u0627\u0644\u0633\u0644\u0627\u0645 \u0639\u0644\u064a\u0643\u0645",
    "\u0635\u0628\u0627\u062d \u0627\u0644\u062e\u064a\u0631",
    "\u0645\u0633\u0627\u0621 \u0627\u0644\u062e\u064a\u0631",
    "\u0627\u0632\u064a\u0643",
    "\u0627\u0632\u064a\u0643\u0645",
    "\u0627\u0632\u064a\u0643\u0648",
    "\u0639\u0627\u0645\u0644 \u0627\u064a\u0647",
    "\u0639\u0627\u0645\u0644\u0647 \u0627\u064a\u0647",
    "\u0639\u0627\u0645\u0644\u064a\u0646 \u0627\u064a\u0647",
  ],
  thanks: [
    "thanks",
    "thank you",
    "\u0634\u0643\u0631\u0627",
    "\u0645\u062a\u0634\u0643\u0631",
    "\u0645\u062a\u0634\u0643\u0631\u0629",
    "\u062a\u0633\u0644\u0645",
    "\u062a\u0633\u0644\u0645\u064a",
    "\u0645\u064a\u0631\u0633\u064a",
  ],
  goodbye: [
    "bye",
    "goodbye",
    "see you",
    "\u0628\u0627\u064a",
    "\u0645\u0639 \u0627\u0644\u0633\u0644\u0627\u0645\u0629",
    "\u0633\u0644\u0627\u0645",
  ],
  help: [
    "help",
    "can you help",
    "i need help",
    "\u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u0645\u0643\u0646 \u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u062d\u062a\u0627\u062c \u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u062d\u062a\u0627\u062c\u0629 \u0645\u0633\u0627\u0639\u062f\u0629",
    "\u0645\u0645\u0643\u0646 \u062a\u0633\u0627\u0639\u062f\u0646\u064a",
    "\u0639\u0627\u064a\u0632 \u0627\u0633\u0627\u0644",
    "\u0639\u0627\u064a\u0632\u0629 \u0627\u0633\u0627\u0644",
    "\u0639\u0646\u062f\u064a \u0633\u0624\u0627\u0644",
    "\u0645\u0645\u0643\u0646 \u0627\u0633\u0627\u0644",
  ],
});

const CONVERSATIONAL_FILLER_TERMS = new Set([
  "please",
  "\u0644\u0648\u0633\u0645\u062d\u062a",
  "\u0644\u0648",
  "\u0633\u0645\u062d\u062a",
  "\u064a\u0627",
  "\u062c\u0645\u0627\u0639\u0629",
  "\u0645\u0646",
  "\u0641\u0636\u0644\u0643",
]);

const COLOR_TERMS = [
  "black",
  "white",
  "red",
  "blue",
  "green",
  "yellow",
  "pink",
  "purple",
  "brown",
  "beige",
  "gray",
  "grey",
  "orange",
  "navy",
  "ذهبي",
  "فضي",
  "اسود",
  "أسود",
  "ابيض",
  "أبيض",
  "احمر",
  "أحمر",
  "ازرق",
  "أزرق",
  "اخضر",
  "أخضر",
  "بيج",
  "رمادي",
  "بني",
];

const SIZE_PATTERN = /\b(3[0-9]|4[0-9]|5[0-5]|xs|s|m|l|xl|xxl|xxxl|small|medium|large|one size)\b/i;
const CODE_PATTERN = /\b[A-Z0-9][A-Z0-9._-]{2,}\b/gi;

const columnCache = new Map();

const toText = (value, fallback = "") => String(value ?? fallback).trim();

const compactText = (value, limit = SOURCE_TEXT_LIMIT) => toText(value).replace(/\s+/g, " ").slice(0, limit);

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const deepFindValue = (source, candidateKeys = []) => {
  const keys = new Set(candidateKeys.map((key) => String(key).toLowerCase()));
  const seen = new Set();
  const visit = (value) => {
    if (!isObject(value) && !Array.isArray(value)) return "";
    if (seen.has(value)) return "";
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== "") return found;
      }
      return "";
    }
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(String(key).toLowerCase()) && item !== undefined && item !== null && item !== "") return item;
    }
    for (const item of Object.values(value)) {
      const found = visit(item);
      if (found !== "") return found;
    }
    return "";
  };
  return visit(source);
};

const normalizePublicValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizePublicValue).filter((item) => item !== "");
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, normalizePublicValue(item)])
        .filter(([, item]) => item !== "" && !(Array.isArray(item) && item.length === 0))
    );
  }
  return toText(value);
};

const firstConfigured = (...values) => {
  for (const value of values) {
    const normalized = normalizePublicValue(value);
    if (Array.isArray(normalized) && normalized.length) return normalized;
    if (isObject(normalized) && Object.keys(normalized).length) return normalized;
    if (toText(normalized)) return normalized;
  }
  return "";
};

const safeJsonParse = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const numeric = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const money = (value) => {
  const amount = numeric(value, 0);
  return Number.isFinite(amount) ? amount : 0;
};

const unique = (items = []) => [...new Set(items.map((item) => toText(item)).filter(Boolean))];

const q = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;

const getColumns = async (tableName) => {
  if (columnCache.has(tableName)) return columnCache.get(tableName);
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
    `,
    [tableName]
  );
  const columns = new Set(result.rows.map((row) => row.column_name));
  columnCache.set(tableName, columns);
  return columns;
};

const pickColumn = (columns, candidates) => candidates.find((column) => columns.has(column)) || null;

const columnExpr = (alias, columns, candidates, fallback = "NULL") => {
  const column = pickColumn(columns, candidates);
  return column ? `${alias}.${column}` : fallback;
};

const columnList = (alias, columns, candidates) =>
  candidates.filter((column) => columns.has(column)).map((column) => `${alias}.${column}`);

const variantTenantClause = (variantColumns, alias = "pv") =>
  variantColumns.has("tenant_id") ? `AND (${alias}.tenant_id = p.tenant_id OR ${alias}.tenant_id IS NULL)` : "";

const debugProductSearch = (message, payload = {}) => {
  if (!DEBUG_PRODUCT_CONTEXT) return;
  console.debug(`[ai-support product-context] ${message}`, payload);
};

const hasAnyTerm = (message, terms) => {
  const text = message.toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
};

const normalizeConversationalText = (value = "") =>
  toText(value)
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[إأآ]/g, "\u0627")
    .replace(/ى/g, "\u064a")
    .replace(/ؤ/g, "\u0648")
    .replace(/ئ/g, "\u064a")
    .replace(/ة/g, "\u0647")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const detectConversationalSubtype = (message = "") => {
  const normalized = normalizeConversationalText(message);
  if (!normalized || normalized.length > 120) return "";
  if (hasAnyTerm(message, [...PRODUCT_INTENT_TERMS, ...STORE_INTENT_TERMS, ...INTERNAL_INTENT_TERMS])) return "";
  if (unique(toText(message).match(CODE_PATTERN) || []).length) return "";
  if (SIZE_PATTERN.test(message)) return "";

  for (const [subtype, patterns] of Object.entries(CONVERSATIONAL_PATTERNS)) {
    const normalizedPatterns = patterns.map(normalizeConversationalText);
    if (normalizedPatterns.some((pattern) => normalized === pattern)) return subtype;

    const containsSafePhrase = normalizedPatterns.some((pattern) => {
      if (!pattern || !normalized.includes(pattern)) return false;
      const remainingWords = normalized
        .replace(pattern, " ")
        .split(/\s+/)
        .filter(Boolean);
      return remainingWords.length <= 3 && remainingWords.every((word) => CONVERSATIONAL_FILLER_TERMS.has(word));
    });
    if (containsSafePhrase) return subtype;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 4 && words.every((word) => CONVERSATIONAL_FILLER_TERMS.has(word))) return "help";

  return "";
};

export const detectAiSupportIntent = (message = "") => {
  const text = toText(message);
  const lower = text.toLowerCase();
  const codes = unique(text.match(CODE_PATTERN) || []).slice(0, 5);
  const colors = COLOR_TERMS.filter((color) => lower.includes(color.toLowerCase())).slice(0, 4);
  const sizeMatch = text.match(SIZE_PATTERN);
  const asksSimilar = /similar|alternative|like this|بديل|مشابه/i.test(text);
  const asksAvailability = /stock|available|availability|متاح|موجود|كمية/i.test(text);
  const asksPrice = /price|cost|سعر|بكام|كم/i.test(text);
  const isInternal = hasAnyTerm(text, INTERNAL_INTENT_TERMS);
  const conversationalSubtype = isInternal ? "" : detectConversationalSubtype(text);
  const isStore = hasAnyTerm(text, STORE_INTENT_TERMS);
  const isProduct = isInternal
    ? false
    : hasAnyTerm(text, PRODUCT_INTENT_TERMS) || codes.length > 0 || colors.length > 0 || Boolean(sizeMatch);

  return {
    type: isInternal ? "internal_data" : conversationalSubtype ? "conversational" : isProduct ? "product" : isStore ? "store_policy" : "general",
    conversational: {
      subtype: conversationalSubtype,
    },
    product: {
      codes,
      colors,
      size: sizeMatch?.[0] || "",
      asksSimilar,
      asksAvailability,
      asksPrice,
    },
  };
};

const buildProductConditions = ({ productColumns, variantColumns, terms, codes, includeActiveFilters = true, includeVisibilityFilters = true }) => {
  const clauses = [];
  const params = [];
  const filters = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  params.push(null);
  const tenantParam = "$1";
  clauses.push(`p.tenant_id = ${tenantParam}::bigint`);
  filters.push("tenant: p.tenant_id = $1");

  if (includeActiveFilters && productColumns.has("status")) {
    clauses.push(`LOWER(COALESCE(p.status::text, 'active')) NOT IN ('inactive', 'deleted', 'archived', 'disabled')`);
    filters.push("active: products.status not inactive/deleted/archived/disabled");
  }
  if (includeActiveFilters && productColumns.has("is_active")) {
    clauses.push(`COALESCE(p.is_active, TRUE) = TRUE`);
    filters.push("active: products.is_active true/null");
  }

  const visibilityColumn = pickColumn(productColumns, [
    "storefront_visible",
    "is_storefront_visible",
    "visible_on_storefront",
    "show_in_storefront",
    "is_visible",
  ]);
  if (includeVisibilityFilters && visibilityColumn) {
    clauses.push(`LOWER(COALESCE(p.${q(visibilityColumn)}::text, 'true')) NOT IN ('false', '0', 'no', 'hidden', 'inactive')`);
    filters.push(`storefront: ${visibilityColumn} not false/0/no/hidden/inactive or null`);
  }

  const searchClauses = [];
  const productSearchFields = columnList("p", productColumns, [
    "name",
    "title",
    "name_ar",
    "name_en",
    "title_ar",
    "title_en",
    "meta_title_ar",
    "meta_title_en",
    "edition_name",
    "description",
    "sku",
    "barcode",
    "product_type",
    "style",
    "grade",
    "gender",
  ]);
  const variantSearchFields = columnList("pvx", variantColumns, ["sku", "barcode", "color", "size"]);
  const variantExactFields = columnList("pvc", variantColumns, ["sku", "barcode"]);

  for (const term of terms.slice(0, 6)) {
    const likeParam = add(`%${term}%`);
    for (const field of productSearchFields) searchClauses.push(`${field}::text ILIKE ${likeParam}`);
    if (variantSearchFields.length) {
      searchClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pvx WHERE pvx.product_id = p.id ${variantTenantClause(variantColumns, "pvx")} AND (${variantSearchFields
          .map((field) => `${field}::text ILIKE ${likeParam}`)
          .join(" OR ")}))`
      );
    }
  }

  for (const code of codes.slice(0, 5)) {
    const codeParam = add(code);
    if (productColumns.has("sku")) searchClauses.push(`LOWER(p.sku) = LOWER(${codeParam})`);
    if (productColumns.has("barcode")) searchClauses.push(`LOWER(p.barcode) = LOWER(${codeParam})`);
    if (variantExactFields.length) {
      searchClauses.push(
        `EXISTS (SELECT 1 FROM product_variants pvc WHERE pvc.product_id = p.id ${variantTenantClause(variantColumns, "pvc")} AND (${variantExactFields
          .map((field) => `LOWER(${field}::text) = LOWER(${codeParam})`)
          .join(" OR ")}))`
      );
    }
  }

  if (searchClauses.length) clauses.push(`(${searchClauses.join(" OR ")})`);

  return {
    where: clauses.join(" AND "),
    params,
    filters,
    storefrontFilterApplied: includeVisibilityFilters && Boolean(visibilityColumn),
    activeFilterApplied: includeActiveFilters && (productColumns.has("status") || productColumns.has("is_active")),
  };
};

const normalizeSearchTerms = (message, intent) => {
  const words = toText(message)
    .replace(/[^\p{L}\p{N}\s._-]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !PRODUCT_INTENT_TERMS.includes(word.toLowerCase()))
    .filter((word) => !STORE_INTENT_TERMS.includes(word.toLowerCase()))
    .filter((word) => !INTERNAL_INTENT_TERMS.includes(word.toLowerCase()));
  return unique([...intent.product.codes, ...intent.product.colors, intent.product.size, ...words]).slice(0, 10);
};

const normalizeProductRow = (row, intent) => {
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const filteredVariants = variants
    .filter((variant) => {
      const colorOk = !intent.product.colors.length || intent.product.colors.some((color) => toText(variant.color).toLowerCase().includes(color.toLowerCase()));
      const sizeOk = !intent.product.size || toText(variant.size).toLowerCase() === intent.product.size.toLowerCase();
      return colorOk && sizeOk;
    })
    .slice(0, VARIANT_LIMIT);
  const visibleVariants = filteredVariants.length ? filteredVariants : variants.slice(0, VARIANT_LIMIT);
  const totalStock = variants.length
    ? variants.reduce((sum, variant) => sum + Math.max(0, numeric(variant.stock, 0)), 0)
    : Math.max(0, numeric(row.stock, 0));
  const prices = [
    money(row.sale_price) > 0 ? money(row.sale_price) : null,
    money(row.price) > 0 ? money(row.price) : null,
    ...visibleVariants.flatMap((variant) => [money(variant.sale_price) > 0 ? money(variant.sale_price) : null, money(variant.price) > 0 ? money(variant.price) : null]),
  ].filter((value) => value !== null);

  const minPrice = prices.length ? Math.min(...prices) : null;
  const maxPrice = prices.length ? Math.max(...prices) : null;
  const hasDiscount = money(row.sale_price) > 0 && money(row.price) > 0 && money(row.sale_price) < money(row.price);

  return {
    id: row.id,
    name: row.name,
    sku: row.sku || "",
    barcode: row.barcode || "",
    image_url: row.image_url || "",
    price: money(row.price),
    sale_price: money(row.sale_price),
    price_range: minPrice === null ? null : minPrice === maxPrice ? `${minPrice}` : `${minPrice}-${maxPrice}`,
    active_discount: hasDiscount ? { sale_price: money(row.sale_price), original_price: money(row.price) } : null,
    total_stock: totalStock,
    availability: totalStock > 0 ? "available" : "out_of_stock",
    colors: unique(variants.map((variant) => variant.color)),
    sizes: unique(variants.map((variant) => variant.size)),
    variants: visibleVariants.map((variant) => ({
      id: variant.id,
      color: variant.color || "",
      size: variant.size || "",
      sku: variant.sku || "",
      barcode: variant.barcode || "",
      image_url: variant.image_url || "",
      price: money(variant.price),
      sale_price: money(variant.sale_price),
      stock: Math.max(0, numeric(variant.stock, 0)),
      availability: numeric(variant.stock, 0) > 0 ? "available" : "out_of_stock",
    })),
  };
};

const searchProducts = async ({ tenantId, message, intent }) => {
  const [productColumns, variantColumns] = await Promise.all([getColumns("products"), getColumns("product_variants")]);
  const productNameExpr = columnExpr("p", productColumns, ["name", "title", "name_en", "name_ar", "title_en", "title_ar"], "''");
  const productNameColumns = columnList("p", productColumns, ["name", "title", "name_ar", "name_en", "title_ar", "title_en"]);
  if (!productColumns.has("tenant_id") || !productNameColumns.length) return [];

  const terms = normalizeSearchTerms(message, intent);
  if (!terms.length && !intent.product.asksSimilar) return [];

  const normalizedQuery = compactText(message, 500).toLowerCase();
  const productSchemaDebug = {
    product_name_title_fields: ["name", "title", "name_ar", "name_en", "title_ar", "title_en"].filter((column) => productColumns.has(column)),
    product_sku_barcode_fields: ["sku", "barcode"].filter((column) => productColumns.has(column)),
    product_active_status_fields: ["status", "is_active"].filter((column) => productColumns.has(column)),
    product_storefront_visibility_fields: ["storefront_visible", "is_storefront_visible", "visible_on_storefront", "show_in_storefront", "is_visible"].filter((column) => productColumns.has(column)),
    product_tenant_field: productColumns.has("tenant_id") ? "tenant_id" : null,
    variant_sku_barcode_fields: ["sku", "barcode"].filter((column) => variantColumns.has(column)),
    variant_color_size_fields: ["color", "size"].filter((column) => variantColumns.has(column)),
    variant_tenant_field: variantColumns.has("tenant_id") ? "tenant_id" : null,
  };

  const baseConditions = buildProductConditions({
    productColumns,
    variantColumns,
    terms,
    codes: intent.product.codes,
    includeActiveFilters: false,
    includeVisibilityFilters: false,
  });
  const activeOnlyConditions = buildProductConditions({
    productColumns,
    variantColumns,
    terms,
    codes: intent.product.codes,
    includeActiveFilters: true,
    includeVisibilityFilters: false,
  });
  const { where, params, filters, activeFilterApplied, storefrontFilterApplied } = buildProductConditions({
    productColumns,
    variantColumns,
    terms,
    codes: intent.product.codes,
  });
  params[0] = tenantId;
  params.push(PRODUCT_LIMIT);

  debugProductSearch("input", {
    normalized_query: normalizedQuery,
    extracted_product_terms: terms,
    tenant_id: tenantId,
    schema: productSchemaDebug,
    sql_filters_applied: filters,
  });

  const productSelect = {
    sku: columnExpr("p", productColumns, ["sku"], "''"),
    barcode: columnExpr("p", productColumns, ["barcode"], "''"),
    image_url: columnExpr("p", productColumns, ["image_url", "image", "photo_url", "thumbnail_url"], "''"),
    stock: columnExpr("p", productColumns, ["stock"], "0"),
    price: columnExpr("p", productColumns, ["price"], "0"),
    sale_price: columnExpr("p", productColumns, ["sale_price", "discount_price"], "0"),
  };
  const productOrder = productColumns.has("updated_at") ? "p.updated_at DESC NULLS LAST, p.id DESC" : "p.id DESC";
  const variantSelect = {
    id: columnExpr("pv", variantColumns, ["id"], "NULL"),
    color: columnExpr("pv", variantColumns, ["color"], "''"),
    size: columnExpr("pv", variantColumns, ["size"], "''"),
    sku: columnExpr("pv", variantColumns, ["sku"], "''"),
    barcode: columnExpr("pv", variantColumns, ["barcode"], "''"),
    image_url: columnExpr("pv", variantColumns, ["image_url"], "''"),
    price: columnExpr("pv", variantColumns, ["price"], "0"),
    sale_price: columnExpr("pv", variantColumns, ["sale_price", "discount_price"], "0"),
    stock: columnExpr("pv", variantColumns, ["stock"], "0"),
  };

  const result = await db.query(
    `
    SELECT
      p.id,
      ${productNameExpr} AS name,
      ${productSelect.sku} AS sku,
      ${productSelect.barcode} AS barcode,
      ${productSelect.image_url} AS image_url,
      ${productSelect.stock} AS stock,
      ${productSelect.price} AS price,
      ${productSelect.sale_price} AS sale_price,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', ${variantSelect.id},
            'color', ${variantSelect.color},
            'size', ${variantSelect.size},
            'sku', ${variantSelect.sku},
            'barcode', ${variantSelect.barcode},
            'image_url', ${variantSelect.image_url},
            'price', ${variantSelect.price},
            'sale_price', ${variantSelect.sale_price},
            'stock', ${variantSelect.stock}
          )
          ORDER BY pv.id
        ) FILTER (WHERE pv.id IS NOT NULL),
        '[]'::jsonb
      ) AS variants
    FROM products p
    LEFT JOIN product_variants pv
      ON pv.product_id = p.id
     ${variantTenantClause(variantColumns, "pv")}
    WHERE ${where}
    GROUP BY p.id
    ORDER BY ${productOrder}
    LIMIT $${params.length}
    `,
    params
  );

  const countMatches = async (conditions) => {
    const countParams = [...conditions.params];
    countParams[0] = tenantId;
    const countResult = await db.query(`SELECT COUNT(*)::int AS count FROM products p WHERE ${conditions.where}`, countParams);
    return Number(countResult.rows[0]?.count || 0);
  };
  const [broadMatchedCount, activeMatchedCount] = await Promise.all([countMatches(baseConditions), countMatches(activeOnlyConditions)]);
  const products = result.rows.map((row) => normalizeProductRow(row, intent));

  debugProductSearch("result", {
    tenant_id: tenantId,
    matched_product_count: products.length,
    broad_matched_product_count_before_active_storefront_filters: broadMatchedCount,
    matched_count_after_active_filters_before_storefront_filters: activeMatchedCount,
    active_filters_excluded_products: activeFilterApplied && broadMatchedCount > activeMatchedCount,
    storefront_filters_excluded_products: storefrontFilterApplied && activeMatchedCount > products.length,
    sample_matched_products: products.slice(0, 5).map((product) => ({
      name: product.name,
      sku: product.sku,
      variant_skus: product.variants.map((variant) => variant.sku).filter(Boolean).slice(0, 3),
    })),
  });

  return products;
};

const sourceFromProduct = (product) => ({
  id: `product_${product.id}`,
  title: `Product: ${product.name}`,
  content: compactText(
    JSON.stringify({
      name: product.name,
      sku: product.sku || undefined,
      barcode: product.barcode || undefined,
      image_url: product.image_url || undefined,
      public_price: product.price || undefined,
      sale_price: product.sale_price || undefined,
      price_range: product.price_range || undefined,
      active_discount: product.active_discount || undefined,
      stock_summary: {
        total_stock: product.total_stock,
        availability: product.availability,
        colors: product.colors,
        sizes: product.sizes,
      },
      matching_variants: product.variants,
    })
  ),
});

const settingKeyGroups = {
  ai_support_knowledge_base: ["aiSupportKnowledgeBase", "ai_support_knowledge_base", "aiSupportKb", "ai_support_kb"],
  store_name: ["storeName", "store_name", "businessName", "business_name", "siteName", "site_name", "brandName", "brand_name", "name"],
  phone: ["phone", "supportPhone", "support_phone", "contactPhone", "contact_phone", "phoneNumber", "phone_number", "mobile"],
  whatsapp: ["whatsapp", "whatsApp", "whatsappNumber", "whatsapp_number", "supportWhatsapp", "support_whatsapp"],
  public_email: ["email", "supportEmail", "support_email", "contactEmail", "contact_email"],
  address: ["address", "storeAddress", "store_address", "publicAddress", "public_address"],
  working_hours: ["workingHours", "working_hours", "businessHours", "business_hours", "openingHours", "opening_hours", "hours"],
  payment_methods: ["paymentMethods", "payment_methods", "payments", "paymentOptions", "payment_options", "acceptedPayments", "accepted_payments"],
  payment_policy: ["paymentPolicy", "payment_policy", "paymentNotes", "payment_notes"],
  shipping_policy: ["shippingPolicy", "shipping_policy", "deliveryPolicy", "delivery_policy", "shipping", "delivery"],
  delivery_notes: ["deliveryNotes", "delivery_notes", "shippingNotes", "shipping_notes"],
  return_exchange_policy: [
    "returnExchangePolicy",
    "return_exchange_policy",
    "returnPolicy",
    "return_policy",
    "exchangePolicy",
    "exchange_policy",
    "refundPolicy",
    "refund_policy",
    "returns",
    "exchanges",
  ],
  warranty_notes: ["warrantyNotes", "warranty_notes", "warranty", "guaranteeNotes", "guarantee_notes"],
  human_support_message: ["humanSupportMessage", "human_support_message", "supportFallbackMessage", "support_fallback_message"],
  brand_tone_instructions: ["brandToneInstructions", "brand_tone_instructions", "toneInstructions", "tone_instructions"],
  social_links: ["socialLinks", "social_links", "social", "facebook", "instagram", "tiktok", "twitter", "x", "youtube"],
};

const buildPublicStoreSettings = (settings = {}) => {
  const picked = {};
  const kb = firstConfigured(...settingKeyGroups.ai_support_knowledge_base.map((key) => settings?.[key]));
  for (const [targetKey, candidates] of Object.entries(settingKeyGroups)) {
    if (targetKey === "ai_support_knowledge_base") continue;
    const value = firstConfigured(...candidates.map((key) => settings?.[key]), deepFindValue(settings, candidates));
    const kbValue = isObject(kb) ? firstConfigured(kb[targetKey], ...candidates.map((key) => kb?.[key]), deepFindValue(kb, candidates)) : "";
    if (kbValue !== "") picked[targetKey] = kbValue;
    else if (value !== "") picked[targetKey] = value;
  }
  picked.working_hours ||= "Working hours are not configured yet.";
  picked.return_exchange_policy ||= "Return/exchange policy is not configured yet.";
  return picked;
};

const loadStoreKnowledge = async ({ tenantId }) => {
  const settings = buildPublicStoreSettings(await getWebsiteSettings({ tenantId }));
  const branchColumns = await getColumns("branches");
  const branches = [];

  if (branchColumns.has("tenant_id") && branchColumns.has("name")) {
    const phoneExpr = columnExpr("b", branchColumns, ["phone"], "''");
    const addressExpr = columnExpr("b", branchColumns, ["address"], "''");
    const hoursExpr = columnExpr("b", branchColumns, ["working_hours", "business_hours", "opening_hours"], "NULL");
    const notesExpr = columnExpr("b", branchColumns, ["notes"], "''");
    const activeClause = branchColumns.has("is_active") ? "AND COALESCE(b.is_active, TRUE) = TRUE" : "";
    const result = await db.query(
      `
      SELECT
        b.name,
        ${phoneExpr} AS phone,
        ${addressExpr} AS address,
        ${hoursExpr} AS working_hours,
        ${notesExpr} AS notes
      FROM branches b
      WHERE b.tenant_id = $1::bigint
      ${activeClause}
      ORDER BY b.name ASC
      LIMIT 8
      `,
      [tenantId]
    );

    branches.push(
      ...result.rows.map((branch) => ({
        name: toText(branch.name),
        phone: toText(branch.phone),
        address: toText(branch.address),
        working_hours: toText(branch.working_hours) || "Working hours are not configured yet.",
        notes: toText(branch.notes),
      }))
    );
  }

  const storeContext = {
    store: settings,
    branches,
    configuration_status: {
      working_hours_configured:
        toText(settings.working_hours) !== "Working hours are not configured yet." ||
        branches.some((branch) => toText(branch.working_hours) !== "Working hours are not configured yet."),
      return_exchange_policy_configured: toText(settings.return_exchange_policy) !== "Return/exchange policy is not configured yet.",
    },
  };

  return [
    {
      id: "store_context",
      title: "Public store context, branches, contact details, policies, and configuration status",
      content: compactText(JSON.stringify(storeContext)),
      preview: storeContext,
    },
  ];
};

const isArabicText = (value = "") => /[\u0600-\u06ff]/.test(toText(value));

const joinList = (items = [], locale = "en") => {
  const values = items.map((item) => toText(item)).filter(Boolean);
  if (!values.length) return "";
  return locale === "ar" ? values.join("\n") : values.join("\n");
};

const valueToLines = (value) => {
  if (Array.isArray(value)) return value.map((item) => (isObject(item) ? JSON.stringify(item) : toText(item))).filter(Boolean);
  if (isObject(value)) return Object.entries(value).map(([key, item]) => `${key}: ${Array.isArray(item) || isObject(item) ? JSON.stringify(item) : toText(item)}`);
  return toText(value) ? [toText(value)] : [];
};

const buildDirectStoreResponse = ({ message, sources = [], suggestedActions = [] }) => {
  const source = sources.find((item) => item.id === "store_context");
  const context = source?.preview;
  if (!context) return null;
  const text = toText(message).toLowerCase();
  const locale = isArabicText(message) ? "ar" : "en";
  const store = context.store || {};
  const branches = Array.isArray(context.branches) ? context.branches : [];
  const has = (terms) => terms.some((term) => text.includes(term.toLowerCase()));
  const wrap = (answer) => ({
    answer,
    confidence: 1,
    needs_human_support: false,
    sources_used: ["store_context"],
    suggested_products: [],
    suggested_actions: suggestedActions.length ? suggestedActions : ["contact_support"],
  });

  if (has(["hours", "working", "open", "close", "\u0645\u0648\u0627\u0639\u064a\u062f", "\u0633\u0627\u0639\u0627\u062a", "\u0639\u0645\u0644", "\u0645\u0641\u062a\u0648\u062d"])) {
    const branchLines = branches
      .filter((branch) => toText(branch.working_hours) && toText(branch.working_hours) !== "Working hours are not configured yet.")
      .map((branch) => `${branch.name}: ${branch.working_hours}`);
    const settingLines = toText(store.working_hours) && store.working_hours !== "Working hours are not configured yet." ? valueToLines(store.working_hours) : [];
    const lines = [...settingLines, ...branchLines];
    if (lines.length) return wrap(locale === "ar" ? `مواعيد العمل:\n${joinList(lines, "ar")}` : `Working hours:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "مواعيد العمل غير مضافة حتى الآن." : "Working hours are not configured yet.");
  }

  if (has(["return", "exchange", "refund", "\u0627\u0633\u062a\u0631\u062c\u0627\u0639", "\u0627\u0633\u062a\u0628\u062f\u0627\u0644"])) {
    const lines = store.return_exchange_policy === "Return/exchange policy is not configured yet." ? [] : valueToLines(store.return_exchange_policy);
    if (lines.length) return wrap(locale === "ar" ? `سياسة الاستبدال والاسترجاع:\n${joinList(lines, "ar")}` : `Return/exchange policy:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "سياسة الاستبدال أو الاسترجاع غير مضافة حتى الآن." : "Return/exchange policy is not configured yet.");
  }

  if (has(["payment", "pay", "\u062f\u0641\u0639"])) {
    const lines = [...valueToLines(store.payment_methods), ...valueToLines(store.payment_policy)];
    if (lines.length) return wrap(locale === "ar" ? `طرق الدفع:\n${joinList(lines, "ar")}` : `Payment methods:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "طرق الدفع غير مضافة حتى الآن." : "Payment methods are not configured yet.");
  }

  if (has(["address", "branch", "location", "\u0639\u0646\u0648\u0627\u0646", "\u0641\u0631\u0639", "\u0641\u0631\u0648\u0639"])) {
    const branchLines = branches
      .filter((branch) => toText(branch.address))
      .map((branch) => `${branch.name}: ${branch.address}${branch.phone ? ` - ${branch.phone}` : ""}`);
    const settingLines = valueToLines(store.address);
    const lines = [...settingLines, ...branchLines];
    if (lines.length) return wrap(locale === "ar" ? `العناوين المتاحة:\n${joinList(lines, "ar")}` : `Available addresses:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "عنوان الفرع غير مضاف حتى الآن." : "Branch address is not configured yet.");
  }

  if (has(["shipping", "delivery", "\u0634\u062d\u0646", "\u062a\u0648\u0635\u064a\u0644"])) {
    const lines = [...valueToLines(store.shipping_policy), ...valueToLines(store.delivery_notes)];
    if (lines.length) return wrap(locale === "ar" ? `الشحن والتوصيل:\n${joinList(lines, "ar")}` : `Shipping and delivery:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "سياسة الشحن أو التوصيل غير مضافة حتى الآن." : "Shipping/delivery policy is not configured yet.");
  }

  if (has(["phone", "whatsapp", "contact", "\u0648\u0627\u062a\u0633", "\u062a\u0644\u064a\u0641\u0648\u0646", "\u0645\u0648\u0628\u0627\u064a\u0644"])) {
    const lines = [...valueToLines(store.phone), ...valueToLines(store.whatsapp), ...branches.filter((branch) => branch.phone).map((branch) => `${branch.name}: ${branch.phone}`)];
    if (lines.length) return wrap(locale === "ar" ? `بيانات التواصل:\n${joinList(lines, "ar")}` : `Contact details:\n${joinList(lines)}`);
    return wrap(locale === "ar" ? "بيانات التواصل غير مضافة حتى الآن." : "Contact details are not configured yet.");
  }

  return null;
};

const pickConversationalAnswer = ({ subtype = "greeting", tenantId = null, brandTone = "" } = {}) => {
  const responses = CONVERSATIONAL_RESPONSE_SETS[subtype] || CONVERSATIONAL_RESPONSE_SETS.greeting;
  const normalizedTone = normalizeConversationalText(brandTone);
  const prefersShort = /short|brief|concise/i.test(brandTone) || normalizedTone.includes("\u0645\u062e\u062a\u0635\u0631");
  const prefersFriendly = /friendly|warm|casual/i.test(brandTone) || normalizedTone.includes("\u0648\u062f\u0648\u062f") || normalizedTone.includes("\u0645\u0631\u062d");
  const seed = Math.abs(Number(tenantId || 0)) + subtype.length;
  if (prefersShort) return responses[0];
  if (prefersFriendly && responses[1]) return responses[1];
  return responses[seed % responses.length] || responses[0];
};

const buildDirectConversationalResponse = async ({ tenantId, intent }) => {
  let brandTone = "";
  if (tenantId) {
    try {
      const settings = buildPublicStoreSettings(await getWebsiteSettings({ tenantId }));
      brandTone = toText(settings.brand_tone_instructions);
    } catch (error) {
      console.warn("[ai-support] conversational tone load skipped", {
        tenantId,
        message: error?.message,
      });
    }
  }

  return {
    answer: pickConversationalAnswer({
      subtype: intent.conversational?.subtype || "greeting",
      tenantId,
      brandTone,
    }),
    confidence: 1,
    needs_human_support: false,
    sources_used: [],
    suggested_products: [],
    suggested_actions: ["contact_support"],
  };
};

const suggestedProducts = (products = []) =>
  products.slice(0, 4).map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku || "",
    image_url: product.image_url || "",
    price: product.sale_price > 0 ? product.sale_price : product.price,
    availability: product.availability,
    total_stock: product.total_stock,
  }));

export const buildAiSupportTrustedContext = async ({ tenantId, message } = {}) => {
  const intent = detectAiSupportIntent(message);

  if (intent.type === "conversational") {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      fallbackReason: "",
      directResponse: await buildDirectConversationalResponse({ tenantId, intent }),
    };
  }

  if (!tenantId) {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      fallbackReason: "missing_tenant",
    };
  }

  if (intent.type === "internal_data") {
    return {
      intent,
      trustedContext: { tenant_id: tenantId, sources: [] },
      suggested_products: [],
      suggested_actions: ["contact_support"],
      fallbackReason: "internal_data_request",
      directResponse: {
        answer: "I cannot share internal ERP, admin, supplier, cost, margin, credential, or other private data. Please contact support if you need help with a public store question.",
        confidence: 1,
        needs_human_support: true,
        sources_used: [],
        suggested_products: [],
        suggested_actions: ["contact_support"],
      },
    };
  }

  const sources = [];
  let products = [];
  let fallbackReason = "";

  if (intent.type === "product" || intent.type === "general") {
    products = await searchProducts({ tenantId, message, intent });
    sources.push(...products.map(sourceFromProduct));
    if ((intent.type === "product" || intent.product.asksSimilar) && products.length === 0) {
      fallbackReason = "no_matching_products";
    }
  }

  if (intent.type === "store_policy" || intent.type === "general") {
    const storeSources = await loadStoreKnowledge({ tenantId });
    sources.push(...storeSources);
    if (!sources.length && !fallbackReason) fallbackReason = "no_store_context";
  }

  const sourcePreviews = sources.map((source) => ({
    id: source.id,
    title: source.title,
    preview: source.preview || safeJsonParse(source.content) || source.content,
  }));
  const suggestedActions = products.length
    ? ["view_product", "contact_support"]
    : sources.length
      ? ["contact_support"]
      : ["contact_support"];
  const directStoreResponse = intent.type === "store_policy"
    ? buildDirectStoreResponse({ message, sources, suggestedActions })
    : null;

  return {
    intent,
    trustedContext: {
      tenant_id: tenantId,
      context_version: "phase_2_real_storefront_product_context",
      sources,
    },
    source_previews: sourcePreviews,
    suggested_products: suggestedProducts(products),
    suggested_actions: suggestedActions,
    fallbackReason: sources.length ? "" : fallbackReason || "no_trusted_context",
    directResponse: directStoreResponse || undefined,
  };
};

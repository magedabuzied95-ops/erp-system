import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db, { withReadOnlyDbSession } from "../database/db.js";
import { aiProductExclusionReason } from "../services/aiProductEligibilityService.js";
import { buildStorefrontProductUrl } from "../services/storefrontProductUrlService.js";
import { scoreProductCandidate } from "../utils/productMatchConfidence.js";
import { buildAiAgentRegressionExtraScenarios } from "./aiAgentRegressionScenarios.extra.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturePath = path.join(__dirname, "fixtures", "aiAgentRegressionScenarios.json");
const reportsDir = path.join(__dirname, "..", "reports");
const jsonReportPath = path.join(reportsDir, "ai-data-integrity-report.json");
const mdReportPath = path.join(reportsDir, "ai-data-integrity-report.md");

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const number = (value = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const asArray = (value) => (Array.isArray(value) ? value : []);
const unique = (items = []) => [...new Set(asArray(items).map(text).filter(Boolean))];
const slugify = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
const isEmpty = (value = "") => !text(value);
const hasArabic = (value = "") => /[\u0600-\u06ff]/.test(text(value));
const hasEnglish = (value = "") => /[a-z]/i.test(text(value));
const isLikelyLocalImagePath = (value = "") => {
  const safe = text(value);
  if (!safe) return false;
  return safe.startsWith("/uploads/") || safe.startsWith("uploads/") || safe.startsWith("/products/") || safe.startsWith("products/");
};
const isRemoteImage = (value = "") => /^https?:\/\//i.test(text(value));
const isDataImage = (value = "") => /^data:image\//i.test(text(value));
const normalizeImagePath = (value = "") => text(value).replace(/^\/+/, "");
const trimPreview = (value = "", limit = 140) => {
  const safe = text(value);
  return safe.length > limit ? `${safe.slice(0, limit)}…` : safe;
};
const severityRank = { critical: 0, medium: 1, low: 2 };

const cleanKey = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const compactKey = (value = "") =>
  cleanKey(value)
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, "-")
    .replace(/^-+|-+$/g, "");

const safeJson = (value = null) => {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return "null";
  }
};

const readOnly = (fn) => withReadOnlyDbSession(async () => fn(), { is_integrity_suite: true, dry_run: true });

const columnCache = new Map();
const getTableColumns = async (tableName = "") => {
  const table = text(tableName);
  if (!table) return new Set();
  if (columnCache.has(table)) return columnCache.get(table);
  const result = await db.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ANY (current_schemas(false))
        AND table_name = $1
    `,
    [table]
  );
  const columns = new Set(result.rows.map((row) => text(row.column_name)).filter(Boolean));
  columnCache.set(table, columns);
  return columns;
};

const selectExpr = (alias, column, { columns = new Set(), truncate = 0, cast = "text" } = {}) => {
  if (!columns.has(column)) return null;
  const qualified = `${alias}.${column}`;
  if (cast === "json") return `${qualified} AS ${column}`;
  if (cast === "number" || cast === "boolean" || cast === "raw") return `${qualified} AS ${column}`;
  const valueExpr = truncate > 0 ? `LEFT(COALESCE(${qualified}::text, ''), ${truncate})` : `COALESCE(${qualified}::text, '')`;
  return `${valueExpr} AS ${column}`;
};

const buildSelectList = (alias, columns, defs = []) =>
  defs.map((def) => selectExpr(alias, def.column, { columns, truncate: def.truncate || 0, cast: def.cast || "text" })).filter(Boolean);

const productFieldDefs = [
  { column: "id", cast: "raw" },
  { column: "tenant_id", cast: "raw" },
  { column: "name" },
  { column: "slug" },
  { column: "canonical_slug" },
  { column: "brand" },
  { column: "category" },
  { column: "product_type" },
  { column: "style" },
  { column: "grade" },
  { column: "gender" },
  { column: "sku" },
  { column: "barcode" },
  { column: "product_code" },
  { column: "edition_name" },
  { column: "edition_slug" },
  { column: "description", truncate: 512 },
  { column: "seo_keywords", truncate: 512 },
  { column: "meta_title", truncate: 512 },
  { column: "seo_description", truncate: 512 },
  { column: "variation_mode" },
  { column: "fixed_size_label" },
  { column: "low_stock_tracking_mode" },
  { column: "image_url", truncate: 256 },
  { column: "image", truncate: 256 },
  { column: "photo_url", truncate: 256 },
  { column: "thumbnail_url", truncate: 256 },
  { column: "gallery_images", cast: "json" },
  { column: "stock", cast: "number" },
  { column: "selling_price", cast: "number" },
  { column: "regular_price", cast: "number" },
  { column: "price", cast: "number" },
  { column: "sale_price", cast: "number" },
  { column: "sale_price_enabled", cast: "boolean" },
  { column: "low_stock_alert", cast: "number" },
  { column: "product_low_stock_threshold", cast: "number" },
  { column: "minimum_distinct_sizes_required", cast: "number" },
  { column: "status" },
  { column: "is_active", cast: "boolean" },
  { column: "category_id", cast: "raw" },
  { column: "brand_id", cast: "raw" },
  { column: "manufacturer_id", cast: "raw" },
  { column: "metadata", cast: "json" },
];

const variantFieldDefs = [
  { column: "id", cast: "raw" },
  { column: "tenant_id", cast: "raw" },
  { column: "product_id", cast: "raw" },
  { column: "color" },
  { column: "size" },
  { column: "sku" },
  { column: "barcode" },
  { column: "article_code" },
  { column: "image_url", truncate: 256 },
  { column: "image", truncate: 256 },
  { column: "photo_url", truncate: 256 },
  { column: "thumbnail_url", truncate: 256 },
  { column: "stock", cast: "number" },
  { column: "cost_price", cast: "number" },
  { column: "selling_price", cast: "number" },
  { column: "regular_price", cast: "number" },
  { column: "price", cast: "number" },
  { column: "sale_price", cast: "number" },
  { column: "low_stock_alert", cast: "number" },
  { column: "manufacturer_id", cast: "raw" },
  { column: "is_active", cast: "boolean" },
  { column: "deleted_at", truncate: 32 },
  { column: "edition_name" },
  { column: "edition_slug" },
  { column: "default_purchase_qty", cast: "number" },
  { column: "purchase_pack_type" },
  { column: "purchase_pack_qty", cast: "number" },
  { column: "reorder_trigger_percent", cast: "number" },
  { column: "size_distribution_json", cast: "json" },
  { column: "supplier_id", cast: "raw" },
  { column: "warehouse_id", cast: "raw" },
  { column: "branch_id", cast: "raw" },
  { column: "metadata", cast: "json" },
];

const imageFieldDefs = [
  { column: "id", cast: "raw" },
  { column: "tenant_id", cast: "raw" },
  { column: "product_id", cast: "raw" },
  { column: "variant_id", cast: "raw" },
  { column: "color_name" },
  { column: "color_value" },
  { column: "image_url", truncate: 256 },
  { column: "sort_order", cast: "number" },
  { column: "is_primary", cast: "boolean" },
];

const queryTable = async ({ table, alias, defs, joins = "", where = "", params = [] } = {}) => {
  const columns = await getTableColumns(table);
  const selectList = buildSelectList(alias, columns, defs);
  const sql = `
    SELECT ${selectList.join(", ")}
    FROM ${table} ${alias}
    ${joins}
    ${where}
    ORDER BY ${alias}.id ASC
  `;
  const result = await db.query(sql, params);
  return result.rows;
};

const buildProductQuery = async (tenantId) => {
  const columns = await getTableColumns("products");
  const selectList = buildSelectList("p", columns, productFieldDefs);
  const joins = `
    LEFT JOIN brands br ON br.id = p.brand_id
    LEFT JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN manufacturers man ON man.id = p.manufacturer_id
  `;
  const sql = `
    SELECT ${selectList.join(", ")},
      COALESCE(br.name, '') AS brand_lookup_name,
      COALESCE(cat.name, '') AS category_lookup_name,
      COALESCE(man.name, '') AS manufacturer_lookup_name
    FROM products p
    ${joins}
    WHERE p.tenant_id = $1
    ORDER BY p.id ASC
  `;
  const result = await db.query(sql, [tenantId]);
  return result.rows;
};

const buildVariantQuery = async (tenantId) => {
  const columns = await getTableColumns("product_variants");
  const selectList = buildSelectList("v", columns, variantFieldDefs);
  const sql = `
    SELECT ${selectList.join(", ")}
    FROM product_variants v
    WHERE v.tenant_id = $1
    ORDER BY v.product_id ASC, v.id ASC
  `;
  const result = await db.query(sql, [tenantId]);
  return result.rows;
};

const buildImageQuery = async (tenantId) => {
  const columns = await getTableColumns("product_variant_images");
  const selectList = buildSelectList("i", columns, imageFieldDefs);
  const where = columns.has("tenant_id") ? "WHERE i.tenant_id = $1" : "WHERE i.product_id IS NOT NULL";
  const params = columns.has("tenant_id") ? [tenantId] : [];
  const sql = `
    SELECT ${selectList.join(", ")}
    FROM product_variant_images i
    ${where}
    ORDER BY i.product_id ASC, i.variant_id ASC, i.sort_order ASC, i.id ASC
  `;
  const result = await db.query(sql, params);
  return result.rows;
};

const toNumber = (value = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const groupBy = (items = [], keyFn = () => "") => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
};

const collectText = (...values) => unique(values.flatMap((value) => (Array.isArray(value) ? value : [value])).map(text).filter(Boolean));

const firstNonEmpty = (...values) => values.map(text).find(Boolean) || "";

const productDisplayName = (product = {}) =>
  firstNonEmpty(product.name, product.title, product.product_name, product.model, product.edition_name, product.slug, product.canonical_slug);

const productSearchBlob = (product = {}) =>
  collectText(
    product.name,
    product.brand,
    product.category,
    product.product_type,
    product.style,
    product.grade,
    product.gender,
    product.sku,
    product.barcode,
    product.product_code,
    product.slug,
    product.canonical_slug,
    product.description,
    product.seo_keywords,
    product.meta_title,
    product.seo_description,
    product.brand_lookup_name,
    product.category_lookup_name,
    product.manufacturer_lookup_name
  ).join(" ");

const normalizedLocalFileCandidates = (url = "") => {
  const safe = text(url);
  if (!safe) return [];
  const normalized = normalizeImagePath(safe);
  const candidates = [
    path.join(process.cwd(), normalized),
    path.join(process.cwd(), "server", normalized),
    path.join(process.cwd(), "uploads", normalized.replace(/^uploads[\\/]/i, "")),
    path.join(process.cwd(), "server", "uploads", normalized.replace(/^uploads[\\/]/i, "")),
  ];
  return unique(candidates);
};

const fileExists = (filePath = "") => existsSync(filePath);

const isBrokenLocalImage = (url = "") => {
  if (!isLikelyLocalImagePath(url)) return false;
  return !normalizedLocalFileCandidates(url).some((candidate) => fileExists(candidate));
};

const issueKey = (issue = {}) =>
  [
    issue.code || "",
    issue.severity || "",
    issue.product_id || "",
    issue.variant_id || "",
    issue.group_key || "",
    issue.message || "",
  ].join("|");

const makeIssue = ({ code, severity, scope, message, productId = null, variantId = null, details = null, affected = [] } = {}) => ({
  code,
  severity,
  scope,
  message,
  product_id: productId ? String(productId) : "",
  variant_id: variantId ? String(variantId) : "",
  affected_ids: unique(affected.map(text)),
  details,
});

const pushIssue = (bucket, issue) => {
  const key = issueKey(issue);
  if (bucket.has(key)) return;
  bucket.set(key, issue);
};

const activeStatus = (product = {}) => {
  const status = lower(product.status || "");
  const active = product.is_active !== false && !["inactive", "disabled", "archived", "deleted", "draft"].includes(status);
  const outOfStock = ["out_of_stock", "out of stock", "sold_out", "sold out", "unavailable"].some((term) => status.includes(term));
  return { active, outOfStock, status };
};

const buildPrice = (product = {}) => {
  const sellingPrice = Math.max(0, toNumber(product.selling_price));
  const salePrice = Math.max(0, toNumber(product.sale_price));
  const regularPrice = Math.max(0, toNumber(product.regular_price));
  const basePrice = Math.max(0, toNumber(product.price));
  const priceSource = sellingPrice > 0 ? "selling_price" : salePrice > 0 ? "sale_price" : regularPrice > 0 ? "regular_price" : basePrice > 0 ? "price" : "";
  const displayPrice = sellingPrice > 0 ? sellingPrice : salePrice > 0 ? salePrice : regularPrice > 0 ? regularPrice : basePrice > 0 ? basePrice : 0;
  return {
    sellingPrice,
    salePrice,
    regularPrice,
    basePrice,
    displayPrice,
    priceSource,
  };
};

const buildVariantKey = (variant = {}) => ({
  color: compactKey(firstNonEmpty(variant.color, variant.color_name, variant.color_value)),
  size: compactKey(firstNonEmpty(variant.size, variant.size_name)),
  article: compactKey(firstNonEmpty(variant.article_code, variant.sku, variant.barcode)),
});

const describeFamily = (product = {}) =>
  compactKey(
    firstNonEmpty(
      product.canonical_slug,
      product.slug,
      [product.brand, product.name].filter(Boolean).join(" "),
      [product.brand_lookup_name, product.name].filter(Boolean).join(" ")
    )
  );

const queryByProductUrlId = (url = "") => {
  const match = text(url).match(/\/shop\/product\/([^/?#]+)/i);
  if (!match) return null;
  const identifier = decodeURIComponent(match[1] || "");
  return identifier;
};

const loadReplayScenarios = async () => {
  const raw = await readFile(fixturePath, "utf8");
  const base = JSON.parse(raw);
  const extras = buildAiAgentRegressionExtraScenarios();
  return [...(base.scenarios || []), ...extras];
};

const extractReplayReferences = (scenarios = []) => {
  const productIds = new Set();
  const variantIds = new Set();
  const urls = new Set();

  const visit = (value, keyPath = "") => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${keyPath}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        const pathKey = `${keyPath}.${key}`.replace(/^\./, "");
        if (["product_id", "productId", "selected_product_id", "matched_product_id", "id"].includes(key)) {
          const parent = lower(keyPath);
          if (parent.includes("product_card") || parent.includes("selected") || parent.includes("memory") || parent.includes("product") || parent.includes("variant")) {
            const numericId = Number(nested);
            if (Number.isInteger(numericId) && numericId > 0 && !parent.includes("variant")) productIds.add(String(numericId));
            if (Number.isInteger(numericId) && numericId > 0 && parent.includes("variant")) variantIds.add(String(numericId));
          }
        }
        if (["variant_id", "variantId", "selected_variant_id", "matched_variant_id"].includes(key)) {
          const numericId = Number(nested);
          if (Number.isInteger(numericId) && numericId > 0) variantIds.add(String(numericId));
        }
        if (["product_url", "productUrl", "storefront_url", "url", "share_url"].includes(key) && text(nested)) {
          urls.add(text(nested));
        }
        visit(nested, pathKey);
      }
      return;
    }
    if (typeof value === "string") {
      const safe = text(value);
      if (/^\/shop\/product\//i.test(safe)) urls.add(safe);
    }
  };

  for (const scenario of scenarios) visit(scenario, "scenario");

  return {
    productIds: [...productIds],
    variantIds: [...variantIds],
    urls: [...urls],
  };
};

const buildMarkdown = ({ summary, issues = [] } = {}) => {
  const lines = [];
  lines.push("# AI Data Integrity Report");
  lines.push("");
  lines.push(`- Products checked: ${summary.products_checked}`);
  lines.push(`- Variants checked: ${summary.variants_checked}`);
  lines.push(`- Images checked: ${summary.images_checked}`);
  lines.push(`- Total issues: ${summary.total_issues}`);
  lines.push(`- Critical: ${summary.critical_issues}`);
  lines.push(`- Medium: ${summary.medium_issues}`);
  lines.push(`- Low: ${summary.low_issues}`);
  lines.push(`- AI Readiness Score: ${summary.ai_readiness_score}%`);
  lines.push("");
  lines.push("## Top 20 Problems");
  lines.push("| # | Severity | Code | Scope | Message | Affected |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  issues.slice(0, 20).forEach((issue, index) => {
    lines.push(`| ${index + 1} | ${issue.severity} | ${issue.code} | ${issue.scope} | ${issue.message.replace(/\|/g, "\\|")} | ${issue.affected_ids.join(", ") || issue.product_id || issue.variant_id || ""} |`);
  });
  if (!issues.length) lines.push("| - | - | - | - | No issues found | - |");
  lines.push("");
  lines.push("## Severity Summary");
  lines.push("| Severity | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Critical | ${summary.critical_issues} |`);
  lines.push(`| Medium | ${summary.medium_issues} |`);
  lines.push(`| Low | ${summary.low_issues} |`);
  lines.push("");
  lines.push("## Replay Compatibility");
  lines.push(`- Replay products referenced: ${summary.replay_products_checked}`);
  lines.push(`- Replay variants referenced: ${summary.replay_variants_checked}`);
  lines.push(`- Replay URL references: ${summary.replay_urls_checked}`);
  lines.push(`- Replay missing references: ${summary.replay_missing_references}`);
  return lines.join("\n");
};

const scanIntegrity = async () => readOnly(async () => {
  const tenantId = 1;
  const [products, variants, images, replayScenarios] = await Promise.all([
    buildProductQuery(tenantId),
    buildVariantQuery(tenantId),
    buildImageQuery(tenantId),
    loadReplayScenarios(),
  ]);

  const excludedProducts = products.filter((product) => aiProductExclusionReason(product, { requireProductUrl: false }));
  const aiFacingProducts = products.filter((product) => !aiProductExclusionReason(product, { requireProductUrl: false }));
  const aiFacingProductIds = new Set(aiFacingProducts.map((product) => String(product.id)));
  const aiFacingVariants = variants.filter((variant) => aiFacingProductIds.has(String(variant.product_id || "")));
  const aiFacingImages = images.filter((image) => aiFacingProductIds.has(String(image.product_id || "")));

  const productMap = new Map(aiFacingProducts.map((product) => [String(product.id), product]));
  const variantsByProduct = groupBy(aiFacingVariants, (variant) => String(variant.product_id || ""));
  const imagesByProduct = groupBy(aiFacingImages, (image) => String(image.product_id || ""));
  const imageByVariant = groupBy(aiFacingImages, (image) => String(image.variant_id || ""));
  const issueBucket = new Map();

  let imagesChecked = 0;

  const addProductIssue = (issue) => pushIssue(issueBucket, issue);
  const addVariantIssue = (issue) => pushIssue(issueBucket, issue);

  for (const product of products) {
    const productId = String(product.id);
    const productVariants = variantsByProduct.get(productId) || [];
    const productImages = imagesByProduct.get(productId) || [];
    const activeVariants = productVariants.filter((variant) => variant.is_active !== false && !text(variant.deleted_at));
    const computedTotalStock = productVariants.reduce((sum, variant) => sum + Math.max(0, toNumber(variant.stock)), 0);
    const activeStatusState = activeStatus(product);
    const prices = buildPrice(product);
    const displayName = productDisplayName(product);
    const searchBlob = productSearchBlob(product);
    const colors = unique(productVariants.map((variant) => firstNonEmpty(variant.color, variant.color_name, variant.color_value)).filter(Boolean));
    const sizes = unique(productVariants.map((variant) => firstNonEmpty(variant.size, variant.size_name)).filter(Boolean));
    const allImageRefs = unique([
      product.image_url,
      product.image,
      product.photo_url,
      product.thumbnail_url,
      ...asArray(product.gallery_images).flatMap((item) => (typeof item === "string" ? [item] : [item?.image_url, item?.url, item?.src, item?.path])),
      ...productImages.map((image) => image.image_url),
      ...productVariants.map((variant) => variant.image_url || variant.image || variant.photo_url || variant.thumbnail_url),
    ]);
    imagesChecked += allImageRefs.length;

    if (toNumber(product.stock) < 0) {
      addProductIssue(makeIssue({
        code: "invalid_stock",
        severity: "critical",
        scope: "product",
        productId,
        message: "Product stock is negative.",
        details: { stock: toNumber(product.stock) },
      }));
    }

    if (productVariants.some((variant) => toNumber(variant.stock) < 0)) {
      addProductIssue(makeIssue({
        code: "invalid_stock",
        severity: "critical",
        scope: "variant",
        productId,
        message: "One or more variant stock values are negative.",
        details: { variant_ids: productVariants.filter((variant) => toNumber(variant.stock) < 0).map((variant) => String(variant.id)) },
      }));
    }

    if (productVariants.length && toNumber(product.stock) !== computedTotalStock) {
      addProductIssue(makeIssue({
        code: "inconsistent_total_stock",
        severity: "medium",
        scope: "product",
        productId,
        message: `Product stock ${toNumber(product.stock)} does not match summed variant stock ${computedTotalStock}.`,
        details: { product_stock: toNumber(product.stock), variant_stock_sum: computedTotalStock },
      }));
    }

    if (activeStatusState.active && computedTotalStock <= 0) {
      addProductIssue(makeIssue({
        code: "available_with_zero_stock",
        severity: "critical",
        scope: "product",
        productId,
        message: "Active product is marked available but has zero stock.",
        details: { stock: computedTotalStock },
      }));
    }

    if (activeStatusState.outOfStock && computedTotalStock > 0) {
      addProductIssue(makeIssue({
        code: "out_of_stock_with_positive_stock",
        severity: "critical",
        scope: "product",
        productId,
        message: "Product is marked out of stock but has positive stock.",
        details: { stock: computedTotalStock, status: product.status },
      }));
    }

    if (prices.sellingPrice === 0 || prices.displayPrice === 0 || !prices.priceSource) {
      addProductIssue(makeIssue({
        code: !prices.priceSource ? "missing_price_source" : "missing_price",
        severity: "critical",
        scope: "product",
        productId,
        message: !prices.priceSource ? "Product does not expose a usable price source." : "Product is missing a usable display price.",
        details: prices,
      }));
    }

    if (prices.sellingPrice < 0 || prices.regularPrice < 0 || prices.basePrice < 0 || prices.salePrice < 0) {
      addProductIssue(makeIssue({
        code: "negative_price",
        severity: "critical",
        scope: "product",
        productId,
        message: "Product contains a negative price value.",
        details: prices,
      }));
    }

    if (prices.salePrice > 0 && prices.sellingPrice > 0 && prices.salePrice > prices.sellingPrice) {
      addProductIssue(makeIssue({
        code: "invalid_sale_price",
        severity: "critical",
        scope: "product",
        productId,
        message: "Sale price is greater than selling price.",
        details: prices,
      }));
    }

    if (toNumber(product.selling_price) === 0) {
      addProductIssue(makeIssue({
        code: "zero_selling_price",
        severity: "medium",
        scope: "product",
        productId,
        message: "Selling price is zero.",
        details: { selling_price: toNumber(product.selling_price) },
      }));
    }

    if (!text(displayName)) {
      addProductIssue(makeIssue({
        code: "missing_product_name",
        severity: "critical",
        scope: "product",
        productId,
        message: "Product name is missing.",
      }));
    }

    if (isEmpty(product.brand) && isEmpty(product.brand_lookup_name)) {
      addProductIssue(makeIssue({
        code: "missing_brand",
        severity: "medium",
        scope: "product",
        productId,
        message: "Brand is missing.",
      }));
    }

    if (isEmpty(product.category) && isEmpty(product.category_lookup_name)) {
      addProductIssue(makeIssue({
        code: "missing_category",
        severity: "medium",
        scope: "product",
        productId,
        message: "Category is missing.",
      }));
    }

    if (isEmpty(product.product_type)) {
      addProductIssue(makeIssue({
        code: "missing_product_type",
        severity: "medium",
        scope: "product",
        productId,
        message: "Product type is missing.",
      }));
    }

    if (!unique([product.product_code, product.sku, product.barcode, product.edition_name, product.edition_slug]).length) {
      addProductIssue(makeIssue({
        code: "missing_article_model_code",
        severity: "medium",
        scope: "product",
        productId,
        message: "Article/model code is missing.",
      }));
    }

    if (product.slug) {
      const normalizedSlug = slugify(product.slug);
      if (normalizedSlug !== text(product.slug).toLowerCase()) {
        addProductIssue(makeIssue({
          code: "invalid_slug_format",
          severity: "low",
          scope: "product",
          productId,
          message: "Slug format is not normalized.",
          details: { slug: product.slug, normalized_slug: normalizedSlug },
        }));
      }
      if (!normalizedSlug) {
        addProductIssue(makeIssue({
          code: "invalid_slug_format",
          severity: "low",
          scope: "product",
          productId,
          message: "Slug is empty after normalization.",
          details: { slug: product.slug },
        }));
      }
    }

    const mainImage = firstNonEmpty(product.image_url, product.image, product.photo_url, product.thumbnail_url, asArray(product.gallery_images)[0]?.image_url, asArray(product.gallery_images)[0]?.url, asArray(product.gallery_images)[0]?.src, asArray(product.gallery_images)[0]?.path);
    if (!mainImage) {
      addProductIssue(makeIssue({
        code: "missing_main_image",
        severity: "medium",
        scope: "product",
        productId,
        message: "Main image is missing.",
      }));
    }

    for (const url of unique([product.image_url, product.image, product.photo_url, product.thumbnail_url, ...asArray(product.gallery_images).map((item) => (typeof item === "string" ? item : firstNonEmpty(item?.image_url, item?.url, item?.src, item?.path)))])) {
      if (!url) continue;
      if (!isRemoteImage(url) && !isDataImage(url) && isBrokenLocalImage(url)) {
        addProductIssue(makeIssue({
          code: "broken_image_path",
          severity: "medium",
          scope: "product",
          productId,
          message: "Image path does not resolve on disk.",
          details: { image_url: trimPreview(url) },
        }));
      }
      if (!isRemoteImage(url) && !isDataImage(url) && !isLikelyLocalImagePath(url)) {
        addProductIssue(makeIssue({
          code: "invalid_image_path",
          severity: "low",
          scope: "product",
          productId,
          message: "Image path is not a recognized URL or local upload path.",
          details: { image_url: trimPreview(url) },
        }));
      }
    }

    if (colors.length && !productImages.some((image) => text(image.image_url))) {
      const colorsMissingImage = colors.filter((color) => {
        const colorImage = productImages.find((image) => compactKey(firstNonEmpty(image.color_name, image.color_value)) === compactKey(color));
        return !colorImage && !productVariants.some((variant) => compactKey(firstNonEmpty(variant.color, variant.color_name, variant.color_value)) === compactKey(color) && text(variant.image_url || variant.image || variant.photo_url || variant.thumbnail_url));
      });
      if (colorsMissingImage.length) {
        addProductIssue(makeIssue({
          code: "color_without_image",
          severity: "medium",
          scope: "product",
          productId,
          message: "One or more colors have no image assignment.",
          details: { colors: colorsMissingImage },
        }));
      }
    }

    if (productImages.length) {
      const byImage = groupBy(productImages.filter((image) => text(image.image_url)), (image) => text(image.image_url));
      for (const [url, items] of byImage.entries()) {
        if (items.length > 1) {
          addProductIssue(makeIssue({
            code: "duplicate_image_assignment",
            severity: "low",
            scope: "product",
            productId,
            message: "The same image is assigned multiple times.",
            affected: items.map((item) => item.id),
            details: { image_url: trimPreview(url), count: items.length },
          }));
        }
      }
    }

    if (productVariants.length) {
      const variantByColorSize = groupBy(productVariants, (variant) => [compactKey(firstNonEmpty(variant.color, variant.color_name, variant.color_value)), compactKey(firstNonEmpty(variant.size, variant.size_name))].join("|"));
      for (const [groupKey, items] of variantByColorSize.entries()) {
        if (items.length > 1) {
          addVariantIssue(makeIssue({
            code: "duplicate_variant",
            severity: "critical",
            scope: "variant",
            productId,
            variantId: items[0]?.id || "",
            message: "Duplicate product variant combination found.",
            affected: items.map((item) => item.id),
            details: { group_key: groupKey, count: items.length },
          }));
        }
      }

      const byColor = groupBy(productVariants, (variant) => compactKey(firstNonEmpty(variant.color, variant.color_name, variant.color_value)));
      for (const [colorKey, items] of byColor.entries()) {
        if (!colorKey) continue;
        const sizeGroups = groupBy(items, (variant) => compactKey(firstNonEmpty(variant.size, variant.size_name)));
        if ([...sizeGroups.keys()].every((sizeKey) => !sizeKey)) {
          addVariantIssue(makeIssue({
            code: "color_without_sizes",
            severity: "medium",
            scope: "variant",
            productId,
            variantId: items[0]?.id || "",
            message: "Color exists but has no sizes.",
            affected: items.map((item) => item.id),
            details: { color: colorKey, count: items.length },
          }));
        }
      }

      const duplicateSizes = groupBy(productVariants, (variant) => [compactKey(firstNonEmpty(variant.color, variant.color_name, variant.color_value)), compactKey(firstNonEmpty(variant.size, variant.size_name))].join("|"));
      for (const [groupKey, items] of duplicateSizes.entries()) {
        if (items.length > 1 && groupKey.includes("|")) {
          addVariantIssue(makeIssue({
            code: "duplicate_size",
            severity: "low",
            scope: "variant",
            productId,
            variantId: items[0]?.id || "",
            message: "Duplicate size within the same color grouping.",
            affected: items.map((item) => item.id),
            details: { group_key: groupKey, count: items.length },
          }));
        }
      }

      const duplicateColors = groupBy(productVariants, (variant) => [compactKey(firstNonEmpty(variant.size, variant.size_name)), compactKey(firstNonEmpty(variant.color, variant.color_name, variant.color_value))].join("|"));
      for (const [groupKey, items] of duplicateColors.entries()) {
        if (items.length > 1 && groupKey.includes("|")) {
          addVariantIssue(makeIssue({
            code: "duplicate_color",
            severity: "low",
            scope: "variant",
            productId,
            variantId: items[0]?.id || "",
            message: "Duplicate color within the same size grouping.",
            affected: items.map((item) => item.id),
            details: { group_key: groupKey, count: items.length },
          }));
        }
      }
    }

    for (const variant of productVariants) {
      const variantId = String(variant.id);
      const variantImage = firstNonEmpty(variant.image_url, variant.image, variant.photo_url, variant.thumbnail_url);
      const variantColor = firstNonEmpty(variant.color, variant.color_name, variant.color_value);
      const variantSize = firstNonEmpty(variant.size, variant.size_name);
      const variantActive = variant.is_active !== false && !text(variant.deleted_at);

      if (!variant.product_id || !productMap.has(String(variant.product_id))) {
        addVariantIssue(makeIssue({
          code: "orphan_variant",
          severity: "critical",
          scope: "variant",
          productId: variant.product_id || "",
          variantId,
          message: "Variant does not resolve to a product.",
          details: { product_id: variant.product_id || null },
        }));
      }

      if (!variantColor && variantSize) {
        addVariantIssue(makeIssue({
          code: "size_without_color",
          severity: "medium",
          scope: "variant",
          productId,
          variantId,
          message: "Variant has a size but no color.",
        }));
      }

      if (!variantSize && variantColor && variantActive) {
        addVariantIssue(makeIssue({
          code: "variant_without_size",
          severity: "medium",
          scope: "variant",
          productId,
          variantId,
          message: "Active variant has a color but no size.",
        }));
      }

      if (!variantImage) {
        addVariantIssue(makeIssue({
          code: "missing_variant_image",
          severity: "medium",
          scope: "variant",
          productId,
          variantId,
          message: "Variant image is missing.",
        }));
      } else if (!isRemoteImage(variantImage) && !isDataImage(variantImage) && isBrokenLocalImage(variantImage)) {
        addVariantIssue(makeIssue({
          code: "broken_image_path",
          severity: "medium",
          scope: "variant",
          productId,
          variantId,
          message: "Variant image path does not resolve on disk.",
          details: { image_url: trimPreview(variantImage) },
        }));
      }

      if (variantActive && toNumber(variant.stock) <= 0 && computedTotalStock > 0) {
        addVariantIssue(makeIssue({
          code: "variant_without_stock",
          severity: "medium",
          scope: "variant",
          productId,
          variantId,
          message: "Active variant has no stock while the product is sellable.",
          details: { stock: toNumber(variant.stock) },
        }));
      }

      if (!variant.article_code && !variant.sku && !variant.barcode) {
        addVariantIssue(makeIssue({
          code: "missing_article_model_code",
          severity: "medium",
          scope: "variant",
          productId,
          variantId,
          message: "Variant is missing an article/model code.",
        }));
      }
    }

    const keywords = text(product.seo_keywords);
    if (!keywords) {
      addProductIssue(makeIssue({
        code: "missing_alias",
        severity: "medium",
        scope: "product",
        productId,
        message: "No AI-friendly alias keywords are configured.",
      }));
      addProductIssue(makeIssue({
        code: "missing_arabic_search_keywords",
        severity: "medium",
        scope: "product",
        productId,
        message: "Arabic search keywords are missing.",
      }));
      addProductIssue(makeIssue({
        code: "missing_english_search_keywords",
        severity: "medium",
        scope: "product",
        productId,
        message: "English search keywords are missing.",
      }));
    } else {
      if (!hasArabic(keywords)) {
        addProductIssue(makeIssue({
          code: "missing_arabic_search_keywords",
          severity: "medium",
          scope: "product",
          productId,
          message: "Arabic search keywords are missing.",
          details: { seo_keywords: trimPreview(keywords) },
        }));
      }
      if (!hasEnglish(keywords)) {
        addProductIssue(makeIssue({
          code: "missing_english_search_keywords",
          severity: "medium",
          scope: "product",
          productId,
          message: "English search keywords are missing.",
          details: { seo_keywords: trimPreview(keywords) },
        }));
      }
    }

    const searchQueries = unique([
      displayName,
      [product.brand, displayName].filter(Boolean).join(" "),
      [product.brand_lookup_name, displayName].filter(Boolean).join(" "),
      product.slug,
      product.canonical_slug,
      product.sku,
      product.product_code,
      [product.brand, product.product_type].filter(Boolean).join(" "),
    ]);
    const selfScores = searchQueries.map((query) => scoreProductCandidate({ product: {
      id: product.id,
      product_id: product.id,
      name: product.name,
      title: product.name,
      product_name: product.name,
      brand: firstNonEmpty(product.brand, product.brand_lookup_name),
      model: firstNonEmpty(product.product_code, product.sku, product.edition_name),
      slug: product.slug,
      canonical_slug: product.canonical_slug,
      sku: product.sku,
      barcode: product.barcode,
      category: firstNonEmpty(product.category, product.category_lookup_name),
      product_type: product.product_type,
      description: product.description,
      color: productVariants[0]?.color || "",
      sizes,
      available_sizes: sizes,
      total_stock: computedTotalStock,
      stock: computedTotalStock,
      variants: productVariants,
    }, text: query }).confidence);
    const bestSelfScore = Math.max(0, ...selfScores);
    if (bestSelfScore < 65) {
      addProductIssue(makeIssue({
        code: "ai_recommendation_confidence_issue",
        severity: "medium",
        scope: "product",
        productId,
        message: "Product is weakly discoverable by its expected keywords.",
        details: { best_self_score: bestSelfScore, queries: searchQueries.slice(0, 5) },
      }));
      addProductIssue(makeIssue({
        code: "product_cannot_be_found_by_expected_keywords",
        severity: "medium",
        scope: "product",
        productId,
        message: "Expected keywords do not reliably find this product.",
        details: { best_self_score: bestSelfScore, queries: searchQueries.slice(0, 5) },
      }));
    }

    const productUrl = buildStorefrontProductUrl({
      id: product.id,
      product_id: product.id,
      slug: product.slug,
      canonical_slug: product.canonical_slug,
      name: product.name,
      title: product.name,
      product_name: product.name,
    });
    if (!productUrl) {
      addProductIssue(makeIssue({
        code: "broken_product_url",
        severity: "critical",
        scope: "product",
        productId,
        message: "Product URL could not be generated.",
      }));
    } else if (/\/shop\/product\/\d+$/.test(productUrl)) {
      addProductIssue(makeIssue({
        code: "fallback_url_usage",
        severity: "medium",
        scope: "product",
        productId,
        message: "Product URL falls back to numeric id instead of a slug.",
        details: { product_url: productUrl },
      }));
    }
  }

  const slugGroups = groupBy(
    products.flatMap((product) => {
      const values = [product.slug, product.canonical_slug].map(text).filter(Boolean).map((value) => ({ value: slugify(value), product_id: String(product.id), product_name: productDisplayName(product), source: value }));
      return values;
    }).filter((item) => item.value),
    (item) => item.value
  );
  for (const [slug, items] of slugGroups.entries()) {
    if (items.length > 1) {
      addProductIssue(makeIssue({
        code: "duplicate_slug",
        severity: "critical",
        scope: "product",
        productId: items[0]?.product_id || "",
        message: `Duplicate slug '${slug}' is assigned to multiple products.`,
        affected: items.map((item) => item.product_id),
        details: { slug, products: items.map((item) => ({ id: item.product_id, source: item.source, name: item.product_name })) },
      }));
    }
  }

  const articleGroups = groupBy(
    variants.map((variant) => ({
      value: compactKey(firstNonEmpty(variant.article_code, variant.sku, variant.barcode)),
      variant_id: String(variant.id),
      product_id: String(variant.product_id || ""),
    })).filter((item) => item.value),
    (item) => item.value
  );
  for (const [articleCode, items] of articleGroups.entries()) {
    if (items.length > 1) {
      addVariantIssue(makeIssue({
        code: "duplicate_article_code",
        severity: "medium",
        scope: "variant",
        productId: items[0]?.product_id || "",
        variantId: items[0]?.variant_id || "",
        message: `Duplicate article code '${articleCode}' is used by multiple variants.`,
        affected: items.map((item) => item.variant_id),
        details: { article_code: articleCode, variants: items },
      }));
    }
  }

  const duplicateProductGroups = groupBy(
    products.map((product) => ({
      key: [
        compactKey(productDisplayName(product)),
        compactKey(firstNonEmpty(product.brand, product.brand_lookup_name)),
        compactKey(firstNonEmpty(product.category, product.category_lookup_name)),
        compactKey(product.product_type),
      ].join("|"),
      product_id: String(product.id),
      brand: firstNonEmpty(product.brand, product.brand_lookup_name),
      category: firstNonEmpty(product.category, product.category_lookup_name),
      manufacturer: firstNonEmpty(product.manufacturer_lookup_name, product.manufacturer_id),
    })).filter((item) => item.key.replace(/\|/g, "").length > 0),
    (item) => item.key
  );
  for (const [groupKey, items] of duplicateProductGroups.entries()) {
    if (items.length > 1) {
      const brands = unique(items.map((item) => item.brand));
      const categories = unique(items.map((item) => item.category));
      const manufacturers = unique(items.map((item) => text(item.manufacturer)));
      if (brands.length > 1) {
        addProductIssue(makeIssue({
          code: "conflicting_brands",
          severity: "medium",
          scope: "product",
          productId: items[0]?.product_id || "",
          message: "Duplicate product family has conflicting brands.",
          affected: items.map((item) => item.product_id),
          details: { group_key: groupKey, brands },
        }));
      }
      if (categories.length > 1) {
        addProductIssue(makeIssue({
          code: "conflicting_categories",
          severity: "medium",
          scope: "product",
          productId: items[0]?.product_id || "",
          message: "Duplicate product family has conflicting categories.",
          affected: items.map((item) => item.product_id),
          details: { group_key: groupKey, categories },
        }));
      }
      if (manufacturers.length > 1) {
        addProductIssue(makeIssue({
          code: "inconsistent_manufacturer",
          severity: "medium",
          scope: "product",
          productId: items[0]?.product_id || "",
          message: "Duplicate product family has inconsistent manufacturers.",
          affected: items.map((item) => item.product_id),
          details: { group_key: groupKey, manufacturers },
        }));
      }
    }
  }

  const replayRefs = extractReplayReferences(replayScenarios);
  const replayIssues = [];
  for (const productId of replayRefs.productIds) {
    const product = productMap.get(String(productId));
    if (!product) {
      replayIssues.push(makeIssue({
        code: "replay_missing_product",
        severity: "critical",
        scope: "replay",
        productId,
        message: "Replay references a product that is missing from the catalog.",
      }));
      continue;
    }
    const resolvedUrl = buildStorefrontProductUrl({
      id: product.id,
      product_id: product.id,
      slug: product.slug,
      canonical_slug: product.canonical_slug,
      name: product.name,
      title: product.name,
      product_name: product.name,
    });
    if (!resolvedUrl) {
      replayIssues.push(makeIssue({
        code: "replay_unavailable_url",
        severity: "critical",
        scope: "replay",
        productId,
        message: "Replay product no longer resolves to a storefront URL.",
      }));
    }
  }
  for (const variantId of replayRefs.variantIds) {
    const variant = variants.find((item) => String(item.id) === String(variantId));
    if (!variant) {
      replayIssues.push(makeIssue({
        code: "replay_missing_variant",
        severity: "critical",
        scope: "replay",
        variantId,
        message: "Replay references a variant that is missing from the catalog.",
      }));
    }
  }
  for (const url of replayRefs.urls) {
    const identifier = queryByProductUrlId(url);
    if (!identifier) continue;
    if (/^\d+$/.test(identifier)) {
      if (!productMap.has(String(identifier))) {
        replayIssues.push(makeIssue({
          code: "replay_unavailable_url",
          severity: "critical",
          scope: "replay",
          productId: identifier,
          message: "Replay references a storefront URL that no longer resolves.",
          details: { url },
        }));
      }
    } else {
      const matched = products.find((product) => slugify(product.slug) === slugify(identifier) || slugify(product.canonical_slug) === slugify(identifier));
      if (!matched) {
        replayIssues.push(makeIssue({
          code: "replay_unavailable_url",
          severity: "critical",
          scope: "replay",
          message: "Replay references a storefront slug that no longer resolves.",
          details: { url },
        }));
      }
    }
  }

  for (const issue of replayIssues) pushIssue(issueBucket, issue);

  const issues = [...issueBucket.values()].sort((left, right) => {
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) return severityDiff;
    const leftImpact = (left.affected_ids || []).length;
    const rightImpact = (right.affected_ids || []).length;
    if (rightImpact !== leftImpact) return rightImpact - leftImpact;
    return text(left.message).localeCompare(text(right.message));
  });

  const counts = issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, { critical: 0, medium: 0, low: 0 });

  const totalIssues = issues.length;
  const aiReadinessScore = Math.max(0, Math.round(100 - counts.critical * 6 - counts.medium * 2 - counts.low * 0.5));
  const summary = {
    products_checked: aiFacingProducts.length,
    variants_checked: aiFacingVariants.length,
    images_checked: imagesChecked,
    total_issues: totalIssues,
    critical_issues: counts.critical,
    medium_issues: counts.medium,
    low_issues: counts.low,
    ai_readiness_score: aiReadinessScore,
    excluded_products: excludedProducts.length,
    replay_products_checked: replayRefs.productIds.length,
    replay_variants_checked: replayRefs.variantIds.length,
    replay_urls_checked: replayRefs.urls.length,
    replay_missing_references: replayIssues.length,
  };

  const report = {
    generated_at: new Date().toISOString(),
    fixture_path: path.relative(process.cwd(), fixturePath),
    summary,
    issues,
  };

  return { report, issues, summary };
});

const main = async () => {
  const { report, issues, summary } = await scanIntegrity();

  await mkdir(reportsDir, { recursive: true });
  await writeFile(jsonReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(mdReportPath, `${buildMarkdown({ summary, issues })}\n`, "utf8");

  console.log("AI Data Integrity Suite");
  console.log(`Products checked: ${summary.products_checked}`);
  console.log(`Variants checked: ${summary.variants_checked}`);
  console.log(`Images checked: ${summary.images_checked}`);
  console.log(`Excluded non-AI-facing products: ${summary.excluded_products}`);
  console.log(`Total issues: ${summary.total_issues}`);
  console.log(`Critical: ${summary.critical_issues}  Medium: ${summary.medium_issues}  Low: ${summary.low_issues}`);
  console.log(`AI Readiness Score: ${summary.ai_readiness_score}%`);
  console.log("Top 20 problems to fix first:");
  issues.slice(0, 20).forEach((issue, index) => {
    console.log(`${index + 1}. [${issue.severity}] ${issue.code} - ${issue.message}`);
  });
  if (!issues.length) {
    console.log("No integrity issues found.");
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

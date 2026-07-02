import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db, { withReadOnlyDbSession } from "../database/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const reportPath = path.join(repoRoot, "server", "reports", "ai-data-integrity-report.json");
const mdPath = path.join(repoRoot, "server", "reports", "ai-data-remediation-plan.md");
const csvPath = path.join(repoRoot, "server", "reports", "ai-data-remediation-export.csv");

const severityRank = { critical: 0, medium: 1, low: 2 };
const issuePriority = new Map([
  ["duplicate_slug", 0],
  ["missing_price_source", 1],
  ["zero_selling_price", 2],
  ["available_with_zero_stock", 3],
  ["inconsistent_total_stock", 4],
  ["duplicate_article_code", 5],
  ["variant_without_stock", 6],
  ["missing_main_image", 7],
  ["missing_variant_image", 8],
  ["missing_alias", 9],
  ["missing_arabic_search_keywords", 10],
  ["missing_english_search_keywords", 11],
  ["missing_brand", 12],
  ["missing_category", 13],
  ["missing_product_type", 14],
  ["product_cannot_be_found_by_expected_keywords", 15],
  ["ai_recommendation_confidence_issue", 16],
]);

const issueTypeLabel = (code = "") => ({
  duplicate_slug: "Duplicate slugs",
  missing_price_source: "Missing price source",
  zero_selling_price: "Zero selling price",
  available_with_zero_stock: "Available with zero stock",
  inconsistent_total_stock: "Stock inconsistencies",
  duplicate_article_code: "Duplicate article codes",
  variant_without_stock: "Variant stock gaps",
  missing_main_image: "Missing main images",
  missing_variant_image: "Missing variant images",
  missing_alias: "Missing alias keywords",
  missing_arabic_search_keywords: "Missing Arabic search keywords",
  missing_english_search_keywords: "Missing English search keywords",
  missing_brand: "Missing brand",
  missing_category: "Missing category",
  missing_product_type: "Missing product type",
  product_cannot_be_found_by_expected_keywords: "Search discoverability failures",
  ai_recommendation_confidence_issue: "Low AI recommendation confidence",
}[code] || code.replaceAll("_", " "));

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const unique = (values = []) => [...new Set(values.filter(Boolean).map((value) => String(value)))];

const csvEscape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const toCsv = (rows = []) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
};

const text = (value = "") => String(value ?? "").trim();

const normalizeProduct = (row = {}) => ({
  id: text(row.id),
  name: text(row.name) || `Product ${row.id}`,
  slug: text(row.slug),
  canonical_slug: text(row.canonical_slug),
  is_active: Boolean(row.is_active),
  status: text(row.status),
  stock: Number(row.stock ?? 0),
  selling_price: Number(row.selling_price ?? 0),
  sale_price: Number(row.sale_price ?? 0),
  image_url: text(row.image_url),
  product_type: text(row.product_type),
  tenant_id: text(row.tenant_id),
});

const normalizeVariant = (row = {}) => ({
  id: text(row.id),
  product_id: text(row.product_id),
  color: text(row.color),
  size: text(row.size),
  stock: Number(row.stock ?? 0),
  is_active: Boolean(row.is_active),
  article_code: text(row.article_code),
  image_url: text(row.image_url),
});

const safeSlugRepair = (slug = "", productId = "") => {
  const base = text(slug).replace(/-p\d+$/i, "");
  if (!base) return "";
  return `${base}-p${productId}`;
};

const formatMoney = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : text(value);
};

const loadLookups = async (report) => {
  const productIds = unique(report.issues.flatMap((issue) => [issue.product_id, ...(Array.isArray(issue.affected_ids) ? issue.affected_ids : [])]));
  const variantIds = unique(report.issues.map((issue) => issue.variant_id));

  const productRows = productIds.length
    ? (await db.query(
        `SELECT id, name, slug, canonical_slug, is_active, status, stock, selling_price, sale_price, image_url, product_type, tenant_id
         FROM products
         WHERE id = ANY($1::bigint[])
         ORDER BY id`,
        [productIds]
      )).rows
    : [];

  const variantRows = variantIds.length
    ? (await db.query(
        `SELECT id, product_id, color, size, stock, is_active, article_code, image_url
         FROM product_variants
         WHERE id = ANY($1::bigint[])
         ORDER BY product_id, id`,
        [variantIds]
      )).rows
    : [];

  const productsById = new Map(productRows.map((row) => [text(row.id), normalizeProduct(row)]));
  const variantsById = new Map(variantRows.map((row) => [text(row.id), normalizeVariant(row)]));
  const variantsByProductId = new Map();
  for (const variant of variantsById.values()) {
    const bucket = variantsByProductId.get(variant.product_id) || [];
    bucket.push(variant);
    variantsByProductId.set(variant.product_id, bucket);
  }

  return { productsById, variantsById, variantsByProductId };
};

const productNameFor = (productsById, id) => productsById.get(text(id))?.name || `Product ${id}`;

const variantFor = (variantsById, id) => variantsById.get(text(id)) || null;

const buildRows = (report, lookups) => {
  const { productsById, variantsById, variantsByProductId } = lookups;
  const rows = [];

  const pushRow = (row) => {
    rows.push({
      severity: row.severity,
      issue_type: row.issue_type,
      product_id: row.product_id,
      product_name: row.product_name,
      variant_id: row.variant_id || "",
      color: row.color || "",
      size: row.size || "",
      current_value: row.current_value || "",
      suggested_value: row.suggested_value || "",
      safe_auto_fix_candidate: String(Boolean(row.safe_auto_fix_candidate)),
      requires_manual_decision: String(Boolean(row.requires_manual_decision)),
      recommended_action: row.recommended_action || "",
      notes: row.notes || "",
    });
  };

  for (const issue of report.issues) {
    const code = issue.code;
    const severity = issue.severity || "medium";
    const issueType = issueTypeLabel(code);
    const recommendedActionByCode = {
      duplicate_slug: "review and assign canonical slug with redirect plan",
      missing_price_source: "enter selling price manually",
      zero_selling_price: "enter selling price manually",
      available_with_zero_stock: "mark unavailable or update stock",
      inconsistent_total_stock: "reconcile product stock with variant stock",
      duplicate_article_code: "review article codes manually",
      variant_without_stock: "reconcile or retire the variant",
      missing_main_image: "upload/fix main image or approve fallback",
      missing_variant_image: "upload/fix variant image or approve fallback",
      missing_alias: "add AI-friendly alias keywords",
      missing_arabic_search_keywords: "add Arabic search keywords",
      missing_english_search_keywords: "add English search keywords",
      missing_brand: "fill brand manually",
      missing_category: "fill category manually",
      missing_product_type: "fill product type manually",
      product_cannot_be_found_by_expected_keywords: "improve aliases and keyword coverage",
      ai_recommendation_confidence_issue: "improve aliases and keyword coverage",
    }[code] || "review manually";

    if (code === "duplicate_slug") {
      const affectedIds = unique([issue.product_id, ...(Array.isArray(issue.affected_ids) ? issue.affected_ids : [])]);
      const slug = text(issue.details?.slug || issue.message.match(/'([^']+)'/)?.[1] || "");
      for (const productId of affectedIds) {
        const product = productsById.get(productId);
        const currentSlug = slug || product?.slug || "";
        pushRow({
          severity,
          issue_type: issueType,
          product_id: productId,
          product_name: product?.name || productNameFor(productsById, productId),
          variant_id: "",
          color: "",
          size: "",
          current_value: `slug=${currentSlug}`,
          suggested_value: safeSlugRepair(currentSlug, productId),
          safe_auto_fix_candidate: false,
          requires_manual_decision: true,
          recommended_action: recommendedActionByCode,
          notes: `Public URL risk. Redirects required after manual approval. Affected products: ${affectedIds.join(", ")}. DB slug: ${product?.slug || ""}. Canonical proposal: keep primary slug and append product id for duplicates.`,
        });
      }
      continue;
    }

    if (code === "duplicate_article_code") {
      const productId = text(issue.product_id);
      const variantId = text(issue.variant_id);
      const variant = variantFor(variantsById, variantId);
      const product = productsById.get(productId);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: variantId,
        color: variant?.color || "",
        size: variant?.size || "",
        current_value: `article_code=${variant?.article_code || issue.details?.article_code || ""}`,
        suggested_value: "",
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: "Do not auto-change article codes unless the code is a clearly generated placeholder and business approves.",
      });
      continue;
    }

    if (code === "zero_selling_price" || code === "missing_price_source") {
      const productId = text(issue.product_id);
      const product = productsById.get(productId);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: "",
        color: "",
        size: "",
        current_value: `selling_price=${formatMoney(product?.selling_price)}; sale_price=${formatMoney(product?.sale_price)}; display_price=${formatMoney(product?.selling_price || product?.sale_price)}`,
        suggested_value: "",
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: "Never invent prices. Use admin UI/export workflow for manual completion.",
      });
      continue;
    }

    if (code === "inconsistent_total_stock") {
      const productId = text(issue.product_id);
      const product = productsById.get(productId);
      const productVariants = variantsByProductId.get(productId) || [];
      const variantStockSum = productVariants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
      const activeVariantStockSum = productVariants.filter((variant) => variant.is_active).reduce((sum, variant) => sum + Number(variant.stock || 0), 0);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: "",
        color: "",
        size: "",
        current_value: `product_stock=${formatMoney(product?.stock)}; variant_stock_sum=${variantStockSum}; active_variant_stock_sum=${activeVariantStockSum}`,
        suggested_value: `derive from variant stock (${variantStockSum})`,
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: "Derive AI-facing availability from active variant stock where the product is variant-managed; do not write back automatically.",
      });
      continue;
    }

    if (code === "available_with_zero_stock") {
      const productId = text(issue.product_id);
      const product = productsById.get(productId);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: "",
        color: "",
        size: "",
        current_value: `stock=${formatMoney(product?.stock)}; status=${product?.status || ""}; is_active=${String(product?.is_active ?? "")}`,
        suggested_value: "",
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: "Product is active but has no stock. Keep AI from treating it as sellable until stock is reconciled.",
      });
      continue;
    }

    if (code === "variant_without_stock") {
      const productId = text(issue.product_id);
      const variantId = text(issue.variant_id);
      const product = productsById.get(productId);
      const variant = variantFor(variantsById, variantId);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: variantId,
        color: variant?.color || "",
        size: variant?.size || "",
        current_value: `stock=${formatMoney(variant?.stock)}; is_active=${String(variant?.is_active ?? "")}`,
        suggested_value: "",
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: "Variant is active but out of stock. Reconcile stock or retire from sellable catalog.",
      });
      continue;
    }

    if (code === "missing_main_image") {
      const productId = text(issue.product_id);
      const product = productsById.get(productId);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: "",
        color: "",
        size: "",
        current_value: "main image missing",
        suggested_value: product?.image_url ? "use product main image fallback" : "",
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: product?.image_url
          ? "Fallback can be approved for AI display only; verify business policy before reusing the product main image."
          : "No main image fallback is available in the catalog row.",
      });
      continue;
    }

    if (code === "missing_variant_image") {
      const productId = text(issue.product_id);
      const variantId = text(issue.variant_id);
      const product = productsById.get(productId);
      const variant = variantFor(variantsById, variantId);
      pushRow({
        severity,
        issue_type: issueType,
        product_id: productId,
        product_name: product?.name || productNameFor(productsById, productId),
        variant_id: variantId,
        color: variant?.color || "",
        size: variant?.size || "",
        current_value: "variant image missing",
        suggested_value: product?.image_url ? "use product main image fallback" : "",
        safe_auto_fix_candidate: false,
        requires_manual_decision: true,
        recommended_action: recommendedActionByCode,
        notes: product?.image_url
          ? "Fallback possible only with business approval; do not mutate the image record automatically."
          : "No product-level fallback image exists in the current product row.",
      });
      continue;
    }

    const productId = text(issue.product_id);
    const variantId = text(issue.variant_id);
    const product = productsById.get(productId);
    const variant = variantFor(variantsById, variantId);
    pushRow({
      severity,
      issue_type: issueType,
      product_id: productId,
      product_name: product?.name || productNameFor(productsById, productId),
      variant_id: variantId,
      color: variant?.color || "",
      size: variant?.size || "",
      current_value: text(issue.details ? JSON.stringify(issue.details) : issue.message),
      suggested_value: "",
      safe_auto_fix_candidate: false,
      requires_manual_decision: true,
      recommended_action: recommendedActionByCode,
      notes: "Manual review required.",
    });
  }

  return rows.sort((left, right) => {
    const severityDiff = (severityRank[left.severity] ?? 99) - (severityRank[right.severity] ?? 99);
    if (severityDiff !== 0) return severityDiff;
    const issueDiff = (issuePriority.get(left.issue_type) ?? 999) - (issuePriority.get(right.issue_type) ?? 999);
    if (issueDiff !== 0) return issueDiff;
    const productDiff = Number(left.product_id || 0) - Number(right.product_id || 0);
    if (productDiff !== 0) return productDiff;
    return Number(left.variant_id || 0) - Number(right.variant_id || 0);
  });
};

const buildMarkdown = (report, rows) => {
  const summaryBySeverity = report.issues.reduce((acc, issue) => {
    acc[issue.severity] = (acc[issue.severity] || 0) + 1;
    return acc;
  }, {});

  const summaryByCode = Object.entries(report.issues.reduce((acc, issue) => {
    acc[issue.code] = (acc[issue.code] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);

  const top20 = rows.slice(0, 20);
  const criticalRows = rows.filter((row) => row.severity === "critical");
  const autoFixCandidates = rows.filter((row) => row.safe_auto_fix_candidate === "true");
  const manualRows = rows.filter((row) => row.requires_manual_decision === "true");

  const table = (items, columns) => {
    if (!items.length) return "_None_";
    const header = `| ${columns.join(" | ")} |`;
    const divider = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = items.map((row) => `| ${columns.map((column) => String(row[column] ?? "").replaceAll("|", "\\|")).join(" | ")} |`).join("\n");
    return [header, divider, body].join("\n");
  };

  return `# AI Data Remediation Plan

Source: \`server/reports/ai-data-integrity-report.json\`

## Summary

- Products checked: ${report.summary.products_checked}
- Variants checked: ${report.summary.variants_checked}
- Images checked: ${report.summary.images_checked}
- Total issues: ${report.summary.total_issues}
- Critical: ${report.summary.critical_issues}
- Medium: ${report.summary.medium_issues}
- Low: ${report.summary.low_issues}
- AI Readiness Score: ${report.summary.ai_readiness_score}%
- CSV rows exported: ${rows.length}

## Summary by Severity

| Severity | Count |
| --- | ---: |
| critical | ${summaryBySeverity.critical || 0} |
| medium | ${summaryBySeverity.medium || 0} |
| low | ${summaryBySeverity.low || 0} |

## Summary by Issue Type

| Issue Type | Count |
| --- | ---: |
${summaryByCode.map(([code, count]) => `| ${issueTypeLabel(code)} (\`${code}\`) | ${count} |`).join("\n")}

## Top 20 Priority Fixes

| Severity | Issue Type | Product ID | Product Name | Variant ID | Current Value | Suggested Value | Recommended Action |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
${top20.map((row) => `| ${row.severity} | ${row.issue_type} | ${row.product_id} | ${row.product_name} | ${row.variant_id || ""} | ${String(row.current_value || "").replaceAll("|", "\\|")} | ${String(row.suggested_value || "").replaceAll("|", "\\|")} | ${String(row.recommended_action || "").replaceAll("|", "\\|")} |`).join("\n")}

## Safe Auto-Fix Candidates

${autoFixCandidates.length ? table(autoFixCandidates.slice(0, 20), ["severity", "issue_type", "product_id", "product_name", "variant_id", "recommended_action"]) : "_None flagged for auto-apply. This export is review-only._"}

## Manual Decision Required

${manualRows.length ? `${manualRows.length} rows require manual review before any catalog change.` : "_None_"}

## Notes

- Duplicate slugs should be repaired deterministically in a separate change plan, then paired with redirect handling.
- Prices must be entered manually. Do not invent a value.
- Stock should be reconciled from variant truth where the product is variant-managed.
- Image fallback can only be used if business-approved.
- Broken URL and orphan/invalid variant codes were not present in this report.
`;
};

const run = async () => {
  const report = await readJson(reportPath);
  const lookups = await withReadOnlyDbSession(async () => loadLookups(report), { is_integrity_export: true, dry_run: true });
  const rows = buildRows(report, lookups);
  const csv = toCsv(rows);
  const markdown = buildMarkdown(report, rows);

  await fs.writeFile(csvPath, csv, "utf8");
  await fs.writeFile(mdPath, markdown, "utf8");

  const issueCounts = report.issues.reduce((acc, issue) => {
    acc[issue.code] = (acc[issue.code] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({
    report_path: reportPath,
    markdown_path: mdPath,
    csv_path: csvPath,
    csv_rows: rows.length,
    top_issue_groups: Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([code, count]) => ({ code, count })),
    auto_fix_candidates: rows.filter((row) => row.safe_auto_fix_candidate === "true").length,
  }, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

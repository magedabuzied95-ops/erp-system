// READ-ONLY catalog synchronization:
//   listings  - GET_MERCHANT_LISTINGS_ALL_DATA report (+ Listings Items issues when a seller id is set)
//   inventory - FBA Inventory summaries (merchant quantities come from the listings report)
//   pricing   - Product Pricing v0 getPricing for our own offer price
// Comparison queries for the UI join these with M1 stock and the canonical M1 customer price.

import db from "../../database/db.js";
import { resolveEffectiveCustomerPrice } from "../../../src/shared/lib/effectiveCustomerPrice.js";
import { loadTenantSaleModeSettings } from "../../utils/customerDisplayPrice.js";
import { amazonMarketplaceId, amazonProductUrl } from "./amazonConfig.js";
import {
  createReport,
  downloadReportDocument,
  getInventorySummaries,
  getListingsItem,
  getPricingForSkus,
  getReport,
  getReportDocument,
} from "./amazonApi.js";
import { AMAZON_AUDIT_EVENTS, auditAmazon } from "./amazonAudit.js";
import { AMAZON_ERROR_CATEGORY, AmazonApiError, redactAmazonText, toSafeError } from "./amazonErrors.js";
import { refreshSkuSuggestions } from "./amazonSkuMapping.js";
import { resolveSellerId } from "./amazonConnectionService.js";
import { finishSyncRun, startSyncRun, withAmazonJobLock } from "./amazonSyncRuns.js";

const LISTINGS_REPORT_TYPE = "GET_MERCHANT_LISTINGS_ALL_DATA";
const REPORT_POLL_MS = 20_000;
const REPORT_MAX_WAIT_MS = 20 * 60 * 1000;
const MAX_ISSUE_LOOKUPS = 300;
const MAX_PRICED_SKUS = 1000;

const sleepDefault = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value, max = 200) => {
  const clean = String(value ?? "").trim();
  return clean ? redactAmazonText(clean, max) : null;
};
const num = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return String(value ?? "").trim() !== "" && Number.isFinite(parsed) ? parsed : null;
};

// ---------------------------------------------------------------- report parsing (pure)
export const parseListingsReport = (content = "") => {
  const lines = String(content).replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return [];
  const header = lines[0].split("\t").map((name) => name.trim().toLowerCase());
  const index = (...names) => names.map((name) => header.indexOf(name)).find((position) => position >= 0) ?? -1;
  const col = {
    sku: index("seller-sku", "sku"),
    asin: index("asin1", "asin", "product-id"),
    title: index("item-name", "title"),
    price: index("price"),
    quantity: index("quantity"),
    openDate: index("open-date"),
    channel: index("fulfillment-channel"),
    status: index("status"),
  };
  if (col.sku < 0) throw new AmazonApiError("listings report has no seller-sku column", { category: AMAZON_ERROR_CATEGORY.INVALID_REQUEST, operation: "parseListingsReport" });
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const at = (position) => (position >= 0 ? cells[position] : "");
    const opened = at(col.openDate) ? new Date(String(at(col.openDate)).replace(/ ([A-Z]{3,4})$/, "")) : null;
    return {
      seller_sku: text(at(col.sku), 120),
      asin: text(at(col.asin), 20),
      title: text(at(col.title), 300),
      listing_price: num(at(col.price)),
      merchant_quantity: num(at(col.quantity)) === null ? null : Math.trunc(num(at(col.quantity))),
      opened_at: opened && !Number.isNaN(opened.getTime()) ? opened : null,
      fulfillment_channel: text(at(col.channel), 40),
      listing_status: text(at(col.status), 40),
    };
  }).filter((row) => row.seller_sku);
};

const waitForReport = async ({ spApi, reportId, sleep, now }) => {
  const deadline = now() + REPORT_MAX_WAIT_MS;
  while (true) {
    const report = await getReport({ spApi, reportId });
    const status = report?.processingStatus;
    if (status === "DONE") return { status, documentId: report.reportDocumentId };
    if (status === "CANCELLED") return { status, documentId: null }; // Amazon cancels reports that have no data
    if (status === "FATAL") {
      throw new AmazonApiError("Amazon could not generate the listings report (FATAL)", { category: AMAZON_ERROR_CATEGORY.UPSTREAM, operation: "getReport" });
    }
    if (now() > deadline) {
      throw new AmazonApiError("the listings report is still processing; try again later", { category: AMAZON_ERROR_CATEGORY.UPSTREAM, operation: "getReport", retryable: true });
    }
    await sleep(REPORT_POLL_MS);
  }
};

const upsertListing = async ({ tenantId, row, database }) => {
  await database.query(
    `INSERT INTO amazon_listings (tenant_id, marketplace_id, seller_sku, asin, title, listing_status, fulfillment_channel,
                                  merchant_quantity, listing_price, currency_code, opened_at, last_seen_at, last_synced_at, removed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'EGP',$10, NOW(), NOW(), NULL)
     ON CONFLICT (tenant_id, marketplace_id, lower(seller_sku)) DO UPDATE SET
       seller_sku = EXCLUDED.seller_sku, asin = COALESCE(EXCLUDED.asin, amazon_listings.asin),
       title = COALESCE(EXCLUDED.title, amazon_listings.title), listing_status = EXCLUDED.listing_status,
       fulfillment_channel = EXCLUDED.fulfillment_channel, merchant_quantity = EXCLUDED.merchant_quantity,
       listing_price = EXCLUDED.listing_price, opened_at = COALESCE(EXCLUDED.opened_at, amazon_listings.opened_at),
       last_seen_at = NOW(), last_synced_at = NOW(), removed_at = NULL`,
    [tenantId, amazonMarketplaceId(), row.seller_sku, row.asin, row.title, row.listing_status, row.fulfillment_channel, row.merchant_quantity, row.listing_price, row.opened_at]
  );
  await database.query(
    `INSERT INTO amazon_sku_mappings (tenant_id, marketplace_id, seller_sku, asin, amazon_title, status)
     VALUES ($1, $2, $3, $4, $5, 'unmapped')
     ON CONFLICT (tenant_id, marketplace_id, lower(seller_sku)) DO UPDATE SET
       asin = COALESCE(EXCLUDED.asin, amazon_sku_mappings.asin),
       amazon_title = COALESCE(EXCLUDED.amazon_title, amazon_sku_mappings.amazon_title),
       updated_at = NOW()`,
    [tenantId, amazonMarketplaceId(), row.seller_sku, row.asin, row.title]
  );
};

const summarizeIssues = (issues = []) =>
  (Array.isArray(issues) ? issues : []).slice(0, 20).map((issue) => ({
    code: text(issue.code, 60),
    severity: text(issue.severity, 10),
    message: text(issue.message, 300),
    attributes: Array.isArray(issue.attributeNames) ? issue.attributeNames.slice(0, 5).map((name) => text(name, 60)) : [],
  }));

const runJob = async ({ jobType, tenantId, trigger, requestedBy, req, database, auditEvent, work }) =>
  withAmazonJobLock(jobType, async () => {
    const run = await startSyncRun({ tenantId, jobType, trigger, requestedBy, database });
    const counts = { read: 0, created: 0, updated: 0, failed: 0 };
    try {
      const details = (await work({ runId: run.id, counts })) || {};
      const status = counts.failed > 0 ? "partial" : "succeeded";
      await finishSyncRun({ runId: run.id, status, counts, details, database });
      await auditAmazon({ req, tenantId, eventType: auditEvent, outcome: status, details: { trigger, sync_run_id: run.id, read: counts.read, updated: counts.updated, failed: counts.failed } });
      return { runId: run.id, status, counts, details };
    } catch (error) {
      const safe = toSafeError(error);
      await finishSyncRun({ runId: run.id, status: "failed", counts, error, database });
      await auditAmazon({ req, tenantId, eventType: AMAZON_AUDIT_EVENTS.SYNC_FAILED, outcome: "failure", details: { job: jobType, trigger, sync_run_id: run.id, category: safe.category } });
      return { runId: run.id, status: "failed", counts, error: safe };
    }
  }, { database });

// ---------------------------------------------------------------- listings
export const runAmazonListingsSync = async ({ tenantId, trigger = "manual", requestedBy = null, req = null, spApi = null, database = db, sleep = sleepDefault, now = () => Date.now() } = {}) =>
  runJob({
    jobType: "listings",
    tenantId,
    trigger,
    requestedBy,
    req,
    database,
    auditEvent: AMAZON_AUDIT_EVENTS.LISTINGS_READ,
    work: async ({ counts }) => {
      const reportId = await createReport({ spApi, reportType: LISTINGS_REPORT_TYPE });
      if (!reportId) throw new AmazonApiError("Amazon did not return a report id", { category: AMAZON_ERROR_CATEGORY.UPSTREAM, operation: "createReport" });
      const { status, documentId } = await waitForReport({ spApi, reportId, sleep, now });
      let rows = [];
      if (status === "DONE" && documentId) {
        const document = await getReportDocument({ spApi, reportDocumentId: documentId });
        const content = await downloadReportDocument({ spApi, document });
        rows = parseListingsReport(content);
      }
      const syncStartedAt = new Date(now());
      for (const row of rows) {
        counts.read += 1;
        try {
          await upsertListing({ tenantId, row, database });
          counts.updated += 1;
        } catch {
          counts.failed += 1;
        }
      }
      // Listings missing from a complete report are gone from Amazon.
      if (status === "DONE") {
        await database.query(
          `UPDATE amazon_listings SET removed_at = NOW()
           WHERE tenant_id = $1 AND marketplace_id = $2 AND removed_at IS NULL AND last_seen_at < $3`,
          [tenantId, amazonMarketplaceId(), syncStartedAt]
        );
      }

      // Listing issues (needs the merchant token).
      const sellerId = await resolveSellerId({ tenantId, database });
      let issuesChecked = 0;
      let issuesError = null;
      if (sellerId) {
        const skus = await database.query(
          `SELECT seller_sku FROM amazon_listings WHERE tenant_id = $1 AND marketplace_id = $2 AND removed_at IS NULL
           ORDER BY (lower(COALESCE(listing_status,'')) = 'active'), issues_synced_at NULLS FIRST LIMIT $3`,
          [tenantId, amazonMarketplaceId(), MAX_ISSUE_LOOKUPS]
        );
        for (const { seller_sku: sku } of skus.rows) {
          try {
            const item = await getListingsItem({ spApi, sellerId, sku });
            const summary = (item?.summaries || []).find((entry) => entry.marketplaceId === amazonMarketplaceId()) || item?.summaries?.[0] || {};
            const offer = (item?.offers || []).find((entry) => entry.marketplaceId === amazonMarketplaceId() && entry.offerType !== "B2B");
            const issues = summarizeIssues(item?.issues);
            await database.query(
              `UPDATE amazon_listings SET issues = $4::jsonb, issue_count = $5, error_count = $6, issues_synced_at = NOW(),
                 product_type = COALESCE($7, product_type), asin = COALESCE(asin, $8),
                 offer_price = COALESCE($9, offer_price), offer_currency_code = COALESCE($10, offer_currency_code),
                 price_synced_at = CASE WHEN $9::numeric IS NULL THEN price_synced_at ELSE NOW() END
               WHERE tenant_id = $1 AND marketplace_id = $2 AND lower(seller_sku) = lower($3)`,
              [tenantId, amazonMarketplaceId(), sku, JSON.stringify(issues), issues.length, issues.filter((issue) => issue.severity === "ERROR").length,
                text(summary.productType, 80), text(summary.asin, 20), num(offer?.price?.amount), text(offer?.price?.currencyCode, 8)]
            );
            issuesChecked += 1;
          } catch (error) {
            const safe = toSafeError(error);
            if (safe.category === AMAZON_ERROR_CATEGORY.AUTHORIZATION || safe.category === AMAZON_ERROR_CATEGORY.RATE_LIMITED) {
              issuesError = safe;
              break;
            }
            counts.failed += 1;
          }
        }
      }

      const suggestions = await refreshSkuSuggestions({ tenantId, database });
      return {
        report_status: status,
        listings_in_report: rows.length,
        issues_checked: issuesChecked,
        issues_skipped_reason: sellerId ? issuesError?.category || null : "seller_id_not_configured",
        suggestions,
      };
    },
  });

// ---------------------------------------------------------------- FBA inventory
export const runAmazonInventorySync = async ({ tenantId, trigger = "manual", requestedBy = null, req = null, spApi = null, database = db } = {}) =>
  runJob({
    jobType: "inventory",
    tenantId,
    trigger,
    requestedBy,
    req,
    database,
    auditEvent: AMAZON_AUDIT_EVENTS.INVENTORY_READ,
    work: async ({ counts }) => {
      let nextToken = null;
      let pages = 0;
      let fbaAvailable = true;
      try {
        do {
          const page = await getInventorySummaries({ spApi, nextToken });
          pages += 1;
          for (const summary of page.summaries) {
            if (!summary?.sellerSku) continue;
            counts.read += 1;
            const details = summary.inventoryDetails || {};
            const inbound = (Number(details.inboundWorkingQuantity) || 0) + (Number(details.inboundShippedQuantity) || 0) + (Number(details.inboundReceivingQuantity) || 0);
            try {
              await database.query(
                `INSERT INTO amazon_fba_inventory (tenant_id, marketplace_id, seller_sku, asin, fn_sku, condition_type,
                   fulfillable_qty, inbound_qty, reserved_qty, unfulfillable_qty, total_qty, amazon_updated_at, last_synced_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
                 ON CONFLICT (tenant_id, marketplace_id, lower(seller_sku)) DO UPDATE SET
                   asin = EXCLUDED.asin, fn_sku = EXCLUDED.fn_sku, condition_type = EXCLUDED.condition_type,
                   fulfillable_qty = EXCLUDED.fulfillable_qty, inbound_qty = EXCLUDED.inbound_qty,
                   reserved_qty = EXCLUDED.reserved_qty, unfulfillable_qty = EXCLUDED.unfulfillable_qty,
                   total_qty = EXCLUDED.total_qty, amazon_updated_at = EXCLUDED.amazon_updated_at, last_synced_at = NOW()`,
                [tenantId, amazonMarketplaceId(), text(summary.sellerSku, 120), text(summary.asin, 20), text(summary.fnSku, 20), text(summary.condition, 40),
                  Number(details.fulfillableQuantity) || 0, inbound, Number(details.reservedQuantity?.totalReservedQuantity) || 0,
                  Number(details.unfulfillableQuantity?.totalUnfulfillableQuantity) || 0, Number(summary.totalQuantity) || 0,
                  summary.lastUpdatedTime ? new Date(summary.lastUpdatedTime) : null]
              );
              counts.updated += 1;
            } catch {
              counts.failed += 1;
            }
          }
          nextToken = page.nextToken;
        } while (nextToken && pages < 100);
      } catch (error) {
        const safe = toSafeError(error);
        // No FBA program / role for this marketplace: merchant quantities still come from listings.
        if (safe.category === AMAZON_ERROR_CATEGORY.AUTHORIZATION || safe.status === 400 || safe.status === 404) {
          fbaAvailable = false;
        } else {
          throw error;
        }
      }
      return { fba_available: fbaAvailable, pages };
    },
  });

// ---------------------------------------------------------------- pricing
export const extractOwnOfferPrice = (entry = {}) => {
  if (String(entry?.status || "").toLowerCase() !== "success") return null;
  const offers = entry?.Product?.Offers || [];
  const own = offers.find((offer) => String(offer?.SellerSKU || "").toLowerCase() === String(entry.SellerSKU || "").toLowerCase()) || offers[0];
  const listing = own?.BuyingPrice?.ListingPrice;
  const value = Number(listing?.Amount);
  return Number.isFinite(value) ? { amount: Math.round(value * 100) / 100, currency: text(listing?.CurrencyCode, 8) } : null;
};

export const runAmazonPricingSync = async ({ tenantId, trigger = "manual", requestedBy = null, req = null, spApi = null, database = db } = {}) =>
  runJob({
    jobType: "pricing",
    tenantId,
    trigger,
    requestedBy,
    req,
    database,
    auditEvent: AMAZON_AUDIT_EVENTS.PRICING_READ,
    work: async ({ counts }) => {
      const result = await database.query(
        `SELECT seller_sku FROM amazon_listings
         WHERE tenant_id = $1 AND marketplace_id = $2 AND removed_at IS NULL
         ORDER BY price_synced_at NULLS FIRST LIMIT $3`,
        [tenantId, amazonMarketplaceId(), MAX_PRICED_SKUS]
      );
      const skus = result.rows.map((row) => row.seller_sku);
      for (let start = 0; start < skus.length; start += 20) {
        const batch = skus.slice(start, start + 20);
        const entries = await getPricingForSkus({ spApi, skus: batch });
        for (const entry of entries) {
          counts.read += 1;
          const price = extractOwnOfferPrice(entry);
          if (!price) {
            counts.failed += 1;
            continue;
          }
          await database.query(
            `UPDATE amazon_listings SET offer_price = $4, offer_currency_code = $5, price_synced_at = NOW()
             WHERE tenant_id = $1 AND marketplace_id = $2 AND lower(seller_sku) = lower($3)`,
            [tenantId, amazonMarketplaceId(), entry.SellerSKU, price.amount, price.currency]
          );
          counts.updated += 1;
        }
      }
      return { skus_requested: skus.length };
    },
  });

// ---------------------------------------------------------------- comparisons for the UI
const listingJoinRows = async ({ tenantId, search = "", onlyMapped = false, limit = 200, offset = 0, database }) => {
  const params = [tenantId, amazonMarketplaceId()];
  const where = ["l.tenant_id = $1", "l.marketplace_id = $2", "l.removed_at IS NULL"];
  if (onlyMapped) where.push("m.status = 'mapped'");
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    where.push(`(lower(l.seller_sku) LIKE $${params.length} OR lower(COALESCE(l.asin,'')) LIKE $${params.length} OR lower(COALESCE(l.title,'')) LIKE $${params.length} OR lower(COALESCE(p.name,'')) LIKE $${params.length})`);
  }
  params.push(Math.min(Math.max(Number(limit) || 200, 1), 500), Math.max(Number(offset) || 0, 0));
  const result = await database.query(
    `SELECT l.seller_sku, l.asin, l.title, l.listing_status, l.fulfillment_channel, l.merchant_quantity,
            l.listing_price, l.offer_price, l.offer_currency_code, l.currency_code, l.price_synced_at,
            l.issue_count, l.error_count, l.issues, l.issues_synced_at, l.product_type, l.last_synced_at, l.opened_at,
            f.fulfillable_qty AS fba_fulfillable, f.inbound_qty AS fba_inbound, f.reserved_qty AS fba_reserved, f.last_synced_at AS fba_synced_at,
            m.status AS mapping_status, m.variant_id,
            pv.sku AS m1_sku, pv.size, pv.color, pv.stock AS m1_stock,
            pv.selling_price AS v_selling_price, pv.price AS v_price, pv.regular_price AS v_regular_price, pv.sale_price AS v_sale_price,
            pv.sale_price_enabled AS v_sale_price_enabled, pv.manual_selling_price AS v_manual_selling_price,
            pv.manual_price_override_active AS v_manual_price_override_active, pv.purchase_selling_price AS v_purchase_selling_price,
            p.id AS product_id, p.name AS product_name, p.selling_price AS p_selling_price, p.price AS p_price,
            p.regular_price AS p_regular_price, p.sale_price AS p_sale_price, p.sale_price_enabled AS p_sale_price_enabled,
            p.manual_selling_price AS p_manual_selling_price, p.manual_price_override_active AS p_manual_price_override_active,
            p.purchase_selling_price AS p_purchase_selling_price, p.is_offer_story AS p_is_offer_story,
            p.use_custom_compare_price AS p_use_custom_compare_price, p.custom_compare_price AS p_custom_compare_price
     FROM amazon_listings l
     LEFT JOIN amazon_fba_inventory f ON f.tenant_id = l.tenant_id AND f.marketplace_id = l.marketplace_id AND lower(f.seller_sku) = lower(l.seller_sku)
     LEFT JOIN amazon_sku_mappings m ON m.tenant_id = l.tenant_id AND m.marketplace_id = l.marketplace_id AND lower(m.seller_sku) = lower(l.seller_sku)
     LEFT JOIN product_variants pv ON pv.id = m.variant_id AND m.status = 'mapped'
     LEFT JOIN products p ON p.id = pv.product_id
     WHERE ${where.join(" AND ")}
     ORDER BY lower(l.seller_sku)
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return result.rows;
};

const pick = (row, prefix) => Object.fromEntries(
  Object.entries(row).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key.slice(prefix.length), value])
);

export const listListings = async ({ tenantId, search = "", limit, offset, database = db }) => {
  const rows = await listingJoinRows({ tenantId, search, limit, offset, database });
  return rows.map((row) => ({
    seller_sku: row.seller_sku,
    asin: row.asin,
    title: row.title,
    listing_status: row.listing_status,
    fulfillment_channel: row.fulfillment_channel,
    price: row.offer_price ?? row.listing_price,
    currency_code: row.offer_currency_code || row.currency_code,
    quantity: row.merchant_quantity,
    fba_fulfillable: row.fba_fulfillable,
    issue_count: row.issue_count,
    error_count: row.error_count,
    issues: row.issues || [],
    issues_synced_at: row.issues_synced_at,
    product_type: row.product_type,
    amazon_url: amazonProductUrl(row.asin),
    mapping_status: row.mapping_status || "unmapped",
    m1_sku: row.m1_sku,
    product_name: row.product_name,
    last_synced_at: row.last_synced_at,
  }));
};

export const listInventoryComparison = async ({ tenantId, search = "", limit, offset, database = db }) => {
  const rows = await listingJoinRows({ tenantId, search, limit, offset, database });
  return rows.map((row) => {
    const isFba = /amazon|afn/i.test(String(row.fulfillment_channel || "")) || (row.merchant_quantity === null && row.fba_fulfillable !== null);
    const amazonQuantity = isFba ? row.fba_fulfillable : row.merchant_quantity;
    const m1Quantity = row.variant_id ? Number(row.m1_stock ?? 0) : null;
    return {
      seller_sku: row.seller_sku,
      asin: row.asin,
      title: row.title,
      fulfillment: isFba ? "AMAZON" : "MERCHANT",
      amazon_quantity: amazonQuantity,
      fba_inbound: row.fba_inbound,
      fba_reserved: row.fba_reserved,
      m1_sku: row.m1_sku,
      product_name: row.product_name,
      size: row.size,
      color: row.color,
      m1_available: m1Quantity,
      difference: m1Quantity !== null && amazonQuantity !== null && amazonQuantity !== undefined ? m1Quantity - Number(amazonQuantity) : null,
      mapping_status: row.mapping_status || "unmapped",
      last_synced_at: isFba ? row.fba_synced_at : row.last_synced_at,
    };
  });
};

export const listPricingComparison = async ({ tenantId, search = "", limit, offset, database = db }) => {
  const rows = await listingJoinRows({ tenantId, search, limit, offset, database });
  const saleModeSettings = await loadTenantSaleModeSettings({ tenantId });
  return rows.map((row) => {
    let m1Price = null;
    if (row.variant_id) {
      const resolved = resolveEffectiveCustomerPrice({
        product: pick(row, "p_"),
        variant: pick(row, "v_"),
        saleModeSettings,
      });
      m1Price = resolved.has_price ? Number(resolved.active_price) : null;
    }
    const amazonPrice = row.offer_price ?? row.listing_price;
    return {
      seller_sku: row.seller_sku,
      asin: row.asin,
      title: row.title,
      m1_sku: row.m1_sku,
      product_name: row.product_name,
      size: row.size,
      color: row.color,
      m1_price: m1Price,
      amazon_price: amazonPrice === null || amazonPrice === undefined ? null : Number(amazonPrice),
      currency_code: row.offer_currency_code || row.currency_code || "EGP",
      difference: m1Price !== null && amazonPrice !== null && amazonPrice !== undefined ? Math.round((Number(amazonPrice) - m1Price) * 100) / 100 : null,
      mapping_status: row.mapping_status || "unmapped",
      last_update: row.price_synced_at || row.last_synced_at,
    };
  });
};

// READ-ONLY SP-API operations used by M1. Versions verified against the official models
// (amzn/selling-partner-api-models, 2026-09-17):
//   Sellers v1, Orders 2026-01-01 (v0 is deprecated, removal 2027-03-27), Reports 2021-06-30,
//   FBA Inventory v1, Product Pricing v0 (own offer price), Listings Items 2021-08-01.
// No write operation exists in this file; see amazonWriteGuard.js.

import { amazonMarketplaceId } from "./amazonConfig.js";
import { getAmazonSpApiClient } from "./amazonSpApiClient.js";

const client = (injected) => injected || getAmazonSpApiClient();

export const getMarketplaceParticipations = async ({ spApi } = {}) => {
  const payload = await client(spApi).request({ operation: "getMarketplaceParticipations", path: "/sellers/v1/marketplaceParticipations" });
  return Array.isArray(payload?.payload) ? payload.payload : [];
};

// Orders 2026-01-01. PROCEEDS/FULFILLMENT/CANCELLATION only: BUYER and RECIPIENT (personal
// data) are deliberately never requested.
export const ORDER_INCLUDED_DATA = Object.freeze(["PROCEEDS", "FULFILLMENT", "CANCELLATION"]);

export const searchOrders = async ({ spApi, lastUpdatedAfter, paginationToken, maxResultsPerPage = 100 } = {}) => {
  const query = paginationToken
    ? { paginationToken, marketplaceIds: [amazonMarketplaceId()], includedData: ORDER_INCLUDED_DATA }
    : {
        marketplaceIds: [amazonMarketplaceId()],
        lastUpdatedAfter,
        maxResultsPerPage,
        includedData: ORDER_INCLUDED_DATA,
      };
  const payload = await client(spApi).request({ operation: "searchOrders", path: "/orders/2026-01-01/orders", query });
  return {
    orders: Array.isArray(payload?.orders) ? payload.orders : [],
    nextToken: payload?.pagination?.nextToken || null,
    lastUpdatedBefore: payload?.lastUpdatedBefore || null,
  };
};

export const getOrder = async ({ spApi, orderId }) => {
  const payload = await client(spApi).request({
    operation: "getOrder",
    path: `/orders/2026-01-01/orders/${encodeURIComponent(orderId)}`,
    query: { includedData: ORDER_INCLUDED_DATA },
  });
  return payload?.order || null;
};

// Reports 2021-06-30
export const createReport = async ({ spApi, reportType }) => {
  const payload = await client(spApi).request({
    operation: "createReport",
    method: "POST",
    path: "/reports/2021-06-30/reports",
    body: { reportType, marketplaceIds: [amazonMarketplaceId()] },
  });
  return payload?.reportId || null;
};

export const getReport = async ({ spApi, reportId }) =>
  client(spApi).request({ operation: "getReport", path: `/reports/2021-06-30/reports/${encodeURIComponent(reportId)}` });

export const getReportDocument = async ({ spApi, reportDocumentId }) =>
  client(spApi).request({ operation: "getReportDocument", path: `/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}` });

export const downloadReportDocument = async ({ spApi, document }) =>
  client(spApi).downloadReportDocument({ url: document?.url, compressionAlgorithm: document?.compressionAlgorithm });

// FBA Inventory v1 (only meaningful if the seller uses Fulfilled by Amazon).
export const getInventorySummaries = async ({ spApi, nextToken } = {}) => {
  const payload = await client(spApi).request({
    operation: "getInventorySummaries",
    path: "/fba/inventory/v1/summaries",
    query: nextToken
      ? { nextToken, granularityType: "Marketplace", granularityId: amazonMarketplaceId(), marketplaceIds: [amazonMarketplaceId()] }
      : { details: "true", granularityType: "Marketplace", granularityId: amazonMarketplaceId(), marketplaceIds: [amazonMarketplaceId()] },
  });
  return {
    summaries: Array.isArray(payload?.payload?.inventorySummaries) ? payload.payload.inventorySummaries : [],
    nextToken: payload?.pagination?.nextToken || null,
  };
};

// Product Pricing v0: our own offer price per SKU (max 20 SKUs per call).
export const getPricingForSkus = async ({ spApi, skus = [] }) => {
  const payload = await client(spApi).request({
    operation: "getPricing",
    path: "/products/pricing/v0/price",
    query: { MarketplaceId: amazonMarketplaceId(), ItemType: "Sku", Skus: skus.slice(0, 20) },
  });
  return Array.isArray(payload?.payload) ? payload.payload : [];
};

// Listings Items 2021-08-01: listing issues for one SKU (needs the merchant/seller id).
export const getListingsItem = async ({ spApi, sellerId, sku }) =>
  client(spApi).request({
    operation: "getListingsItem",
    path: `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`,
    query: { marketplaceIds: [amazonMarketplaceId()], includedData: ["summaries", "issues", "offers", "fulfillmentAvailability"] },
  });

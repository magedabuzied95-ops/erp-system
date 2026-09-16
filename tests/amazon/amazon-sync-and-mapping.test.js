import assert from "node:assert/strict";
import test from "node:test";

import db from "../../server/database/db.js";
import { normalizeAmazonOrder, runAmazonOrdersSync } from "../../server/modules/amazon/amazonOrdersSync.js";
import { acceptExactSkuSuggestions, mapSku, refreshSkuSuggestions, unmapSku } from "../../server/modules/amazon/amazonSkuMapping.js";
import { extractOwnOfferPrice, parseListingsReport } from "../../server/modules/amazon/amazonCatalogSync.js";
import { M1_STATUS_FOR_AMAZON, m1PaymentStatusForAmazon } from "../../server/modules/amazon/amazonOrderProjection.js";
import { createFakeAmazonDb } from "./fakeAmazonDb.js";

const TENANT = 1;

const amazonOrder = (id, { status = "UNSHIPPED", updated = "2026-09-16T10:00:00Z", sku = "UNB-LOC-42-WHT-40", total = "1500.00", buyer = true } = {}) => ({
  orderId: id,
  createdTime: "2026-09-16T09:00:00Z",
  lastUpdatedTime: updated,
  salesChannel: { channelName: "AMAZON", marketplaceId: "ARBP9OOSHTCHU", marketplaceName: "Amazon.eg" },
  ...(buyer ? { buyer: { buyerName: "Real Person", buyerEmail: "someone@marketplace.amazon.eg" }, recipient: { deliveryAddress: { name: "Real Person", addressLine1: "1 Street", phone: "0100000000" } } } : {}),
  proceeds: { grandTotal: { amount: total, currencyCode: "EGP" } },
  fulfillment: { fulfillmentStatus: status, fulfilledBy: "MERCHANT", shipByWindow: { latestDateTime: "2026-09-18T00:00:00Z" } },
  orderItems: [{
    orderItemId: `${id}-1`,
    quantityOrdered: 2,
    product: { asin: "B0ABCDEF12", title: "Unbranded sneaker", sellerSku: sku, price: { unitPrice: { amount: "750.00", currencyCode: "EGP" } } },
    proceeds: { proceedsTotal: { amount: total, currencyCode: "EGP" } },
    fulfillment: { quantityFulfilled: status === "SHIPPED" ? 2 : 0, quantityUnfulfilled: status === "SHIPPED" ? 0 : 2 },
  }],
});

const pagedSpApi = (pages) => {
  const calls = [];
  const queue = [...pages];
  return {
    calls,
    request: async ({ operation, query }) => {
      calls.push({ operation, query });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    downloadReportDocument: async () => "",
    status: () => ({}),
  };
};

const withFakeDb = async (fake, fn) => {
  const originalQuery = db.query.bind(db);
  const originalConnect = db.connect.bind(db);
  db.query = fake.query;
  db.connect = fake.connect;
  try {
    return await fn();
  } finally {
    db.query = originalQuery;
    db.connect = originalConnect;
  }
};

test("normalizeAmazonOrder keeps business fields only - buyer and recipient are dropped", () => {
  const row = normalizeAmazonOrder(amazonOrder("402-1111111-1111111"));
  assert.equal(row.amazon_order_id, "402-1111111-1111111");
  assert.equal(row.fulfillment_status, "UNSHIPPED");
  assert.equal(row.fulfilled_by, "MERCHANT");
  assert.equal(row.order_total, 1500);
  assert.equal(row.currency_code, "EGP");
  assert.equal(row.items_ordered, 2);
  assert.equal(row.items_shipped, 0);
  assert.equal(row.items_unshipped, 2);
  assert.equal(row.items[0].seller_sku, "UNB-LOC-42-WHT-40");
  const serialized = JSON.stringify(row);
  for (const pii of ["Real Person", "someone@marketplace", "1 Street", "0100000000"]) {
    assert.equal(serialized.includes(pii), false, `stored personal data: ${pii}`);
  }
});

test("orders sync: paginates, imports, and a second run updates instead of duplicating", async () => {
  const fake = createFakeAmazonDb();
  await withFakeDb(fake, async () => {
    const spApi = pagedSpApi([
      { orders: [amazonOrder("402-0000001-0000001"), amazonOrder("402-0000002-0000002")], pagination: { nextToken: "page-2" } },
      { orders: [amazonOrder("402-0000003-0000003")], pagination: {}, lastUpdatedBefore: "2026-09-16T11:00:00Z" },
    ]);
    const first = await runAmazonOrdersSync({ tenantId: TENANT, spApi, database: fake, now: () => new Date("2026-09-16T12:00:00Z") });
    assert.equal(first.status, "succeeded");
    assert.deepEqual([first.counts.read, first.counts.created, first.counts.updated, first.counts.failed], [3, 3, 0, 0]);
    assert.equal(spApi.calls.length, 2);
    assert.equal(spApi.calls[1].query.paginationToken, "page-2");
    assert.deepEqual(spApi.calls[0].query.includedData, ["PROCEEDS", "FULFILLMENT", "CANCELLATION"], "never asks for BUYER/RECIPIENT");
    assert.equal(spApi.calls[0].query.marketplaceIds[0], "ARBP9OOSHTCHU");
    assert.equal(fake.state.orders.size, 3);
    assert.equal(fake.state.cursors.get("orders").toISOString(), "2026-09-16T11:00:00.000Z");
    // 30-day backfill on the first run
    assert.equal(new Date(spApi.calls[0].query.lastUpdatedAfter).toISOString(), "2026-08-17T12:00:00.000Z");

    const second = pagedSpApi([
      { orders: [amazonOrder("402-0000001-0000001", { status: "SHIPPED", updated: "2026-09-16T13:00:00Z" }), amazonOrder("402-0000002-0000002")], pagination: {}, lastUpdatedBefore: "2026-09-16T14:00:00Z" },
    ]);
    const rerun = await runAmazonOrdersSync({ tenantId: TENANT, spApi: second, database: fake, now: () => new Date("2026-09-16T14:05:00Z") });
    assert.deepEqual([rerun.counts.created, rerun.counts.updated, rerun.counts.unchanged], [0, 1, 1]);
    assert.equal(fake.state.orders.size, 3, "no duplicates");
    assert.equal(fake.state.orders.get("402-0000001-0000001").fulfillment_status, "SHIPPED");
    // resumes from the checkpoint minus a 5-minute overlap
    assert.equal(new Date(second.calls[0].query.lastUpdatedAfter).toISOString(), "2026-09-16T10:55:00.000Z");
    assert.ok(fake.state.audits.some((event) => event.event_type === "amazon.order_imported"));
    assert.ok(fake.state.audits.some((event) => event.event_type === "amazon.order_updated"));
    assert.ok(fake.state.audits.some((event) => event.event_type === "amazon.orders_sync"));
    const allAuditText = JSON.stringify(fake.state.audits);
    assert.equal(allAuditText.includes("Real Person"), false);
    // every SKU seen lands in the mapping screen, unmapped
    assert.equal(fake.state.mappings.length, 1);
    assert.equal(fake.state.mappings[0].status, "unmapped");
  });
});

test("orders sync: a failed order keeps the checkpoint where it was", async () => {
  const fake = createFakeAmazonDb();
  fake.state.failItemInsertForSku = "BROKEN-SKU";
  await withFakeDb(fake, async () => {
    const spApi = pagedSpApi([
      { orders: [amazonOrder("402-0000009-0000009"), amazonOrder("402-0000010-0000010", { sku: "BROKEN-SKU" })], pagination: {}, lastUpdatedBefore: "2026-09-16T11:00:00Z" },
    ]);
    const result = await runAmazonOrdersSync({ tenantId: TENANT, spApi, database: fake, now: () => new Date("2026-09-16T12:00:00Z") });
    assert.equal(result.status, "partial");
    assert.equal(result.counts.failed, 1);
    assert.equal(fake.state.cursors.has("orders"), false, "checkpoint not advanced");
    assert.equal(fake.state.runs[0].status, "partial");
  });
});

test("orders sync: an Amazon failure is recorded with a safe message and audited", async () => {
  const fake = createFakeAmazonDb();
  await withFakeDb(fake, async () => {
    const { AmazonApiError } = await import("../../server/modules/amazon/amazonErrors.js");
    const spApi = pagedSpApi([new AmazonApiError("searchOrders failed: Unauthorized Atza|leakedtoken123", { category: "authorization", status: 403 })]);
    const result = await runAmazonOrdersSync({ tenantId: TENANT, spApi, database: fake });
    assert.equal(result.status, "failed");
    assert.equal(fake.state.runs[0].status, "failed");
    assert.equal(fake.state.runs[0].error_category, "authorization");
    assert.equal(String(fake.state.runs[0].error_message).includes("leakedtoken123"), false);
    assert.ok(fake.state.audits.some((event) => event.event_type === "amazon.sync_failed"));
  });
});

test("orders sync: a second run while one holds the lock is skipped", async () => {
  const fake = createFakeAmazonDb({ heldLocks: [[74017301, 2]] });
  await withFakeDb(fake, async () => {
    const spApi = pagedSpApi([]);
    const result = await runAmazonOrdersSync({ tenantId: TENANT, spApi, database: fake });
    assert.deepEqual(result, { skipped: true, reason: "already_running" });
    assert.equal(spApi.calls.length, 0);
  });
});

test("SKU mapping: exact SKU suggestion, barcode fallback, conflicts never auto-applied", async () => {
  const fake = createFakeAmazonDb({
    variants: [
      { id: 11, product_id: 1, sku: "UNB-LOC-42-WHT-40", barcode: "6220000000011" },
      { id: 12, product_id: 1, sku: "DUP-1", barcode: "6220000000012" },
      { id: 13, product_id: 2, sku: "dup-1", barcode: "6220000000013" },
      { id: 14, product_id: 3, sku: "ZZZ-9", barcode: "6220000000099" },
      { id: 15, product_id: 4, sku: "OLD-1", barcode: "x", live: false },
    ],
  });
  fake.state.mappings.push(
    { id: 1, seller_sku: "unb-loc-42-wht-40", status: "unmapped" },
    { id: 2, seller_sku: "DUP-1", status: "unmapped" },
    { id: 3, seller_sku: "6220000000099", status: "unmapped" },
    { id: 4, seller_sku: "OLD-1", status: "unmapped" },
    { id: 5, seller_sku: "NOPE", status: "unmapped" },
  );
  await withFakeDb(fake, async () => {
    const summary = await refreshSkuSuggestions({ tenantId: TENANT, database: fake });
    const byId = Object.fromEntries(fake.state.mappings.map((mapping) => [mapping.id, mapping]));
    assert.equal(byId[1].suggested_variant_id, 11);
    assert.equal(byId[1].suggestion_method, "exact_sku");
    assert.equal(byId[1].status, "unmapped", "suggestion is not a mapping");
    assert.equal(byId[2].status, "conflict");
    assert.equal(byId[2].suggested_variant_id, null);
    assert.equal(byId[3].suggestion_method, "exact_barcode");
    assert.equal(byId[4].suggested_variant_id, null, "archived variants are never suggested");
    assert.equal(byId[5].candidate_count, 0);
    assert.equal(summary.conflicts, 1);

    const accepted = await acceptExactSkuSuggestions({ tenantId: TENANT, database: fake });
    assert.equal(accepted.accepted, 1, "only the unambiguous exact-SKU suggestion");
    assert.equal(byId[1].status, "mapped");
    assert.equal(byId[3].status, "unmapped", "barcode suggestions stay manual");
    assert.ok(fake.state.audits.some((event) => event.event_type === "amazon.sku_mapped"));
  });
});

test("SKU mapping: one M1 variant cannot be mapped to two Amazon SKUs; unmap is audited", async () => {
  const fake = createFakeAmazonDb({ variants: [{ id: 21, product_id: 5, sku: "M1-21" }, { id: 22, product_id: 5, sku: "" }] });
  fake.state.mappings.push({ id: 1, seller_sku: "AMZ-A", status: "unmapped" }, { id: 2, seller_sku: "AMZ-B", status: "unmapped" });
  fake.state.items.set("1:x", { seller_sku: "AMZ-A", mapped_variant_id: null });
  await withFakeDb(fake, async () => {
    const mapped = await mapSku({ tenantId: TENANT, mappingId: 1, variantId: 21, database: fake });
    assert.equal(mapped.variant_id, 21);
    assert.equal(fake.state.items.get("1:x").mapped_variant_id, 21, "existing order lines follow the mapping");
    await assert.rejects(mapSku({ tenantId: TENANT, mappingId: 2, variantId: 21, database: fake }), (error) => error.code === "VARIANT_ALREADY_MAPPED");
    await assert.rejects(mapSku({ tenantId: TENANT, mappingId: 2, variantId: 22, database: fake }), /no SKU/);
    await assert.rejects(mapSku({ tenantId: TENANT, mappingId: 2, variantId: 999, database: fake }), /not found/);
    await unmapSku({ tenantId: TENANT, mappingId: 1, database: fake });
    assert.equal(fake.state.mappings[0].status, "unmapped");
    assert.equal(fake.state.items.get("1:x").mapped_variant_id, null);
    assert.ok(fake.state.audits.some((event) => event.event_type === "amazon.sku_unmapped"));
  });
});

test("listings report parser reads the tab-separated merchant listings report", () => {
  const report = "﻿item-name\titem-description\tlisting-id\tseller-sku\tprice\tquantity\topen-date\tasin1\tfulfillment-channel\tstatus\r\n"
    + "Sneaker\tdesc\t123\tUNB-1\t1,499.00\t4\t2026-09-01 10:00:00 EEST\tB0ABCDEF12\tDEFAULT\tActive\r\n"
    + "FBA shoe\t\t124\tFBA-1\t999\t\t2026-09-02 10:00:00 EEST\tB0ABCDEF13\tAMAZON_EG\tInactive\r\n";
  const rows = parseListingsReport(report);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    [rows[0].seller_sku, rows[0].asin, rows[0].listing_price, rows[0].merchant_quantity, rows[0].listing_status],
    ["UNB-1", "B0ABCDEF12", 1499, 4, "Active"]
  );
  assert.equal(rows[1].merchant_quantity, null);
  assert.equal(rows[1].fulfillment_channel, "AMAZON_EG");
  assert.throws(() => parseListingsReport("foo\tbar\n1\t2"), /seller-sku/);
});

test("pricing: own offer price is read from getPricing", () => {
  assert.deepEqual(
    extractOwnOfferPrice({ status: "Success", SellerSKU: "UNB-1", Product: { Offers: [{ SellerSKU: "UNB-1", BuyingPrice: { ListingPrice: { Amount: 1499.5, CurrencyCode: "EGP" } } }] } }),
    { amount: 1499.5, currency: "EGP" }
  );
  assert.equal(extractOwnOfferPrice({ status: "ClientError", SellerSKU: "X" }), null);
});

test("projection status mapping never marks unpaid Amazon orders as paid", () => {
  assert.equal(M1_STATUS_FOR_AMAZON.UNSHIPPED, "confirmed");
  assert.equal(M1_STATUS_FOR_AMAZON.CANCELLED, "cancelled");
  assert.equal(m1PaymentStatusForAmazon("PENDING"), "unpaid");
  assert.equal(m1PaymentStatusForAmazon("CANCELLED"), "cancelled");
  assert.equal(m1PaymentStatusForAmazon("SHIPPED"), "paid");
});

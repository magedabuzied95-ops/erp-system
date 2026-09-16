// READ-ONLY Amazon order synchronization (Orders API 2026-01-01).
// - idempotent: upsert on (tenant_id, amazon_order_id); items on (order row, orderItemId)
// - resumable: checkpoint = Amazon's lastUpdatedBefore, advanced only when every order saved
// - never stores buyer/recipient data, never touches M1 stock, never writes to Amazon

import db from "../../database/db.js";
import { amazonFlags, amazonInitialBackfillDays, amazonMarketplaceId } from "./amazonConfig.js";
import { searchOrders } from "./amazonApi.js";
import { AMAZON_AUDIT_EVENTS, auditAmazon } from "./amazonAudit.js";
import { redactAmazonText, toSafeError } from "./amazonErrors.js";
import { finishSyncRun, getCursor, saveCursor, startSyncRun, withAmazonJobLock } from "./amazonSyncRuns.js";

const MAX_PAGES_PER_RUN = 50;
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const MAX_LOOKBACK_MS = 729 * 24 * 60 * 60 * 1000; // Amazon returns orders up to 2 years old

const text = (value, max = 200) => {
  const clean = String(value ?? "").trim();
  return clean ? redactAmazonText(clean, max) : null;
};
const amount = (money) => {
  const value = Number(money?.amount);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
};
const int = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);
const time = (value) => {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
};

// Pure: the subset of an Amazon order M1 keeps. Buyer and recipient are ignored on purpose.
export const normalizeAmazonOrder = (order = {}) => {
  const items = (Array.isArray(order.orderItems) ? order.orderItems : []).map((item) => ({
    order_item_id: text(item.orderItemId, 80),
    seller_sku: text(item.product?.sellerSku, 120),
    asin: text(item.product?.asin, 20),
    title: text(item.product?.title, 300),
    condition_type: text(item.product?.condition?.conditionType, 40),
    quantity_ordered: int(item.quantityOrdered),
    quantity_fulfilled: int(item.fulfillment?.quantityFulfilled),
    quantity_unfulfilled: int(item.fulfillment?.quantityUnfulfilled),
    unit_price: amount(item.product?.price?.unitPrice),
    item_total: amount(item.proceeds?.proceedsTotal),
    currency_code: text(item.product?.price?.unitPrice?.currencyCode || item.proceeds?.proceedsTotal?.currencyCode, 8),
    cancellation_requested: Boolean(item.cancellation?.cancellationRequest),
  })).filter((item) => item.order_item_id);

  const shipped = items.reduce((sum, item) => sum + item.quantity_fulfilled, 0);
  const ordered = items.reduce((sum, item) => sum + item.quantity_ordered, 0);
  const unshippedFromItems = items.reduce((sum, item) => sum + item.quantity_unfulfilled, 0);

  return {
    amazon_order_id: text(order.orderId, 40),
    created_time: time(order.createdTime),
    last_updated_time: time(order.lastUpdatedTime),
    fulfillment_status: text(order.fulfillment?.fulfillmentStatus, 40),
    fulfilled_by: text(order.fulfillment?.fulfilledBy, 20),
    fulfillment_service_level: text(order.fulfillment?.fulfillmentServiceLevel, 40),
    sales_channel: text(order.salesChannel?.channelName, 40),
    marketplace_name: text(order.salesChannel?.marketplaceName, 60),
    order_total: amount(order.proceeds?.grandTotal),
    currency_code: text(order.proceeds?.grandTotal?.currencyCode || items.find((item) => item.currency_code)?.currency_code, 8),
    items_ordered: ordered,
    items_shipped: shipped,
    items_unshipped: unshippedFromItems || Math.max(0, ordered - shipped),
    ship_by_latest: time(order.fulfillment?.shipByWindow?.latestDateTime),
    deliver_by_latest: time(order.fulfillment?.deliverByWindow?.latestDateTime),
    has_cancellation_request: items.some((item) => item.cancellation_requested),
    items,
  };
};

// Saves one normalized order + its items in a transaction. Returns 'created' | 'updated' | 'unchanged'.
export const upsertAmazonOrder = async ({ tenantId, order, runId = null, database = db }) => {
  if (!order.amazon_order_id) throw new Error("order without orderId");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, last_updated_time, fulfillment_status, order_total, items_shipped
       FROM amazon_orders WHERE tenant_id = $1 AND amazon_order_id = $2 FOR UPDATE`,
      [tenantId, order.amazon_order_id]
    );
    const before = existing.rows[0] || null;
    const values = [
      tenantId,
      amazonMarketplaceId(),
      order.amazon_order_id,
      order.created_time,
      order.last_updated_time,
      order.fulfillment_status,
      order.fulfilled_by,
      order.fulfillment_service_level,
      order.sales_channel,
      order.marketplace_name,
      order.order_total,
      order.currency_code,
      order.items_ordered,
      order.items_shipped,
      order.items_unshipped,
      order.ship_by_latest,
      order.deliver_by_latest,
      order.has_cancellation_request,
      runId,
    ];
    const saved = await client.query(
      `INSERT INTO amazon_orders (
         tenant_id, marketplace_id, amazon_order_id, created_time, last_updated_time,
         fulfillment_status, fulfilled_by, fulfillment_service_level, sales_channel, marketplace_name,
         order_total, currency_code, items_ordered, items_shipped, items_unshipped,
         ship_by_latest, deliver_by_latest, has_cancellation_request, last_sync_run_id, last_synced_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, NOW())
       ON CONFLICT (tenant_id, amazon_order_id) DO UPDATE SET
         created_time = COALESCE(EXCLUDED.created_time, amazon_orders.created_time),
         last_updated_time = EXCLUDED.last_updated_time,
         fulfillment_status = EXCLUDED.fulfillment_status,
         fulfilled_by = EXCLUDED.fulfilled_by,
         fulfillment_service_level = EXCLUDED.fulfillment_service_level,
         sales_channel = EXCLUDED.sales_channel,
         marketplace_name = EXCLUDED.marketplace_name,
         order_total = COALESCE(EXCLUDED.order_total, amazon_orders.order_total),
         currency_code = COALESCE(EXCLUDED.currency_code, amazon_orders.currency_code),
         items_ordered = EXCLUDED.items_ordered,
         items_shipped = EXCLUDED.items_shipped,
         items_unshipped = EXCLUDED.items_unshipped,
         ship_by_latest = EXCLUDED.ship_by_latest,
         deliver_by_latest = EXCLUDED.deliver_by_latest,
         has_cancellation_request = EXCLUDED.has_cancellation_request,
         last_sync_run_id = EXCLUDED.last_sync_run_id,
         last_synced_at = NOW()
       RETURNING id`,
      values
    );
    const orderRowId = saved.rows[0].id;

    for (const item of order.items) {
      const mapping = item.seller_sku
        ? await client.query(
            `SELECT variant_id, product_id FROM amazon_sku_mappings
             WHERE tenant_id = $1 AND marketplace_id = $2 AND lower(seller_sku) = lower($3) AND status = 'mapped'`,
            [tenantId, amazonMarketplaceId(), item.seller_sku]
          )
        : { rows: [] };
      const mapped = mapping.rows[0] || {};
      await client.query(
        `INSERT INTO amazon_order_items (
           amazon_order_row_id, tenant_id, order_item_id, seller_sku, asin, title, condition_type,
           quantity_ordered, quantity_fulfilled, quantity_unfulfilled, unit_price, item_total, currency_code,
           cancellation_requested, mapped_variant_id, mapped_product_id, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, NOW())
         ON CONFLICT (amazon_order_row_id, order_item_id) DO UPDATE SET
           seller_sku = EXCLUDED.seller_sku, asin = EXCLUDED.asin, title = EXCLUDED.title,
           condition_type = EXCLUDED.condition_type, quantity_ordered = EXCLUDED.quantity_ordered,
           quantity_fulfilled = EXCLUDED.quantity_fulfilled, quantity_unfulfilled = EXCLUDED.quantity_unfulfilled,
           unit_price = COALESCE(EXCLUDED.unit_price, amazon_order_items.unit_price),
           item_total = COALESCE(EXCLUDED.item_total, amazon_order_items.item_total),
           currency_code = COALESCE(EXCLUDED.currency_code, amazon_order_items.currency_code),
           cancellation_requested = EXCLUDED.cancellation_requested,
           mapped_variant_id = EXCLUDED.mapped_variant_id, mapped_product_id = EXCLUDED.mapped_product_id,
           updated_at = NOW()`,
        [
          orderRowId, tenantId, item.order_item_id, item.seller_sku, item.asin, item.title, item.condition_type,
          item.quantity_ordered, item.quantity_fulfilled, item.quantity_unfulfilled, item.unit_price, item.item_total,
          item.currency_code, item.cancellation_requested, mapped.variant_id || null, mapped.product_id || null,
        ]
      );
      // Every SKU seen on an order appears in the mapping screen, unmapped until a person decides.
      if (item.seller_sku) {
        await client.query(
          `INSERT INTO amazon_sku_mappings (tenant_id, marketplace_id, seller_sku, asin, amazon_title, status)
           VALUES ($1, $2, $3, $4, $5, 'unmapped')
           ON CONFLICT (tenant_id, marketplace_id, lower(seller_sku)) DO UPDATE SET
             asin = COALESCE(amazon_sku_mappings.asin, EXCLUDED.asin),
             amazon_title = COALESCE(amazon_sku_mappings.amazon_title, EXCLUDED.amazon_title)`,
          [tenantId, amazonMarketplaceId(), item.seller_sku, item.asin, item.title]
        );
      }
    }
    await client.query("COMMIT");

    if (!before) return { outcome: "created", orderRowId };
    const changed =
      String(before.last_updated_time?.toISOString?.() || before.last_updated_time || "") !== String(order.last_updated_time?.toISOString?.() || "") ||
      before.fulfillment_status !== order.fulfillment_status ||
      Number(before.items_shipped) !== Number(order.items_shipped) ||
      Number(before.order_total ?? NaN) !== Number(order.order_total ?? NaN);
    return { outcome: changed ? "updated" : "unchanged", orderRowId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

export const runAmazonOrdersSync = async ({
  tenantId,
  trigger = "manual",
  requestedBy = null,
  req = null,
  spApi = null,
  database = db,
  now = () => new Date(),
  projectOrder = null,
} = {}) =>
  withAmazonJobLock("orders", async () => {
    const storedCursor = await getCursor({ tenantId, jobType: "orders", database });
    const startedAt = now();
    const fallback = new Date(startedAt.getTime() - amazonInitialBackfillDays() * 24 * 60 * 60 * 1000);
    const base = storedCursor ? new Date(new Date(storedCursor).getTime() - CURSOR_OVERLAP_MS) : fallback;
    const lastUpdatedAfter = new Date(Math.max(base.getTime(), startedAt.getTime() - MAX_LOOKBACK_MS));
    const run = await startSyncRun({ tenantId, jobType: "orders", trigger, requestedBy, cursorBefore: lastUpdatedAfter, database });
    const counts = { read: 0, created: 0, updated: 0, unchanged: 0, failed: 0, projected: 0 };
    const failures = [];
    let checkpoint = null;
    let pages = 0;
    let exhausted = false;

    try {
      let paginationToken = null;
      do {
        const page = await searchOrders({
          spApi,
          lastUpdatedAfter: lastUpdatedAfter.toISOString(),
          paginationToken,
        });
        pages += 1;
        for (const rawOrder of page.orders) {
          counts.read += 1;
          const order = normalizeAmazonOrder(rawOrder);
          try {
            const { outcome, orderRowId } = await upsertAmazonOrder({ tenantId, order, runId: run.id, database });
            counts[outcome] += 1;
            if (outcome !== "unchanged") {
              await auditAmazon({
                req,
                tenantId,
                eventType: outcome === "created" ? AMAZON_AUDIT_EVENTS.ORDER_IMPORTED : AMAZON_AUDIT_EVENTS.ORDER_UPDATED,
                details: { amazon_order_id: order.amazon_order_id, status: order.fulfillment_status, items: order.items.length, sync_run_id: run.id },
              });
            }
            if (projectOrder && amazonFlags().orderProjection) {
              const projected = await projectOrder({ tenantId, orderRowId, database }).catch((error) => ({ error }));
              if (projected?.projected) counts.projected += 1;
            }
          } catch (error) {
            counts.failed += 1;
            if (failures.length < 20) failures.push({ amazon_order_id: order.amazon_order_id, error: toSafeError(error).message });
          }
        }
        paginationToken = page.nextToken;
        if (!paginationToken) {
          exhausted = true;
          checkpoint = page.lastUpdatedBefore ? new Date(page.lastUpdatedBefore) : new Date(startedAt.getTime() - 2 * 60 * 1000);
        }
      } while (paginationToken && pages < MAX_PAGES_PER_RUN);

      // The checkpoint only moves when every order of the window was saved.
      if (exhausted && counts.failed === 0 && checkpoint && !Number.isNaN(checkpoint.getTime())) {
        await saveCursor({ tenantId, jobType: "orders", checkpointAt: checkpoint, database });
      }
      const status = counts.failed > 0 || !exhausted ? "partial" : "succeeded";
      await finishSyncRun({
        runId: run.id,
        status,
        counts,
        cursorAfter: exhausted && counts.failed === 0 ? checkpoint : null,
        details: { pages, unchanged: counts.unchanged, projected: counts.projected, more_pages_pending: !exhausted, failures },
        database,
      });
      await auditAmazon({
        req,
        tenantId,
        eventType: AMAZON_AUDIT_EVENTS.ORDERS_SYNC,
        outcome: status,
        details: { trigger, sync_run_id: run.id, read: counts.read, created: counts.created, updated: counts.updated, failed: counts.failed, pages },
      });
      return { runId: run.id, status, counts, pages, moreToFetch: !exhausted };
    } catch (error) {
      const safe = toSafeError(error);
      await finishSyncRun({ runId: run.id, status: "failed", counts, error, details: { pages, failures }, database });
      await auditAmazon({
        req,
        tenantId,
        eventType: AMAZON_AUDIT_EVENTS.SYNC_FAILED,
        outcome: "failure",
        details: { job: "orders", trigger, sync_run_id: run.id, category: safe.category, code: safe.code },
      });
      return { runId: run.id, status: "failed", counts, error: safe };
    }
  }, { database });

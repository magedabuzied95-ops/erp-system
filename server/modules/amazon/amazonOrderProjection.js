// Copies an Amazon order into the M1 `orders` table so it shows up in the shared order views
// (source = channel = 'amazon', number AMZ-<id>). Behind AMAZON_ORDER_PROJECTION_ENABLED.
// - never deducts or restores stock (inventory_rollback_done = TRUE, and the order routes refuse
//   every mutation for marketplace orders - see amazonOrderGuards.js)
// - no customer record, phone or address: Amazon buyer data is not stored
// - no payments, loyalty, coupons or cash-drawer entries
// - idempotent: amazon_orders.m1_order_id + orders.idempotency_key 'amazon:<orderId>'

import db from "../../database/db.js";
import { assignSequentialInvoiceNumber, buildTemporaryInvoiceNumber } from "../../utils/invoiceNumber.js";
import { buildOrderItemInsertQuery } from "../../utils/orderItemInsert.js";
import { amazonFlags } from "./amazonConfig.js";
import { AMAZON_AUDIT_EVENTS, auditAmazon } from "./amazonAudit.js";
import { redactAmazonText } from "./amazonErrors.js";

export const M1_STATUS_FOR_AMAZON = Object.freeze({
  PENDING_AVAILABILITY: "pending",
  PENDING: "pending",
  UNSHIPPED: "confirmed",
  PARTIALLY_SHIPPED: "shipment_created",
  SHIPPED: "shipment_created",
  CANCELLED: "cancelled",
  UNFULFILLABLE: "cancelled",
});

export const m1PaymentStatusForAmazon = (fulfillmentStatus) => {
  const status = String(fulfillmentStatus || "").toUpperCase();
  if (status === "CANCELLED" || status === "UNFULFILLABLE") return "cancelled";
  if (status === "PENDING" || status === "PENDING_AVAILABILITY") return "unpaid";
  return "paid"; // Amazon collected the payment; the seller is settled by Amazon, not by M1.
};

const ORDER_COLUMN_CACHE = { at: 0, columns: null };
const orderColumns = async (client) => {
  if (ORDER_COLUMN_CACHE.columns && Date.now() - ORDER_COLUMN_CACHE.at < 10 * 60 * 1000) return ORDER_COLUMN_CACHE.columns;
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'orders'`
  );
  ORDER_COLUMN_CACHE.columns = new Set(result.rows.map((row) => row.column_name));
  ORDER_COLUMN_CACHE.at = Date.now();
  return ORDER_COLUMN_CACHE.columns;
};

export const projectAmazonOrder = async ({ tenantId, orderRowId, database = db, force = false }) => {
  if (!force && !amazonFlags().orderProjection) return { projected: false, reason: "projection_disabled" };
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query(
      `SELECT * FROM amazon_orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [orderRowId, tenantId]
    );
    const amazonOrder = orderResult.rows[0];
    if (!amazonOrder) {
      await client.query("ROLLBACK");
      return { projected: false, reason: "not_found" };
    }
    const itemsResult = await client.query(
      `SELECT i.*, pv.size AS v_size, pv.color AS v_color, pv.barcode AS v_barcode, pv.sku AS v_sku, p.name AS p_name
       FROM amazon_order_items i
       LEFT JOIN product_variants pv ON pv.id = i.mapped_variant_id
       LEFT JOIN products p ON p.id = i.mapped_product_id
       WHERE i.amazon_order_row_id = $1 ORDER BY i.id`,
      [orderRowId]
    );
    const items = itemsResult.rows;
    const status = M1_STATUS_FOR_AMAZON[String(amazonOrder.fulfillment_status || "").toUpperCase()] || "pending";
    const paymentStatus = m1PaymentStatusForAmazon(amazonOrder.fulfillment_status);
    const itemsTotal = items.reduce((sum, item) => sum + Number(item.item_total ?? Number(item.unit_price || 0) * Number(item.quantity_ordered || 0)), 0);
    const total = Math.round(Number(amazonOrder.order_total ?? itemsTotal) * 100) / 100;
    const note = `Amazon order ${redactAmazonText(amazonOrder.amazon_order_id, 40)} (${amazonOrder.fulfilled_by || "?"}) - managed in Amazon Seller Central`;
    const columns = await orderColumns(client);

    let m1OrderId = amazonOrder.m1_order_id;
    if (!m1OrderId) {
      const existing = await client.query(
        `SELECT id FROM orders WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [tenantId, `amazon:${amazonOrder.amazon_order_id}`]
      );
      m1OrderId = existing.rows[0]?.id || null;
    }

    const fields = {
      tenant_id: tenantId,
      customer_name: "Amazon customer",
      channel: "amazon",
      source: "amazon",
      customer_type: "marketplace",
      status,
      payment_status: paymentStatus,
      payment_method: "amazon",
      subtotal: total,
      total,
      total_amount: total,
      total_price: total,
      paid_amount: paymentStatus === "paid" ? total : 0,
      remaining_amount: 0,
      shipping_provider: "amazon",
      shipping_status: status === "shipment_created" ? "shipped" : status === "cancelled" ? "cancelled" : "pending",
      inventory_rollback_done: true,
      order_notes: note,
      notes: note,
      idempotency_key: `amazon:${amazonOrder.amazon_order_id}`,
      cancelled_at: status === "cancelled" ? amazonOrder.last_updated_time || new Date() : null,
    };
    const usable = Object.entries(fields).filter(([column]) => columns.has(column));

    if (m1OrderId) {
      const updatable = usable.filter(([column]) => !["tenant_id", "idempotency_key", "customer_name", "channel", "source", "customer_type"].includes(column));
      await client.query(
        `UPDATE orders SET ${updatable.map(([column], index) => `${column} = $${index + 2}`).join(", ")}, updated_at = NOW()
         WHERE id = $1 AND LOWER(COALESCE(source,'')) = 'amazon'`,
        [m1OrderId, ...updatable.map(([, value]) => value)]
      );
    } else {
      const insertColumns = [...usable.map(([column]) => column), "invoice_number", "created_at", "updated_at"];
      const insertValues = [...usable.map(([, value]) => value), buildTemporaryInvoiceNumber(), amazonOrder.created_time || new Date(), new Date()];
      const inserted = await client.query(
        `INSERT INTO orders (${insertColumns.join(", ")}) VALUES (${insertColumns.map((_, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
        insertValues
      );
      const order = inserted.rows[0];
      await assignSequentialInvoiceNumber(client, order, { prefix: "AMZ" });
      m1OrderId = order.id;
      for (const item of items) {
        const quantity = Math.max(1, Number(item.quantity_ordered || 0));
        const lineTotal = Number(item.item_total ?? Number(item.unit_price || 0) * quantity);
        const { sql, params } = buildOrderItemInsertQuery({
          tenant_id: tenantId,
          order_id: m1OrderId,
          variant_id: item.mapped_variant_id,
          product_id: item.mapped_product_id,
          product_name: item.p_name || item.title || item.seller_sku || "Amazon item",
          variant_name: [item.v_color, item.v_size].filter(Boolean).join(" / ") || null,
          sku: item.v_sku || item.seller_sku,
          barcode: item.v_barcode || null,
          quantity,
          unit_price: item.unit_price ?? (quantity ? lineTotal / quantity : 0),
          total_amount: lineTotal,
          price_source: "amazon",
          size: item.v_size || null,
          color: item.v_color || null,
        }, { insertLabel: "amazon_projection" });
        await client.query(sql, params);
      }
    }

    await client.query(
      `UPDATE amazon_orders SET m1_order_id = $2, projection_status = 'projected', projection_error = NULL, projected_at = NOW() WHERE id = $1`,
      [orderRowId, m1OrderId]
    );
    await client.query("COMMIT");
    await auditAmazon({
      tenantId,
      eventType: AMAZON_AUDIT_EVENTS.ORDER_PROJECTED,
      details: { amazon_order_id: amazonOrder.amazon_order_id, m1_order_id: m1OrderId, status },
    });
    return { projected: true, m1OrderId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    await database.query(
      `UPDATE amazon_orders SET projection_status = 'failed', projection_error = $2 WHERE id = $1`,
      [orderRowId, redactAmazonText(error?.message || String(error), 300)]
    ).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Backfill for orders synced before the projection flag was switched on.
export const projectPendingAmazonOrders = async ({ tenantId, limit = 200, database = db }) => {
  if (!amazonFlags().orderProjection) return { projected: 0, failed: 0, reason: "projection_disabled" };
  const rows = await database.query(
    `SELECT id FROM amazon_orders
     WHERE tenant_id = $1 AND (m1_order_id IS NULL OR projected_at IS NULL OR projected_at < last_synced_at)
     ORDER BY created_time LIMIT $2`,
    [tenantId, limit]
  );
  const summary = { projected: 0, failed: 0 };
  for (const row of rows.rows) {
    try {
      const result = await projectAmazonOrder({ tenantId, orderRowId: row.id, database });
      if (result.projected) summary.projected += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
};

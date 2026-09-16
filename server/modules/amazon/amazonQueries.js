// Read models for the Amazon pages. Amazon data only (no buyer personal data is stored).

import db from "../../database/db.js";
import { amazonMarketplaceId, amazonProductUrl } from "./amazonConfig.js";

export const AMAZON_ORDER_STATUSES = Object.freeze(["PENDING_AVAILABILITY", "PENDING", "UNSHIPPED", "PARTIALLY_SHIPPED", "SHIPPED", "CANCELLED", "UNFULFILLABLE"]);

export const getAmazonDashboard = async ({ tenantId, database = db }) => {
  const marketplaceId = amazonMarketplaceId();
  const [orders, mappings, listings] = await Promise.all([
    database.query(
      `SELECT
         COUNT(*) FILTER (WHERE created_time >= date_trunc('day', NOW()))::int AS orders_today,
         COUNT(*) FILTER (WHERE fulfillment_status IN ('PENDING','PENDING_AVAILABILITY'))::int AS pending_orders,
         COUNT(*) FILTER (WHERE fulfillment_status IN ('UNSHIPPED','PARTIALLY_SHIPPED'))::int AS unshipped_orders,
         COUNT(*) FILTER (WHERE fulfillment_status IN ('UNSHIPPED','PARTIALLY_SHIPPED') AND ship_by_latest < NOW())::int AS late_to_ship,
         COALESCE(SUM(order_total) FILTER (WHERE created_time >= date_trunc('day', NOW()) AND fulfillment_status NOT IN ('CANCELLED','UNFULFILLABLE')), 0)::numeric AS revenue_today,
         COALESCE(SUM(order_total) FILTER (WHERE created_time >= NOW() - INTERVAL '30 days' AND fulfillment_status NOT IN ('CANCELLED','UNFULFILLABLE')), 0)::numeric AS revenue_30d,
         COUNT(*) FILTER (WHERE created_time >= NOW() - INTERVAL '30 days')::int AS orders_30d,
         COUNT(*)::int AS orders_total,
         MAX(currency_code) AS currency_code
       FROM amazon_orders WHERE tenant_id = $1 AND marketplace_id = $2`,
      [tenantId, marketplaceId]
    ),
    database.query(
      `SELECT status, COUNT(*)::int AS count FROM amazon_sku_mappings WHERE tenant_id = $1 AND marketplace_id = $2 GROUP BY status`,
      [tenantId, marketplaceId]
    ),
    database.query(
      `SELECT COUNT(*) FILTER (WHERE removed_at IS NULL)::int AS listings,
              COUNT(*) FILTER (WHERE removed_at IS NULL AND lower(COALESCE(listing_status,'')) = 'active')::int AS active_listings,
              COUNT(*) FILTER (WHERE removed_at IS NULL AND error_count > 0)::int AS listings_with_errors,
              COALESCE(SUM(error_count) FILTER (WHERE removed_at IS NULL), 0)::int AS listing_errors
       FROM amazon_listings WHERE tenant_id = $1 AND marketplace_id = $2`,
      [tenantId, marketplaceId]
    ),
  ]);
  const mappingCounts = Object.fromEntries(mappings.rows.map((row) => [row.status, row.count]));
  const orderRow = orders.rows[0] || {};
  return {
    orders: {
      today: orderRow.orders_today || 0,
      pending: orderRow.pending_orders || 0,
      unshipped: orderRow.unshipped_orders || 0,
      late_to_ship: orderRow.late_to_ship || 0,
      last_30_days: orderRow.orders_30d || 0,
      total: orderRow.orders_total || 0,
    },
    revenue: {
      today: Number(orderRow.revenue_today || 0),
      last_30_days: Number(orderRow.revenue_30d || 0),
      currency_code: orderRow.currency_code || "EGP",
    },
    skus: {
      mapped: mappingCounts.mapped || 0,
      unmapped: mappingCounts.unmapped || 0,
      conflict: mappingCounts.conflict || 0,
      missing_m1_sku: mappingCounts.missing_m1_sku || 0,
    },
    listings: listings.rows[0] || { listings: 0, active_listings: 0, listings_with_errors: 0, listing_errors: 0 },
  };
};

export const listAmazonOrders = async ({ tenantId, status = "", fulfilledBy = "", from = "", to = "", search = "", limit = 50, offset = 0, database = db }) => {
  const params = [tenantId, amazonMarketplaceId()];
  const where = ["o.tenant_id = $1", "o.marketplace_id = $2"];
  const statuses = String(status || "").split(",").map((value) => value.trim().toUpperCase()).filter((value) => AMAZON_ORDER_STATUSES.includes(value));
  if (statuses.length) {
    params.push(statuses);
    where.push(`o.fulfillment_status = ANY($${params.length}::text[])`);
  }
  if (["MERCHANT", "AMAZON"].includes(String(fulfilledBy).toUpperCase())) {
    params.push(String(fulfilledBy).toUpperCase());
    where.push(`upper(o.fulfilled_by) = $${params.length}`);
  }
  const fromDate = from ? new Date(from) : null;
  if (fromDate && !Number.isNaN(fromDate.getTime())) {
    params.push(fromDate);
    where.push(`o.created_time >= $${params.length}`);
  }
  const toDate = to ? new Date(to) : null;
  if (toDate && !Number.isNaN(toDate.getTime())) {
    params.push(toDate);
    where.push(`o.created_time < $${params.length}::timestamptz + INTERVAL '1 day'`);
  }
  if (search) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    where.push(`(lower(o.amazon_order_id) LIKE $${params.length} OR EXISTS (
      SELECT 1 FROM amazon_order_items s WHERE s.amazon_order_row_id = o.id
        AND (lower(COALESCE(s.seller_sku,'')) LIKE $${params.length} OR lower(COALESCE(s.title,'')) LIKE $${params.length} OR lower(COALESCE(s.asin,'')) LIKE $${params.length})))`);
  }
  const filterParams = [...params];
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200), Math.max(Number(offset) || 0, 0));
  const [rows, total] = await Promise.all([
    database.query(
      `SELECT o.id, o.amazon_order_id, o.created_time, o.last_updated_time, o.fulfillment_status, o.fulfilled_by,
              o.fulfillment_service_level, o.sales_channel, o.order_total, o.currency_code,
              o.items_ordered, o.items_shipped, o.items_unshipped, o.ship_by_latest, o.has_cancellation_request,
              o.m1_order_id, mo.invoice_number AS m1_invoice_number, o.last_synced_at,
              COALESCE(json_agg(json_build_object(
                'order_item_id', i.order_item_id, 'seller_sku', i.seller_sku, 'asin', i.asin, 'title', i.title,
                'quantity_ordered', i.quantity_ordered, 'quantity_fulfilled', i.quantity_fulfilled,
                'unit_price', i.unit_price, 'item_total', i.item_total, 'currency_code', i.currency_code,
                'mapped_variant_id', i.mapped_variant_id, 'm1_sku', pv.sku, 'size', pv.size, 'color', pv.color,
                'product_name', p.name
              ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
       FROM amazon_orders o
       LEFT JOIN amazon_order_items i ON i.amazon_order_row_id = o.id
       LEFT JOIN product_variants pv ON pv.id = i.mapped_variant_id
       LEFT JOIN products p ON p.id = i.mapped_product_id
       LEFT JOIN orders mo ON mo.id = o.m1_order_id
       WHERE ${where.join(" AND ")}
       GROUP BY o.id, mo.invoice_number
       ORDER BY o.created_time DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    database.query(`SELECT COUNT(*)::int AS total FROM amazon_orders o WHERE ${where.join(" AND ")}`, filterParams),
  ]);
  return {
    orders: rows.rows.map((row) => ({
      ...row,
      items: (row.items || []).map((item) => ({ ...item, amazon_url: amazonProductUrl(item.asin) })),
    })),
    total: total.rows[0]?.total || 0,
  };
};

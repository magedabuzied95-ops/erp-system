import db from "../../database/db.js";
import { refreshBostaShipmentForOrder } from "./shipping.service.js";

/*
 * The safety net under the Bosta webhook.
 *
 * The callback is the fast path and does everything (status, COD, the customer's
 * message, the manager alert) — but it is one HTTP request from another company:
 * it was silently never delivered for months (see the shipping notes), it is
 * dropped for a parcel created before the per-delivery `webHook` field existed,
 * and a restart during a delivery burst loses whatever arrived in that second.
 * Every one of those leaves a real parcel moving while the ERP shows it parked,
 * which is exactly what the portals put in front of staff.
 *
 * So: every few minutes, take the parcels that are still in the courier's hands
 * and have not been heard from in a while, and ask Bosta. refreshBostaShipmentForOrder
 * is the same call the تحديث الحالة button makes — it refuses to write anything when
 * Bosta answers without a readable state, and it fans out the same notifications, so
 * a status learned here behaves exactly like one learned from a callback.
 */

// Statuses that mean the parcel is out there. `delivered`, `returned` and `cancelled`
// are endings: asking about them forever would burn the API quota for nothing.
const IN_FLIGHT_STATUSES = [
  "shipment_created",
  "shipping_created",
  "created",
  "picked_up",
  "picked",
  "in_transit",
  "out_for_delivery",
  "failed_delivery",
  "failed",
];

const DEFAULT_STALE_MINUTES = 45;
const DEFAULT_BATCH = 20;
// Old parcels are lost causes, not live shipments: a tracking number nobody has
// touched in two months will not start answering now.
const MAX_AGE_DAYS = 60;

const number = (value, fallback) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
};

export const listStaleBostaShipments = async ({ staleMinutes = DEFAULT_STALE_MINUTES, limit = DEFAULT_BATCH, client = db } = {}) => {
  const result = await client.query(
    `
    SELECT id, shipping_tracking_number, tracking_number, shipment_status, shipping_status, shipping_last_synced_at
    FROM orders
    WHERE LOWER(COALESCE(shipping_provider, '')) = 'bosta'
      AND COALESCE(NULLIF(TRIM(shipping_tracking_number), ''), NULLIF(TRIM(tracking_number), ''), '') <> ''
      AND deleted_at IS NULL
      AND cancelled_at IS NULL
      AND LOWER(REPLACE(TRIM(COALESCE(shipment_status, shipping_status, '')), '-', '_')) = ANY($1::text[])
      AND created_at >= NOW() - ($2 || ' days')::interval
      AND COALESCE(shipping_last_synced_at, last_shipping_sync_at, created_at) < NOW() - ($3 || ' minutes')::interval
    ORDER BY COALESCE(shipping_last_synced_at, last_shipping_sync_at, created_at) ASC
    LIMIT $4
    `,
    [IN_FLIGHT_STATUSES, String(MAX_AGE_DAYS), String(number(staleMinutes, DEFAULT_STALE_MINUTES)), number(limit, DEFAULT_BATCH)]
  );
  return result.rows;
};

/**
 * One pass. Sequential on purpose: this runs beside real traffic and a courier API
 * is not the place to open twenty sockets for a background chore. Every failure is
 * swallowed per order — one unreachable parcel must not stop the other nineteen, and
 * a Bosta outage must not fill the logs with the same stack twenty times a tick.
 */
export const reconcileStaleBostaShipments = async ({
  staleMinutes = DEFAULT_STALE_MINUTES,
  limit = DEFAULT_BATCH,
  refresh = refreshBostaShipmentForOrder,
  client = db,
} = {}) => {
  const rows = await listStaleBostaShipments({ staleMinutes, limit, client });
  const summary = { checked: rows.length, updated: 0, unchanged: 0, failed: 0, changes: [] };
  for (const row of rows) {
    const before = String(row.shipment_status || row.shipping_status || "").trim().toLowerCase();
    try {
      const result = await refresh(row.id);
      const after = String(result?.order?.shipment_status || result?.order?.shipping_status || "").trim().toLowerCase();
      if (after && after !== before) {
        summary.updated += 1;
        summary.changes.push({ order_id: row.id, from: before, to: after });
      } else {
        summary.unchanged += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.warn("[bosta-reconcile] refresh failed", { orderId: row.id, code: error?.code, message: error?.message || String(error) });
    }
  }
  if (summary.updated) console.log("[bosta-reconcile]", { checked: summary.checked, updated: summary.updated, changes: summary.changes });
  return summary;
};

/**
 * Off unless it is explicitly switched on, and off outside production by default:
 * a refresh is not read-only on our side — it writes the order, settles COD and
 * sends the customer a WhatsApp message. A developer machine pointed at a database
 * that holds the live Bosta key must never do that on a timer.
 */
export const bostaReconcileEnabled = () => {
  const flag = String(process.env.BOSTA_STATUS_RECONCILE_ENABLED || "").trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  return process.env.NODE_ENV === "production";
};

export const BOSTA_RECONCILE_INTERVAL_MS = () =>
  Math.max(5 * 60 * 1000, Number(process.env.BOSTA_STATUS_RECONCILE_INTERVAL_MS || 10 * 60 * 1000));

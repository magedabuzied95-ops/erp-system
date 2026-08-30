/*
 * Delivery orders drive the AI Inbox star.
 *
 * A customer who asks for a delivery order is someone the desk has to keep an eye
 * on until the parcel lands, so raising the order stars their conversation and the
 * "delivered" callback takes the star away again. The star is the same
 * `ai_support_sessions.is_favorite` column the toolbar toggles by hand, so the two
 * have to be able to share it without stepping on each other — that is what
 * `auto_favorite_order_id` records: a star this file placed carries the order id
 * that justified it, a star a human placed carries NULL. Delivery only ever clears
 * a star that names an order, so a manual star survives every delivery, and a
 * customer with a second parcel still in the air keeps the star with the id
 * re-pointed at that parcel instead of being dropped.
 */
import db from "../database/db.js";
import { canonicalPhoneKey, canonicalPhoneSql } from "../utils/phoneSearch.js";
import { emitToRooms } from "../utils/socket.js";

const text = (value, fallback = "") => String(value ?? fallback).trim();
const statusKey = (value) => text(value).toLowerCase().replace(/[\s-]+/g, "_");
const idOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// Collecting the parcel at the counter is not a delivery, so it never stars anything.
const PICKUP_METHODS = new Set(["store_pickup", "pickup", "in_store_pickup", "branch_pickup", "self_pickup", "store"]);
// A till sale is handed over across the counter. It only counts as a delivery when
// the cashier actually recorded an address or a shipment for it.
const WALK_IN_CHANNELS = new Set(["pos", "till", "in_store", "cashier", "store"]);
// Neither a draft nor a dead order is worth following, so neither one holds a star.
const INACTIVE_STATUSES = new Set([
  "ai_draft", "draft", "cancelled", "canceled", "rejected", "refunded", "returned", "failed", "deleted", "archived",
]);

let schemaReadyPromise = null;

/*
 * Lazy on purpose. This is one ADD COLUMN with no backfill behind it, but the boot
 * path is where a migration takes the whole backend down with it, so it runs on
 * first use instead.
 */
export const ensureDeliveryFavoriteSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise || clientOrPool !== db) {
    const run = async () => {
      await clientOrPool.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS auto_favorite_order_id BIGINT NULL`);
    };
    if (clientOrPool !== db) return run();
    schemaReadyPromise = run().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

const orderAddressPresent = (order = {}) => Boolean(
  text(order.customer_address)
  || text(order.street_address)
  || text(order.shipping_address_line)
  || text(order.governorate)
  || text(order.city_area)
);

const orderShipmentPresent = (order = {}) => Boolean(
  text(order.shipment_id)
  || text(order.tracking_number)
  || text(order.shipping_tracking_number)
  || text(order.shipping_provider_delivery_id)
);

/** A parcel that has to travel to the customer, whichever surface raised it. */
export const isDeliveryOrder = (order = {}) => {
  const method = statusKey(order.shipping_method || order.shipping_provider_id || order.shipping_provider);
  if (PICKUP_METHODS.has(method)) return false;
  if (WALK_IN_CHANNELS.has(statusKey(order.channel || order.source))) {
    return orderAddressPresent(order) || orderShipmentPresent(order);
  }
  return true;
};

/** Mirrors the rule the rest of the ERP reads delivery off: order OR shipment says so. */
export const isDeliveredOrder = (order = {}) =>
  statusKey(order.status) === "delivered"
  || statusKey(order.shipment_status || order.shipping_status) === "delivered";

const isInactiveOrder = (order = {}) =>
  Boolean(order.deleted_at)
  || Boolean(order.cancelled_at)
  || INACTIVE_STATUSES.has(statusKey(order.status))
  || INACTIVE_STATUSES.has(statusKey(order.ai_agent_status))
  || INACTIVE_STATUSES.has(statusKey(order.shipment_status || order.shipping_status));

/** Still on its way: worth a star. */
export const isInFlightDeliveryOrder = (order = {}) =>
  isDeliveryOrder(order) && !isInactiveOrder(order) && !isDeliveredOrder(order);

/*
 * Only a key long enough to actually be a phone is allowed through. POS rows carry
 * placeholders like `guest:1`, which canonicalise down to "1" — matching threads on
 * that would hand one walk-in's star to whatever conversation happened to reduce to
 * the same digit.
 */
const MIN_PHONE_KEY_LENGTH = 8;
const orderPhoneKey = (order = {}) => {
  const phoneKey = canonicalPhoneKey(order.customer_phone || order.phone || order.customer?.phone || "");
  return phoneKey.length >= MIN_PHONE_KEY_LENGTH ? phoneKey : "";
};

const conversationIdsOnOrder = (order = {}) => [...new Set([
  text(order.ai_agent_conversation_id),
  text(order.ai_agent_session_id),
].filter(Boolean))];

/*
 * Which threads belong to this order's customer.
 *
 * Two independent routes in, because neither one covers the other: an order raised
 * from the inbox carries the conversation id outright, and every other order only
 * knows a phone. The phone side compares canonical keys — the same rule customer
 * identity uses — so `+20 101 278 5444`, `01012785444` and the `whatsapp:201012785444`
 * session id all land on one key. It is deliberately narrowed to threads that are
 * keyed BY a phone: a Messenger PSID or an Instagram id is a bare number too, and a
 * short one could otherwise collide with somebody's mobile. A WhatsApp LID carries no
 * phone at all, so it is excluded by name.
 */
const resolveConversationSessionIds = async ({ tenantId, order }) => {
  const safeTenantId = idOrNull(tenantId ?? order?.tenant_id);
  if (!safeTenantId) return [];
  const explicitIds = conversationIdsOnOrder(order);
  const phoneKey = orderPhoneKey(order);
  if (!explicitIds.length && !phoneKey) return [];

  const result = await db.query(
    `
    SELECT session_id
    FROM ai_support_sessions
    WHERE tenant_id = $1::bigint
      AND (
        session_id = ANY($2::text[])
        OR (
          $3::text <> ''
          AND LOWER(session_id) NOT LIKE 'whatsapp:lid:%'
          AND (LOWER(session_id) LIKE 'whatsapp:%' OR session_id ~ '^\\+?[0-9]+$')
          AND ${canonicalPhoneSql("session_id")} = $3::text
        )
      )
    `,
    [safeTenantId, explicitIds, phoneKey]
  );
  return [...new Set(result.rows.map((row) => text(row.session_id)).filter(Boolean))];
};

/*
 * Another parcel of the same customer's still in the air?
 *
 * Bounded on purpose: tenant + recency keeps this on the tenant/created index, and a
 * delivery order older than six months is not in flight by any reading. The delivery
 * test itself stays in JS so there is exactly one definition of it.
 */
const findOtherInFlightDeliveryOrder = async ({ tenantId, order }) => {
  const safeTenantId = idOrNull(tenantId ?? order?.tenant_id);
  const phoneKey = orderPhoneKey(order);
  if (!safeTenantId || !phoneKey) return null;
  const result = await db.query(
    `
    SELECT *
    FROM orders
    WHERE tenant_id = $1::bigint
      AND id <> $2::bigint
      AND created_at > NOW() - INTERVAL '180 days'
      AND deleted_at IS NULL
      AND cancelled_at IS NULL
      AND ${canonicalPhoneSql("customer_phone")} = $3::text
      AND LOWER(COALESCE(status, '')) <> 'delivered'
      AND LOWER(COALESCE(shipment_status, shipping_status, '')) <> 'delivered'
    ORDER BY created_at DESC
    LIMIT 20
    `,
    [safeTenantId, idOrNull(order?.id) || 0, phoneKey]
  );
  return result.rows.find(isInFlightDeliveryOrder) || null;
};

const announce = (tenantId, sessionIds, reason) => {
  const safeTenantId = idOrNull(tenantId);
  if (!safeTenantId) return;
  for (const sessionId of sessionIds) {
    emitToRooms([`tenant:${safeTenantId}`], "ai_inbox:refresh", {
      tenant_id: safeTenantId,
      session_id: sessionId,
      reason,
      at: new Date().toISOString(),
    });
  }
};

/*
 * Star the customer's threads for an order still on its way.
 *
 * The `is_favorite = FALSE OR auto_favorite_order_id IS NOT NULL` guard is what keeps
 * a hand-placed star out of this file's hands: a thread already starred by a human
 * carries no order id, so it is not claimed here and delivery cannot take it away.
 */
export const favoriteConversationsForOrder = async ({ tenantId, order, source = "delivery_order" } = {}) => {
  const safeTenantId = idOrNull(tenantId ?? order?.tenant_id);
  const orderId = idOrNull(order?.id);
  if (!safeTenantId || !orderId) return { changed: [], reason: "order_missing" };
  await ensureDeliveryFavoriteSchema();
  const sessionIds = await resolveConversationSessionIds({ tenantId: safeTenantId, order });
  if (!sessionIds.length) return { changed: [], reason: "no_conversation" };

  const result = await db.query(
    `
    UPDATE ai_support_sessions
    SET is_favorite = TRUE,
        auto_favorite_order_id = $3::bigint,
        updated_at = NOW()
    WHERE tenant_id = $1::bigint
      AND session_id = ANY($2::text[])
      AND (COALESCE(is_favorite, FALSE) = FALSE OR auto_favorite_order_id IS NOT NULL)
    RETURNING session_id
    `,
    [safeTenantId, sessionIds, orderId]
  );
  const changed = result.rows.map((row) => text(row.session_id)).filter(Boolean);
  if (changed.length) {
    announce(safeTenantId, changed, "delivery_order_favorited");
    console.info("[inbox-favorite:delivery-order]", { tenant_id: safeTenantId, order_id: orderId, sessions: changed.length, source });
  }
  return { changed, reason: changed.length ? "" : "already_favorite" };
};

/*
 * Take the star back once the parcel lands (or the order dies).
 *
 * A customer with a second parcel still out does not lose the star — the id is
 * re-pointed at that parcel, so the thread stays starred for exactly as long as the
 * customer has something in the air.
 */
export const unfavoriteConversationsForOrder = async ({ tenantId, order, source = "delivered" } = {}) => {
  const safeTenantId = idOrNull(tenantId ?? order?.tenant_id);
  const orderId = idOrNull(order?.id);
  if (!safeTenantId || !orderId) return { changed: [], reason: "order_missing" };
  await ensureDeliveryFavoriteSchema();
  const sessionIds = await resolveConversationSessionIds({ tenantId: safeTenantId, order });
  if (!sessionIds.length) return { changed: [], reason: "no_conversation" };

  const successor = await findOtherInFlightDeliveryOrder({ tenantId: safeTenantId, order });
  const successorId = idOrNull(successor?.id);
  /*
   * With no successor the star goes out whichever order it names — nothing this
   * customer has is still moving. With a successor it is only re-pointed when the
   * star names the order that just landed; a star already held by some other live
   * parcel is left exactly as it is.
   */
  const result = await db.query(
    `
    UPDATE ai_support_sessions
    SET is_favorite = $5::boolean,
        auto_favorite_order_id = $4::bigint,
        updated_at = NOW()
    WHERE tenant_id = $1::bigint
      AND session_id = ANY($2::text[])
      AND auto_favorite_order_id IS NOT NULL
      AND ($5::boolean IS FALSE OR auto_favorite_order_id = $3::bigint)
    RETURNING session_id
    `,
    [safeTenantId, sessionIds, orderId, successorId, Boolean(successorId)]
  );
  const changed = result.rows.map((row) => text(row.session_id)).filter(Boolean);
  if (changed.length) {
    announce(safeTenantId, changed, successorId ? "delivery_order_favorite_moved" : "delivery_order_unfavorited");
    console.info("[inbox-favorite:delivery-order-cleared]", {
      tenant_id: safeTenantId,
      order_id: orderId,
      sessions: changed.length,
      moved_to_order_id: successorId,
      source,
    });
  }
  return { changed, reason: changed.length ? "" : "not_auto_favorite", movedToOrderId: successorId };
};

/*
 * The single entry point every call site uses. It reads the order it is handed and
 * decides which way the star goes, so no caller has to know the rule — a created
 * delivery order stars, a delivered/cancelled one unstars, and everything else
 * (a till sale, a pickup, a draft) is a no-op.
 */
export const syncDeliveryOrderFavorite = async ({ tenantId, order, source = "" } = {}) => {
  try {
    const safeOrder = order || {};
    if (!idOrNull(safeOrder.id)) return { changed: [], reason: "order_missing" };
    if (!isDeliveryOrder(safeOrder)) return { changed: [], reason: "not_a_delivery_order" };
    if (isInFlightDeliveryOrder(safeOrder)) {
      return favoriteConversationsForOrder({ tenantId, order: safeOrder, source });
    }
    return unfavoriteConversationsForOrder({ tenantId, order: safeOrder, source });
  } catch (error) {
    // The star is a convenience on top of the order; it must never be the reason a
    // checkout or a courier callback fails.
    console.warn("[inbox-favorite:delivery-order-skipped]", {
      order_id: order?.id || null,
      source,
      message: error?.message || String(error),
    });
    return { changed: [], reason: "error" };
  }
};

export default {
  ensureDeliveryFavoriteSchema,
  favoriteConversationsForOrder,
  isDeliveredOrder,
  isDeliveryOrder,
  isInFlightDeliveryOrder,
  syncDeliveryOrderFavorite,
  unfavoriteConversationsForOrder,
};

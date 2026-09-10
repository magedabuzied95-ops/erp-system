import db from "../../database/db.js";
import { markOrderConfirmedByStaff, sendOrderConfirmation } from "../../services/whatsappOrderConfirmationService.js";
import { recordEmployeePortalAudit } from "../../services/employeePayrollPortalService.js";
import { canCreateBostaShipmentFor } from "./shipping.center.service.js";
import { getPortalOnlineOrder } from "./shipping.portal.service.js";
import { createBostaShipmentForOrder, fetchBostaShipmentLabels } from "./shipping.service.js";

// The four things staff can DO from أوردرات الشحن: confirm → ready to ship → create the
// Bosta parcel → print its airway bill. Every action first re-reads the order through
// the same tenant + online-order filter the board uses, so an id typed into a request
// can never act on another shop's order or on a till invoice. Each step also enforces
// the order of the flow: nothing is shipped before it is confirmed.
//
// Everything reuses the ERP's own paths — the confirmation engine (staff mode), the
// Bosta create with its duplicate guard and customer notification, the AWB fetch —
// and records who pressed the button on the order timeline and in the portal audit log.

export const PORTAL_ORDER_ACTIONS = ["confirm", "send_confirmation", "ready_to_ship", "create_shipment", "print_awb"];
// Shipping the parcel and printing its airway bill are open to EVERY employee in the
// employee portal (owner request 2026-09-10: whoever packs, ships). Confirming an
// order stays with managers and the employees switched on.
export const PORTAL_SHIP_ACTIONS = ["create_shipment", "print_awb"];

// Why sendOrderConfirmation declined, as a code the portal can say in Arabic.
const CONFIRMATION_SEND_CODES = {
  missing_phone: "CONFIRMATION_MISSING_PHONE",
  order_already_dispatched: "CONFIRMATION_ORDER_DISPATCHED",
  status_not_confirmable: "CONFIRMATION_STATUS_NOT_CONFIRMABLE",
  order_missing: "order_not_found",
};

const text = (value = "") => String(value ?? "").trim();
const normalized = (value = "") => text(value).toLowerCase().replace(/[\s-]+/g, "_");

const actionError = (status, code, message, payload) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (payload) error.payload = payload;
  return error;
};

const appendTimeline = async (client, { orderId, action, status, actor, source, label }) => {
  await client.query(
    `
    UPDATE orders
    SET timeline = COALESCE(timeline, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('action', $2::text, 'status', $3::text, 'note', '', 'source', $4::text, 'actor', $5::text, 'label', $6::text, 'at', NOW())
    )
    WHERE id = $1
    `,
    [orderId, action, status, source, actor, label]
  );
};

const markReadyToShip = async ({ order, actorName, source, client = db }) => {
  // The WHERE re-checks the state, so two people pressing at once move it once.
  const result = await client.query(
    `
    UPDATE orders
    SET status = 'ready_to_ship',
        shipping_status = CASE WHEN COALESCE(NULLIF(shipping_status, ''), 'pending') IN ('pending', 'ready_to_ship') THEN 'ready_to_ship' ELSE shipping_status END,
        shipment_status = CASE WHEN COALESCE(NULLIF(shipment_status, ''), 'pending') IN ('pending', 'ready_to_ship') THEN 'ready_to_ship' ELSE shipment_status END,
        shipment_timeline = COALESCE(shipment_timeline, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('status', 'ready_to_ship', 'action', 'portal_ready_to_ship', 'actor', $2::text, 'source', $3::text, 'at', NOW())
        ),
        timeline = COALESCE(timeline, '[]'::jsonb) || jsonb_build_array(
          jsonb_build_object('action', 'portal_ready_to_ship', 'status', 'ready_to_ship', 'note', '', 'source', $3::text, 'actor', $2::text, 'label', 'جاهز للشحن', 'at', NOW())
        ),
        updated_at = NOW()
    WHERE id = $1
      AND LOWER(COALESCE(status, '')) IN ('confirmed', 'paid', 'approved', 'processing', 'packed', 'ready')
    RETURNING id
    `,
    [order.id, actorName, source]
  );
  return result.rows.length > 0;
};

// Bosta's own "missing city, zone" error is English prose with no code; give the
// portal something it can say in Arabic.
const translateBostaError = (error) => {
  const message = text(error?.message);
  if (!error?.code && /Cannot create Bosta shipment\. Missing/i.test(message)) {
    return actionError(400, "BOSTA_ADDRESS_INCOMPLETE", message);
  }
  return error;
};

// Injected so the action rules can be tested without a database or a courier.
const defaultDeps = {
  loadOrder: getPortalOnlineOrder,
  confirm: markOrderConfirmedByStaff,
  // The order page's own "إرسال رسالة التأكيد": a manual send, so only "no phone" and
  // "already past dispatch" can stop it (see sendOrderConfirmation's force branch).
  sendConfirmation: (orderId) => sendOrderConfirmation({ id: orderId }, { force: true }),
  markReady: markReadyToShip,
  createShipment: createBostaShipmentForOrder,
  fetchLabels: fetchBostaShipmentLabels,
  appendTimeline: (entry) => appendTimeline(db, entry),
  audit: recordEmployeePortalAudit,
};

/**
 * @param {object} args
 * @param {object} args.actor   the employees row pressing the button ({ id, tenant_id, full_name })
 * @param {"employee_portal"|"manager_portal"} args.surface
 */
export const runPortalOrderAction = async ({ actor = {}, surface = "employee_portal", orderId, action, deps: injected = {} } = {}) => {
  const deps = { ...defaultDeps, ...injected };
  const key = normalized(action);
  if (!PORTAL_ORDER_ACTIONS.includes(key)) throw actionError(400, "UNKNOWN_ACTION", "Unknown action");
  const tenantId = actor.tenant_id ?? null;
  // Throws 404 for anything the board would not list — another shop, a till sale, a draft.
  const order = await deps.loadOrder({ tenantId, orderId });
  const actorName = text(actor.full_name || actor.name) || `employee:${actor.id || ""}`;
  const status = normalized(order.status);
  let result = {};

  if (key === "confirm") {
    if (order.group !== "new") throw actionError(409, "ORDER_NOT_CONFIRMABLE", "Only a new order can be confirmed");
    const updated = await deps.confirm({ orderId: order.id, actorName, source: surface });
    if (normalized(updated?.status) !== "confirmed") {
      throw actionError(409, "ORDER_NOT_CONFIRMABLE", "This order cannot be confirmed from its current status");
    }
  } else if (key === "send_confirmation") {
    if (order.group !== "new") throw actionError(409, "CONFIRMATION_NOT_NEEDED", "Only a new order is sent a confirmation request");
    let sent;
    try {
      sent = await deps.sendConfirmation(order.id);
    } catch (error) {
      // 409, not 5xx: a 5xx reaches the browser as an opaque CORS error.
      throw actionError(409, "WHATSAPP_GATEWAY_ERROR", error?.message || "WhatsApp gateway refused the message");
    }
    // Queued IS success: the outbound queue paces and retries it.
    if (!sent?.sent && !sent?.queued) {
      const reason = text(sent?.reason);
      throw actionError(409, CONFIRMATION_SEND_CODES[reason] || "CONFIRMATION_NOT_SENT", reason || "Confirmation request was not sent");
    }
    result = { queued: Boolean(sent.queued) };
    await Promise.resolve()
      .then(() => deps.appendTimeline({ orderId: order.id, action: "portal_confirmation_sent", status: text(order.status), actor: actorName, source: surface, label: "إرسال رسالة التأكيد" }))
      .catch((error) => console.warn("[portal-order-action] timeline append failed", { orderId: order.id, message: error?.message }));
  } else if (key === "ready_to_ship") {
    if (status === "ready_to_ship") {
      // Already there — pressing it again is not an error.
    } else if (order.group !== "confirmed") {
      throw actionError(409, order.group === "new" ? "ORDER_NOT_CONFIRMED" : "ORDER_PAST_READY", "Confirm the order before marking it ready to ship");
    } else if (!(await deps.markReady({ order, actorName, source: surface }))) {
      throw actionError(409, "ORDER_NOT_CONFIRMED", "The order changed before it could be marked ready");
    }
  } else if (key === "create_shipment") {
    if (order.group === "new") throw actionError(409, "ORDER_NOT_CONFIRMED", "Confirm the order before shipping it");
    if (order.group !== "confirmed") {
      throw actionError(409, "BOSTA_SHIPMENT_EXISTS", "This order already has a shipment", { tracking_number: order.shipment.tracking_number });
    }
    if (!canCreateBostaShipmentFor(order.shipment.provider, "bosta")) {
      throw actionError(409, "OTHER_COURIER", "This order is booked with another courier", { provider: order.shipment.provider });
    }
    try {
      await deps.createShipment(order.id);
    } catch (error) {
      throw translateBostaError(error);
    }
    await Promise.resolve()
      .then(() => deps.appendTimeline({ orderId: order.id, action: "portal_bosta_created", status: "shipment_created", actor: actorName, source: surface, label: "تم إنشاء شحنة بوسطة" }))
      .catch((error) => console.warn("[portal-order-action] timeline append failed", { orderId: order.id, message: error?.message }));
  } else if (key === "print_awb") {
    if (!order.shipment.tracking_number && !order.shipment.delivery_id) {
      throw actionError(409, "BOSTA_NO_PRINTABLE_LABEL", "This order has no shipment to print yet");
    }
    // Deliberately NOT bulkShippingCenterAction: that path can also push the PDF to the
    // ops WhatsApp number; printing from a phone should just print.
    const labels = await deps.fetchLabels([order.id]);
    result = { pdf_base64: labels.pdf_base64, content_type: labels.content_type || "application/pdf" };
  }

  Promise.resolve().then(() => deps.audit({
    employee: actor,
    action: `online_order_${key}`,
    metadata: { order_id: order.id, order_number: order.order_number, surface },
  })).catch((error) => console.warn("[portal-order-action] audit failed", { orderId: order.id, message: error?.message }));

  if (key === "print_awb") return result;
  return { ...result, order: await deps.loadOrder({ tenantId, orderId: order.id }) };
};

const BULK_PRINT_LIMIT = 50;

// Several airway bills in one PDF (the board's multi-select). Every id goes through the
// same tenant + online-order read as a single action; ids that are not the caller's,
// or have no Bosta parcel yet, are skipped and reported rather than failing the batch.
// Bulk CREATE is deliberately not here: the board sends those one order per request,
// so a long batch can never outlive the 60s request timeout while Bosta keeps booking.
export const runPortalBulkPrint = async ({ actor = {}, surface = "employee_portal", orderIds = [], deps: injected = {} } = {}) => {
  const deps = { ...defaultDeps, ...injected };
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) throw actionError(400, "NO_ORDERS_SELECTED", "Select at least one order");
  if (ids.length > BULK_PRINT_LIMIT) throw actionError(400, "TOO_MANY_ORDERS", `Print at most ${BULK_PRINT_LIMIT} at a time`);
  const tenantId = actor.tenant_id ?? null;
  const printable = [];
  const skipped = [];
  for (const id of ids) {
    try {
      const order = await deps.loadOrder({ tenantId, orderId: id });
      const hasParcel = Boolean(order.shipment?.tracking_number || order.shipment?.delivery_id);
      if (hasParcel && normalized(order.shipment?.provider) === "bosta") printable.push(order.id);
      else skipped.push({ id, order_number: order.order_number, code: "BOSTA_NO_PRINTABLE_LABEL" });
    } catch (error) {
      skipped.push({ id, code: error.code || "order_not_found" });
    }
  }
  if (!printable.length) throw actionError(409, "BOSTA_NO_PRINTABLE_LABEL", "None of the selected orders has a shipment to print", { skipped });
  const labels = await deps.fetchLabels(printable);
  Promise.resolve().then(() => deps.audit({
    employee: actor,
    action: "online_order_bulk_print_awb",
    metadata: { order_ids: printable, skipped: skipped.length, surface },
  })).catch((error) => console.warn("[portal-order-action] audit failed", { message: error?.message }));
  return { pdf_base64: labels.pdf_base64, content_type: labels.content_type || "application/pdf", printed: printable.length, skipped };
};

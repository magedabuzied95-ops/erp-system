import { recordEmployeePortalAudit } from "../../services/employeePayrollPortalService.js";
import db from "../../database/db.js";
import { getPortalOnlineOrder } from "./shipping.portal.service.js";

// Edit and delete an online order from the manager portal's ⋮ menu (owner request
// 2026-09-10). Both go through the ERP's own handlers — editOrder's field-only "safe
// patch" and deleteOrder ("إلغاء الطلب واسترجاع المخزون", what the Orders page's menu
// runs) — so stock, loyalty, coupon, money reversal and the manager's delete alert all
// behave exactly as they do there. The portal has no users row, so the handler gets a
// request built HERE: tenant from the token holder, never a super-admin role (that
// would drop tenant scoping), and a body that only ever carries the whitelist below.
//
// Both are refused once a Bosta parcel exists: deleteOrder never cancels the parcel
// (the courier would still deliver and collect), and editOrder never tells Bosta about
// a new address.

const text = (value = "") => String(value ?? "").trim();

// The fields OrderDetails' shipping editor sends through the same safe patch — minus
// status, payment, tracking and shipping_cost (which would leave the total stale).
export const PORTAL_EDITABLE_FIELDS = [
  "customer_name",
  "customer_phone",
  "customer_address",
  "governorate",
  "city_area",
  "landmark",
  "street_address",
  "building_number",
  "floor_number",
  "apartment_number",
  "delivery_notes",
  "order_notes",
  "shipping_city_id",
  "shipping_zone_id",
  "shipping_district_id",
];
const FIELD_MAX_LENGTH = 500;
const MANAGEABLE_GROUPS = new Set(["new", "confirmed"]);

const manageError = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const createMockResponse = () => {
  let resolve;
  const done = new Promise((finish) => { resolve = finish; });
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    set() { return this; },
    json(payload) { this.headersSent = true; resolve({ statusCode: this.statusCode, payload }); return payload; },
    send(payload) { this.headersSent = true; resolve({ statusCode: this.statusCode, payload }); return payload; },
  };
  return { res, done };
};

// Same adapter as server/scripts/qaDowngradeExchangeTest.js: run an Express handler
// and read what it answered.
const invokeHandler = async (handler, req) => {
  const { res, done } = createMockResponse();
  const running = Promise.resolve(handler(req, res));
  const result = await Promise.race([done, running.then(() => null)]);
  await running.catch(() => {});
  if (!result) throw manageError(500, "HANDLER_NO_RESPONSE", "The order handler returned without answering");
  return result;
};

const portalRequest = ({ actor, orderId, body }) => ({
  params: { id: String(orderId) },
  body,
  query: {},
  headers: {},
  tenantId: actor.tenant_id ?? null,
  // No users row behind a portal token: id stays null (deleted_by / audit user_id are
  // users ids). Role is deliberately NOT super_admin — that would unscope the tenant.
  user: { id: null, tenant_id: actor.tenant_id ?? null, tenantId: actor.tenant_id ?? null, role: "manager_portal", name: text(actor.full_name) },
});

const loadOrdersController = () => import("../../controllers/ordersController.js");

const defaultDeps = {
  loadOrder: getPortalOnlineOrder,
  editHandler: async (req) => invokeHandler((await loadOrdersController()).editOrder, req),
  deleteHandler: async (req) => {
    // deleteOrder reverses money through accountingService, whose first-ever call runs
    // ensureAccountingSchema — an ALTER TABLE orders on ANOTHER connection — while
    // deleteOrder's own transaction holds the order row FOR UPDATE: each waits for the
    // other until the query timeout. bootstrapStartup warms it in production; awaiting
    // the (memoised) promise here keeps this path correct in any process.
    await (await import("../../services/accountingService.js")).ensureAccountingSchema();
    return invokeHandler((await loadOrdersController()).deleteOrder, req);
  },
  appendTimeline: async ({ orderId, action, actor, source, label }) => {
    await db.query(
      `UPDATE orders SET timeline = COALESCE(timeline, '[]'::jsonb) || jsonb_build_array(
         jsonb_build_object('action', $2::text, 'status', '', 'note', '', 'source', $3::text, 'actor', $4::text, 'label', $5::text, 'at', NOW())
       ) WHERE id = $1`,
      [orderId, action, source, actor, label]
    );
  },
  audit: recordEmployeePortalAudit,
};

const assertManageable = (order) => {
  if (text(order.shipment?.tracking_number) || text(order.shipment?.delivery_id)) {
    throw manageError(409, "ORDER_HAS_SHIPMENT", "This order already has a courier shipment");
  }
  if (!MANAGEABLE_GROUPS.has(order.group)) {
    throw manageError(409, "ORDER_LOCKED", "This order can no longer be edited or deleted here");
  }
};

const sideEffects = (deps, entry) =>
  Promise.resolve()
    .then(() => deps.audit(entry))
    .catch((error) => console.warn("[portal-order-manage] audit failed", { message: error?.message }));

export const editPortalOnlineOrder = async ({ actor = {}, surface = "manager_portal", orderId, fields = {}, deps: injected = {} } = {}) => {
  const deps = { ...defaultDeps, ...injected };
  const tenantId = actor.tenant_id ?? null;
  const order = await deps.loadOrder({ tenantId, orderId });
  assertManageable(order);

  const body = {};
  for (const key of PORTAL_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields || {}, key)) continue;
    body[key] = text(fields[key]).slice(0, FIELD_MAX_LENGTH);
  }
  if (!Object.keys(body).length) throw manageError(400, "NOTHING_TO_SAVE", "Nothing to save");
  if ("customer_name" in body && !body.customer_name) throw manageError(400, "CUSTOMER_NAME_REQUIRED", "Customer name is required");
  if ("customer_phone" in body && body.customer_phone.replace(/\D/g, "").length < 8) throw manageError(400, "CUSTOMER_PHONE_INVALID", "Customer phone is required");
  const actorName = text(actor.full_name) || `employee:${actor.id || ""}`;
  body.reason = `بوابة المدير — ${actorName}`;

  const { statusCode, payload } = await deps.editHandler(portalRequest({ actor, orderId: order.id, body }));
  if (statusCode >= 400) throw manageError(statusCode === 404 ? 404 : 409, "EDIT_REFUSED", payload?.message || "The order could not be edited");

  await Promise.resolve()
    .then(() => deps.appendTimeline({ orderId: order.id, action: "portal_edited", actor: actorName, source: surface, label: "تعديل بيانات الأوردر" }))
    .catch((error) => console.warn("[portal-order-manage] timeline append failed", { message: error?.message }));
  sideEffects(deps, { employee: actor, action: "online_order_edit", metadata: { order_id: order.id, fields: Object.keys(body).filter((key) => key !== "reason"), surface } });
  return { order: await deps.loadOrder({ tenantId, orderId: order.id }) };
};

export const deletePortalOnlineOrder = async ({ actor = {}, surface = "manager_portal", orderId, reason = "", deps: injected = {} } = {}) => {
  const deps = { ...defaultDeps, ...injected };
  const tenantId = actor.tenant_id ?? null;
  const order = await deps.loadOrder({ tenantId, orderId });
  assertManageable(order);
  const actorName = text(actor.full_name) || `employee:${actor.id || ""}`;
  const why = text(reason).slice(0, 300);
  const body = { reason: `بوابة المدير — ${actorName}${why ? `: ${why}` : ""}` };

  const { statusCode, payload } = await deps.deleteHandler(portalRequest({ actor, orderId: order.id, body }));
  if (statusCode >= 400) throw manageError(statusCode === 404 ? 404 : 409, "DELETE_REFUSED", payload?.message || "The order could not be deleted");

  sideEffects(deps, { employee: actor, action: "online_order_delete", metadata: { order_id: order.id, order_number: order.order_number, reason: why, surface } });
  return {
    deleted: true,
    order_id: order.id,
    // deleteOrder skips the restore when a customer cancel already put the stock back.
    restored_items: Array.isArray(payload?.restored_items) ? payload.restored_items.length : 0,
    stock_already_restored: Boolean(payload?.stock_already_restored),
  };
};

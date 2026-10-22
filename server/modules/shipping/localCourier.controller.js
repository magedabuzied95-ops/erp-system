import { getTenantId } from "../../utils/requestScope.js";
import {
  createLocalCourierSettlement,
  dispatchWithLocalCourier,
  getLocalCourierSettings,
  listLocalCourierBacklog,
  listOpenDrawerShifts,
  markLocalCourierBacklogDelivered,
  markLocalCourierDelivered,
  markLocalCourierReturned,
  saveLocalCourierSettings,
  settleDeliveredLocalExchanges,
} from "./localCourier.js";

const sendError = (res, error) => {
  const status = Number(error?.status || error?.statusCode || 500);
  if (status >= 500) console.error("[local-courier]", error);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: error?.message || "Local courier request failed",
    code: error?.code || undefined,
    details: error?.payload || undefined,
  });
};

const tenantOf = (req) => getTenantId(req, req.user?.tenant_id ?? null);
const actorOf = (req) => String(req.user?.name || req.user?.email || `user:${req.user?.id || ""}`);

export const getLocalCourierSettingsController = async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const [settings, shifts] = await Promise.all([getLocalCourierSettings({ tenantId }), listOpenDrawerShifts({ tenantId })]);
    res.json({ success: true, settings, open_shifts: shifts });
  } catch (error) {
    sendError(res, error);
  }
};

export const saveLocalCourierSettingsController = async (req, res) => {
  try {
    const body = req.body || {};
    const settings = await saveLocalCourierSettings({
      tenantId: tenantOf(req),
      courierName: body.courier_name,
      courierPhone: body.courier_phone,
      feePerOrder: body.fee_per_order,
    });
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error);
  }
};

export const localCourierOrderActionController = async (req, res) => {
  try {
    const args = { orderId: req.params.id, tenantId: tenantOf(req), actorName: actorOf(req), source: "orders" };
    const action = String(req.params.action || "");
    let result;
    if (action === "dispatch") result = { order: await dispatchWithLocalCourier(args) };
    else if (action === "delivered") result = await markLocalCourierDelivered(args);
    else if (action === "returned") result = await markLocalCourierReturned(args);
    else return res.status(400).json({ success: false, code: "UNKNOWN_ACTION", message: "Unknown action" });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
};

export const listLocalCourierBacklogController = async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    // Opening the tab also puts back any exchange piece a delivered parcel is still owed.
    const exchanges = await settleDeliveredLocalExchanges({ tenantId })
      .catch((error) => ({ error: error?.message || "failed", restocked: [] }));
    const rows = await listLocalCourierBacklog({ tenantId, limit: req.query.limit });
    res.json({ success: true, rows, exchanges_restocked: exchanges.restocked || [] });
  } catch (error) {
    sendError(res, error);
  }
};

export const markLocalCourierBacklogController = async (req, res) => {
  try {
    const result = await markLocalCourierBacklogDelivered({ tenantId: tenantOf(req), orderIds: req.body?.order_ids, actorName: actorOf(req) });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
};

export const createLocalCourierSettlementController = async (req, res) => {
  try {
    const body = req.body || {};
    const settlement = await createLocalCourierSettlement({
      tenantId: tenantOf(req),
      orderIds: body.order_ids,
      feesAmount: body.fees_amount,
      shiftId: body.shift_id,
      payments: body.payments && typeof body.payments === "object" ? body.payments : null,
      notes: body.notes,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ success: true, settlement });
  } catch (error) {
    sendError(res, error);
  }
};

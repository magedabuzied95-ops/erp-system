import { getTenantId } from "../../utils/requestScope.js";
import {
  backfillCourierCollections,
  createCourierSettlement,
  ensureCourierSettlementSchema,
  getCourierSettlement,
  listCourierCollections,
  listCourierSettlements,
} from "./shipping.settlements.service.js";
import {
  createCourierPackage,
  getCourierCostReport,
  listCourierPackages,
  reconcileCourierCosts,
  saveCourierCostSettings,
  voidCourierPackage,
} from "./shipping.costs.service.js";

const sendError = (res, error, fallback = "Courier settlement request failed") => {
  const status = Number(error?.status || error?.statusCode || 500);
  if (status >= 500) console.error("[courier-settlements]", error);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    message: error?.message || fallback,
    code: error?.code || undefined,
    details: error?.payload || undefined,
  });
};

const tenantOf = (req) => getTenantId(req, req.user?.tenant_id ?? null);

export const listCourierCollectionsController = async (req, res) => {
  try {
    const data = await listCourierCollections({
      tenantId: tenantOf(req),
      provider: String(req.query.provider ?? "bosta"),
      state: String(req.query.state || "pending"),
      dateFrom: String(req.query.date_from || ""),
      dateTo: String(req.query.date_to || ""),
      search: String(req.query.search || ""),
      limit: req.query.limit,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    sendError(res, error);
  }
};

export const backfillCourierCollectionsController = async (req, res) => {
  try {
    const result = await backfillCourierCollections({
      tenantId: tenantOf(req),
      provider: String(req.body?.provider ?? "bosta"),
      orderIds: Array.isArray(req.body?.order_ids) ? req.body.order_ids : [],
    });
    res.json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
};

export const listCourierSettlementsController = async (req, res) => {
  try {
    const rows = await listCourierSettlements({ tenantId: tenantOf(req), provider: String(req.query.provider || ""), limit: req.query.limit });
    res.json({ success: true, settlements: rows });
  } catch (error) {
    sendError(res, error);
  }
};

export const getCourierSettlementController = async (req, res) => {
  try {
    const settlement = await getCourierSettlement({ tenantId: tenantOf(req), id: req.params.id });
    res.json({ success: true, settlement });
  } catch (error) {
    sendError(res, error);
  }
};

export const createCourierSettlementController = async (req, res) => {
  try {
    const body = req.body || {};
    const settlement = await createCourierSettlement({
      tenantId: tenantOf(req),
      provider: body.provider || "bosta",
      orderIds: body.order_ids,
      feesAmount: body.fees_amount,
      netAmount: body.net_amount,
      settledAt: body.settled_at,
      reference: body.reference,
      notes: body.notes,
      moneyAccountId: body.money_account_id,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ success: true, settlement });
  } catch (error) {
    sendError(res, error);
  }
};

// ---------------------------------------------------------------------------
// Courier costs: prepaid packages, per-shipment cost, small-pickup fee settings.
// Every read reconciles first, so the screen never shows a stale consumption.
// ---------------------------------------------------------------------------

export const listCourierPackagesController = async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const provider = String(req.query.provider || "bosta");
    await ensureCourierSettlementSchema();
    await reconcileCourierCosts({ tenantId, provider });
    res.json({ success: true, ...(await listCourierPackages({ tenantId, provider })) });
  } catch (error) {
    sendError(res, error);
  }
};

export const createCourierPackageController = async (req, res) => {
  try {
    const body = req.body || {};
    const result = await createCourierPackage({
      tenantId: tenantOf(req),
      provider: body.provider || "bosta",
      price: body.price,
      shipmentsCount: body.shipments_count,
      purchasedAt: body.purchased_at,
      moneyAccountId: body.money_account_id,
      reference: body.reference,
      notes: body.notes,
      createdBy: req.user?.id || null,
    });
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    sendError(res, error);
  }
};

export const voidCourierPackageController = async (req, res) => {
  try {
    res.json({ success: true, ...(await voidCourierPackage({ tenantId: tenantOf(req), id: req.params.id, voidedBy: req.user?.id || null })) });
  } catch (error) {
    sendError(res, error);
  }
};

export const getCourierCostReportController = async (req, res) => {
  try {
    const tenantId = tenantOf(req);
    const provider = String(req.query.provider || "bosta");
    await ensureCourierSettlementSchema();
    await reconcileCourierCosts({ tenantId, provider });
    const report = await getCourierCostReport({
      tenantId,
      provider,
      dateFrom: String(req.query.date_from || ""),
      dateTo: String(req.query.date_to || ""),
      search: String(req.query.search || ""),
      limit: req.query.limit,
    });
    res.json({ success: true, ...report });
  } catch (error) {
    sendError(res, error);
  }
};

export const saveCourierCostSettingsController = async (req, res) => {
  try {
    const body = req.body || {};
    const settings = await saveCourierCostSettings({
      tenantId: tenantOf(req),
      provider: body.provider || "bosta",
      pickupMinParcels: body.pickup_min_parcels,
      pickupSmallFee: body.pickup_small_fee,
      autoRenew: body.auto_renew,
    });
    res.json({ success: true, settings });
  } catch (error) {
    sendError(res, error);
  }
};

import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  approveInventoryCountSession,
  cancelInventoryCountSession,
  deleteInventoryCountSession,
  createInventoryCountSession,
  addProductModelToCount,
  getInventoryCountSession,
  listInventoryCountSessions,
  openInventoryCountSession,
  rejectInventoryCountSession,
  reopenInventoryCountSession,
  searchInventoryCountVariants,
  submitInventoryCountSession,
  updateInventoryCountSession,
  upsertInventoryCountItem,
} from "../services/inventoryCountService.js";

const scopedTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));
const isReviewerUser = (user = {}) =>
  Boolean(user?.is_super_admin) ||
  ["admin", "super_admin", "super admin", "superadmin", "platform_admin", "manager", "branch manager"].includes(
    String(user?.role || user?.role_name || "").trim().toLowerCase().replace(/[_-]+/g, " ")
  );

const parseLimit = (value, fallback = 25, max = 200) => Math.min(Math.max(Number(value || fallback), 1), max);
const resolveSessionId = (req) => req.params?.id ?? req.body?.sessionId ?? req.body?.session_id ?? req.body?.inventoryCountSessionId ?? req.body?.inventory_count_session_id ?? req.body?.inventoryCountId ?? req.body?.inventory_count_id ?? null;

export const listSessions = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await listInventoryCountSessions(db, {
      tenantId,
      search: req.query.search || "",
      status: req.query.status || "",
      branchId: req.query.branchId || req.query.branch_id || null,
      warehouseId: req.query.warehouseId || req.query.warehouse_id || null,
      page: req.query.page || 1,
      limit: req.query.limit || 25,
    });

    return res.json({
      success: true,
      sessions: result.sessions,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    console.error("[inventory-count] list sessions", error);
    return res.status(500).json({ success: false, message: "Failed to load inventory count sessions" });
  }
};

export const createSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const session = await createInventoryCountSession(db, {
      tenantId,
      branchId: req.body?.branchId ?? req.body?.branch_id ?? null,
      warehouseId: req.body?.warehouseId ?? req.body?.warehouse_id ?? null,
      title: req.body?.title || req.body?.session_title || "جرد جديد",
      notes: req.body?.notes || "",
      createdBy: req.user?.id || null,
    });

    return res.status(201).json({ success: true, session });
  } catch (error) {
    console.error("[inventory-count] create session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create inventory count session" });
  }
};

export const getSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await getInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
    });
    if (!result) {
      return res.status(404).json({ success: false, message: "Inventory count session not found" });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[inventory-count] get session", error);
    return res.status(500).json({ success: false, message: "Failed to load inventory count session" });
  }
};

export const updateSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const session = await updateInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      branchId: req.body?.branchId ?? req.body?.branch_id ?? null,
      warehouseId: req.body?.warehouseId ?? req.body?.warehouse_id ?? null,
      title: req.body?.title ?? req.body?.session_title,
      notes: req.body?.notes,
    });
    return res.json({ success: true, session });
  } catch (error) {
    console.error("[inventory-count] update session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update inventory count session" });
  }
};

export const openSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const session = await openInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      openedBy: req.user?.id || null,
    });
    return res.json({ success: true, session });
  } catch (error) {
    console.error("[inventory-count] open session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to open inventory count session" });
  }
};

export const submitSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await submitInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      submittedBy: req.user?.id || null,
      user: req.user || {},
    });
    return res.json({
      success: true,
      session: result.session,
      submitted: result.submitted === true,
    });
  } catch (error) {
    console.error("[inventory-count] submit session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to submit inventory count session" });
  }
};

export const rejectSession = async (req, res) => {
  try {
    if (!isReviewerUser(req.user)) {
      return res.status(403).json({ success: false, message: "Manager approval required" });
    }
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const result = await rejectInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      rejectedBy: req.user?.id || null,
      rejectionReason: req.body?.rejectionReason || req.body?.rejection_reason || req.body?.reason || "",
      user: req.user || {},
    });
    return res.json({
      success: true,
      session: result.session,
      rejected: result.rejected === true,
    });
  } catch (error) {
    console.error("[inventory-count] reject session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reject inventory count session" });
  }
};

export const reopenSession = async (req, res) => {
  try {
    if (!isReviewerUser(req.user)) {
      return res.status(403).json({ success: false, message: "Manager approval required" });
    }
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const result = await reopenInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      reopenedBy: req.user?.id || null,
      user: req.user || {},
    });
    return res.json({
      success: true,
      session: result.session,
      reopened: result.reopened === true,
    });
  } catch (error) {
    console.error("[inventory-count] reopen session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to reopen inventory count session" });
  }
};

export const lookupVariants = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await searchInventoryCountVariants(db, {
      tenantId,
      query: req.query.query || req.query.search || req.query.term || "",
      limit: parseLimit(req.query.limit, 10, 25),
    });
    return res.json({
      success: true,
      items: Array.isArray(result?.items) ? result.items : [],
      resolvedProductId: result?.resolvedProductId ?? null,
      resolvedVariantId: result?.resolvedVariantId ?? null,
      matchedBy: result?.matchedBy || "",
      resolutionType: result?.resolutionType || "",
      expandedProduct: Boolean(result?.expandedProduct),
      queryText: result?.queryText || "",
    });
  } catch (error) {
    console.error("[inventory-count] lookup variants", error);
    return res.status(500).json({ success: false, message: "Failed to search inventory count variants" });
  }
};

export const upsertItem = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await upsertInventoryCountItem(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      productVariantId: req.body?.productVariantId ?? req.body?.product_variant_id ?? req.body?.variantId ?? req.body?.variant_id,
      countedQuantity: req.body?.countedQuantity ?? req.body?.counted_quantity,
      systemQuantity: req.body?.systemQuantity ?? req.body?.system_quantity,
      reason: req.body?.reason || "",
      notes: req.body?.notes || "",
      userId: req.user?.id || null,
    });

    return res.json({
      success: true,
      session: result.session,
      item: result.item,
    });
  } catch (error) {
    console.error("[inventory-count] upsert item", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save inventory count item" });
  }
};

export const addModel = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await addProductModelToCount(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      productId: req.body?.productId ?? req.body?.product_id ?? req.body?.productID ?? req.body?.product ?? null,
      scanValue: req.body?.scanValue ?? req.body?.query ?? req.body?.search ?? req.body?.term ?? "",
      userId: req.user?.id || null,
    });

    return res.json({
      success: true,
      session: result.session,
      items: result.items,
      insertedCount: result.insertedCount || 0,
      skippedCount: result.skippedCount || 0,
    });
  } catch (error) {
    console.error("[inventory-count] add model", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to add product model to inventory count" });
  }
};

export const approveSession = async (req, res) => {
  try {
    console.log("[inventory-count:approve:request]", JSON.stringify({
      tenant: req.tenant ?? null,
      tenantId: req.tenantId ?? null,
      user: req.user ?? null,
      company: req.company ?? null,
      headers: req.headers ?? null,
    }));
    if (!isReviewerUser(req.user)) {
      return res.status(403).json({ success: false, message: "Manager approval required" });
    }
    const tenantId = getTenantId(req, req.user?.tenant_id);
    const result = await approveInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      approvedBy: req.user?.id || null,
      user: req.user || {},
    });

    return res.json({
      success: true,
      session: result.session,
      adjustments: result.adjustments,
    });
  } catch (error) {
    console.error("[inventory-count] approve session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to approve inventory count session" });
  }
};

export const cancelSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await cancelInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      cancelledBy: req.user?.id || null,
      notes: req.body?.notes || "",
    });

    return res.json({
      success: true,
      session: result.session,
    });
  } catch (error) {
    console.error("[inventory-count] cancel session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to cancel inventory count session" });
  }
};

export const deleteSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await deleteInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      deletedBy: req.user?.id || null,
    });

    return res.json({
      success: true,
      deleted: result.deleted === true,
      deletedItemsCount: result.deletedItemsCount || 0,
      session: result.session,
    });
  } catch (error) {
    console.error("[inventory-count] delete session", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to delete inventory count session" });
  }
};

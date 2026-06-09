import db from "../database/db.js";
import { getTenantId, isSuperAdminUser } from "../utils/requestScope.js";
import {
  approveInventoryCountSession,
  cancelInventoryCountSession,
  createInventoryCountSession,
  getInventoryCountSession,
  listInventoryCountSessions,
  openInventoryCountSession,
  searchInventoryCountVariants,
  updateInventoryCountSession,
  upsertInventoryCountItem,
} from "../services/inventoryCountService.js";

const scopedTenantId = (req) => (isSuperAdminUser(req.user) ? null : getTenantId(req, req.user?.tenant_id));

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

export const lookupVariants = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const items = await searchInventoryCountVariants(db, {
      tenantId,
      query: req.query.query || req.query.search || req.query.term || "",
      limit: parseLimit(req.query.limit, 10, 25),
    });
    return res.json({ success: true, items });
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

export const approveSession = async (req, res) => {
  try {
    const tenantId = scopedTenantId(req);
    const result = await approveInventoryCountSession(db, {
      tenantId,
      sessionId: resolveSessionId(req),
      completedBy: req.user?.id || null,
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

import {
  getSalesSettings,
  listSalesEmployees,
  resolveTenantId,
  saveSalesEmployee,
  upsertSalesSettings,
} from "../services/salesCommissionService.js";

export const getSalesEmployees = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const includeInactive = String(req.query.include_inactive || req.query.includeInactive || "").toLowerCase() === "true";
    const [employees, settings] = await Promise.all([
      listSalesEmployees({ tenantId, includeInactive }),
      getSalesSettings(undefined, tenantId),
    ]);
    return res.json({ success: true, employees, settings });
  } catch (error) {
    console.error("[sales-employees] list error", error);
    return res.status(500).json({ success: false, message: "Failed to load sales employees", error: error.message });
  }
};

export const createSalesEmployee = async (req, res) => {
  try {
    const employee = await saveSalesEmployee({ tenantId: resolveTenantId(req), data: req.body || {} });
    return res.status(201).json({ success: true, employee });
  } catch (error) {
    console.error("[sales-employees] create error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to create sales employee" });
  }
};

export const updateSalesEmployee = async (req, res) => {
  try {
    const employee = await saveSalesEmployee({ tenantId: resolveTenantId(req), id: req.params.id, data: req.body || {} });
    return res.json({ success: true, employee });
  } catch (error) {
    console.error("[sales-employees] update error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to update sales employee" });
  }
};

export const updateSalesEmployeeSettings = async (req, res) => {
  try {
    const settings = await upsertSalesSettings(undefined, resolveTenantId(req), req.body || {});
    return res.json({ success: true, settings });
  } catch (error) {
    console.error("[sales-employees] settings error", error);
    return res.status(500).json({ success: false, message: "Failed to update sales settings", error: error.message });
  }
};

import {
  getPayrollPreview,
  markPayrollAsPaid,
  getSalesSettings,
  listSalesEmployees,
  resolveTenantId,
  saveSalesEmployee,
  upsertSalesSettings,
} from "../services/salesCommissionService.js";

const readPayrollFilters = (query = {}) => ({
  startDate: query.start || query.start_date || query.startDate || "",
  endDate: query.end || query.end_date || query.endDate || "",
  branchId: query.branch_id || query.branchId || "",
  base_salary: query.base_salary || query.baseSalary || 0,
  bonuses: query.bonuses || 0,
  deductions: query.deductions || 0,
  deduction_month: query.deduction_month || query.deductionMonth || query.month || "",
});

export const getSalesEmployees = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const includeInactive = String(req.query.include_inactive || req.query.includeInactive || "").toLowerCase() === "true";
    const branchId = req.query.branch_id || req.query.branchId || null;
    const [employees, settings] = await Promise.all([
      listSalesEmployees({ tenantId, includeInactive, branchId }),
      getSalesSettings(undefined, tenantId),
    ]);
    return res.json({ success: true, employees, settings });
  } catch (error) {
    console.error("[sales-employees] list error", error);
    return res.status(500).json({ success: false, message: "Failed to load sales employees", error: error.message });
  }
};

export const getSalesEmployeeProfiles = async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const includeInactive = String(req.query.include_inactive || req.query.includeInactive || "true").toLowerCase() === "true";
    const branchId = req.query.branch_id || req.query.branchId || null;
    const [employees, settings] = await Promise.all([
      listSalesEmployees({ tenantId, includeInactive, branchId }),
      getSalesSettings(undefined, tenantId),
    ]);
    return res.json({ success: true, employees, profiles: employees, settings });
  } catch (error) {
    console.error("[sales-employees] profiles list error", error);
    return res.status(500).json({ success: false, message: "Failed to load sales employee profiles", error: error.message });
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

export const upsertSalesEmployeeProfile = async (req, res) => {
  try {
    const employee = await saveSalesEmployee({
      tenantId: resolveTenantId(req),
      id: req.params.employee_id || req.params.employeeId,
      data: { ...(req.body || {}), employee_id: req.params.employee_id || req.params.employeeId },
    });
    return res.json({ success: true, employee, profile: employee });
  } catch (error) {
    console.error("[sales-employees] profile upsert error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to save sales profile" });
  }
};

export const getSalesEmployeePayrollPreview = async (req, res) => {
  try {
    const preview = await getPayrollPreview({
      tenantId: resolveTenantId(req),
      employeeId: req.params.id,
      filters: readPayrollFilters(req.query),
    });
    return res.json({ success: true, ...preview });
  } catch (error) {
    console.error("[sales-employees] payroll preview error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load payroll preview" });
  }
};

export const finalizeSalesEmployeePayroll = async (req, res) => {
  try {
    const preview = await getPayrollPreview({
      tenantId: resolveTenantId(req),
      employeeId: req.params.id,
      filters: {
        ...readPayrollFilters(req.body || {}),
        markAdvancesDeducted: "true",
        createdBy: req.user?.id || null,
      },
    });
    return res.json({ success: true, finalized: true, ...preview });
  } catch (error) {
    console.error("[sales-employees] payroll finalize error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to finalize payroll" });
  }
};

export const markSalesEmployeePayrollAsPaid = async (req, res) => {
  try {
    const payroll = await markPayrollAsPaid({
      tenantId: resolveTenantId(req),
      employeeId: req.params.id,
      filters: {
        ...readPayrollFilters(req.body || {}),
        paymentMethod: req.body?.payment_method || req.body?.paymentMethod || req.body?.payment_method_key || "cash",
        createdBy: req.user?.id || null,
      },
    });
    return res.json({ success: true, paid: true, payroll_run: payroll });
  } catch (error) {
    console.error("[sales-employees] payroll payment error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to mark payroll as paid" });
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

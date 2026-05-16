import {
  getPayrollPreview,
  getSalesCommissionReport,
  resolveTenantId,
} from "../services/salesCommissionService.js";

const readFilters = (query = {}) => ({
  startDate: query.start_date || query.startDate || "",
  endDate: query.end_date || query.endDate || "",
  branchId: query.branch_id || query.branchId || "",
  employeeId: query.employee_id || query.employeeId || "",
  base_salary: query.base_salary || query.baseSalary || 0,
  bonuses: query.bonuses || 0,
  deductions: query.deductions || 0,
});

export const getSalesCommissionsReport = async (req, res) => {
  try {
    const report = await getSalesCommissionReport({
      tenantId: resolveTenantId(req),
      filters: readFilters(req.query),
    });
    return res.json({ success: true, ...report });
  } catch (error) {
    console.error("[sales-commissions] report error", error);
    return res.status(500).json({ success: false, message: "Failed to load sales commission report", error: error.message });
  }
};

export const getSalesCommissionPayroll = async (req, res) => {
  try {
    const preview = await getPayrollPreview({
      tenantId: resolveTenantId(req),
      employeeId: req.params.employeeId,
      filters: readFilters(req.query),
    });
    return res.json({ success: true, ...preview });
  } catch (error) {
    console.error("[sales-commissions] payroll error", error);
    return res.status(error.status || 500).json({ success: false, message: error.message || "Failed to load payroll preview" });
  }
};

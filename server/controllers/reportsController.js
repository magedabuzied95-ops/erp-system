import {
  getReportPayload,
  getReportTenantId,
  parseReportFilters,
  toCsv,
} from "../services/reportsService.js";

const sendReport = async (req, res, type) => {
  try {
    const tenantId = getReportTenantId(req);
    const filters = parseReportFilters(req.query || {});
    const payload = await getReportPayload({ type, tenantId, filters });
    return res.status(200).json({
      success: true,
      type,
      data: payload,
    });
  } catch (error) {
    console.error(`[reports] ${type} failed`, error);
    return res.status(500).json({
      success: false,
      message: `Failed to load ${type} report`,
      error: error.message,
    });
  }
};

export const getReportsDashboard = (req, res) => sendReport(req, res, "dashboard");
export const getSalesReports = (req, res) => sendReport(req, res, "sales");
export const getEmployeeReports = (req, res) => sendReport(req, res, "employees");
export const getInventoryReports = (req, res) => sendReport(req, res, "inventory");
export const getCustomerReports = (req, res) => sendReport(req, res, "customers");
export const getFinancialReports = (req, res) => sendReport(req, res, "financial");
export const getAiInsights = (req, res) => sendReport(req, res, "insights");

export const exportReport = async (req, res) => {
  try {
    const tenantId = getReportTenantId(req);
    const filters = parseReportFilters(req.query || {});
    const type = String(req.query.type || "sales").toLowerCase();
    const format = String(req.query.format || "csv").toLowerCase();
    const payload = await getReportPayload({ type, tenantId, filters });
    const rows = Array.isArray(payload?.rows)
      ? payload.rows
      : Object.entries(payload?.kpis || {}).map(([name, value]) => ({ name, value }));

    if (format === "json") {
      return res.status(200).json({ success: true, type, filters, rows });
    }

    const csv = toCsv(rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-report.csv"`);
    return res.status(200).send(csv);
  } catch (error) {
    console.error("[reports] export failed", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export report",
      error: error.message,
    });
  }
};

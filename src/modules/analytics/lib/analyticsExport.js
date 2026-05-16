import { APP_NAME } from "../../../shared/constants/app";
import { formatCurrency } from "../../../shared/lib/currency";

const safeWindow = () => (typeof window !== "undefined" ? window : null);

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeItems = (items = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    name: item.name || item.product_name || `Item ${index + 1}`,
    variant: item.variant || [item.color, item.size].filter(Boolean).join(" / ") || "Default",
    sku: item.sku || "n/a",
    color: item.color || "n/a",
    size: item.size || "n/a",
    stock: item.stock ?? item.quantity ?? 0,
    threshold: item.threshold ?? item.lowStockThreshold ?? 0,
    reason: item.reason || item.note || "n/a",
    daysIdle: item.daysIdle ?? item.days_idle ?? 0,
    value: item.value ?? item.revenue ?? item.amount ?? 0,
    confidence: item.confidence ?? 0,
  }));

const normalizeReorderItems = (items = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    product_name: item.product_name || item.name || `Item ${index + 1}`,
    color: item.color || "n/a",
    size: item.size || "n/a",
    sku: item.sku || "n/a",
    current_stock: Number(item.current_stock ?? item.stock ?? 0),
    average_daily_sales: Number(item.average_daily_sales ?? item.avg_daily_sales ?? 0),
    estimated_days_remaining: Number(item.estimated_days_remaining ?? item.days_remaining ?? 0),
    suggested_reorder_quantity: Number(item.suggested_reorder_quantity ?? item.reorder_qty ?? 0),
    risk_level: item.risk_level || item.risk || "healthy",
  }));

const normalizeDeadStockItems = (items = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    product: item.product || item.product_name || `Item ${index + 1}`,
    variant: item.variant || [item.color, item.size].filter(Boolean).join(" / ") || "Default",
    sku: item.sku || "n/a",
    stock_quantity: Number(item.stock_quantity ?? item.stock_qty ?? item.stock ?? 0),
    last_sold_date: item.last_sold_date || item.lastSoldDate || null,
    days_without_sales: Number(item.days_without_sales ?? item.daysWithoutSales ?? 0),
    estimated_blocked_capital: Number(item.estimated_blocked_capital ?? item.blocked_capital ?? 0),
    risk_score: Number(item.risk_score ?? 0),
    recommendation: item.recommendation || "healthy",
  }));

const normalizeCustomerIntelligence = (items = []) =>
  (Array.isArray(items) ? items : []).map((item, index) => ({
    customer_name: item.customer_name || item.name || `Customer ${index + 1}`,
    phone: item.phone || "",
    email: item.email || "",
    total_orders: Number(item.total_orders ?? 0),
    total_spent: Number(item.total_spent ?? 0),
    average_order_value: Number(item.average_order_value ?? 0),
    last_order_date: item.last_order_date || null,
    days_since_last_order: Number(item.days_since_last_order ?? 0),
    favorite_products: item.favorite_products || "",
    favorite_categories: item.favorite_categories || "",
    customer_segment: item.customer_segment || "New",
    recommendation: item.recommendation || "normal",
  }));

const buildFilterLines = (filters = {}) => {
  const lines = [];
  if (filters.datePresetLabel || filters.datePreset) lines.push(["Date range", filters.datePresetLabel || filters.datePreset]);
  if (filters.startDate || filters.endDate) lines.push(["Start date", filters.startDate || "n/a"], ["End date", filters.endDate || "n/a"]);
  if (filters.branchLabel || filters.branchId) lines.push(["Branch", filters.branchLabel || filters.branchId]);
  if (filters.warehouseLabel || filters.warehouseId) lines.push(["Warehouse", filters.warehouseLabel || filters.warehouseId]);
  return lines;
};

const buildCsvRows = (report = {}) => {
  const rows = [];
  rows.push(["Section", "Field", "Value"]);

  buildFilterLines(report.filters).forEach(([label, value]) => {
    rows.push(["Filters", label, value]);
  });

  (report.kpis || []).forEach((kpi) => {
    rows.push(["KPI", kpi.label || "n/a", typeof kpi.value === "number" ? kpi.value : kpi.value ?? "n/a"]);
  });

  (report.revenueSeries || []).forEach((item) => {
    rows.push(["Revenue Trend", item.name || "n/a", JSON.stringify(item)]);
  });

  (report.salesTrendSeries || []).forEach((item) => {
    rows.push(["Sales Trend", item.name || "n/a", JSON.stringify(item)]);
  });

  normalizeItems(report.deadStockItems).forEach((item) => {
    rows.push(["Dead Stock", item.name, `${item.color} / ${item.size}`]);
  });

  normalizeItems(report.lowStockItems).forEach((item) => {
    rows.push(["Low Stock", item.name, `${item.stock}/${item.threshold}`]);
  });

  normalizeReorderItems(report.reorderSuggestions).forEach((item) => {
    rows.push([
      "Reorder Suggestions",
      item.product_name,
      `${item.color} / ${item.size} | stock: ${item.current_stock} | avg: ${item.average_daily_sales} | reorder: ${item.suggested_reorder_quantity} | risk: ${item.risk_level}`,
    ]);
  });

  normalizeDeadStockItems(report.deadStockAnalysis).forEach((item) => {
    rows.push([
      "Dead Stock Intelligence",
      item.product,
      `${item.variant} | stock: ${item.stock_quantity} | days: ${item.days_without_sales} | capital: ${item.estimated_blocked_capital} | risk: ${item.risk_score} | recommendation: ${item.recommendation}`,
    ]);
  });

  normalizeCustomerIntelligence(report.customerIntelligence).forEach((item) => {
    rows.push([
      "Customer Intelligence",
      item.customer_name,
      `${item.customer_segment} | spent: ${item.total_spent} | orders: ${item.total_orders} | last: ${item.last_order_date || "n/a"} | action: ${item.recommendation}`,
    ]);
  });

  (report.customerSummary ? Object.entries(report.customerSummary) : []).forEach(([key, value]) => {
    rows.push(["Customer Insights", key, value]);
  });

  (report.aiInsights || []).forEach((item, index) => {
    rows.push(["AI Alert", item.title || `Alert ${index + 1}`, item.insight || ""]);
  });

  return rows;
};

const toCsv = (rows = []) =>
  rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
        .join(",")
    )
    .join("\n");

const buildPrintableHtml = (report = {}) => {
  const filters = buildFilterLines(report.filters);
  const kpis = Array.isArray(report.kpis) ? report.kpis : [];
  const revenueSeries = Array.isArray(report.revenueSeries) ? report.revenueSeries : [];
  const salesTrendSeries = Array.isArray(report.salesTrendSeries) ? report.salesTrendSeries : [];
  const deadStockItems = normalizeItems(report.deadStockItems);
  const lowStockItems = normalizeItems(report.lowStockItems);
  const reorderSuggestions = normalizeReorderItems(report.reorderSuggestions);
  const deadStockAnalysis = normalizeDeadStockItems(report.deadStockAnalysis);
  const customerIntelligence = normalizeCustomerIntelligence(report.customerIntelligence);
  const smartAlerts = Array.isArray(report.smartAlerts) ? report.smartAlerts : [];
  const aiInsights = Array.isArray(report.aiInsights) ? report.aiInsights : [];

  const rowsMarkup = (rows = [], columns = []) => rows
    .map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(typeof column === "function" ? column(row) : row[column])}</td>`).join("")}</tr>`)
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(report.title || "Analytics Report")}</title>
        <style>
          @page { margin: 14mm; }
          body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; background: #f8fafc; }
          .page { max-width: 1080px; margin: 0 auto; background: #fff; padding: 24px; }
          .header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 1px solid #e2e8f0; padding-bottom: 18px; margin-bottom: 18px; }
          .brand { display:flex; gap: 14px; align-items: center; }
          .logo { width: 58px; height: 58px; border: 1px solid #cbd5e1; display:flex; align-items:center; justify-content:center; font-weight:700; color:#64748b; }
          .eyebrow { text-transform: uppercase; letter-spacing: .18em; font-size: 11px; color: #0f766e; font-weight: 700; }
          h1 { margin: 4px 0 6px; font-size: 28px; }
          .muted { color: #64748b; font-size: 13px; }
          .grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
          .card { border: 1px solid #e2e8f0; border-radius: 16px; padding: 14px; background: #fff; }
          .card strong { display:block; font-size: 12px; text-transform: uppercase; letter-spacing: .14em; color: #64748b; }
          .card div { font-size: 24px; font-weight: 800; margin-top: 8px; }
          .section { margin-top: 22px; }
          .section h2 { margin: 0 0 8px; font-size: 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 12px; text-align:left; }
          th { background: #f8fafc; }
          .two { display:grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
          .pill { display:inline-block; border:1px solid #cbd5e1; border-radius: 999px; padding: 4px 10px; margin-right: 6px; margin-bottom: 6px; font-size: 12px; background:#f8fafc; }
          .alert { border-left: 4px solid #0ea5e9; padding: 10px 12px; background: #f8fafc; margin-bottom: 8px; }
          .alert.high { border-left-color: #ef4444; }
          .alert.medium { border-left-color: #f59e0b; }
          .alert.low { border-left-color: #10b981; }
          .footer { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 12px; color:#64748b; }
          .small { font-size: 12px; }
          .kpi-row { display:grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
          @media print { body { background: #fff; } .page { padding: 0; } }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header">
            <div class="brand">
              <div class="logo">LOGO</div>
              <div>
                <div class="eyebrow">${escapeHtml(report.companyName || APP_NAME)}</div>
                <h1>${escapeHtml(report.title || "Analytics Report")}</h1>
                <div class="muted">${escapeHtml(report.subtitle || "Executive analytics, AI insights, and operational intelligence")}</div>
              </div>
            </div>
            <div style="text-align:right">
              <div><strong>${escapeHtml(report.generatedAtLabel || "Generated")}</strong></div>
              <div class="muted">${escapeHtml(report.generatedAt || new Date().toLocaleString())}</div>
            </div>
          </div>

          <div class="section">
            <h2>Selected filters</h2>
            <div>
              ${filters.length ? filters.map(([label, value]) => `<span class="pill"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`).join("") : '<span class="pill">No filters selected</span>'}
            </div>
          </div>

          <div class="section">
            <h2>KPI summary</h2>
            <div class="kpi-row">
              ${kpis
                .map(
                  (kpi) => `
                    <div class="card">
                      <strong>${escapeHtml(kpi.label || "KPI")}</strong>
                      <div>${escapeHtml(typeof kpi.value === "number" ? formatCurrency(kpi.value) : kpi.value ?? "n/a")}</div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </div>

          <div class="section">
            <h2>Revenue / profit trend</h2>
            <table>
              <thead><tr><th>Period</th><th>Revenue</th><th>Profit</th><th>Orders</th></tr></thead>
              <tbody>
                ${rowsMarkup(revenueSeries, ["name", (row) => formatCurrency(row.revenue), (row) => formatCurrency(row.profit), "orders"])}
              </tbody>
            </table>
          </div>

          <div class="section">
            <h2>Sales trend</h2>
            <table>
              <thead><tr><th>Period</th><th>Revenue</th><th>Orders</th></tr></thead>
              <tbody>
                ${rowsMarkup(salesTrendSeries, ["name", (row) => formatCurrency(row.revenue), "orders"])}
              </tbody>
            </table>
          </div>

          <div class="two section">
            <div>
              <h2>Inventory risks</h2>
              <table>
                <thead><tr><th>Item</th><th>Variant</th><th>Stock</th><th>Reason</th></tr></thead>
                <tbody>
                  ${rowsMarkup(deadStockItems, ["name", "variant", "stock", "reason"])}
                </tbody>
              </table>
              <table style="margin-top:10px;">
                <thead><tr><th>Low stock item</th><th>Stock</th><th>Threshold</th></tr></thead>
                <tbody>
                  ${rowsMarkup(lowStockItems, ["name", "stock", "threshold"])}
                </tbody>
              </table>

              <h2 style="margin-top:16px;">AI reorder suggestions</h2>
              <table>
                <thead><tr><th>Product</th><th>Variant</th><th>Stock</th><th>Avg daily</th><th>Days remaining</th><th>Reorder qty</th><th>Risk</th></tr></thead>
                <tbody>
                  ${rowsMarkup(reorderSuggestions, [
                    "product_name",
                    (row) => `${row.color} / ${row.size}`,
                    "current_stock",
                    (row) => row.average_daily_sales.toFixed(2),
                    (row) => row.estimated_days_remaining.toFixed(1),
                    "suggested_reorder_quantity",
                    "risk_level",
                  ])}
                </tbody>
              </table>

              <h2 style="margin-top:16px;">AI dead stock intelligence</h2>
              <table>
                <thead><tr><th>Product</th><th>Variant</th><th>Stock</th><th>Last sold</th><th>Days idle</th><th>Blocked capital</th><th>Risk</th><th>Recommendation</th></tr></thead>
                <tbody>
                  ${rowsMarkup(deadStockAnalysis, [
                    "product",
                    "variant",
                    "stock_quantity",
                    "last_sold_date",
                    "days_without_sales",
                    "estimated_blocked_capital",
                    "risk_score",
                    "recommendation",
                  ])}
                </tbody>
              </table>
            </div>
            <div>
              <h2>Customer insights</h2>
              <table>
                <tbody>
                  ${Object.entries(report.customerSummary || {})
                    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(typeof value === "number" ? formatCurrency(value) : value)}</td></tr>`)
                    .join("")}
                </tbody>
              </table>

              <h2 style="margin-top:16px;">AI customer intelligence</h2>
              <table>
                <thead><tr><th>Customer</th><th>Segment</th><th>Orders</th><th>Total spent</th><th>Last order</th><th>Action</th></tr></thead>
                <tbody>
                  ${rowsMarkup(customerIntelligence, [
                    "customer_name",
                    "customer_segment",
                    "total_orders",
                    (row) => formatCurrency(row.total_spent),
                    "last_order_date",
                    "recommendation",
                  ])}
                </tbody>
              </table>

              <h2 style="margin-top:16px;">AI alerts</h2>
              ${(aiInsights.length ? aiInsights : smartAlerts).map((item) => `
                <div class="alert ${escapeHtml(item.severity || item.tone || "low")}">
                  <strong>${escapeHtml(item.title || item.label || "Alert")}</strong>
                  <div class="small">${escapeHtml(item.insight || item.message || "")}</div>
                </div>
              `).join("")}
            </div>
          </div>

          <div class="footer">
            ${escapeHtml(report.companyName || APP_NAME)} report generated for analytics export and print preview.
          </div>
        </div>
      </body>
    </html>
  `;
};

const openHtmlWindow = (html, title = "Analytics Report") => {
  const win = safeWindow();
  if (!win) return false;
  const popup = win.open("", "_blank", "width=1200,height=1400,noopener,noreferrer");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.document.title = title;
  popup.focus();
  popup.print();
  return true;
};

export const buildAnalyticsExportReport = ({ analytics = {}, filters = {}, meta = {} } = {}) => ({
  companyName: meta.companyName || APP_NAME,
  title: meta.title || "AI Analytics Report",
  subtitle: meta.subtitle || "Operational intelligence, forecasting, and risk analysis",
  generatedAt: new Date().toLocaleString(),
  generatedAtLabel: "Generated",
  filters,
  kpis: Array.isArray(analytics.kpis) ? analytics.kpis : [],
  revenueSeries: Array.isArray(analytics.revenueSeries) ? analytics.revenueSeries : [],
  salesTrendSeries: Array.isArray(analytics.salesTrendSeries) ? analytics.salesTrendSeries : [],
  deadStockItems: normalizeItems(analytics.deadStockItems),
  lowStockItems: normalizeItems(analytics.lowStockItems),
  reorderSuggestions: normalizeReorderItems(analytics.reorderSuggestions),
  deadStockAnalysis: normalizeDeadStockItems(analytics.deadStockAnalysis),
  customerIntelligence: normalizeCustomerIntelligence(analytics.customerIntelligence),
  customerSummary: analytics.customerSummary || {},
  aiInsights: Array.isArray(analytics.aiInsights) ? analytics.aiInsights : [],
  smartAlerts: Array.isArray(analytics.smartAlerts) ? analytics.smartAlerts : [],
});

export const downloadAnalyticsCsv = ({ analytics = {}, filters = {}, meta = {} } = {}) => {
  const report = buildAnalyticsExportReport({ analytics, filters, meta });
  const rows = buildCsvRows(report);
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${String(meta.fileName || "analytics-report").replace(/\s+/g, "-").toLowerCase()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const printAnalyticsReport = ({ analytics = {}, filters = {}, meta = {} } = {}) => {
  const report = buildAnalyticsExportReport({ analytics, filters, meta });
  return openHtmlWindow(buildPrintableHtml(report), report.title);
};

export const downloadAnalyticsPdf = async ({ analytics = {}, filters = {}, meta = {} } = {}) => {
  const report = buildAnalyticsExportReport({ analytics, filters, meta });

  try {
    const [jspdfModule, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    if (!JsPDF || !autoTable) throw new Error("PDF library unavailable");

    const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 12;
    let y = 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(report.companyName || APP_NAME, margin, y);
    doc.setFontSize(14);
    doc.text(report.title, margin, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(report.subtitle, margin, y + 14);
    doc.text(`Generated: ${report.generatedAt}`, pageWidth - margin, y, { align: "right" });

    y = 32;

    const filterText = buildFilterLines(report.filters).map(([label, value]) => `${label}: ${value}`).join("  |  ");
    doc.setFontSize(9);
    doc.setTextColor(75, 85, 99);
    doc.text(filterText || "No filters selected", margin, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [["KPI", "Value", "Trend"]],
      body: report.kpis.map((kpi) => [kpi.label, typeof kpi.value === "number" ? formatCurrency(kpi.value) : String(kpi.value ?? "n/a"), kpi.trend || "n/a"]),
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [15, 23, 42] },
      margin: { left: margin, right: margin },
    });

    y = doc.lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: y,
      head: [["Period", "Revenue", "Profit", "Orders"]],
      body: report.revenueSeries.map((item) => [item.name, formatCurrency(item.revenue), formatCurrency(item.profit), String(item.orders ?? 0)]),
      theme: "grid",
      styles: { fontSize: 7.4, cellPadding: 1.4 },
      headStyles: { fillColor: [34, 211, 238] },
      margin: { left: margin, right: margin },
    });

    y = doc.lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: y,
      head: [["Period", "Revenue", "Orders"]],
      body: report.salesTrendSeries.map((item) => [item.name, formatCurrency(item.revenue), String(item.orders ?? 0)]),
      theme: "grid",
      styles: { fontSize: 7.4, cellPadding: 1.4 },
      headStyles: { fillColor: [167, 139, 250] },
      margin: { left: margin, right: margin },
    });

    y = doc.lastAutoTable.finalY + 8;

    autoTable(doc, {
      startY: y,
      head: [["Item", "Variant", "SKU", "Stock", "Reason"]],
      body: report.deadStockItems.map((item) => [item.name, item.variant, item.sku, String(item.stock ?? 0), item.reason]),
      theme: "grid",
      styles: { fontSize: 7.4, cellPadding: 1.4 },
      headStyles: { fillColor: [245, 158, 11] },
      margin: { left: margin, right: margin },
    });

    const secondPageTop = doc.lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: secondPageTop,
      head: [["Low stock item", "Stock", "Threshold"]],
      body: report.lowStockItems.map((item) => [item.name, String(item.stock ?? 0), String(item.threshold ?? 0)]),
      theme: "grid",
      styles: { fontSize: 7.4, cellPadding: 1.4 },
      headStyles: { fillColor: [14, 165, 233] },
      margin: { left: margin, right: margin },
    });

    const reorderTableStart = doc.lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: reorderTableStart,
      head: [["Product", "Variant", "Current stock", "Avg daily sales", "Days remaining", "Reorder qty", "Risk"]],
      body: report.reorderSuggestions.map((item) => [
        item.product_name,
        `${item.color} / ${item.size}`,
        String(item.current_stock ?? 0),
        String(item.average_daily_sales ?? 0),
        String(item.estimated_days_remaining ?? 0),
        String(item.suggested_reorder_quantity ?? 0),
        item.risk_level,
      ]),
      theme: "grid",
      styles: { fontSize: 6.8, cellPadding: 1.2 },
      headStyles: { fillColor: [59, 130, 246] },
      margin: { left: margin, right: margin },
    });

    const customerIntelStart = doc.lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: customerIntelStart,
      head: [["Customer", "Segment", "Orders", "Total spent", "Last order", "Action"]],
      body: report.customerIntelligence.map((item) => [
        item.customer_name,
        item.customer_segment,
        String(item.total_orders ?? 0),
        formatCurrency(item.total_spent),
        item.last_order_date || "n/a",
        item.recommendation,
      ]),
      theme: "grid",
      styles: { fontSize: 6.8, cellPadding: 1.2 },
      headStyles: { fillColor: [14, 165, 233] },
      margin: { left: margin, right: margin },
    });

    const customerTableStart = doc.lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: customerTableStart,
      head: [["Metric", "Value"]],
      body: Object.entries(report.customerSummary).map(([key, value]) => [key, typeof value === "number" ? formatCurrency(value) : String(value)]),
      theme: "grid",
      styles: { fontSize: 7.4, cellPadding: 1.4 },
      headStyles: { fillColor: [16, 185, 129] },
      margin: { left: margin, right: margin },
    });

    const alertStartY = doc.lastAutoTable.finalY + 8;
    autoTable(doc, {
      startY: alertStartY,
      head: [["AI Alert", "Details"]],
      body: report.aiInsights.map((item) => [item.title || "Alert", item.insight || item.message || ""]),
      theme: "grid",
      styles: { fontSize: 7.2, cellPadding: 1.4 },
      headStyles: { fillColor: [99, 102, 241] },
      margin: { left: margin, right: margin },
    });

    doc.save(`${String(meta.fileName || "analytics-report").replace(/\s+/g, "-").toLowerCase()}.pdf`);
  } catch {
    const opened = openHtmlWindow(buildPrintableHtml(report), report.title);
    if (!opened) {
      throw new Error("Print preview blocked");
    }
  }
};

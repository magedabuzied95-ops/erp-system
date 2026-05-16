import { formatCurrency } from "../../../shared/lib/currency";

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const openPrintableWindow = (title, html) => {
  const popup = window.open("", "_blank", "width=1200,height=1400");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
  popup.close();
  return true;
};

const buildRows = (payload = {}) => ({
  summary: payload.summary || {},
  salesPerformance: payload.salesPerformance || [],
  commissions: payload.commissions || [],
  topPerformers: payload.topPerformers || [],
  shiftPerformance: payload.shiftPerformance || [],
  branchPerformance: payload.branchPerformance || [],
  rules: payload.rules || [],
});

export const downloadEmployeeCsv = (payload = {}) => {
  const rows = buildRows(payload);
  const csvLines = [
    ["Employee Analytics Report"].map(csvEscape).join(","),
    [],
    ["Metric", "Value"].map(csvEscape).join(","),
    ["Total Sales", formatCurrency(rows.summary.totalSales)].map(csvEscape).join(","),
    ["Total Orders", rows.summary.totalOrders ?? 0].map(csvEscape).join(","),
    ["Total Commission", formatCurrency(rows.summary.totalCommission)].map(csvEscape).join(","),
    ["Best Cashier", rows.summary.bestCashier || "n/a"].map(csvEscape).join(","),
    [],
    ["Sales Performance"].map(csvEscape).join(","),
    ["Employee", "Sales", "Orders", "Average Order", "Commission", "Refunds"].map(csvEscape).join(","),
    ...rows.salesPerformance.map((row) =>
      [
        row.employee_name,
        formatCurrency(row.total_sales),
        row.total_orders || 0,
        formatCurrency(row.average_order_value),
        formatCurrency(row.commission_earned),
        formatCurrency(row.refunds_impact),
      ]
        .map(csvEscape)
        .join(",")
    ),
    [],
    ["Commissions"].map(csvEscape).join(","),
    ["Employee", "Invoice", "Sale", "Commission", "Status"].map(csvEscape).join(","),
    ...rows.commissions.map((row) =>
      [
        row.employee_name,
        row.invoice_number,
        formatCurrency(row.sale_amount),
        formatCurrency(row.commission_amount),
        row.status || "n/a",
      ]
        .map(csvEscape)
        .join(",")
    ),
    [],
    ["Top Performers"].map(csvEscape).join(","),
    ["Employee", "Sales", "Orders", "Average Order"].map(csvEscape).join(","),
    ...rows.topPerformers.map((row) =>
      [row.employee_name, formatCurrency(row.total_sales), row.total_orders || 0, formatCurrency(row.average_order_value)]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "employee-analytics.csv";
  a.click();
  URL.revokeObjectURL(url);
};

export const downloadEmployeePdf = async (payload = {}) => {
  const rows = buildRows(payload);

  try {
    const [jspdfModule, autoTableModule] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
    const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
    if (!JsPDF || !autoTable) throw new Error("PDF library unavailable");

    const doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(18);
    doc.text("Employee Analytics Report", 40, 40);
    doc.setFontSize(10);
    doc.text(`Best cashier: ${rows.summary.bestCashier || "n/a"}`, 40, 60);
    doc.text(`Total sales: ${formatCurrency(rows.summary.totalSales)}`, 40, 76);
    doc.text(`Total orders: ${rows.summary.totalOrders || 0}`, 40, 92);
    doc.text(`Total commission: ${formatCurrency(rows.summary.totalCommission)}`, 40, 108);

    autoTable(doc, {
      startY: 130,
      head: [["Employee", "Sales", "Orders", "Average Order", "Commission", "Refunds"]],
      body: rows.salesPerformance.map((row) => [
        row.employee_name,
        formatCurrency(row.total_sales),
        row.total_orders || 0,
        formatCurrency(row.average_order_value),
        formatCurrency(row.commission_earned),
        formatCurrency(row.refunds_impact),
      ]),
    });

    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 20,
      head: [["Employee", "Invoice", "Sale", "Commission", "Status"]],
      body: rows.commissions.map((row) => [
        row.employee_name,
        row.invoice_number,
        formatCurrency(row.sale_amount),
        formatCurrency(row.commission_amount),
        row.status || "n/a",
      ]),
    });

    doc.save("employee-analytics.pdf");
    return { ok: true };
  } catch {
    const html = `
      <html>
        <head>
          <title>Employee Analytics Report</title>
          <style>
            body{font-family:Arial,sans-serif;background:#111827;color:#e5e7eb;padding:24px}
            table{width:100%;border-collapse:collapse;margin:16px 0}
            th,td{border:1px solid #374151;padding:8px;text-align:left}
            th{background:#1f2937}
          </style>
        </head>
        <body>
          <h1>Employee Analytics Report</h1>
          <p>Total sales: ${formatCurrency(rows.summary.totalSales)}</p>
          <p>Total orders: ${rows.summary.totalOrders || 0}</p>
          <p>Total commission: ${formatCurrency(rows.summary.totalCommission)}</p>
          <h2>Sales performance</h2>
          <table>
            <thead><tr><th>Employee</th><th>Sales</th><th>Orders</th><th>Average Order</th><th>Commission</th></tr></thead>
            <tbody>
              ${rows.salesPerformance
                .map((row) => `<tr><td>${row.employee_name}</td><td>${formatCurrency(row.total_sales)}</td><td>${row.total_orders || 0}</td><td>${formatCurrency(row.average_order_value)}</td><td>${formatCurrency(row.commission_earned)}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </body>
      </html>
    `;
    openPrintableWindow("Employee Analytics Report", html);
    return { ok: false, fallbackOpened: true };
  }
};

export const printEmployeeReport = (payload = {}) => {
  const rows = buildRows(payload);
  const html = `
    <html>
      <head>
        <title>Employee Analytics Report</title>
        <style>
          body{font-family:Arial,sans-serif;background:#111827;color:#e5e7eb;padding:24px}
          .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
          .card{background:#1f2937;border:1px solid #374151;padding:12px;border-radius:12px}
          table{width:100%;border-collapse:collapse;margin:16px 0}
          th,td{border:1px solid #374151;padding:8px;text-align:left}
          th{background:#1f2937}
        </style>
      </head>
      <body>
        <h1>Employee Analytics Report</h1>
        <div class="meta">
          <div class="card">Best cashier<br><strong>${rows.summary.bestCashier || "n/a"}</strong></div>
          <div class="card">Total sales<br><strong>${formatCurrency(rows.summary.totalSales)}</strong></div>
          <div class="card">Total orders<br><strong>${rows.summary.totalOrders || 0}</strong></div>
          <div class="card">Commission<br><strong>${formatCurrency(rows.summary.totalCommission)}</strong></div>
        </div>
        <h2>Top performers</h2>
        <table>
          <thead><tr><th>Employee</th><th>Sales</th><th>Orders</th><th>Average Order</th></tr></thead>
          <tbody>
            ${rows.topPerformers
              .map((row) => `<tr><td>${row.employee_name}</td><td>${formatCurrency(row.total_sales)}</td><td>${row.total_orders || 0}</td><td>${formatCurrency(row.average_order_value)}</td></tr>`)
              .join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
  return openPrintableWindow("Employee Analytics Report", html);
};

export const buildEmployeeExportPayload = (payload = {}) => ({
  summary: payload.summary || {},
  salesPerformance: payload.salesPerformance || [],
  commissions: payload.commissions || [],
  topPerformers: payload.topPerformers || [],
  shiftPerformance: payload.shiftPerformance || [],
  branchPerformance: payload.branchPerformance || [],
  rules: payload.rules || [],
});

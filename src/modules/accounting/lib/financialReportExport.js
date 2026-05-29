import { APP_NAME } from "../../../shared/constants/app";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { formatCurrency } from "../../../shared/lib/currency";
import {
  documentHasArabicText,
  escapeHtml,
  formatPrintDate,
  getPrintDirection,
  normalizePrintLanguage,
  openPrintHtml,
  tPrint,
  wrapPrintableHtml,
} from "../../../shared/utils/printLocalization";

const label = (key, fallback, options) => tPrint(`print.accounting.${key}`, fallback, options);

const money = (value) => formatCurrency(Number(value || 0));

const safe = (value) => String(value ?? "").trim();

const fileSafe = (value) =>
  safe(value || "accounting-report")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

const businessName = () => {
  const tenant = getCurrentTenant() || {};
  const user = getCurrentUser() || {};
  return tenant.companyName || tenant.company_name || tenant.name || user.company_name || user.tenant_name || APP_NAME;
};

const filterLabel = (filters = {}) => {
  const items = [
    [label("filters.from", "From"), filters.from_date || label("filters.all", "All")],
    [label("filters.to", "To"), filters.to_date || label("filters.all", "All")],
    [label("filters.branch", "Branch"), filters.branch_id || label("filters.all", "All")],
    [label("filters.account", "Account"), filters.account_type || label("filters.all", "All")],
  ];
  return items.map(([name, value]) => `${name}: ${value}`).join(" | ");
};

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const rowsToCsv = (rows = []) => rows.map((row) => row.map(csvEscape).join(",")).join("\n");

const downloadBlob = async (content, filename, type) => {
  const { saveAs } = await import("file-saver");
  saveAs(new Blob([content], { type }), filename);
};

const noRows = () => label("noRows", "No rows");
const walkIn = () => label("walkInCustomer", "Walk-in customer");
const unknownProduct = () => label("unknownProduct", "Unknown product");
const uncategorized = () => label("uncategorized", "Uncategorized");

const overviewSections = (summary = {}) => [
  {
    title: label("sections.overviewSummary", "Overview summary"),
    headers: [label("headers.metric", "Metric"), label("headers.value", "Value")],
    rows: [
      [label("metrics.revenue", "Revenue"), money(summary.revenue_report?.total_revenue)],
      [label("metrics.paidOrders", "Paid orders"), Number(summary.revenue_report?.orders_count || 0)],
      [label("metrics.expenses", "Expenses"), money(summary.expense_report?.total_expenses)],
      [label("metrics.profit", "Profit"), money(summary.profit)],
      [label("metrics.inventoryValuation", "Inventory valuation"), money(summary.inventory_valuation)],
    ],
  },
  {
    title: label("sections.topCustomers", "Top customers"),
    headers: [label("headers.customerId", "Customer ID"), label("headers.name", "Name"), label("headers.orders", "Orders"), label("headers.totalRevenue", "Total revenue")],
    rows: (summary.top_customers || []).map((item) => [
      item.customer_id ?? "",
      item.name || walkIn(),
      Number(item.orders_count || 0),
      money(item.total_revenue),
    ]),
  },
  {
    title: label("sections.topProducts", "Top products"),
    headers: [label("headers.productId", "Product ID"), label("headers.name", "Name"), label("headers.unitsSold", "Units sold"), label("headers.totalRevenue", "Total revenue")],
    rows: (summary.top_products || []).map((item) => [
      item.product_id ?? "",
      item.name || unknownProduct(),
      Number(item.units_sold || 0),
      money(item.total_revenue),
    ]),
  },
];

const profitLossSections = (report = {}) => [
  {
    title: label("sections.profitLossLines", "P&L lines"),
    headers: [label("headers.line", "Line"), label("headers.amount", "Amount")],
    rows: [
      [label("metrics.grossSales", "Gross sales"), money(report.revenue?.gross_sales)],
      [label("metrics.discounts", "Discounts"), money(report.revenue?.discounts)],
      [label("metrics.returns", "Returns"), money(report.revenue?.returns)],
      [label("metrics.netSales", "Net sales"), money(report.revenue?.net_sales)],
      [label("metrics.cogs", "COGS"), money(report.cogs?.total_cogs)],
      [label("metrics.grossProfit", "Gross profit"), money(report.gross_profit)],
      [label("metrics.totalExpenses", "Total expenses"), money(report.total_expenses)],
      [label("metrics.netProfit", "Net profit"), money(report.net_profit)],
    ],
  },
  {
    title: label("sections.expensesByCategory", "Expenses by category"),
    headers: [label("headers.category", "Category"), label("headers.amount", "Amount")],
    rows: (report.expenses || []).map((item) => [item.category || uncategorized(), money(item.amount)]),
  },
];

const ledgerSections = (report = {}, language) => [
  {
    title: label("sections.ledgerTotals", "Ledger totals"),
    headers: [label("headers.metric", "Metric"), label("headers.amount", "Amount")],
    rows: [
      [label("metrics.totalDebit", "Total debit"), money(report.totals?.debit)],
      [label("metrics.totalCredit", "Total credit"), money(report.totals?.credit)],
      [label("metrics.endingBalance", "Ending balance"), money(report.totals?.ending_balance)],
    ],
  },
  {
    title: label("sections.ledgerRows", "Ledger rows"),
    headers: [
      label("headers.date", "Date"),
      label("headers.reference", "Reference"),
      label("headers.source", "Source"),
      label("headers.account", "Account"),
      label("headers.description", "Description"),
      label("headers.debit", "Debit"),
      label("headers.credit", "Credit"),
      label("headers.balance", "Balance"),
    ],
    rows: (report.rows || []).map((row) => [
      row.date ? formatPrintDate(row.date, language, { dateStyle: "medium", timeStyle: "short" }) : "",
      row.reference || "",
      row.source_type || "",
      row.account_name || "",
      row.description || "",
      money(row.debit),
      money(row.credit),
      money(row.balance),
    ]),
  },
];

const trialBalanceSections = (report = {}) => [
  {
    title: label("sections.trialBalanceTotals", "Trial Balance totals"),
    headers: [label("headers.metric", "Metric"), label("headers.amount", "Amount")],
    rows: [
      [label("metrics.totalDebit", "Total debit"), money(report.totals?.debit)],
      [label("metrics.totalCredit", "Total credit"), money(report.totals?.credit)],
      [label("metrics.difference", "Difference"), money(report.totals?.difference)],
    ],
  },
  {
    title: label("sections.trialBalanceRows", "Trial Balance rows"),
    headers: [label("headers.account", "Account"), label("headers.type", "Type"), label("headers.debit", "Debit"), label("headers.credit", "Credit"), label("headers.balance", "Balance")],
    rows: (report.rows || []).map((row) => [
      row.account_name || "",
      row.account_type || "",
      money(row.debit),
      money(row.credit),
      money(row.balance),
    ]),
  },
];

const balanceSheetSections = (report = {}) => [
  {
    title: label("sections.balanceSheetTotals", "Balance Sheet totals"),
    headers: [label("headers.metric", "Metric"), label("headers.amount", "Amount")],
    rows: [
      [label("metrics.assets", "Assets"), money(report.totals?.assets)],
      [label("metrics.liabilities", "Liabilities"), money(report.totals?.liabilities)],
      [label("metrics.equity", "Equity"), money(report.totals?.equity)],
      [label("metrics.liabilitiesAndEquity", "Liabilities and equity"), money(report.totals?.liabilities_and_equity)],
      [label("metrics.difference", "Difference"), money(report.totals?.difference)],
    ],
  },
  {
    title: label("sections.assets", "Assets"),
    headers: [label("headers.name", "Name"), label("headers.amount", "Amount")],
    rows: (report.assets || []).map((row) => [row.name || "", money(row.amount)]),
  },
  {
    title: label("sections.liabilities", "Liabilities"),
    headers: [label("headers.name", "Name"), label("headers.amount", "Amount")],
    rows: (report.liabilities || []).map((row) => [row.name || "", money(row.amount)]),
  },
  {
    title: label("sections.equity", "Equity"),
    headers: [label("headers.name", "Name"), label("headers.amount", "Amount")],
    rows: (report.equity || []).map((row) => [row.name || "", money(row.amount)]),
  },
];

const sectionsFor = ({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, language }) => {
  if (reportType === "profit-loss") return profitLossSections(profitLoss);
  if (reportType === "ledgers") return ledgerSections(ledger, language);
  if (reportType === "trial-balance") return trialBalanceSections(trialBalance);
  if (reportType === "balance-sheet") return balanceSheetSections(balanceSheet);
  return overviewSections(summary);
};

const titleFor = (reportType) => {
  if (reportType === "profit-loss") return label("titles.profitLoss", "Profit & Loss Report");
  if (reportType === "ledgers") return label("titles.ledgers", "Accounting Ledgers Report");
  if (reportType === "trial-balance") return label("titles.trialBalance", "Trial Balance Report");
  if (reportType === "balance-sheet") return label("titles.balanceSheet", "Balance Sheet Report");
  return label("titles.overview", "Financial Reports Overview");
};

export const exportAccountingCsv = async ({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, filters = {}, language }) => {
  const normalizedLanguage = normalizePrintLanguage(language);
  const title = titleFor(reportType);
  const rows = [
    [businessName()],
    [title],
    [filterLabel(filters)],
    [],
  ];
  sectionsFor({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, language: normalizedLanguage }).forEach((section) => {
    rows.push([section.title], section.headers);
    rows.push(...(section.rows.length ? section.rows : [[noRows()]]));
    rows.push([]);
  });
  await downloadBlob(rowsToCsv(rows), `${fileSafe(title)}.csv`, "text/csv;charset=utf-8;");
};

export const exportAccountingExcel = async ({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, filters = {}, language }) => {
  const normalizedLanguage = normalizePrintLanguage(language);
  const [XLSX, { saveAs }] = await Promise.all([import("xlsx"), import("file-saver")]);
  const workbook = XLSX.utils.book_new();
  const title = titleFor(reportType);
  sectionsFor({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, language: normalizedLanguage }).forEach((section) => {
    const rows = [[businessName()], [title], [filterLabel(filters)], [], section.headers, ...(section.rows.length ? section.rows : [[noRows()]])];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!rtl"] = getPrintDirection(normalizedLanguage) === "rtl";
    XLSX.utils.book_append_sheet(workbook, worksheet, section.title.slice(0, 31));
  });
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${fileSafe(title)}.xlsx`);
};

const buildReportHtml = ({ title, sections, filters, language }) => {
  const body = `
    <main class="print-sheet">
      <header class="print-header">
        <div>
          <div class="print-title">${escapeHtml(businessName())}</div>
          <div class="muted">${escapeHtml(title)}</div>
        </div>
        <div class="muted">${escapeHtml(filterLabel(filters))}</div>
      </header>
      ${sections
        .map((section) => `
          <section class="print-card">
            <h2>${escapeHtml(section.title)}</h2>
            <table>
              <thead><tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
              <tbody>
                ${(section.rows.length ? section.rows : [[noRows()]])
                  .map((row) => `<tr>${row.map((cell) => `<td class="${/[0-9]/.test(String(cell)) ? "amount" : ""}">${escapeHtml(cell)}</td>`).join("")}</tr>`)
                  .join("")}
              </tbody>
            </table>
          </section>
        `)
        .join("")}
    </main>
  `;
  return wrapPrintableHtml({ title, body, language });
};

export const exportAccountingPdf = async ({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, filters = {}, language }) => {
  const normalizedLanguage = normalizePrintLanguage(language);
  const title = titleFor(reportType);
  const sections = sectionsFor({ reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, language: normalizedLanguage });
  const dataForDirection = { reportType, summary, profitLoss, ledger, trialBalance, balanceSheet, filters, sections };

  if (getPrintDirection(normalizedLanguage) === "rtl" || documentHasArabicText(dataForDirection)) {
    openPrintHtml(buildReportHtml({ title, sections, filters, language: normalizedLanguage }), { width: 1024, height: 768 });
    return;
  }

  const [jspdfModule, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
  const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
  const doc = new JsPDF({ orientation: ["ledgers", "trial-balance"].includes(reportType) ? "landscape" : "portrait", unit: "pt" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;

  doc.setTextColor(20, 24, 32);
  doc.setFontSize(16);
  doc.text(businessName(), margin, 38);
  doc.setFontSize(12);
  doc.text(title, margin, 58);
  doc.setFontSize(9);
  doc.setTextColor(90, 96, 110);
  doc.text(filterLabel(filters), margin, 76, { maxWidth: pageWidth - margin * 2 });

  let y = 98;
  sections.forEach((section) => {
    doc.setFontSize(11);
    doc.setTextColor(20, 24, 32);
    doc.text(section.title, margin, y);
    autoTable(doc, {
      startY: y + 8,
      head: [section.headers],
      body: section.rows.length ? section.rows : [[noRows()]],
      margin: { left: margin, right: margin },
      styles: { fontSize: ["ledgers", "trial-balance"].includes(reportType) ? 7 : 8, textColor: [28, 32, 40], cellPadding: 5, overflow: "linebreak" },
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      tableLineColor: [226, 232, 240],
      tableLineWidth: 0.5,
    });
    y = (doc.lastAutoTable?.finalY || y + 44) + 22;
    if (y > doc.internal.pageSize.getHeight() - 70) {
      doc.addPage();
      y = 44;
    }
  });

  doc.save(`${fileSafe(title)}.pdf`);
};

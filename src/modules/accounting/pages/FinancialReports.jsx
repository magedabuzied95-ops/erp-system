import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Building2,
  CalendarRange,
  CreditCard,
  Download,
  HandCoins,
  Landmark,
  LoaderCircle,
  PackageSearch,
  Printer,
  ReceiptText,
  RefreshCw,
  TrendingUp,
  Wallet,
} from "lucide-react";

import AccountingShell from "../components/AccountingShell";
import FinanceMetricCard from "../components/FinanceMetricCard";
import { accountingApi } from "../services/accountingApi";
import { api } from "../../../shared/api/api";
import { formatCurrency, formatNumber } from "../../../shared/lib/currency";

const REPORT_TABS = [
  { key: "dashboard", icon: TrendingUp },
  { key: "income", icon: ReceiptText },
  { key: "cash", icon: Landmark },
  { key: "receivables", icon: HandCoins },
  { key: "payables", icon: CreditCard },
  { key: "inventory", icon: Boxes },
  { key: "specials", icon: Wallet },
];

const defaultFilters = {
  from_date: "",
  to_date: "",
  branch_id: "",
};

const txtForTab = (key, isArabic) => {
  const copy = {
    dashboard: [isArabic ? "الملخص المالي" : "Financial Dashboard", isArabic ? "نظرة مركزة على الأداء المالي والسيولة والمخزون." : "Focused view of profitability, liquidity, and inventory."],
    income: [isArabic ? "قائمة الدخل" : "Income Statement", isArabic ? "إيرادات ومردودات ومصاريف وصافي الربح للفترة المحددة." : "Revenue, returns, expenses, and profit for the selected period."],
    cash: [isArabic ? "الحسابات النقدية والبنكية" : "Cash & Bank Accounts", isArabic ? "حركة الحسابات المالية مع الرصيد الافتتاحي والختامي." : "Account movement with opening and closing balances."],
    receivables: [isArabic ? "مديونيات العملاء" : "Receivables", isArabic ? "البيع الآجل والتحصيل والعملاء الأعلى مديونية." : "Credit sales, collections, and top debtors."],
    payables: [isArabic ? "مستحقات الموردين" : "Payables", isArabic ? "المشتريات غير المسددة أو الجزئية وأعلى الموردين." : "Outstanding purchases and top suppliers."],
    inventory: [isArabic ? "قيمة المخزون و COGS" : "Inventory Value & COGS", isArabic ? "تقييم المخزون وتكلفة البضاعة المباعة وفق البيانات الحالية." : "Inventory valuation and available COGS estimate."],
    specials: [isArabic ? "الحركات الخاصة" : "Special Transactions", isArabic ? "خصومات ومرتجعات وسلف واستخدام مالك وحركات خاصة." : "Discounts, refunds, advances, owner use, and special items."],
  };
  return copy[key];
};

function FinancialReports() {
  const { i18n, t } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [filters, setFilters] = useState(() => ({ ...defaultFilters }));
  const [activeTab, setActiveTab] = useState("dashboard");
  const [branches, setBranches] = useState([]);
  const [reportData, setReportData] = useState({});
  const [reportErrors, setReportErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const shellTitle = isArabic ? "التقارير المحاسبية" : "Accounting Reports";
  const shellSubtitle = isArabic
    ? "لوحة تقارير محاسبية مركزة للمدير تشمل الربحية والسيولة والمخزون والمستحقات."
    : "Executive accounting reporting across profit, cash, inventory, receivables, and payables.";

  const requestParams = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value !== "" && value !== null && value !== undefined)
      ),
    [filters]
  );

  const loadReports = async () => {
    try {
      setLoading(true);
      setError("");
      setReportErrors({});

      const results = await Promise.allSettled([
        api.get("/branches", { suppressErrorStatuses: [403] }),
        accountingApi.getReportsV2Dashboard(requestParams),
        accountingApi.getReportsV2IncomeStatement(requestParams),
        accountingApi.getReportsV2CashAccounts(requestParams),
        accountingApi.getReportsV2Receivables(requestParams),
        accountingApi.getReportsV2Payables(requestParams),
        accountingApi.getReportsV2Inventory(requestParams),
        accountingApi.getReportsV2SpecialTransactions(requestParams),
      ]);

      const [branchesResult, dashboardResult, incomeResult, cashResult, receivablesResult, payablesResult, inventoryResult, specialsResult] = results;
      const nextErrors = {};
      const readResult = (result, key) => {
        if (result.status === "fulfilled") return result.value;
        const message = result.reason?.message || (isArabic ? "فشل تحميل هذا التقرير" : "Failed to load this report");
        nextErrors[key] = message;
        console.error(`[accounting-reports-v2] ${key} failed:`, result.reason);
        return null;
      };

      const branchesResponse = branchesResult.status === "fulfilled" ? branchesResult.value : null;
      const branchRows = Array.isArray(branchesResponse?.rows)
        ? branchesResponse.rows
        : Array.isArray(branchesResponse?.data)
          ? branchesResponse.data
          : Array.isArray(branchesResponse?.branches)
            ? branchesResponse.branches
            : [];

      const nextReportData = {
        dashboard: readResult(dashboardResult, "dashboard"),
        income: readResult(incomeResult, "income"),
        cash: readResult(cashResult, "cash"),
        receivables: readResult(receivablesResult, "receivables"),
        payables: readResult(payablesResult, "payables"),
        inventory: readResult(inventoryResult, "inventory"),
        specials: readResult(specialsResult, "specials"),
      };

      setBranches(branchRows);
      setReportErrors(nextErrors);
      setReportData(nextReportData);
    } catch (loadError) {
      console.error("[accounting-reports-v2] failed:", loadError);
      setError(loadError?.message || (isArabic ? "تعذر تحميل التقارير" : "Failed to load reports"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
  }, [requestParams]);

  const [activeTitle, activeDescription] = txtForTab(activeTab, isArabic);
  const activeTabError = reportErrors[activeTab] || "";

  return (
    <div dir={isArabic ? "rtl" : "ltr"}>
      <AccountingShell
        title={shellTitle}
        subtitle={shellSubtitle}
        actions={
          <>
            <div className="flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--muted)]">
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
              {isArabic ? "تحديث مباشر حسب الفلاتر" : "Live from current filters"}
            </div>
            <button
              type="button"
              onClick={loadReports}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--card)] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {isArabic ? "تحديث" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => exportCurrentReportCsv({ title: activeTitle, data: reportData[activeTab], isArabic })}
              disabled={loading || !reportData[activeTab]}
              className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--card)] disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {isArabic ? "تصدير CSV" : "Export CSV"}
            </button>
            <button
              type="button"
              onClick={() => printCurrentReport({ title: activeTitle, data: reportData[activeTab], filters, isArabic })}
              disabled={loading || !reportData[activeTab]}
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-4 py-2 text-sm font-black text-white transition hover:brightness-110 disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              {isArabic ? "طباعة احترافية" : "Professional print"}
            </button>
          </>
        }
        tabs={[
          { to: "/accounting", label: t("accounting.tabs.dashboard"), end: true },
          { to: "/accounting/treasury", label: "الخزينة" },
          { to: "/accounting/journal-entries", label: t("accounting.tabs.journal") },
          { to: "/accounting/accounts", label: t("accounting.tabs.accounts") },
          { to: "/accounting/financial-accounts", label: t("accounting.tabs.financialAccounts") },
          { to: "/accounting/payment-method-mappings", label: t("accounting.tabs.paymentMappings") },
          { to: "/accounting/reports", label: t("accounting.tabs.reports") },
          { to: "/accounting/profit-loss", label: t("accounting.tabs.profitLoss") },
          { to: "/accounting/taxes", label: t("accounting.tabs.taxes") },
          { to: "/accounting/cost-fix", label: t("accounting.tabs.costFix") },
          { to: "/accounting/audit-trail", label: t("accounting.tabs.auditTrail") },
        ]}
      >
        <section className="theme-card rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl shadow-[var(--shadow)]">
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-[1fr_1fr_1fr_auto]">
            <FilterField
              label={isArabic ? "من تاريخ" : "From date"}
              type="date"
              value={filters.from_date}
              onChange={(value) => setFilters((current) => ({ ...current, from_date: value }))}
            />
            <FilterField
              label={isArabic ? "إلى تاريخ" : "To date"}
              type="date"
              value={filters.to_date}
              onChange={(value) => setFilters((current) => ({ ...current, to_date: value }))}
            />
            <FilterSelect
              label={isArabic ? "الفرع" : "Branch"}
              value={filters.branch_id}
              onChange={(value) => setFilters((current) => ({ ...current, branch_id: value }))}
              options={[
                { value: "", label: isArabic ? "كل الفروع" : "All branches" },
                ...branches.map((branch) => ({
                  value: String(branch.id),
                  label: branch.name || `${isArabic ? "فرع" : "Branch"} #${branch.id}`,
                })),
              ]}
            />
            <button
              type="button"
              onClick={() => setFilters({ ...defaultFilters })}
              className="h-11 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--surface)]"
            >
              {isArabic ? "إعادة ضبط" : "Reset"}
            </button>
          </div>
        </section>

        <section className="grid gap-2 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl shadow-[var(--shadow)] md:grid-cols-2 xl:grid-cols-7">
          {REPORT_TABS.map((tab) => {
            const Icon = tab.icon;
            const [title] = txtForTab(tab.key, isArabic);
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={[
                  "flex items-center gap-3 rounded-2xl px-4 py-3 text-start transition",
                  isActive
                    ? "bg-[var(--primary)] text-white shadow-lg"
                    : "text-[var(--muted)] hover:bg-[var(--card)] hover:text-[var(--text)]",
                ].join(" ")}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-sm font-semibold">{title}</span>
              </button>
            );
          })}
        </section>

        <section className="theme-card rounded-3xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl shadow-[var(--shadow)]">
          <div className="flex flex-col gap-2 border-b border-[var(--border)] pb-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--primary)]/70">
              {isArabic ? "التبويب الحالي" : "Current report"}
            </div>
            <h2 className="text-2xl font-black text-[var(--text)]">{activeTitle}</h2>
            <p className="text-sm text-[var(--muted)]">{activeDescription}</p>
          </div>

          {error ? (
            <StateBox
              icon={AlertCircle}
              title={isArabic ? "تعذر تحميل التقرير" : "Report load failed"}
              message={error}
              actionLabel={isArabic ? "إعادة المحاولة" : "Retry"}
              onAction={loadReports}
              tone="error"
            />
          ) : null}

          {!error && activeTabError ? (
            <StateBox
              icon={AlertCircle}
              title={isArabic ? "تعذر تحميل هذا التبويب" : "This tab failed to load"}
              message={activeTabError}
              actionLabel={isArabic ? "إعادة المحاولة" : "Retry"}
              onAction={loadReports}
              tone="error"
            />
          ) : null}

          {!error && !activeTabError ? (
            <div className="mt-5">
              {activeTab === "dashboard" ? <DashboardTab data={reportData.dashboard} loading={loading} isArabic={isArabic} /> : null}
              {activeTab === "income" ? <IncomeTab data={reportData.income} loading={loading} isArabic={isArabic} /> : null}
              {activeTab === "cash" ? <CashTab data={reportData.cash} loading={loading} isArabic={isArabic} /> : null}
              {activeTab === "receivables" ? <ReceivablesTab data={reportData.receivables} loading={loading} isArabic={isArabic} /> : null}
              {activeTab === "payables" ? <PayablesTab data={reportData.payables} loading={loading} isArabic={isArabic} /> : null}
              {activeTab === "inventory" ? <InventoryTab data={reportData.inventory} loading={loading} isArabic={isArabic} /> : null}
              {activeTab === "specials" ? <SpecialsTab data={reportData.specials} loading={loading} isArabic={isArabic} /> : null}
            </div>
          ) : null}
        </section>
      </AccountingShell>
    </div>
  );
}

function DashboardTab({ data, loading, isArabic }) {
  const cards = data?.cards || {};
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  const highlights = data?.highlights || {};

  if (loading) return <LoadingBlock rows={2} />;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <FinanceMetricCard label={isArabic ? "صافي الإيراد" : "Net Revenue"} value={formatCurrency(cards.net_revenue, isArabic ? "ar" : "en")} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "صافي الربح" : "Net Profit"} value={formatCurrency(cards.net_profit, isArabic ? "ar" : "en")} tone="cyan" icon={<ArrowUpRight className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "مديونيات العملاء" : "Receivables Due"} value={formatCurrency(cards.receivables_due, isArabic ? "ar" : "en")} tone="amber" icon={<HandCoins className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "مستحقات الموردين" : "Payables Due"} value={formatCurrency(cards.payables_due, isArabic ? "ar" : "en")} tone="rose" icon={<CreditCard className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "قيمة المخزون" : "Inventory Value"} value={formatCurrency(cards.inventory_value, isArabic ? "ar" : "en")} tone="violet" icon={<Boxes className="h-5 w-5" />} />
      </div>
      <NotesList notes={notes} isArabic={isArabic} />
      <div className="grid gap-4 xl:grid-cols-3">
        <MiniTableCard
          title={isArabic ? "أعلى العملاء مديونية" : "Top customer receivables"}
          rows={highlights.top_customers}
          columns={[
            { key: "customer_name", label: isArabic ? "العميل" : "Customer" },
            { key: "outstanding_balance", label: isArabic ? "الرصيد" : "Outstanding", money: true },
          ]}
          isArabic={isArabic}
        />
        <MiniTableCard
          title={isArabic ? "أعلى الموردين مستحقات" : "Top supplier payables"}
          rows={highlights.top_suppliers}
          columns={[
            { key: "supplier_name", label: isArabic ? "المورد" : "Supplier" },
            { key: "outstanding_balance", label: isArabic ? "الرصيد" : "Outstanding", money: true },
          ]}
          isArabic={isArabic}
        />
        <MiniTableCard
          title={isArabic ? "أعلى عناصر المخزون قيمة" : "Top inventory lines"}
          rows={highlights.top_inventory}
          columns={[
            { key: "item_name", label: isArabic ? "الصنف" : "Item" },
            { key: "inventory_value", label: isArabic ? "القيمة" : "Value", money: true },
          ]}
          isArabic={isArabic}
        />
      </div>
    </div>
  );
}

function IncomeTab({ data, loading, isArabic }) {
  if (loading) return <LoadingBlock rows={2} />;
  const summary = data?.summary || {};
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={isArabic ? "الإيراد" : "Revenue"} value={formatCurrency(summary.revenue, isArabic ? "ar" : "en")} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "صافي الإيراد" : "Net Revenue"} value={formatCurrency(summary.net_revenue, isArabic ? "ar" : "en")} tone="cyan" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label="COGS" value={formatCurrency(summary.cogs, isArabic ? "ar" : "en")} hint={summary.cogs_estimated ? (isArabic ? "تقديري" : "Estimated") : ""} tone="amber" icon={<PackageSearch className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "صافي الربح" : "Net Profit"} value={formatCurrency(summary.net_profit, isArabic ? "ar" : "en")} tone="violet" icon={<ArrowUpRight className="h-5 w-5" />} />
      </div>
      <NotesList notes={summary.cogs_note ? [summary.cogs_note] : []} isArabic={isArabic} />
      <DataTable
        title={isArabic ? "تفصيل قائمة الدخل" : "Income statement detail"}
        rows={data?.lines}
        columns={[
          { key: "label", label: isArabic ? "البند" : "Line" },
          { key: "amount", label: isArabic ? "القيمة" : "Amount", money: true },
          { key: "estimated", label: isArabic ? "ملاحظة" : "Note", render: (row) => (row.estimated ? (isArabic ? "تقديري" : "Estimated") : "") },
        ]}
        isArabic={isArabic}
      />
      <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
        {isArabic
          ? "COGS معروض كتقدير مبني على إشارات التكلفة الحالية، وليس تكلفة تاريخية مؤكدة لكل عملية بيع."
          : "COGS is shown as an estimate from currently available cost signals, not a guaranteed historical per-sale cost."}
      </div>
      <DataTable
        title={isArabic ? "تفصيل المصروفات" : "Expense breakdown"}
        rows={data?.expense_breakdown}
        columns={[
          { key: "category", label: isArabic ? "الفئة" : "Category" },
          { key: "amount", label: isArabic ? "القيمة" : "Amount", money: true },
        ]}
        isArabic={isArabic}
      />
    </div>
  );
}

function CashTab({ data, loading, isArabic }) {
  if (loading) return <LoadingBlock rows={2} />;
  const summary = data?.summary || {};
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <FinanceMetricCard label={isArabic ? "رصيد افتتاحي" : "Opening Balance"} value={formatCurrency(summary.opening_balance, isArabic ? "ar" : "en")} tone="zinc" icon={<Landmark className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "وارد" : "Incoming"} value={formatCurrency(summary.incoming, isArabic ? "ar" : "en")} tone="emerald" icon={<ArrowUpRight className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "صادر" : "Outgoing"} value={formatCurrency(summary.outgoing, isArabic ? "ar" : "en")} tone="rose" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "رصيد ختامي" : "Closing Balance"} value={formatCurrency(summary.closing_balance, isArabic ? "ar" : "en")} tone="cyan" icon={<Wallet className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "عدد الحسابات" : "Accounts"} value={formatNumber(summary.accounts_count, isArabic ? "ar" : "en")} tone="violet" icon={<Building2 className="h-5 w-5" />} />
      </div>
      <DataTable
        title={isArabic ? "أرصدة الحسابات" : "Account balances"}
        rows={data?.rows}
        columns={[
          { key: "name", label: isArabic ? "الحساب" : "Account" },
          { key: "account_type", label: isArabic ? "النوع" : "Type" },
          { key: "opening_balance", label: isArabic ? "افتتاحي" : "Opening", money: true },
          { key: "incoming", label: isArabic ? "وارد" : "Incoming", money: true },
          { key: "outgoing", label: isArabic ? "صادر" : "Outgoing", money: true },
          { key: "closing_balance", label: isArabic ? "ختامي" : "Closing", money: true },
        ]}
        isArabic={isArabic}
      />
      <DataTable
        title={isArabic ? "حركة الحسابات" : "Account movement"}
        rows={data?.transactions}
        columns={[
          { key: "created_at", label: isArabic ? "التاريخ" : "Date", type: "date" },
          { key: "account_name", label: isArabic ? "الحساب" : "Account" },
          { key: "direction", label: isArabic ? "الاتجاه" : "Direction" },
          { key: "transaction_type", label: isArabic ? "النوع" : "Type" },
          { key: "amount", label: isArabic ? "القيمة" : "Amount", money: true },
          { key: "notes", label: isArabic ? "ملاحظات" : "Notes" },
        ]}
        isArabic={isArabic}
      />
    </div>
  );
}

function ReceivablesTab({ data, loading, isArabic }) {
  if (loading) return <LoadingBlock rows={2} />;
  const summary = data?.summary || {};
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={isArabic ? "إجمالي البيع الآجل" : "Credit Sales"} value={formatCurrency(summary.total_credit_sales, isArabic ? "ar" : "en")} tone="amber" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "المحصل من العملاء" : "Collected"} value={formatCurrency(summary.collected_amount, isArabic ? "ar" : "en")} tone="emerald" icon={<HandCoins className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "الرصيد المستحق" : "Outstanding"} value={formatCurrency(summary.outstanding_balance, isArabic ? "ar" : "en")} tone="rose" icon={<CreditCard className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "عدد العملاء" : "Customers"} value={formatNumber(summary.customers_count, isArabic ? "ar" : "en")} tone="cyan" icon={<Building2 className="h-5 w-5" />} />
      </div>
      <DataTable
        title={isArabic ? "أعلى العملاء مديونية" : "Top debtor customers"}
        rows={data?.top_customers}
        columns={[
          { key: "customer_name", label: isArabic ? "العميل" : "Customer" },
          { key: "orders_count", label: isArabic ? "عدد الفواتير" : "Orders" },
          { key: "outstanding_balance", label: isArabic ? "الرصيد المستحق" : "Outstanding", money: true },
        ]}
        isArabic={isArabic}
      />
      <DataTable
        title={isArabic ? "تفصيل مديونيات العملاء" : "Receivables detail"}
        rows={data?.rows}
        columns={[
          { key: "transaction_date", label: isArabic ? "التاريخ" : "Date", type: "date" },
          { key: "reference", label: isArabic ? "المرجع" : "Reference" },
          { key: "customer_name", label: isArabic ? "العميل" : "Customer" },
          { key: "invoice_total", label: isArabic ? "إجمالي الفاتورة" : "Invoice", money: true },
          { key: "collected_amount", label: isArabic ? "المحصل" : "Collected", money: true },
          { key: "outstanding_balance", label: isArabic ? "المستحق" : "Outstanding", money: true },
          { key: "payment_status", label: isArabic ? "حالة السداد" : "Payment Status" },
        ]}
        isArabic={isArabic}
      />
    </div>
  );
}

function PayablesTab({ data, loading, isArabic }) {
  if (loading) return <LoadingBlock rows={2} />;
  const summary = data?.summary || {};
  const branchNote = data?.meta?.branch_filter_note ? [data.meta.branch_filter_note] : [];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={isArabic ? "إجمالي المشتريات غير المسددة" : "Unpaid Purchases"} value={formatCurrency(summary.total_unpaid_purchases, isArabic ? "ar" : "en")} tone="amber" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "المدفوع للموردين" : "Paid to Suppliers"} value={formatCurrency(summary.paid_amount, isArabic ? "ar" : "en")} tone="emerald" icon={<HandCoins className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "الرصيد المستحق" : "Outstanding"} value={formatCurrency(summary.outstanding_balance, isArabic ? "ar" : "en")} tone="rose" icon={<CreditCard className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "عدد الموردين" : "Suppliers"} value={formatNumber(summary.suppliers_count, isArabic ? "ar" : "en")} tone="cyan" icon={<Building2 className="h-5 w-5" />} />
      </div>
      <NotesList notes={branchNote} isArabic={isArabic} />
      <DataTable
        title={isArabic ? "أعلى الموردين مستحقات" : "Top supplier payables"}
        rows={data?.top_suppliers}
        columns={[
          { key: "supplier_name", label: isArabic ? "المورد" : "Supplier" },
          { key: "purchases_count", label: isArabic ? "عدد الفواتير" : "Purchases" },
          { key: "outstanding_balance", label: isArabic ? "الرصيد المستحق" : "Outstanding", money: true },
        ]}
        isArabic={isArabic}
      />
      <DataTable
        title={isArabic ? "تفصيل مستحقات الموردين" : "Payables detail"}
        rows={data?.rows}
        columns={[
          { key: "transaction_date", label: isArabic ? "التاريخ" : "Date", type: "date" },
          { key: "reference", label: isArabic ? "المرجع" : "Reference" },
          { key: "supplier_name", label: isArabic ? "المورد" : "Supplier" },
          { key: "invoice_total", label: isArabic ? "إجمالي الفاتورة" : "Invoice", money: true },
          { key: "paid_amount", label: isArabic ? "المدفوع" : "Paid", money: true },
          { key: "outstanding_balance", label: isArabic ? "المستحق" : "Outstanding", money: true },
          { key: "payment_status", label: isArabic ? "حالة السداد" : "Payment Status" },
        ]}
        isArabic={isArabic}
      />
    </div>
  );
}

function InventoryTab({ data, loading, isArabic }) {
  if (loading) return <LoadingBlock rows={2} />;
  const summary = data?.summary || {};
  const notes = [summary.cogs_note].filter(Boolean);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FinanceMetricCard label={isArabic ? "قيمة المخزون" : "Inventory Value"} value={formatCurrency(summary.inventory_value, isArabic ? "ar" : "en")} tone="emerald" icon={<Boxes className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "إجمالي الوحدات" : "Total Units"} value={formatNumber(summary.total_units, isArabic ? "ar" : "en")} tone="cyan" icon={<PackageSearch className="h-5 w-5" />} />
        <FinanceMetricCard label="COGS" value={formatCurrency(summary.cogs, isArabic ? "ar" : "en")} hint={summary.cogs_estimated ? (isArabic ? "تقديري" : "Estimated") : ""} tone="amber" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "أسطر المخزون" : "Inventory Lines"} value={formatNumber(summary.inventory_lines, isArabic ? "ar" : "en")} tone="violet" icon={<Boxes className="h-5 w-5" />} />
      </div>
      <NotesList notes={notes} isArabic={isArabic} />
      <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
        {isArabic
          ? "قيمة COGS هنا تقديرية وفق البيانات المتاحة حاليًا وقد لا تمثل تكلفة تاريخية دقيقة لكل سطر بيع."
          : "COGS here is estimated from the current data model and may not represent exact historical cost for every sold line."}
      </div>
      <DataTable
        title={isArabic ? "تفصيل تقييم المخزون" : "Inventory valuation detail"}
        rows={data?.rows}
        columns={[
          { key: "product_name", label: isArabic ? "المنتج" : "Product" },
          { key: "item_name", label: isArabic ? "الصنف" : "Item" },
          { key: "stock_qty", label: isArabic ? "الكمية" : "Qty", number: true },
          { key: "unit_cost", label: isArabic ? "تكلفة الوحدة" : "Unit Cost", money: true },
          { key: "inventory_value", label: isArabic ? "قيمة المخزون" : "Inventory Value", money: true },
          { key: "source", label: isArabic ? "المصدر" : "Source" },
        ]}
        isArabic={isArabic}
      />
    </div>
  );
}

function SpecialsTab({ data, loading, isArabic }) {
  if (loading) return <LoadingBlock rows={2} />;
  const summary = data?.summary || {};
  const notes = [data?.meta?.gifts_note].filter(Boolean);
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <FinanceMetricCard label={isArabic ? "الخصومات" : "Discounts"} value={formatCurrency(summary.discounts, isArabic ? "ar" : "en")} tone="amber" icon={<ReceiptText className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "المرتجعات" : "Refunds"} value={formatCurrency(summary.refunds, isArabic ? "ar" : "en")} tone="rose" icon={<ArrowDownLeft className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "سلف الموظفين" : "Employee Advances"} value={formatCurrency(summary.employee_advances, isArabic ? "ar" : "en")} tone="cyan" icon={<HandCoins className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "استخدام المالك" : "Owner Use"} value={formatCurrency(summary.owner_use, isArabic ? "ar" : "en")} tone="violet" icon={<Wallet className="h-5 w-5" />} />
        <FinanceMetricCard label={isArabic ? "إجمالي الحركات" : "Total Amount"} value={formatCurrency(summary.total_amount, isArabic ? "ar" : "en")} tone="emerald" icon={<TrendingUp className="h-5 w-5" />} />
      </div>
      <NotesList notes={notes} isArabic={isArabic} />
      <DataTable
        title={isArabic ? "تفصيل الحركات الخاصة" : "Special transaction detail"}
        rows={data?.rows}
        columns={[
          { key: "transaction_date", label: isArabic ? "التاريخ" : "Date", type: "date" },
          { key: "label", label: isArabic ? "النوع" : "Label" },
          { key: "reference", label: isArabic ? "المرجع" : "Reference" },
          { key: "amount", label: isArabic ? "القيمة" : "Amount", money: true },
          { key: "status", label: isArabic ? "الحالة" : "Status" },
          { key: "notes", label: isArabic ? "ملاحظات" : "Notes" },
        ]}
        isArabic={isArabic}
      />
    </div>
  );
}

function FilterField({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[var(--muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)]"
      />
    </label>
  );
}

function FilterSelect({ label, value, onChange, options = [] }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 text-sm text-[var(--text)] outline-none transition focus:border-[var(--primary)]"
      >
        {options.map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StateBox({ icon: Icon, title, message, actionLabel, onAction, tone = "neutral" }) {
  const toneClasses = tone === "error"
    ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]";

  return (
    <div className={`mt-5 rounded-3xl border p-6 ${toneClasses}`}>
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-black/10 p-3">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-black">{title}</h3>
          <p className="mt-2 text-sm opacity-90">{message}</p>
          {actionLabel && onAction ? (
            <button
              type="button"
              onClick={onAction}
              className="mt-4 rounded-2xl border border-current px-4 py-2 text-sm font-semibold"
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LoadingBlock({ rows = 1 }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-40 animate-pulse rounded-3xl border border-[var(--border)] bg-[var(--surface)]" />
      ))}
    </div>
  );
}

function NotesList({ notes = [], isArabic }) {
  if (!notes.length) return null;
  return (
    <div className="space-y-2">
      {notes.map((note, index) => (
        <div
          key={`${note}-${index}`}
          className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
        >
          {isArabic ? "ملاحظة: " : "Note: "}
          {note}
        </div>
      ))}
    </div>
  );
}

function MiniTableCard({ title, rows, columns, isArabic }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-base font-black text-[var(--text)]">{title}</h3>
      <div className="mt-4">
        <SimpleTable rows={rows} columns={columns} isArabic={isArabic} compact />
      </div>
    </div>
  );
}

function DataTable({ title, rows, columns, isArabic }) {
  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-base font-black text-[var(--text)]">{title}</h3>
      <div className="mt-4">
        <SimpleTable rows={rows} columns={columns} isArabic={isArabic} />
      </div>
    </div>
  );
}

function SimpleTable({ rows = [], columns = [], isArabic, compact = false }) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  if (!normalizedRows.length) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
        {isArabic ? "لا توجد بيانات للفلاتر الحالية." : "No data for the current filters."}
      </div>
    );
  }

  return (
    <div className="m1-table-container m1-table-container--plain overflow-x-auto rounded-2xl border border-[var(--border)]">
      <table className={`m1-table m1-table--compact min-w-full text-sm ${isArabic ? "text-right" : "text-left"}`}>
        <thead className="bg-[var(--card)] text-[var(--muted)]">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`px-4 py-3 font-bold ${compact ? "" : "whitespace-nowrap"} ${isArabic ? "text-right" : "text-left"}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {normalizedRows.map((row, rowIndex) => (
            <tr key={row.id || row.key || row.reference || rowIndex} className="bg-[var(--surface)] text-[var(--text)]">
              {columns.map((column) => (
                <td key={column.key} className={`px-4 py-3 align-top ${isArabic ? "text-right" : "text-left"}`}>
                  {renderCell(row, column, isArabic)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(row, column, isArabic) {
  if (typeof column.render === "function") return column.render(row);

  const value = row?.[column.key];
  if (column.money) return formatCurrency(value, isArabic ? "ar" : "en");
  if (column.number) return formatNumber(value, isArabic ? "ar" : "en");
  if (column.type === "date" && value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return isArabic ? "غير صالح" : "Invalid";
    return parsed.toLocaleDateString(isArabic ? "ar-EG" : "en-GB");
  }
  return value === null || value === undefined || value === "" ? (isArabic ? "—" : "—") : String(value);
}

const exportSections = (data = {}) =>
  Object.entries(data || {})
    .filter(([key, value]) => key !== "filters" && key !== "meta" && key !== "notes" && value && (Array.isArray(value) || typeof value === "object"))
    .map(([key, value]) => {
      if (Array.isArray(value)) return { title: key, rows: value };
      return { title: key, rows: Object.entries(value).map(([metric, amount]) => ({ metric, value: amount })) };
    })
    .filter((section) => section.rows.length);

const safeExportValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const csvCell = (value) => `"${safeExportValue(value).replace(/"/g, '""')}"`;

function exportCurrentReportCsv({ title, data, isArabic }) {
  const lines = [[title], [new Date().toLocaleString(isArabic ? "ar-EG" : "en-GB")], []];
  exportSections(data).forEach((section) => {
    const headers = [...new Set(section.rows.flatMap((row) => Object.keys(row || {})))];
    lines.push([section.title], headers, ...section.rows.map((row) => headers.map((header) => row?.[header])), []);
  });
  const content = `\uFEFF${lines.map((row) => row.map(csvCell).join(",")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `accounting-${Date.now()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const escapePrintHtml = (value) =>
  safeExportValue(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function printCurrentReport({ title, data, filters, isArabic }) {
  const sections = exportSections(data);
  const popup = window.open("", "_blank");
  if (!popup) return;
  const filterText = [
    filters?.from_date ? `${isArabic ? "من" : "From"}: ${filters.from_date}` : "",
    filters?.to_date ? `${isArabic ? "إلى" : "To"}: ${filters.to_date}` : "",
    filters?.branch_id ? `${isArabic ? "الفرع" : "Branch"}: ${filters.branch_id}` : "",
  ].filter(Boolean).join(" • ");
  const tables = sections.map((section) => {
    const headers = [...new Set(section.rows.flatMap((row) => Object.keys(row || {})))];
    return `<section><h2>${escapePrintHtml(section.title)}</h2><table><thead><tr>${headers.map((header) => `<th>${escapePrintHtml(header)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${headers.map((header) => `<td>${escapePrintHtml(row?.[header])}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`;
  }).join("");
  popup.document.write(`<!doctype html><html dir="${isArabic ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapePrintHtml(title)}</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}header{border-bottom:3px solid #d9aa20;padding-bottom:12px;margin-bottom:18px;display:flex;justify-content:space-between;gap:20px}h1{margin:0;font-size:24px}h2{font-size:16px;margin:22px 0 8px;color:#7a5a00}small{color:#666}table{width:100%;border-collapse:collapse;font-size:10px;page-break-inside:auto}th,td{border:1px solid #d8d8d8;padding:6px;text-align:${isArabic ? "right" : "left"};vertical-align:top}th{background:#111827;color:#fff}tr:nth-child(even){background:#f7f7f7}section{page-break-inside:avoid;margin-bottom:16px}</style></head><body><header><div><h1>${escapePrintHtml(title)}</h1><small>${escapePrintHtml(filterText || (isArabic ? "كل الفترات والفروع" : "All periods and branches"))}</small></div><small>${escapePrintHtml(new Date().toLocaleString(isArabic ? "ar-EG" : "en-GB"))}</small></header>${tables}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

export default FinancialReports;

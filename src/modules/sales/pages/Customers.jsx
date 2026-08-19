import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, Download, FileText, Filter, Mail, MapPin, Pencil, Phone, PlusCircle, Search, Sparkles, Trash2, UploadCloud, UserRound, UsersRound, Wallet, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";

import { api } from "../../../shared/api/api";
import { getCurrentUser } from "../../../shared/auth/authStorage";
import { Pagination } from "../../../shared/ui";
import customerStatementArabicFontUrl from "../../../assets/fonts/customer-statement-arabic.ttf?url";
import { escapeHtml, formatPrintDate, normalizePrintLanguage, openPrintHtml, PRINT_FONT_STACK, wrapPrintableHtml } from "../../../shared/utils/printLocalization";
import "./Customers.m1.css";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);

const DEFAULT_CUSTOMERS_PAGE_SIZE = 25;
const CUSTOMER_PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200, 500, 1000, "all"];
const todayInputValue = () => new Date().toISOString().slice(0, 10);

const inputClass =
  "h-12 w-full rounded-[var(--radius-card)] border border-border bg-surface px-4 text-sm font-semibold text-text outline-none transition placeholder:text-text-muted focus:border-emerald-400/50 focus:bg-surface";

const avatarShellClass =
  "flex h-12 w-12 shrink-0 items-center justify-center justify-self-end overflow-hidden rounded-[var(--radius-card)] border border-emerald-300/20 bg-emerald-400/15 text-emerald-200 shadow-lg shadow-emerald-950/20";

/**
 * WhatsApp profile picture URLs expire, so a broken image is expected wear, not
 * an error — falling back to the icon keeps the row looking deliberate.
 */
const CustomerAvatar = ({ customer }) => {
  const [failed, setFailed] = useState(false);
  const url = String(customer?.avatar_url || "").trim();
  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (!url || failed) {
    return (
      <div className={avatarShellClass}>
        <UserRound className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className={avatarShellClass}>
      <img
        src={url}
        alt={customer?.name || ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
      />
    </div>
  );
};

const normalizeCustomersPayload = (response) => {
  const rootPayload = response && typeof response === "object" ? response : {};
  const payload = rootPayload?.pagination || Array.isArray(rootPayload?.customers)
    ? rootPayload
    : (rootPayload?.data ?? rootPayload);
  const data = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.customers)
      ? payload.customers
      : Array.isArray(payload?.data)
        ? payload.data
        : [];
  return {
    data,
    pagination: rootPayload?.pagination && typeof rootPayload.pagination === "object"
      ? rootPayload.pagination
      : payload?.pagination && typeof payload.pagination === "object"
        ? payload.pagination
        : null,
    total: Number(rootPayload?.total),
    page: Number(rootPayload?.page),
    limit: Number(rootPayload?.limit),
    hasMore: rootPayload?.hasMore,
  };
};

const normalizeCustomersResponse = (response) => {
  const { data } = normalizeCustomersPayload(response);
  return data;
};

const normalizeCustomersPagination = (response, fallbackLimit = DEFAULT_CUSTOMERS_PAGE_SIZE) => {
  const { data, pagination, total: topLevelTotal, page: topLevelPage, limit: topLevelLimit, hasMore: topLevelHasMore } = normalizeCustomersPayload(response);
  const total = Number.isFinite(topLevelTotal) ? topLevelTotal : Number(pagination?.total);
  const page = Number.isFinite(topLevelPage) ? topLevelPage : Number(pagination?.page);
  const limit = Number.isFinite(topLevelLimit) ? topLevelLimit : Number(pagination?.limit);
  const totalPages = Number(pagination?.totalPages);
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : fallbackLimit;
  const safeTotal = Number.isFinite(total) ? total : data.length;
  return {
    total: safeTotal,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: safeLimit,
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : Math.max(1, Math.ceil(safeTotal / safeLimit)),
    hasMore: typeof topLevelHasMore === "boolean" ? topLevelHasMore : Boolean(pagination?.hasMore),
  };
};

const clampPage = (page, totalPages) =>
  Math.min(Math.max(1, page), Math.max(1, totalPages || 1));

// Module-scope array: stores translation KEYS and resolves them at render.
const walletTypeOptions = [
  { value: "", labelKey: "customers.filters.allMovements" },
  { value: "order_payment", labelKey: "customers.wallet.payFromWallet" },
  { value: "refund", labelKey: "customers.wallet.refundToWallet" },
  { value: "exchange_credit", labelKey: "customers.statement.exchangeCredit" },
  { value: "loyalty_conversion", labelKey: "customers.wallet.loyaltyCredit" },
  { value: "manual_add", labelKey: "customers.statement.manualCredit" },
  { value: "manual_deduct", labelKey: "customers.statement.manualDebit" },
];

// Module-scope array: stores translation KEYS and resolves them at render.
const statementFilterOptions = [
  { value: "", labelKey: "customers.filters.all", tone: "slate" },
  { value: "customer_payment", labelKey: "customers.filters.customerPayments", tone: "sky" },
  { value: "order_payment", labelKey: "customers.statement.regularSales", tone: "emerald" },
  { value: "personal_gift", labelKey: "customers.personalUse.giftEnum", tone: "amber" },
  { value: "personal_employee_advance", labelKey: "customers.personalUse.employeeAdvanceEnum", tone: "cyan" },
  { value: "personal_owner_use", labelKey: "customers.personalUse.ownerUseEnum", tone: "violet" },
];

const getStatementMovementMeta = (row = {}) => {
  const transactionType = String(row.transaction_type || "").trim().toLowerCase();
  const personalType = String(row.personal_operation_type || "").trim().toUpperCase();

  if (personalType === "GIFT" || transactionType === "personal_gift") {
    return { label: tt("customers.personalUse.gift"), tone: "amber" };
  }
  if (personalType === "EMPLOYEE_ADVANCE" || transactionType === "personal_employee_advance") {
    return { label: tt("customers.personalUse.employeeAdvance"), tone: "cyan" };
  }
  if (personalType === "OWNER_USE" || transactionType === "personal_owner_use") {
    return { label: tt("customers.personalUse.ownerUse"), tone: "violet" };
  }
  if (String(row.payment_method || "").trim().toLowerCase() === "credit_sale") {
    const paymentStatus = String(row.payment_status || "").trim().toLowerCase();
    if (["paid", "completed", "settled"].includes(paymentStatus)) {
      return { label: tt("customers.paymentState.fullyPaid"), tone: "emerald" };
    }
    if (["partially_paid", "partial"].includes(paymentStatus)) {
      return { label: tt("customers.paymentState.partiallyPaid"), tone: "sky" };
    }
    return { label: tt("customers.paymentState.unpaidCredit"), tone: "amber" };
  }
  if (transactionType === "order_payment") {
    return { label: tt("customers.statement.regularSales"), tone: "emerald" };
  }
  if (transactionType === "customer_payment") {
    return { label: tt("customers.statement.customerPayment"), tone: "sky" };
  }
  if (transactionType === "refund") {
    return { label: tt("customers.statement.refund"), tone: "rose" };
  }
  if (transactionType === "exchange_credit") {
    return { label: tt("customers.statement.exchangeCredit"), tone: "sky" };
  }
  return {
    label: row.transaction_type_label || row.transaction_type || "-",
    tone: "slate",
  };
};

const getStatementBadgeClass = (tone = "slate") => {
  const classes = {
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    violet: "border-violet-300/20 bg-violet-400/10 text-violet-100",
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    rose: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    sky: "border-sky-300/20 bg-sky-400/10 text-sky-100",
    slate: "border-border bg-surface-soft text-text",
  };
  return classes[tone] || classes.slate;
};

const formatMoney = (value) =>
  Number(value || 0).toLocaleString("ar-EG-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const CUSTOMER_STATEMENT_FONT = {
  fileName: "customer-statement-arabic.ttf",
  family: "CustomerStatementArabic",
};

let customerStatementFontPromise = null;

const toPdfArabic = (doc, value = "") => {
  const text = String(value ?? "");
  return typeof doc?.processArabic === "function" ? doc.processArabic(text) : text;
};

const arrayBufferToBinaryString = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return binary;
};

const loadCustomerStatementFont = async () => {
  if (!customerStatementFontPromise) {
    customerStatementFontPromise = fetch(customerStatementArabicFontUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load customer statement font: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then(arrayBufferToBinaryString);
  }
  return customerStatementFontPromise;
};

const registerCustomerStatementFont = async (doc) => {
  if (!doc?.addFileToVFS || !doc?.addFont) return;
  const fontList = typeof doc.getFontList === "function" ? doc.getFontList() : {};
  if (!fontList?.[CUSTOMER_STATEMENT_FONT.family]) {
    const fontData = await loadCustomerStatementFont();
    doc.addFileToVFS(CUSTOMER_STATEMENT_FONT.fileName, fontData);
    doc.addFont(CUSTOMER_STATEMENT_FONT.fileName, CUSTOMER_STATEMENT_FONT.family, "normal");
    doc.addFont(CUSTOMER_STATEMENT_FONT.fileName, CUSTOMER_STATEMENT_FONT.family, "bold");
  }
  if (typeof doc.setLanguage === "function") {
    doc.setLanguage("ar");
  }
  if (typeof doc.setR2L === "function") {
    doc.setR2L(true);
  }
  doc.setFont(CUSTOMER_STATEMENT_FONT.family, "normal");
};

const getStatementRows = (statement) => (Array.isArray(statement?.rows) ? statement.rows : []);

const getStatementTotals = (statement) => {
  const rows = getStatementRows(statement);
  return rows.reduce((acc, row) => {
    const amount = Number(row.amount || 0);
    if (amount > 0) acc.credit += amount;
    if (amount < 0) acc.debit += Math.abs(amount);
    return acc;
  }, {
    debit: Number(statement?.totals?.debit || 0),
    credit: Number(statement?.totals?.credit || 0),
  });
};

const buildCustomerStatementPrintHtml = ({ statement, customer, language }) => {
  const rows = getStatementRows(statement);
  const totals = getStatementTotals(statement);
  const customerName = customer?.name || statement?.customer?.name || "";
  const customerPhone = customer?.phone || statement?.customer?.phone || "";
  const currentBalance = Number(statement?.current_balance ?? customer?.wallet_balance ?? customer?.balance ?? 0);
  const openingBalance = Number(statement?.opening_balance ?? 0);
  const finalBalance = Number(statement?.final_balance ?? currentBalance);
  const lastUpdated = statement?.filters?.date_to || statement?.filters?.date_from || new Date().toISOString();
  const normalizedLanguage = normalizePrintLanguage(language);
  const body = `
    <main class="customer-statement-print" dir="rtl">
      <section class="statement-card statement-head">
        <div>
          <div class="eyebrow">{tt("customers.statement.printTitle")}</div>
          <h1>{tt("customers.statement.title")}</h1>
          <div class="customer-meta">
            <div><span>{tt("customers.print.customerLabel")}</span> ${escapeHtml(customerName || "-")}</div>
            <div><span>{tt("customers.print.phoneLabel")}</span> ${escapeHtml(customerPhone || "-")}</div>
            <div><span>{tt("customers.print.currentBalanceLabel")}</span> ${escapeHtml(formatMoney(currentBalance))}</div>
            <div><span>{tt("customers.print.loyaltyPointsLabel")}</span> ${escapeHtml(Number(customer?.loyalty_points ?? statement?.customer?.loyalty_points ?? 0).toLocaleString("ar-EG-u-nu-latn"))}</div>
          </div>
        </div>
        <div class="summary-block">
          <div class="summary-label">{tt("customers.common.lastUpdated")}</div>
          <div class="summary-value">${escapeHtml(formatPrintDate(lastUpdated, normalizedLanguage, { dateStyle: "medium", timeStyle: "short" }))}</div>
          <div class="summary-mini">
            <div><span>{tt("customers.statement.openingBalance")}</span><strong>${escapeHtml(formatMoney(openingBalance))}</strong></div>
            <div><span>{tt("customers.statement.closingBalance")}</span><strong>${escapeHtml(formatMoney(finalBalance))}</strong></div>
          </div>
        </div>
      </section>

      <section class="statement-card">
        <div class="section-title">{tt("customers.statement.movements")}</div>
        <table class="statement-table">
          <thead>
            <tr>
              <th>{tt("customers.statement.date")}</th>
              <th>{tt("customers.statement.description")}</th>
              <th>{tt("customers.statement.invoiceOrOrder")}</th>
              <th class="num">{tt("customers.statement.paymentOrSettlement")}</th>
              <th class="num">{tt("customers.statement.amountDue")}</th>
              <th class="num">{tt("customers.statement.remaining")}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => {
              const amount = Number(row.amount || 0);
              const debit = amount < 0 ? formatMoney(Math.abs(amount)) : "";
              const credit = amount > 0 ? formatMoney(amount) : "";
              const reference = row.invoice_number || row.return_number || row.reference_id || "-";
              return `
                <tr>
                  <td>${escapeHtml(formatPrintDate(row.created_at, normalizedLanguage, { dateStyle: "medium", timeStyle: "short" }))}</td>
                  <td>${escapeHtml(row.transaction_type_label || row.notes || row.transaction_type || "-")}</td>
                  <td>${escapeHtml(reference)}</td>
                  <td class="num">${escapeHtml(debit || "-")}</td>
                  <td class="num">${escapeHtml(credit || "-")}</td>
                  <td class="num">${escapeHtml(formatMoney(row.after_balance))}</td>
                </tr>
              `;
            }).join("") : `
              <tr><td colspan="6" class="empty">{tt("customers.statement.noMatches")}</td></tr>
            `}
          </tbody>
        </table>
      </section>

      <section class="statement-card totals-grid">
        <div><span>{tt("customers.statement.totalPayments")}</span><strong>${escapeHtml(formatMoney(totals.debit))}</strong></div>
        <div><span>{tt("customers.statement.totalDue")}</span><strong>${escapeHtml(formatMoney(totals.credit))}</strong></div>
        <div><span>{tt("customers.statement.outstanding")}</span><strong>${escapeHtml(formatMoney(finalBalance))}</strong></div>
      </section>
    </main>
  `;

  const html = wrapPrintableHtml({
    title: tt("customers.statement.title"),
    body,
    language: normalizedLanguage,
  });

  const extraStyles = `
    @font-face {
      font-family: "CustomerStatementArabic";
      src: url("${customerStatementArabicFontUrl}") format("truetype");
      font-weight: 400;
      font-style: normal;
    }
    @font-face {
      font-family: "CustomerStatementArabic";
      src: url("${customerStatementArabicFontUrl}") format("truetype");
      font-weight: 700;
      font-style: normal;
    }
    body {
      font-family: "CustomerStatementArabic", ${PRINT_FONT_STACK};
      background: #eef2f7;
    }
    .customer-statement-print {
      width: min(100%, 920px);
      margin: 0 auto;
      display: grid;
      gap: 14px;
    }
    .statement-card {
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      background: #fff;
      padding: 16px;
      box-shadow: 0 14px 40px rgba(15, 23, 42, 0.05);
    }
    .statement-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
      gap: 16px;
      align-items: start;
    }
    .eyebrow {
      color: #059669;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      font-weight: 900;
      color: #0f172a;
    }
    .customer-meta {
      margin-top: 10px;
      display: grid;
      gap: 6px;
      font-size: 13px;
      color: #334155;
    }
    .customer-meta span,
    .summary-mini span {
      color: #64748b;
      font-weight: 800;
      margin-left: 4px;
    }
    .summary-block {
      background: linear-gradient(180deg, #ecfdf5 0%, #f8fafc 100%);
      border: 1px solid #bbf7d0;
      border-radius: 16px;
      padding: 14px;
    }
    .summary-label,
    .section-title {
      color: #059669;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    .summary-value {
      margin-top: 6px;
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
    }
    .summary-mini {
      margin-top: 12px;
      display: grid;
      gap: 8px;
    }
    .summary-mini > div,
    .totals-grid > div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
      color: #0f172a;
    }
    .summary-mini strong,
    .totals-grid strong {
      font-weight: 900;
      color: #0f172a;
    }
    .statement-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      table-layout: fixed;
    }
    .statement-table th,
    .statement-table td {
      border-bottom: 1px solid #e2e8f0;
      padding: 9px 8px;
      font-size: 12px;
      line-height: 1.45;
      vertical-align: top;
      text-align: right;
      overflow-wrap: anywhere;
    }
    .statement-table th {
      background: #f8fafc;
      font-weight: 900;
      color: #475569;
    }
    .statement-table .num {
      direction: ltr;
      text-align: left;
      unicode-bidi: isolate;
      font-variant-numeric: tabular-nums;
    }
    .statement-table .empty {
      text-align: center;
      color: #64748b;
      padding: 20px 8px;
    }
    .totals-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    @media print {
      body { background: #fff; padding: 0 !important; }
      .statement-card { box-shadow: none; }
    }
  `;

  return html.replace("</style>", `${extraStyles}</style>`);
};

const printCustomerStatement = (statement, customer, language) => {
  if (typeof window === "undefined") return false;
  const html = buildCustomerStatementPrintHtml({ statement, customer, language });
  return openPrintHtml(html, { width: 1100, height: 1300 });
};

const isAdminOrManager = (user = getCurrentUser()) => {
  const role = String(user?.role_name || user?.role || "admin").trim().toLowerCase().replace(/[_-]+/g, " ");
  return ["admin", "super admin", "superadmin", "manager"].includes(role);
};

function Customers() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { customerId: statementCustomerId } = useParams();
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    limit: DEFAULT_CUSTOMERS_PAGE_SIZE,
    totalPages: 1,
    hasMore: false,
  });
  const [editingId, setEditingId] = useState(null);
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const submitInFlightRef = useRef(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [allowPersonalTransactions, setAllowPersonalTransactions] = useState(false);
  // Linking a customer to an employee is what turns their deferred invoices into
  // salary advances instead of customer debt.
  const [linkedEmployeeId, setLinkedEmployeeId] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [suggestedEmployee, setSuggestedEmployee] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(() => (
    statementCustomerId ? { id: Number(statementCustomerId) || statementCustomerId } : null
  ));
  const [profile, setProfile] = useState(null);
  const [statementData, setStatementData] = useState(null);
  const [walletAudit, setWalletAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [statementError, setStatementError] = useState("");
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    transaction_type: "",
    invoice_number: "",
    amount_min: "",
    amount_max: "",
  });
  const [adjustment, setAdjustment] = useState({ type: "manual_add", amount: "", notes: "" });
  const [payment, setPayment] = useState({ amount: "", payment_method: "cash", payment_date: todayInputValue(), reference: "", notes: "" });
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importPointsMode, setImportPointsMode] = useState("replace");
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const canExportStatement = useMemo(() => isAdminOrManager(), []);
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const currentPage = clampPage(Number(pagination.page || 1), Number(pagination.totalPages || 1));
  const pageSize = Number(pagination.limit || DEFAULT_CUSTOMERS_PAGE_SIZE);
  const totalCustomers = Number(pagination.total || 0);
  const totalPages = Math.max(1, Number(pagination.totalPages || 1));
  const visibleCount = safeCustomers.length;

  const buildFilterQuery = useCallback(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || "").trim()) params.set(key, String(value).trim());
    });
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [filters]);

  const fetchCustomers = useCallback(async ({ page = currentPage, limit = pageSize, searchValue = debouncedSearch } = {}) => {
    try {
      setLoading(true);
      const response = await api.get("/customers", {
        params: {
          page,
          limit,
          search: String(searchValue || "").trim(),
        },
      });
      const nextCustomers = normalizeCustomersResponse(response);
      const nextPagination = normalizeCustomersPagination(response, limit);
      console.log("[customers-page] /customers response", {
        total: nextPagination.total,
        customersLength: nextCustomers.length,
        page: nextPagination.page,
        limit: nextPagination.limit,
        hasMore: nextPagination.hasMore,
        raw: response,
      });
      setCustomers(nextCustomers);
      setPagination(nextPagination);
    } catch (error) {
      console.error("[customers] failed to load customers:", error);
      setCustomers([]);
      setPagination((current) => ({
        ...current,
        total: 0,
        totalPages: 1,
        hasMore: false,
      }));
    } finally {
      setLoading(false);
    }
  }, [currentPage, debouncedSearch, pageSize]);

  const fetchCustomerProfile = useCallback(async (customer) => {
    if (!customer?.id) return;
    try {
      setSelectedCustomer(customer);
      const response = await api.get(`/customers/${customer.id}/profile`);
      setProfile(response?.data || null);
    } catch (error) {
      console.error("[customers] failed to load profile:", error);
      setProfile({ customer });
    }
  }, []);

  useEffect(() => {
    if (!statementCustomerId) return;
    const routeCustomerId = Number(statementCustomerId) || statementCustomerId;
    setStatementData(null);
    setStatementError("");
    setWalletAudit([]);
    setProfile(null);
    fetchCustomerProfile({ id: routeCustomerId });
  }, [fetchCustomerProfile, statementCustomerId]);

  const fetchCustomerStatement = useCallback(async () => {
    if (!selectedCustomer?.id) return null;
    try {
      setAuditLoading(true);
      setStatementError("");
      const response = await api.get(`/customers/${selectedCustomer.id}/statement${buildFilterQuery()}`);
      const statement = response?.data?.data || response?.data?.statement || response?.data || null;
      setStatementData(statement);
      setWalletAudit(Array.isArray(statement?.rows) ? statement.rows : []);
      return statement;
    } catch (error) {
      console.error("[customers] failed to load customer statement:", error);
      setStatementData(null);
      setWalletAudit([]);
      setStatementError(error?.message || tt("customers.statement.loadFailed"));
      return null;
    } finally {
      setAuditLoading(false);
    }
  }, [buildFilterQuery, selectedCustomer?.id]);

  useEffect(() => {
    fetchCustomerStatement();
  }, [fetchCustomerStatement]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const handleOpenProfile = (customer) => {
    navigate(`/customers/${encodeURIComponent(customer.id)}/statement`);
  };

  const handleManualAdjustment = async (event) => {
    event.preventDefault();
    if (!selectedCustomer?.id) return;
    const notes = String(adjustment.notes || "").trim();
    if (!notes) {
      window.alert(tt("customers.wallet.reasonRequired"));
      return;
    }
    try {
      await api.post(`/customers/${selectedCustomer.id}/wallet/adjust`, {
        transaction_type: adjustment.type,
        amount: Number(adjustment.amount || 0),
        notes,
      });
      setAdjustment({ type: "manual_add", amount: "", notes: "" });
      await Promise.all([fetchCustomers(), fetchCustomerProfile(selectedCustomer), fetchCustomerStatement()]);
    } catch (error) {
      console.error("[customers] failed to adjust wallet:", error);
      window.alert(error?.message || tt("customers.wallet.adjustFailed"));
    }
  };

  const handleCustomerPayment = async (event) => {
    event.preventDefault();
    if (!selectedCustomer?.id || paymentSaving) return false;
    const amount = Number(payment.amount || 0);
    if (!(amount > 0)) {
      window.alert(tt("customers.payment.invalidAmount"));
      return false;
    }
    const currentBalance = Number(statementData?.current_balance ?? selectedCustomer?.wallet_balance ?? selectedCustomer?.balance ?? 0);
    if (amount > currentBalance) {
      window.alert(`الدفعة أكبر من المبلغ المستحق (${formatMoney(currentBalance)} ج.م).`);
      return false;
    }
    try {
      setPaymentSaving(true);
      await api.post(`/customers/${selectedCustomer.id}/wallet/adjust`, {
        transaction_type: "customer_payment",
        amount,
        payment_method: payment.payment_method,
        payment_date: payment.payment_date,
        reference: payment.reference,
        notes: payment.notes,
      });
      setPayment({ amount: "", payment_method: "cash", payment_date: todayInputValue(), reference: "", notes: "" });
      await Promise.all([fetchCustomers(), fetchCustomerProfile(selectedCustomer), fetchCustomerStatement()]);
      return true;
    } catch (error) {
      console.error("[customers] failed to record customer payment:", error);
      window.alert(error?.message || tt("customers.payment.recordFailed"));
      return false;
    } finally {
      setPaymentSaving(false);
    }
  };

  const handleExportStatement = async () => {
    if (!selectedCustomer?.id || !canExportStatement) return;

    try {
      const statement = statementData?.rows ? statementData : await fetchCustomerStatement();
      if (!statement) {
        throw new Error(tt("customers.statement.loadFailed"));
      }

      const opened = printCustomerStatement(statement, profile?.customer || selectedCustomer, i18n.language);
      if (!opened) {
        throw new Error(tt("customers.statement.printWindowFailed"));
      }
    } catch (error) {
      console.error("[customers] failed to export statement:", error);
      window.alert(error?.message || tt("customers.statement.exportFailed"));
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  // Employees to link to, plus the one whose phone matches what is being typed.
  // The suggestion is offered, never applied: linking the wrong employee would
  // charge someone else's salary for this customer's deferred invoices.
  useEffect(() => {
    if (!customerFormOpen) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const query = phone ? `?phone=${encodeURIComponent(phone)}` : "";
        const response = await api.get(`/customers/employee-options${query}`);
        if (cancelled) return;
        setEmployeeOptions(Array.isArray(response?.employees) ? response.employees : []);
        setSuggestedEmployee(response?.suggested_employee || null);
      } catch (error) {
        if (!cancelled) {
          console.error("[customers] failed to load employee options:", error);
          setEmployeeOptions([]);
          setSuggestedEmployee(null);
        }
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [customerFormOpen, phone]);

  const resetForm = () => {
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setAllowPersonalTransactions(false);
    setLinkedEmployeeId("");
    setSuggestedEmployee(null);
    setEditingId(null);
    setCustomerFormOpen(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    // A ref, not the state flag: two clicks in the same tick both read the old
    // state value and both would submit.
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setCustomerSaving(true);

    try {
      const customerData = {
        name,
        phone,
        email,
        address,
        allow_personal_transactions: allowPersonalTransactions,
        linked_employee_id: linkedEmployeeId ? Number(linkedEmployeeId) : null,
      };

      if (editingId) {
        await api.put(`/customers/${editingId}`, customerData);
      } else {
        const response = await api.post("/customers", customerData);
        if (response?.duplicate) {
          window.alert(tt("customers.form.duplicatePhone"));
        }
      }

      resetForm();
      fetchCustomers({ page: currentPage });
    } catch (error) {
      console.error("[customers] failed to save customer:", error);
      window.alert(error?.message || tt("customers.form.saveFailed"));
    } finally {
      submitInFlightRef.current = false;
      setCustomerSaving(false);
    }
  };

  const editCustomer = (customer) => {
    setEditingId(customer.id);
    setCustomerFormOpen(true);
    setName(customer.name || "");
    setPhone(customer.phone || "");
    setEmail(customer.email || "");
    setAddress(customer.address || "");
    setAllowPersonalTransactions(Boolean(customer.allow_personal_transactions ?? customer.allowPersonalTransactions ?? false));
    setLinkedEmployeeId(customer.linked_employee_id ? String(customer.linked_employee_id) : "");
  };

  const deleteCustomer = async (id) => {
    const confirmDelete = window.confirm(t("customers.actions.confirmDelete"));
    if (!confirmDelete) return;

    try {
      await api.delete(`/customers/${id}`);
      const nextPage = safeCustomers.length === 1 && currentPage > 1 ? currentPage - 1 : currentPage;
      fetchCustomers({ page: nextPage });
    } catch (error) {
      console.error("[customers] failed to delete customer:", error);
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
    setImportPointsMode("replace");
    setImportError("");
  };

  const buildImportFormData = () => {
    if (!importFile) return null;
    const formData = new FormData();
    formData.append("file", importFile);
    formData.append("pointsMode", importPointsMode);
    return formData;
  };

  const previewImport = async () => {
    const formData = buildImportFormData();
    if (!formData) {
      setImportError(tt("customers.import.chooseFileFirst"));
      return;
    }
    try {
      setImportLoading(true);
      setImportError("");
      setImportResult(null);
      const response = await api.post("/customers/import/preview", formData, { timeoutMs: 60000 });
      setImportPreview(response);
    } catch (error) {
      setImportError(error?.message || tt("customers.import.previewFailed"));
    } finally {
      setImportLoading(false);
    }
  };

  const confirmImport = async () => {
    const formData = buildImportFormData();
    if (!formData || !importPreview?.summary) return;
    try {
      setImportLoading(true);
      setImportError("");
      const response = await api.post("/customers/import/confirm", formData, { timeoutMs: 120000 });
      setImportResult(response);
      await fetchCustomers({ page: 1 });
    } catch (error) {
      setImportError(error?.message || tt("customers.import.runFailed"));
    } finally {
      setImportLoading(false);
    }
  };

  const downloadImportErrors = () => {
    const csv = importResult?.error_report_csv || importPreview?.error_report_csv || "";
    if (!csv.trim()) return;
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `customer-import-errors-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadCustomerImportTemplate = () => {
    const csv = [
      ["name", "phone", "email", "address", "points"],
      ["Ahmed", "01000000000", "test@test.com", "Damietta", "150"],
      ["Mohamed", "01000000001", "", "New Damietta", "300"],
    ]
      .map((row) =>
        row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");

    const blob = new Blob([`\uFEFF${csv}`], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "customer_import_template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const changePage = (nextPage) => {
    setPagination((current) => ({
      ...current,
      page: clampPage(nextPage, current.totalPages),
    }));
  };

  const changePageSize = (nextLimit) => {
    setPagination((current) => ({
      ...current,
      page: 1,
      limit: Number(nextLimit) || DEFAULT_CUSTOMERS_PAGE_SIZE,
    }));
  };

  if (selectedCustomer) {
    return (
      <CustomerStatementDrawer
        customer={profile?.customer || selectedCustomer}
        metrics={profile?.metrics}
        statement={statementData}
        walletAudit={walletAudit}
        auditLoading={auditLoading}
        statementError={statementError}
        filters={filters}
        setFilters={setFilters}
        adjustment={adjustment}
        setAdjustment={setAdjustment}
        payment={payment}
        setPayment={setPayment}
        paymentSaving={paymentSaving}
        onClose={() => {
          setSelectedCustomer(null);
          setStatementData(null);
          setStatementError("");
          navigate("/customers");
        }}
        onAdjust={handleManualAdjustment}
        onPayment={handleCustomerPayment}
        onExportStatement={handleExportStatement}
        canExportStatement={canExportStatement}
        onViewOrder={(orderId) => navigate(`/orders/${encodeURIComponent(orderId)}`)}
        onEditOrder={(orderId) => navigate(`/pos?editOrderId=${encodeURIComponent(orderId)}`)}
      />
    );
  }

  return (
    <div className="m1-customers-page min-h-screen bg-background px-6 py-6 text-text">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">{t("customers.eyebrow")}</div>
            <h1 className="m1-display mt-2 text-text">{t("customers.title")}</h1>
            <p className="mt-3 text-sm font-medium text-text-muted">
              {t("customers.subtitle")}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => {
                resetImport();
                setImportOpen(true);
              }}
              className="inline-flex h-14 items-center justify-center gap-3 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-5 text-sm font-black text-primary shadow-2xl shadow-primary/20 transition hover:bg-primary/20"
            >
              <UploadCloud className="h-5 w-5" />
              {tt("customers.import.title")}
            </button>
            <div className="inline-flex items-center gap-3 rounded-[var(--radius-card)] border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 shadow-2xl shadow-emerald-950/20">
              <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-card)] bg-emerald-400 text-text">
                <UsersRound className="h-6 w-6" />
              </div>
              <div>
                <div className="text-3xl font-black text-text">{totalCustomers.toLocaleString("ar-EG-u-nu-latn")}</div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">{t("customers.count")}</div>
              </div>
            </div>
          </div>
        </div>

        {customerFormOpen ? (
          <form
            onSubmit={handleSubmit}
            className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/20 backdrop-blur-xl"
          >
          <div className="mb-5 flex flex-col gap-1">
            <h2 className="m1-section-title text-text">{editingId ? t("customers.form.titleUpdate") : t("customers.form.titleAdd")}</h2>
            <p className="text-sm text-text-muted">{t("customers.form.subtitle")}</p>
          </div>

          <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
            <input
              type="text"
              placeholder={t("customers.form.namePlaceholder")}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className={inputClass}
            />
            <input
              type="text"
              placeholder={t("customers.form.phonePlaceholder")}
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={inputClass}
            />
            <input
              type="email"
              placeholder={t("customers.form.emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder={t("customers.form.addressPlaceholder")}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              className={inputClass}
            />
          </div>

          <label className="mt-5 flex items-center gap-3 rounded-[var(--radius-card)] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-50">
            <input
              type="checkbox"
              checked={allowPersonalTransactions}
              onChange={(event) => setAllowPersonalTransactions(event.target.checked)}
              className="h-4 w-4 rounded border-emerald-300/40 bg-surface text-emerald-400 focus:ring-emerald-300/40"
            />
            <span>{tt("customers.personalUse.allow")}</span>
          </label>

          <div className="mt-4 rounded-[var(--radius-card)] border border-amber-400/20 bg-amber-400/10 px-4 py-3">
            <label className="block text-sm font-semibold text-amber-50">
              {tt("customers.employeeLink.label")}
            </label>
            <p className="mt-1 text-xs text-amber-100/70">{tt("customers.employeeLink.hint")}</p>
            <select
              value={linkedEmployeeId}
              onChange={(event) => setLinkedEmployeeId(event.target.value)}
              className={`${inputClass} mt-2`}
            >
              <option value="">{tt("customers.employeeLink.none")}</option>
              {employeeOptions.map((employee) => (
                <option key={employee.id} value={String(employee.id)}>
                  {[employee.full_name, employee.employee_code].filter(Boolean).join(" — ")}
                </option>
              ))}
            </select>
            {suggestedEmployee && String(suggestedEmployee.id) !== String(linkedEmployeeId) ? (
              <button
                type="button"
                onClick={() => setLinkedEmployeeId(String(suggestedEmployee.id))}
                className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-amber-300/40 bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-50 transition hover:bg-amber-400/25"
              >
                {tt("customers.employeeLink.suggestion", {
                  name: [suggestedEmployee.full_name, suggestedEmployee.employee_code].filter(Boolean).join(" — "),
                })}
              </button>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={customerSaving}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-5 text-sm font-black text-[var(--primary-contrast)] shadow-lg shadow-emerald-950/30 transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {customerSaving
                ? t("customers.common.saving")
                : editingId
                  ? t("customers.form.submitUpdate")
                  : t("customers.form.submitAdd")}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface px-5 text-sm font-bold text-text-muted transition hover:bg-surface-hover hover:text-text"
              >
                {t("customers.form.cancel")}
              </button>
            ) : null}
          </div>
          </form>
        ) : null}

        <section className="customer-records overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="customer-records-toolbar border-b border-border px-5 py-4 sm:px-6">
            <div className="customer-records-heading">
              <h2 className="m1-section-title text-text">{t("customers.table.title")}</h2>
              <span className="customer-records-count">{totalCustomers.toLocaleString("ar-EG-u-nu-latn")}</span>
            </div>

            <div className="customer-records-actions">
              <label className="customer-records-search" htmlFor="customer-search">
                <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">{t("customers.search")}</span>
                <input
                  id="customer-search"
                  type="text"
                  placeholder={t("customers.searchPlaceholder")}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPagination((current) => ({ ...current, page: 1 }));
                  }}
                  className="customer-records-search__input"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  if (customerFormOpen) {
                    resetForm();
                    return;
                  }
                  resetForm();
                  setCustomerFormOpen(true);
                }}
                aria-expanded={customerFormOpen}
                className="customer-records-add inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 text-sm font-black transition"
              >
                {customerFormOpen ? <X className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                {customerFormOpen ? t("customers.form.cancel") : t("customers.form.titleAdd")}
              </button>
            </div>
          </div>

          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact w-full min-w-[1080px]">
              <colgroup>
                <col style={{ width: "30%", minWidth: "320px" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "4%" }} />
              </colgroup>
              <thead className="border-b border-border bg-surface text-xs font-black uppercase tracking-[0.18em] text-text-muted">
                <tr>
                  <th className="px-6 py-5 text-center align-middle">{t("customers.table.customer")}</th>
                  <th className="px-6 py-5 text-center align-middle">{t("customers.table.phone")}</th>
                  <th className="px-6 py-5 text-center align-middle">{t("customers.table.email")}</th>
                  <th className="px-6 py-5 text-center align-middle">{t("customers.table.address")}</th>
                  <th className="px-6 py-5 text-center align-middle">{tt("customers.common.loyaltyPoints")}</th>
                  <th className="px-6 py-5 text-center align-middle">{tt("customers.wallet.balance")}</th>
                  <th className="px-6 py-5 text-right align-middle">{t("customers.table.actions")}</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                      <td colSpan="7" className="px-6 py-12 text-center text-sm font-black text-emerald-300">
                      {t("customers.loading")}
                      </td>
                  </tr>
                ) : safeCustomers.length > 0 ? (
                  safeCustomers.map((customer, index) => (
                    <tr
                      key={customer.id}
                      className={`transition hover:bg-surface-hover ${ index % 2 === 0 ? "bg-surface" : "bg-surface" }`}
                    >
                      <td className="px-6 py-5 align-middle text-center">
                        <div className="grid w-full grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-2">
                          <CustomerAvatar customer={customer} />
                          <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center">
                            <h3 className="m1-section-title w-full text-text">{customer.name || t("customers.records.unnamed")}</h3>
                            <p className="w-full text-xs font-medium leading-tight text-text-muted">{t("customers.records.id")} {customer.id}</p>
                          </div>
                          <div aria-hidden="true" />
                        </div>
                      </td>
                      <td className="px-6 py-5 align-middle text-sm font-semibold text-text">
                        <span className="table-cell-stack w-full">
                          <Phone className="table-cell-stack__icon h-4 w-4 text-text-muted" />
                          {customer.phone || t("customers.records.notSet")}
                        </span>
                      </td>
                      <td className="px-6 py-5 align-middle text-sm font-semibold text-text">
                        <span className="table-cell-stack w-full">
                          <Mail className="table-cell-stack__icon h-4 w-4 text-text-muted" />
                          {customer.email || t("customers.records.notSet")}
                        </span>
                      </td>
                      <td className="px-6 py-5 align-middle text-sm font-semibold text-text-muted">
                        <span className="table-cell-stack w-full">
                          <MapPin className="table-cell-stack__icon h-4 w-4 text-text-muted" />
                          {customer.address || t("customers.records.notSet")}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-black text-primary">
                        <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-primary/20 bg-primary/10 px-3 py-2">
                          <Sparkles className="h-4 w-4 text-primary" />
                          {Number(customer.loyalty_points ?? customer.available_points ?? 0).toLocaleString("ar-EG-u-nu-latn")}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-black text-emerald-100">
                        <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                          <Wallet className="h-4 w-4 text-emerald-300" />
                          {Number(customer.wallet_balance ?? customer.balance ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-6 py-5 align-middle">
                        <div className="flex flex-nowrap items-center justify-end gap-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenProfile(customer)}
                            className="inline-flex h-[var(--control-height-md)] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/20"
                          >
                            <FileText className="h-4 w-4" />
                            {tt("customers.statement.title")}
                          </button>
                          <button
                            type="button"
                            onClick={() => editCustomer(customer)}
                            className="inline-flex h-[var(--control-height-md)] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-primary/10 px-3 text-xs font-black text-primary transition hover:bg-primary/20"
                          >
                            <Pencil className="h-4 w-4" />
                            {t("customers.actions.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCustomer(customer.id)}
                            className="inline-flex h-[var(--control-height-md)] shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 transition hover:bg-rose-400/20"
                          >
                            <Trash2 className="h-4 w-4" />
                            {t("customers.actions.delete")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="px-6 py-14 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-card)] border border-border bg-surface text-text-muted">
                          <UsersRound className="h-7 w-7" />
                        </div>
                        <div>
                          <h3 className="m1-section-title text-text">{t("customers.empty.title")}</h3>
                          <p className="mt-1 text-sm text-text-muted">{t("customers.empty.description")}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <Pagination
            page={currentPage}
            pages={totalPages}
            total={totalCustomers}
            pageSize={pageSize}
            pageSizeOptions={CUSTOMER_PAGE_SIZE_OPTIONS}
            visible={visibleCount}
            disabled={loading}
            onChange={changePage}
            onPageSizeChange={changePageSize}
          />
        </section>
      </div>
      {importOpen ? (
        <CustomerImportModal
          file={importFile}
          setFile={(file) => {
            setImportFile(file);
            setImportPreview(null);
            setImportResult(null);
            setImportError("");
          }}
          preview={importPreview}
          result={importResult}
          pointsMode={importPointsMode}
          setPointsMode={(mode) => {
            setImportPointsMode(mode);
            setImportPreview(null);
            setImportResult(null);
            setImportError("");
          }}
          loading={importLoading}
          error={importError}
          onPreview={previewImport}
          onConfirm={confirmImport}
          onDownloadTemplate={downloadCustomerImportTemplate}
          onDownloadErrors={downloadImportErrors}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CustomerImportModal({
  file,
  setFile,
  preview,
  result,
  pointsMode,
  setPointsMode,
  loading,
  error,
  onPreview,
  onConfirm,
  onDownloadTemplate,
  onDownloadErrors,
  onClose,
}) {
  const summary = result?.summary || preview?.summary || null;
  const hasInvalidRows = Number(summary?.invalid_rows || summary?.skipped_invalid_count || 0) > 0;
  const importDone = Boolean(result);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" dir="rtl">
      <section className="w-full max-w-5xl overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-text shadow-2xl shadow-black/50">
        <div className="border-b border-border bg-surface p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-primary">{tt("customers.import.fromLegacy")}</div>
              <h2 className="m1-section-title mt-2">{tt("customers.import.customersAndPoints")}</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-text-muted">
                {tt("customers.import.hint")}
              </p>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-[var(--control-height-lg)] w-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted transition hover:bg-surface-hover">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-6">
          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[var(--radius-card)] border border-primary/15 bg-primary/5 p-5">
              <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-primary/30 bg-surface p-6 text-center transition hover:border-primary/60 hover:bg-primary/10">
                <UploadCloud className="h-10 w-10 text-primary" />
                <div className="mt-3 text-lg font-black">{file?.name || tt("customers.import.chooseFile")}</div>
                <div className="mt-2 text-sm font-semibold text-text-muted">{tt("customers.import.fileHint")}</div>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>

              <div className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm text-text-muted">
                <div className="font-black text-text">{tt("customers.import.knownColumns")}</div>
                <div className="mt-2 leading-7">
                  {tt("customers.import.columnList")}
                </div>
              </div>

              <div className="mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-4">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-primary" htmlFor="customer-import-points-mode">
                  {tt("customers.import.pointsMode")}
                </label>
                <select
                  id="customer-import-points-mode"
                  value={pointsMode}
                  onChange={(event) => setPointsMode(event.target.value)}
                  className={`${inputClass} mt-3`}
                >
                  <option value="replace">{tt("customers.import.replacePoints")}</option>
                  <option value="add">{tt("customers.import.addToPoints")}</option>
                </select>
                <p className="mt-2 text-xs font-semibold text-text-muted">
                  {tt("customers.import.pointsModeHint")}
                </p>
              </div>

              {error ? (
                <div className="mt-4 flex gap-3 rounded-[var(--radius-card)] border border-rose-300/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onPreview}
                  disabled={loading || !file}
                  className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-5 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  {loading && !summary ? tt("customers.import.scanning") : tt("customers.import.preview")}
                </button>
                <button
                  type="button"
                  onClick={onDownloadTemplate}
                  className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-primary/20 bg-surface px-5 text-sm font-black text-primary transition hover:bg-primary/10"
                >
                  <Download className="h-4 w-4" />
                  {tt("customers.import.downloadTemplate")}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={loading || !preview?.summary || importDone}
                  className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-5 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {loading && summary ? tt("customers.import.running") : importDone ? tt("customers.import.done") : tt("customers.import.confirm")}
                </button>
                <button
                  type="button"
                  onClick={onDownloadErrors}
                  disabled={!hasInvalidRows}
                  className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-5 text-sm font-black text-text transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download className="h-4 w-4" />
                  {tt("customers.import.downloadErrors")}
                </button>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">{tt("customers.import.previewTitle")}</div>
                  <h3 className="m1-section-title mt-1">{tt("customers.import.fileSummary")}</h3>
                </div>
                {importDone ? <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-100">{tt("customers.import.executed")}</span> : null}
              </div>

              {summary ? (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <ImportMetric label={tt("customers.import.pointsModeLabel")} value={pointsMode === "add" ? tt("customers.import.add") : tt("customers.import.replace")} tone="cyan" />
                  <ImportMetric label={tt("customers.import.totalRows")} value={summary.total_rows} />
                  <ImportMetric label={tt("customers.import.newCustomers")} value={summary.new_customers ?? summary.created_count} tone="emerald" />
                  <ImportMetric label={tt("customers.import.existingCustomers")} value={summary.existing_customers_matched ?? summary.updated_count} tone="cyan" />
                  <ImportMetric label={tt("customers.import.invalidRows")} value={summary.invalid_rows ?? summary.skipped_invalid_count} tone="rose" />
                  <ImportMetric label={tt("customers.import.duplicatePhones")} value={summary.duplicate_phones} tone="amber" />
                  <ImportMetric label={tt("customers.import.pointsToImport")} value={Number(summary.total_points_imported ?? summary.total_points_to_import ?? 0).toLocaleString("ar-EG-u-nu-latn")} tone="white" />
                </div>
              ) : (
                <div className="mt-5 rounded-[var(--radius-card)] border border-dashed border-border bg-surface p-8 text-center text-sm font-semibold text-text-muted">
                  {tt("customers.import.previewPrompt")}
                </div>
              )}

              {(preview?.invalid_rows || result?.invalid_rows)?.length ? (
                <div className="mt-5 max-h-48 overflow-y-auto rounded-[var(--radius-card)] border border-rose-300/15 bg-rose-500/5">
                  {(result?.invalid_rows || preview?.invalid_rows || []).slice(0, 8).map((row) => (
                    <div key={`${row.row_number}-${row.phone}`} className="border-b border-border px-4 py-3 text-sm last:border-b-0">
                      <div className="font-black text-rose-100">{tt("customers.import.rowNumber", { row: row.row_number })} {row.reason}</div>
                      <div className="mt-1 text-text-muted">{row.name || "-"} | {row.phone || "-"}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ImportMetric({ label, value, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    rose: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    white: "border-border bg-surface text-text",
    slate: "border-border bg-surface text-text",
  };
  return (
    <div className={`rounded-[var(--radius-card)] border p-4 ${tones[tone] || tones.slate}`}>
      <div className="text-[11px] font-black uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-2 text-2xl font-black tabular-nums">{value ?? 0}</div>
    </div>
  );
}

function CustomerProfileDrawer({
  customer,
  metrics,
  walletAudit,
  auditLoading,
  filters,
  setFilters,
  adjustment,
  setAdjustment,
  onClose,
  onAdjust,
  onExportStatement,
  canExportStatement,
}) {
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const walletBalance = Number(customer?.wallet_balance ?? customer?.balance ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <aside className="h-full w-full max-w-5xl overflow-y-auto border-l border-border bg-surface p-5 text-text shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-3 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{tt("customers.wallet.auditTitle")}</div>
            <h2 className="m1-section-title mt-2">{customer?.name || tt("customers.statement.customer")}</h2>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-text-muted">
              <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4 text-text-muted" />{customer?.phone || "-"}</span>
              <span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4 text-emerald-300" />{formatMoney(walletBalance)}</span>
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-text-muted" />{formatDateTime(metrics?.lastVisit || customer?.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onExportStatement}
              disabled={!canExportStatement}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              title={canExportStatement ? tt("customers.statement.title") : "Only admin/manager can export"}
            >
              <FileText className="h-4 w-4" />
              {tt("customers.statement.title")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[var(--control-height-lg)] w-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted transition hover:bg-surface-hover"
              aria-label={tt("common.close")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <section className="mt-5 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-emerald-100">
            <Filter className="h-4 w-4" />
            {tt("customers.wallet.movementFilters")}
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <AuditInput label={tt("customers.filters.fromDate")} type="date" value={filters.date_from} onChange={(value) => updateFilter("date_from", value)} />
            <AuditInput label={tt("customers.filters.toDate")} type="date" value={filters.date_to} onChange={(value) => updateFilter("date_to", value)} />
            
            <div className="md:col-span-3 xl:col-span-6">
              <div className="flex flex-wrap gap-2">
                {statementFilterOptions.map((option) => {
                  const active = String(filters.transaction_type || "") === option.value;
                  return (
                    <button
                      key={option.value || "all"}
                      type="button"
                      onClick={() => updateFilter("transaction_type", option.value)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${active ? getStatementBadgeClass(option.tone) : "border-border bg-surface-soft text-text hover:bg-surface-hover"}`}
                    >
                      <span>{tt(option.labelKey)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <AuditInput label={tt("customers.filters.invoiceNumber")} value={filters.invoice_number} onChange={(value) => updateFilter("invoice_number", value)} />
            <AuditInput label={tt("customers.filters.minAmount")} type="number" value={filters.amount_min} onChange={(value) => updateFilter("amount_min", value)} />
            <AuditInput label={tt("customers.filters.maxAmount")} type="number" value={filters.amount_max} onChange={(value) => updateFilter("amount_max", value)} />
          </div>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-emerald-100">
            <PlusCircle className="h-4 w-4" />
            {tt("customers.wallet.manualAdjustment")}
          </div>
          <form onSubmit={onAdjust} className="grid gap-3 md:grid-cols-[180px_160px_minmax(0,1fr)_120px]">
            <select value={adjustment.type} onChange={(event) => setAdjustment((current) => ({ ...current, type: event.target.value }))} className={inputClass}>
              <option value="manual_add">{tt("customers.statement.manualCredit")}</option>
              <option value="manual_deduct">{tt("customers.statement.manualDebit")}</option>
            </select>
            <input type="number" min="0.01" step="0.01" required value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} placeholder={tt("customers.common.amount")} className={inputClass} />
            <input required value={adjustment.notes} onChange={(event) => setAdjustment((current) => ({ ...current, notes: event.target.value }))} placeholder={tt("customers.wallet.adjustmentReason")} className={inputClass} />
            <button type="submit" className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)]">{tt("customers.common.save")}</button>
          </form>
        </section>

        <section className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          <div className="border-b border-border px-4 py-3 text-sm font-black text-text">{tt("customers.wallet.auditLog")}</div>
          <div className="divide-y divide-border">
            {auditLoading ? (
              <div className="px-4 py-8 text-center text-sm font-bold text-emerald-300">{tt("customers.common.loading")}</div>
            ) : walletAudit.length ? (
              walletAudit.map((item) => <TimelineItem key={item.id} item={item} />)
            ) : (
              <div className="px-4 py-8 text-center text-sm text-text-muted">{tt("customers.wallet.noMatches")}</div>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}

function AuditInput({ label, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClass} mt-2`} />
    </label>
  );
}

function TimelineItem({ item }) {
  const amount = Number(item.amount || 0);
  const positive = amount >= 0;
  return (
    <article className="grid gap-3 px-4 py-4 lg:grid-cols-[180px_minmax(0,1fr)_190px]">
      <div>
        <div className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${positive ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>
          {item.transaction_type_label || item.transaction_type}
        </div>
        <div className="mt-2 text-xs text-text-muted">{formatDateTime(item.created_at)}</div>
      </div>
      <div className="min-w-0">
        <div className={`text-lg font-black ${positive ? "text-emerald-200" : "text-rose-200"}`}>{positive ? "+" : ""}{formatMoney(amount)}</div>
        <div className="mt-2 grid gap-2 text-xs text-text-muted sm:grid-cols-3">
          <span>{tt("customers.wallet.before")} {formatMoney(item.before_balance)}</span>
          <span>{tt("customers.wallet.after")} {formatMoney(item.after_balance)}</span>
          <span>{tt("customers.wallet.reference")} {item.invoice_number || item.return_number || item.reference_id || "-"}</span>
        </div>
        {item.notes ? <div className="mt-2 text-sm text-text-muted">{item.notes}</div> : null}
      </div>
      <div className="text-sm text-text-muted lg:text-left">
        <div>{tt("customers.wallet.by")} {item.created_by_name || item.created_by || "-"}</div>
        <div className="mt-1 text-xs text-text-muted">{item.reference_type || "-"}</div>
      </div>
    </article>
  );
}

function PreferenceChips({ title, items = [], tone = "emerald", ltr = false }) {
  if (!items.length) return null;
  const tones = {
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    cyan: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
  };
  return (
    <div>
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-text-muted">{title}</div>
      <div className="mt-2 flex flex-wrap gap-2" dir={ltr ? "ltr" : "rtl"}>
        {items.map((item) => (
          <span key={item.value} className={`rounded-full border px-3 py-1.5 text-xs font-black ${tones[tone] || tones.emerald}`}>
            {item.value}{Number(item.count || 0) > 0 ? ` · ${Number(item.count)}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function CustomerStatementDrawer({
  customer,
  metrics,
  statement,
  walletAudit,
  auditLoading,
  statementError,
  filters,
  setFilters,
  adjustment,
  setAdjustment,
  payment,
  setPayment,
  paymentSaving,
  onClose,
  onAdjust,
  onPayment,
  onExportStatement,
  canExportStatement,
  onViewOrder,
  onEditOrder,
}) {
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const submitPayment = async (event) => {
    const saved = await onPayment(event);
    if (saved) setPaymentDialogOpen(false);
  };
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const statementRows = Array.isArray(statement?.rows) ? statement.rows : walletAudit;
  const totals = getStatementTotals({ rows: statementRows, totals: statement?.totals });
  const customerName = customer?.name || statement?.customer?.name || tt("customers.statement.customer");
  const customerPhone = customer?.phone || statement?.customer?.phone || "-";
  const currentBalance = Number(statement?.current_balance ?? customer?.wallet_balance ?? customer?.balance ?? 0);
  const loyaltyPoints = Number(customer?.loyalty_points ?? customer?.available_points ?? statement?.customer?.loyalty_points ?? 0);
  const openingBalance = Number(statement?.opening_balance ?? 0);
  const finalBalance = Number(statement?.final_balance ?? currentBalance);
  const lastUpdated =
    statement?.filters?.date_to ||
    statement?.filters?.date_from ||
    metrics?.lastVisit ||
    customer?.updated_at ||
    customer?.created_at;
  const purchasePreferences = customer?.purchase_preferences || {};
  const preferredDepartments = Array.isArray(purchasePreferences.departments) ? purchasePreferences.departments : [];
  const preferredCategories = Array.isArray(purchasePreferences.categories) ? purchasePreferences.categories : [];
  const preferredSizes = Array.isArray(purchasePreferences.sizeBreakdown) ? purchasePreferences.sizeBreakdown : [];

  return (
    <div className="m1-customers-page min-h-screen bg-background px-4 py-6 text-text sm:px-6" dir="rtl">
      <main className="mx-auto w-full max-w-[1500px] rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:p-7">
        <div className="flex flex-col gap-3 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{tt("customers.statement.title")}</div>
            <h2 className="m1-section-title mt-2">{customerName}</h2>
            <div className="mt-3 grid gap-2 text-sm text-text-muted sm:grid-cols-2 xl:grid-cols-4">
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface-soft px-3 py-2">
                <Phone className="h-4 w-4 text-text-muted" />
                {customerPhone}
              </span>
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2">
                <Wallet className="h-4 w-4 text-emerald-300" />
                {formatMoney(currentBalance)}
              </span>
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-primary/20 bg-primary/10 px-3 py-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {loyaltyPoints.toLocaleString("ar-EG-u-nu-latn")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-[var(--radius-card)] border border-border bg-surface-soft px-3 py-2">
                <CalendarDays className="h-4 w-4 text-text-muted" />
                {formatDateTime(lastUpdated)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPaymentDialogOpen(true)}
              disabled={currentBalance <= 0}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-amber-400 px-4 text-sm font-black text-text transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wallet className="h-4 w-4" />
              {tt("customers.payment.record")}
            </button>
            <button
              type="button"
              onClick={onExportStatement}
              disabled={!canExportStatement}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              title={canExportStatement ? tt("customers.statement.printOrPdf") : "Only admin/manager can export"}
            >
              <FileText className="h-4 w-4" />
              {tt("customers.statement.printOrPdf")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 text-sm font-black text-text transition hover:bg-surface-hover"
              aria-label={tt("customers.statement.backToCustomers")}
            >
              <ArrowRight className="h-5 w-5" />
              {tt("customers.statement.backToCustomers")}
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{tt("customers.statement.openingBalance")}</div>
            <div className="mt-2 text-xl font-black text-text">{formatMoney(openingBalance)} ج.م</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-amber-300/20 bg-amber-400/[0.08] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-200/70">{tt("customers.statement.totalDue")}</div>
            <div className="mt-2 text-xl font-black text-amber-100">{formatMoney(totals.credit)} ج.م</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-primary/20 bg-primary/[0.08] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary/70">{tt("customers.statement.totalPayments")}</div>
            <div className="mt-2 text-xl font-black text-primary">{formatMoney(totals.debit)} ج.م</div>
          </div>
          <div className={`rounded-[var(--radius-card)] border p-4 ${currentBalance > 0 ? "border-rose-300/25 bg-rose-400/[0.09]" : "border-emerald-300/20 bg-emerald-400/[0.08]"}`}>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{tt("customers.statement.outstanding")}</div>
            <div className={`mt-2 text-2xl font-black ${currentBalance > 0 ? "text-rose-100" : "text-emerald-100"}`}>{formatMoney(currentBalance)} ج.م</div>
          </div>
        </div>

        {(preferredDepartments.length || preferredCategories.length || preferredSizes.length) ? (
          <section className="mt-5 rounded-[var(--radius-card)] border border-emerald-300/20 bg-emerald-400/[0.06] p-4">
            <div className="flex items-center gap-2 text-sm font-black text-emerald-100">
              <Sparkles className="h-4 w-4" />
              {tt("customers.preferences.title")}
            </div>
            <p className="mt-1 text-xs font-semibold text-text-muted">{tt("customers.preferences.hint")}</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <PreferenceChips title={tt("customers.preferences.sections")} items={preferredDepartments} tone="emerald" />
              <PreferenceChips title={tt("customers.preferences.categories")} items={preferredCategories} tone="cyan" />
              <PreferenceChips title={tt("customers.preferences.sizes")} items={preferredSizes} tone="amber" ltr />
            </div>
          </section>
        ) : null}

        {paymentDialogOpen ? (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-payment-dialog-title"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setPaymentDialogOpen(false);
            }}
          >
            <section className="w-full max-w-3xl overflow-hidden rounded-[var(--radius-card)] border border-emerald-300/25 bg-surface shadow-2xl shadow-black/50">
              <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div>
                  <div id="customer-payment-dialog-title" className="flex items-center gap-2 text-lg font-black text-text">
                    <Wallet className="h-5 w-5 text-emerald-300" />
                    {tt("customers.payment.title")}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-text-muted">{tt("customers.payment.hint")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentDialogOpen(false)}
                  className="inline-flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft text-text-muted transition hover:bg-surface-hover hover:text-text"
                  aria-label={tt("customers.payment.close")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mx-5 mt-5 rounded-[var(--radius-card)] border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100">
                المستحق الآن: {formatMoney(currentBalance)} ج.م
              </div>
              <form onSubmit={submitPayment} className="grid gap-3 p-5 md:grid-cols-2">
                <input
                  type="number"
                  min="0.01"
                  max={Math.max(0, currentBalance)}
                  step="0.01"
                  required
                  value={payment.amount}
                  onChange={(event) => setPayment((current) => ({ ...current, amount: event.target.value }))}
                  placeholder={tt("customers.payment.amount")}
                  className={inputClass}
                  autoFocus
                />
                <select value={payment.payment_method} onChange={(event) => setPayment((current) => ({ ...current, payment_method: event.target.value }))} className={inputClass}>
                  <option value="cash">{tt("customers.payment.cash")}</option>
                  <option value="card">{tt("customers.payment.card")}</option>
                  <option value="bank_transfer">{tt("customers.payment.bankTransfer")}</option>
                  <option value="instapay">InstaPay</option>
                  <option value="vodafone_cash">Vodafone Cash</option>
                </select>
                <input type="date" required value={payment.payment_date} onChange={(event) => setPayment((current) => ({ ...current, payment_date: event.target.value }))} className={inputClass} />
                <input value={payment.reference} onChange={(event) => setPayment((current) => ({ ...current, reference: event.target.value }))} placeholder={tt("customers.payment.reference")} className={inputClass} />
                <input value={payment.notes} onChange={(event) => setPayment((current) => ({ ...current, notes: event.target.value }))} placeholder={tt("customers.payment.notes")} className={`${inputClass} md:col-span-2`} />
                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end md:col-span-2">
                  <button
                    type="button"
                    onClick={() => setPaymentDialogOpen(false)}
                    className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft px-5 text-sm font-black text-text transition hover:bg-surface-hover"
                  >
                    {tt("customers.common.cancel")}
                  </button>
                  <button type="submit" disabled={paymentSaving || currentBalance <= 0} className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-6 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-40">
                    {paymentSaving ? tt("customers.common.saving") : tt("customers.payment.submit")}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        <section className="mt-5 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-emerald-100">
            <Filter className="h-4 w-4" />
            {tt("customers.statement.filter")}
          </div>
          <div className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <AuditInput label={tt("customers.filters.fromDate")} type="date" value={filters.date_from} onChange={(value) => updateFilter("date_from", value)} />
              <AuditInput label={tt("customers.filters.toDate")} type="date" value={filters.date_to} onChange={(value) => updateFilter("date_to", value)} />
              <AuditInput label={tt("customers.filters.invoiceNumber")} value={filters.invoice_number} onChange={(value) => updateFilter("invoice_number", value)} />
              <AuditInput label={tt("customers.filters.minAmount")} type="number" value={filters.amount_min} onChange={(value) => updateFilter("amount_min", value)} />
              <AuditInput label={tt("customers.filters.maxAmount")} type="number" value={filters.amount_max} onChange={(value) => updateFilter("amount_max", value)} />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {statementFilterOptions.map((option) => {
                const active = String(filters.transaction_type || "") === option.value;
                return (
                  <button
                    key={option.value || "all"}
                    type="button"
                    onClick={() => updateFilter("transaction_type", option.value)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${active ? getStatementBadgeClass(option.tone) : "border-border bg-surface-soft text-text hover:bg-surface-hover"}`}
                  >
                    <span>{tt(option.labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="mt-5 rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-emerald-100">
            <PlusCircle className="h-4 w-4" />
            {tt("customers.statement.manualSettlement")}
          </div>
          <form onSubmit={onAdjust} className="grid gap-3 md:grid-cols-[180px_160px_minmax(0,1fr)_120px]">
            <select value={adjustment.type} onChange={(event) => setAdjustment((current) => ({ ...current, type: event.target.value }))} className={inputClass}>
              <option value="manual_add">{tt("customers.statement.manualCredit")}</option>
              <option value="manual_deduct">{tt("customers.statement.manualDebit")}</option>
            </select>
            <input type="number" min="0.01" step="0.01" required value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} placeholder={tt("customers.common.amount")} className={inputClass} />
            <input required value={adjustment.notes} onChange={(event) => setAdjustment((current) => ({ ...current, notes: event.target.value }))} placeholder={tt("customers.wallet.adjustmentReason")} className={inputClass} />
            <button type="submit" className="inline-flex h-[var(--control-height-lg)] items-center justify-center rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)]">{tt("customers.common.save")}</button>
          </form>
        </section>

        <section className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-soft">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-black text-text">{tt("customers.statement.tableTitle")}</div>
              <div className="mt-1 text-xs font-semibold text-text-muted">{statementRows.length.toLocaleString("ar-EG-u-nu-latn")} حركة مسجلة</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-black">
              <span className="inline-flex items-center gap-2 rounded-full border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-rose-100">
                <span className="h-2 w-2 rounded-full bg-rose-400" />
                {tt("customers.statement.debitHint")}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 text-emerald-100">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                {tt("customers.statement.creditHint")}
              </span>
            </div>
          </div>
          {statementError ? (
            <div className="m-4 rounded-[var(--radius-card)] border border-rose-300/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">
              {statementError}
            </div>
          ) : null}
          <div className="m1-table-container overflow-x-auto">
            <table className="m1-table m1-table--compact w-full min-w-[1180px] text-sm">
              <thead className="sticky top-0 z-10 bg-surface backdrop-blur-xl">
                <tr className="border-b border-border text-right text-xs font-black text-text-muted">
                  <th className="w-[150px] border-b border-l border-border px-5 py-4 text-center">
                    <span className="text-emerald-200">{tt("customers.statement.creditColumn")}</span>
                    <span className="mt-1 block text-[10px] font-semibold text-text-muted">{tt("customers.statement.paymentFromCustomer")}</span>
                  </th>
                  <th className="w-[150px] border-b border-l border-border px-5 py-4 text-center">
                    <span className="text-rose-200">{tt("customers.statement.debitColumn")}</span>
                    <span className="mt-1 block text-[10px] font-semibold text-text-muted">{tt("customers.statement.owedByCustomer")}</span>
                  </th>
                  <th className="w-[160px] border-b border-l border-border px-5 py-4 text-center">{tt("customers.statement.balance")}</th>
                  <th className="min-w-[330px] border-b border-l border-border px-5 py-4">{tt("customers.statement.description")}</th>
                  <th className="w-[150px] border-b border-l border-border px-5 py-4">{tt("customers.statement.date")}</th>
                  <th className="w-[210px] border-b border-border px-5 py-4 text-center">{tt("customers.common.details")}</th>
                </tr>
              </thead>
              <tbody>
                {auditLoading ? (
                  <tr>
                    <td colSpan="7" className="px-3 py-10 text-center text-sm font-bold text-emerald-300">{tt("customers.statement.loading")}</td>
                  </tr>
                ) : statementRows.length ? (
                  statementRows.map((row, index) => {
                    const amount = Number(row.amount || 0);
                    const personalValue = Number(row.personal_value || row.total_amount || 0);
                    const debit = amount > 0 ? formatMoney(amount) : "";
                    const credit = amount < 0 ? formatMoney(Math.abs(amount)) : "";
                    const reference = row.invoice_number || row.return_number || row.reference_id || "-";
                    const rowMeta = getStatementMovementMeta(row);
                    const rowLabel = row.personal_operation_type_label || row.transaction_type_label || row.notes || row.transaction_type || "-";
                    const rowDetails = [
                      personalValue > 0 ? `القيمة: ${formatMoney(personalValue)}` : "",
                      row.notes ? `ملاحظة: ${row.notes}` : "",
                    ].filter(Boolean).join(" • ");
                    const showMovementBadge = String(rowMeta.label || "").trim() !== String(rowLabel || "").trim();
                    return (
                      <tr key={row.id || `${row.created_at || "row"}-${index}`} className="align-middle text-text transition odd:bg-surface-soft hover:bg-surface-hover">
                        <td className="border-b border-l border-border px-5 py-4 text-center">
                          {credit ? (
                            <span className="inline-flex min-w-[105px] justify-center rounded-[var(--radius-control)] border border-emerald-300/20 bg-emerald-400/10 px-3 py-2 font-black tabular-nums text-emerald-100">
                              {credit}
                            </span>
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="border-b border-l border-border px-5 py-4 text-center">
                          {debit ? (
                            <span className="inline-flex min-w-[105px] justify-center rounded-[var(--radius-control)] border border-rose-300/20 bg-rose-400/10 px-3 py-2 font-black tabular-nums text-rose-100">
                              {debit}
                            </span>
                          ) : <span className="text-text-muted">—</span>}
                        </td>
                        <td className="border-b border-l border-border px-5 py-4 text-center">
                          <span className="inline-flex min-w-[115px] justify-center rounded-[var(--radius-control)] border border-primary/15 bg-primary/[0.07] px-3 py-2 font-black tabular-nums text-primary">
                            {formatMoney(row.after_balance)}
                          </span>
                        </td>
                        <td className="border-b border-l border-border px-5 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-black text-text">{rowLabel}</div>
                            {showMovementBadge ? (
                              <div className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black ${getStatementBadgeClass(rowMeta.tone)}`}>
                                {rowMeta.label}
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-2 inline-flex rounded-[var(--radius-control)] border border-border bg-black/20 px-2.5 py-1 font-black text-text" dir="ltr">{reference}</div>
                          {rowDetails ? <div className="mt-2 max-w-xl text-xs leading-5 text-text-muted">{rowDetails}</div> : null}
                        </td>
                        <td className="border-b border-l border-border px-5 py-4">
                          <div className="whitespace-nowrap text-xs font-black text-text">{formatDateTime(row.created_at)}</div>
                          <div className="mt-1 text-[10px] font-bold text-text-muted">{tt("customers.statement.movementNumber", { index: index + 1 })}</div>
                        </td>
                        <td className="border-b border-border px-5 py-4">
                          {row.order_id ? (
                            <div className="grid gap-2">
                              <button
                                type="button"
                                onClick={() => onViewOrder?.(row.order_id)}
                                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 px-3 py-2 text-[11px] font-black text-primary transition hover:bg-primary/20"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                {tt("customers.statement.viewInvoice")}
                              </button>
                              <button
                                type="button"
                                onClick={() => onEditOrder?.(row.order_id)}
                                className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[11px] font-black text-amber-100 transition hover:bg-amber-400/20"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {tt("customers.statement.editInvoice")}
                              </button>
                            </div>
                          ) : <span className="block text-center text-xs font-semibold text-text-muted">{tt("customers.statement.movementWithoutInvoice")}</span>}
                          {row.personal_operation_type ? (
                            <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.16em] ${getStatementBadgeClass(rowMeta.tone)}`}>
                              {row.personal_operation_type_label || row.personal_operation_type}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="7" className="px-3 py-10 text-center text-sm text-text-muted">{tt("customers.statement.noCurrentMatches")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[var(--radius-card)] border border-emerald-300/15 bg-emerald-400/[0.06] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-200/70">{tt("customers.statement.totalPayments")}</div>
            <div className="mt-2 text-2xl font-black text-emerald-100">{formatMoney(totals.debit)}</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-rose-300/15 bg-rose-400/[0.06] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-rose-200/70">{tt("customers.statement.totalDue")}</div>
            <div className="mt-2 text-2xl font-black text-rose-100">{formatMoney(totals.credit)}</div>
          </div>
          <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">{tt("customers.statement.outstanding")}</div>
            <div className="mt-2 text-2xl font-black text-primary">{formatMoney(finalBalance)}</div>
            <div className="mt-1 text-xs font-semibold text-text-muted">{tt("customers.statement.openingBalance")}: {formatMoney(openingBalance)}</div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Customers;



import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, Download, FileText, Filter, Mail, MapPin, Pencil, Phone, PlusCircle, Sparkles, Trash2, UploadCloud, UserRound, UsersRound, Wallet, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import { getCurrentUser } from "../../../shared/auth/authStorage";

const DEFAULT_CUSTOMERS_PAGE_SIZE = 50;
const CUSTOMER_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const inputClass =
  "h-12 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-400/50 focus:bg-slate-950";

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

const buildPageWindow = (page, totalPages) => {
  const safeTotal = Math.max(1, totalPages || 1);
  if (safeTotal <= 5) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  const pages = new Set([1, safeTotal, page - 1, page, page + 1]);
  if (page <= 2) {
    pages.add(2);
    pages.add(3);
  }
  if (page >= safeTotal - 1) {
    pages.add(safeTotal - 1);
    pages.add(safeTotal - 2);
  }

  return Array.from(pages)
    .filter((value) => value >= 1 && value <= safeTotal)
    .sort((a, b) => a - b);
};

const walletTypeOptions = [
  { value: "", label: "كل الحركات" },
  { value: "order_payment", label: "دفع من المحفظة" },
  { value: "refund", label: "استرداد إلى المحفظة" },
  { value: "exchange_credit", label: "رصيد استبدال" },
  { value: "loyalty_conversion", label: "رصيد ولاء" },
  { value: "manual_add", label: "إضافة يدوية" },
  { value: "manual_deduct", label: "خصم يدوي" },
];

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

const isAdminOrManager = (user = getCurrentUser()) => {
  const role = String(user?.role_name || user?.role || "admin").trim().toLowerCase().replace(/[_-]+/g, " ");
  return ["admin", "super admin", "superadmin", "manager"].includes(role);
};

function Customers() {
  const { t } = useTranslation();
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
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [profile, setProfile] = useState(null);
  const [walletAudit, setWalletAudit] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [filters, setFilters] = useState({
    date_from: "",
    date_to: "",
    transaction_type: "",
    invoice_number: "",
    amount_min: "",
    amount_max: "",
  });
  const [adjustment, setAdjustment] = useState({ type: "manual_add", amount: "", notes: "" });
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
  const pageStart = visibleCount ? (currentPage - 1) * pageSize + 1 : 0;
  const pageEnd = visibleCount ? pageStart + visibleCount - 1 : 0;
  const pageWindow = useMemo(() => buildPageWindow(currentPage, totalPages), [currentPage, totalPages]);

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

  const fetchWalletAudit = useCallback(async () => {
    if (!selectedCustomer?.id) return;
    try {
      setAuditLoading(true);
      const response = await api.get(`/customers/${selectedCustomer.id}/wallet/audit${buildFilterQuery()}`);
      setWalletAudit(Array.isArray(response?.data) ? response.data : []);
    } catch (error) {
      console.error("[customers] failed to load wallet audit:", error);
      setWalletAudit([]);
    } finally {
      setAuditLoading(false);
    }
  }, [buildFilterQuery, selectedCustomer?.id]);

  useEffect(() => {
    fetchWalletAudit();
  }, [fetchWalletAudit]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const handleOpenProfile = (customer) => {
    setWalletAudit([]);
    setProfile(null);
    fetchCustomerProfile(customer);
  };

  const handleManualAdjustment = async (event) => {
    event.preventDefault();
    if (!selectedCustomer?.id) return;
    const notes = String(adjustment.notes || "").trim();
    if (!notes) {
      window.alert("يجب إدخال سبب/ملاحظات للتعديل اليدوي.");
      return;
    }
    try {
      await api.post(`/customers/${selectedCustomer.id}/wallet/adjust`, {
        transaction_type: adjustment.type,
        amount: Number(adjustment.amount || 0),
        notes,
      });
      setAdjustment({ type: "manual_add", amount: "", notes: "" });
      await Promise.all([fetchCustomers(), fetchCustomerProfile(selectedCustomer), fetchWalletAudit()]);
    } catch (error) {
      console.error("[customers] failed to adjust wallet:", error);
      window.alert(error?.message || "تعذر تعديل المحفظة");
    }
  };

  const handleExportStatement = async () => {
    if (!selectedCustomer?.id || !canExportStatement) return;
    try {
      const response = await api.get(`/customers/${selectedCustomer.id}/statement${buildFilterQuery()}`);
      const statement = response?.data;
      const [jspdfModule, autoTableModule] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
      const JsPDF = jspdfModule.jsPDF || jspdfModule.default || jspdfModule;
      const autoTable = autoTableModule.default || autoTableModule.autoTable || autoTableModule;
      const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const rows = Array.isArray(statement?.rows) ? statement.rows : [];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text("كشف حساب العميل", 200, 16, { align: "right" });
      doc.setFontSize(10);
      doc.text(`العميل: ${statement?.customer?.name || selectedCustomer.name || ""}`, 200, 25, { align: "right" });
      doc.text(`الهاتف: ${statement?.customer?.phone || selectedCustomer.phone || ""}`, 200, 31, { align: "right" });
      doc.text(`الرصيد الافتتاحي: ${formatMoney(statement?.opening_balance)}`, 200, 39, { align: "right" });
      doc.text(`الرصيد النهائي: ${formatMoney(statement?.final_balance)}`, 200, 45, { align: "right" });
      autoTable(doc, {
        startY: 52,
        head: [["التاريخ", "النوع", "المبلغ", "قبل", "بعد", "المرجع", "المستخدم", "ملاحظات"]],
        body: rows.map((row) => [
          formatDateTime(row.created_at),
          row.transaction_type_label || row.transaction_type,
          formatMoney(row.amount),
          formatMoney(row.before_balance),
          formatMoney(row.after_balance),
          row.invoice_number || row.return_number || row.reference_id || "-",
          row.created_by_name || "-",
          row.notes || "-",
        ]),
        styles: { font: "helvetica", fontSize: 8, halign: "right" },
        headStyles: { fillColor: [5, 150, 105], textColor: 255, halign: "right" },
      });
      const y = (doc.lastAutoTable?.finalY || 52) + 8;
      doc.setFont("helvetica", "bold");
      doc.text(`الطلبات: ${formatMoney(statement?.totals?.orders)}`, 200, y, { align: "right" });
      doc.text(`المرتجعات: ${formatMoney(statement?.totals?.returns)}`, 200, y + 6, { align: "right" });
      doc.text(`أرصدة المحفظة: ${formatMoney(statement?.totals?.wallet_credits)}`, 200, y + 12, { align: "right" });
      doc.text(`مدفوعات المحفظة: ${formatMoney(statement?.totals?.wallet_payments)}`, 200, y + 18, { align: "right" });
      doc.text(`التعديلات اليدوية: ${formatMoney(statement?.totals?.manual_adjustments)}`, 200, y + 24, { align: "right" });
      doc.text(`مطابقة الرصيد الحالي: ${formatMoney(statement?.current_balance)}`, 200, y + 30, { align: "right" });
      doc.save(`customer-statement-${selectedCustomer.id}.pdf`);
    } catch (error) {
      console.error("[customers] failed to export statement:", error);
      window.alert(error?.message || "تعذر تصدير كشف الحساب");
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const resetForm = () => {
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setEditingId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const customerData = { name, phone, email, address };

      if (editingId) {
        await api.put(`/customers/${editingId}`, customerData);
      } else {
        await api.post("/customers", customerData);
      }

      resetForm();
      fetchCustomers({ page: currentPage });
    } catch (error) {
      console.error("[customers] failed to save customer:", error);
    }
  };

  const editCustomer = (customer) => {
    setEditingId(customer.id);
    setName(customer.name || "");
    setPhone(customer.phone || "");
    setEmail(customer.email || "");
    setAddress(customer.address || "");
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
      setImportError("اختار ملف Excel أو CSV أولاً.");
      return;
    }
    try {
      setImportLoading(true);
      setImportError("");
      setImportResult(null);
      const response = await api.post("/customers/import/preview", formData, { timeoutMs: 60000 });
      setImportPreview(response);
    } catch (error) {
      setImportError(error?.message || "تعذر تجهيز معاينة الاستيراد.");
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
      setImportError(error?.message || "تعذر تنفيذ الاستيراد.");
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.08),transparent_34%),linear-gradient(180deg,#09090b_0%,#111827_100%)] px-6 py-6 text-white">
      <div className="w-full space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-950/75 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">{t("customers.eyebrow")}</div>
            <h1 className="mt-2 text-4xl font-black text-white lg:text-5xl">{t("customers.title")}</h1>
            <p className="mt-3 text-sm font-medium text-zinc-400">
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
              className="inline-flex h-14 items-center justify-center gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-5 text-sm font-black text-cyan-100 shadow-2xl shadow-cyan-950/20 transition hover:bg-cyan-400/20"
            >
              <UploadCloud className="h-5 w-5" />
              استيراد العملاء
            </button>
            <div className="inline-flex items-center gap-3 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 shadow-2xl shadow-emerald-950/20">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
                <UsersRound className="h-6 w-6" />
              </div>
              <div>
                <div className="text-3xl font-black text-white">{totalCustomers.toLocaleString("ar-EG-u-nu-latn")}</div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">{t("customers.count")}</div>
              </div>
            </div>
          </div>
        </div>

        <section className="rounded-3xl border border-white/10 bg-slate-900/45 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
          <label className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500" htmlFor="customer-search">
            {t("customers.search")}
          </label>
          <input
            id="customer-search"
            type="text"
            placeholder={t("customers.searchPlaceholder")}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPagination((current) => ({ ...current, page: 1 }));
            }}
            className={`${inputClass} mt-3`}
          />
        </section>

        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-white/10 bg-slate-900/45 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl"
        >
          <div className="mb-5 flex flex-col gap-1">
            <h2 className="text-xl font-black text-white">{editingId ? t("customers.form.titleUpdate") : t("customers.form.titleAdd")}</h2>
            <p className="text-sm text-zinc-500">{t("customers.form.subtitle")}</p>
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

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="submit"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-emerald-400 px-5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-300"
            >
              {editingId ? t("customers.form.submitUpdate") : t("customers.form.submitAdd")}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-white/10 bg-slate-800/70 px-5 text-sm font-bold text-zinc-300 transition hover:bg-slate-700/80 hover:text-white"
              >
                {t("customers.form.cancel")}
              </button>
            ) : null}
          </div>
        </form>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 shadow-2xl shadow-black/30 backdrop-blur-xl">
          <div className="border-b border-white/10 px-6 py-5">
            <h2 className="text-lg font-black text-white">{t("customers.table.title")}</h2>
            <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <p className="text-sm text-zinc-500">
                {pageStart && pageEnd
                  ? `Showing ${pageStart}-${pageEnd} of ${totalCustomers.toLocaleString("en-US")} customers`
                  : `Showing 0 of ${totalCustomers.toLocaleString("en-US")} customers`}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
                <span>{visibleCount.toLocaleString("en-US")} visible on this page</span>
                <label className="flex items-center gap-2">
                  <span>Per page</span>
                  <select
                    value={pageSize}
                    onChange={(event) => changePageSize(event.target.value)}
                    className="h-10 rounded-xl border border-white/10 bg-slate-900/80 px-3 text-sm font-semibold text-white outline-none transition focus:border-emerald-400/50"
                  >
                    {CUSTOMER_PAGE_SIZE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px]">
              <thead className="border-b border-white/10 bg-slate-900/80 text-left text-xs font-black uppercase tracking-[0.18em] text-zinc-400">
                <tr>
                  <th className="px-6 py-5">{t("customers.table.customer")}</th>
                  <th className="px-6 py-5">{t("customers.table.phone")}</th>
                  <th className="px-6 py-5">{t("customers.table.email")}</th>
                  <th className="px-6 py-5">{t("customers.table.address")}</th>
                  <th className="px-6 py-5">نقاط الولاء</th>
                  <th className="px-6 py-5">رصيد المحفظة</th>
                  <th className="px-6 py-5 text-right">{t("customers.table.actions")}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/10">
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
                      className={`transition hover:bg-emerald-400/10 ${
                        index % 2 === 0 ? "bg-slate-900/35" : "bg-slate-950/30"
                      }`}
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/15 text-emerald-200 shadow-lg shadow-emerald-950/20">
                            <UserRound className="h-6 w-6" />
                          </div>
                          <div>
                            <h3 className="text-base font-black text-white">{customer.name || t("customers.records.unnamed")}</h3>
                            <p className="text-xs font-medium text-zinc-500">{t("customers.records.id")} {customer.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-sm font-semibold text-zinc-200">
                        <span className="inline-flex items-center gap-2">
                          <Phone className="h-4 w-4 text-zinc-500" />
                          {customer.phone || t("customers.records.notSet")}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-semibold text-zinc-200">
                        <span className="inline-flex items-center gap-2">
                          <Mail className="h-4 w-4 text-zinc-500" />
                          {customer.email || t("customers.records.notSet")}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-semibold text-zinc-300">
                        <span className="inline-flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-zinc-500" />
                          {customer.address || t("customers.records.notSet")}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-black text-cyan-100">
                        <span className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-3 py-2">
                          <Sparkles className="h-4 w-4 text-cyan-200" />
                          {Number(customer.loyalty_points ?? customer.available_points ?? 0).toLocaleString("ar-EG-u-nu-latn")}
                        </span>
                      </td>
                      <td className="px-6 py-5 text-sm font-black text-emerald-100">
                        <span className="inline-flex items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                          <Wallet className="h-4 w-4 text-emerald-300" />
                          {Number(customer.wallet_balance ?? customer.balance ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenProfile(customer)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-300/20 bg-emerald-400/10 px-3 text-xs font-black text-emerald-100 transition hover:bg-emerald-400/20"
                          >
                            <FileText className="h-4 w-4" />
                            كشف حساب العميل
                          </button>
                          <button
                            type="button"
                            onClick={() => editCustomer(customer)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-sky-300/20 bg-sky-400/10 px-3 text-xs font-black text-sky-100 transition hover:bg-sky-400/20"
                          >
                            <Pencil className="h-4 w-4" />
                            {t("customers.actions.edit")}
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteCustomer(customer.id)}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 transition hover:bg-rose-400/20"
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
                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/70 text-zinc-300">
                          <UsersRound className="h-7 w-7" />
                        </div>
                        <div>
                          <h3 className="text-lg font-black text-white">{t("customers.empty.title")}</h3>
                          <p className="mt-1 text-sm text-zinc-500">{t("customers.empty.description")}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-slate-900/45 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">
          <div className="text-sm text-zinc-400">
            Page {currentPage.toLocaleString("en-US")} of {totalPages.toLocaleString("en-US")}
            {pagination.hasMore ? " | More customers available" : ""}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => changePage(currentPage - 1)}
              disabled={currentPage <= 1 || loading}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-slate-950/70 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            {pageWindow.map((pageNumber, index) => {
              const previous = pageWindow[index - 1];
              const showGap = previous && pageNumber - previous > 1;
              return (
                <div key={pageNumber} className="flex items-center gap-2">
                  {showGap ? <span className="px-1 text-zinc-500">...</span> : null}
                  <button
                    type="button"
                    onClick={() => changePage(pageNumber)}
                    disabled={loading}
                    className={`inline-flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-black transition ${
                      pageNumber === currentPage
                        ? "bg-emerald-400 text-slate-950"
                        : "border border-white/10 bg-slate-950/70 text-white hover:bg-slate-800"
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {pageNumber}
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => changePage(currentPage + 1)}
              disabled={currentPage >= totalPages || loading}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-slate-950/70 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </section>
      </div>
      {selectedCustomer ? (
        <CustomerProfileDrawer
          customer={profile?.customer || selectedCustomer}
          metrics={profile?.metrics}
          walletAudit={walletAudit}
          auditLoading={auditLoading}
          filters={filters}
          setFilters={setFilters}
          adjustment={adjustment}
          setAdjustment={setAdjustment}
          onClose={() => setSelectedCustomer(null)}
          onAdjust={handleManualAdjustment}
          onExportStatement={handleExportStatement}
          canExportStatement={canExportStatement}
        />
      ) : null}
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
      <section className="w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950 text-white shadow-2xl shadow-black/50">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_38%),rgba(15,23,42,0.88)] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.22em] text-cyan-200">استيراد من النظام القديم</div>
              <h2 className="mt-2 text-3xl font-black">استيراد العملاء ونقاط الولاء</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-400">
                ارفع ملف Excel أو CSV، راجع المعاينة أولاً، ثم نفذ الاستيراد النهائي بدون تكرار العملاء الموجودين.
              </p>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-6">
          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-400/5 p-5">
              <label className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-300/30 bg-slate-900/70 p-6 text-center transition hover:border-cyan-200/60 hover:bg-cyan-400/10">
                <UploadCloud className="h-10 w-10 text-cyan-200" />
                <div className="mt-3 text-lg font-black">{file?.name || "اختار ملف العملاء"}</div>
                <div className="mt-2 text-sm font-semibold text-slate-400">CSV, XLS, XLSX حتى 8MB</div>
                <input
                  type="file"
                  accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />
              </label>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm text-slate-300">
                <div className="font-black text-white">الأعمدة المطلوبة أو المعروفة</div>
                <div className="mt-2 leading-7">
                  customer name، phone، email اختياري، address اختياري، old loyalty points / balance
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200" htmlFor="customer-import-points-mode">
                  طريقة استيراد النقاط
                </label>
                <select
                  id="customer-import-points-mode"
                  value={pointsMode}
                  onChange={(event) => setPointsMode(event.target.value)}
                  className={`${inputClass} mt-3`}
                >
                  <option value="replace">استبدال النقاط القديمة</option>
                  <option value="add">إضافة على النقاط الحالية</option>
                </select>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  الوضع الافتراضي يستبدل الرصيد القديم بالقيمة الموجودة في الملف لتجنب مضاعفة النقاط عند رفع نفس الملف مرة أخرى.
                </p>
              </div>

              {error ? (
                <div className="mt-4 flex gap-3 rounded-2xl border border-rose-300/20 bg-rose-500/10 p-4 text-sm font-bold text-rose-100">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onPreview}
                  disabled={loading || !file}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-4 w-4" />
                  {loading && !summary ? "جاري الفحص..." : "معاينة قبل الاستيراد"}
                </button>
                <button
                  type="button"
                  onClick={onDownloadTemplate}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-300/20 bg-slate-950/70 px-5 text-sm font-black text-cyan-100 transition hover:bg-cyan-400/10"
                >
                  <Download className="h-4 w-4" />
                  تحميل نموذج Excel
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={loading || !preview?.summary || importDone}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 text-sm font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {loading && summary ? "جاري الاستيراد..." : importDone ? "تم الاستيراد" : "تأكيد الاستيراد"}
                </button>
                <button
                  type="button"
                  onClick={onDownloadErrors}
                  disabled={!hasInvalidRows}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 text-sm font-black text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Download className="h-4 w-4" />
                  تحميل تقرير الأخطاء
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">معاينة الاستيراد</div>
                  <h3 className="mt-1 text-xl font-black">ملخص الملف</h3>
                </div>
                {importDone ? <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-black text-emerald-100">تم التنفيذ</span> : null}
              </div>

              {summary ? (
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <ImportMetric label="وضع النقاط" value={pointsMode === "add" ? "إضافة" : "استبدال"} tone="cyan" />
                  <ImportMetric label="إجمالي الصفوف" value={summary.total_rows} />
                  <ImportMetric label="عملاء جدد" value={summary.new_customers ?? summary.created_count} tone="emerald" />
                  <ImportMetric label="عملاء موجودين" value={summary.existing_customers_matched ?? summary.updated_count} tone="cyan" />
                  <ImportMetric label="صفوف غير صالحة" value={summary.invalid_rows ?? summary.skipped_invalid_count} tone="rose" />
                  <ImportMetric label="هواتف مكررة" value={summary.duplicate_phones} tone="amber" />
                  <ImportMetric label="نقاط سيتم استيرادها" value={Number(summary.total_points_imported ?? summary.total_points_to_import ?? 0).toLocaleString("ar-EG-u-nu-latn")} tone="white" />
                </div>
              ) : (
                <div className="mt-5 rounded-3xl border border-dashed border-white/10 bg-slate-950/60 p-8 text-center text-sm font-semibold text-slate-500">
                  ارفع الملف واضغط "معاينة قبل الاستيراد" لعرض الأرقام قبل التنفيذ.
                </div>
              )}

              {(preview?.invalid_rows || result?.invalid_rows)?.length ? (
                <div className="mt-5 max-h-48 overflow-y-auto rounded-2xl border border-rose-300/15 bg-rose-500/5">
                  {(result?.invalid_rows || preview?.invalid_rows || []).slice(0, 8).map((row) => (
                    <div key={`${row.row_number}-${row.phone}`} className="border-b border-white/10 px-4 py-3 text-sm last:border-b-0">
                      <div className="font-black text-rose-100">صف {row.row_number}: {row.reason}</div>
                      <div className="mt-1 text-slate-400">{row.name || "-"} | {row.phone || "-"}</div>
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
    white: "border-white/10 bg-slate-950/70 text-white",
    slate: "border-white/10 bg-slate-900/70 text-slate-100",
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone] || tones.slate}`}>
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
      <aside className="h-full w-full max-w-5xl overflow-y-auto border-l border-white/10 bg-slate-950 p-5 text-white shadow-2xl shadow-black/40">
        <div className="flex flex-col gap-3 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Customer Wallet Audit</div>
            <h2 className="mt-2 text-3xl font-black">{customer?.name || "عميل"}</h2>
            <div className="mt-2 flex flex-wrap gap-3 text-sm text-zinc-300">
              <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4 text-zinc-500" />{customer?.phone || "-"}</span>
              <span className="inline-flex items-center gap-2"><Wallet className="h-4 w-4 text-emerald-300" />{formatMoney(walletBalance)}</span>
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-zinc-500" />{formatDateTime(metrics?.lastVisit || customer?.created_at)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onExportStatement}
              disabled={!canExportStatement}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-4 text-sm font-black text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              title={canExportStatement ? "كشف حساب العميل" : "Only admin/manager can export"}
            >
              <FileText className="h-4 w-4" />
              كشف حساب العميل
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-emerald-100">
            <Filter className="h-4 w-4" />
            فلاتر حركة المحفظة
          </div>
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <AuditInput label="من تاريخ" type="date" value={filters.date_from} onChange={(value) => updateFilter("date_from", value)} />
            <AuditInput label="إلى تاريخ" type="date" value={filters.date_to} onChange={(value) => updateFilter("date_to", value)} />
            <label className="block">
              <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">النوع</span>
              <select value={filters.transaction_type} onChange={(event) => updateFilter("transaction_type", event.target.value)} className={`${inputClass} mt-2`}>
                {walletTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <AuditInput label="رقم الفاتورة" value={filters.invoice_number} onChange={(value) => updateFilter("invoice_number", value)} />
            <AuditInput label="أقل مبلغ" type="number" value={filters.amount_min} onChange={(value) => updateFilter("amount_min", value)} />
            <AuditInput label="أكبر مبلغ" type="number" value={filters.amount_max} onChange={(value) => updateFilter("amount_max", value)} />
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-black text-emerald-100">
            <PlusCircle className="h-4 w-4" />
            تعديل يدوي للمحفظة
          </div>
          <form onSubmit={onAdjust} className="grid gap-3 md:grid-cols-[180px_160px_minmax(0,1fr)_120px]">
            <select value={adjustment.type} onChange={(event) => setAdjustment((current) => ({ ...current, type: event.target.value }))} className={inputClass}>
              <option value="manual_add">إضافة يدوية</option>
              <option value="manual_deduct">خصم يدوي</option>
            </select>
            <input type="number" min="0.01" step="0.01" required value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} placeholder="المبلغ" className={inputClass} />
            <input required value={adjustment.notes} onChange={(event) => setAdjustment((current) => ({ ...current, notes: event.target.value }))} placeholder="سبب/ملاحظات التعديل" className={inputClass} />
            <button type="submit" className="inline-flex h-12 items-center justify-center rounded-2xl bg-emerald-400 px-4 text-sm font-black text-slate-950 transition hover:bg-emerald-300">حفظ</button>
          </form>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
          <div className="border-b border-white/10 px-4 py-3 text-sm font-black text-white">Wallet audit timeline</div>
          <div className="divide-y divide-white/10">
            {auditLoading ? (
              <div className="px-4 py-8 text-center text-sm font-bold text-emerald-300">Loading...</div>
            ) : walletAudit.length ? (
              walletAudit.map((item) => <TimelineItem key={item.id} item={item} />)
            ) : (
              <div className="px-4 py-8 text-center text-sm text-zinc-500">لا توجد حركات مطابقة للفلاتر.</div>
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
      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-zinc-500">{label}</span>
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
        <div className="mt-2 text-xs text-zinc-500">{formatDateTime(item.created_at)}</div>
      </div>
      <div className="min-w-0">
        <div className={`text-lg font-black ${positive ? "text-emerald-200" : "text-rose-200"}`}>{positive ? "+" : ""}{formatMoney(amount)}</div>
        <div className="mt-2 grid gap-2 text-xs text-zinc-300 sm:grid-cols-3">
          <span>قبل: {formatMoney(item.before_balance)}</span>
          <span>بعد: {formatMoney(item.after_balance)}</span>
          <span>المرجع: {item.invoice_number || item.return_number || item.reference_id || "-"}</span>
        </div>
        {item.notes ? <div className="mt-2 text-sm text-zinc-400">{item.notes}</div> : null}
      </div>
      <div className="text-sm text-zinc-400 lg:text-left">
        <div>بواسطة: {item.created_by_name || item.created_by || "-"}</div>
        <div className="mt-1 text-xs text-zinc-500">{item.reference_type || "-"}</div>
      </div>
    </article>
  );
}

export default Customers;

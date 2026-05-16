import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, FileText, Filter, Mail, MapPin, Pencil, Phone, PlusCircle, Trash2, UserRound, UsersRound, Wallet, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import { getCurrentUser } from "../../../shared/auth/authStorage";

const inputClass =
  "h-12 w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm font-semibold text-white outline-none transition placeholder:text-zinc-500 focus:border-emerald-400/50 focus:bg-slate-950";

const normalizeCustomersResponse = (response) => {
  const payload = response?.data ?? response;
  return Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.customers)
        ? payload.customers
        : [];
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
  const canExportStatement = useMemo(() => isAdminOrManager(), []);

  const buildFilterQuery = useCallback(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (String(value || "").trim()) params.set(key, String(value).trim());
    });
    const query = params.toString();
    return query ? `?${query}` : "";
  }, [filters]);

  const fetchCustomers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get("/customers");
      setCustomers(normalizeCustomersResponse(response));
    } catch (error) {
      console.error("[customers] failed to load customers:", error);
    } finally {
      setLoading(false);
    }
  }, []);

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
    const timer = window.setTimeout(() => {
      fetchCustomers();
    }, 0);

    return () => window.clearTimeout(timer);
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
      fetchCustomers();
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
      fetchCustomers();
    } catch (error) {
      console.error("[customers] failed to delete customer:", error);
    }
  };

  const safeCustomers = Array.isArray(customers) ? customers : [];
  const filteredCustomers = safeCustomers.filter((customer) =>
    `${customer?.name || ""} ${customer?.phone || ""} ${customer?.email || ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

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

          <div className="inline-flex items-center gap-3 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-4 shadow-2xl shadow-emerald-950/20">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400 text-slate-950">
              <UsersRound className="h-6 w-6" />
            </div>
            <div>
              <div className="text-3xl font-black text-white">{safeCustomers.length}</div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">{t("customers.count")}</div>
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
            onChange={(event) => setSearch(event.target.value)}
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
            <p className="mt-1 text-sm text-zinc-500">{t("customers.table.visibleRecords", { count: filteredCustomers.length })}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px]">
              <thead className="border-b border-white/10 bg-slate-900/80 text-left text-xs font-black uppercase tracking-[0.18em] text-zinc-400">
                <tr>
                  <th className="px-6 py-5">{t("customers.table.customer")}</th>
                  <th className="px-6 py-5">{t("customers.table.phone")}</th>
                  <th className="px-6 py-5">{t("customers.table.email")}</th>
                  <th className="px-6 py-5">{t("customers.table.address")}</th>
                  <th className="px-6 py-5">رصيد المحفظة</th>
                  <th className="px-6 py-5 text-right">{t("customers.table.actions")}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/10">
                {loading ? (
                  <tr>
                      <td colSpan="6" className="px-6 py-12 text-center text-sm font-black text-emerald-300">
                      {t("customers.loading")}
                      </td>
                  </tr>
                ) : filteredCustomers.length > 0 ? (
                  filteredCustomers.map((customer, index) => (
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
                    <td colSpan="6" className="px-6 py-14 text-center">
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

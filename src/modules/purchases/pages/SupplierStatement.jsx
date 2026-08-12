import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AlertTriangle, ArrowLeft, FileText, Loader2, ReceiptText, Wallet } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import { formatCurrency, formatDateTime, normalizeSupplier } from "../lib/flowStore";

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const toArray = (value) => (Array.isArray(value) ? value : []);

const typeLabel = (kind, isArabic) => {
  const labels = {
    purchase_invoice: "فاتورة شراء",
    purchase_payment: "سداد شراء",
    purchase_payment_reversal: "عكس سداد",
    adjustment: "تسوية",
  };
  return labels[kind] || kind || (isArabic ? "حركة" : "Transaction");
};

function SupplierStatement() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const supplierId = params.supplierId || params.id || "";
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStatement = async () => {
    if (!supplierId) return;
    try {
      setLoading(true);
      setError("");
      const response = await api.get(`/suppliers/${supplierId}/statement`);
      const payload = response?.data?.data || response?.data?.statement || response?.statement || response?.data || response || null;
      setStatement(payload);
    } catch (requestError) {
      console.error("[supplier-statement] load failed", requestError);
      setError(requestError?.message || (isArabic ? "تعذر تحميل كشف الحساب" : "Failed to load supplier statement"));
      setStatement(null);
      toast.error(requestError?.message || (isArabic ? "تعذر تحميل كشف الحساب" : "Failed to load supplier statement"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatement();
  }, [supplierId]);

  const supplier = useMemo(() => normalizeSupplier(statement?.supplier || {}), [statement]);
  const rows = useMemo(() => toArray(statement?.rows), [statement]);
  const totals = statement?.totals || {};
  const openingBalance = roundMoney(statement?.opening_balance || supplier.opening_balance || 0);
  const currentBalance = roundMoney(statement?.current_balance ?? supplier.current_balance ?? 0);
  const finalBalance = roundMoney(statement?.final_balance ?? currentBalance);

  return (
    <FlowShell
      title="كشف حساب المورد"
      subtitle={`${supplier.name || "-"} ${supplier.supplier_code ? `• ${supplier.supplier_code}` : ""}`.trim()}
      tabs={[
        { to: "/purchases", label: isArabic ? "المشتريات" : "Purchases", end: true },
        { to: "/purchases/create", label: isArabic ? "إنشاء فاتورة" : "Create purchase" },
        { to: "/suppliers", label: isArabic ? "الموردون" : "Suppliers", end: true },
        { to: "/inventory", label: isArabic ? "المخزون" : "Inventory" },
        { to: "/accounting", label: isArabic ? "المحاسبة" : "Accounting" },
      ]}
      compact
    >
      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-10 text-center text-zinc-400">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          <div className="mt-3">جاري تحميل كشف الحساب...</div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
          <AlertTriangle className="me-2 inline h-4 w-4" />
          {error}
        </div>
      ) : null}

      {statement ? (
        <>
          {import.meta.env.DEV && toArray(statement?.warnings).length ? (
            <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              <div className="font-black">{isArabic ? "ملاحظات تنفيذية" : "Implementation notes"}</div>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {toArray(statement.warnings).map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div dir="rtl" className="rounded-2xl border border-white/10 bg-zinc-950/90 px-4 py-3 shadow-lg shadow-black/10">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 text-right">
                <div className="text-[10px] uppercase tracking-[0.22em] text-zinc-500">{isArabic ? "كشف حساب المورد" : "Supplier statement"}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                  <span className="font-black text-white">{supplier.name || "-"}</span>
                  <span className="text-zinc-500">|</span>
                  <span className="font-mono text-emerald-300">{supplier.supplier_code || "-"}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
                <Link
                  to="/suppliers"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/10"
                >
                  <ArrowLeft className="h-4 w-4" />
                  العودة للموردين
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label="إجمالي المشتريات" value={formatCurrency(totals.total_purchases || 0)} icon={<ReceiptText className="h-4 w-4" />} tone="rose" />
            <StatCard label="إجمالي المدفوع" value={formatCurrency(totals.total_paid || 0)} icon={<Wallet className="h-4 w-4" />} tone="emerald" />
            <StatCard label="الرصيد الافتتاحي" value={formatCurrency(openingBalance)} icon={<FileText className="h-4 w-4" />} tone="blue" />
            <StatCard label="الرصيد المستحق" value={formatCurrency(finalBalance)} icon={<Wallet className="h-4 w-4" />} tone="amber" />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-zinc-300">
                <span><span className="text-zinc-500">{isArabic ? "المورد" : "Supplier"}:</span> {supplier.name || "-"}</span>
                <span><span className="text-zinc-500">{isArabic ? "الكود" : "Code"}:</span> {supplier.supplier_code || "-"}</span>
                <span><span className="text-zinc-500">{isArabic ? "الهاتف" : "Phone"}:</span> {supplier.phone || "-"}</span>
                <span><span className="text-zinc-500">{isArabic ? "واتساب" : "WhatsApp"}:</span> {supplier.whatsapp || supplier.phone || "-"}</span>
                <span><span className="text-zinc-500">{isArabic ? "البريد" : "Email"}:</span> {supplier.email || "-"}</span>
              </div>
          </div>

          <div className="mt-4 rounded-3xl border border-white/10 bg-zinc-950/80 shadow-2xl shadow-black/10">
            <div className="border-b border-white/10 px-4 py-4">
              <h3 className="m1-section-title text-white">حركات الحساب</h3>
              <p className="mt-1 text-sm text-zinc-400">
                الترتيب زمني من الأقدم إلى الأحدث
              </p>
            </div>
            <div className="m1-table-container overflow-x-auto">
              <table className="m1-table m1-table--compact min-w-[1100px] w-full text-left text-sm">
                <thead className="bg-white/[0.03] text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                  <tr>
                    <Th>{isArabic ? "التاريخ" : "Date"}</Th>
                    <Th>{isArabic ? "النوع" : "Type"}</Th>
                    <Th>{isArabic ? "المرجع" : "Reference"}</Th>
                    <Th>{isArabic ? "البيان" : "Description"}</Th>
                    <Th align="right">{isArabic ? "مدين" : "Debit"}</Th>
                    <Th align="right">{isArabic ? "دائن" : "Credit"}</Th>
                    <Th align="right">{isArabic ? "الرصيد" : "Balance"}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length ? rows.map((row) => (
                    <tr key={`${row.kind}-${row.id}-${row.created_at}`} className="bg-zinc-950/80 text-zinc-300">
                      <Td>{formatDateTime(row.created_at)}</Td>
                      <Td className="font-semibold text-white">{typeLabel(row.kind, isArabic)}</Td>
                      <Td>{row.reference || "-"}</Td>
                      <Td>{row.description || "-"}</Td>
                      <Td align="right" className="font-semibold text-emerald-300">{row.debit ? formatCurrency(row.debit) : "-"}</Td>
                      <Td align="right" className="font-semibold text-rose-300">{row.credit ? formatCurrency(row.credit) : "-"}</Td>
                      <Td align="right" className="font-black text-white">{formatCurrency(row.balance || 0)}</Td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                        لا توجد حركات مسجلة بعد
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </FlowShell>
  );
}

function StatCard({ label, value, icon, tone = "zinc" }) {
  const classes = {
    rose: "border-rose-500/20 bg-rose-500/10 text-rose-300",
    emerald: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
    blue: "border-primary/20 bg-primary/10 text-primary",
    amber: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    zinc: "border-white/10 bg-white/5 text-white",
  };
  return (
    <div className={`rounded-3xl border p-4 shadow-xl ${classes[tone]}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 font-semibold text-white">{value}</div>
    </div>
  );
}

function Th({ children, align = "left" }) {
  return <th className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>{children}</th>;
}

function Td({ children, align = "left", className = "" }) {
  return <td className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"} ${className}`}>{children}</td>;
}

export default SupplierStatement;

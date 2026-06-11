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
  const labels = isArabic
    ? {
        purchase_invoice: "فاتورة شراء",
        purchase_payment: "سداد شراء",
        purchase_payment_reversal: "عكس سداد",
        adjustment: "تسوية",
      }
    : {
        purchase_invoice: "Purchase invoice",
        purchase_payment: "Purchase payment",
        purchase_payment_reversal: "Payment reversal",
        adjustment: "Adjustment",
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
      title={isArabic ? "كشف حساب المورد" : "Supplier Statement"}
      subtitle={supplier.name || (isArabic ? "تفاصيل الحركات المالية للمورد" : "Supplier financial movement statement")}
      actions={
        <Link
          to="/suppliers"
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
          {isArabic ? "العودة للموردين" : "Back to suppliers"}
        </Link>
      }
      tabs={[
        { to: "/purchases", label: isArabic ? "المشتريات" : "Purchases", end: true },
        { to: "/purchases/create", label: isArabic ? "إنشاء فاتورة" : "Create purchase" },
        { to: "/suppliers", label: isArabic ? "الموردون" : "Suppliers", end: true },
        { to: "/inventory", label: isArabic ? "المخزون" : "Inventory" },
        { to: "/accounting", label: isArabic ? "المحاسبة" : "Accounting" },
      ]}
    >
      {loading ? (
        <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-10 text-center text-zinc-400">
          <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          <div className="mt-3">{isArabic ? "جاري تحميل كشف الحساب..." : "Loading supplier statement..."}</div>
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
          {toArray(statement?.warnings).length ? (
            <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              <div className="font-black">{isArabic ? "ملاحظات تنفيذية" : "Implementation notes"}</div>
              <ul className="mt-2 list-disc space-y-1 ps-5">
                {toArray(statement.warnings).map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <StatCard label={isArabic ? "إجمالي المشتريات" : "Total purchases"} value={formatCurrency(totals.total_purchases || 0)} icon={<ReceiptText className="h-4 w-4" />} tone="rose" />
            <StatCard label={isArabic ? "إجمالي المدفوع" : "Total paid"} value={formatCurrency(totals.total_paid || 0)} icon={<Wallet className="h-4 w-4" />} tone="emerald" />
            <StatCard label={isArabic ? "الرصيد الافتتاحي" : "Opening balance"} value={formatCurrency(openingBalance)} icon={<FileText className="h-4 w-4" />} tone="blue" />
            <StatCard label={isArabic ? "الرصيد المستحق" : "Outstanding balance"} value={formatCurrency(finalBalance)} icon={<Wallet className="h-4 w-4" />} tone="amber" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{isArabic ? "ملف المورد" : "Supplier profile"}</div>
                    <h2 className="mt-2 text-2xl font-black text-white">{supplier.name}</h2>
                    <p className="mt-1 text-sm text-zinc-400">{supplier.address || (isArabic ? "لا يوجد عنوان" : "No address available")}</p>
                  </div>
                  <StatusBadge value={supplier.status} />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Info label={isArabic ? "الهاتف" : "Phone"} value={supplier.phone || (isArabic ? "غير متاح" : "Not available")} />
                  <Info label={isArabic ? "واتساب" : "WhatsApp"} value={supplier.whatsapp || supplier.phone || (isArabic ? "غير متاح" : "Not available")} />
                  <Info label={isArabic ? "البريد" : "Email"} value={supplier.email || (isArabic ? "غير متاح" : "Not available")} />
                  <Info label={isArabic ? "المديونية الحالية" : "Current debt"} value={formatCurrency(currentBalance)} />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10">
                <div className="border-b border-white/10 p-5">
                  <h3 className="text-xl font-black text-white">{isArabic ? "حركات الحساب" : "Statement entries"}</h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    {isArabic ? "الترتيب زمني من الأقدم إلى الأحدث" : "Chronological order from oldest to newest"}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-[1100px] w-full text-left text-sm">
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
                    <tbody className="divide-y divide-white/10">
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
                            {isArabic ? "لا توجد حركات مسجلة بعد" : "No statement entries yet"}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <h3 className="text-xl font-black text-white">{isArabic ? "ملخص الحساب" : "Account summary"}</h3>
                <div className="mt-4 grid gap-3">
                  <Info label={isArabic ? "إجمالي المشتريات" : "Total purchases"} value={formatCurrency(totals.total_purchases || 0)} />
                  <Info label={isArabic ? "إجمالي المدفوع" : "Total paid"} value={formatCurrency(totals.total_paid || 0)} />
                  <Info label={isArabic ? "الرصيد النهائي" : "Final balance"} value={formatCurrency(finalBalance)} />
                  <Info label={isArabic ? "الرصيد المستحق" : "Outstanding balance"} value={formatCurrency(finalBalance)} />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
                <h3 className="text-xl font-black text-white">{isArabic ? "بيانات المورد" : "Supplier details"}</h3>
                <div className="mt-4 space-y-3 text-sm text-zinc-300">
                  <Row label={isArabic ? "كود المورد" : "Supplier code"} value={supplier.supplier_code || "-"} />
                  <Row label={isArabic ? "الهاتف" : "Phone"} value={supplier.phone || "-"} />
                  <Row label={isArabic ? "البريد" : "Email"} value={supplier.email || "-"} />
                  <Row label={isArabic ? "العنوان" : "Address"} value={supplier.address || "-"} />
                  <Row label={isArabic ? "الملاحظات" : "Notes"} value={supplier.notes || "-"} />
                </div>
              </div>
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
    blue: "border-blue-500/20 bg-blue-500/10 text-blue-300",
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

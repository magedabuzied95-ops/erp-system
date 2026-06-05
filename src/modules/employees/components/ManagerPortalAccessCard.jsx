import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { regenerateManagerPortalToken } from "../../sales/services/salesEmployeesApi";
import { shareViaWhatsappWeb } from "../../../shared/utils/whatsapp.js";

const QRCodeCanvas = lazy(() => import("qrcode.react").then((module) => ({ default: module.QRCodeCanvas })));

const portalUrlFromToken = (token) => {
  const origin = String(import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.PUBLIC_APP_URL || window.location.origin || "").replace(/\/+$/, "");
  return `${origin}/manager-portal/${encodeURIComponent(token)}`;
};

const normalizeRole = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ");

const hasManagerPortalAccess = (employee = {}) => {
  if (employee?.manager_portal_enabled === true) return true;
  const role = normalizeRole(employee.role || employee.position || employee.job_title || "");
  return ["manager", "branch manager", "admin", "super admin", "superadmin", "مدير", "مدير فرع"].includes(role);
};

export default function ManagerPortalAccessCard({ employee, onEmployeeTokenChange = () => {} }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [portalTokenBusy, setPortalTokenBusy] = useState(false);
  const [portalQrUrl, setPortalQrUrl] = useState("");
  const [portalToken, setPortalToken] = useState(() => String(employee?.manager_portal_token || "").trim());
  const [portalTokenUrl, setPortalTokenUrl] = useState(() =>
    String(employee?.manager_portal_url || employee?.portal_url || "").trim()
  );

  const employeePortalUrl = String(employee?.manager_portal_url || employee?.portal_url || "").trim();
  const portalUrl = useMemo(() => (portalToken ? portalUrlFromToken(portalToken) : ""), [portalToken]);
  const effectivePortalUrl = portalUrl || portalTokenUrl || employeePortalUrl || portalQrUrl;
  const eligibleForManagerPortal = hasManagerPortalAccess(employee);
  const hasAccess = Boolean(portalToken || eligibleForManagerPortal);
  const hasPortalLink = Boolean(effectivePortalUrl);
  const showGenerateAction = !hasPortalLink;
  const actionLabel = portalToken || employeePortalUrl || portalQrUrl
    ? (isArabic ? "تجديد الرابط" : "Regenerate Link")
    : (isArabic ? "إنشاء رابط المدير" : "Generate Manager Link");

  useEffect(() => {
    setPortalToken(String(employee?.manager_portal_token || "").trim());
    setPortalTokenUrl(String(employee?.manager_portal_url || employee?.portal_url || "").trim());
    setPortalQrUrl("");
  }, [employee?.id, employee?.manager_portal_token, employee?.manager_portal_url, employee?.portal_url]);

  if (!employee?.id || (!eligibleForManagerPortal && !portalToken)) return null;

  const handleActionEvent = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
  };

  const regeneratePortalLink = async (event) => {
    handleActionEvent(event);
    try {
      setPortalTokenBusy(true);
      const result = await regenerateManagerPortalToken(employee.id);
      const nextToken = String(result?.token || "").trim();
      const nextUrl = String(result?.portal_url || result?.url || (nextToken ? portalUrlFromToken(nextToken) : "")).trim();
      if (nextToken) {
        setPortalToken(nextToken);
        setPortalTokenUrl(nextUrl);
        onEmployeeTokenChange?.(employee.id, nextToken, nextUrl);
      }
      setPortalQrUrl(nextUrl);
      toast.success(isArabic ? "تم إنشاء رابط بوابة المدير." : "Manager portal link generated.");
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر إنشاء رابط بوابة المدير." : "Unable to generate manager portal link."));
    } finally {
      setPortalTokenBusy(false);
    }
  };

  const copyPortalLink = async (event) => {
    handleActionEvent(event);
    try {
      if (!hasPortalLink) return;
      await navigator.clipboard.writeText(effectivePortalUrl);
      toast.success(isArabic ? "تم نسخ رابط بوابة المدير." : "Manager portal link copied.");
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر نسخ رابط بوابة المدير." : "Unable to copy manager portal link."));
    }
  };

  const openPortal = (event) => {
    handleActionEvent(event);
    if (!hasPortalLink) return;
    window.open(effectivePortalUrl, "_blank", "noopener,noreferrer");
  };

  const shareWhatsapp = (event) => {
    handleActionEvent(event);
    if (!hasPortalLink) return;
    const message = `${employee.full_name || employee.name || ""}\n${effectivePortalUrl}`;
    shareViaWhatsappWeb({ phone: employee.phone || "", message });
  };

  const downloadQr = async () => {
    try {
      setPortalTokenBusy(true);
      window.setTimeout(() => {
        const canvas = document.getElementById(`manager-portal-qr-${employee.id}`);
        if (!canvas) return;
        const link = document.createElement("a");
        link.download = `manager-portal-${employee.employee_code || employee.id || "qr"}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      }, 0);
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر تنزيل رمز QR." : "Unable to download manager QR."));
    } finally {
      setPortalTokenBusy(false);
    }
  };

  return (
    <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>
            {isArabic ? "وصول بوابة المدير" : "Manager Portal Access"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="text-2xl font-black text-white">{isArabic ? "إدارة بوابة المدير" : "Manager portal settings"}</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${hasAccess ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
              {hasAccess ? (isArabic ? "مفعّل" : "Enabled") : (isArabic ? "بدون صلاحية" : "No access")}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-zinc-400">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{isArabic ? "الفرع" : "Branch"}: {employee.branch_name || employee.branch || "-"}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">{isArabic ? "الدور" : "Role"}: {employee.role || employee.position || employee.job_title || "-"}</span>
            {employee.manager_portal_enabled ? (
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-emerald-100">{isArabic ? "مفعل من الإعداد" : "Enabled by toggle"}</span>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            {isArabic
              ? "رابط بوابة المدير مرتبط بملف الموظف نفسه ويمكن إنشاؤه أو تجديده من هنا دون فصل عن ملف الموظف."
              : "The manager portal link is tied to the employee record and can be generated or regenerated here without leaving the employee profile."}
          </p>
        </div>
        {hasPortalLink ? (
          <div className="rounded-2xl bg-white p-3">
            <Suspense fallback={<div className="h-[96px] w-[96px] rounded-xl bg-white" />}>
              <QRCodeCanvas id={`manager-portal-qr-${employee.id}`} value={effectivePortalUrl} size={96} level="M" />
            </Suspense>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-[10px] font-bold text-zinc-500">{isArabic ? "رابط بوابة المدير" : "Manager portal URL"}</div>
        <div className="mt-2 break-all text-sm font-semibold text-white" dir="ltr">
          {hasPortalLink ? effectivePortalUrl : (isArabic ? "لم يتم إنشاء رابط بعد" : "No portal link generated yet")}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={copyPortalLink} disabled={!hasPortalLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
          <Copy className="h-4 w-4" />
          {isArabic ? "نسخ الرابط" : "Copy Link"}
        </button>
        <button type="button" onClick={openPortal} disabled={!hasPortalLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
          <ExternalLink className="h-4 w-4" />
          {isArabic ? "فتح الرابط" : "Open Link"}
        </button>
        <button type="button" onClick={shareWhatsapp} disabled={!hasPortalLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50">
          <Send className="h-4 w-4" />
          {isArabic ? "مشاركة واتساب" : "WhatsApp Share"}
        </button>
        <button type="button" onClick={downloadQr} disabled={portalTokenBusy || !hasPortalLink} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
          <Download className="h-4 w-4" />
          {isArabic ? "تنزيل QR" : "Download QR"}
        </button>
        <button
          type="button"
          onClick={regeneratePortalLink}
          disabled={portalTokenBusy}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
            showGenerateAction
              ? "border border-amber-300/30 bg-amber-500 px-4 text-sm font-black text-black hover:bg-amber-400"
              : "border border-white/10 bg-white/5 text-white hover:bg-white/10"
          }`}
        >
          <RefreshCw className={`h-4 w-4 ${portalTokenBusy ? "animate-spin" : ""}`} />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

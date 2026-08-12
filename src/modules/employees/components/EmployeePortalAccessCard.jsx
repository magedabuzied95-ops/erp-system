import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, RefreshCw, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";

import { regenerateEmployeePortalToken } from "../../sales/services/salesEmployeesApi";

const QRCodeCanvas = lazy(() => import("qrcode.react").then((module) => ({ default: module.QRCodeCanvas })));

const portalUrlFromToken = (token) => {
  const origin = String(import.meta.env.VITE_PUBLIC_APP_URL || import.meta.env.PUBLIC_APP_URL || window.location.origin || "").replace(/\/+$/, "");
  return `${origin}/employee-portal/${encodeURIComponent(token)}`;
};

export default function EmployeePortalAccessCard({ employee, onEmployeeTokenChange = () => {} }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [portalTokenBusy, setPortalTokenBusy] = useState(false);
  const [portalQrUrl, setPortalQrUrl] = useState("");

  const portalUrl = useMemo(() => {
    const token = employee?.employee_portal_token;
    if (!token) return "";
    return portalUrlFromToken(token);
  }, [employee?.employee_portal_token]);

  useEffect(() => {
    setPortalQrUrl("");
  }, [employee?.id]);

  const effectivePortalUrl = portalUrl || portalQrUrl;
  if (!employee?.id) return null;

  const portalStatusActive = String(employee.status || "active").toLowerCase() === "active";

  const regeneratePortalLink = async () => {
    try {
      setPortalTokenBusy(true);
      const result = await regenerateEmployeePortalToken(employee.id);
      if (result.token) onEmployeeTokenChange(employee.id, result.token);
      setPortalQrUrl(result.portal_url || result.url || result.qr_url || (result.token ? portalUrlFromToken(result.token) : ""));
      toast.success(isArabic ? "تم تحديث رابط البوابة." : "Employee portal link regenerated.");
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر تحديث رابط البوابة." : "Unable to update employee portal link."));
    } finally {
      setPortalTokenBusy(false);
    }
  };

  const copyPortalLink = async () => {
    try {
      if (!effectivePortalUrl) return;
      await navigator.clipboard.writeText(effectivePortalUrl);
      toast.success(isArabic ? "تم نسخ رابط البوابة." : "Employee portal link copied.");
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر نسخ رابط البوابة." : "Unable to copy employee portal link."));
    }
  };

  const openPortal = () => {
    if (!effectivePortalUrl) return;
    window.open(effectivePortalUrl, "_blank", "noopener,noreferrer");
  };

  const shareWhatsapp = () => {
    if (!effectivePortalUrl) return;
    const message = encodeURIComponent(`${employee.full_name || employee.name || ""}\n${effectivePortalUrl}`);
    const phone = employee.phone ? String(employee.phone).replace(/\D+/g, "") : "";
    window.open(`https://wa.me/${phone}?text=${message}`, "_blank", "noopener,noreferrer");
  };

  const downloadQr = async () => {
    try {
      setPortalTokenBusy(true);
      window.setTimeout(() => {
        const canvas = document.getElementById(`employee-portal-qr-${employee.id}`);
        if (!canvas) return;
        const link = document.createElement("a");
        link.download = `employee-portal-${employee.employee_code || employee.id || "qr"}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      }, 0);
    } catch (error) {
      toast.error(error?.message || (isArabic ? "تعذر تنزيل رمز QR." : "Unable to download employee portal QR."));
    } finally {
      setPortalTokenBusy(false);
    }
  };

  return (
    <div className="rounded-[34px] border border-white/10 bg-zinc-950/90 p-5 shadow-2xl shadow-black/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className={isArabic ? "text-[11px] font-bold text-zinc-500" : "text-[11px] uppercase tracking-[0.2em] text-zinc-500"}>
            {isArabic ? "وصول بوابة الموظف" : "Employee Portal Access"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h3 className="m1-section-title text-white">{isArabic ? "إعدادات حساب الموظف" : "Employee account settings"}</h3>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${portalStatusActive ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
              {portalStatusActive ? (isArabic ? "نشط" : "Active") : (isArabic ? "معطل" : "Disabled")}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            {isArabic
              ? "رابط بوابة الموظف ورمز QR وعمليات المشاركة والتجديد من داخل ملف الموظف."
              : "Portal link, QR access, sharing, and regeneration now live inside the employee profile."}
          </p>
        </div>
        {effectivePortalUrl ? (
          <div className="rounded-2xl bg-white p-3">
            <Suspense fallback={<div className="h-[96px] w-[96px] rounded-xl bg-white" />}>
              <QRCodeCanvas id={`employee-portal-qr-${employee.id}`} value={effectivePortalUrl} size={96} level="M" />
            </Suspense>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-4">
        <div className="text-[10px] font-bold text-zinc-500">{isArabic ? "رابط بوابة الموظف" : "Employee portal URL"}</div>
        <div className="mt-2 break-all text-sm font-semibold text-white" dir="ltr">
          {effectivePortalUrl || (isArabic ? "لم يتم إنشاء رابط بوابة الموظف بعد. اضغط إعادة إنشاء الرابط." : "No employee portal link yet. Generate one below.")}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={copyPortalLink} disabled={!effectivePortalUrl} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
          <Copy className="h-4 w-4" />
          {isArabic ? "نسخ رابط البوابة" : "Copy Portal Link"}
        </button>
        <button type="button" onClick={openPortal} disabled={!effectivePortalUrl} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">
          <ExternalLink className="h-4 w-4" />
          {isArabic ? "فتح البوابة" : "Open Portal"}
        </button>
        <button type="button" onClick={shareWhatsapp} disabled={!effectivePortalUrl} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-4 text-sm font-black text-black transition hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50">
          <Send className="h-4 w-4" />
          {isArabic ? "رابط واتساب" : "WhatsApp Link"}
        </button>
        <button type="button" onClick={downloadQr} disabled={portalTokenBusy || !effectivePortalUrl} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60">
          <Download className="h-4 w-4" />
          {isArabic ? "تنزيل QR" : "Download QR"}
        </button>
        <button type="button" onClick={regeneratePortalLink} disabled={portalTokenBusy} className="inline-flex min-h-[var(--control-height-lg)] items-center justify-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${portalTokenBusy ? "animate-spin" : ""}`} />
          {isArabic ? "إعادة إنشاء الرابط" : "Regenerate Link"}
        </button>
      </div>
    </div>
  );
}

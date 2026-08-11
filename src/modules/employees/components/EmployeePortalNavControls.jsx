import { ArrowLeft, House } from "lucide-react";

const text = (value = "") => String(value || "").trim();

export const buildEmployeePortalHomePath = ({ pathname = "", token = "" } = {}) => {
  const safeToken = encodeURIComponent(text(token));
  if (!safeToken) return pathname.startsWith("/employee/portal/") ? "/employee/portal" : "/employee-portal";
  return pathname.startsWith("/employee/portal/") ? `/employee/portal/${safeToken}` : `/employee-portal/${safeToken}`;
};

export const canNavigateEmployeePortalBack = () => {
  if (typeof window === "undefined") return false;
  const historyIndex = Number(window.history?.state?.idx);
  if (Number.isFinite(historyIndex) && historyIndex > 0) return true;

  try {
    if (!document.referrer) return false;
    const referrer = new URL(document.referrer);
    return referrer.origin === window.location.origin;
  } catch {
    return false;
  }
};

export default function EmployeePortalNavControls({
  onBack,
  onHome,
  backLabel = "رجوع",
  homeLabel = "الرئيسية",
  tone = "light",
  className = "",
}) {
  const shellClassName =
    tone === "dark"
      ? "border-white/10 bg-zinc-950/88 text-white shadow-[0_18px_45px_rgba(0,0,0,0.45)] backdrop-blur"
      : "border-slate-200 bg-white/92 text-slate-950 shadow-sm backdrop-blur";
  const buttonClassName =
    tone === "dark"
      ? "border-white/10 bg-white/[0.06] text-white hover:bg-white/[0.12]"
      : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50";

  return (
    <div dir="ltr" className={`sticky top-[calc(env(safe-area-inset-top)+12px)] z-40 mb-3 flex justify-start ${className}`.trim()}>
      <div className={`inline-flex items-center gap-2 rounded-full border p-2 ${shellClassName}`}>
        <button
          type="button"
          onClick={onBack}
          className={`inline-flex min-h-[var(--control-height-lg)] min-w-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition ${buttonClassName}`}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span dir="auto">{backLabel}</span>
        </button>
        <button
          type="button"
          onClick={onHome}
          className={`inline-flex min-h-[var(--control-height-lg)] min-w-11 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition ${buttonClassName}`}
        >
          <House className="h-4 w-4 shrink-0" />
          <span dir="auto">{homeLabel}</span>
        </button>
      </div>
    </div>
  );
}

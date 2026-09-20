import { ArrowLeft, House } from "lucide-react";

const text = (value = "") => String(value || "").trim();

export const buildEmployeePortalHomePath = ({ pathname = "", token = "" } = {}) => {
  const safeToken = encodeURIComponent(text(token));
  // The installed app (/employee-app) must stay inside its own shell: sending it to
  // /employee-portal would drop the person out of the PWA's routes.
  const base = pathname.startsWith("/employee/portal/")
    ? "/employee/portal"
    : pathname.startsWith("/employee-app/")
      ? "/employee-app"
      : "/employee-portal";
  return safeToken ? `${base}/${safeToken}` : base;
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

// `tone` used to fork this control into a hardcoded light and a hardcoded dark
// copy, which is why it looked like a different control on the catalogue than on
// every other portal page. The surface tokens already follow the theme, so one
// appearance is correct in both and the prop is gone.
export default function EmployeePortalNavControls({
  onBack,
  onHome,
  backLabel = "رجوع",
  homeLabel = "الرئيسية",
  className = "",
}) {
  const shellClassName = "border-border bg-surface/92 text-text shadow-[var(--shadow-card)] backdrop-blur";
  const buttonClassName = "border-border bg-surface text-text hover:bg-surface-soft";

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

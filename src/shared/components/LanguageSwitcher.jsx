import { Languages } from "lucide-react";

import { useTranslation } from "react-i18next";

import { applyDocumentLanguage, normalizeLanguage, persistApplicationLanguage } from "../../i18n/i18n";

function LanguageSwitcher({ className = "", compact = false, showCode = false }) {
  const { i18n, t } = useTranslation();
  const current = normalizeLanguage(i18n.resolvedLanguage || i18n.language || "en");

  const setLanguage = async (next) => {
    const normalized = normalizeLanguage(next);
    if (normalized === current) return;

    persistApplicationLanguage(normalized);
    await i18n.changeLanguage(normalized);
    applyDocumentLanguage(normalized);
  };

  const arLabel = t("language.arabic");
  const enLabel = t("language.english");

  const handleCompactToggleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await setLanguage(current === "ar" ? "en" : "ar");
  };

  if (compact) {
    return (
      <div className={`relative z-[60] pointer-events-auto ${className}`.trim()}>
        <button
          type="button"
          onClick={handleCompactToggleClick}
          className={[
            "relative z-[60] pointer-events-auto inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-zinc-950/75 text-xs font-black text-[var(--text)] shadow-[0_10px_24px_rgba(0,0,0,0.14)] backdrop-blur transition hover:border-[var(--primary)]/45 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]",
            showCode ? "h-[var(--control-height-lg)] px-3" : "h-[var(--control-height-lg)] w-11",
          ].join(" ")}
          aria-label={t("language.label")}
          title={t("language.label")}
        >
          <Languages className="h-4 w-4 shrink-0 text-[var(--primary)]" />
          {showCode ? <span className="truncate">{current.toUpperCase()}</span> : null}
        </button>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1 ${className}`.trim()}>
      <div className="hidden items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] sm:flex">
        <Languages className="h-4 w-4 text-[var(--primary)]" />
        {t("language.label")}
      </div>

      <button
        type="button"
        onClick={() => setLanguage("ar")}
        className={`inline-flex min-w-16 items-center justify-center rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition ${ current === "ar" ? "bg-[var(--primary)] text-white shadow-lg" : "text-[var(--muted)] hover:text-[var(--text)]" }`}
      >
        {arLabel}
      </button>

      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={`inline-flex min-w-16 items-center justify-center rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold transition ${ current === "en" ? "bg-[var(--primary)] text-white shadow-lg" : "text-[var(--muted)] hover:text-[var(--text)]" }`}
      >
        {enLabel}
      </button>
    </div>
  );
}

export default LanguageSwitcher;

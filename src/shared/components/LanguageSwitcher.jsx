import { ChevronDown, Languages } from "lucide-react";

import { useTranslation } from "react-i18next";

import { applyDocumentLanguage, LANGUAGE_STORAGE_KEY, normalizeLanguage } from "../../i18n/i18n";

function LanguageSwitcher({ className = "" }) {
  const { i18n, t } = useTranslation();
  const current = normalizeLanguage(i18n.resolvedLanguage || i18n.language || "en");

  const setLanguage = async (next) => {
    const normalized = normalizeLanguage(next);
    if (normalized === current) return;

    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    applyDocumentLanguage(normalized);
    await i18n.changeLanguage(normalized);
    applyDocumentLanguage(normalized);
  };

  const arLabel = t("language.arabic");
  const enLabel = t("language.english");

  return (
    <div className={`inline-flex items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-1 ${className}`.trim()}>
      <div className="hidden items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--muted)] sm:flex">
        <Languages className="h-4 w-4 text-[var(--primary)]" />
        {t("language.label")}
      </div>

      <button
        type="button"
        onClick={() => setLanguage("ar")}
        className={`inline-flex min-w-16 items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold transition ${
          current === "ar"
            ? "bg-[var(--primary)] text-white shadow-lg"
            : "text-[var(--muted)] hover:text-[var(--text)]"
        }`}
      >
        {arLabel}
      </button>

      <button
        type="button"
        onClick={() => setLanguage("en")}
        className={`inline-flex min-w-16 items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold transition ${
          current === "en"
            ? "bg-[var(--primary)] text-white shadow-lg"
            : "text-[var(--muted)] hover:text-[var(--text)]"
        }`}
      >
        {enLabel}
      </button>

      <ChevronDown className="mr-1 h-4 w-4 text-[var(--muted)] sm:hidden" />
    </div>
  );
}

export default LanguageSwitcher;

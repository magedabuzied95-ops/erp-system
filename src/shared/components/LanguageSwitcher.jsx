import { useRef, useState } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";

import { useTranslation } from "react-i18next";

import { applyDocumentLanguage, normalizeLanguage, persistApplicationLanguage } from "../../i18n/i18n";
import useDismissableLayer from "../hooks/useDismissableLayer";

function LanguageSwitcher({ className = "", compact = false, menuPlacement = "bottom", align = "end", showCode = false }) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const current = normalizeLanguage(i18n.resolvedLanguage || i18n.language || "en");

  const setLanguage = async (next) => {
    const normalized = normalizeLanguage(next);
    setOpen(false);
    if (normalized === current) return;

    persistApplicationLanguage(normalized);
    await i18n.changeLanguage(normalized);
    applyDocumentLanguage(normalized);
  };

  useDismissableLayer({
    enabled: open,
    refs: [menuRef],
    onDismiss: () => setOpen(false),
  });

  const arLabel = t("language.arabic");
  const enLabel = t("language.english");
  const languages = [
    { key: "ar", label: arLabel },
    { key: "en", label: enLabel },
  ];

  if (compact) {
    const opensUp = menuPlacement === "top";
    const alignEnd = align === "end";

    return (
      <div ref={menuRef} className={`relative ${className}`.trim()}>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={[
            "inline-flex items-center justify-center gap-2 rounded-full border border-[var(--border)] bg-zinc-950/75 text-xs font-black text-[var(--text)] shadow-[0_10px_24px_rgba(0,0,0,0.14)] backdrop-blur transition hover:border-[var(--primary)]/45 hover:bg-[var(--surface-soft)] hover:text-[var(--text)]",
            showCode ? "h-11 px-3" : "h-11 w-11",
          ].join(" ")}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("language.label")}
          title={t("language.label")}
        >
          <Languages className="h-4 w-4 shrink-0 text-[var(--primary)]" />
          {showCode ? <span className="truncate">{current.toUpperCase()}</span> : null}
          {showCode ? <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition ${open ? "rotate-180" : ""}`} /> : null}
        </button>

        {open ? (
          <div
            role="menu"
            className={[
              "absolute z-50 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-zinc-950 p-1 shadow-2xl shadow-black/40",
              opensUp ? "bottom-full mb-2" : "top-full mt-2",
              alignEnd ? "right-0" : "left-0",
            ].join(" ")}
          >
            <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[var(--muted)]">
              {t("language.label")}
            </div>
            {languages.map((language) => {
              const active = current === language.key;
              return (
                <button
                  key={language.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setLanguage(language.key)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition ${
                    active
                      ? "bg-[var(--primary)] text-white"
                      : "text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  <span>{language.label}</span>
                  {active ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
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

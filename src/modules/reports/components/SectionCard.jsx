import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";

/** Below this width a long analytical page is easier to navigate collapsed. */
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * Whether the viewport is wide enough to keep analytical sections open.
 *
 * The matrix, size analysis and product table are the reason this page exists, and
 * shipping them collapsed on a large monitor hid the best of it behind three clicks.
 * On a phone the same sections are collapsed, where a long scroll costs more than a tap.
 */
const useDesktop = () => {
  const [desktop, setDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(DESKTOP_QUERY).matches
  );
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP_QUERY);
    if (!query) return undefined;
    const onChange = (event) => setDesktop(event.matches);
    setDesktop(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return desktop;
};

/**
 * A page section with its own loading / error state.
 *
 * `openOnDesktop` opens the section wherever there is room for it and collapses it on
 * small screens, without taking the control away from the reader.
 */
export default function SectionCard({
  id,
  title,
  subtitle,
  actions,
  children,
  status = "success",
  error,
  onRetry,
  collapsible = false,
  defaultOpen = true,
  openOnDesktop = false,
  skeletonHeight = 220,
  note,
}) {
  const { t } = useTranslation();
  const desktop = useDesktop();
  const [open, setOpen] = useState(openOnDesktop ? desktop : defaultOpen);
  const [touched, setTouched] = useState(false);

  // Follow the viewport until the reader expresses a preference, then leave it alone.
  useEffect(() => {
    if (openOnDesktop && !touched) setOpen(desktop);
  }, [openOnDesktop, desktop, touched]);

  const toggle = () => {
    setTouched(true);
    setOpen((value) => !value);
  };

  return (
    // scroll-mt clears the sticky section navigator when this card is scrolled to.
    <section id={id} className="flex min-w-0 scroll-mt-28 flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)]">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 2xl:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {collapsible ? (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              aria-label={open ? t("salesAnalytics.sections.collapse") : t("salesAnalytics.sections.expand")}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "" : "-rotate-90 rtl:rotate-90"}`} aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-bold text-[var(--text)] 2xl:text-[15px]">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)] 2xl:text-[12px]">{subtitle}</p> : null}
          </div>
        </div>
        {open ? <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
      </header>

      {open ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-[var(--border)] p-4 2xl:p-5">
          {note ? (
            <p className="mb-3 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-[11px] leading-4 text-[var(--text-secondary)] 2xl:text-[12px] 2xl:leading-5">
              {note}
            </p>
          ) : null}

          {status === "loading" ? (
            <div className="animate-pulse rounded-xl bg-[var(--surface-soft)]" style={{ height: skeletonHeight }} aria-busy="true" />
          ) : status === "error" ? (
            <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-[var(--danger)]/30 bg-[var(--danger-soft)] px-4 py-8 text-center">
              <TriangleAlert className="h-6 w-6 text-[var(--danger)]" aria-hidden="true" />
              <p className="mt-2 text-[13px] font-bold text-[var(--text)]">{t("salesAnalytics.states.sectionError")}</p>
              {error?.message ? (
                <p className="mt-1 max-w-md truncate text-[11px] text-[var(--text-tertiary)]" title={error.message}>{error.message}</p>
              ) : null}
              {onRetry ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-3 inline-flex h-[var(--control-height-sm)] items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 text-[12px] font-bold text-white transition hover:brightness-110"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  {t("salesAnalytics.states.sectionRetry")}
                </button>
              ) : null}
            </div>
          ) : (
            <div className={`flex min-h-0 min-w-0 flex-col transition-opacity ${status === "refreshing" ? "opacity-60" : "opacity-100"}`}>{children}</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

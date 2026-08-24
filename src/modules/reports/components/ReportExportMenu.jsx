import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Download, FileSpreadsheet, FileText, Loader2, Printer, Table } from "lucide-react";

import { EXPORT_FORMATS, exportReport } from "../lib/reportExport";
import { getPublicSettings } from "../../../shared/api/publicSettings";
import { getUser } from "../../../shared/auth/authStorage";

/**
 * The export control for every Reporting Center page.
 *
 * The rows come from the caller as a thunk, evaluated at click time, so the file always
 * carries what the page is showing right now — including the caller's permission gating.
 * A second fetch here would let the file and the screen disagree, which is exactly the
 * failure the legacy export had.
 *
 * The menu is a plain details/summary rather than a portal popover, because a portalled
 * dropdown escapes the shell's token normalisation and would need its own theme wiring
 * for no benefit at this size.
 */

const ICONS = { pdf: FileText, xlsx: FileSpreadsheet, csv: Table, print: Printer };

/**
 * The company name for the document header.
 *
 * Read from settings, then from the signed-in user's tenant, and otherwise LEFT EMPTY.
 * A hardcoded shop name on someone else's tenant would be a fabricated brand on a
 * financial document, which is worse than no brand at all.
 */
let brandPromise = null;
const resolveBrand = () => {
  if (!brandPromise) {
    brandPromise = getPublicSettings()
      .then((settings) => {
        const fromSettings =
          settings?.["general.company_name"] || settings?.["storefront.store_name"] || "";
        if (fromSettings) return String(fromSettings).trim();
        const user = getUser?.() || null;
        return String(user?.company_name || user?.tenant_name || "").trim();
      })
      .catch(() => "");
  }
  return brandPromise;
};

export default function ReportExportMenu({ reportKey, title, subtitle = "", filters, language, sheets, disabled = false }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(null);
  const detailsRef = useRef(null);

  // Close on an outside click, so the menu does not sit open behind the next section.
  useEffect(() => {
    const onDocumentClick = (event) => {
      if (!detailsRef.current?.open) return;
      if (detailsRef.current.contains(event.target)) return;
      detailsRef.current.open = false;
    };
    document.addEventListener("click", onDocumentClick);
    return () => document.removeEventListener("click", onDocumentClick);
  }, []);

  const run = async (format) => {
    if (busy) return;
    setBusy(format);
    if (detailsRef.current) detailsRef.current.open = false;
    try {
      const payload = typeof sheets === "function" ? sheets() : sheets;
      const brand = await resolveBrand();
      await exportReport({
        format,
        title,
        subtitle,
        filterSummary: buildFilterSummary(t, filters),
        brand,
        sheets: payload?.sheets || [],
        language: payload?.language || language,
        fileName: `${reportKey}-${filters?.from || ""}-${filters?.to || ""}`,
      });
    } catch (error) {
      if (error?.message === "NOTHING_TO_EXPORT") toast.error(t("overview.export.empty"));
      else if (error?.message === "PRINT_WINDOW_BLOCKED") toast.error(t("overview.export.blocked"));
      else toast.error(error?.message || t("overview.export.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <details ref={detailsRef} className="relative">
      <summary
        aria-label={t("overview.export.label")}
        className={`inline-flex h-[var(--control-height-sm)] cursor-pointer list-none items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-soft)] px-2.5 text-[12px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        <span>{busy ? t("overview.export.working") : t("overview.export.label")}</span>
      </summary>
      <div className="absolute end-0 z-30 mt-1 w-40 overflow-hidden rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]">
        {EXPORT_FORMATS.map((format) => {
          const Icon = ICONS[format];
          return (
            <button
              key={format}
              type="button"
              onClick={() => run(format)}
              disabled={Boolean(busy)}
              className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-soft)] hover:text-[var(--text)] disabled:opacity-50"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t(`overview.export.${format}`)}
            </button>
          );
        })}
      </div>
    </details>
  );
}

/**
 * One line naming exactly which window and comparison produced the file.
 *
 * An export with no period on it is unreadable a week later, and two files with the same
 * name and different windows are worse than no export at all.
 */
export const buildFilterSummary = (t, filters) => {
  if (!filters?.from || !filters?.to) return "";
  const window = t("overview.export.window", { from: filters.from, to: filters.to });
  if (!filters.compare || filters.compare === "none") return window;
  return `${window} · ${t("overview.compare.vs")} ${t(`overview.compare.${filters.compare}`, { defaultValue: filters.compare })}`;
};

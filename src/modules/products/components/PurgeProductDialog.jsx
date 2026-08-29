import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, ShieldAlert, Trash2, X } from "lucide-react";

import { getProductPurgePreview, purgeProductFromDatabase } from "../services/productsApi";

/**
 * Admin-only hard delete. The server plans the whole purge in a transaction it
 * rolls back, so everything shown here - row counts and, critically, the
 * recomputed total of every purchase invoice the product appears on - is what
 * the real run will do. Nothing is destroyed until the operator types the SKU.
 *
 * This dialog portals to document.body, which is outside `.m1-shell-content`,
 * so foundation.css never normalizes a raw Tailwind palette class here. Every
 * colour below is a token or a var(--danger) mix for that reason.
 */
export default function PurgeProductDialog({ product, onClose, onPurged }) {
  const { t, i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [purging, setPurging] = useState(false);

  const productId = product?.id;

  useEffect(() => {
    if (!productId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError("");
    getProductPurgePreview(productId)
      .then((response) => {
        if (cancelled) return;
        setPreview(response || null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err?.responseBody?.message ||
            err?.message ||
            t("products.purge.previewFailed", "تعذر تحضير تقرير المسح.")
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, t]);

  const phrase = preview?.confirmation_phrase || "";
  const summary = preview?.summary || null;
  const purchases = useMemo(() => (Array.isArray(preview?.purchases) ? preview.purchases : []), [preview]);
  const deletes = useMemo(
    () => (Array.isArray(preview?.deletes) ? [...preview.deletes].sort((a, b) => b.rows - a.rows) : []),
    [preview]
  );
  const blocked = Boolean(preview?.blocked);
  const confirmed = Boolean(phrase) && confirmText.trim().toLowerCase() === phrase.trim().toLowerCase();
  const canPurge = confirmed && !blocked && !purging && !loading && !error;

  const money = (value) =>
    Number(value || 0).toLocaleString(isArabic ? "ar-EG" : "en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const handlePurge = async () => {
    if (!canPurge) return;
    setPurging(true);
    setError("");
    try {
      const response = await purgeProductFromDatabase(productId, confirmText.trim());
      onPurged?.(response || null);
    } catch (err) {
      setError(
        err?.responseBody?.message ||
          err?.message ||
          t("products.purge.failed", "فشل مسح المنتج من قاعدة البيانات.")
      );
      setPurging(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100200] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
      dir={isArabic ? "rtl" : "ltr"}
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface shadow-2xl shadow-black/50">
        <header className="flex items-start gap-4 border-b border-border p-6">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-card)]"
            style={{
              background: "color-mix(in srgb, var(--danger) 14%, transparent)",
              color: "var(--danger)",
              border: "1px solid color-mix(in srgb, var(--danger) 32%, transparent)",
            }}
          >
            <ShieldAlert size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="m1-section-title text-text">
              {t("products.purge.title", "مسح المنتج من قاعدة البيانات؟")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-text-muted">
              {t(
                "products.purge.description",
                "هذا حذف نهائي غير قابل للتراجع. المنتج وخياراته وكمياته وصوره وظهوره على الموقع ونقاط البيع كلها هتتمسح، وسطوره هتتشال من فواتير الشراء وإجمالي كل فاتورة هيتعاد حسابه. فواتير البيع هتفضل زي ما هي بأسماء المنتج المحفوظة."
              )}
            </p>
            <p className="mt-3 truncate text-sm font-semibold text-text">{product?.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={purging}
            className="rounded-[var(--radius-control)] border border-border p-2 text-text-muted hover:bg-surface-hover disabled:opacity-40"
            aria-label={t("common.close", "إغلاق")}
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10 text-sm text-text-muted">
              <Loader2 className="animate-spin" size={18} />
              {t("products.purge.loading", "بنحسب اللي هيتمسح…")}
            </div>
          ) : null}

          {!loading && error && !preview ? (
            <p className="rounded-[var(--radius-card)] border border-border p-4 text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : null}

          {!loading && preview ? (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  [t("products.purge.statVariants", "الخيارات"), summary?.variants ?? 0],
                  [t("products.purge.statRows", "صفوف هتتمسح"), summary?.rows_to_delete ?? 0],
                  [t("products.purge.statPurchases", "فواتير شراء"), summary?.purchases_affected ?? 0],
                  [t("products.purge.statSalesKept", "سطور بيع محفوظة"), summary?.sales_lines_preserved ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{label}</p>
                    <p className="mt-1 text-xl font-black text-text">{value}</p>
                  </div>
                ))}
              </div>

              {blocked ? (
                <div
                  className="rounded-[var(--radius-card)] p-4 text-sm"
                  style={{
                    background: "color-mix(in srgb, var(--danger) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--danger) 30%, transparent)",
                    color: "var(--danger)",
                  }}
                >
                  <p className="font-bold">
                    {t("products.purge.blockedTitle", "المسح متوقف: فيه جداول مش متصنفة بتشاور على المنتج")}
                  </p>
                  <ul className="mt-2 space-y-1 font-mono text-xs">
                    {(preview.unclassified || []).map((row) => (
                      <li key={`${row.table}.${row.column}`}>
                        {row.table}.{row.column} — {row.rows}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {purchases.length ? (
                <section>
                  <h3 className="text-sm font-bold text-text">
                    {t("products.purge.purchasesTitle", "فواتير الشراء اللي هتتعدل")}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    {t(
                      "products.purge.purchasesHint",
                      "الضريبة والخصم في رأس الفاتورة بيفضلوا زي ما هم — الإجمالي بيتحسب من سطور الفاتورة المتبقية، زي ما بيحصل لما تعدّل الفاتورة يدويًا. المدفوع للمورد مش بيتغير."
                    )}
                  </p>
                  <div className="mt-3 overflow-x-auto rounded-[var(--radius-card)] border border-border">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead className="bg-surface-soft text-xs uppercase tracking-wide text-text-muted">
                        <tr>
                          <th className="px-3 py-2 text-start font-semibold">{t("products.purge.colInvoice", "الفاتورة")}</th>
                          <th className="px-3 py-2 text-start font-semibold">{t("products.purge.colLines", "سطور")}</th>
                          <th className="px-3 py-2 text-start font-semibold">{t("products.purge.colBefore", "قبل")}</th>
                          <th className="px-3 py-2 text-start font-semibold">{t("products.purge.colAfter", "بعد")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {purchases.map((row) => (
                          <tr key={row.purchase_id} className="border-t border-border">
                            <td className="px-3 py-2 text-text">
                              {row.purchase_number || `#${row.purchase_id}`}
                              {row.becomes_empty ? (
                                <span className="ms-2 text-[11px]" style={{ color: "var(--danger)" }}>
                                  {t("products.purge.becomesEmpty", "هتفضل فاضية")}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-text-muted">-{row.removed_lines}</td>
                            <td className="px-3 py-2 text-text-muted">{money(row.before?.total)}</td>
                            <td className="px-3 py-2 font-bold text-text">{money(row.after?.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {deletes.length ? (
                <details className="rounded-[var(--radius-card)] border border-border bg-surface-soft">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-text">
                    {t("products.purge.tablesTitle", "الجداول اللي هتتمسح منها صفوف")} ({deletes.length})
                  </summary>
                  <ul className="grid grid-cols-1 gap-1 px-4 pb-4 font-mono text-xs text-text-muted sm:grid-cols-2">
                    {deletes.map((row) => (
                      <li key={`${row.table}.${row.column}`}>
                        {row.table} — {row.rows}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {summary?.sales_lines_preserved ? (
                <p className="flex items-start gap-2 text-xs leading-5 text-text-muted">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {/* `total`, not `count`: an i18next `count` triggers plural
                      resolution and an Arabic bundle without every `_zero`.._other`
                      form silently falls back to English. */}
                  {t("products.purge.salesKeptHint", {
                    total: summary.sales_lines_preserved,
                    defaultValue:
                      "{{total}} سطر في فواتير البيع هيفضل مكانه بالاسم والكود المحفوظين، وهيفقد الربط بالمنتج بس — عشان الإيراد والأرباح التاريخية ما تتغيّرش.",
                  })}
                </p>
              ) : null}

              <div>
                <label className="block text-sm font-semibold text-text" htmlFor="purge-confirm-input">
                  {t("products.purge.confirmLabel", "اكتب الكود ده عشان تأكد:")}{" "}
                  <span className="font-mono" style={{ color: "var(--danger)" }}>
                    {phrase}
                  </span>
                </label>
                <input
                  id="purge-confirm-input"
                  type="text"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  disabled={blocked || purging}
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  className="mt-2 w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-3 py-2.5 font-mono text-sm text-text outline-none focus:border-primary disabled:opacity-40"
                  placeholder={phrase}
                />
              </div>

              {error ? (
                <p className="text-sm" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="flex justify-end gap-3 border-t border-border p-6">
          <button
            type="button"
            onClick={onClose}
            disabled={purging}
            className="rounded-[var(--radius-control)] border border-border px-4 py-2.5 text-sm font-bold text-text hover:bg-surface-hover disabled:opacity-40"
          >
            {t("common.cancel", "إلغاء")}
          </button>
          <button
            type="button"
            onClick={handlePurge}
            disabled={!canPurge}
            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--danger)" }}
          >
            {purging ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
            {purging
              ? t("products.purge.purging", "بنمسح…")
              : t("products.purge.confirmButton", "امسح نهائيًا")}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

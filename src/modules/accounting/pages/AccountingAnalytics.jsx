import { useCallback, useEffect, useState } from "react";
import { BarChart3, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import AccountingShell from "../components/AccountingShell";
import { accountingApi } from "../services/accountingApi";

export default function AccountingAnalytics() {
  const { i18n } = useTranslation();
  const isArabic = String(i18n.language || "").toLowerCase().startsWith("ar");
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEmbed = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const result = await accountingApi.getAnalyticsEmbed();
      setSession(result);
    } catch (loadError) {
      setError(loadError?.message || (isArabic ? "تعذر فتح التحليلات المتقدمة." : "Unable to open advanced analytics."));
    } finally {
      setLoading(false);
    }
  }, [isArabic]);

  useEffect(() => {
    loadEmbed();
  }, [loadEmbed]);

  return (
    <div dir={isArabic ? "rtl" : "ltr"}>
      <AccountingShell
        title={isArabic ? "التحليلات المحاسبية المتقدمة" : "Advanced accounting analytics"}
        subtitle={
          isArabic
            ? "لوحات تفاعلية للربحية والسيولة والمخزون والمديونيات، مع عزل بيانات كل شركة تلقائيًا."
            : "Interactive profitability, liquidity, inventory, and aging dashboards with automatic tenant isolation."
        }
        actions={
          <button
            type="button"
            onClick={loadEmbed}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] transition hover:bg-[var(--card)] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {isArabic ? "تحديث" : "Refresh"}
          </button>
        }
        tabs={[
          { to: "/accounting", label: isArabic ? "لوحة التحكم" : "Dashboard", end: true },
          { to: "/accounting/reports", label: isArabic ? "التقارير المحاسبية" : "Accounting reports" },
          { to: "/accounting/analytics", label: isArabic ? "التحليلات المتقدمة" : "Advanced analytics" },
        ]}
      >
        <section className="overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl shadow-[var(--shadow)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--primary)]/15 text-[var(--primary)]">
                <BarChart3 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-black text-[var(--text)]">{isArabic ? "مركز ذكاء الأعمال" : "Business intelligence center"}</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {isArabic ? "اتصال للقراءة فقط · فلترة آمنة حسب الشركة" : "Read-only connection · securely filtered by tenant"}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
              {isArabic ? "بيانات معزولة وآمنة" : "Isolated and secure"}
            </span>
          </div>

          {loading ? (
            <div className="grid min-h-[560px] place-items-center">
              <div className="text-center text-[var(--muted)]">
                <LoaderCircle className="mx-auto h-9 w-9 animate-spin text-[var(--primary)]" />
                <p className="mt-3 text-sm font-semibold">{isArabic ? "جاري تجهيز التقارير…" : "Preparing reports…"}</p>
              </div>
            </div>
          ) : null}

          {!loading && session?.enabled && session?.embed_url ? (
            <iframe
              key={session.embed_url}
              src={session.embed_url}
              title={isArabic ? "التحليلات المحاسبية المتقدمة" : "Advanced accounting analytics"}
              className="h-[72vh] min-h-[620px] w-full border-0 bg-transparent"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : null}

          {!loading && (!session?.enabled || error) ? (
            <div className="grid min-h-[520px] place-items-center p-6">
              <div className="max-w-xl rounded-3xl border border-[var(--border)] bg-[var(--card)] p-8 text-center">
                <BarChart3 className="mx-auto h-12 w-12 text-[var(--primary)]" />
                <h3 className="mt-4 text-xl font-black text-[var(--text)]">
                  {isArabic ? "التقارير الأساسية جاهزة الآن" : "Core reports are ready now"}
                </h3>
                <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                  {error ||
                    (isArabic
                      ? "خدمة التحليلات الخارجية لم تُفعّل على هذا السيرفر بعد. يمكنك استخدام التقارير المحاسبية الكاملة بدون تعطيل عملك."
                      : "The external analytics service is not enabled on this server yet. You can continue using the complete native accounting reports.")}
                </p>
                <Link
                  to="/accounting/reports"
                  className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[var(--primary)] px-5 py-3 text-sm font-black text-white"
                >
                  {isArabic ? "فتح التقارير المحاسبية" : "Open accounting reports"}
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </div>
          ) : null}
        </section>
      </AccountingShell>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  ChevronLeft,
  Gauge,
  Search,
  ShieldAlert,
  ShoppingBag,
  Timer,
  TrendingUp,
} from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import FlowShell from "../components/FlowShell";

const statusTone = {
  BUY_NOW: {
    badge: "border-emerald-400/40 bg-emerald-400/12 text-emerald-100",
    bar: "bg-emerald-400",
  },
  WATCH: {
    badge: "border-amber-400/40 bg-amber-400/12 text-amber-100",
    bar: "bg-amber-400",
  },
  DO_NOT_BUY: {
    badge: "border-rose-400/40 bg-rose-400/12 text-rose-100",
    bar: "bg-rose-400",
  },
};

const riskTone = {
  LOW: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
  MEDIUM: "border-amber-400/25 bg-amber-400/10 text-amber-100",
  HIGH: "border-rose-400/25 bg-rose-400/10 text-rose-100",
};

const imageFor = (value) => resolveProductImageUrl(value) || "/favicon.svg";
const clampPercent = (value) => Math.max(0, Math.min(100, Number(value || 0)));
const localeFor = (language) => (String(language || "").toLowerCase().startsWith("ar") ? "ar-EG" : "en-US");
const formatNumber = (value, digits = 0, locale = "en-US") => Number(value || 0).toLocaleString(locale, { maximumFractionDigits: digits });

function ReorderSuggestions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const numberLocale = localeFor(i18n.language);
  const [suggestions, setSuggestions] = useState([]);
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creatingId, setCreatingId] = useState("");
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: "all", supplier: "all", carton: "all", search: "" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .get("/purchases/reorder-suggestions")
      .then((data) => {
        if (!cancelled) {
          setSuggestions(Array.isArray(data.data) ? data.data : Array.isArray(data.suggestions) ? data.suggestions : []);
          setDiagnostics(data.diagnostics || null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const backendMessage = err?.responseBody?.error || err?.responseBody?.message || err?.message || "";
          setError({
            message: t("purchases.reorder.loadFailed"),
            detail: backendMessage && backendMessage !== "تعذر إتمام الطلب" ? backendMessage : "",
          });
          setDiagnostics(err?.responseBody?.diagnostics || null);
          setSuggestions([]);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const supplierOptions = useMemo(() => ["all", ...new Set(suggestions.map((item) => item.supplier_name || t("purchases.reorder.unspecifiedSupplier")))], [suggestions, t]);
  const cartonOptions = useMemo(() => ["all", "small", "medium", "large"], []);

  const kpis = useMemo(() => {
    const avgSellThrough = suggestions.length
      ? Math.round(suggestions.reduce((sum, item) => sum + Number(item.sell_through_percent || 0), 0) / suggestions.length)
      : 0;
    const fastest = [...suggestions]
      .sort((a, b) => Number(b.average_daily_sales || b.sell_through_percent || 0) - Number(a.average_daily_sales || a.sell_through_percent || 0))
      .slice(0, 3);

    return {
      buyNow: suggestions.filter((item) => item.status === "BUY_NOW").length,
      overstock: suggestions.filter((item) => item.overstock_warning || item.risk_level === "HIGH" || item.status === "DO_NOT_BUY").length,
      avgSellThrough,
      fastest,
    };
  }, [suggestions]);

  const hasDiagnosticsWarning = Boolean(
    diagnostics &&
      ((Array.isArray(diagnostics.queryErrors) && diagnostics.queryErrors.length > 0) ||
        diagnostics.emergencyMockFallback ||
        diagnostics.fallbackUsed?.salesFallback)
  );

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return suggestions.filter((item) => {
      const packQty = Number(item.purchase_pack_qty || 1);
      const cartonMatch =
        filters.carton === "all" ||
        (filters.carton === "small" && packQty <= 5) ||
        (filters.carton === "medium" && packQty >= 6 && packQty < 15) ||
        (filters.carton === "large" && packQty >= 15);
      const searchText = `${item.product_name || ""} ${item.color || ""} ${item.variant || ""} ${item.supplier_name || ""}`.toLowerCase();
      return (
        (filters.status === "all" || item.status === filters.status) &&
        (filters.supplier === "all" || item.supplier_name === filters.supplier) &&
        cartonMatch &&
        (!query || searchText.includes(query))
      );
    });
  }, [suggestions, filters]);

  const createDraft = async (item) => {
    const suggestionId = item.suggestion_id || `${item.product_id}::${item.color || item.variant || "default"}`;
    setCreatingId(suggestionId);
    try {
      const response = await api.post("/purchases/reorder-draft", { suggestion_ids: [suggestionId] });
      toast.success(t("purchases.reorder.draftCreated", { number: response?.purchase?.purchase_number || "" }).trim());
      navigate("/purchases");
    } catch (err) {
      toast.error(err?.responseBody?.message || err?.message || t("purchases.reorder.draftFailed"));
    } finally {
      setCreatingId("");
    }
  };

  return (
    <FlowShell
      title={t("purchases.reorder.title")}
      subtitle={t("purchases.reorder.subtitle")}
      actions={
        <Link to="/purchases/create" className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-black text-black transition hover:bg-zinc-200">
          {t("purchases.reorder.createPurchaseInvoice")}
        </Link>
      }
      tabs={[
        { to: "/purchases", label: t("purchases.tabs.purchases"), end: true },
        { to: "/purchases/create", label: t("purchases.tabs.createPo") },
        { to: "/purchases/reorder-suggestions", label: t("purchases.tabs.smartReorder") },
        { to: "/suppliers", label: t("purchases.tabs.suppliers") },
      ]}
    >
      {error ? (
        <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">
          <AlertTriangle className="me-2 inline h-4 w-4" />
          {error.message}
          {error.detail ? <div dir="ltr" className="mt-2 text-xs text-rose-100/80">{error.detail}</div> : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <SummaryStrip kpis={kpis} locale={numberLocale} />

        <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-3 shadow-2xl shadow-black/10">
          <div className="grid gap-2 lg:grid-cols-[1.4fr_0.75fr_0.75fr_0.75fr]">
            <label className="relative block">
              <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
                placeholder={t("purchases.reorder.searchPlaceholder")}
                className="h-[var(--control-height-lg)] w-full rounded-xl border border-white/10 bg-white/5 pe-10 ps-4 text-sm font-bold text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400/50"
              />
            </label>
            <FilterSelect label={t("purchases.filters.status")} value={filters.status} onChange={(value) => setFilters((prev) => ({ ...prev, status: value }))} options={["all", "BUY_NOW", "WATCH", "DO_NOT_BUY"]} labels={{ all: t("purchases.reorder.allStatuses"), BUY_NOW: t("purchases.reorder.status.buyNow"), WATCH: t("purchases.reorder.status.watch"), DO_NOT_BUY: t("purchases.reorder.status.doNotBuy") }} />
            <FilterSelect label={t("purchases.filters.supplier")} value={filters.supplier} onChange={(value) => setFilters((prev) => ({ ...prev, supplier: value }))} options={supplierOptions} labels={{ all: t("purchases.reorder.allSuppliers") }} />
            <FilterSelect label={t("purchases.reorder.cartonSize")} value={filters.carton} onChange={(value) => setFilters((prev) => ({ ...prev, carton: value }))} options={cartonOptions} labels={{ all: t("purchases.reorder.allSizes"), small: t("purchases.reorder.smallCarton"), medium: t("purchases.reorder.mediumCarton"), large: t("purchases.reorder.largeCarton") }} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-zinc-950/90 p-2 shadow-2xl shadow-black/10">
          {loading ? (
            <div className="grid gap-2">
              {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-2xl bg-white/5" />)}
            </div>
          ) : filtered.length ? (
            <div className="grid gap-2">
              {filtered.map((item) => (
                <SuggestionCard
                  key={item.suggestion_id || `${item.product_id}-${item.color}`}
                  item={item}
                  creating={creatingId === (item.suggestion_id || `${item.product_id}::${item.color || item.variant || "default"}`)}
                  onCreateDraft={() => createDraft(item)}
                  locale={numberLocale}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-8 text-center">
              <Boxes className="mx-auto h-10 w-10 text-zinc-500" />
              <h3 className="mt-3 text-lg font-black text-white">{t("purchases.reorder.emptyTitle")}</h3>
              <p className="mt-1 text-sm font-bold text-zinc-400">{t("purchases.reorder.emptyDescription")}</p>
            </div>
          )}
        </div>

        {((error || (!loading && suggestions.length === 0) || hasDiagnosticsWarning)) && diagnostics ? (
          <details className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 text-xs text-zinc-300">
            <summary className="cursor-pointer font-black text-zinc-200">{t("purchases.reorder.diagnostics")}</summary>
            <pre dir="ltr" className="mt-3 max-h-72 overflow-auto rounded-xl bg-black/40 p-3 text-left text-[11px] leading-5 text-zinc-300">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </FlowShell>
  );
}

function SummaryStrip({ kpis, locale }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-2 xl:grid-cols-[0.8fr_0.8fr_0.8fr_1.4fr]">
      <SummaryCard label={t("purchases.reorder.status.buyNow")} value={kpis.buyNow} icon={<ShoppingBag className="h-4 w-4" />} tone="emerald" />
      <SummaryCard label={t("purchases.reorder.overstockRisk")} value={kpis.overstock} icon={<ShieldAlert className="h-4 w-4" />} tone="rose" />
      <SummaryCard label={t("purchases.reorder.avgSellThrough")} value={`${kpis.avgSellThrough}%`} icon={<Gauge className="h-4 w-4" />} tone="amber" />
      <div className="min-h-20 rounded-2xl border border-white/10 bg-zinc-950/90 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-black text-zinc-400">
          <TrendingUp className="h-4 w-4 text-emerald-300" />
          {t("purchases.reorder.fastestProducts")}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-3">
          {kpis.fastest.length ? kpis.fastest.map((item) => (
            <div key={item.suggestion_id || `${item.product_id}-${item.color}`} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
              <div className="truncate text-xs font-black text-white">{item.product_name}</div>
              <div className="mt-1 text-[11px] font-bold text-zinc-400">{t("purchases.reorder.dailyVelocity", { daily: formatNumber(item.average_daily_sales, 2, locale), percent: formatNumber(item.sell_through_percent, 1, locale) })}</div>
            </div>
          )) : <div className="col-span-3 text-xs font-bold text-zinc-500">{t("purchases.reorder.noVelocityYet")}</div>}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, icon, tone }) {
  const classes = {
    emerald: "border-emerald-400/15 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-400/15 bg-amber-400/10 text-amber-100",
    rose: "border-rose-400/15 bg-rose-400/10 text-rose-100",
  };
  return (
    <div className={`flex min-h-20 items-center justify-between rounded-2xl border p-3 ${classes[tone]}`}>
      <div>
        <div className="text-xs font-black text-current/75">{label}</div>
        <div className="mt-1 text-2xl font-black leading-none text-white">{value}</div>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 p-2">{icon}</div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, labels = {} }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black text-zinc-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-[var(--control-height-lg)] w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-sm font-bold text-white outline-none focus:border-emerald-400/50">
        {options.map((option) => <option key={option} value={option}>{labels[option] || option}</option>)}
      </select>
    </label>
  );
}

function SuggestionCard({ item, creating, onCreateDraft, locale }) {
  const { t } = useTranslation();
  const sizes = Object.entries(item.stock_by_size || {});
  const tone = statusTone[item.status] || statusTone.WATCH;
  const sellThrough = clampPercent(item.sell_through_percent);
  const threshold = clampPercent(item.reorder_trigger_percent);
  const suggestedQty = Number(item.suggested_qty || 0);

  return (
    <article className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition duration-200 hover:border-white/20 hover:bg-white/[0.055] lg:grid-cols-[220px_minmax(0,1fr)_220px]">
      <div className="flex min-w-0 items-center gap-3">
        <img src={imageFor(item.image_url)} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-white/10 bg-white/5 object-contain p-1" loading="lazy" />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-white">{item.product_name}</h3>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-bold text-zinc-400">
            <span>{item.color || t("purchases.reorder.noColor")}</span>
            <span aria-hidden="true">•</span>
            <span>{item.supplier_name || t("purchases.reorder.unspecifiedSupplier")}</span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-black text-zinc-300">
            <Boxes className="h-3 w-3" />
            {t("purchases.reorder.cartonQty", { qty: formatNumber(item.purchase_pack_qty || 1, 0, locale) })}
          </div>
        </div>
      </div>

      <div className="min-w-0 space-y-2">
        <div className="line-clamp-2 text-xs font-bold leading-5 text-zinc-200">{item.reason}</div>
        <SellThroughBar sellThrough={sellThrough} threshold={threshold} tone={tone} stock={item.current_stock} locale={locale} />
        <div className="flex flex-wrap gap-1.5">
          {sizes.length ? sizes.map(([size, value]) => (
            <SizeChip key={size} size={size} value={value} slow={Array.isArray(item.slow_sizes) && item.slow_sizes.includes(size)} locale={locale} />
          )) : <span className="rounded-full border border-white/10 bg-zinc-900 px-2.5 py-1 text-[11px] font-black text-zinc-400">{t("purchases.reorder.noSizes")}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-zinc-400">
          <Velocity item={item} locale={locale} />
          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{t("purchases.reorder.sold", { qty: formatNumber(item.sold_qty, 0, locale) })}</span>
          <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">{t("purchases.reorder.suggested", { qty: formatNumber(suggestedQty, 0, locale) })}</span>
        </div>
      </div>

      <div className="grid content-start gap-2">
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${tone.badge}`}>{t(`purchases.reorder.status.${item.status}`, item.status)}</span>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${riskTone[item.risk_level] || riskTone.LOW}`}>{t("purchases.reorder.risk", { level: item.risk_level || "LOW" })}</span>
        </div>
        {item.overstock_warning ? <span className="inline-flex w-fit items-center gap-1 rounded-full border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 text-[11px] font-black text-rose-100"><ShieldAlert className="h-3 w-3" /> {t("purchases.reorder.overstock")}</span> : null}
        <div className="grid grid-cols-3 gap-1.5">
          <MiniStat label={t("purchases.reorder.stock")} value={item.current_stock} locale={locale} />
          <MiniStat label={t("purchases.reorder.sales")} value={item.sold_qty} locale={locale} />
          <MiniStat label="%" value={sellThrough} locale={locale} />
        </div>
        <button
          type="button"
          onClick={onCreateDraft}
          disabled={creating || suggestedQty <= 0 || item.status === "DO_NOT_BUY"}
          className="mt-1 inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 text-xs font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-45"
          title={suggestedQty <= 0 || item.status === "DO_NOT_BUY" ? t("purchases.reorder.noSuggestedQty") : t("purchases.reorder.createDraft")}
        >
          <ShoppingBag className="h-4 w-4" />
          {creating ? t("purchases.reorder.creating") : t("purchases.reorder.createPurchaseInvoice")}
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}

function SellThroughBar({ sellThrough, threshold, tone, stock, locale }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-2">
      <div className="mb-1 flex items-center justify-between text-[11px] font-black text-zinc-400">
        <span>{t("purchases.reorder.sellThrough", { percent: formatNumber(sellThrough, 1, locale) })}</span>
        <span>{t("purchases.reorder.stockWithValue", { stock: formatNumber(stock, 0, locale) })}</span>
      </div>
      <div dir="ltr" className="relative h-2.5 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${tone.bar} transition-all duration-500`} style={{ width: `${sellThrough}%` }} />
        <div className="absolute top-0 h-full w-0.5 bg-white/80" style={{ left: `${threshold}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] font-bold text-zinc-500">
        <span>0%</span>
        <span>{t("purchases.reorder.reorderPoint", { percent: formatNumber(threshold, 1, locale) })}</span>
        <span>100%</span>
      </div>
    </div>
  );
}

function SizeChip({ size, value, slow, locale }) {
  const stock = Number(value?.stock || 0);
  const sold = Number(value?.sold || 0);
  const classes = stock <= 0
    ? "border-rose-400/35 bg-rose-400/12 text-rose-100"
    : slow
      ? "border-amber-400/35 bg-amber-400/12 text-amber-100"
      : "border-white/10 bg-zinc-900 text-zinc-200";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${classes}`}>
      {size}: {formatNumber(stock, 0, locale)} / {formatNumber(sold, 0, locale)}
    </span>
  );
}

function Velocity({ item, locale }) {
  const { t } = useTranslation();
  const hasVelocity = Number(item.average_daily_sales || 0) > 0 || Number(item.estimated_days_until_stockout || 0) > 0;
  if (!hasVelocity) {
    return <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-zinc-500">{t("purchases.reorder.noSalesVelocity")}</span>;
  }

  return (
    <>
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-100">
        <BarChart3 className="h-3 w-3" />
        {t("purchases.reorder.daily", { value: formatNumber(item.average_daily_sales, 2, locale) })}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
        <Timer className="h-3 w-3" />
        {t("purchases.reorder.stockoutIn", { days: formatNumber(item.estimated_days_until_stockout, 0, locale) })}
      </span>
    </>
  );
}

function MiniStat({ label, value, locale }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-2 py-1.5 text-center">
      <div className="text-[10px] font-black text-zinc-500">{label}</div>
      <div className="text-sm font-black text-white">{formatNumber(value, 1, locale)}</div>
    </div>
  );
}

export default ReorderSuggestions;

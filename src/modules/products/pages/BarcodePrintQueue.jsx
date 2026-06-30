import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Clock3, FileCheck2, Printer, RefreshCw, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import ProductsShell from "../components/ProductsShell";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import {
  deleteBarcodePrintQueue,
  getBarcodePrintQueue,
  markBarcodePrintQueuePrinted,
  requeueBarcodePrintQueue,
} from "../services/productsApi";

const statusTone = {
  ready: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  processing: "border-sky-400/30 bg-sky-500/10 text-sky-100",
  pending: "border-amber-400/30 bg-amber-500/10 text-amber-100",
  failed: "border-rose-400/30 bg-rose-500/10 text-rose-100",
  printed: "border-sky-400/30 bg-sky-500/10 text-sky-100",
};

const formatDateTime = (value, locale = "en") => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const normalizeVariantIds = (value = []) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

export default function BarcodePrintQueue() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPrinted, setShowPrinted] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      setError("");
      const rows = await getBarcodePrintQueue({
        params: {
          includePrinted: showPrinted ? "true" : "false",
        },
      });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (loadError) {
      console.error("[barcode-print-queue] load failed", loadError);
      setItems([]);
      setError(loadError?.message || t("products.barcodePrintQueue.loadFailed", "Failed to load barcode print queue"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showPrinted, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasProcessing = useMemo(
    () => Array.isArray(items) && items.some((item) => String(item?.status || "").toLowerCase() === "processing"),
    [items]
  );

  useEffect(() => {
    if (!hasProcessing) return undefined;
    const interval = setInterval(() => {
      void load({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [hasProcessing, load]);

  const counts = useMemo(() => {
    const summary = { ready: 0, processing: 0, pending: 0, failed: 0, printed: 0 };
    for (const item of Array.isArray(items) ? items : []) {
      const status = String(item?.status || "pending").toLowerCase();
      if (summary[status] !== undefined) summary[status] += 1;
    }
    return summary;
  }, [items]);

  const openLabels = (item) => {
    const variantIds = normalizeVariantIds(item?.variant_ids);
    const params = new URLSearchParams();
    if (item?.product_id) params.set("productId", String(item.product_id));
    if (item?.color) params.set("color", String(item.color));
    if (variantIds.length) params.set("variantIds", variantIds.join(","));
    navigate(`/products/barcode-labels?${params.toString()}`);
  };

  const runAction = async (item, action) => {
    if (!item?.id) return;
    try {
      setBusyId(item.id);
      if (action === "printed") {
        await markBarcodePrintQueuePrinted(item.id);
      } else if (action === "regenerate") {
        await requeueBarcodePrintQueue(item.id);
      } else if (action === "delete") {
        await deleteBarcodePrintQueue(item.id);
      }
      await load({ silent: true });
    } catch (actionError) {
      console.error("[barcode-print-queue] action failed", {
        action,
        id: item.id,
        message: actionError?.message,
      });
      toast.error(actionError?.message || t("common.error", "Something went wrong"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ProductsShell
      title={t("products.barcodePrintQueue.title", "Barcode Print Queue")}
      description={t(
        "products.barcodePrintQueue.description",
        "Prepared thermal label jobs waiting for manual printing."
      )}
    >
      <div className="rounded-[32px] border border-white/10 bg-zinc-950/80 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.22)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
              {t("products.barcodePrintQueue.eyebrow", "Barcode queue")}
            </p>
            <h2 className="text-2xl font-black tracking-tight text-white">
              {t("products.barcodePrintQueue.title", "Barcode Print Queue")}
            </h2>
            <p className="max-w-2xl text-sm leading-6 text-zinc-400">
              {t(
                "products.barcodePrintQueue.description",
                "Prepared thermal label jobs waiting for manual printing."
              )}
            </p>
          </div>

          <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">
            <input
              type="checkbox"
              checked={showPrinted}
              onChange={(event) => setShowPrinted(event.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-transparent text-emerald-400"
            />
            {t("products.barcodePrintQueue.showPrinted", "Show printed")}
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["ready", t("products.barcodePrintQueue.ready", "Ready")],
            ["processing", t("products.barcodePrintQueue.processing", "Processing")],
            ["pending", t("products.barcodePrintQueue.pending", "Pending")],
            ["failed", t("products.barcodePrintQueue.failed", "Failed")],
            ["printed", t("products.barcodePrintQueue.printed", "Printed")],
          ].map(([key, label]) => (
            <div key={key} className="rounded-[20px] border border-white/10 bg-white/5 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
              <div className="mt-2 text-2xl font-black text-white">{counts[key] || 0}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
            {t("common.loading", "Loading...")}
          </div>
        ) : error ? (
          <div className="mt-6 rounded-[24px] border border-rose-400/20 bg-rose-500/10 p-6 text-sm text-rose-100">
            {error}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-6 rounded-[24px] border border-dashed border-white/10 bg-white/5 p-8 text-center text-zinc-400">
            {t(
              "products.barcodePrintQueue.empty",
              "No barcode print queue items yet."
            )}
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {items.map((item) => {
              const status = String(item?.status || "pending").toLowerCase();
              const thermalPreview = item?.thermal_image_url || item?.product_thermal_image_url || item?.image_url || item?.product_image_url || "";
              const variantIds = normalizeVariantIds(item?.variant_ids);
              const canPrint = status === "ready";
              return (
                <article key={item.id} className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04]">
                  <div className="grid gap-4 p-4 lg:grid-cols-[140px_minmax(0,1fr)_auto] lg:items-center">
                    <div className="flex h-32 items-center justify-center overflow-hidden rounded-[20px] border border-white/10 bg-zinc-900">
                      {thermalPreview ? (
                        <img
                          src={resolveProductImageUrl(thermalPreview)}
                          alt={item?.product_name || "Barcode queue item"}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="text-xs font-semibold text-zinc-500">
                          {t("products.barcodePrintQueue.noImage", "No image")}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone[status] || statusTone.pending}`}>
                          {t(`products.barcodePrintQueue.status.${status}`, status)}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
                          {t("products.barcodePrintQueue.labels", { count: Number(item?.label_count || 0) })}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-300">
                          {variantIds.length} variants
                        </span>
                      </div>

                      <h3 className="text-xl font-black text-white">
                        {item?.product_name || `Product #${item?.product_id || ""}`}
                      </h3>
                      <div className="flex flex-wrap gap-2 text-sm text-zinc-300">
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          {t("products.barcodePrintQueue.color", "Color")}: {item?.color || t("products.barcodePrintQueue.defaultColor", "Default")}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          {t("products.barcodePrintQueue.createdAt", "Created")}: {formatDateTime(item?.created_at, i18n.language)}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                          {t("products.barcodePrintQueue.updatedAt", "Updated")}: {formatDateTime(item?.updated_at, i18n.language)}
                        </span>
                      </div>
                      {item?.error_message ? (
                        <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                          {item.error_message}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
                      <button
                        type="button"
                        onClick={() => openLabels(item)}
                        disabled={!canPrint || busyId === item.id}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Printer size={16} />
                        {t("products.barcodePrintQueue.printLabels", "Print labels")}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(item, "printed")}
                        disabled={busyId === item.id || status === "printed"}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FileCheck2 size={16} />
                        {t("products.barcodePrintQueue.markPrinted", "Mark printed")}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(item, "regenerate")}
                        disabled={busyId === item.id || status === "processing"}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RefreshCw size={16} />
                        {t("products.barcodePrintQueue.regenerateThermal", "Regenerate thermal")}
                      </button>
                      <button
                        type="button"
                        onClick={() => runAction(item, "delete")}
                        disabled={busyId === item.id}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 size={16} />
                        {t("products.barcodePrintQueue.remove", "Remove")}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-2">
                      <Clock3 size={14} />
                      {item?.source || "thermal_ready"}
                    </span>
                    <span className="font-mono">
                      {item?.color_key || ""}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </ProductsShell>
  );
}

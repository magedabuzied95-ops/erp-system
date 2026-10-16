import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed, Loader2, Package, UserRound } from "lucide-react";
import { managerPortalApi } from "../services/managerPortalApi";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

// تغطية الجرد: every model the shop carries this month, split into what was
// counted and what was not, filtered by رجالي / حريمي / أطفال.

const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));
const formatDay = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short" }).format(date);
};
const cairoMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date());
const shiftMonth = (month, delta) => {
  const [y, m] = String(month).split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (month) => {
  const [y, m] = String(month).split("-").map(Number);
  return new Intl.DateTimeFormat("ar-EG", { month: "long", year: "numeric" }).format(new Date(y, m - 1, 1));
};

// Everyone who counted a colour of the model; an older server only sends the latest one.
const counterNames = (model = {}) => {
  const names = Array.isArray(model.counted_by_names) && model.counted_by_names.length ? model.counted_by_names : [model.counted_by];
  return [...new Set(names.map((name) => String(name || "").trim()).filter(Boolean))];
};

const AUDIENCES = [
  { id: "all", label: "الكل" },
  { id: "men", label: "رجالي" },
  { id: "women", label: "حريمي" },
  { id: "kids", label: "أطفال" },
];
const AUDIENCE_LABEL = { men: "رجالي", women: "حريمي", kids: "أطفال" };
const COUNT_STATUS = {
  completed: { label: "معتمد", tone: "bg-emerald-500/10 text-emerald-300 border-emerald-400/20" },
  pending_review: { label: "مستني المراجعة", tone: "bg-primary/10 text-primary border-primary/20" },
  in_progress: { label: "لسه شغال", tone: "bg-amber-500/10 text-amber-300 border-amber-400/20" },
  rejected: { label: "مرفوض", tone: "bg-rose-500/10 text-rose-300 border-rose-400/20" },
};

// `load` lets the employee portal reuse this with its own endpoint; the manager
// portal passes nothing and gets its token-bound one.
export default function InventoryCoverage({ token, load = managerPortalApi.inventoryCoverage, className = "manager-inventory-panel" }) {
  const [month, setMonth] = useState(cairoMonth());
  const [audience, setAudience] = useState("all");
  const [view, setView] = useState("missing");
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    load(token, { month })
      .then((res) => { if (alive) setState({ loading: false, error: "", data: res?.coverage || null }); })
      .catch((error) => { if (alive) setState({ loading: false, error: error?.responseBody?.message || error?.message || "تعذر التحميل", data: null }); });
    return () => { alive = false; };
  }, [token, month]);

  // The server sends every model once; the audience and counted/missing filters are
  // local so switching between them is instant.
  const models = useMemo(() => {
    const rows = state.data?.models || [];
    return audience === "all" ? rows : rows.filter((row) => row.audiences.includes(audience));
  }, [state.data, audience]);
  const counted = models.filter((row) => row.counted);
  const missing = models.filter((row) => !row.counted);
  const visible = view === "counted" ? counted : missing;
  const summary = state.data?.summary || {};
  const percent = models.length ? Math.round((counted.length / models.length) * 100) : 0;
  const isCurrentMonth = month >= cairoMonth();

  return (
    <div className={`${className} space-y-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-3 shadow-xl sm:p-4`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="الشهر اللي قبله" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="rounded-full border border-border bg-surface p-1.5 text-text"><ChevronRight className="h-4 w-4" /></button>
        <div className="text-sm font-black text-text">{monthLabel(month)}</div>
        <button type="button" aria-label="الشهر اللي بعده" disabled={isCurrentMonth} onClick={() => setMonth((m) => shiftMonth(m, 1))} className="rounded-full border border-border bg-surface p-1.5 text-text disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-[var(--radius-control)] border border-border bg-surface p-1">
        {AUDIENCES.map((option) => {
          const stats = summary[option.id] || { total: 0, counted: 0 };
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setAudience(option.id)}
              className={`flex-1 shrink-0 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-2 text-xs font-black transition ${audience === option.id ? "bg-primary text-[var(--primary-contrast)]" : "text-text-muted hover:bg-surface-hover"}`}
            >
              {option.label} <span className="tabular-nums opacity-80">{formatNumber(stats.counted)}/{formatNumber(stats.total)}</span>
            </button>
          );
        })}
      </div>

      {state.loading ? (
        <div className="flex min-h-40 items-center justify-center text-text-muted"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : state.error ? (
        <div className="rounded-[var(--radius-card)] border border-rose-400/20 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">{state.error}</div>
      ) : (
        <>
          <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2 text-sm font-black text-text">
              <span>{`اتجرد ${formatNumber(counted.length)} من ${formatNumber(models.length)} موديل`}</span>
              <span className="tabular-nums text-text-muted">{`${formatNumber(percent)}%`}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-soft">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${percent}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-border bg-surface p-1">
            <button
              type="button"
              onClick={() => setView("missing")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-xs font-black transition ${view === "missing" ? "bg-amber-500/15 text-amber-300" : "text-text-muted hover:bg-surface-hover"}`}
            >
              <CircleDashed className="h-3.5 w-3.5" />
              {`لسه ما اتجردش (${formatNumber(missing.length)})`}
            </button>
            <button
              type="button"
              onClick={() => setView("counted")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-xs font-black transition ${view === "counted" ? "bg-emerald-500/15 text-emerald-300" : "text-text-muted hover:bg-surface-hover"}`}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {`اتجرد (${formatNumber(counted.length)})`}
            </button>
          </div>

          {visible.length ? (
            <div className="divide-y divide-border overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              {visible.map((model) => {
                const status = model.count_status ? COUNT_STATUS[model.count_status] || COUNT_STATUS.in_progress : null;
                const image = model.image_url ? resolveProductImageUrl(model.image_url) : "";
                return (
                  <div key={model.product_id} className="flex items-center gap-3 p-2.5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface-soft">
                      {image ? <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-text-muted" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span dir="auto" className="truncate text-start text-sm font-black text-text">{model.name || "—"}</span>
                        {status ? <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black ${status.tone}`}>{status.label}</span> : null}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-text-muted">
                        {model.audiences.length ? <span>{model.audiences.map((key) => AUDIENCE_LABEL[key]).join(" · ")}</span> : null}
                        <span className="tabular-nums">{`مخزون ${formatNumber(model.stock)}`}</span>
                        {model.counted ? (
                          <span className="tabular-nums">{`${formatNumber(model.counted_colors)} من ${formatNumber(model.colors || model.counted_colors)} لون`}</span>
                        ) : (
                          <span className="tabular-nums">{`${formatNumber(model.colors)} لون`}</span>
                        )}
                      </div>
                      {model.counted ? (
                        <>
                          <div className="mt-0.5 truncate text-[11px] font-bold text-text-muted">{formatDay(model.last_counted_at)}</div>
                          {counterNames(model).length ? (
                            <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-black text-text">
                              <UserRound className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                              <span className="shrink-0 text-text-muted">جرده:</span>
                              <span dir="auto" className="truncate">{counterNames(model).join("، ")}</span>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center text-sm font-bold text-text-muted">
              {view === "missing" ? "كل الموديلات اتجردت الشهر ده" : "مفيش موديل اتجرد الشهر ده"}
            </div>
          )}
        </>
      )}
    </div>
  );
}

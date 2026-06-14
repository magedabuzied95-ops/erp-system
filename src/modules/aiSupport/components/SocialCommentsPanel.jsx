import { useMemo, memo } from "react";
import { ExternalLink, RefreshCw, MessageSquareText, User } from "lucide-react";

const clean = (value = "") => String(value || "").trim();
const absoluteTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value);
  return date.toLocaleString("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "lead_price", label: "سعر" },
  { key: "lead_size", label: "مقاس" },
  { key: "lead_shipping", label: "شحن" },
  { key: "lead_details", label: "تفاصيل" },
  { key: "lead_inbox", label: "Inbox" },
  { key: "ignore", label: "تجاهل" },
  { key: "human_review", label: "مراجعة" },
];

const FILTER_LABELS = {
  all: "الكل",
  lead_price: "سعر",
  lead_size: "مقاس",
  lead_shipping: "شحن",
  lead_details: "تفاصيل",
  lead_inbox: "Inbox",
  ignore: "تجاهل",
  human_review: "مراجعة",
};

const labelMatchesFilter = (item = {}, filter = "all") => {
  if (filter === "all") return true;
  const label = clean(item.classification_label).toLowerCase();
  if (filter === "ignore") return ["ignore", "engagement_only"].includes(label);
  if (filter === "human_review") return label === "human_review";
  return label === filter;
};

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key === "instagram") {
    return {
      label: "Instagram",
      tone: "rose",
      className: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    };
  }
  return {
    label: "Facebook",
    tone: "cyan",
    className: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
  };
};

const labelToneClass = (label = "") => {
  const key = clean(label).toLowerCase();
  if (key === "lead_price") return "border-emerald-300/20 bg-emerald-400/10 text-emerald-100";
  if (key === "lead_size") return "border-amber-300/20 bg-amber-400/10 text-amber-100";
  if (key === "lead_shipping") return "border-cyan-300/20 bg-cyan-400/10 text-cyan-100";
  if (key === "lead_details") return "border-violet-300/20 bg-violet-400/10 text-violet-100";
  if (key === "lead_inbox") return "border-slate-300/20 bg-slate-400/10 text-slate-100";
  if (key === "human_review") return "border-rose-300/20 bg-rose-400/10 text-rose-100";
  if (key === "engagement_only" || key === "ignore") return "border-white/10 bg-white/[0.055] text-slate-200";
  return "border-white/10 bg-white/[0.055] text-slate-200";
};

const socialCommentSortValue = (item = {}) => new Date(item.created_at || 0).getTime() || 0;

function SocialCommentsPanel({
  items = [],
  loading = false,
  error = "",
  filter = "all",
  debugInfo = null,
  onFilterChange,
  onRefresh,
}) {
  const filteredItems = useMemo(
    () => [...items].filter((item) => labelMatchesFilter(item, filter)).sort((a, b) => socialCommentSortValue(b) - socialCommentSortValue(a)),
    [filter, items]
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">
            <MessageSquareText className="h-4 w-4" />
            تعليقات السوشيال
          </div>
          <div className="mt-1 text-sm font-black text-white">آخر التعليقات المخزنة في نظام الأتمتة</div>
          {debugInfo ? (
            <div className="mt-1 text-[11px] font-semibold leading-5 text-slate-400">
              {debugInfo.request_url ? <span className="mr-2">URL: {debugInfo.request_url}</span> : null}
              {debugInfo.tenant_id ? <span className="mr-2">tenant: {debugInfo.tenant_id}</span> : null}
              {typeof debugInfo.status !== "undefined" ? <span className="mr-2">status: {String(debugInfo.status)}</span> : null}
              {typeof debugInfo.count !== "undefined" ? <span>count: {String(debugInfo.count)}</span> : null}
              {debugInfo.error ? <span className="block text-rose-200">error: {debugInfo.error}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.055] px-3 text-xs font-black text-slate-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            تحديث
          </button>
          <span className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-1 text-[11px] font-black text-slate-200">
            {filteredItems.length}/{items.length}
          </span>
        </div>
      </div>

      {error ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const active = filter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilterChange?.(item.key)}
              className={`h-9 shrink-0 rounded-full px-3 text-[11px] font-black transition ${
                active ? "bg-cyan-300 text-slate-950" : "border border-white/10 bg-white/[0.055] text-white hover:border-white/20"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 max-h-[26rem] overflow-y-auto pr-1">
        {loading && !items.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">جارٍ تحميل تعليقات السوشيال...</div>
        ) : null}

        {!loading && filteredItems.length ? (
          <div className="space-y-2">
            {filteredItems.slice(0, 50).map((item) => {
              const platform = platformMeta(item.platform);
              const label = FILTER_LABELS[clean(item.classification_label).toLowerCase()] || clean(item.classification_label) || "غير مصنف";
              const permalink = clean(item.post_permalink);
              const commentText = clean(item.original_comment_text || "");
              return (
                <article key={item.id || `${item.platform}:${item.comment_id}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${platform.className}`}>
                        <User className="h-3.5 w-3.5" />
                        {platform.label}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${labelToneClass(item.classification_label)}`}>
                        {label}
                      </span>
                    </div>
                    {item.action_taken ? (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                        {clean(item.action_taken)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-white">{clean(item.commenter_name) || "مستخدم مجهول"}</div>
                      <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{commentText || "بدون نص"}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-black text-slate-400">
                    {permalink ? (
                      <a
                        href={permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-cyan-100"
                      >
                        فتح المنشور
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                    {item.post_id ? <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">post_id: {item.post_id}</span> : null}
                    {item.comment_id ? <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">comment_id: {item.comment_id}</span> : null}
                    {item.created_at ? <span className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">{absoluteTime(item.created_at)}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : !loading ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">
            لا توجد تعليقات مخزنة تطابق المرشح الحالي.
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default memo(SocialCommentsPanel);

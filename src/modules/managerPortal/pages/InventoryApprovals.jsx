import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { managerPortalApi } from "../services/managerPortalApi";
import usePageTitle from "../../../shared/hooks/usePageTitle";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";

const resolveStoredToken = () => {
  if (typeof window === "undefined") return "";
  const directToken = new URLSearchParams(window.location.search).get("token") || "";
  if (directToken) return directToken;
  const lastUrl = String(window.localStorage.getItem("manager_portal_last_url") || "").trim();
  if (!lastUrl) return "";
  try {
    const parsed = new URL(lastUrl, window.location.origin);
    const token = parsed.pathname.split("/").filter(Boolean)[1] || "";
    return token;
  } catch {
    return "";
  }
};

const text = (value = "", fallback = "-") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

const formatNumber = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const itemColor = (item = {}) => text(item.variant_color || item.color, "");
const itemSize = (item = {}) => text(item.variant_size || item.size, "");
const itemImage = (item = {}) => resolveProductImageUrl(
  item.color_image_url || item.variant_image_url || item.primary_image_url || item.main_image_url ||
  item.image_url || item.product_image_url || item.product_image || item.main_image || ""
);

const statusTone = (status = "") => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "pending_review") return "bg-sky-500/10 text-sky-100 border-sky-400/20";
  if (normalized === "rejected") return "bg-rose-500/10 text-rose-100 border-rose-400/20";
  if (normalized === "completed") return "bg-emerald-500/10 text-emerald-100 border-emerald-400/20";
  return "bg-white/5 text-slate-100 border-white/10";
};

export default function InventoryApprovalsPage() {
  const navigate = useNavigate();
  const { token: routeToken = "" } = useParams();
  const [searchParams] = useSearchParams();
  usePageTitle("Inventory Approvals");
  const token = routeToken || searchParams.get("token") || resolveStoredToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({});
  const [sessions, setSessions] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 5, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const detailRef = useRef(null);
  const lastPortalUrl = typeof window !== "undefined" ? String(window.localStorage.getItem("manager_portal_last_url") || "").trim() : "";

  const selectedSession = selectedApproval?.session || null;
  const selectedItems = Array.isArray(selectedApproval?.items) ? selectedApproval.items : [];
  const sortedSelectedItems = useMemo(() => {
    const collator = new Intl.Collator(["ar", "en"], { numeric: true, sensitivity: "base" });
    return selectedItems
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const leftSize = itemSize(left.item);
        const rightSize = itemSize(right.item);
        if (!leftSize && rightSize) return 1;
        if (leftSize && !rightSize) return -1;
        const sizeOrder = collator.compare(leftSize, rightSize);
        if (sizeOrder) return sizeOrder;
        const productOrder = collator.compare(text(left.item.product_name, ""), text(right.item.product_name, ""));
        if (productOrder) return productOrder;
        const colorOrder = collator.compare(itemColor(left.item), itemColor(right.item));
        return colorOrder || left.index - right.index;
      })
      .map(({ item }) => item);
  }, [selectedItems]);
  const sessionSummary = useMemo(() => {
    const totals = selectedItems.reduce((acc, item) => {
      const system = Number(item.system_quantity || item.expected_qty || 0);
      const counted = Number(item.counted_quantity || item.actual_qty || 0);
      const diff = Number(item.difference_quantity || item.difference_qty || counted - system);
      if (diff > 0) acc.increase += diff;
      if (diff < 0) acc.shortage += Math.abs(diff);
      acc.total += Math.abs(diff);
      acc.items += 1;
      return acc;
    }, { items: 0, increase: 0, shortage: 0, total: 0 });
    return totals;
  }, [selectedItems]);

  const loadApprovals = async (nextSessionId = "") => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const response = await managerPortalApi.inventoryApprovals(token, { page: pagination.page || 1, limit: pagination.limit || 5, search });
      const payload = response?.inventoryApprovals || {};
      setSummary(payload.summary || {});
      setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      setPagination(payload.pagination || { total: 0, page: 1, limit: 5, totalPages: 1 });
      const availableSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
      const requestedSession = nextSessionId
        ? availableSessions.find((session) => String(session.id) === String(nextSessionId))
        : null;
      const firstSessionId = requestedSession?.id || availableSessions[0]?.id || "";
      if (firstSessionId) {
        setSelectedSessionId(String(firstSessionId));
      } else {
        setSelectedSessionId("");
        setSelectedApproval(null);
      }
    } catch (err) {
      setError(err?.responseBody?.message || err?.message || "تعذر تحميل اعتمادات الجرد");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (sessionId) => {
    if (!token || !sessionId) return;
    try {
      setSelectedLoading(true);
      const response = await managerPortalApi.inventoryApproval(token, sessionId);
      setSelectedApproval(response?.approval || null);
    } catch (err) {
      toast.error(err?.responseBody?.message || err?.message || "تعذر تحميل تفاصيل الجرد");
    } finally {
      setSelectedLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    void loadApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (!selectedSessionId) return;
    void loadDetail(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  const handleSearch = async (event) => {
    event.preventDefault();
    await loadApprovals();
  };

  const selectSession = (sessionId) => {
    setSelectedSessionId(String(sessionId));
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      window.setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  };

  const handleApprove = async () => {
    if (!token || !selectedSessionId) return;
    try {
      setApproving(true);
      await managerPortalApi.approveInventoryApproval(token, selectedSessionId);
      toast.success("تم اعتماد الجرد");
      setSelectedSessionId("");
      setSelectedApproval(null);
      await loadApprovals();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err?.responseBody?.message || err?.message || "تعذر اعتماد الجرد");
    } finally {
      setApproving(false);
    }
  };

  const openRejectDialog = () => {
    setRejectReason("");
    setRejectOpen(true);
  };

  const handleReject = async () => {
    if (!token || !selectedSessionId || !rejectReason.trim()) {
      toast.error("سبب الرفض مطلوب");
      return;
    }
    try {
      setRejecting(true);
      await managerPortalApi.rejectInventoryApproval(token, selectedSessionId, { rejectionReason: rejectReason.trim() });
      toast.success("تم رفض الجرد");
      setRejectOpen(false);
      setRejectReason("");
      setSelectedSessionId("");
      setSelectedApproval(null);
      await loadApprovals();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err?.responseBody?.message || err?.message || "تعذر رفض الجرد");
    } finally {
      setRejecting(false);
    }
  };

  if (!token) {
    return (
      <main dir="rtl" className="min-h-[100dvh] bg-[linear-gradient(180deg,#0f172a_0%,#111827_55%,#0b1220_100%)] px-4 py-6 text-white">
        <div className="mx-auto max-w-2xl rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-amber-300" />
            <div>
              <h1 className="text-2xl font-black">اعتمادات الجرد</h1>
              <p className="mt-1 text-sm text-slate-300">لا يوجد رمز بوابة صالح. افتح بوابة المدير ثم أعد المحاولة.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(lastPortalUrl || "/")}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-3 text-sm font-black text-black transition hover:bg-amber-300"
          >
            <ArrowLeft className="h-4 w-4" />
            العودة للبوابة
          </button>
        </div>
      </main>
    );
  }

  return (
    <main dir="rtl" className="min-h-[100dvh] overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(15,23,42,0.16),_transparent_30%),radial-gradient(circle_at_85%_0%,_rgba(245,158,11,0.12),_transparent_18%),linear-gradient(180deg,#0f172a_0%,#111827_46%,#0b1220_100%)] px-3 py-3 text-white sm:px-4 sm:py-4">
      <div className="mx-auto max-w-[96rem] space-y-4">
        <header className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur sm:rounded-[2rem] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="hidden text-xs font-black uppercase tracking-[0.22em] text-slate-400 sm:block">مركز اعتماد الجرد</div>
              <h1 className="text-2xl font-black sm:mt-2 sm:text-3xl">اعتمادات الجرد</h1>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-300 sm:mt-2 sm:text-sm sm:leading-6">
                راجع الجلسات قيد المراجعة، وافق على الفروقات أو ارفضها مع سبب واضح قبل تعديل المخزون.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => loadApprovals(selectedSessionId)}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition hover:bg-white/10"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                تحديث
              </button>
              <button
                type="button"
                onClick={() => navigate(`/manager-portal/${encodeURIComponent(token)}`)}
                className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white transition hover:bg-white/10"
              >
                <ArrowLeft className="h-4 w-4" />
                العودة للبوابة
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <StatCard title="جردات بانتظار المراجعة" value={summary.pending_review_count || 0} icon={ClipboardList} tone="amber" />
          <StatCard title="جردات مرفوضة" value={summary.rejected_count || 0} icon={X} tone="rose" />
          <StatCard title="جردات مكتملة اليوم" value={summary.completed_today_count || 0} icon={CheckCircle2} tone="emerald" />
          <StatCard title="إجمالي فروقات اليوم" value={summary.today_difference_total || 0} icon={Package} tone="sky" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-xl backdrop-blur">
            <form onSubmit={handleSearch} className="mb-4">
              <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-slate-400">بحث</label>
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث باسم الجرد أو الفرع أو المخزن"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm font-semibold outline-none placeholder:text-slate-500"
                />
                <button type="submit" className="inline-flex items-center justify-center rounded-2xl bg-amber-400 px-4 text-sm font-black text-black">
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </form>

            <div className="flex items-center justify-between text-xs font-bold text-slate-400">
              <span>الجلسات المعروضة</span>
              <span>{formatNumber(pagination.total || sessions.length || 0)}</span>
            </div>

            <div className="mt-3 space-y-3">
              {loading ? (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-300">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  <div className="mt-2">جاري تحميل الجردات...</div>
                </div>
              ) : sessions.length ? (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => selectSession(session.id)}
                    className={`w-full rounded-3xl border p-4 text-right transition ${
                      String(selectedSessionId) === String(session.id)
                        ? "border-amber-300/40 bg-amber-400/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-black text-white">{text(session.title, "جرد")}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-300">
                          <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {text(session.branch_name, "الفرع غير محدد")}</span>
                          <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" /> {text(session.warehouse_name, "المخزن غير محدد")}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
                          <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {text(session.created_by_name, "غير معروف")}</span>
                          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatDateTime(session.created_at)}</span>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black ${statusTone(session.status)}`}>
                        {session.status === "pending_review" ? "قيد المراجعة" : session.status === "rejected" ? "مرفوض" : session.status === "completed" ? "مكتمل" : session.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-300">
                      <span className="rounded-full bg-white/5 px-2.5 py-1">الأصناف: {formatNumber(session.item_count || 0)}</span>
                      <span className="rounded-full bg-white/5 px-2.5 py-1">إجمالي الفروقات: {formatNumber(session.difference_total || 0)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-sm text-slate-300">
                  <ClipboardList className="mx-auto h-8 w-8 text-slate-500" />
                  <div className="mt-3 font-bold">لا توجد جلسات قيد المراجعة الآن</div>
                  <div className="mt-1 text-xs text-slate-400">ستظهر هنا الجردات التي أرسلها أمين المخزن للمراجعة.</div>
                </div>
              )}
            </div>
          </div>

          <div ref={detailRef} className="scroll-mt-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-3 shadow-xl backdrop-blur sm:rounded-[2rem] sm:p-4">
            {selectedLoading ? (
              <div className="flex min-h-[28rem] items-center justify-center text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="mr-2">جاري تحميل تفاصيل الجرد...</span>
              </div>
            ) : selectedSession ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">تفاصيل الجلسة</div>
                    <h2 className="mt-1 text-2xl font-black text-white">{text(selectedSession.title, "جرد")}</h2>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-300">
                      <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {text(selectedSession.branch_name, "الفرع غير محدد")}</span>
                      <span className="inline-flex items-center gap-1"><Store className="h-4 w-4" /> {text(selectedSession.warehouse_name, "المخزن غير محدد")}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {text(selectedSession.created_by_name, "غير معروف")}</span>
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {formatDateTime(selectedSession.created_at)}</span>
                    </div>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(selectedSession.status)}`}>
                    {selectedSession.status === "pending_review" ? "في انتظار موافقة المدير" : selectedSession.status === "rejected" ? "مرفوض" : selectedSession.status === "completed" ? "مكتمل" : selectedSession.status}
                  </span>
                </div>

                {selectedSession.status === "rejected" && selectedSession.rejection_reason ? (
                  <div className="mt-4 rounded-3xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-50">
                    <div className="font-black">سبب الرفض</div>
                    <div className="mt-1 leading-6">{selectedSession.rejection_reason}</div>
                  </div>
                ) : null}

                <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  <InfoStat title="عدد الأصناف" value={sessionSummary.items || 0} icon={Package} tone="sky" />
                  <InfoStat title="إجمالي الزيادة" value={sessionSummary.increase || 0} icon={TrendingUp} tone="emerald" />
                  <InfoStat title="إجمالي العجز" value={sessionSummary.shortage || 0} icon={TrendingDown} tone="rose" />
                  <InfoStat title="إجمالي الفروقات" value={sessionSummary.total || 0} icon={ClipboardList} tone="amber" />
                </section>

                <div className="mt-4 space-y-2 md:hidden">
                  {sortedSelectedItems.length ? sortedSelectedItems.map((item) => {
                    const system = Number(item.system_quantity || item.expected_qty || 0);
                    const counted = Number(item.counted_quantity || item.actual_qty || 0);
                    const diff = Number(item.difference_quantity || item.difference_qty || counted - system);
                    const color = itemColor(item);
                    const size = itemSize(item);
                    const imageUrl = itemImage(item);
                    return (
                      <article key={`mobile-${item.id || `${item.product_variant_id || item.variant_id}-${item.color}-${item.size}`}`} className="rounded-2xl border border-white/10 bg-slate-950/45 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                              {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-slate-500" />}
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-sm font-black leading-5 text-white">{text(item.product_name, "منتج")}</h3>
                              {(color || size) ? <p className="mt-1 text-xs text-slate-400">{[color, size].filter(Boolean).join(" • ")}</p> : null}
                              {item.variant_sku || item.variant_barcode ? <p className="mt-1 truncate text-[10px] text-slate-500">{item.variant_sku || item.variant_barcode}</p> : null}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-xl px-2.5 py-1 text-sm font-black ${diff > 0 ? "bg-emerald-500/15 text-emerald-300" : diff < 0 ? "bg-rose-500/15 text-rose-300" : "bg-white/5 text-slate-300"}`}>
                            {diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-xl bg-white/5 p-2"><span className="text-slate-400">السيستم</span><strong className="mr-2 text-white">{formatNumber(system)}</strong></div>
                          <div className="rounded-xl bg-white/5 p-2"><span className="text-slate-400">الفعلي</span><strong className="mr-2 text-white">{formatNumber(counted)}</strong></div>
                        </div>
                        {item.reason || item.notes ? <p className="mt-2 text-xs leading-5 text-slate-300">{[item.reason, item.notes].map((value) => text(value, "")).filter(Boolean).join(" — ")}</p> : null}
                      </article>
                    );
                  }) : <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">لا توجد أصناف داخل الجرد.</div>}
                </div>

                <div className="mt-4 hidden overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-950/45 md:block">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-right text-sm">
                      <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-300">
                        <tr>
                          <th className="px-4 py-3">المنتج</th>
                          <th className="px-4 py-3">اللون</th>
                          <th className="px-4 py-3">المقاس</th>
                          <th className="px-4 py-3">كمية السيستم</th>
                          <th className="px-4 py-3">الكمية الفعلية</th>
                          <th className="px-4 py-3">الفرق</th>
                          <th className="px-4 py-3">السبب</th>
                          <th className="px-4 py-3">الملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSelectedItems.length ? sortedSelectedItems.map((item) => {
                          const system = Number(item.system_quantity || item.expected_qty || 0);
                          const counted = Number(item.counted_quantity || item.actual_qty || 0);
                          const diff = Number(item.difference_quantity || item.difference_qty || counted - system);
                          const imageUrl = itemImage(item);
                          return (
                            <tr key={item.id || `${item.product_variant_id || item.variant_id}-${item.color}-${item.size}`} className="border-t border-white/5">
                              <td className="px-4 py-3 font-semibold text-white"><div className="flex items-center gap-2">{imageUrl ? <img src={imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" /> : null}<span>{text(item.product_name, "منتج")}</span></div></td>
                              <td className="px-4 py-3 text-slate-300">{text(item.variant_color || item.color, "-")}</td>
                              <td className="px-4 py-3 text-slate-300">{text(item.variant_size || item.size, "-")}</td>
                              <td className="px-4 py-3 font-semibold text-slate-200">{formatNumber(system)}</td>
                              <td className="px-4 py-3 font-semibold text-slate-200">{formatNumber(counted)}</td>
                              <td className={`px-4 py-3 font-black ${diff > 0 ? "text-emerald-300" : diff < 0 ? "text-rose-300" : "text-slate-300"}`}>{diff > 0 ? `+${formatNumber(diff)}` : formatNumber(diff)}</td>
                              <td className="px-4 py-3 text-slate-300">{text(item.reason, "-")}</td>
                              <td className="px-4 py-3 text-slate-300">{text(item.notes, "-")}</td>
                            </tr>
                          );
                        }) : (
                          <tr>
                            <td colSpan={8} className="px-4 py-10 text-center text-slate-400">لا توجد أصناف داخل الجرد.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="sticky bottom-2 z-20 mt-4 rounded-2xl border border-white/10 bg-slate-950/90 p-2 shadow-2xl backdrop-blur sm:static sm:flex sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      onClick={openRejectDialog}
                      disabled={selectedSession.status !== "pending_review"}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500 px-3 py-3 text-sm font-black text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40 sm:rounded-2xl sm:px-4"
                    >
                      <X className="h-4 w-4" />
                      رفض
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApprove()}
                      disabled={approving || selectedSession.status !== "pending_review"}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3 py-3 text-sm font-black text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50 sm:rounded-2xl sm:px-4"
                    >
                      {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      موافقة واعتماد
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[28rem] items-center justify-center rounded-[1.75rem] border border-dashed border-white/10 bg-white/5 text-center text-slate-300">
                <div>
                  <ClipboardList className="mx-auto h-10 w-10 text-slate-500" />
                  <div className="mt-3 text-lg font-black">اختر جلسة من القائمة</div>
                  <div className="mt-1 text-sm">سيظهر ملخص الأصناف والفروقات هنا.</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {rejectOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-xl rounded-[2rem] border border-white/10 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">رفض الجرد</div>
                <h3 className="mt-1 text-2xl font-black">أدخل سبب الرفض</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">السبب إلزامي وسيصل إلى أمين المخزن مع إشعار الرفض.</p>
              </div>
              <button type="button" onClick={() => setRejectOpen(false)} className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="مثال: توجد فروقات غير مبررة أو تحتاج مراجعة ميدانية"
              rows={5}
              className="mt-4 w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold outline-none placeholder:text-slate-500"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setRejectOpen(false)} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-black text-white">
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={rejecting}
                className="inline-flex items-center gap-2 rounded-2xl bg-rose-500 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rejecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                تأكيد الرفض
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function StatCard({ title, value, icon: Icon, tone = "sky" }) {
  const toneClasses = {
    amber: "from-amber-400/15 to-amber-500/5 text-amber-100 border-amber-300/20",
    rose: "from-rose-400/15 to-rose-500/5 text-rose-100 border-rose-300/20",
    emerald: "from-emerald-400/15 to-emerald-500/5 text-emerald-100 border-emerald-300/20",
    sky: "from-sky-400/15 to-sky-500/5 text-sky-100 border-sky-300/20",
  };
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-3 shadow-xl backdrop-blur sm:rounded-[1.75rem] sm:p-4 ${toneClasses[tone] || toneClasses.sky}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black leading-4 opacity-70 sm:text-xs sm:uppercase sm:tracking-[0.18em]">{title}</div>
          <div className="mt-1 text-2xl font-black sm:mt-2 sm:text-3xl">{formatNumber(value)}</div>
        </div>
        <Icon className="h-5 w-5 shrink-0 opacity-90 sm:h-6 sm:w-6" />
      </div>
    </div>
  );
}

function InfoStat({ title, value, icon: Icon, tone = "sky" }) {
  const toneClasses = {
    amber: "border-amber-300/20 bg-amber-500/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-500/10 text-rose-100",
    emerald: "border-emerald-300/20 bg-emerald-500/10 text-emerald-100",
    sky: "border-sky-300/20 bg-sky-500/10 text-sky-100",
  };
  return (
    <div className={`rounded-2xl border p-3 sm:rounded-[1.5rem] sm:p-4 ${toneClasses[tone] || toneClasses.sky}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black leading-4 opacity-70 sm:text-xs sm:uppercase sm:tracking-[0.16em]">{title}</div>
          <div className="mt-1 text-xl font-black sm:mt-2 sm:text-2xl">{formatNumber(value)}</div>
        </div>
        <Icon className="h-5 w-5 opacity-90" />
      </div>
    </div>
  );
}

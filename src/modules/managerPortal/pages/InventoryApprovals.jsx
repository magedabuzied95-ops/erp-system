import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { Pagination } from "../../../shared/ui";
import "./ManagerPortal.m1.css";

import { useTranslation } from "react-i18next";

import i18n from "../../../i18n/i18n";

/** Module-scope translator for helpers defined outside a component. */
const tt = (key, options) => i18n.t(key, options);


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
const itemSystemQty = (item = {}) => Number(item.system_quantity ?? item.expected_qty ?? 0) || 0;
const itemCountedQty = (item = {}) => Number(item.counted_quantity ?? item.actual_qty ?? 0) || 0;
const itemDifference = (item = {}) => {
  const stored = item.difference_quantity ?? item.difference_qty;
  if (stored !== null && stored !== undefined && stored !== "") return Number(stored) || 0;
  return itemCountedQty(item) - itemSystemQty(item);
};
const signedNumber = (value) => (value > 0 ? `+${formatNumber(value)}` : formatNumber(value));
const itemImage = (item = {}) => resolveProductImageUrl(
  item.color_image_url || item.variant_image_url || item.primary_image_url || item.main_image_url ||
  item.image_url || item.product_image_url || item.product_image || item.main_image || ""
);

const statusTone = (status = "") => {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "pending_review") return "bg-primary/10 text-primary border-primary/20";
  if (normalized === "rejected") return "bg-rose-500/10 text-rose-100 border-rose-400/20";
  if (normalized === "completed") return "bg-emerald-500/10 text-emerald-100 border-emerald-400/20";
  return "bg-surface-soft text-text border-border";
};

export default function InventoryApprovalsPage() {
  // Subscribes the page to language changes; strings resolve through tt().
  useTranslation();
  const navigate = useNavigate();
  const { token: routeToken = "" } = useParams();
  const [searchParams] = useSearchParams();
  usePageTitle("Inventory Approvals");
  const token = routeToken || searchParams.get("token") || resolveStoredToken();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState({});
  const [sessions, setSessions] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 10, totalPages: 1 });
  const [search, setSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  // "variance" opens the session on what moved; "all" shows every counted size.
  const [itemFilter, setItemFilter] = useState("variance");
  const detailRef = useRef(null);
  const lastPortalUrl = typeof window !== "undefined" ? String(window.localStorage.getItem("manager_portal_last_url") || "").trim() : "";

  const selectedSession = selectedApproval?.session || null;
  const selectedItems = Array.isArray(selectedApproval?.items) ? selectedApproval.items : [];
  // The count arrives as one row per size, so a model with eight colours lands
  // as dozens of look-alike cards. A manager reads a count by product and
  // colour, so fold the sizes back into the colour they belong to and float the
  // colours that actually moved to the top.
  const itemGroups = useMemo(() => {
    const collator = new Intl.Collator(["ar", "en"], { numeric: true, sensitivity: "base" });
    const groups = new Map();
    selectedItems.forEach((item, index) => {
      const productKey = item.product_id ?? text(item.product_name, "product");
      const colorKey = itemColor(item).toLowerCase() || "default";
      const key = `${productKey}::${colorKey}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          order: index,
          productName: text(item.product_name, ""),
          color: itemColor(item),
          imageUrl: "",
          rows: [],
          system: 0,
          counted: 0,
          surplus: 0,
          shortage: 0,
        });
      }
      const group = groups.get(key);
      if (!group.imageUrl) group.imageUrl = itemImage(item);
      const system = itemSystemQty(item);
      const counted = itemCountedQty(item);
      const diff = itemDifference(item);
      group.rows.push({ item, system, counted, diff, order: index });
      group.system += system;
      group.counted += counted;
      if (diff > 0) group.surplus += diff;
      if (diff < 0) group.shortage += Math.abs(diff);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        difference: group.surplus - group.shortage,
        // Kept off `rows` so the header still speaks for the whole colour while
        // the variance filter is thinning the tiles underneath it.
        totalRows: group.rows.length,
        changedRows: group.rows.filter((row) => row.diff !== 0).length,
        rows: group.rows.slice().sort((left, right) => {
          const leftSize = itemSize(left.item);
          const rightSize = itemSize(right.item);
          if (!leftSize && rightSize) return 1;
          if (leftSize && !rightSize) return -1;
          return collator.compare(leftSize, rightSize) || left.order - right.order;
        }),
      }))
      .sort((left, right) => {
        const leftSettled = left.changedRows ? 0 : 1;
        const rightSettled = right.changedRows ? 0 : 1;
        if (leftSettled !== rightSettled) return leftSettled - rightSettled;
        const productOrder = collator.compare(left.productName, right.productName);
        if (productOrder) return productOrder;
        return collator.compare(left.color, right.color) || left.order - right.order;
      });
  }, [selectedItems]);
  const sessionSummary = useMemo(() => {
    const totals = itemGroups.reduce((acc, group) => {
      acc.colors += 1;
      group.rows.forEach((row) => {
        acc.items += 1;
        if (row.diff > 0) {
          acc.increase += row.diff;
          acc.upLines += 1;
        }
        if (row.diff < 0) {
          acc.shortage += Math.abs(row.diff);
          acc.downLines += 1;
        }
        acc.total += Math.abs(row.diff);
      });
      return acc;
    }, { items: 0, colors: 0, increase: 0, shortage: 0, total: 0, upLines: 0, downLines: 0 });
    return { ...totals, changedLines: totals.upLines + totals.downLines };
  }, [itemGroups]);
  const hasVariance = sessionSummary.changedLines > 0;
  const varianceOnly = itemFilter === "variance" && hasVariance;
  const visibleGroups = useMemo(() => {
    if (!varianceOnly) return itemGroups;
    return itemGroups
      .filter((group) => group.changedRows > 0)
      .map((group) => ({ ...group, rows: group.rows.filter((row) => row.diff !== 0) }));
  }, [itemGroups, varianceOnly]);

  const loadApprovals = async (nextSessionId = "", overrides = {}) => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const response = await managerPortalApi.inventoryApprovals(token, {
        page: overrides.page || pagination.page || 1,
        limit: overrides.limit || pagination.limit || 10,
        search,
      });
      const payload = response?.inventoryApprovals || {};
      setSummary(payload.summary || {});
      setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      setPagination(payload.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 });
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
      setError(err?.responseBody?.message || err?.message || tt("managerPortal.stockCount.errors.loadApprovals"));
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
      toast.error(err?.responseBody?.message || err?.message || tt("managerPortal.stockCount.errors.loadDetails"));
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
    setItemFilter("variance");
    void loadDetail(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId]);

  const handleSearch = async (event) => {
    event.preventDefault();
    await loadApprovals("", { page: 1 });
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
      toast.success(tt("managerPortal.stockCount.toasts.approved"));
      setSelectedSessionId("");
      setSelectedApproval(null);
      await loadApprovals();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err?.responseBody?.message || err?.message || tt("managerPortal.stockCount.errors.approve"));
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
      toast.error(tt("managerPortal.stockCount.errors.reasonRequired"));
      return;
    }
    try {
      setRejecting(true);
      await managerPortalApi.rejectInventoryApproval(token, selectedSessionId, { rejectionReason: rejectReason.trim() });
      toast.success(tt("managerPortal.stockCount.toasts.rejected"));
      setRejectOpen(false);
      setRejectReason("");
      setSelectedSessionId("");
      setSelectedApproval(null);
      await loadApprovals();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      toast.error(err?.responseBody?.message || err?.message || tt("managerPortal.stockCount.errors.reject"));
    } finally {
      setRejecting(false);
    }
  };

  if (!token) {
    return (
      <main className="manager-portal-shell inventory-approvals-page min-h-[100dvh] px-4 py-6">
        <div className="mx-auto max-w-2xl rounded-[var(--radius-card)] border border-border bg-surface-soft p-6 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-amber-300" />
            <div>
              <h1 className="m1-page-title">{tt("managerPortal.stockCount.title")}</h1>
              <p className="mt-1 text-sm text-text-muted">{tt("managerPortal.stockCount.noToken")}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(lastPortalUrl || "/")}
            className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-amber-400 px-4 py-3 text-sm font-black text-text transition hover:bg-amber-300"
          >
            <ArrowLeft className="h-4 w-4" />
            {tt("managerPortal.stockCount.backToPortal")}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="manager-portal-shell inventory-approvals-page min-h-[100dvh] overflow-x-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="mx-auto max-w-[96rem] space-y-4">
        <header className="manager-inventory-panel rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 shadow-2xl backdrop-blur sm:rounded-[var(--radius-card)] sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="m1-page-title">{tt("managerPortal.stockCount.title")}</h1>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted sm:mt-2 sm:text-sm sm:leading-6">
                {tt("managerPortal.stockCount.centerSubtitle")}
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => loadApprovals(selectedSessionId)}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-black text-text transition hover:bg-surface-hover"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {tt("managerPortal.actions.refresh")}
              </button>
              <button
                type="button"
                onClick={() => navigate(`/manager-portal/${encodeURIComponent(token)}`)}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-black text-text transition hover:bg-surface-hover"
              >
                <ArrowLeft className="h-4 w-4" />
                {tt("managerPortal.stockCount.backToPortal")}
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <StatCard title={tt("managerPortal.stockCount.stats.pending")} value={summary.pending_review_count || 0} icon={ClipboardList} tone="amber" />
          <StatCard title={tt("managerPortal.stockCount.stats.rejected")} value={summary.rejected_count || 0} icon={X} tone="rose" />
          <StatCard title={tt("managerPortal.stockCount.stats.completedToday")} value={summary.completed_today_count || 0} icon={CheckCircle2} tone="emerald" />
          <StatCard title={tt("managerPortal.stockCount.stats.varianceToday")} value={summary.today_difference_total || 0} icon={Package} tone="sky" />
        </section>

        <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="manager-inventory-panel rounded-[var(--radius-card)] border border-border bg-surface-soft p-4 shadow-xl backdrop-blur">
            <form onSubmit={handleSearch} className="mb-4">
              <label className="mb-2 block text-xs font-black uppercase tracking-[0.18em] text-text-muted">{tt("managerPortal.actions.search")}</label>
              <div className="flex gap-2">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={tt("managerPortal.stockCount.searchPlaceholder")}
                  className="w-full rounded-[var(--radius-control)] border border-border bg-surface px-4 py-3 text-sm font-semibold outline-none placeholder:text-text-muted"
                />
                <button type="submit" className="inline-flex items-center justify-center rounded-[var(--radius-control)] bg-amber-400 px-4 text-sm font-black text-text">
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </form>

            <div className="flex items-center justify-between text-xs font-bold text-text-muted">
              <span>{tt("managerPortal.stockCount.shownSessions")}</span>
              <span>{formatNumber(pagination.total || sessions.length || 0)}</span>
            </div>

            <div className="mt-3 space-y-3">
              {loading ? (
                <div className="rounded-[var(--radius-card)] border border-border bg-surface-soft p-6 text-center text-sm text-text-muted">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  <div className="mt-2">{tt("managerPortal.stockCount.loadingList")}</div>
                </div>
              ) : sessions.length ? (
                sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => selectSession(session.id)}
                    className={`w-full rounded-[var(--radius-control)] border p-4 text-right transition ${ String(selectedSessionId) === String(session.id) ? "border-amber-300/40 bg-amber-400/10" : "border-border bg-surface-soft hover:bg-surface-hover" }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-base font-black text-text">{text(session.title, tt("managerPortal.stockCount.sessionLabel"))}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-text-muted">
                          <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" /> {text(session.branch_name, tt("managerPortal.stockCount.unknownBranch"))}</span>
                          <span className="inline-flex items-center gap-1"><Store className="h-3.5 w-3.5" /> {text(session.warehouse_name, tt("managerPortal.stockCount.unknownWarehouse"))}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-text-muted">
                          <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {text(session.created_by_employee_name || session.created_by_name, tt("managerPortal.common.unknown"))}</span>
                          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatDateTime(session.created_at)}</span>
                        </div>
                      </div>
                      <span className={`manager-portal-status-pill rounded-full border px-2.5 py-1 text-[11px] font-black ${statusTone(session.status)}`}>
                        {session.status === "pending_review" ? tt("managerPortal.stockCount.status.underReview") : session.status === "rejected" ? tt("managerPortal.stockCount.status.rejected") : session.status === "completed" ? tt("managerPortal.stockCount.status.completed") : session.status}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-text-muted">
                      <span className="rounded-full bg-surface-soft px-2.5 py-1">{tt("managerPortal.labels.items")}: {formatNumber(session.item_count || 0)}</span>
                      <span className="rounded-full bg-surface-soft px-2.5 py-1">{tt("managerPortal.labels.totalDifferences")}: {formatNumber(session.difference_total || 0)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft p-8 text-center text-sm text-text-muted">
                  <ClipboardList className="mx-auto h-8 w-8 text-text-muted" />
                  <div className="mt-3 font-bold">{tt("managerPortal.stockCount.emptyList")}</div>
                  <div className="mt-1 text-xs text-text-muted">{tt("managerPortal.stockCount.emptyListHint")}</div>
                </div>
              )}
            </div>
            <Pagination
              className="mt-4 border-t border-border pt-4"
              page={pagination.page || 1}
              pages={pagination.totalPages || 1}
              total={pagination.total || 0}
              pageSize={pagination.limit || 10}
              visible={sessions.length}
              disabled={loading}
              onChange={(page) => loadApprovals("", { page })}
              onPageSizeChange={(limit) => loadApprovals("", { page: 1, limit })}
            />
          </div>

          <div ref={detailRef} className="manager-inventory-panel scroll-mt-3 rounded-[var(--radius-card)] border border-border bg-surface-soft p-3 shadow-xl backdrop-blur sm:rounded-[var(--radius-card)] sm:p-4">
            {selectedLoading ? (
              <div className="flex min-h-[28rem] items-center justify-center text-text-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="mr-2">{tt("managerPortal.stockCount.loadingDetails")}</span>
              </div>
            ) : selectedSession ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{tt("managerPortal.stockCount.sessionDetails")}</div>
                    <h2 className="m1-section-title mt-1 text-text">{text(selectedSession.title, tt("managerPortal.stockCount.sessionLabel"))}</h2>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-text-muted">
                      <span className="inline-flex items-center gap-1"><Building2 className="h-4 w-4" /> {text(selectedSession.branch_name, tt("managerPortal.stockCount.unknownBranch"))}</span>
                      <span className="inline-flex items-center gap-1"><Store className="h-4 w-4" /> {text(selectedSession.warehouse_name, tt("managerPortal.stockCount.unknownWarehouse"))}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" /> {text(selectedSession.created_by_employee_name || selectedSession.created_by_name, tt("managerPortal.common.unknown"))}</span>
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" /> {formatDateTime(selectedSession.created_at)}</span>
                    </div>
                  </div>
                  <span className={`manager-portal-status-pill rounded-full border px-3 py-1 text-xs font-black ${statusTone(selectedSession.status)}`}>
                    {selectedSession.status === "pending_review" ? tt("managerPortal.stockCount.awaitingManager") : selectedSession.status === "rejected" ? tt("managerPortal.stockCount.status.rejected") : selectedSession.status === "completed" ? tt("managerPortal.stockCount.status.completed") : selectedSession.status}
                  </span>
                </div>

                {selectedSession.status === "rejected" && selectedSession.rejection_reason ? (
                  <div className="mt-4 rounded-[var(--radius-card)] border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-50">
                    <div className="font-black">{tt("managerPortal.stockCount.rejectionReason")}</div>
                    <div className="mt-1 leading-6">{selectedSession.rejection_reason}</div>
                  </div>
                ) : null}

                <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  <InfoStat title={tt("managerPortal.stockCount.itemCount")} value={sessionSummary.items || 0} icon={Package} tone="sky" />
                  <InfoStat title={tt("managerPortal.stockCount.totalSurplus")} value={sessionSummary.increase || 0} icon={TrendingUp} tone="emerald" />
                  <InfoStat title={tt("managerPortal.stockCount.totalShortage")} value={sessionSummary.shortage || 0} icon={TrendingDown} tone="rose" />
                  <InfoStat title={tt("managerPortal.stockCount.totalVariance")} value={sessionSummary.total || 0} icon={ClipboardList} tone="amber" />
                </section>

                <section className="mt-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-black text-text">{tt("managerPortal.stockCount.whatChanged")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold">
                        {hasVariance ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-emerald-300">
                              <TrendingUp className="h-3.5 w-3.5" />
                              {tt("managerPortal.stockCount.sizesUp", { n: formatNumber(sessionSummary.upLines), units: formatNumber(sessionSummary.increase) })}
                            </span>
                            <span className="inline-flex items-center gap-1 text-rose-300">
                              <TrendingDown className="h-3.5 w-3.5" />
                              {tt("managerPortal.stockCount.sizesDown", { n: formatNumber(sessionSummary.downLines), units: formatNumber(sessionSummary.shortage) })}
                            </span>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {tt("managerPortal.stockCount.allBalanced")}
                          </span>
                        )}
                        <span className="text-text-muted">
                          {tt("managerPortal.stockCount.countedScope", { colors: formatNumber(sessionSummary.colors), sizes: formatNumber(sessionSummary.items) })}
                        </span>
                      </div>
                    </div>
                    {hasVariance ? (
                      <div className="flex shrink-0 gap-1 rounded-[var(--radius-control)] border border-border bg-surface-soft p-1">
                        {[
                          { id: "variance", label: tt("managerPortal.stockCount.filters.variance"), count: sessionSummary.changedLines },
                          { id: "all", label: tt("managerPortal.stockCount.filters.all"), count: sessionSummary.items },
                        ].map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => setItemFilter(chip.id)}
                            className={`rounded-[var(--radius-control)] px-3 py-2 text-xs font-black transition ${itemFilter === chip.id ? "bg-primary text-[var(--primary-contrast)]" : "text-text-muted hover:bg-surface-hover"}`}
                          >
                            {chip.label} ({formatNumber(chip.count)})
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </section>

                <div className="mt-4 space-y-2 md:hidden">
                  {visibleGroups.length ? visibleGroups.map((group) => (
                    <article key={`mobile-${group.key}`} className="rounded-[var(--radius-card)] border border-border bg-surface p-3">
                      <div className="flex items-start gap-3">
                        <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-soft">
                          {group.imageUrl ? <img src={group.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-text-muted" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="m1-section-title truncate text-text">{group.productName || tt("managerPortal.common.product")}</h3>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] font-bold text-text-muted">
                            <span className="max-w-[10rem] truncate rounded-full border border-border bg-surface-soft px-2 py-0.5 text-text">
                              {group.color || tt("managerPortal.stockCount.unknownColor")}
                            </span>
                            <span>{tt("managerPortal.stockCount.sizesInColor", { n: formatNumber(group.totalRows) })}</span>
                          </div>
                        </div>
                        <VarianceBadge surplus={group.surplus} shortage={group.shortage} />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-text-muted">
                        <span>{tt("managerPortal.stockCount.colorTotal")}</span>
                        <span>{tt("managerPortal.stockCount.system")} <strong className="text-text" dir="ltr">{formatNumber(group.system)}</strong></span>
                        <span>{tt("managerPortal.stockCount.actual")} <strong className="text-text" dir="ltr">{formatNumber(group.counted)}</strong></span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {group.rows.map((row) => (
                          <div
                            key={`tile-${row.item.id || `${row.item.product_variant_id || row.item.variant_id}-${row.order}`}`}
                            className={`rounded-[var(--radius-control)] border p-2 ${row.diff > 0 ? "border-emerald-400/30 bg-emerald-500/10" : row.diff < 0 ? "border-rose-400/30 bg-rose-500/10" : "border-border bg-surface-soft"}`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="truncate text-sm font-black text-text">{itemSize(row.item) || tt("managerPortal.stockCount.unknownSize")}</span>
                              <span className={`shrink-0 text-xs font-black ${row.diff > 0 ? "text-emerald-300" : row.diff < 0 ? "text-rose-300" : "text-text-muted"}`} dir="ltr">
                                {row.diff === 0 ? "=" : signedNumber(row.diff)}
                              </span>
                            </div>
                            {text(row.item.variant_article_code || row.item.article_code, "") ? (
                              <p className="truncate text-[9px] font-bold text-text-muted" title={text(row.item.variant_article_code || row.item.article_code, "")}>
                                {text(row.item.variant_article_code || row.item.article_code, "")}
                              </p>
                            ) : null}
                            <div className="mt-1.5 grid grid-cols-2 gap-1 text-[10px] font-bold">
                              <div className="rounded-[var(--radius-control)] bg-surface px-1 py-1 text-center">
                                <div className="truncate text-text-muted">{tt("managerPortal.stockCount.system")}</div>
                                <div className="text-sm font-black text-text" dir="ltr">{formatNumber(row.system)}</div>
                              </div>
                              <div className="rounded-[var(--radius-control)] bg-surface px-1 py-1 text-center">
                                <div className="truncate text-text-muted">{tt("managerPortal.stockCount.actual")}</div>
                                <div className="text-sm font-black text-text" dir="ltr">{formatNumber(row.counted)}</div>
                              </div>
                            </div>
                            {row.item.reason || row.item.notes ? (
                              <p className="mt-1 text-[10px] leading-4 text-text-muted">{[row.item.reason, row.item.notes].map((value) => text(value, "")).filter(Boolean).join(" — ")}</p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </article>
                  )) : <div className="rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center text-sm text-text-muted">{tt("managerPortal.stockCount.noItems")}</div>}
                </div>

                <div className="mt-4 hidden overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface md:block">
                  <div className="m1-table-container overflow-x-auto">
                    <table className="m1-table m1-table--compact min-w-full text-right text-sm">
                      <thead className="bg-surface-soft text-xs uppercase tracking-[0.18em] text-text-muted">
                        <tr>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.size")}</th>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.code")}</th>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.systemQty")}</th>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.actualQty")}</th>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.variance")}</th>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.reason")}</th>
                          <th className="px-4 py-3">{tt("managerPortal.stockCount.table.notes")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleGroups.length ? visibleGroups.map((group) => (
                          <Fragment key={`table-${group.key}`}>
                            <tr className="border-t border-border bg-surface-soft/60">
                              <td colSpan={7} className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-3">
                                  {group.imageUrl ? <img src={group.imageUrl} alt="" className="h-10 w-10 rounded-[var(--radius-control)] object-cover" loading="lazy" /> : null}
                                  <span className="font-black text-text">{group.productName || tt("managerPortal.common.product")}</span>
                                  <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-bold text-text">
                                    {group.color || tt("managerPortal.stockCount.unknownColor")}
                                  </span>
                                  <span className="text-xs font-bold text-text-muted">
                                    {tt("managerPortal.stockCount.system")} <strong className="text-text" dir="ltr">{formatNumber(group.system)}</strong>
                                    <span className="mx-2">·</span>
                                    {tt("managerPortal.stockCount.actual")} <strong className="text-text" dir="ltr">{formatNumber(group.counted)}</strong>
                                  </span>
                                  <VarianceBadge surplus={group.surplus} shortage={group.shortage} />
                                </div>
                              </td>
                            </tr>
                            {group.rows.map((row) => (
                              <tr key={row.item.id || `${row.item.product_variant_id || row.item.variant_id}-${row.order}`} className="border-t border-border">
                                <td className="px-4 py-3 font-semibold text-text">{itemSize(row.item) || "-"}</td>
                                <td className="px-4 py-3 text-xs text-text-muted">{text(row.item.variant_article_code || row.item.article_code, "-")}</td>
                                <td className="px-4 py-3 font-semibold text-text" dir="ltr">{formatNumber(row.system)}</td>
                                <td className="px-4 py-3 font-semibold text-text" dir="ltr">{formatNumber(row.counted)}</td>
                                <td className={`px-4 py-3 font-black ${row.diff > 0 ? "text-emerald-300" : row.diff < 0 ? "text-rose-300" : "text-text-muted"}`} dir="ltr">{signedNumber(row.diff)}</td>
                                <td className="px-4 py-3 text-text-muted">{text(row.item.reason, "-")}</td>
                                <td className="px-4 py-3 text-text-muted">{text(row.item.notes, "-")}</td>
                              </tr>
                            ))}
                          </Fragment>
                        )) : (
                          <tr>
                            <td colSpan={7} className="px-4 py-10 text-center text-text-muted">{tt("managerPortal.stockCount.noItems")}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="sticky bottom-2 z-20 mt-4 rounded-[var(--radius-card)] border border-border bg-surface p-2 shadow-2xl backdrop-blur sm:static sm:flex sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      onClick={openRejectDialog}
                      disabled={selectedSession.status !== "pending_review"}
                      className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] border border-rose-400/20 bg-rose-500 px-3 py-3 text-sm font-black text-text transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
                    >
                      <X className="h-4 w-4" />
                      {tt("managerPortal.actions.reject")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApprove()}
                      disabled={approving || selectedSession.status !== "pending_review"}
                      className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-3 py-3 text-sm font-black text-[var(--primary-contrast)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
                    >
                      {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      موافقة واعتماد
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[28rem] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface-soft text-center text-text-muted">
                <div>
                  <ClipboardList className="mx-auto h-10 w-10 text-text-muted" />
                  <div className="mt-3 text-lg font-black">{tt("managerPortal.stockCount.pickSession")}</div>
                  <div className="mt-1 text-sm">{tt("managerPortal.stockCount.pickSessionHint")}</div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {rejectOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-surface px-4">
          <div className="w-full max-w-xl rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.18em] text-text-muted">{tt("managerPortal.stockCount.rejectTitle")}</div>
                <h3 className="m1-section-title mt-1">{tt("managerPortal.stockCount.enterReason")}</h3>
                <p className="mt-2 text-sm leading-6 text-text-muted">{tt("managerPortal.stockCount.reasonHint")}</p>
              </div>
              <button type="button" onClick={() => setRejectOpen(false)} className="inline-flex h-[var(--control-height-md)] w-10 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-soft">
                <X className="h-4 w-4" />
              </button>
            </div>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder={tt("managerPortal.stockCount.reasonPlaceholder")}
              rows={5}
              className="mt-4 w-full rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-semibold outline-none placeholder:text-text-muted"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setRejectOpen(false)} className="rounded-[var(--radius-control)] border border-border bg-surface-soft px-4 py-3 text-sm font-black text-text">
                {tt("managerPortal.common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={rejecting}
                className="inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-rose-500 px-4 py-3 text-sm font-black text-text transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
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
    sky: "from-primary/15 to-primary/5 text-primary border-primary/20",
  };
  return (
    <div data-tone={tone} className={`manager-inventory-stat rounded-[var(--radius-card)] border bg-gradient-to-br p-3 shadow-xl backdrop-blur sm:rounded-[var(--radius-card)] sm:p-4 ${toneClasses[tone] || toneClasses.sky}`}>
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

/**
 * A colour can carry a surplus on one size and a shortage on another, so the
 * badge says both instead of netting them into one misleading number.
 */
function VarianceBadge({ surplus = 0, shortage = 0 }) {
  if (!surplus && !shortage) {
    return (
      <span className="shrink-0 rounded-[var(--radius-control)] bg-surface-soft px-2.5 py-1 text-xs font-black text-text-muted">
        {tt("managerPortal.stockCount.balanced")}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-wrap items-center gap-1">
      {surplus ? (
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-emerald-500/15 px-2.5 py-1 text-xs font-black text-emerald-300">
          <TrendingUp className="h-3.5 w-3.5" />
          <span dir="ltr">+{formatNumber(surplus)}</span>
        </span>
      ) : null}
      {shortage ? (
        <span className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-rose-500/15 px-2.5 py-1 text-xs font-black text-rose-300">
          <TrendingDown className="h-3.5 w-3.5" />
          <span dir="ltr">-{formatNumber(shortage)}</span>
        </span>
      ) : null}
    </span>
  );
}

function InfoStat({ title, value, icon: Icon, tone = "sky" }) {
  const toneClasses = {
    amber: "border-amber-300/20 bg-amber-500/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-500/10 text-rose-100",
    emerald: "border-emerald-300/20 bg-emerald-500/10 text-emerald-100",
    sky: "border-primary/20 bg-primary/10 text-primary",
  };
  return (
    <div data-tone={tone} className={`manager-inventory-stat rounded-[var(--radius-card)] border p-3 sm:rounded-[var(--radius-card)] sm:p-4 ${toneClasses[tone] || toneClasses.sky}`}>
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

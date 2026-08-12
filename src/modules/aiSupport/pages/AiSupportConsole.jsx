import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  MessageSquareText,
  PackageSearch,
  Play,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Sparkles,
  Trash2,
  UserCheck,
  XCircle,
} from "lucide-react";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser, getToken, setCurrentTenant } from "../../../shared/auth/authStorage";
import { useTenant } from "../../saas/context/TenantContext";

const quickTests = [
  "هل المنتج ده متاح؟",
  "سعر المنتج كام؟",
  "المقاس ده موجود؟",
  "مواعيد العمل؟",
  "سياسة الاستبدال؟",
  "سؤال ممنوع عن تكلفة الشراء أو المورد",
];

const defaultQuestion = "هل المنتج ده متاح؟";

const TENANT_CONTEXT_ERROR = "Tenant context missing. Please login again.";

const readStorageValue = (key) => {
  if (typeof window === "undefined" || !key) return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const readStorageObject = (key) => {
  const value = readStorageValue(key);
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const decodeJwtPayload = (token) => {
  if (!token || typeof window === "undefined") return null;
  const [, payload] = String(token).split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded));
  } catch {
    return null;
  }
};

const normalizeTenantId = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : "";
};

const firstValidTenantCandidate = (candidates = []) => {
  for (const candidate of candidates) {
    const tenantId = normalizeTenantId(candidate.value);
    if (tenantId) return { tenantId, source: candidate.source };
  }
  return { tenantId: "", source: "" };
};

const resolveTenantContext = (tenantApi = null) => {
  const authUser = getCurrentUser();
  const authTenant = getCurrentTenant();
  const tokenPayload = decodeJwtPayload(getToken());
  const contextTenant = tenantApi?.currentTenant || null;
  const storageUser = readStorageObject("user");
  const storageTenant = readStorageObject("erp.saas.currentTenant");
  const currentTenant = readStorageObject("currentTenant");
  const activeTenant = readStorageObject("activeTenant");
  const tenant = readStorageObject("tenant");

  const resolved = firstValidTenantCandidate([
    { source: "authStorage.getCurrentUser.tenant_id", value: authUser?.tenant_id },
    { source: "authStorage.getCurrentUser.tenantId", value: authUser?.tenantId },
    { source: "authStorage.getCurrentUser.tenant.id", value: authUser?.tenant?.id },
    { source: "authStorage.getCurrentUser.tenant.tenant_id", value: authUser?.tenant?.tenant_id },
    { source: "authStorage.getCurrentUser.currentTenant.id", value: authUser?.currentTenant?.id },
    { source: "authStorage.getCurrentUser.company_id", value: authUser?.company_id },
    { source: "authToken.tenant_id", value: tokenPayload?.tenant_id },
    { source: "authToken.tenantId", value: tokenPayload?.tenantId },
    { source: "authToken.tenant.id", value: tokenPayload?.tenant?.id },
    { source: "authToken.company_id", value: tokenPayload?.company_id },
    { source: "TenantProvider.currentTenant.id", value: contextTenant?.id },
    { source: "TenantProvider.currentTenant.tenant_id", value: contextTenant?.tenant_id },
    { source: "authStorage.getCurrentTenant.id", value: authTenant?.id },
    { source: "authStorage.getCurrentTenant.tenant_id", value: authTenant?.tenant_id },
    { source: "localStorage.user.tenant_id", value: storageUser?.tenant_id },
    { source: "localStorage.user.tenantId", value: storageUser?.tenantId },
    { source: "localStorage.user.tenant.id", value: storageUser?.tenant?.id },
    { source: "localStorage.user.currentTenant.id", value: storageUser?.currentTenant?.id },
    { source: "localStorage.user.company_id", value: storageUser?.company_id },
    { source: "localStorage.erp.saas.currentTenant.id", value: storageTenant?.id },
    { source: "localStorage.erp.saas.currentTenant.tenant_id", value: storageTenant?.tenant_id },
    { source: "localStorage.currentTenant.id", value: currentTenant?.id },
    { source: "localStorage.currentTenant.tenant_id", value: currentTenant?.tenant_id },
    { source: "localStorage.activeTenant.id", value: activeTenant?.id },
    { source: "localStorage.activeTenant.tenant_id", value: activeTenant?.tenant_id },
    { source: "localStorage.tenant.id", value: tenant?.id },
    { source: "localStorage.tenant.tenant_id", value: tenant?.tenant_id },
    { source: "localStorage.tenant_id", value: readStorageValue("tenant_id") },
    { source: "localStorage.tenantId", value: readStorageValue("tenantId") },
    { source: "localStorage.erp.tenant_id", value: readStorageValue("erp.tenant_id") },
  ]);

  const tenantSnapshot = contextTenant || authTenant || storageTenant || currentTenant || activeTenant || tenant || null;
  if (resolved.tenantId && !normalizeTenantId(authTenant?.id || authTenant?.tenant_id)) {
    setCurrentTenant({
      ...(tenantSnapshot || {}),
      id: resolved.tenantId,
      tenant_id: resolved.tenantId,
      name: tenantSnapshot?.name || authUser?.tenant_name || authUser?.company_name || "Workspace",
      companyName: tenantSnapshot?.companyName || authUser?.company_name || authUser?.tenant_name || "Workspace",
      slug: tenantSnapshot?.slug || authUser?.tenant_slug || `tenant-${resolved.tenantId}`,
    });
  }

  return {
    tenantId: resolved.tenantId,
    source: resolved.source || "missing",
    authUser,
    authUserSource: authUser ? "authStorage.getCurrentUser/localStorage.user" : "missing",
    authTenant,
    contextTenant,
    tenantSnapshot,
    tokenPayload,
  };
};

const isValidTenantId = (value) => Boolean(normalizeTenantId(value));

const asArray = (value) => (Array.isArray(value) ? value : []);

const EMPTY_INSIGHTS = {
  handoff_count: 0,
  top_questions: [],
  top_product_terms: [],
  top_requested_sizes: [],
  top_requested_colors: [],
  most_suggested_products: [],
  most_clicked_products: [],
  pending_aliases: [],
  fallback_questions: [],
};

const normalizeInsights = (value) => ({
  ...EMPTY_INSIGHTS,
  ...(value && typeof value === "object" ? value : {}),
  handoff_count: value?.handoff_count ?? value?.human_handoff_count ?? 0,
  most_clicked_products: asArray(value?.most_clicked_products || value?.most_clicked_suggested_products),
});

const formatDateTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
};

function ConfidenceBar({ value }) {
  const confidence = Math.max(0, Math.min(1, Number(value || 0)));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-[0.16em] text-slate-400">
        <span>مستوى الثقة</span>
        <span>{Math.round(confidence * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary via-emerald-300 to-lime-300 transition-all"
          style={{ width: `${confidence * 100}%` }}
        />
      </div>
    </div>
  );
}

function Pill({ children, tone = "slate" }) {
  const tones = {
    slate: "border-white/10 bg-white/[0.06] text-slate-200",
    emerald: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-300/20 bg-amber-400/10 text-amber-100",
    rose: "border-rose-300/20 bg-rose-400/10 text-rose-100",
    cyan: "border-primary/20 bg-primary/10 text-primary",
  };
  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-black ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

function JsonBlock({ value }) {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">لم يُعدّه المسار.</div>;
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs leading-5 text-slate-200">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ProductCard({ product }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-3">
      <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-slate-950/70">
        {product.image_url ? (
          <img src={product.image_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <PackageSearch className="h-6 w-6 text-slate-500" />
        )}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-white">{product.name || "منتج"}</div>
        <div className="mt-1 text-xs text-slate-400">{product.sku ? `SKU ${product.sku}` : "لم يتم إرجاع SKU"}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Pill tone={product.availability === "available" ? "emerald" : "amber"}>{product.availability || "unknown"}</Pill>
          <Pill tone="cyan">{product.price ?? "-"} السعر</Pill>
          <Pill>{Number(product.total_stock || 0)} مخزون</Pill>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ item }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{formatDateTime(item.created_at)}</div>
          <h3 className="m1-section-title mt-2 text-white">{item.customer_message}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone={item.needs_human_support ? "amber" : "emerald"}>{item.needs_human_support ? "يحتاج تدخلًا بشريًا" : "أجاب الذكاء الاصطناعي"}</Pill>
          <Pill tone={Number(item.confidence || 0) < 0.5 ? "rose" : "cyan"}>{Math.round(Number(item.confidence || 0) * 100)}%</Pill>
          {item.detected_intent ? <Pill>{item.detected_intent}</Pill> : null}
        </div>
      </div>
      <p className="mt-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-3 text-sm leading-6 text-slate-300">{item.ai_answer || "No answer logged."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {asArray(item.sources_used).length ? asArray(item.sources_used).map((source) => <Pill key={source} tone="cyan">{source}</Pill>) : <Pill>no sources</Pill>}
        {item.fallback_reason ? <Pill tone="amber">{item.fallback_reason}</Pill> : null}
      </div>
    </article>
  );
}

function InsightList({ title, items, labelKey = "label", empty = "No data yet." }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
      <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">{title}</div>
      <div className="space-y-2">
        {asArray(items).length ? asArray(items).map((item, index) => {
          const label =
            item[labelKey] ||
            item.question ||
            item.term ||
            item.size ||
            item.color ||
            item.name ||
            item.alias ||
            item.product_id ||
            "-";
          return (
            <div key={`${title}-${label}-${index}`} className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] px-3 py-2">
              <span className="min-w-0 truncate text-sm font-bold text-slate-100">{label}</span>
              <span className="shrink-0 rounded-full bg-white/10 px-2 py-1 text-xs font-black text-primary">{item.count ?? item.usage_count ?? 0}</span>
            </div>
          );
        }) : (
          <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-3 text-sm text-slate-500">{empty}</div>
        )}
      </div>
    </div>
  );
}

export default function AiSupportConsole() {
  const tenantApi = useTenant();
  const contextTenant = tenantApi?.currentTenant || null;
  const [tenantContext, setTenantContext] = useState(() => resolveTenantContext());
  const [authHydrated, setAuthHydrated] = useState(false);
  const tenantId = tenantContext.tenantId;
  const [message, setMessage] = useState(defaultQuestion);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyFilters, setHistoryFilters] = useState({
    needs_human_support: "all",
    low_confidence: false,
  });
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [orderDrafts, setOrderDrafts] = useState([]);
  const [orderDraftsLoading, setOrderDraftsLoading] = useState(false);
  const [orderDraftsError, setOrderDraftsError] = useState("");

  const loadHistory = useCallback(async () => {
    if (!authHydrated) return;
    const currentTenantContext = resolveTenantContext(tenantApi);
    setTenantContext(currentTenantContext);
    const requestTenantId = currentTenantContext.tenantId;
    if (!isValidTenantId(requestTenantId)) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const params = { limit: 50, tenant_id: requestTenantId };
      if (historyFilters.needs_human_support !== "all") params.needs_human_support = historyFilters.needs_human_support;
      if (historyFilters.low_confidence) params.low_confidence = "true";
      const payload = await api.get("/ai-support/history", {
        params,
        headers: { "x-tenant-id": requestTenantId },
      });
      setHistory(asArray(payload?.history));
    } catch (err) {
      setHistoryError(err?.message || "تعذر تحميل سجل دعم الذكاء الاصطناعي");
    } finally {
      setHistoryLoading(false);
    }
  }, [authHydrated, historyFilters.low_confidence, historyFilters.needs_human_support, tenantApi]);

  const loadInsights = useCallback(async () => {
    if (!authHydrated) return;
    const currentTenantContext = resolveTenantContext(tenantApi);
    setTenantContext(currentTenantContext);
    const requestTenantId = currentTenantContext.tenantId;
    if (!isValidTenantId(requestTenantId)) return;
    setInsightsLoading(true);
    setInsightsError("");
    try {
      const payload = await api.get("/ai-support/insights", {
        params: { tenant_id: requestTenantId, limit: 10 },
        headers: { "x-tenant-id": requestTenantId },
      });
      setInsights(normalizeInsights(payload?.insights));
    } catch (err) {
      console.warn("[ai-support-console] insights load failed", err);
      setInsightsError("");
      setInsights(EMPTY_INSIGHTS);
    } finally {
      setInsightsLoading(false);
    }
  }, [authHydrated, tenantApi]);

  const loadOrderDrafts = useCallback(async () => {
    if (!authHydrated) return;
    const currentTenantContext = resolveTenantContext(tenantApi);
    setTenantContext(currentTenantContext);
    const requestTenantId = currentTenantContext.tenantId;
    if (!isValidTenantId(requestTenantId)) return;
    setOrderDraftsLoading(true);
    setOrderDraftsError("");
    try {
      const payload = await api.get("/ai-agent/orders/drafts", {
        params: { tenant_id: requestTenantId, limit: 50 },
        headers: { "x-tenant-id": requestTenantId },
      });
      setOrderDrafts(asArray(payload?.drafts));
    } catch (err) {
      setOrderDraftsError(err?.message || "تعذر تحميل مسودات الطلبات الذكية");
    } finally {
      setOrderDraftsLoading(false);
    }
  }, [authHydrated, tenantApi]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    loadOrderDrafts();
  }, [loadOrderDrafts]);

  useEffect(() => {
    setTenantContext(resolveTenantContext(tenantApi));
    setAuthHydrated(true);
  }, [contextTenant?.id, contextTenant?.tenant_id, tenantApi]);

  const clearHistory = async () => {
    const currentTenantContext = resolveTenantContext(tenantApi);
    setTenantContext(currentTenantContext);
    const requestTenantId = currentTenantContext.tenantId;
    if (!isValidTenantId(requestTenantId)) {
      setHistoryError(TENANT_CONTEXT_ERROR);
      return;
    }
    if (!window.confirm("Clear AI support test history for this tenant?")) return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      await api.delete("/ai-support/history/test", {
        params: { tenant_id: requestTenantId },
        body: { tenant_id: requestTenantId },
        headers: { "x-tenant-id": requestTenantId },
      });
      setHistory([]);
    } catch (err) {
      setHistoryError(err?.message || "تعذر مسح سجل دعم الذكاء الاصطناعي");
    } finally {
      setHistoryLoading(false);
    }
  };

  const runTest = async (nextMessage = message) => {
    const question = String(nextMessage || "").trim();
    if (!question) return;
    const currentTenantContext = resolveTenantContext(tenantApi);
    setTenantContext(currentTenantContext);
    const requestTenantId = currentTenantContext.tenantId;
    console.debug("[ai-support-console] tenant resolution", {
      resolved_tenant_id: requestTenantId || null,
      source: currentTenantContext.source,
      auth_user_object_source: currentTenantContext.authUserSource,
      auth_user: currentTenantContext.authUser,
      current_tenant: currentTenantContext.contextTenant || currentTenantContext.authTenant,
    });
    if (!authHydrated || !isValidTenantId(requestTenantId)) {
      setMessage(question);
      setError(TENANT_CONTEXT_ERROR);
      setResponse(null);
      setLoading(false);
      return;
    }
    setMessage(question);
    setLoading(true);
    setError("");
    try {
      const payload = await api.post(
        "/ai-support/chat",
        {
          tenant_id: requestTenantId,
          message: question,
          metadata: {
            session_id: `admin-console-${Date.now()}`,
            locale: "ar-EG",
            tenant_id: requestTenantId,
          },
        },
        {
          headers: { "x-tenant-id": requestTenantId },
          timeoutMs: 30_000,
        }
      );
      setResponse(payload);
      loadHistory();
      loadInsights();
      loadOrderDrafts();
    } catch (err) {
      setError(err?.message || "AI support request failed");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  const updateOrderDraft = async (draft, action) => {
    const currentTenantContext = resolveTenantContext(tenantApi);
    const requestTenantId = currentTenantContext.tenantId;
    if (!isValidTenantId(requestTenantId) || !draft?.id) return;
    setOrderDraftsLoading(true);
    setOrderDraftsError("");
    try {
      if (action === "confirm") {
        await api.post(
          "/ai-agent/orders/confirm",
          { tenant_id: requestTenantId, order_id: draft.id },
          { headers: { "x-tenant-id": requestTenantId } }
        );
      } else {
        await api.patch(
          `/ai-agent/orders/${draft.id}/status`,
          { tenant_id: requestTenantId, status: action },
          { headers: { "x-tenant-id": requestTenantId } }
        );
      }
      await loadOrderDrafts();
    } catch (err) {
      setOrderDraftsError(err?.message || "تعذر تحديث طلب الذكاء الاصطناعي");
    } finally {
      setOrderDraftsLoading(false);
    }
  };

  const suggestedProducts = asArray(response?.suggested_products);
  const sourcesUsed = asArray(response?.sources_used);
  const suggestedActions = asArray(response?.suggested_actions);
  const sourcePreviews = asArray(response?.source_previews || response?.debug?.source_previews);
  const debugPayload = {
    detected_intent: response?.detected_intent || response?.intent || response?.debug?.detected_intent,
    context_source_count: response?.context_source_count ?? response?.debug?.context_source_count,
    fallback_reason: response?.fallback_reason || response?.debug?.fallback_reason,
  };
  const authDebugSnapshot = useMemo(() => ({
    resolved_tenant_id: tenantId || null,
    auth_source_used: tenantContext.source,
    auth_user_object_source: tenantContext.authUserSource,
    current_auth_user_snapshot: tenantContext.authUser || null,
    current_tenant_snapshot: tenantContext.contextTenant || tenantContext.authTenant || null,
    auth_token_snapshot: tenantContext.tokenPayload || null,
    auth_hydrated: authHydrated,
  }), [authHydrated, tenantContext.authTenant, tenantContext.authUser, tenantContext.authUserSource, tenantContext.contextTenant, tenantContext.source, tenantContext.tokenPayload, tenantId]);

  return (
    <div className="min-h-full overflow-hidden rounded-[28px] bg-slate-950 text-white">
      <div className="relative isolate">
        <div className="absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.18),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.16),transparent_28%)]" />
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
          <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-amber-100">
                  <ShieldAlert className="h-4 w-4" />
                  Internal testing only - not visible to customers
                </div>
                <h1 className="m1-display mt-4">وحدة دعم الذكاء الاصطناعي</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                  Test customer-style product and store policy questions, then review saved answers before public release.
                </p>
              </div>
              <div className="rounded-2xl border border-primary/15 bg-primary/10 px-4 py-3 text-sm font-black text-primary">
                Tenant: {!authHydrated ? "loading..." : tenantId || "not resolved"}
                <div className="mt-1 max-w-52 truncate text-[10px] font-bold uppercase tracking-[0.14em] text-primary/70">
                  {!authHydrated ? "hydrating auth context" : tenantContext.source}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-primary/15 bg-primary/10 p-5 shadow-2xl shadow-black/20">
            <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-primary/80">
              <ShieldAlert className="h-4 w-4" />
              Tenant debug
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Resolved tenant id</div>
                <div className="mt-2 text-sm font-black text-white">{authHydrated ? tenantId || "not resolved" : "loading..."}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Auth source used</div>
                <div className="mt-2 truncate text-sm font-black text-white">{authHydrated ? tenantContext.source : "hydrating auth context"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Auth user source</div>
                <div className="mt-2 truncate text-sm font-black text-white">{tenantContext.authUserSource}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Current auth user snapshot</div>
              <JsonBlock value={authDebugSnapshot} />
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="space-y-6">
              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
                <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <MessageSquareText className="h-4 w-4" />
                  سؤال يشبه سؤال العميل
                </div>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="min-h-40 w-full resize-none rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 p-4 text-base leading-7 text-white outline-none transition placeholder:text-slate-600 focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
                  placeholder="Type a customer question..."
                />
                {authHydrated && !isValidTenantId(tenantId) ? (
                  <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
                    {TENANT_CONTEXT_ERROR}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => runTest()}
                  disabled={!authHydrated || loading || !message.trim() || !isValidTenantId(tenantId)}
                  className="mt-4 inline-flex h-[var(--control-height-lg)] w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-5 text-sm font-black text-slate-950 shadow-lg shadow-primary/30 transition hover:-translate-y-0.5 hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Run support test
                </button>
              </div>

              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
                <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <Sparkles className="h-4 w-4" />
                  Quick tests
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {quickTests.map((test) => (
                    <button
                      key={test}
                      type="button"
                      onClick={() => runTest(test)}
                      disabled={!authHydrated || loading || !isValidTenantId(tenantId)}
                      className="min-h-[var(--control-height-lg)] rounded-[var(--radius-control)] border border-white/10 bg-white/[0.055] px-4 py-3 text-right text-sm font-bold text-slate-100 transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {test}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              {error ? (
                <div className="rounded-3xl border border-rose-300/20 bg-rose-400/10 p-5 text-sm font-bold text-rose-100">
                  {error}
                </div>
              ) : null}

              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                    <Bot className="h-4 w-4" />
                    AI response
                  </div>
                  {response ? (
                    <Pill tone={response.needs_human_support ? "amber" : "emerald"}>
                      {response.needs_human_support ? "يحتاج تدخلًا بشريًا" : "تمت الإجابة"}
                    </Pill>
                  ) : null}
                </div>

                {response ? (
                  <div className="space-y-5">
                    <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-base leading-8 text-slate-100">
                      {response.answer || "No answer returned."}
                    </div>
                    <ConfidenceBar value={response.confidence} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4">
                        <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Sources used</div>
                        <div className="flex flex-wrap gap-2">
                          {sourcesUsed.length ? sourcesUsed.map((source) => <Pill key={source} tone="cyan">{source}</Pill>) : <Pill>none</Pill>}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4">
                        <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Suggested actions</div>
                        <div className="flex flex-wrap gap-2">
                          {suggestedActions.length ? suggestedActions.map((action) => <Pill key={action} tone="emerald">{action}</Pill>) : <Pill>none</Pill>}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                    <Bot className="mx-auto h-10 w-10 text-slate-500" />
                    <div className="mt-3 text-sm font-black text-white">No test run yet</div>
                    <p className="mt-1 text-sm text-slate-500">Run a quick test or type a custom question.</p>
                  </div>
                )}
              </div>

              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
                <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <PackageSearch className="h-4 w-4" />
                  Suggested products
                </div>
                <div className="grid gap-3">
                  {suggestedProducts.length ? suggestedProducts.map((product) => (
                    <ProductCard key={`${product.id}-${product.sku}`} product={product} />
                  )) : (
                    <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">No products returned.</div>
                  )}
                </div>
              </div>

              <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
                <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <AlertTriangle className="h-4 w-4" />
                  Admin debug
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">النية المكتشفة</div>
                    <div className="mt-2 text-sm font-black text-white">{debugPayload.detected_intent || "-"}</div>
                  </div>
                  <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Context sources</div>
                    <div className="mt-2 text-sm font-black text-white">{debugPayload.context_source_count ?? "-"}</div>
                  </div>
                  <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-4">
                    <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Fallback reason</div>
                    <div className="mt-2 text-sm font-black text-white">{debugPayload.fallback_reason || "-"}</div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Source preview sent to AI</div>
                  <JsonBlock value={sourcePreviews} />
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-500">Full endpoint response</div>
                  <JsonBlock value={response} />
                </div>
              </div>

              {response?.needs_human_support ? (
                <div className="flex items-center gap-3 rounded-3xl border border-amber-300/20 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
                  <AlertTriangle className="h-5 w-5 shrink-0" />
                  The answer requires human support or did not have enough verified context.
                </div>
              ) : response ? (
                <div className="flex items-center gap-3 rounded-3xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  The answer was grounded by the endpoint response.
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <ShoppingCart className="h-4 w-4" />
                  AI Order Drafts
                </div>
                <p className="mt-2 text-sm text-slate-400">طلبات العملاء التي بدأت عبر دردشة الذكاء الاصطناعي أو واتساب أو إنستجرام أو صندوق وارد فيسبوك.</p>
              </div>
              <button
                type="button"
                onClick={loadOrderDrafts}
                disabled={orderDraftsLoading}
                className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.055] px-3 text-sm font-black text-white transition hover:bg-white/[0.09] disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${orderDraftsLoading ? "animate-spin" : ""}`} />
                Refresh drafts
              </button>
            </div>

            {orderDraftsError ? (
              <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{orderDraftsError}</div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {orderDraftsLoading && !orderDrafts.length ? (
                <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-6 text-sm text-slate-400">Loading AI order drafts...</div>
              ) : orderDrafts.length ? orderDrafts.map((draft) => {
                const items = asArray(draft.items);
                const metadata = draft.ai_agent_metadata || {};
                const firstItem = items[0] || {};
                return (
                  <div key={draft.id} className="rounded-2xl border border-white/10 bg-slate-950/65 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-lg font-black text-white">{draft.invoice_number || `AI-${draft.id}`}</div>
                          <Pill tone={draft.ai_agent_status === "confirmed" ? "emerald" : draft.ai_agent_status === "human_handoff" ? "amber" : draft.ai_agent_status === "cancelled" ? "rose" : "cyan"}>
                            {draft.ai_agent_status || draft.status}
                          </Pill>
                          <Pill tone="cyan">{Number(draft.ai_agent_confidence || 0).toFixed(2)}</Pill>
                        </div>
                        <div className="mt-2 grid gap-2 text-sm text-slate-300 md:grid-cols-2">
                          <span><b className="text-white">العميل:</b> {draft.customer_name || "غير متاح"} - {draft.customer_phone || "غير متاح"}</span>
                          <span><b className="text-white">Area:</b> {[draft.governorate, draft.city_area].filter(Boolean).join(" / ") || "n/a"}</span>
                          <span><b className="text-white">المنتج:</b> {firstItem.product_name || metadata.matched_product_id || "غير متاح"}</span>
                          <span><b className="text-white">Variant:</b> {firstItem.variant_name || metadata.matched_variant_id || "n/a"} x {firstItem.quantity || 1}</span>
                          <span><b className="text-white">Total:</b> {draft.total_amount || draft.total || firstItem.total_amount || 0}</span>
                          <span><b className="text-white">Conversation:</b> {draft.ai_agent_conversation_id || "n/a"}</span>
                        </div>
                        <div className="mt-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-3 text-xs leading-5 text-slate-400">
                          {metadata.original_customer_message || metadata.transcript || "No transcript saved."}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button type="button" onClick={() => updateOrderDraft(draft, "confirm")} disabled={orderDraftsLoading || draft.ai_agent_status !== "ai_draft"} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] bg-emerald-400 px-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
                          <UserCheck className="h-4 w-4" />
                          Confirm Order
                        </button>
                        <button type="button" onClick={() => { window.location.href = `/orders/${draft.id}`; }} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.055] px-3 text-sm font-black text-white">
                          Edit Details
                        </button>
                        <button type="button" onClick={() => updateOrderDraft(draft, "human_handoff")} disabled={orderDraftsLoading || draft.ai_agent_status === "confirmed"} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-amber-300/20 bg-amber-400/10 px-3 text-sm font-black text-amber-100 disabled:cursor-not-allowed disabled:opacity-50">
                          Assign to human
                        </button>
                        <button type="button" onClick={() => updateOrderDraft(draft, "cancelled")} disabled={orderDraftsLoading || draft.ai_agent_status === "confirmed"} className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-rose-300/20 bg-rose-400/10 px-3 text-sm font-black text-rose-100 disabled:cursor-not-allowed disabled:opacity-50">
                          <XCircle className="h-4 w-4" />
                          Reject / Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">No AI order drafts yet.</div>
              )}
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <PackageSearch className="h-4 w-4" />
                  AI support insights
                </div>
                <p className="mt-2 text-sm text-slate-400">Tenant-scoped customer chat patterns, product demand signals, and handoff volume.</p>
              </div>
              <button
                type="button"
                onClick={loadInsights}
                disabled={insightsLoading}
                className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.055] px-3 text-sm font-black text-white transition hover:bg-white/[0.09] disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${insightsLoading ? "animate-spin" : ""}`} />
                Refresh insights
              </button>
            </div>

            {insightsError ? (
              <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{insightsError}</div>
            ) : null}

            <div className="mt-5 grid gap-3 lg:grid-cols-4">
              <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-100/70">Human handoffs</div>
                <div className="mt-2 text-3xl font-black text-white">{insights?.handoff_count ?? 0}</div>
              </div>
              <InsightList title="Top AI questions" items={insights?.top_questions} labelKey="question" />
              <InsightList title="Top product terms" items={insights?.top_product_terms} labelKey="term" />
              <InsightList title="Top requested sizes" items={insights?.top_requested_sizes} labelKey="size" />
              <InsightList title="Top requested colors" items={insights?.top_requested_colors} labelKey="color" />
              <InsightList title="Most suggested products" items={insights?.most_suggested_products} labelKey="name" />
              <InsightList title="Most clicked AI products" items={insights?.most_clicked_products} labelKey="name" />
              <InsightList title="Pending aliases" items={insights?.pending_aliases} labelKey="alias" />
            </div>

            <div className="mt-3">
              <InsightList title="Fallback / no-answer questions" items={insights?.fallback_questions} labelKey="question" empty="No fallback questions logged." />
            </div>
          </section>

          <section className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.045] p-5 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-400">
                  <MessageSquareText className="h-4 w-4" />
                  Admin review history
                </div>
                <p className="mt-2 text-sm text-slate-400">Latest tenant-scoped AI support test conversations for quality and failure review.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={historyFilters.needs_human_support}
                  onChange={(event) => setHistoryFilters((current) => ({ ...current, needs_human_support: event.target.value }))}
                  className="h-[var(--control-height-md)] rounded-[var(--radius-control)] border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none"
                >
                  <option value="all">كل النتائج</option>
                  <option value="true">يحتاج تدخلًا بشريًا</option>
                  <option value="false">تمت الإجابة بالذكاء الاصطناعي</option>
                </select>
                <label className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-slate-200">
                  <input
                    type="checkbox"
                    checked={historyFilters.low_confidence}
                    onChange={(event) => setHistoryFilters((current) => ({ ...current, low_confidence: event.target.checked }))}
                    className="h-4 w-4 accent-primary"
                  />
                  Low confidence
                </label>
                <button
                  type="button"
                  onClick={loadHistory}
                  disabled={historyLoading}
                  className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.055] px-3 text-sm font-black text-white transition hover:bg-white/[0.09] disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${historyLoading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={clearHistory}
                  disabled={historyLoading}
                  className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-rose-300/20 bg-rose-400/10 px-3 text-sm font-black text-rose-100 transition hover:bg-rose-400/15 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear test history
                </button>
              </div>
            </div>

            {historyError ? (
              <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{historyError}</div>
            ) : null}

            <div className="mt-5 space-y-3">
              {historyLoading && history.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.035] p-6 text-sm text-slate-400">Loading history...</div>
              ) : history.length ? history.map((item) => (
                <HistoryRow key={item.id} item={item} />
              )) : (
                <div className="rounded-[var(--radius-card)] border border-dashed border-white/10 bg-white/[0.03] p-6 text-center text-sm text-slate-500">No AI support test history yet.</div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Bell,
  Boxes,
  Brain,
  CreditCard,
  Eye,
  EyeOff,
  GripVertical,
  LayoutGrid,
  LineChart as LineChartIcon,
  MonitorDot,
  Package,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
  Warehouse,
  Plus,
  Store,
  TimerReset,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { socket } from "../socket";
import { api } from "../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../shared/auth/authStorage";
import { formatCurrency } from "../shared/lib/currency";

const emptyDashboard = {
  overview: null,
  salesTrend: [],
  topProducts: [],
  lowStock: [],
  liveActivity: [],
  branchPerformance: [],
  paymentAnalytics: [],
  hourlySales: [],
  marketing: { channels: [], attributedSales: 0 },
  posLive: null,
  inventory: null,
  aiInsights: [],
};

const widgetDefinitions = [
  { id: "sales", title: "Live Sales Analytics", roles: ["owner", "admin", "manager", "sales", "cashier"], size: "wide" },
  { id: "activity", title: "Activity Feed", roles: ["owner", "admin", "manager", "sales", "cashier", "warehouse"], size: "medium" },
  { id: "inventory", title: "Inventory Intelligence", roles: ["owner", "admin", "manager", "warehouse"], size: "medium" },
  { id: "pos", title: "POS Live Monitor", roles: ["owner", "admin", "manager", "cashier", "sales"], size: "medium" },
  { id: "ai", title: "AI Insights", roles: ["owner", "admin", "manager", "sales", "warehouse"], size: "medium" },
  { id: "branches", title: "Branch Performance", roles: ["owner", "admin", "manager"], size: "medium" },
  { id: "marketing", title: "Marketing Analytics", roles: ["owner", "admin", "manager"], size: "medium" },
  { id: "products", title: "Best Selling Products", roles: ["owner", "admin", "manager", "sales", "warehouse"], size: "medium" },
];

const paymentColors = ["#10b981", "#38bdf8", "#f59e0b", "#a78bfa", "#fb7185"];

const getRole = (user = getCurrentUser()) =>
  String(user?.role_name || user?.role || "admin").trim().toLowerCase().replace(/[_-]+/g, " ");

const roleKey = (role) => {
  if (["owner", "super admin", "superadmin", "admin"].includes(role)) return "owner";
  if (role.includes("cashier")) return "cashier";
  if (role.includes("warehouse")) return "warehouse";
  if (role.includes("sales")) return "sales";
  if (role.includes("manager")) return "manager";
  return role || "owner";
};

const layoutStorageKey = (user) => `erp.dashboard.layout.${user?.id || "default"}`;

const normalizeArray = (response) => (Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []);
const normalizeObject = (response, fallback = {}) => response?.data || response || fallback;
const hasSocketClient = Boolean(socket && typeof socket.on === "function");

const percent = (value) => `${Number(value || 0) >= 0 ? "+" : ""}${Number(value || 0).toFixed(1)}%`;
const number = (value) => Number(value || 0).toLocaleString("en-US");
const compactNumber = (value) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
const shortTime = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

const sparkPath = (values = [], width = 112, height = 34) => {
  const points = values.map((value) => Number(value || 0));
  if (!points.length) return "";
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  return points
    .map((value, index) => {
      const x = points.length === 1 ? width : (index / (points.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

const dayLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

function Dashboard() {
  const user = getCurrentUser();
  const tenant = getCurrentTenant();
  const role = roleKey(getRole(user));
  const [data, setData] = useState(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [hidden, setHidden] = useState([]);
  const [order, setOrder] = useState([]);
  const [sizes, setSizes] = useState({});
  const [branches, setBranches] = useState([]);
  const [socketConnected, setSocketConnected] = useState(Boolean(socket?.connected));
  const [filters, setFilters] = useState({ range: "today", date_from: "", date_to: "", branch_id: "all" });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(layoutStorageKey(user)) || "{}");
      setHidden(Array.isArray(saved.hidden) ? saved.hidden : []);
      setOrder(Array.isArray(saved.order) ? saved.order : []);
      setSizes(saved.sizes || {});
    } catch {
      setHidden([]);
      setOrder([]);
      setSizes({});
    }
  }, [user?.id]);

  const availableWidgets = useMemo(() => {
    const allowed = widgetDefinitions.filter((widget) => widget.roles.includes(role) || role === "owner");
    const ordered = order.length
      ? [...allowed].sort((a, b) => {
          const ai = order.indexOf(a.id);
          const bi = order.indexOf(b.id);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
      : allowed;
    return ordered.map((widget) => ({ ...widget, size: sizes[widget.id] || widget.size }));
  }, [order, role, sizes]);

  const visibleWidgets = availableWidgets.filter((widget) => !hidden.includes(widget.id));

  const persistLayout = useCallback((next) => {
    const payload = {
      hidden: next.hidden ?? hidden,
      order: next.order ?? order,
      sizes: next.sizes ?? sizes,
    };
    localStorage.setItem(layoutStorageKey(user), JSON.stringify(payload));
  }, [hidden, order, sizes, user]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", filters.range);
    if (filters.range === "custom") {
      if (filters.date_from) params.set("date_from", filters.date_from);
      if (filters.date_to) params.set("date_to", filters.date_to);
    }
    if (filters.branch_id && filters.branch_id !== "all") params.set("branch_id", filters.branch_id);
    return `?${params.toString()}`;
  }, [filters]);

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [
        overview,
        salesTrend,
        topProducts,
        lowStock,
        liveActivity,
        branchPerformance,
        paymentAnalytics,
        hourlySales,
        marketing,
        posLive,
        inventory,
        aiInsights,
      ] = await Promise.all([
        api.get(`/dashboard/overview${queryString}`),
        api.get(`/dashboard/sales-trend${queryString}`),
        api.get(`/dashboard/top-products${queryString}`),
        api.get("/dashboard/low-stock"),
        api.get(`/dashboard/live-activity${queryString}`),
        api.get(`/dashboard/branch-performance${queryString}`),
        api.get(`/dashboard/payment-analytics${queryString}`),
        api.get(`/dashboard/hourly-sales${queryString}`),
        api.get(`/dashboard/marketing${queryString}`),
        api.get("/dashboard/pos-live"),
        api.get("/dashboard/inventory"),
        api.get("/dashboard/ai-insights"),
      ]);

      setData({
        overview: normalizeObject(overview, null),
        salesTrend: normalizeArray(salesTrend).map((row) => ({ ...row, label: dayLabel(row.day), revenue: Number(row.revenue || 0), orders: Number(row.orders || 0) })),
        topProducts: normalizeArray(topProducts).map((row) => ({ ...row, quantity: Number(row.quantity || 0), revenue: Number(row.revenue || 0) })),
        lowStock: normalizeArray(lowStock),
        liveActivity: normalizeArray(liveActivity),
        branchPerformance: normalizeArray(branchPerformance).map((row) => ({ ...row, sales: Number(row.sales || 0), orders: Number(row.orders || 0) })),
        paymentAnalytics: normalizeArray(paymentAnalytics).map((row) => ({ ...row, amount: Number(row.amount || 0), orders: Number(row.orders || 0) })),
        hourlySales: normalizeArray(hourlySales).map((row) => ({ ...row, hourLabel: `${String(row.hour).padStart(2, "0")}:00`, sales: Number(row.sales || 0), orders: Number(row.orders || 0) })),
        marketing: normalizeObject(marketing, { channels: [], attributedSales: 0 }),
        posLive: normalizeObject(posLive, null),
        inventory: normalizeObject(inventory, null),
        aiInsights: normalizeArray(aiInsights),
      });
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    api.get("/branches")
      .then((response) => {
        const payload = response?.data || response;
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.branches) ? payload.branches : [];
        setBranches(rows);
      })
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    let timer = null;
    const scheduleRefresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => loadDashboard({ silent: true }), 450);
    };
    const addActivity = (payload) => {
      setData((current) => ({
        ...current,
        liveActivity: [
          {
            type: payload?.type || "order",
            title: payload?.invoice_number || payload?.invoiceNumber || payload?.title || "Live update",
            amount: Number(payload?.total_amount || payload?.total || payload?.amount || 0),
            status: payload?.status || payload?.payment_status || "live",
            created_at: payload?.created_at || new Date().toISOString(),
          },
          ...(current.liveActivity || []),
        ].slice(0, 40),
      }));
      scheduleRefresh();
    };
    if (!hasSocketClient) {
      return () => window.clearTimeout(timer);
    }

    const markConnected = () => setSocketConnected(true);
    const markDisconnected = () => setSocketConnected(false);
    const updateOnlineUsers = (payload) => setOnlineUsers(Number(payload?.count || 0));

    setSocketConnected(Boolean(socket.connected));
    socket.on("new_order", addActivity);
    socket.on("refresh_dashboard", scheduleRefresh);
    socket.on("dashboard:activity", addActivity);
    socket.on("dashboard:stock-alert", addActivity);
    socket.on("dashboard:online-users", updateOnlineUsers);
    socket.on("connect", markConnected);
    socket.on("disconnect", markDisconnected);
    socket.on("connect_error", markDisconnected);
    return () => {
      window.clearTimeout(timer);
      socket.off("new_order", addActivity);
      socket.off("refresh_dashboard", scheduleRefresh);
      socket.off("dashboard:activity", addActivity);
      socket.off("dashboard:stock-alert", addActivity);
      socket.off("dashboard:online-users", updateOnlineUsers);
      socket.off("connect", markConnected);
      socket.off("disconnect", markDisconnected);
      socket.off("connect_error", markDisconnected);
    };
  }, [loadDashboard]);

  const overview = data.overview || {};
  const revenueSparkline = data.salesTrend.map((row) => row.revenue);
  const orderSparkline = data.salesTrend.map((row) => row.orders);
  const hourlySparkline = data.hourlySales.map((row) => row.sales);
  const kpis = [
    { key: "todaySales", label: "Today's Sales", value: formatCurrency(overview.kpis?.todaySales?.value || 0), growth: overview.kpis?.todaySales?.growth, icon: Banknote, tone: "emerald", sparkline: revenueSparkline },
    { key: "todayProfit", label: "Today's Profit", value: formatCurrency(overview.kpis?.todayProfit?.value || 0), growth: overview.kpis?.todayProfit?.growth, icon: TrendingUp, tone: "sky", sparkline: revenueSparkline },
    { key: "todayOrders", label: "Today's Orders", value: number(overview.kpis?.todayOrders?.value), growth: overview.kpis?.todayOrders?.growth, icon: ShoppingCart, tone: "violet", sparkline: orderSparkline },
    { key: "averageOrderValue", label: "Average Order Value", value: formatCurrency(overview.kpis?.averageOrderValue?.value || 0), growth: overview.kpis?.averageOrderValue?.growth, icon: ReceiptText, tone: "amber", sparkline: revenueSparkline },
    { key: "activePosSessions", label: "Active POS Sessions", value: number(overview.kpis?.activePosSessions?.value), growth: overview.kpis?.activePosSessions?.growth, icon: MonitorDot, tone: "emerald", sparkline: hourlySparkline },
    { key: "lowStockProducts", label: "Low Stock Products", value: number(overview.kpis?.lowStockProducts?.value), growth: overview.kpis?.lowStockProducts?.growth, icon: AlertTriangle, tone: "rose", sparkline: data.lowStock.map((item) => item.stock) },
    { key: "pendingPurchaseOrders", label: "Pending Purchase Orders", value: number(overview.kpis?.pendingPurchaseOrders?.value), growth: overview.kpis?.pendingPurchaseOrders?.growth, icon: Package, tone: "cyan", sparkline: [] },
    { key: "totalCustomersToday", label: "Total Customers Today", value: number(overview.kpis?.totalCustomersToday?.value), growth: overview.kpis?.totalCustomersToday?.growth, icon: Users, tone: "blue", sparkline: orderSparkline },
  ];
  const productivityStats = [
    { label: "Revenue", value: compactNumber(overview.today?.sales || 0) },
    { label: "Orders", value: number(overview.today?.orders) },
    { label: "AOV", value: formatCurrency(overview.kpis?.averageOrderValue?.value || 0) },
  ];
  const openPosShifts = data.posLive?.openShifts || [];
  const hasPosActivity = openPosShifts.length > 0 || Number(data.posLive?.currentCartCounts || 0) > 0;
  const socketStatus = hasSocketClient && socketConnected
    ? { value: "Connected", tone: "emerald", pulse: true }
    : { value: "Live Polling", tone: "cyan", pulse: false };
  const posStatus = hasPosActivity
    ? { value: "Active", tone: "emerald", pulse: true }
    : { value: "Ready", tone: "cyan", pulse: false };

  const toggleHidden = (id) => {
    const nextHidden = hidden.includes(id) ? hidden.filter((item) => item !== id) : [...hidden, id];
    setHidden(nextHidden);
    persistLayout({ hidden: nextHidden });
  };

  const toggleSize = (id) => {
    const nextSizes = { ...sizes, [id]: sizes[id] === "wide" ? "medium" : "wide" };
    setSizes(nextSizes);
    persistLayout({ sizes: nextSizes });
  };

  const handleDrop = (targetId, sourceId) => {
    if (!sourceId || sourceId === targetId) return;
    const ids = availableWidgets.map((widget) => widget.id);
    const next = ids.filter((id) => id !== sourceId);
    next.splice(next.indexOf(targetId), 0, sourceId);
    setOrder(next);
    persistLayout({ order: next });
  };

  return (
    <div className="dashboard-premium relative isolate min-h-screen w-full overflow-x-hidden rounded-[28px] px-3 pb-8 pt-2 text-white sm:px-4">
      <div className="dashboard-ambient dashboard-ambient-one" />
      <div className="dashboard-ambient dashboard-ambient-two" />
      <div className="dashboard-noise" />

      <div className="sticky top-0 z-20 -mx-3 border-b border-white/[0.06] bg-zinc-950/55 px-3 py-3 backdrop-blur-2xl sm:-mx-4 sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.26em] text-emerald-300/90">ERP Control Center</div>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-white md:text-4xl">
              {getGreeting()}, {user?.name || "Admin"}
            </h1>
            <div className="mt-1 text-xs font-semibold text-zinc-400">{tenant?.name || tenant?.companyName || "Workspace"}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-zinc-300">
            <select value={filters.range} onChange={(event) => setFilters((current) => ({ ...current, range: event.target.value }))} className="h-9 rounded-xl border border-white/[0.08] bg-zinc-950/65 px-3 text-xs font-bold text-white outline-none backdrop-blur-xl transition hover:border-white/15">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7d">Last 7 days</option>
              <option value="month">This month</option>
              <option value="custom">Custom range</option>
            </select>
            {filters.range === "custom" ? (
              <>
                <input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} className="h-9 rounded-xl border border-white/[0.08] bg-zinc-950/65 px-3 text-xs text-white outline-none backdrop-blur-xl" />
                <input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} className="h-9 rounded-xl border border-white/[0.08] bg-zinc-950/65 px-3 text-xs text-white outline-none backdrop-blur-xl" />
              </>
            ) : null}
            {branches.length ? (
              <select value={filters.branch_id} onChange={(event) => setFilters((current) => ({ ...current, branch_id: event.target.value }))} className="h-9 rounded-xl border border-white/[0.08] bg-zinc-950/65 px-3 text-xs font-bold text-white outline-none backdrop-blur-xl">
                <option value="all">All branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            ) : null}
            <StatusPill label="Socket" value={socketStatus.value} tone={socketStatus.tone} pulse={socketStatus.pulse} />
            <StatusPill label="POS" value={posStatus.value} tone={posStatus.tone} pulse={posStatus.pulse} />
            <StatusPill label="Online" value={onlineUsers || "-"} tone="violet" pulse={Number(onlineUsers || 0) > 0} />
            <SessionTimer />
            <button type="button" onClick={() => loadDashboard()} className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-3 transition hover:-translate-y-0.5 hover:bg-white/[0.09] hover:shadow-lg hover:shadow-emerald-950/30">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <section className="relative z-10 mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <QuickAction to="/pos" icon={Store} label="Open POS" />
        <QuickAction to="/products/add" icon={Plus} label="Add Product" />
        <QuickAction to="/purchases/create" icon={Package} label="Create Purchase" />
        <QuickAction to="/orders" icon={ReceiptText} label="View Orders" />
      </section>

      <section className="relative z-10 mt-4 grid gap-2 md:grid-cols-4">
        <TodayCard label="Productivity" value={productivityStats.map((item) => `${item.label} ${item.value}`).join(" / ")} />
        <TodayCard label="Live orders" value={number(overview.today?.orders)} pulse={Number(overview.today?.orders || 0) > 0} />
        <TodayCard label="Active POS" value={number((data.posLive?.openShifts || []).length)} pulse={(data.posLive?.openShifts || []).length > 0} />
        <TodayCard label="Last update" value={lastUpdated ? shortTime(lastUpdated) : "-"} />
      </section>

      <section className="relative z-10 mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => <KpiCard key={kpi.key} {...kpi} loading={loading} />)}
      </section>

      {!loading && Number(overview.today?.orders || 0) === 0 && Number(overview.today?.sales || 0) === 0 ? <GettingStarted /> : null}

      <div className="relative z-10 mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <main className="min-w-0">
          <WidgetManager widgets={availableWidgets} hidden={hidden} onToggle={toggleHidden} />
          <div className="mt-3 grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {visibleWidgets.map((widget) => (
              <WidgetShell
                key={widget.id}
                widget={widget}
                onToggleSize={toggleSize}
                onDropWidget={handleDrop}
              >
                {loading ? <WidgetSkeleton /> : null}
                {!loading && widget.id === "sales" ? <SalesAnalytics salesTrend={data.salesTrend} hourlySales={data.hourlySales} /> : null}
                {!loading && widget.id === "activity" ? <ActivityFeed rows={data.liveActivity} /> : null}
                {!loading && widget.id === "inventory" ? <InventoryIntelligence inventory={data.inventory} /> : null}
                {!loading && widget.id === "pos" ? <PosLiveMonitor posLive={data.posLive} /> : null}
                {!loading && widget.id === "ai" ? <AiInsights insights={data.aiInsights} /> : null}
                {!loading && widget.id === "branches" ? <BranchPerformance rows={data.branchPerformance} /> : null}
                {!loading && widget.id === "marketing" ? <MarketingAnalytics marketing={data.marketing} /> : null}
                {!loading && widget.id === "products" ? <TopProducts rows={data.topProducts} /> : null}
              </WidgetShell>
            ))}
          </div>
        </main>

        <RightSidebar
          lowStock={data.lowStock}
          recentInvoices={overview.recentInvoices || []}
          posLive={data.posLive}
          activity={data.liveActivity}
          inventory={data.inventory}
          onlineUsers={onlineUsers}
        />
      </div>
    </div>
  );
}

function StatusPill({ label, value, tone = "emerald", pulse = false }) {
  const tones = {
    emerald: "border-emerald-300/15 bg-emerald-400/[0.08] text-emerald-100",
    sky: "border-sky-300/15 bg-sky-400/[0.08] text-sky-100",
    amber: "border-amber-300/15 bg-amber-400/[0.08] text-amber-100",
    violet: "border-violet-300/15 bg-violet-400/[0.08] text-violet-100",
  };
  return (
    <span className={`inline-flex h-9 items-center gap-2 rounded-xl border px-3 shadow-lg shadow-black/10 backdrop-blur-xl ${tones[tone]}`}>
      <LivePulse active={pulse} tone={tone} />
      {label}: <strong>{value}</strong>
    </span>
  );
}

function LivePulse({ active = true, tone = "emerald" }) {
  const tones = { emerald: "bg-emerald-300", amber: "bg-amber-300", sky: "bg-sky-300", violet: "bg-violet-300", rose: "bg-rose-300" };
  return <span className={`dashboard-pulse h-2 w-2 shrink-0 rounded-full ${tones[tone] || tones.emerald} ${active ? "" : "opacity-40"}`} />;
}

function SessionTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-3 text-zinc-200 shadow-lg shadow-black/10 backdrop-blur-xl">
      <TimerReset className="h-3.5 w-3.5 text-emerald-200" />
      {String(minutes).padStart(2, "0")}:{String(remainder).padStart(2, "0")}
    </span>
  );
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <Link to={to} className="group flex h-11 items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.045] px-4 text-sm font-black text-white shadow-lg shadow-black/10 backdrop-blur-xl transition duration-200 hover:-translate-y-1 hover:border-emerald-300/20 hover:bg-emerald-400/[0.08] hover:shadow-emerald-950/30">
      <span className="inline-flex items-center gap-2"><Icon className="h-4 w-4 text-emerald-300" />{label}</span>
      <ArrowUpRight className="h-4 w-4 text-zinc-500 transition group-hover:text-emerald-200" />
    </Link>
  );
}

function GettingStarted() {
  const items = [
    { to: "/products/add", label: "Create first product", icon: Package },
    { to: "/pos", label: "Make first POS sale", icon: ShoppingCart },
    { to: "/suppliers", label: "Add supplier", icon: Users },
    { to: "/purchases/create", label: "Create purchase invoice", icon: ReceiptText },
  ];
  return (
    <section className="mt-4 rounded-2xl border border-emerald-300/15 bg-gradient-to-br from-emerald-400/10 via-white/[0.035] to-sky-400/5 p-4 shadow-2xl shadow-black/15">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Getting started today</div>
          <p className="mt-1 text-sm text-zinc-400">No sales activity exists for this filter yet. Start from one of the operational shortcuts below.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(({ to, label, icon: Icon }) => (
            <Link key={label} to={to} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-zinc-950/70 px-3 text-xs font-black text-zinc-100 transition hover:bg-white/10">
              <Icon className="h-4 w-4 text-emerald-300" />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function TodayCard({ label, value, pulse = false }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] px-3.5 py-2.5 shadow-lg shadow-black/10 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
        {pulse ? <LivePulse tone="emerald" /> : null}
        {label}
      </div>
      <div className="mt-1 truncate text-base font-black text-white">{value}</div>
    </div>
  );
}

const KpiCard = memo(function KpiCard({ label, value, growth, icon: Icon, tone, loading, sparkline = [] }) {
  const positive = Number(growth || 0) >= 0;
  const palette = {
    emerald: { icon: "from-emerald-300/30 to-emerald-500/5 text-emerald-100 shadow-emerald-500/20", stroke: "#34d399" },
    sky: { icon: "from-sky-300/30 to-sky-500/5 text-sky-100 shadow-sky-500/20", stroke: "#38bdf8" },
    violet: { icon: "from-violet-300/30 to-violet-500/5 text-violet-100 shadow-violet-500/20", stroke: "#a78bfa" },
    amber: { icon: "from-amber-300/30 to-amber-500/5 text-amber-100 shadow-amber-500/20", stroke: "#fbbf24" },
    rose: { icon: "from-rose-300/30 to-rose-500/5 text-rose-100 shadow-rose-500/20", stroke: "#fb7185" },
    cyan: { icon: "from-cyan-300/30 to-cyan-500/5 text-cyan-100 shadow-cyan-500/20", stroke: "#22d3ee" },
    blue: { icon: "from-blue-300/30 to-blue-500/5 text-blue-100 shadow-blue-500/20", stroke: "#60a5fa" },
  }[tone] || { icon: "from-emerald-300/30 to-emerald-500/5 text-emerald-100", stroke: "#34d399" };
  const path = sparkPath(sparkline);
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[linear-gradient(145deg,rgba(255,255,255,0.085),rgba(255,255,255,0.025)_42%,rgba(9,9,11,0.78))] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl transition duration-300 hover:-translate-y-1 hover:border-white/15 hover:shadow-emerald-950/25">
      <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-emerald-300/10 blur-3xl transition group-hover:bg-emerald-300/20" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</div>
          <div className="mt-1.5 truncate text-2xl font-black tracking-tight text-white">{loading ? <SkeletonLine className="h-7 w-24" /> : value}</div>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br shadow-lg ${palette.icon}`}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-black ${positive ? "bg-emerald-400/10 text-emerald-200" : "bg-rose-400/10 text-rose-200"}`}>
          {positive ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {percent(growth)}
        </div>
        <MiniSparkline path={path} stroke={palette.stroke} />
      </div>
    </div>
  );
});

function MiniSparkline({ path, stroke }) {
  if (!path) return <div className="h-[34px] w-28 rounded-lg bg-white/[0.025]" />;
  return (
    <svg viewBox="0 0 112 34" className="h-[34px] w-28 overflow-visible" role="img" aria-label="Trend sparkline">
      <path d={`${path} L 112 34 L 0 34 Z`} fill={stroke} opacity="0.1" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SkeletonLine({ className = "h-4 w-full" }) {
  return <span className={`block animate-pulse rounded-full bg-white/10 ${className}`} />;
}

function WidgetManager({ widgets, hidden, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.035] p-2 shadow-xl shadow-black/10 backdrop-blur-xl">
      <span className="inline-flex h-9 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
        <LayoutGrid className="h-3.5 w-3.5" />
        Widgets
      </span>
      {widgets.map((widget) => (
        <button
          key={widget.id}
          type="button"
          onClick={() => onToggle(widget.id)}
          className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black transition hover:-translate-y-0.5 ${hidden.includes(widget.id) ? "bg-white/[0.035] text-zinc-500" : "bg-emerald-400/[0.08] text-emerald-100 shadow-lg shadow-emerald-950/10"}`}
        >
          {hidden.includes(widget.id) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {widget.title}
        </button>
      ))}
    </div>
  );
}

function WidgetShell({ widget, children, onToggleSize, onDropWidget }) {
  return (
    <section
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/widget-id", widget.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => onDropWidget(widget.id, event.dataTransfer.getData("text/widget-id"))}
      className={`min-w-0 rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-4 shadow-2xl shadow-black/20 backdrop-blur-2xl transition duration-300 hover:-translate-y-0.5 hover:border-white/14 hover:bg-zinc-950/68 ${widget.size === "wide" ? "2xl:col-span-2" : ""}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-zinc-600" />
          <h2 className="truncate text-base font-black text-white">{widget.title}</h2>
        </div>
        <button type="button" onClick={() => onToggleSize(widget.id)} className="rounded-lg border border-white/[0.07] bg-white/[0.045] px-2 py-1 text-[11px] font-bold text-zinc-300 transition hover:bg-white/[0.08]">
          {widget.size === "wide" ? "Compact" : "Wide"}
        </button>
      </div>
      {children}
    </section>
  );
}

function WidgetSkeleton() {
  return (
    <div className="space-y-3">
      <SkeletonLine className="h-7 w-1/3" />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="h-44 animate-pulse rounded-xl bg-white/[0.045]" />
        <div className="h-44 animate-pulse rounded-xl bg-white/[0.045]" />
      </div>
      <SkeletonLine className="h-4 w-2/3" />
    </div>
  );
}

function SalesAnalytics({ salesTrend, hourlySales }) {
  const hasTrend = (salesTrend || []).some((row) => Number(row.revenue || 0) > 0 || Number(row.orders || 0) > 0);
  const hasHourly = (hourlySales || []).some((row) => Number(row.sales || 0) > 0 || Number(row.orders || 0) > 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Revenue vs Orders">
        {hasTrend ? <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={salesTrend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#34d399" stopOpacity={0.55} /><stop offset="95%" stopColor="#34d399" stopOpacity={0} /></linearGradient>
              <linearGradient id="ordersGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#38bdf8" stopOpacity={0.28} /><stop offset="95%" stopColor="#38bdf8" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="label" stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
            <Tooltip content={<DashboardTooltip />} />
            <Area type="monotone" dataKey="revenue" stroke="#34d399" strokeWidth={3} fill="url(#salesGradient)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="orders" stroke="#38bdf8" strokeWidth={2} fill="url(#ordersGradient)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer> : <EmptyChart title="No sales in this range" message="Revenue and order trends will appear after real invoices are created." />}
      </ChartCard>
      <ChartCard title="Hourly Sales">
        {hasHourly ? <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hourlySales} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs><linearGradient id="hourlyGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#38bdf8" stopOpacity={0.85} /><stop offset="100%" stopColor="#10b981" stopOpacity={0.35} /></linearGradient></defs>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="hourLabel" stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
            <Tooltip content={<DashboardTooltip />} />
            <Bar dataKey="sales" fill="url(#hourlyGradient)" radius={[8, 8, 3, 3]} />
          </BarChart>
        </ResponsiveContainer> : <EmptyChart title="No hourly activity" message="Hourly sales will populate from POS and order activity." />}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }) {
  return <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.035] p-3 shadow-inner shadow-white/[0.02]"><div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">{title}</div>{children}</div>;
}

function EmptyChart({ title, message }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.09),transparent_55%)] px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10 text-emerald-200">
        <LineChartIcon className="h-6 w-6" />
      </div>
      <div className="mt-3 text-sm font-black text-white">{title}</div>
      <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">{message}</p>
    </div>
  );
}

function ActivityFeed({ rows }) {
  if (!(rows || []).length) {
    return <PremiumEmpty icon={Activity} title="No activity in this range" message="Orders, refunds, stock moves, customers, and shift events will appear here live." />;
  }
  return (
    <div className="max-h-[420px] overflow-auto pr-1">
      {(rows || []).slice(0, 24).map((row, index) => (
        <div key={`${row.type}-${row.created_at}-${index}`} className="mb-2 grid grid-cols-[24px_minmax(0,1fr)_auto] gap-3 rounded-xl bg-white/[0.025] px-3 py-2.5 transition hover:bg-white/[0.055]">
          <div className="relative flex justify-center">
            <span className="absolute top-7 h-full w-px bg-white/[0.06]" />
            <span className="relative mt-1 flex h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.6)]" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">{row.title || row.type}</div>
            <div className="mt-1 text-xs text-zinc-500">{row.type} · {row.status || "posted"}</div>
          </div>
          <div className="text-right text-xs font-bold text-zinc-400">
            <div>{Number(row.amount || 0) ? formatCurrency(row.amount) : ""}</div>
            <div className="mt-1">{shortTime(row.created_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InventoryIntelligence({ inventory }) {
  const low = inventory?.lowStock || [];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MiniList title="Low stock products" rows={low} getLabel={(row) => row.name} getValue={(row) => `${row.stock}/${row.threshold}`} icon={AlertTriangle} />
      <MiniList title="Fast moving products" rows={inventory?.fastMovingProducts || []} getLabel={(row) => row.name} getValue={(row) => `${row.quantity} sold`} icon={TrendingUp} />
      <MiniList title="Top sizes sold" rows={inventory?.topSizes || []} getLabel={(row) => row.size || "Unknown"} getValue={(row) => row.quantity} icon={Boxes} />
      <MiniList title="Top colors sold" rows={inventory?.topColors || []} getLabel={(row) => row.color || "Unknown"} getValue={(row) => row.quantity} icon={Warehouse} />
    </div>
  );
}

function PosLiveMonitor({ posLive }) {
  const rows = posLive?.paymentDistribution || [];
  return (
    <div className="grid gap-4 lg:grid-cols-[0.85fr_1fr]">
      <div className="space-y-3">
        <MetricTile label="Active cashiers" value={number(posLive?.activeCashiers)} icon={Users} />
        <MetricTile label="Open shifts" value={number((posLive?.openShifts || []).length)} icon={MonitorDot} />
        <MetricTile label="Current cart counts" value={number(posLive?.currentCartCounts)} icon={ShoppingCart} />
        <MetricTile label="Average checkout" value={`${number(posLive?.averageCheckoutTimeSeconds)}s`} icon={LineChartIcon} />
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3 shadow-inner shadow-white/[0.02]">
        <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Payment methods</div>
        {rows.length ? <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={rows} dataKey="amount" nameKey="method" innerRadius={54} outerRadius={86} paddingAngle={4}>
              {rows.map((_, index) => <Cell key={index} fill={paymentColors[index % paymentColors.length]} />)}
            </Pie>
            <Tooltip content={<DashboardTooltip />} />
          </PieChart>
        </ResponsiveContainer> : <PremiumEmpty icon={CreditCard} title="No payments yet" message="Payment distribution appears after real POS transactions." compact />}
        <div className="text-xs text-zinc-400">Last invoice: {posLive?.lastInvoice?.invoice_number || "-"}</div>
      </div>
    </div>
  );
}

function AiInsights({ insights }) {
  return (
    <div className="grid gap-3">
      {(insights || []).length ? insights.map((item, index) => (
        <div key={`${item.title}-${index}`} className="rounded-xl border border-emerald-300/12 bg-emerald-400/[0.06] p-3 shadow-lg shadow-emerald-950/10">
          <div className="flex items-center gap-2 text-sm font-black text-emerald-100"><Brain className="h-4 w-4" />{item.title}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{item.body}</p>
        </div>
      )) : <PremiumEmpty icon={Brain} title="Insights will appear after sales activity" message="The system needs real sales, inventory, and branch activity before it can generate useful business insights." />}
    </div>
  );
}

function BranchPerformance({ rows }) {
  const hasData = (rows || []).some((row) => Number(row.sales || 0) > 0 || Number(row.orders || 0) > 0);
  if (!hasData) return <EmptyChart title="No branch sales yet" message="Branch comparison appears once invoices are linked to branches." />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <defs><linearGradient id="branchGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.85} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0.35} /></linearGradient></defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="branch" stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
        <Tooltip content={<DashboardTooltip />} />
        <Bar dataKey="sales" fill="url(#branchGradient)" radius={[8, 8, 3, 3]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MarketingAnalytics({ marketing }) {
  const rows = (marketing?.channels || []).map((row) => ({ ...row, sales: Number(row.sales || 0), orders: Number(row.orders || 0) }));
  const hasData = rows.some((row) => row.sales > 0 || row.orders > 0);
  if (!hasData) return <EmptyChart title="No marketing attribution yet" message="Marketing analytics will appear when orders carry campaign attribution." />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs><linearGradient id="marketingGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a78bfa" stopOpacity={0.9} /><stop offset="100%" stopColor="#38bdf8" stopOpacity={0.35} /></linearGradient></defs>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="source" stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis stroke="#71717a" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
          <Tooltip content={<DashboardTooltip />} />
          <Bar dataKey="sales" fill="url(#marketingGradient)" radius={[8, 8, 3, 3]} />
        </BarChart>
      </ResponsiveContainer>
      <MetricTile label="Attributed sales" value={formatCurrency(marketing?.attributedSales || 0)} icon={Activity} />
    </div>
  );
}

function TopProducts({ rows }) {
  return <MiniList title="Best selling products" rows={rows} getLabel={(row) => row.name} getValue={(row) => `${row.quantity} · ${formatCurrency(row.revenue)}`} icon={Package} />;
}

function MiniList({ title, rows, getLabel, getValue, icon: Icon }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 shadow-inner shadow-white/[0.02]">
      <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500"><Icon className="h-4 w-4" />{title}</div>
      <div className="space-y-2">
        {(rows || []).slice(0, 6).map((row, index) => (
          <div key={`${getLabel(row)}-${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.025] px-3 py-2 text-sm transition hover:bg-white/[0.055]">
            <span className="min-w-0 truncate font-semibold text-zinc-200">{getLabel(row)}</span>
            <span className="shrink-0 font-black text-emerald-200">{getValue(row)}</span>
          </div>
        ))}
        {!(rows || []).length ? <PremiumEmpty icon={Icon} title="No records yet" message="This widget will fill automatically from real system activity." compact /> : null}
      </div>
    </div>
  );
}

function MetricTile({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 shadow-lg shadow-black/10 transition hover:-translate-y-0.5 hover:bg-white/[0.05]">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-zinc-500"><Icon className="h-4 w-4" />{label}</div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function RightSidebar({ lowStock, recentInvoices, posLive, activity, inventory, onlineUsers }) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-24 xl:self-start">
      <SidePanel title="Notifications" icon={Bell}>
        <NotificationLine tone="emerald" label="System live" value="Realtime updates enabled" pulse />
        <NotificationLine tone="amber" label="Pending transfers" value={number(inventory?.pendingTransfers)} />
        <NotificationLine tone="sky" label="Online users" value={number(onlineUsers)} pulse={Number(onlineUsers || 0) > 0} />
      </SidePanel>
      <SidePanel title="Low stock alerts" icon={AlertTriangle}>
        {(lowStock || []).slice(0, 6).map((item) => <NotificationLine key={`${item.id}-${item.sku}`} tone="rose" label={item.name} value={`${item.stock}/${item.threshold}`} />)}
        {!(lowStock || []).length ? <PremiumEmpty icon={AlertTriangle} title="Stock is healthy" message="Low stock alerts will appear when products fall below their thresholds." compact /> : null}
      </SidePanel>
      <SidePanel title="Recent invoices" icon={ReceiptText}>
        {(recentInvoices || []).slice(0, 6).map((invoice) => <NotificationLine key={invoice.id} tone="emerald" label={invoice.invoice_number} value={formatCurrency(invoice.total)} />)}
        {!(recentInvoices || []).length ? <PremiumEmpty icon={ReceiptText} title="No invoices yet" message="Recent invoices will appear after POS or order sales." compact /> : null}
      </SidePanel>
      <SidePanel title="POS sessions" icon={CreditCard}>
        {(posLive?.openShifts || []).slice(0, 5).map((shift) => <NotificationLine key={shift.id} tone="sky" label={shift.cashier || shift.name || `Shift ${shift.id}`} value={shift.status} />)}
        {!(posLive?.openShifts || []).length ? <PremiumEmpty icon={MonitorDot} title="No open POS sessions" message="Open a cashier shift to monitor live POS activity." compact /> : null}
      </SidePanel>
      <SidePanel title="Live stream" icon={Activity}>
        {(activity || []).slice(0, 5).map((item, index) => <NotificationLine key={`${item.created_at}-${index}`} tone="violet" label={item.title || item.type} value={shortTime(item.created_at)} />)}
      </SidePanel>
    </aside>
  );
}

function SidePanel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-zinc-950/58 p-3.5 shadow-2xl shadow-black/20 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-black text-white"><Icon className="h-4 w-4 text-emerald-300" />{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function NotificationLine({ label, value, tone = "emerald", pulse = false }) {
  const tones = { emerald: "bg-emerald-400", amber: "bg-amber-400", sky: "bg-sky-400", rose: "bg-rose-400", violet: "bg-violet-400" };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.028] px-3 py-2 text-xs transition hover:bg-white/[0.055]">
      <div className="flex min-w-0 items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${tones[tone]} ${pulse ? "dashboard-pulse" : ""}`} /><span className="truncate font-bold text-zinc-300">{label}</span></div>
      <span className="shrink-0 font-black text-white">{value}</span>
    </div>
  );
}

function PremiumEmpty({ icon: Icon, title, message, compact = false }) {
  return (
    <div className={`rounded-xl border border-dashed border-white/[0.08] bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.08),rgba(255,255,255,0.02)_48%,transparent)] text-center ${compact ? "px-3 py-4" : "px-5 py-8"}`}>
      <div className={`mx-auto flex items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-zinc-400 shadow-lg shadow-emerald-950/10 ${compact ? "h-9 w-9" : "h-12 w-12"}`}>
        <Icon className={compact ? "h-4 w-4" : "h-6 w-6"} />
      </div>
      <div className="mt-3 text-sm font-black text-white">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-zinc-500">{message}</p>
    </div>
  );
}

function DashboardTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="dashboard-tooltip rounded-xl border border-white/[0.08] bg-zinc-950/90 px-3 py-2 text-xs shadow-2xl shadow-black/40 backdrop-blur-xl">
      <div className="mb-1 font-black text-white">{label}</div>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex min-w-[140px] items-center justify-between gap-4 text-zinc-300">
          <span>{item.name || item.dataKey}</span>
          <span className="font-black text-white">{typeof item.value === "number" && item.value > 99 ? number(item.value) : item.value}</span>
        </div>
      ))}
    </div>
  );
}

export default Dashboard;

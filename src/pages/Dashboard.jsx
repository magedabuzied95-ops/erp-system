import React, { memo } from "react";
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
import { useTranslation } from "react-i18next";

import { socket } from "../socket";
import LiveActivityFeed from "../components/activity/LiveActivityFeed";
import { api } from "../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../shared/auth/authStorage";
import { formatCurrency } from "../shared/lib/currency";
import { safeSetLocalStorage } from "../utils/safeStorage";
import { normalizeSaleModeSettings, resolveSaleModePrice } from "../shared/lib/saleMode";

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
  saleMode: null,
  saleModeAnalytics: null,
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

const getDashboardCopy = (isArabic) => ({
  widgetTitles: {
    sales: isArabic ? "تحليلات المبيعات المباشرة" : "Live Sales Analytics",
    activity: isArabic ? "سجل النشاط" : "Activity Feed",
    inventory: isArabic ? "ذكاء المخزون" : "Inventory Intelligence",
    pos: isArabic ? "مراقبة نقطة البيع المباشرة" : "POS Live Monitor",
    ai: isArabic ? "رؤى الذكاء الاصطناعي" : "AI Insights",
    branches: isArabic ? "أداء الفروع" : "Branch Performance",
    marketing: isArabic ? "تحليلات التسويق" : "Marketing Analytics",
    products: isArabic ? "المنتجات الأعلى مبيعًا" : "Best Selling Products",
  },
  greeting: {
    morning: isArabic ? "صباح الخير" : "Good morning",
    afternoon: isArabic ? "مساء الخير" : "Good afternoon",
    evening: isArabic ? "مساء الخير" : "Good evening",
  },
  executiveControlCenter: isArabic ? "مركز التحكم التنفيذي" : "Executive Control Center",
  admin: isArabic ? "المدير" : "Admin",
  workspace: isArabic ? "مساحة العمل" : "Workspace",
  updated: isArabic ? "آخر تحديث" : "Updated",
  today: isArabic ? "اليوم" : "Today",
  yesterday: isArabic ? "أمس" : "Yesterday",
  last7Days: isArabic ? "آخر 7 أيام" : "Last 7 days",
  thisMonth: isArabic ? "هذا الشهر" : "This month",
  customRange: isArabic ? "نطاق مخصص" : "Custom range",
  allBranches: isArabic ? "كل الفروع" : "All branches",
  socket: isArabic ? "الاتصال" : "Socket",
  pos: "POS",
  focusMode: isArabic ? "وضع التركيز" : "Focus mode",
  fullMode: isArabic ? "الوضع الكامل" : "Full mode",
  refresh: isArabic ? "تحديث" : "Refresh",
  connected: isArabic ? "متصل" : "Connected",
  livePolling: isArabic ? "تحديث دوري مباشر" : "Live Polling",
  active: isArabic ? "نشط" : "Active",
  ready: isArabic ? "جاهز" : "Ready",
  orders: isArabic ? "الطلبات" : "Orders",
  product: isArabic ? "منتج" : "Product",
  products: isArabic ? "المنتجات" : "Products",
  aiCenter: isArabic ? "مركز الذكاء الاصطناعي" : "AI Center",
  lowStockProduct: isArabic ? "منتج منخفض المخزون" : "Low stock product",
  remaining: isArabic ? "متبقٍ" : "remaining",
  latestActivity: isArabic ? "آخر نشاط" : "Latest activity",
  noCriticalAlerts: isArabic ? "لا توجد تنبيهات حرجة" : "No critical alerts",
  operationsCalm: isArabic ? "العمليات مستقرة" : "Operations are calm",
  revenueToday: isArabic ? "إيراد اليوم" : "Revenue today",
  ordersToday: isArabic ? "طلبات اليوم" : "Orders today",
  aov: isArabic ? "متوسط الطلب" : "AOV",
  activePos: isArabic ? "نقاط البيع النشطة" : "Active POS",
  lowStock: isArabic ? "مخزون منخفض" : "Low stock",
  needsAttention: isArabic ? "يحتاج متابعة" : "Needs attention",
  healthy: isArabic ? "سليم" : "Healthy",
  latestAlert: isArabic ? "آخر تنبيه" : "Latest alert",
  salesAnalytics: isArabic ? "تحليلات المبيعات" : "Sales analytics",
  inventoryIntelligence: isArabic ? "ذكاء المخزون" : "Inventory intelligence",
  aiInsights: isArabic ? "رؤى الذكاء الاصطناعي" : "AI insights",
  staffActivity: isArabic ? "نشاط الموظفين" : "Staff activity",
  marketingAnalytics: isArabic ? "تحليلات التسويق" : "Marketing analytics",
  activityFeed: isArabic ? "سجل النشاط" : "Activity feed",
  existingSalePricesActive: isArabic ? "أسعار التخفيض المحفوظة مفعلة" : "Existing Sale Prices Active",
  savedSalePricesLive: isArabic ? "تم تفعيل المنتجات ذات أسعار التخفيض المحفوظة." : "Products with saved sale prices are now live.",
  affectedProducts: isArabic ? "المنتجات المتأثرة" : "Affected products",
  estimatedDiscountImpact: isArabic ? "الأثر التقديري للخصم" : "Est. discount impact",
  activeCashiers: isArabic ? "الكاشيرون النشطون" : "Active cashiers",
  openShifts: isArabic ? "الورديات المفتوحة" : "Open shifts",
  currentCarts: isArabic ? "السلات الحالية" : "Current carts",
  widgets: isArabic ? "العناصر" : "Widgets",
  compact: isArabic ? "مضغوط" : "Compact",
  wide: isArabic ? "واسع" : "Wide",
  gettingStartedToday: isArabic ? "ابدأ اليوم" : "Getting started today",
  noSalesForFilter: isArabic ? "لا يوجد نشاط مبيعات لهذا الفلتر بعد. ابدأ من أحد الاختصارات التشغيلية التالية." : "No sales activity exists for this filter yet. Start from one of the operational shortcuts below.",
  createFirstProduct: isArabic ? "إنشاء أول منتج" : "Create first product",
  makeFirstPosSale: isArabic ? "تنفيذ أول عملية بيع POS" : "Make first POS sale",
  addSupplier: isArabic ? "إضافة مورد" : "Add supplier",
  createPurchaseInvoice: isArabic ? "إنشاء فاتورة شراء" : "Create purchase invoice",
  trendSparkline: isArabic ? "اتجاه الأداء" : "Trend sparkline",
  revenueVsOrders: isArabic ? "الإيراد مقابل الطلبات" : "Revenue vs Orders",
  noSalesInRange: isArabic ? "لا توجد مبيعات في هذا النطاق" : "No sales in this range",
  salesTrendAppears: isArabic ? "ستظهر اتجاهات الإيراد والطلبات بعد إنشاء فواتير فعلية." : "Revenue and order trends will appear after real invoices are created.",
  hourlySales: isArabic ? "المبيعات حسب الساعة" : "Hourly Sales",
  noHourlyActivity: isArabic ? "لا توجد حركة حسب الساعة" : "No hourly activity",
  hourlySalesAppear: isArabic ? "ستُعرض المبيعات حسب الساعة من نشاط نقطة البيع والطلبات." : "Hourly sales will populate from POS and order activity.",
  noActivityInRange: isArabic ? "لا يوجد نشاط في هذا النطاق" : "No activity in this range",
  activityAppears: isArabic ? "ستظهر هنا مباشرة الطلبات والمرتجعات وحركات المخزون والعملاء والورديات." : "Orders, refunds, stock moves, customers, and shift events will appear here live.",
  lowStockProducts: isArabic ? "منتجات منخفضة المخزون" : "Low stock products",
  fastMovingProducts: isArabic ? "المنتجات الأسرع حركة" : "Fast moving products",
  sold: isArabic ? "مباع" : "sold",
  topSizesSold: isArabic ? "المقاسات الأعلى مبيعًا" : "Top sizes sold",
  topColorsSold: isArabic ? "الألوان الأعلى مبيعًا" : "Top colors sold",
  unknown: isArabic ? "غير معروف" : "Unknown",
  currentCartCounts: isArabic ? "عدد السلات الحالية" : "Current cart counts",
  averageCheckout: isArabic ? "متوسط مدة الدفع" : "Average checkout",
  paymentMethods: isArabic ? "طرق الدفع" : "Payment methods",
  noPaymentsYet: isArabic ? "لا توجد مدفوعات بعد" : "No payments yet",
  paymentDistributionAppears: isArabic ? "سيظهر توزيع طرق الدفع بعد عمليات نقطة البيع الفعلية." : "Payment distribution appears after real POS transactions.",
  lastInvoice: isArabic ? "آخر فاتورة" : "Last invoice",
  insightsAppear: isArabic ? "ستظهر الرؤى بعد وجود نشاط مبيعات" : "Insights will appear after sales activity",
  insightsNeedData: isArabic ? "يحتاج النظام إلى مبيعات ومخزون ونشاط فروع فعلي ليولّد رؤى مفيدة." : "The system needs real sales, inventory, and branch activity before it can generate useful business insights.",
  noBranchSalesYet: isArabic ? "لا توجد مبيعات فروع بعد" : "No branch sales yet",
  branchComparisonAppears: isArabic ? "ستظهر مقارنة الفروع عند ربط الفواتير بالفروع." : "Branch comparison appears once invoices are linked to branches.",
  noMarketingAttribution: isArabic ? "لا توجد نسبة تسويقية بعد" : "No marketing attribution yet",
  marketingAnalyticsAppear: isArabic ? "ستظهر تحليلات التسويق عندما تحمل الطلبات مصدر الحملة." : "Marketing analytics will appear when orders carry campaign attribution.",
  attributedSales: isArabic ? "المبيعات المنسوبة" : "Attributed sales",
  bestSellingProducts: isArabic ? "المنتجات الأعلى مبيعًا" : "Best selling products",
  noRecordsYet: isArabic ? "لا توجد سجلات بعد" : "No records yet",
  widgetAutoFill: isArabic ? "سيتم ملء هذا العنصر تلقائيًا من نشاط النظام الفعلي." : "This widget will fill automatically from real system activity.",
  notifications: isArabic ? "الإشعارات" : "Notifications",
  systemUpdate: isArabic ? "تحديث نظام" : "System update",
  systemLive: isArabic ? "النظام مباشر" : "System live",
  noNewAlerts: isArabic ? "لا توجد تنبيهات جديدة" : "No new alerts",
  lowStockAlerts: isArabic ? "تنبيهات المخزون المنخفض" : "Low stock alerts",
  stockHealthy: isArabic ? "المخزون بحالة جيدة" : "Stock is healthy",
  lowStockAppear: isArabic ? "ستظهر تنبيهات المخزون المنخفض عندما تهبط المنتجات أسفل الحد المحدد." : "Low stock alerts will appear when products fall below their thresholds.",
  recentInvoices: isArabic ? "أحدث الفواتير" : "Recent invoices",
  noInvoicesYet: isArabic ? "لا توجد فواتير بعد" : "No invoices yet",
  recentInvoicesAppear: isArabic ? "ستظهر أحدث الفواتير بعد مبيعات نقطة البيع أو الطلبات." : "Recent invoices will appear after POS or order sales.",
  liveUpdate: isArabic ? "تحديث مباشر" : "Live update",
});

const getGreeting = (copy) => {
  const hour = new Date().getHours();
  if (hour < 12) return copy.greeting.morning;
  if (hour < 18) return copy.greeting.afternoon;
  return copy.greeting.evening;
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
  const { i18n } = useTranslation();
  const isArabic = String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar");
  const copy = React.useMemo(() => getDashboardCopy(isArabic), [isArabic]);
  const user = getCurrentUser();
  const tenant = getCurrentTenant();
  const role = roleKey(getRole(user));
  const [data, setData] = React.useState(emptyDashboard);
  const [loading, setLoading] = React.useState(true);
  const [lastUpdated, setLastUpdated] = React.useState(null);
  const [onlineUsers, setOnlineUsers] = React.useState(0);
  const [hidden, setHidden] = React.useState([]);
  const [order, setOrder] = React.useState([]);
  const [sizes, setSizes] = React.useState({});
  const [branches, setBranches] = React.useState([]);
  const [socketConnected, setSocketConnected] = React.useState(Boolean(socket?.connected));
  const [filters, setFilters] = React.useState({ range: "today", date_from: "", date_to: "", branch_id: "all" });
  const [focusMode, setFocusMode] = React.useState(() => localStorage.getItem("erp.dashboard.mode") === "focus");
  const [activeSection, setActiveSection] = React.useState("sales");

  React.useEffect(() => {
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

  const availableWidgets = React.useMemo(() => {
    const allowed = widgetDefinitions.filter((widget) => widget.roles.includes(role) || role === "owner");
    const ordered = order.length
      ? [...allowed].sort((a, b) => {
          const ai = order.indexOf(a.id);
          const bi = order.indexOf(b.id);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        })
      : allowed;
    return ordered.map((widget) => ({
      ...widget,
      title: copy.widgetTitles[widget.id] || widget.title,
      size: sizes[widget.id] || widget.size,
    }));
  }, [copy.widgetTitles, order, role, sizes]);

  const visibleWidgets = availableWidgets.filter((widget) => !hidden.includes(widget.id));

  const persistLayout = React.useCallback((next) => {
    const payload = {
      hidden: next.hidden ?? hidden,
      order: next.order ?? order,
      sizes: next.sizes ?? sizes,
    };
    safeSetLocalStorage(layoutStorageKey(user), payload, { maxBytes: 16 * 1024 });
  }, [hidden, order, sizes, user]);

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", filters.range);
    if (filters.range === "custom") {
      if (filters.date_from) params.set("date_from", filters.date_from);
      if (filters.date_to) params.set("date_to", filters.date_to);
    }
    if (filters.branch_id && filters.branch_id !== "all") params.set("branch_id", filters.branch_id);
    return `?${params.toString()}`;
  }, [filters]);

  const loadDashboard = React.useCallback(async ({ silent = false } = {}) => {
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
        websiteSettings,
        productFeed,
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
        api.get("/website/settings").catch(() => ({ settings: {} })),
        api.get("/products/with-variants").catch(() => ({ products: [] })),
      ]);
      const saleMode = normalizeSaleModeSettings(websiteSettings?.settings || {});
      const products = normalizeArray(productFeed?.products ? productFeed.products : productFeed);
      const saleModeAnalytics = products.reduce((acc, product) => {
        const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [product];
        variants.forEach((variant) => {
          const regular = Number(variant.regular_price || variant.price || product.regular_price || product.price || 0);
          const resolved = resolveSaleModePrice({
            ...product,
            ...variant,
            id: product.id,
            product_id: product.id,
            regular_price: regular,
            price: regular,
            sale_price: variant.sale_price || product.sale_price,
            sale_price_enabled: variant.sale_price_enabled ?? product.sale_price_enabled,
            cost_price: variant.cost_price || product.cost_price,
          }, saleMode);
          if (saleMode.sale_mode_enabled && resolved.final_price > 0 && resolved.final_price < regular) {
            acc.affectedProducts.add(String(product.id || product.product_id));
            acc.estimatedDiscountImpact += regular - resolved.final_price;
          }
        });
        return acc;
      }, { affectedProducts: new Set(), estimatedDiscountImpact: 0 });

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
        saleMode,
        saleModeAnalytics: {
          affectedProductsCount: saleModeAnalytics.affectedProducts.size,
          estimatedDiscountImpact: saleModeAnalytics.estimatedDiscountImpact,
        },
      });
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  React.useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  React.useEffect(() => {
    safeSetLocalStorage("erp.dashboard.mode", focusMode ? "focus" : "full", { raw: true, debug: true });
  }, [focusMode]);

  React.useEffect(() => {
    api.get("/branches")
      .then((response) => {
        const payload = response?.data || response;
        const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.branches) ? payload.branches : [];
        setBranches(rows);
      })
      .catch(() => setBranches([]));
  }, []);

  React.useEffect(() => {
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
            title: payload?.invoice_number || payload?.invoiceNumber || payload?.title || copy.liveUpdate,
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
  }, [copy.liveUpdate, loadDashboard]);

  const overview = data.overview || {};
  const openPosShifts = data.posLive?.openShifts || [];
  const hasPosActivity = openPosShifts.length > 0 || Number(data.posLive?.currentCartCounts || 0) > 0;
  const socketStatus = hasSocketClient && socketConnected
    ? { value: copy.connected, tone: "emerald", pulse: true }
    : { value: copy.livePolling, tone: "slate", pulse: false };
  const posStatus = hasPosActivity
    ? { value: copy.active, tone: "emerald", pulse: true }
    : { value: copy.ready, tone: "slate", pulse: false };
  const quickActions = [
    { to: "/pos", icon: Store, label: "POS", primary: true },
    { to: "/orders", icon: ReceiptText, label: copy.orders },
    { to: "/products/add", icon: Plus, label: copy.product },
    { to: "/products", icon: Boxes, label: copy.products },
    { to: "/marketing/ai-center", icon: Brain, label: copy.aiCenter },
  ];
  const latestAlert = React.useMemo(() => {
    const low = (data.lowStock || [])[0];
    if (low) return { tone: "amber", title: low.name || copy.lowStockProduct, detail: `${number(low.stock)} / ${number(low.threshold)} ${copy.remaining}` };
    const activity = (data.liveActivity || [])[0];
    if (activity) return { tone: "slate", title: activity.title || activity.type || copy.latestActivity, detail: shortTime(activity.created_at) };
    return { tone: "emerald", title: copy.noCriticalAlerts, detail: copy.operationsCalm };
  }, [copy, data.liveActivity, data.lowStock]);
  const executiveCards = [
    { label: copy.revenueToday, value: formatCurrency(overview.kpis?.todaySales?.value || overview.today?.sales || 0), icon: Banknote, tone: "emerald", detail: percent(overview.kpis?.todaySales?.growth || 0) },
    { label: copy.ordersToday, value: number(overview.kpis?.todayOrders?.value ?? overview.today?.orders), icon: ShoppingCart, tone: "slate", detail: `${formatCurrency(overview.kpis?.averageOrderValue?.value || 0)} ${copy.aov}` },
    { label: copy.activePos, value: number(openPosShifts.length), icon: MonitorDot, tone: hasPosActivity ? "emerald" : "slate", detail: posStatus.value },
    { label: copy.lowStock, value: number(data.lowStock.length || overview.kpis?.lowStockProducts?.value), icon: AlertTriangle, tone: data.lowStock.length ? "amber" : "emerald", detail: data.lowStock.length ? copy.needsAttention : copy.healthy },
    { label: copy.latestAlert, value: latestAlert.title, icon: Bell, tone: latestAlert.tone, detail: latestAlert.detail, textValue: true },
  ];
  const hasSalesData = [...(data.salesTrend || []), ...(data.hourlySales || [])].some((row) => Number(row.revenue || row.sales || row.orders || 0) > 0);
  const hasInventoryData = Boolean((data.inventory?.lowStock || []).length || (data.inventory?.fastMovingProducts || []).length || (data.inventory?.topSizes || []).length || (data.inventory?.topColors || []).length);
  const hasAiData = Boolean((data.aiInsights || []).length);
  const hasStaffData = Boolean(openPosShifts.length || Number(data.posLive?.activeCashiers || 0) > 0);
  const hasMarketingData = Boolean((data.marketing?.channels || []).some((row) => Number(row.sales || row.orders || 0) > 0));
  const hasActivityData = Boolean((data.liveActivity || []).length);
  const secondarySections = [
    { id: "sales", label: copy.salesAnalytics, icon: LineChartIcon, show: hasSalesData, render: () => <SalesAnalytics salesTrend={data.salesTrend} hourlySales={data.hourlySales} /> },
    { id: "inventory", label: copy.inventoryIntelligence, icon: Warehouse, show: hasInventoryData, render: () => <InventoryIntelligence inventory={data.inventory} /> },
    { id: "ai", label: copy.aiInsights, icon: Brain, show: hasAiData, render: () => <AiInsights insights={data.aiInsights} /> },
    { id: "staff", label: copy.staffActivity, icon: Users, show: hasStaffData, render: () => <StaffActivity posLive={data.posLive} /> },
    { id: "marketing", label: copy.marketingAnalytics, icon: Activity, show: hasMarketingData, render: () => <MarketingAnalytics marketing={data.marketing} /> },
    { id: "activity", label: copy.activityFeed, icon: Bell, show: hasActivityData, render: () => <LiveActivityFeed initialEvents={data.liveActivity} /> },
  ].filter((section) => section.show);
  const activeSecondary = secondarySections.find((section) => section.id === activeSection) || secondarySections[0];

  return (
    <div className="dashboard-premium relative isolate min-h-screen w-full overflow-x-hidden rounded-[28px] px-4 pb-10 pt-4 text-slate-100 sm:px-6">
      <div className="sticky top-0 z-20 -mx-4 border-b border-slate-700/45 bg-[#07111f]/88 px-4 py-4 backdrop-blur-xl sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{copy.executiveControlCenter}</div>
            <h1 className="mt-1 text-2xl font-black tracking-normal text-white md:text-4xl">
              {getGreeting(copy)}, {user?.name || copy.admin}
            </h1>
            <div className="mt-1 text-sm font-semibold text-slate-400">{tenant?.name || tenant?.companyName || copy.workspace}{lastUpdated ? ` · ${copy.updated} ${shortTime(lastUpdated)}` : ""}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-300 xl:justify-end">
            <div className="flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-slate-700/50 bg-slate-900/55 p-1">
              {quickActions.map((action) => (
                <QuickAction key={action.to} {...action} />
              ))}
            </div>
            <select value={filters.range} onChange={(event) => setFilters((current) => ({ ...current, range: event.target.value }))} className="h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none transition hover:border-slate-500">
              <option value="today">{copy.today}</option>
              <option value="yesterday">{copy.yesterday}</option>
              <option value="7d">{copy.last7Days}</option>
              <option value="month">{copy.thisMonth}</option>
              <option value="custom">{copy.customRange}</option>
            </select>
            {filters.range === "custom" ? (
              <>
                <input type="date" value={filters.date_from} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value }))} className="h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-xs text-white outline-none" />
                <input type="date" value={filters.date_to} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value }))} className="h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-xs text-white outline-none" />
              </>
            ) : null}
            {branches.length > 1 ? (
              <select value={filters.branch_id} onChange={(event) => setFilters((current) => ({ ...current, branch_id: event.target.value }))} className="h-10 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none">
                <option value="all">{copy.allBranches}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            ) : null}
            <StatusPill label={copy.socket} value={socketStatus.value} tone={socketStatus.tone} pulse={socketStatus.pulse} />
            <StatusPill label={copy.pos} value={posStatus.value} tone={posStatus.tone} pulse={posStatus.pulse} />
            <button
              type="button"
              onClick={() => setFocusMode((value) => !value)}
              className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black transition ${focusMode ? "border-emerald-400/35 bg-emerald-500/12 text-emerald-100" : "border-slate-700 bg-slate-900/70 text-slate-200 hover:border-slate-500"}`}
            >
              {focusMode ? copy.focusMode : copy.fullMode}
            </button>
            <button type="button" onClick={() => loadDashboard()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-3 transition hover:border-slate-500 hover:bg-slate-800/75">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {copy.refresh}
            </button>
          </div>
        </div>
      </div>

      <section className="relative z-10 mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {executiveCards.map((card) => <ExecutiveCard key={card.label} {...card} loading={loading} />)}
      </section>

      {!loading && Number(overview.today?.orders || 0) === 0 && Number(overview.today?.sales || 0) === 0 ? <GettingStarted /> : null}

      <div className="relative z-10 mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-6">
          {!focusMode && secondarySections.length ? (
            <ExecutiveSection
              sections={secondarySections}
              activeId={activeSecondary?.id}
              onSelect={setActiveSection}
            >
              {loading ? <WidgetSkeleton /> : activeSecondary?.render()}
            </ExecutiveSection>
          ) : null}
          {!focusMode && data.saleMode?.sale_mode_enabled ? (
            <section className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-5">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">{copy.existingSalePricesActive}</div>
              <div className="mt-2 text-lg font-black text-white">{data.saleMode.sale_mode_label || copy.savedSalePricesLive}</div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TodayCard label={copy.affectedProducts} value={number(data.saleModeAnalytics?.affectedProductsCount || 0)} pulse />
                <TodayCard label={copy.estimatedDiscountImpact} value={formatCurrency(data.saleModeAnalytics?.estimatedDiscountImpact || 0)} pulse />
              </div>
            </section>
          ) : null}
        </main>

        <RightSidebar
          lowStock={data.lowStock}
          recentInvoices={overview.recentInvoices || []}
          activity={data.liveActivity}
        />
      </div>
    </div>
  );
}

function ExecutiveCard({ label, value, detail, icon: Icon, tone = "slate", loading = false, textValue = false }) {
  const tones = {
    emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-400/24 bg-amber-500/10 text-amber-100",
    rose: "border-red-400/24 bg-red-500/10 text-red-100",
    slate: "border-slate-700/70 bg-slate-900/62 text-slate-100",
  };
  const iconTones = {
    emerald: "bg-emerald-400/12 text-emerald-200",
    amber: "bg-amber-400/12 text-amber-200",
    rose: "bg-red-400/12 text-red-200",
    slate: "bg-slate-700/55 text-slate-300",
  };
  return (
    <article className={`min-h-[168px] rounded-3xl border p-5 shadow-xl shadow-black/18 ${tones[tone] || tones.slate}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">{label}</div>
          <div className={`mt-4 font-black tracking-normal text-white ${textValue ? "line-clamp-2 text-xl leading-7" : "text-3xl md:text-4xl"}`}>
            {loading ? <SkeletonLine className="h-9 w-24" /> : value}
          </div>
        </div>
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${iconTones[tone] || iconTones.slate}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-5 text-sm font-semibold text-slate-400">{loading ? <SkeletonLine className="h-4 w-28" /> : detail}</div>
    </article>
  );
}

function ExecutiveSection({ sections, activeId, onSelect, children }) {
  return (
    <section className="rounded-3xl border border-slate-700/60 bg-slate-900/52 p-4 shadow-2xl shadow-black/20 md:p-5">
      <div className="mb-5 flex flex-wrap gap-2">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={`inline-flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-black transition ${
              activeId === id
                ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                : "border-slate-700 bg-slate-950/45 text-slate-400 hover:border-slate-500 hover:text-slate-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {children}
    </section>
  );
}

function StaffActivity({ posLive }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const activeCashiers = Number(posLive?.activeCashiers || 0);
  const openShifts = posLive?.openShifts || [];
  if (!activeCashiers && !openShifts.length) return null;
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MetricTile label={copy.activeCashiers} value={number(activeCashiers)} icon={Users} />
      <MetricTile label={copy.openShifts} value={number(openShifts.length)} icon={MonitorDot} />
      <MetricTile label={copy.currentCarts} value={number(posLive?.currentCartCounts)} icon={ShoppingCart} />
    </div>
  );
}

function StatusPill({ label, value, tone = "emerald", pulse = false }) {
  const tones = {
    emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
    amber: "border-amber-400/20 bg-amber-500/10 text-amber-100",
    rose: "border-red-400/20 bg-red-500/10 text-red-100",
    slate: "border-slate-700 bg-slate-900/70 text-slate-300",
  };
  return (
    <span className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 ${tones[tone] || tones.slate}`}>
      <LivePulse active={pulse} tone={tone} />
      {label}: <strong>{value}</strong>
    </span>
  );
}

function LivePulse({ active = true, tone = "emerald" }) {
  const tones = { emerald: "bg-emerald-300", amber: "bg-amber-300", rose: "bg-red-300", slate: "bg-slate-400" };
  return <span className={`dashboard-pulse h-2 w-2 shrink-0 rounded-full ${tones[tone] || tones.emerald} ${active ? "" : "opacity-40"}`} />;
}

function SessionTimer() {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
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

function QuickAction({ to, icon: Icon, label, primary = false }) {
  return (
    <Link
      to={to}
      className={`group inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-black uppercase tracking-[0.08em] shadow-sm shadow-black/10 transition duration-150 hover:-translate-y-0.5 sm:px-3 ${
        primary
          ? "border-emerald-300/25 bg-emerald-400/15 text-emerald-50 hover:border-emerald-300/40 hover:bg-emerald-400/20"
          : "border-white/[0.07] bg-white/[0.045] text-zinc-300 hover:border-white/15 hover:bg-white/[0.075] hover:text-white"
      }`}
    >
      <Icon className={`h-3.5 w-3.5 ${primary ? "text-emerald-200" : "text-zinc-500 transition group-hover:text-emerald-200"}`} />
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}

function GettingStarted() {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const items = [
    { to: "/products/add", label: copy.createFirstProduct, icon: Package },
    { to: "/pos", label: copy.makeFirstPosSale, icon: ShoppingCart },
    { to: "/suppliers", label: copy.addSupplier, icon: Users },
    { to: "/purchases/create", label: copy.createPurchaseInvoice, icon: ReceiptText },
  ];
  return (
    <section className="mt-4 rounded-2xl border border-emerald-300/15 bg-gradient-to-br from-emerald-400/10 via-white/[0.035] to-sky-400/5 p-4 shadow-2xl shadow-black/15">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">{copy.gettingStartedToday}</div>
          <p className="mt-1 text-sm text-zinc-400">{copy.noSalesForFilter}</p>
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
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.035] p-2 shadow-xl shadow-black/10 backdrop-blur-xl">
      <span className="inline-flex h-9 items-center gap-2 px-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">
        <LayoutGrid className="h-3.5 w-3.5" />
        {copy.widgets}
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
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
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
          {widget.size === "wide" ? copy.compact : copy.wide}
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
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const hasTrend = (salesTrend || []).some((row) => Number(row.revenue || 0) > 0 || Number(row.orders || 0) > 0);
  const hasHourly = (hourlySales || []).some((row) => Number(row.sales || 0) > 0 || Number(row.orders || 0) > 0);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={copy.revenueVsOrders}>
        {hasTrend ? <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={salesTrend} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#67e8f9" stopOpacity={0.32} /><stop offset="95%" stopColor="#67e8f9" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
            <XAxis dataKey="label" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
            <Tooltip content={<DashboardTooltip />} />
            <Area type="monotone" dataKey="revenue" stroke="#67e8f9" strokeWidth={2.5} fill="url(#salesGradient)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            <Area type="monotone" dataKey="orders" stroke="#94a3b8" strokeWidth={1.8} fill="transparent" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
          </AreaChart>
        </ResponsiveContainer> : <EmptyChart title={copy.noSalesInRange} message={copy.salesTrendAppears} />}
      </ChartCard>
      <ChartCard title={copy.hourlySales}>
        {hasHourly ? <ResponsiveContainer width="100%" height={220}>
          <BarChart data={hourlySales} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
            <XAxis dataKey="hourLabel" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
            <Tooltip content={<DashboardTooltip />} />
            <Bar dataKey="sales" fill="#67e8f9" opacity={0.72} radius={[8, 8, 3, 3]} />
          </BarChart>
        </ResponsiveContainer> : <EmptyChart title={copy.noHourlyActivity} message={copy.hourlySalesAppear} />}
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }) {
  return <div className="min-w-0 rounded-2xl border border-slate-700/55 bg-slate-950/35 p-4"><div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">{title}</div>{children}</div>;
}

function EmptyChart({ title, message }) {
  return (
    <div className="flex h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-950/30 px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/55 text-slate-300">
        <LineChartIcon className="h-6 w-6" />
      </div>
      <div className="mt-3 text-sm font-black text-white">{title}</div>
      <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">{message}</p>
    </div>
  );
}

// Kept only as a dashboard fallback during phased rollout of the premium feed.
// eslint-disable-next-line no-unused-vars
function LegacyDashboardActivityFeed({ rows }) {
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
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const low = inventory?.lowStock || [];
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <MiniList title={copy.lowStockProducts} rows={low} getLabel={(row) => row.name} getValue={(row) => `${row.stock}/${row.threshold}`} icon={AlertTriangle} />
      <MiniList title={copy.fastMovingProducts} rows={inventory?.fastMovingProducts || []} getLabel={(row) => row.name} getValue={(row) => `${row.quantity} ${copy.sold}`} icon={TrendingUp} />
      <MiniList title={copy.topSizesSold} rows={inventory?.topSizes || []} getLabel={(row) => row.size || copy.unknown} getValue={(row) => row.quantity} icon={Boxes} />
      <MiniList title={copy.topColorsSold} rows={inventory?.topColors || []} getLabel={(row) => row.color || copy.unknown} getValue={(row) => row.quantity} icon={Warehouse} />
    </div>
  );
}

function PosLiveMonitor({ posLive }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const rows = posLive?.paymentDistribution || [];
  return (
    <div className="grid gap-4 lg:grid-cols-[0.85fr_1fr]">
      <div className="space-y-3">
        <MetricTile label={copy.activeCashiers} value={number(posLive?.activeCashiers)} icon={Users} />
        <MetricTile label={copy.openShifts} value={number((posLive?.openShifts || []).length)} icon={MonitorDot} />
        <MetricTile label={copy.currentCartCounts} value={number(posLive?.currentCartCounts)} icon={ShoppingCart} />
        <MetricTile label={copy.averageCheckout} value={`${number(posLive?.averageCheckoutTimeSeconds)}s`} icon={LineChartIcon} />
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3 shadow-inner shadow-white/[0.02]">
        <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-zinc-500">{copy.paymentMethods}</div>
        {rows.length ? <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie data={rows} dataKey="amount" nameKey="method" innerRadius={54} outerRadius={86} paddingAngle={4}>
              {rows.map((_, index) => <Cell key={index} fill={paymentColors[index % paymentColors.length]} />)}
            </Pie>
            <Tooltip content={<DashboardTooltip />} />
          </PieChart>
        </ResponsiveContainer> : <PremiumEmpty icon={CreditCard} title={copy.noPaymentsYet} message={copy.paymentDistributionAppears} compact />}
        <div className="text-xs text-zinc-400">{copy.lastInvoice}: {posLive?.lastInvoice?.invoice_number || "-"}</div>
      </div>
    </div>
  );
}

function AiInsights({ insights }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  return (
    <div className="grid gap-3">
      {(insights || []).length ? insights.map((item, index) => (
        <div key={`${item.title}-${index}`} className="rounded-xl border border-emerald-300/12 bg-emerald-400/[0.06] p-3 shadow-lg shadow-emerald-950/10">
          <div className="flex items-center gap-2 text-sm font-black text-emerald-100"><Brain className="h-4 w-4" />{item.title}</div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{item.body}</p>
        </div>
      )) : <PremiumEmpty icon={Brain} title={copy.insightsAppear} message={copy.insightsNeedData} />}
    </div>
  );
}

function BranchPerformance({ rows }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const hasData = (rows || []).some((row) => Number(row.sales || 0) > 0 || Number(row.orders || 0) > 0);
  if (!hasData) return <EmptyChart title={copy.noBranchSalesYet} message={copy.branchComparisonAppears} />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
        <XAxis dataKey="branch" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
        <Tooltip content={<DashboardTooltip />} />
        <Bar dataKey="sales" fill="#67e8f9" opacity={0.72} radius={[8, 8, 3, 3]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MarketingAnalytics({ marketing }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const rows = (marketing?.channels || []).map((row) => ({ ...row, sales: Number(row.sales || 0), orders: Number(row.orders || 0) }));
  const hasData = rows.some((row) => row.sales > 0 || row.orders > 0);
  if (!hasData) return <EmptyChart title={copy.noMarketingAttribution} message={copy.marketingAnalyticsAppear} />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
          <XAxis dataKey="source" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} width={48} />
          <Tooltip content={<DashboardTooltip />} />
          <Bar dataKey="sales" fill="#67e8f9" opacity={0.72} radius={[8, 8, 3, 3]} />
        </BarChart>
      </ResponsiveContainer>
      <MetricTile label={copy.attributedSales} value={formatCurrency(marketing?.attributedSales || 0)} icon={Activity} />
    </div>
  );
}

function TopProducts({ rows }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  return <MiniList title={copy.bestSellingProducts} rows={rows} getLabel={(row) => row.name} getValue={(row) => `${row.quantity} · ${formatCurrency(row.revenue)}`} icon={Package} />;
}

function MiniList({ title, rows, getLabel, getValue, icon: Icon }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
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
        {!(rows || []).length ? <PremiumEmpty icon={Icon} title={copy.noRecordsYet} message={copy.widgetAutoFill} compact /> : null}
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

function RightSidebar({ lowStock, recentInvoices, activity }) {
  const { i18n } = useTranslation();
  const copy = getDashboardCopy(String(i18n.resolvedLanguage || i18n.language || "").startsWith("ar"));
  const notifications = (activity || []).slice(0, 5);
  return (
    <aside className="space-y-4 xl:sticky xl:top-28 xl:self-start">
      <SidePanel title={copy.notifications} icon={Bell}>
        {notifications.map((item, index) => <NotificationLine key={`${item.created_at}-${index}`} tone="slate" label={item.title || item.type || copy.systemUpdate} value={shortTime(item.created_at)} />)}
        {!notifications.length ? <NotificationLine tone="emerald" label={copy.systemLive} value={copy.noNewAlerts} pulse /> : null}
      </SidePanel>
      <SidePanel title={copy.lowStockAlerts} icon={AlertTriangle}>
        {(lowStock || []).slice(0, 6).map((item) => <NotificationLine key={`${item.id}-${item.sku}`} tone="amber" label={item.name} value={`${item.stock}/${item.threshold}`} />)}
        {!(lowStock || []).length ? <PremiumEmpty icon={AlertTriangle} title={copy.stockHealthy} message={copy.lowStockAppear} compact /> : null}
      </SidePanel>
      <SidePanel title={copy.recentInvoices} icon={ReceiptText}>
        {(recentInvoices || []).slice(0, 6).map((invoice) => <NotificationLine key={invoice.id} tone="emerald" label={invoice.invoice_number} value={formatCurrency(invoice.total)} />)}
        {!(recentInvoices || []).length ? <PremiumEmpty icon={ReceiptText} title={copy.noInvoicesYet} message={copy.recentInvoicesAppear} compact /> : null}
      </SidePanel>
    </aside>
  );
}

function SidePanel({ title, icon: Icon, children }) {
  return (
    <section className="rounded-3xl border border-slate-700/60 bg-slate-900/55 p-4 shadow-2xl shadow-black/18">
      <div className="mb-4 flex items-center gap-2 text-sm font-black text-white"><Icon className="h-4 w-4 text-cyan-200" />{title}</div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function NotificationLine({ label, value, tone = "emerald", pulse = false }) {
  const tones = { emerald: "bg-emerald-400", amber: "bg-amber-400", rose: "bg-red-400", slate: "bg-slate-500" };
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-950/42 px-3 py-2.5 text-xs transition hover:bg-slate-800/55">
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

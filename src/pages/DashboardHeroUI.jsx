/* ============================================================================
   DASHBOARD — HeroUI v3 rebuild (TRIAL)
   ----------------------------------------------------------------------------
   A side-by-side alternative to src/pages/Dashboard.jsx, NOT a replacement.
   The existing dashboard is untouched: if this one is rejected, delete this
   file plus its two routes and nothing else moves.

   Same data, different skin — on purpose. It calls the exact same
   /dashboard/* endpoints, reads the same field paths, and formats money with
   the same formatCurrency, so anything that looks different here is the UI
   choice and not a data difference.

   Charts stay on recharts. HeroUI ships no charting, and swapping the chart
   library at the same time would muddy the comparison.

   TWO MOUNTS, ONE COMPONENT:
     /dashboard-heroui       standalone, reachable on any host without login
     /erp .. dashboard-heroui inside MainLayout, next to the real sidebar
   The standalone mount is the one to open first; it renders instantly and
   falls back to sample figures when there is no session.

   THEME: HeroUI's palette is scoped to this page's container, so M1's own
   tokens on <html> are never overwritten. The theme is read once from M1 at
   mount, and the manual toggle remounts the subtree via `key` — flipping the
   class in place leaves already-painted elements on the old palette.
   ========================================================================== */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { I18nProvider } from "@react-aria/i18n";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  MonitorDot,
  Moon,
  Percent,
  ReceiptText,
  RefreshCw,
  ShoppingCart,
  Sun,
} from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Chip,
  Skeleton,
  Table,
  Tabs,
} from "@heroui/react";

import { api } from "../shared/api/api";
import { formatCurrency } from "../shared/lib/currency";

import "./heroui-lab.css";

/* ------------------------------------------------------------------ helpers */

/* Same locale string as src/pages/Dashboard.jsx: Arabic locale, Latin digits.
   The ERP shows 37, not ٣٧ — the trial has to match or the comparison is unfair. */
const DASH_LOCALE = "ar-EG-u-nu-latn";
const num = (v) => Number(v || 0).toLocaleString(DASH_LOCALE);
const pct = (v) => `${Number(v || 0) > 0 ? "+" : ""}${Number(v || 0).toFixed(1)}%`;

const shortTime = (value) => {
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString(DASH_LOCALE, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const PAYMENT_LABELS = {
  cash: "نقدي",
  card: "بطاقة",
  wallet: "محفظة",
  transfer: "تحويل",
  credit: "آجل",
  instapay: "إنستاباي",
};
const PAY_COLORS = ["#a47a12", "#3f8f5f", "#8a6bbf", "#c07a3e", "#4f7fa8"];

/* Sample figures used only when the API is unreachable (no session on this
   host). Clearly flagged in the UI so nobody mistakes them for real sales. */
const SAMPLE = {
  overview: {
    kpis: {
      todaySales: { value: 48250, growth: 12.4 },
      todayOrders: { value: 37, growth: -4.2 },
      averageOrderValue: { value: 1304 },
      unitsSold: { value: 92 },
      returnedUnits: { value: 3 },
      discountToday: { value: 1875 },
      activePosSessions: { value: 2 },
      lowStockProducts: { value: 6 },
      pendingPurchaseOrders: { value: 2 },
    },
    recentInvoices: [
      { id: 10482, invoice_number: "INV-10482", customer_name: "أحمد محمود", total: 1250, payment_status: "مدفوع", created_at: new Date().toISOString() },
      { id: 10483, invoice_number: "INV-10483", customer_name: "سارة عبد الله", total: 480.5, payment_status: "آجل", created_at: new Date().toISOString() },
      { id: 10484, invoice_number: "INV-10484", customer_name: "محمد إبراهيم", total: 2190, payment_status: "مدفوع", created_at: new Date().toISOString() },
      { id: 10485, invoice_number: "INV-10485", customer_name: "نورهان سيد", total: 75, payment_status: "مرتجع", created_at: new Date().toISOString() },
      { id: 10486, invoice_number: "INV-10486", customer_name: "كريم فؤاد", total: 3400, payment_status: "مدفوع", created_at: new Date().toISOString() },
    ],
  },
  hourlySales: [
    { hour: 10, sales: 2400 }, { hour: 11, sales: 3900 }, { hour: 12, sales: 5200 },
    { hour: 13, sales: 4100 }, { hour: 14, sales: 6800 }, { hour: 15, sales: 7300 },
    { hour: 16, sales: 5900 }, { hour: 17, sales: 8650 }, { hour: 18, sales: 4000 },
  ],
  paymentAnalytics: [
    { method: "cash", amount: 26400 }, { method: "card", amount: 13100 },
    { method: "wallet", amount: 5300 }, { method: "credit", amount: 3450 },
  ],
  topProducts: [
    { name: "حذاء رياضي أبيض 42", quantity: 14, revenue: 11200 },
    { name: "تيشيرت قطن أسود L", quantity: 11, revenue: 4400 },
    { name: "بنطلون جينز 32", quantity: 9, revenue: 6300 },
    { name: "شنطة ظهر جلد", quantity: 6, revenue: 5400 },
    { name: "جاكيت شتوي M", quantity: 4, revenue: 7200 },
  ],
  lowStock: [
    { name: "حذاء رياضي أبيض 43", stock: 2, threshold: 10 },
    { name: "تيشيرت قطن أبيض M", stock: 3, threshold: 12 },
    { name: "بنطلون جينز 34", stock: 1, threshold: 8 },
  ],
  inventory: { pendingTransfers: 3 },
};

const RANGES = [
  { id: "today", label: "اليوم" },
  { id: "week", label: "هذا الأسبوع" },
  { id: "month", label: "هذا الشهر" },
];

/* Read whichever theme M1 is currently in, so the trial page opens matching
   the rest of the app instead of always starting light. */
const readAppTheme = () => {
  if (typeof document === "undefined") return "light";
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  return root.dataset.theme === "dark" ? "dark" : "light";
};

/* --------------------------------------------------------------- components */

function KpiCard({ label, value, detail, icon: Icon, tone = "default", loading }) {
  return (
    <Card>
      <Card.Content className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-xs text-muted">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-7 w-24 rounded-lg" />
          ) : (
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          )}
          {detail ? (
            <Chip size="sm" variant={tone} className="mt-2">
              {detail}
            </Chip>
          ) : null}
        </div>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-2xl p-2"
          style={{ background: "var(--surface-secondary)", color: "var(--accent)" }}
        >
          <Icon size={18} />
        </span>
      </Card.Content>
    </Card>
  );
}

function PanelCard({ title, action, children }) {
  return (
    <Card>
      <Card.Header className="flex flex-row items-center justify-between gap-3">
        <Card.Title className="text-sm">{title}</Card.Title>
        {action}
      </Card.Header>
      <Card.Content className="pt-0">{children}</Card.Content>
    </Card>
  );
}

function HourlySalesChart({ rows }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">لا توجد مبيعات بعد</p>;
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="hourLabel" tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} reversed />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} axisLine={false} tickLine={false} width={52} orientation="right" />
          <RechartsTooltip
            cursor={{ fill: "var(--surface-hover)" }}
            contentStyle={{
              background: "var(--overlay)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--foreground)",
              fontSize: 12,
            }}
            formatter={(value) => [formatCurrency(value), "المبيعات"]}
          />
          <Bar dataKey="sales" radius={[8, 8, 0, 0]} fill="var(--accent)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PaymentMix({ rows }) {
  if (!rows.length) return <p className="py-8 text-center text-sm text-muted">لا توجد مدفوعات بعد</p>;
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <div className="flex items-center gap-4">
      <div className="h-[150px] w-[150px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="amount" nameKey="method" innerRadius={45} outerRadius={70} paddingAngle={3} stroke="none">
              {rows.map((row, i) => (
                <Cell key={row.method} fill={PAY_COLORS[i % PAY_COLORS.length]} />
              ))}
            </Pie>
            <RechartsTooltip
              contentStyle={{
                background: "var(--overlay)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                color: "var(--foreground)",
                fontSize: 12,
              }}
              formatter={(value, name) => [formatCurrency(value), PAYMENT_LABELS[name] || name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {rows.slice(0, 5).map((row, i) => (
          <li key={row.method} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: PAY_COLORS[i % PAY_COLORS.length] }} />
              <span className="truncate">{PAYMENT_LABELS[row.method] || row.method}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {total ? Math.round((row.amount / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------- page  */

function DashboardHeroUIBody({ theme, onToggleTheme }) {
  const [range, setRange] = useState("today");
  const [loading, setLoading] = useState(true);
  const [usingSample, setUsingSample] = useState(false);
  const [data, setData] = useState(SAMPLE);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = `?range=${range}`;
    try {
      const [overview, hourlySales, paymentAnalytics, topProducts, lowStock, inventory] = await Promise.all([
        api.get(`/dashboard/overview${qs}`),
        api.get(`/dashboard/hourly-sales${qs}`),
        api.get(`/dashboard/payment-analytics${qs}`),
        api.get(`/dashboard/top-products${qs}`),
        api.get("/dashboard/low-stock"),
        api.get("/dashboard/inventory"),
      ]);
      setData({
        overview: overview || {},
        hourlySales: Array.isArray(hourlySales) ? hourlySales : [],
        paymentAnalytics: Array.isArray(paymentAnalytics) ? paymentAnalytics : [],
        topProducts: Array.isArray(topProducts) ? topProducts : [],
        lowStock: Array.isArray(lowStock) ? lowStock : [],
        inventory: inventory || {},
      });
      setUsingSample(false);
    } catch {
      // No session on this host, or the API is unreachable. Show the sample
      // set rather than an empty shell — this page exists to be looked at.
      setData(SAMPLE);
      setUsingSample(true);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
  }, [load]);

  const k = data.overview?.kpis || {};
  const salesGrowth = Number(k.todaySales?.growth || 0);
  const ordersGrowth = Number(k.todayOrders?.growth || 0);

  const kpis = [
    { label: "صافي مبيعات اليوم", value: formatCurrency(k.todaySales?.value || 0), detail: `${pct(salesGrowth)} عن أمس`, icon: Banknote, tone: salesGrowth >= 0 ? "success" : "danger" },
    { label: "عدد فواتير اليوم", value: num(k.todayOrders?.value), detail: `${pct(ordersGrowth)} عن أمس`, icon: ReceiptText, tone: ordersGrowth >= 0 ? "success" : "danger" },
    { label: "متوسط قيمة الفاتورة", value: formatCurrency(k.averageOrderValue?.value || 0), detail: "لكل فاتورة", icon: ShoppingCart, tone: "default" },
    { label: "القطع المباعة اليوم", value: num(k.unitsSold?.value), detail: "إجمالي القطع", icon: Boxes, tone: "default" },
    { label: "المرتجعات اليوم", value: num(k.returnedUnits?.value), detail: "قطعة مرتجعة", icon: RefreshCw, tone: Number(k.returnedUnits?.value || 0) > 0 ? "danger" : "default" },
    { label: "الخصومات اليوم", value: formatCurrency(k.discountToday?.value || 0), detail: "إجمالي الخصم", icon: Percent, tone: Number(k.discountToday?.value || 0) > 0 ? "accent" : "default" },
    { label: "نقاط البيع النشطة", value: num(k.activePosSessions?.value), detail: "جلسة مفتوحة", icon: MonitorDot, tone: Number(k.activePosSessions?.value || 0) > 0 ? "success" : "default" },
  ];

  const hourly = useMemo(
    () => (data.hourlySales || [])
      .map((row) => ({ ...row, hourLabel: `${String(row.hour).padStart(2, "0")}:00`, sales: Number(row.sales || 0) }))
      .filter((row) => row.sales > 0),
    [data.hourlySales],
  );

  const payments = useMemo(
    () => (data.paymentAnalytics || [])
      .map((row) => ({ method: row.method || "unknown", amount: Number(row.amount || 0) }))
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount),
    [data.paymentAnalytics],
  );

  const invoices = (data.overview?.recentInvoices || []).slice(0, 5);
  const topProducts = (data.topProducts || []).slice(0, 5);

  const attention = [
    { n: Number(k.lowStockProducts?.value || 0), label: "مخزون منخفض", to: "/inventory" },
    { n: Number(k.pendingPurchaseOrders?.value || 0), label: "طلبات شراء معلقة", to: "/purchases" },
    { n: Number(data.inventory?.pendingTransfers || 0), label: "تحويلات مخزون معلقة", to: "/inventory/movements" },
  ].filter((item) => item.n > 0);

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {/* header */}
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">لوحة التحكم</h1>
            <p className="text-sm text-muted">
              نسخة HeroUI — نفس البيانات، شكل مختلف
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="tertiary" size="sm" onPress={onToggleTheme}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              {theme === "dark" ? "فاتح" : "داكن"}
            </Button>
            <Button variant="secondary" size="sm" onPress={load} isDisabled={loading}>
              <RefreshCw size={16} />
              تحديث
            </Button>
          </div>
        </header>

        {usingSample ? (
          <Alert className="mb-4">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>بيانات تجريبية</Alert.Title>
              <Alert.Description>
                مفيش جلسة مفتوحة على العنوان ده، فالأرقام دي عيّنة للعرض بس. افتح
                الصفحة من داخل الـ ERP وأنت مسجّل دخول عشان تشوف أرقامك الحقيقية.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {/* range */}
        <div className="mb-5">
          <Tabs selectedKey={range} onSelectionChange={(key) => setRange(String(key))}>
            <Tabs.List aria-label="الفترة الزمنية">
              {RANGES.map((r) => (
                <Tabs.Tab key={r.id} id={r.id}>
                  {r.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>
        </div>

        {/* KPIs */}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} loading={loading} />
          ))}
        </div>

        {/* charts */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PanelCard
              title="المبيعات بالساعة"
              action={<Chip size="sm" variant="soft">{hourly.length} ساعة</Chip>}
            >
              {loading ? <Skeleton className="h-[220px] w-full rounded-xl" /> : <HourlySalesChart rows={hourly} />}
            </PanelCard>
          </div>
          <PanelCard title="طرق الدفع اليوم">
            {loading ? <Skeleton className="h-[150px] w-full rounded-xl" /> : <PaymentMix rows={payments} />}
          </PanelCard>
        </div>

        {/* tables */}
        <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <PanelCard
            title="أحدث الفواتير"
            action={<Link to="/orders" className="text-xs font-medium" style={{ color: "var(--accent)" }}>عرض الكل</Link>}
          >
            {loading ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : invoices.length ? (
              <Table>
                <Table.Content aria-label="أحدث الفواتير">
                  <Table.Header>
                    <Table.Column isRowHeader>الفاتورة</Table.Column>
                    <Table.Column>العميل</Table.Column>
                    <Table.Column>الإجمالي</Table.Column>
                    <Table.Column>الحالة</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {invoices.map((inv) => (
                      <Table.Row key={inv.id} id={inv.id}>
                        <Table.Cell>
                          <span className="font-medium">{inv.invoice_number || `#${inv.id}`}</span>
                          <span className="block text-xs text-muted">{shortTime(inv.created_at)}</span>
                        </Table.Cell>
                        <Table.Cell>{inv.customer_name || "—"}</Table.Cell>
                        <Table.Cell className="tabular-nums">{formatCurrency(inv.total || 0)}</Table.Cell>
                        <Table.Cell>
                          <Chip size="sm" variant={inv.payment_status === "مدفوع" ? "success" : inv.payment_status === "مرتجع" ? "danger" : "soft"}>
                            {inv.payment_status || "—"}
                          </Chip>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table>
            ) : (
              <p className="py-8 text-center text-sm text-muted">لا توجد فواتير بعد</p>
            )}
          </PanelCard>

          <PanelCard
            title="الأكثر مبيعًا"
            action={<Link to="/reports" className="text-xs font-medium" style={{ color: "var(--accent)" }}>التقارير</Link>}
          >
            {loading ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : topProducts.length ? (
              <ul className="space-y-3">
                {topProducts.map((product, i) => {
                  const max = Math.max(1, ...topProducts.map((p) => Number(p.quantity || 0)));
                  const share = (Number(product.quantity || 0) / max) * 100;
                  return (
                    <li key={product.name || i}>
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                        <span className="truncate">{product.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">{num(product.quantity)} قطعة</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-secondary)" }}>
                        <div className="h-full rounded-full" style={{ width: `${share}%`, background: "var(--accent)" }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted">لا توجد مبيعات بعد</p>
            )}
          </PanelCard>
        </div>

        {/* attention */}
        {attention.length ? (
          <PanelCard title="يحتاج تدخلك">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              {attention.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 transition"
                  style={{ background: "var(--surface-secondary)", border: "1px solid var(--border)" }}
                >
                  <span className="text-xs font-medium">{item.label}</span>
                  <span className="text-lg font-bold tabular-nums">{num(item.n)}</span>
                </Link>
              ))}
            </div>
          </PanelCard>
        ) : null}

        {/* low stock */}
        {(data.lowStock || []).length ? (
          <div className="mt-3">
            <PanelCard
              title="مخزون منخفض"
              action={<AlertTriangle size={16} style={{ color: "var(--warning)" }} />}
            >
              <ul className="divide-y" style={{ borderColor: "var(--separator)" }}>
                {(data.lowStock || []).slice(0, 5).map((row, i) => (
                  <li key={row.name || i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="truncate">{row.name}</span>
                    <Chip size="sm" variant={Number(row.stock) <= 2 ? "danger" : "soft"}>
                      {num(row.stock)} / {num(row.threshold)}
                    </Chip>
                  </li>
                ))}
              </ul>
            </PanelCard>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function DashboardHeroUI() {
  const [theme, setTheme] = useState(readAppTheme);

  return (
    <I18nProvider locale="ar-EG">
      {/* `key` forces a remount on theme change. HeroUI expects its theme class
          on the root element; scoped to a container, flipping it in place
          updates the custom properties but leaves already-painted elements on
          the previous palette. Remounting sidesteps that entirely. */}
      <div dir="rtl" lang="ar" className={`heroui-brand ${theme}`} key={theme}>
        <DashboardHeroUIBody
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        />
      </div>
    </I18nProvider>
  );
}

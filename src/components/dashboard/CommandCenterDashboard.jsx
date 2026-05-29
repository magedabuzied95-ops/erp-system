import { memo } from "react";
import {
  Banknote,
  Bot,
  Eye,
  Maximize2,
  PackageSearch,
  ReceiptText,
  ShoppingCart,
  UserCheck,
  Users,
} from "lucide-react";

import useCommandCenter from "../../hooks/useCommandCenter";
import ActiveVisitorsCard from "./ActiveVisitorsCard";
import AIActivityCard from "./AIActivityCard";
import InventoryPulseCard from "./InventoryPulseCard";
import LiveSalesTicker from "./LiveSalesTicker";
import RealtimeAlertsCard from "./RealtimeAlertsCard";
import RealtimeBranchStatusCard from "./RealtimeBranchStatusCard";
import RealtimeKPICard from "./RealtimeKPICard";
import RevenuePulseCard from "./RevenuePulseCard";
import StaffActivityCard from "./StaffActivityCard";
import TodayTargetsCard from "./TodayTargetsCard";
import TopSellingNowCard from "./TopSellingNowCard";

export const CommandCenterDashboard = memo(function CommandCenterDashboard({
  data,
  overview,
  onlineUsers = 0,
  socketConnected = false,
  formatCurrency,
}) {
  const command = useCommandCenter({ dashboardData: data, overview, onlineUsers, socketConnected });
  const { metrics } = command;
  const dailyTarget = Number(overview?.targets?.todaySales || overview?.todayTarget || 0);

  const kpis = [
    { label: "Revenue Today", value: metrics.todaySales, displayValue: formatCurrency(metrics.todaySales), trend: overview?.kpis?.todaySales?.growth, icon: Banknote, tone: "emerald" },
    { label: "Orders Today", value: metrics.todayOrders, trend: overview?.kpis?.todayOrders?.growth, icon: ReceiptText, tone: "sky" },
    { label: "Customers Online", value: metrics.activeCustomers, icon: Users, tone: "violet" },
    { label: "AI Conversations", value: metrics.activeAiConversations, icon: Bot, tone: "sky" },
    { label: "Low Stock", value: metrics.lowStockProducts, icon: PackageSearch, tone: metrics.lowStockProducts ? "amber" : "emerald" },
    { label: "Checked-in Staff", value: metrics.checkedInStaff, icon: UserCheck, tone: "violet" },
    { label: "Abandoned Carts", value: metrics.abandonedCarts, icon: ShoppingCart, tone: metrics.abandonedCarts ? "rose" : "emerald" },
    { label: "Conversion Rate", value: metrics.conversionRate, displayValue: `${metrics.conversionRate.toFixed(1)}%`, icon: Eye, tone: "emerald" },
    { label: "Avg Order Value", value: metrics.averageOrderValue, displayValue: formatCurrency(metrics.averageOrderValue), icon: Banknote, tone: "amber" },
  ];

  return (
    <section className="relative z-10 mt-4 space-y-3">
      <div className="overflow-hidden rounded-2xl border border-emerald-300/12 bg-[linear-gradient(135deg,rgba(16,185,129,0.12),rgba(255,255,255,0.045)_42%,rgba(9,9,11,0.72))] p-4 shadow-2xl shadow-black/25 backdrop-blur-2xl">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300">Command Center</div>
            <h2 className="mt-1 text-2xl font-black text-white">Live operations cockpit</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
              Realtime sales, storefront, AI, inventory, staff, branch, and alert awareness in one monitor-ready control surface.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1.5 text-xs font-black ${command.socketConnected ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
              {command.socketConnected ? "Realtime connected" : "Realtime reconnecting"}
            </span>
            <button
              type="button"
              onClick={command.toggleFullscreen}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.055] px-3 text-xs font-black text-zinc-100 transition hover:bg-white/[0.09]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {command.fullscreen ? "Exit TV Mode" : "TV Mode"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {kpis.map((kpi) => <RealtimeKPICard key={kpi.label} {...kpi} />)}
      </div>

      <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.75fr)]">
        <LiveSalesTicker sales={command.sales} formatCurrency={formatCurrency} />
        <RevenuePulseCard metrics={metrics} salesTrend={data?.hourlySales || data?.salesTrend || []} branchPerformance={command.branchPerformance} formatCurrency={formatCurrency} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <ActiveVisitorsCard metrics={metrics} />
        <AIActivityCard metrics={metrics} events={command.events} insights={command.aiInsights} />
        <InventoryPulseCard lowStock={command.lowStock} inventory={command.inventory} />
        <StaffActivityCard metrics={metrics} posLive={command.posLive} events={command.events} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
        <TopSellingNowCard products={command.topProducts} inventory={command.inventory} formatCurrency={formatCurrency} />
        <RealtimeBranchStatusCard branches={command.branchPerformance} />
        <TodayTargetsCard metrics={metrics} target={dailyTarget} formatCurrency={formatCurrency} />
        <RealtimeAlertsCard alerts={command.alerts} />
      </div>
    </section>
  );
});

export default CommandCenterDashboard;

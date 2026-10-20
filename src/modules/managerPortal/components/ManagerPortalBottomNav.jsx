import { ClipboardCheck, ClipboardList, Settings, ShoppingCart, Store, Truck, Users } from "lucide-react";

import i18n from "../../../i18n/i18n";
import useVisualViewportBottomShift from "../../../shared/hooks/useVisualViewportBottomShift";

const tt = (key, options) => i18n.t(key, options);

export const MANAGER_PORTAL_BOTTOM_TABS = ["today", "staff", "tasks", "sales", "shipping", "inventory", "more"];

const defaultFormatCount = (value) => new Intl.NumberFormat("ar-EG").format(Number(value || 0));

const TAB_META = {
  today: { labelKey: "managerPortal.common.today", icon: Store },
  staff: { labelKey: "managerPortal.nav.team", icon: Users },
  tasks: { labelKey: "managerPortal.nav.tasks", icon: ClipboardList },
  sales: { labelKey: "managerPortal.sections.sales", icon: ShoppingCart },
  shipping: { labelKey: "orders.portalBoard.navLabel", icon: Truck },
  inventory: { labelKey: "managerPortal.nav.stockCount", icon: ClipboardCheck },
  more: { labelKey: "managerPortal.nav.more", icon: Settings },
};

/**
 * The manager portal's bottom bar. One component for the portal itself and the
 * stock-count page it opens, so the bar never disappears halfway through a visit.
 * The parent must sit inside `.manager-portal-shell` for the M1 colours to apply.
 */
export default function ManagerPortalBottomNav({ activeTab = "", onSelect, unreadCount = 0, pendingInventoryCount = 0, formatCount = defaultFormatCount }) {
  // iPhone can strand this bar mid-screen while scrolling up (most often after the
  // keyboard closed); the shift pins it back to the bottom the person sees.
  const bottomShift = useVisualViewportBottomShift();
  return (
    <nav style={bottomShift ? { transform: `translate3d(0, ${bottomShift}px, 0)` } : undefined} className="manager-bottom-nav-safe-padding manager-bottom-nav-shell fixed inset-x-3 z-40 mx-auto max-w-2xl rounded-[1.4rem] border border-slate-800 bg-[linear-gradient(180deg,#020617,#0f172a)] shadow-2xl shadow-slate-900/30 lg:hidden">
      <div className="grid grid-cols-7 gap-0.5 px-1.5 py-1.5">
        {MANAGER_PORTAL_BOTTOM_TABS.map((tab) => {
          const active = activeTab === tab;
          const { labelKey, icon: Icon } = TAB_META[tab];
          return (
            <button key={tab} type="button" data-testid={`tab-${tab}`} onClick={() => onSelect?.(tab)} className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] px-1 py-1.5 text-[9px] font-black leading-[1.2] transition ${active ? "bg-[linear-gradient(180deg,#ffffff,#e2e8f0)] text-slate-950 shadow-sm" : "text-slate-300"}`}>
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="inline-flex max-w-full items-center gap-1 whitespace-nowrap">
                {tt(labelKey)}
              </span>
              {/* Inline, the unread count added 22px to a 47px cell and pushed
                  "المزيد" out of its own button. It rides the corner like the
                  stock-count badge instead, so the label sets the width. */}
              {tab === "more" && unreadCount > 0 ? <span className="absolute -top-1 right-0 min-w-4 rounded-full bg-rose-500 px-1 text-[8px] font-black leading-4 text-white">{formatCount(unreadCount)}</span> : null}
              {tab === "inventory" && pendingInventoryCount > 0 ? <span className="absolute -top-1 right-0 min-w-4 rounded-full bg-rose-500 px-1 text-[8px] font-black leading-4 text-white">{formatCount(pendingInventoryCount)}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, Workflow, Activity, ShieldCheck, Wrench, PackageCheck } from "lucide-react";

/* `to` is the ROUTE and stays raw; only labelKey is presentation. */
const TABS = [
  { to: "/ai-studio", labelKey: "aiStudio.nav.overview", icon: LayoutDashboard, end: true },
  { to: "/ai-studio/workflows", labelKey: "aiStudio.nav.workflows", icon: Workflow },
  { to: "/ai-studio/executions", labelKey: "aiStudio.nav.executions", icon: Activity },
  { to: "/ai-studio/approvals", labelKey: "aiStudio.nav.approvals", icon: ShieldCheck },
  { to: "/ai-studio/restock-recovery", labelKey: "aiStudio.nav.restockRecovery", icon: PackageCheck },
  { to: "/ai-studio/tools", labelKey: "aiStudio.nav.tools", icon: Wrench },
];

export default function AiStudioNav() {
  const { t } = useTranslation();
  return (
    <nav dir="ltr" className="flex flex-wrap gap-1.5">
      {TABS.map(({ to, labelKey, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px] font-black transition ${
              isActive
                ? "border-primary/40 bg-primary text-[var(--primary-contrast)]"
                : "border-white/10 bg-white/[0.055] text-white hover:border-white/20"
            }`
          }
        >
          <Icon className="h-4 w-4" />
          {t(labelKey)}
        </NavLink>
      ))}
    </nav>
  );
}

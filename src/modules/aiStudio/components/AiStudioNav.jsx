import { NavLink } from "react-router-dom";
import { LayoutDashboard, Workflow, Activity, ShieldCheck, Wrench, PackageCheck } from "lucide-react";

const TABS = [
  { to: "/ai-studio", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/ai-studio/workflows", label: "Workflows", icon: Workflow },
  { to: "/ai-studio/executions", label: "Executions", icon: Activity },
  { to: "/ai-studio/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/ai-studio/restock-recovery", label: "Restock Recovery", icon: PackageCheck },
  { to: "/ai-studio/tools", label: "Tools", icon: Wrench },
];

export default function AiStudioNav() {
  return (
    <nav dir="ltr" className="flex flex-wrap gap-1.5">
      {TABS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px] font-black transition ${
              isActive
                ? "border-cyan-300/40 bg-cyan-300 text-slate-950"
                : "border-white/10 bg-white/[0.055] text-white hover:border-white/20"
            }`
          }
        >
          <Icon className="h-4 w-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

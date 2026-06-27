import { BarChart3, CalendarDays, LayoutTemplate, MessageCircleMore, Settings2, Send } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { ResponsiveTabs } from "../../../shared/components/mobile/ResponsiveMobile";

const tabs = [
  { to: "/marketing/social-media-publisher", label: "الناشر", icon: Send, end: true },
  { to: "/marketing/social-calendar", label: "التقويم", icon: CalendarDays },
  { to: "/marketing/analytics", label: "التحليلات", icon: BarChart3 },
  { to: "/marketing/templates", label: "القوالب", icon: LayoutTemplate },
  { to: "/marketing/settings", label: "Meta", icon: Settings2 },
];

const tabClassName = ({ isActive }) =>
  [
    "inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold transition duration-200 sm:h-9 sm:px-4 sm:text-sm",
    isActive
      ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.12)]"
      : "border-white/10 bg-white/[0.04] text-slate-300 hover:-translate-y-0.5 hover:bg-white/[0.07] hover:text-white",
  ].join(" ");

export default function MarketingStudioHeader({
  eyebrow = "Marketing Studio",
  title = "Marketing Suite",
  description = "Navigate the marketing workspace from one shared header.",
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-3 shadow-2xl shadow-black/25 sm:px-5 sm:py-4">
      <div className="flex flex-col gap-2">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
            <MessageCircleMore className="h-3.5 w-3.5" />
            {t("marketing.studio.eyebrow", eyebrow)}
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-[2rem] xl:text-[2.35rem]">
            {t("marketing.studio.title", title)}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-300">{t("marketing.studio.description", description)}</p>
        </div>
      </div>

      <ResponsiveTabs className="mobile-scroll-tabs mt-2 sm:mt-3">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={Boolean(end)} className={tabClassName}>
            <Icon className="h-4 w-4 shrink-0" />
            {t(`marketing.studio.tabs.${label}`, label)}
          </NavLink>
        ))}
      </ResponsiveTabs>
    </section>
  );
}

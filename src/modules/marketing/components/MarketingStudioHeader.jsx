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
      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
      : "border-white/10 bg-white/[0.04] text-slate-300 hover:-translate-y-0.5 hover:bg-white/[0.07] hover:text-white",
  ].join(" ");

export default function MarketingStudioHeader({
  eyebrow = "Marketing Studio",
  title = "Marketing Suite",
  description = "Navigate the marketing workspace from one shared header.",
  size = "default",
}) {
  const { t } = useTranslation();

  return (
    <section className={`${size === "large" ? "rounded-[2rem] px-6 py-5 sm:px-7 sm:py-6" : "rounded-3xl px-4 py-3 sm:px-5 sm:py-4"} border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]`}>
      <div className="flex flex-col gap-2">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[var(--primary-soft)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--primary)]">
            <MessageCircleMore className="h-3.5 w-3.5" />
            {t("marketing.studio.eyebrow", eyebrow)}
          </div>
          <h1 className={`${size === "large" ? "mt-3 text-3xl sm:text-4xl xl:text-[2.75rem]" : "mt-2 text-2xl sm:text-[2rem] xl:text-[2.35rem]"} font-black tracking-tight text-white`}>
            {t("marketing.studio.title", title)}
          </h1>
          <p className={`${size === "large" ? "mt-2 max-w-3xl text-base leading-7" : "mt-1.5 max-w-2xl text-sm leading-6"} text-slate-300`}>{t("marketing.studio.description", description)}</p>
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

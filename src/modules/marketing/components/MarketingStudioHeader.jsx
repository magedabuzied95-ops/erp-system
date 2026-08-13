import { BarChart3, CalendarDays, LayoutTemplate, MessageCircleMore, Settings2, Send } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { ResponsiveTabs } from "../../../shared/components/mobile/ResponsiveMobile";
import i18n from "../../../i18n/i18n";

/** Module scope: resolve through i18n at CALL time, never eagerly at import. */
const tt = (key, options) => i18n.t(key, options);

const tabs = [
  { to: "/marketing/social-media-publisher", get label() { return tt("marketing.studioHeader.tabs.publisher"); }, icon: Send, end: true },
  { to: "/marketing/social-calendar", get label() { return tt("marketing.studioHeader.tabs.calendar"); }, icon: CalendarDays },
  { to: "/marketing/analytics", get label() { return tt("marketing.studioHeader.tabs.analytics"); }, icon: BarChart3 },
  { to: "/marketing/templates", get label() { return tt("marketing.studioHeader.tabs.templates"); }, icon: LayoutTemplate },
  { to: "/marketing/settings", label: "Meta", icon: Settings2 },
];

const tabClassName = ({ isActive }) =>
  [
    "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition duration-200",
    isActive
      ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
      : "border-white/10 bg-white/[0.04] text-slate-300 hover:-translate-y-0.5 hover:bg-white/[0.07] hover:text-white",
  ].join(" ");

export default function MarketingStudioHeader({
  eyebrow = "",
  title = "",
  description = "",
  size = "default",
}) {
  const { t } = useTranslation();

  return (
    <section className={`${size === "large" ? "rounded-[2rem] px-6 py-5 sm:px-7 sm:py-6" : "rounded-[var(--radius-card)] px-5 py-4 sm:px-6 sm:py-5"} border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-card)]`}>
      <div className="flex flex-col gap-2">
        <div className="max-w-3xl">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-[var(--primary-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--primary)]">
            <MessageCircleMore className="h-3.5 w-3.5" />
            {t("marketing.studio.eyebrow", eyebrow)}
          </div>
          <h1 className={`m1-page-title ${size === "large" ? "mt-3" : "mt-2"} text-[var(--text)]`}>
            {t("marketing.studio.title", title)}
          </h1>
          <p className={`${size === "large" ? "mt-2 max-w-3xl text-base leading-7" : "mt-2 max-w-2xl text-base leading-7"} text-slate-300`}>{t("marketing.studio.description", description)}</p>
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

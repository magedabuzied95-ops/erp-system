import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Activity, CalendarClock, Film, Grid3x3, HardDrive, History,
  LayoutDashboard, Network, ScrollText, Server, Video,
} from "lucide-react";

/**
 * In-page navigation for the Surveillance Center.
 *
 * WHY THE SIDEBAR HAS ONE ENTRY AND THIS HAS ELEVEN
 * -------------------------------------------------
 * Eleven flat sidebar rows for one feature pushed every other module off the
 * screen and made the ERP look like a surveillance product with an ERP
 * attached. The sidebar answers "which part of the business am I in"; this
 * answers "where inside it" — and the second question only exists once you are
 * already here.
 *
 * Same pattern as AiStudioNav, deliberately: a second navigation idiom for the
 * same job would be a third thing to learn.
 *
 * `to` is the ROUTE and stays raw. Only labelKey is presentation, so a
 * translation can never move a user to the wrong page.
 */
const TABS = [
  { to: "/surveillance", labelKey: "surveillance.nav.dashboard", icon: LayoutDashboard, end: true },
  { to: "/surveillance/live", labelKey: "surveillance.nav.live", icon: Video },
  { to: "/surveillance/playback", labelKey: "surveillance.nav.playback", icon: History },
  { to: "/surveillance/devices", labelKey: "surveillance.nav.devices", icon: Server },
  { to: "/surveillance/channels", labelKey: "surveillance.nav.channels", icon: Grid3x3 },
  { to: "/surveillance/storage", labelKey: "surveillance.nav.storage", icon: HardDrive },
  { to: "/surveillance/video-settings", labelKey: "surveillance.nav.video", icon: Film },
  { to: "/surveillance/recording-settings", labelKey: "surveillance.nav.recording", icon: CalendarClock },
  { to: "/surveillance/motion-settings", labelKey: "surveillance.nav.motion", icon: Activity },
  { to: "/surveillance/network", labelKey: "surveillance.nav.network", icon: Network },
  { to: "/surveillance/audit", labelKey: "surveillance.nav.audit", icon: ScrollText },
];

export default function SurveillanceNav() {
  const { t } = useTranslation();
  return (
    // dir="ltr" so the tab order stays stable in Arabic. These are ELEVEN
    // sibling destinations, not prose: mirroring them under RTL moves every
    // target the moment the operator switches language, and muscle memory is
    // most of why a tab bar beats a menu.
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

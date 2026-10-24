import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { hasPermission, isMetaReviewerUser } from "../../shared/auth/authStorage";
import "./adPlatformTabs.css";

// One bar over the three ad modules so they read as one page. Each platform
// keeps its own route and its own inner navigation; a tab shows only when the
// user may open that module. The Meta app reviewer is held to /meta-ads.
const PLATFORMS = [
  { key: "meta", to: "/meta-ads", label: "Meta", permission: "meta_ads.view" },
  { key: "google", to: "/google-ads", label: "Google", permission: "google_ads.view" },
  { key: "tiktok", to: "/tiktok-ads", label: "TikTok", permission: "tiktok_ads.view" },
];

export default function AdPlatformTabs() {
  const { i18n } = useTranslation();
  const reviewer = isMetaReviewerUser();
  const visible = PLATFORMS.filter((p) => hasPermission(p.permission) && (!reviewer || p.key === "meta"));
  if (visible.length < 2) return null;
  return (
    <nav className="ad-platform-tabs" aria-label={i18n.language.startsWith("ar") ? "منصات الإعلانات" : "Ad platforms"}>
      {visible.map((p) => (
        <NavLink key={p.key} to={p.to} className={({ isActive }) => `ad-platform-tabs__tab${isActive ? " is-active" : ""}`}>
          {p.label}
        </NavLink>
      ))}
    </nav>
  );
}

// Route wrapper: the bar above whichever module the route renders.
export function AdPlatformFrame({ children }) {
  return (
    <div className="ad-platform-frame">
      <AdPlatformTabs />
      {children}
    </div>
  );
}

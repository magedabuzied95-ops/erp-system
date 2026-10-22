import { Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { LoadingState } from "../../shared/ui";
import "./tiktokAds.css";

// /tiktok-ads/* — the TikTok Ads module: the ads list and the account connection.
const AdsPage = lazy(() => import("./AdsPage"));
const ConnectPage = lazy(() => import("./ConnectPage"));

export default function TikTokAdsModule() {
  const { t } = useTranslation();
  return (
    <div className="tiktok-ads-shell">
      <nav className="tiktok-ads-sections" aria-label={t("tiktokAds.title")}>
        <NavLink end to="/tiktok-ads" className={({ isActive }) => `tiktok-ads-sections__link${isActive ? " is-active" : ""}`}>
          {t("tiktokAds.nav.ads")}
        </NavLink>
        <NavLink to="/tiktok-ads/connect" className={({ isActive }) => `tiktok-ads-sections__link${isActive ? " is-active" : ""}`}>
          {t("tiktokAds.nav.connect")}
        </NavLink>
      </nav>
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<AdsPage />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route path="*" element={<Navigate to="/tiktok-ads" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

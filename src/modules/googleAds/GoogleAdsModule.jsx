import { Suspense, lazy } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { LoadingState } from "../../shared/ui";
import { GoogleAdsProvider, RequireAccount, useGoogleAds } from "./GoogleAdsContext";
import "../tiktokAds/tiktokAds.css";
import "./googleAds.css";

// /google-ads/* — the Google Ads module, laid out like TikTok Ads: section tabs on
// top, one route per section, the connection on its own page.
const ResultsPage = lazy(() => import("./ResultsPage"));
const ManagePage = lazy(() => import("./ManagePage"));
const CreatePage = lazy(() => import("./CreatePage"));
const TrackingPage = lazy(() => import("./TrackingPage"));
const ConnectPage = lazy(() => import("./ConnectPage"));

const linkClass = ({ isActive }) => `tiktok-ads-sections__link${isActive ? " is-active" : ""}`;

function Sections() {
  const { label, manage } = useGoogleAds();
  return (
    <nav className="tiktok-ads-sections" aria-label={label("أقسام إعلانات جوجل", "Google Ads sections")}>
      <NavLink end to="/google-ads" className={linkClass}>{label("الحملات والنتائج", "Campaigns and results")}</NavLink>
      <NavLink to="/google-ads/manage" className={linkClass}>{label("إدارة الحملات", "Manage campaigns")}</NavLink>
      {manage ? <NavLink to="/google-ads/create" className={linkClass}>{label("إنشاء حملة", "Create campaign")}</NavLink> : null}
      <NavLink to="/google-ads/tracking" className={linkClass}>{label("تتبع المشتريات", "Purchase tracking")}</NavLink>
      <NavLink to="/google-ads/connect" className={linkClass}>{label("الحساب", "Account")}</NavLink>
    </nav>
  );
}

export default function GoogleAdsModule() {
  return (
    <GoogleAdsProvider>
      <div className="tiktok-ads-shell">
        <Sections />
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route index element={<RequireAccount><ResultsPage /></RequireAccount>} />
            <Route path="manage" element={<RequireAccount><ManagePage /></RequireAccount>} />
            <Route path="create" element={<RequireAccount><CreatePage /></RequireAccount>} />
            <Route path="tracking" element={<RequireAccount><TrackingPage /></RequireAccount>} />
            <Route path="connect" element={<ConnectPage />} />
            <Route path="*" element={<Navigate to="/google-ads" replace />} />
          </Routes>
        </Suspense>
      </div>
    </GoogleAdsProvider>
  );
}

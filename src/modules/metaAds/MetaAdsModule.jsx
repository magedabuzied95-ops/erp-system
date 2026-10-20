import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { LoadingState } from "../../shared/ui";
import MetaAdsSectionBar from "./shared/MetaAdsSectionBar";

// /meta-ads/* — the whole Meta Ads module. Each area is its own chunk.
const AdsManagerPage = lazy(() => import("./manager/AdsManagerPage"));
const ConnectPage = lazy(() => import("./connect/ConnectPage"));
const RecordListPage = lazy(() => import("./records/RecordListPage"));
const RecordFormPage = lazy(() => import("./records/RecordFormPage"));

export default function MetaAdsModule() {
  return (
    <div className="meta-ads-shell">
      <MetaAdsSectionBar />
      <Suspense fallback={<LoadingState />}>
        <Routes>
          <Route index element={<AdsManagerPage />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route path="r/:resource" element={<RecordListPage />} />
          <Route path="r/:resource/:id" element={<RecordFormPage />} />
          <Route path="*" element={<Navigate to="/meta-ads" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

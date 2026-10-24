import { Navigate } from "react-router-dom";

import { PageHeader } from "../../shared/ui";
import CampaignBuilder from "./CampaignBuilder";
import { AccountPicker, useGoogleAds } from "./GoogleAdsContext";

// /google-ads/create — new campaign; managers only.
export default function CreatePage() {
  const { label, manage, accountId } = useGoogleAds();
  if (!manage) return <Navigate to="/google-ads" replace />;
  return (
    <div className="tiktok-ads-page google-ads-page">
      <PageHeader
        title={label("إنشاء حملة", "Create campaign")}
        description={label("حملة بحث أو منتجات متجر. جوجل بيفحص الإعدادات الأول والحملة بتتعمل موقوفة.", "A Search or retail campaign. Google checks the settings first and the campaign is created paused.")}
      />
      <div className="tiktok-ads-toolbar">
        <AccountPicker />
      </div>
      <CampaignBuilder key={accountId} />
    </div>
  );
}

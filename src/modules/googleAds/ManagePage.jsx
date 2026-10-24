import { PageHeader } from "../../shared/ui";
import CampaignManager from "./CampaignManager";
import { AccountPicker, useGoogleAds } from "./GoogleAdsContext";

// /google-ads/manage — settings and content of one campaign at a time.
export default function ManagePage() {
  const { label, accountId } = useGoogleAds();
  return (
    <div className="tiktok-ads-page google-ads-page">
      <PageHeader
        title={label("إدارة الحملات", "Manage campaigns")}
        description={label("الاستهداف والمزايدة والمجموعات والكلمات والإعلانات لكل حملة.", "Targeting, bidding, groups, keywords and ads of each campaign.")}
      />
      <div className="tiktok-ads-toolbar">
        <AccountPicker />
      </div>
      <CampaignManager key={accountId} />
    </div>
  );
}

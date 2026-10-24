import { ShieldCheck } from "lucide-react";

import { Button, Card, LoadingState, PageHeader, StatusBadge } from "../../shared/ui";
import { AccountPicker, useGoogleAds } from "./GoogleAdsContext";

// /google-ads/tracking — the purchase conversion the storefront reports to Google.
export default function TrackingPage() {
  const { label, manage, tracking, setTracking, busy, request } = useGoogleAds();
  const loading = tracking === undefined;

  return (
    <div className="tiktok-ads-page google-ads-page">
      <PageHeader
        title={label("تتبع مشتريات المتجر", "Store purchase tracking")}
        description={label("طلبات الموقع الجديدة بتتسجل عند جوجل كتحويلات عشان المزايدة تتعلم منها.", "New website orders are reported to Google as conversions so bidding can learn from them.")}
        actions={manage && !loading ? (
          <Button variant="primary" icon={ShieldCheck} loading={busy} onClick={() => request("/tracking/setup", {}, (data) => setTracking(data?.tracking || null))}>
            {tracking ? label("مراجعة إعداد التتبع", "Review tracking setup") : label("تجهيز تتبع المشتريات", "Set up purchase tracking")}
          </Button>
        ) : null}
      />

      <div className="tiktok-ads-toolbar">
        <AccountPicker />
      </div>

      {loading ? <LoadingState /> : (
        <Card
          title={label("حالة التتبع", "Tracking status")}
          action={tracking
            ? <StatusBadge tone="success">{label("مجهز", "Configured")}</StatusBadge>
            : <StatusBadge tone="warning">{label("مش مجهز", "Not configured")}</StatusBadge>}
        >
          {tracking ? (
            <dl className="tiktok-ads-facts">
              <div><dt>{label("رقم إجراء التحويل", "Conversion action")}</dt><dd>{tracking.action_id}</dd></div>
            </dl>
          ) : null}
          <ul className="google-ads-notes">
            <li>{label("بيتسجل الطلب بقيمته بالجنيه ورقم طلب يمنع التكرار، ومن غير أسماء أو أرقام أو عناوين العملاء.", "Each order is sent with its EGP value and a transaction ID for deduplication — no customer names, phones or addresses.")}</li>
            <li>{label("المقياس هو تسجيل الطلب على الموقع؛ طلبات الدفع عند الاستلام مش معناها إن الفلوس اتحصّلت.", "It measures order placement; a cash-on-delivery order does not mean payment was collected.")}</li>
            <li>{label("التحويلات بتظهر بعد أول طلب جديد ييجي من زيارة إعلان. تجهيز التتبع مش بيشغّل حملات ولا بيصرف.", "Conversions appear after the first new order from an ad visit. Setting up tracking starts no campaign and no spend.")}</li>
          </ul>
        </Card>
      )}
    </div>
  );
}

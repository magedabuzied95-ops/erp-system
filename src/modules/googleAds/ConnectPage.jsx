import { useState } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";

import { Button, Card, EmptyState, LoadingState, PageHeader, StatusBadge } from "../../shared/ui";
import { useGoogleAds } from "./GoogleAdsContext";
import { errorMessage, googleAdsApi } from "./googleAdsApi";

const formatDate = (value, lang) => (value ? new Date(value).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" }) : "—");

// /google-ads/connect — authorize Google Ads (OAuth) and list the ad accounts it reaches.
export default function ConnectPage() {
  const { label, lang, manage, setup, accounts, accountsError, busy, action, confirm, reload } = useGoogleAds();
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  if (setup.loading) return <LoadingState />;
  if (setup.error) {
    return <EmptyState title={label("إعلانات جوجل مش جاهزة", "Google Ads is not available")} description={errorMessage(setup.error)} />;
  }

  const data = setup.data || {};
  const ready = Boolean(data.setup?.ready);

  const connect = async () => {
    setConnecting(true);
    const ok = await action(async () => {
      const result = await googleAdsApi.startOAuth();
      if (result?.url) window.location.assign(result.url);
    }, false);
    if (!ok) setConnecting(false);
  };

  const refresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const disconnect = () => confirm({
    title: label("فصل حساب جوجل", "Disconnect Google Ads"),
    body: label("السيستم مش هيقدر يقرا أو يعدّل الحملات لحد ما تربط تاني. الحملات نفسها مش هتتأثر.", "The system loses access until you reconnect. Campaigns themselves are not affected."),
    confirmLabel: label("فصل الربط", "Disconnect"),
    danger: true,
    onConfirm: async () => {
      if (await action(() => googleAdsApi.disconnect(), false)) await reload();
    },
  });

  return (
    <div className="tiktok-ads-page google-ads-page">
      <PageHeader
        title={label("حساب إعلانات جوجل", "Google Ads account")}
        description={label("اربط Google Ads عشان الحملات والصرف والتحويلات تظهر جوه السيستم.", "Connect Google Ads so campaigns, spend and conversions show up in the system.")}
        actions={manage ? (
          <Button variant="primary" icon={Link2} loading={connecting} disabled={!ready} onClick={connect}>
            {data.connected ? label("تجديد الربط", "Reconnect") : label("ربط حساب جوجل", "Connect Google")}
          </Button>
        ) : null}
      />

      {!ready ? (
        <div className="tiktok-ads-notice tiktok-ads-notice--danger" role="alert">
          {label("إعداد الربط لسه ما اكتملش على السيرفر. لازم تطبيق جوجل يتجهز قبل ربط الحساب.", "Server setup is incomplete. Configure the Google application before connecting an account.")}
        </div>
      ) : null}

      {!data.connected ? (
        <Card>
          <EmptyState
            title={label("مفيش حساب مربوط", "No account connected")}
            description={label("جوجل هيطلب منك تسجل دخول وتوافق إن السيستم يدير الإعلانات.", "Google will ask you to sign in and allow the system to manage ads.")}
          />
        </Card>
      ) : (
        <Card
          title="Google Ads"
          subtitle={`${label("اتربط في", "Connected")}: ${formatDate(data.connectedAt, lang)}`}
          action={<StatusBadge tone="success">{label("مربوط", "Connected")}</StatusBadge>}
        >
          {accountsError ? <div className="tiktok-ads-notice tiktok-ads-notice--danger">{errorMessage(accountsError)}</div> : null}
          {!accounts.length && !accountsError ? <p className="google-ads-muted">{label("الحساب ده مالوش حسابات إعلانية.", "This login reaches no ad accounts.")}</p> : null}
          <div className="google-ads-accounts">
            {accounts.map((item) => (
              <dl key={item.id} className="tiktok-ads-facts google-ads-account">
                <div><dt>{label("الحساب", "Account")}</dt><dd>{item.descriptiveName || "—"}</dd></div>
                <div><dt>{label("رقم الحساب", "Customer ID")}</dt><dd>{item.id}</dd></div>
                <div><dt>{label("العملة", "Currency")}</dt><dd>{item.currencyCode || "—"}</dd></div>
                <div><dt>{label("المنطقة الزمنية", "Time zone")}</dt><dd>{item.timeZone || "—"}</dd></div>
                <div><dt>{label("النوع", "Type")}</dt><dd>{item.manager ? label("حساب مدير (MCC)", "Manager (MCC)") : label("حساب إعلانات", "Ad account")}</dd></div>
              </dl>
            ))}
          </div>
          <div className="tiktok-ads-actions">
            <Button icon={RefreshCw} loading={refreshing} onClick={refresh}>{label("تحديث الحسابات", "Refresh accounts")}</Button>
            {manage ? <Button variant="danger" icon={Unplug} disabled={busy} onClick={disconnect}>{label("فصل الربط", "Disconnect")}</Button> : null}
          </div>
        </Card>
      )}
    </div>
  );
}

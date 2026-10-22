import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Link2, RefreshCw, Unplug } from "lucide-react";

import { Button, Card, EmptyState, LoadingState, Modal, PageHeader, StatusBadge } from "../../shared/ui";
import { hasPermission } from "../../shared/auth/authStorage";
import { errorCode, errorMessage, formatMoney, tiktokAdsApi } from "./tiktokAdsApi";

const formatDate = (value, language) => (value ? new Date(value).toLocaleString(language === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" }) : "—");

// /tiktok-ads/connect — connect the TikTok advertiser account (Marketing API OAuth) and
// show what TikTok shared: the account, its balance and the permissions it granted.
export default function ConnectPage() {
  const { t, i18n } = useTranslation();
  const canManage = hasPermission("tiktok_ads.manage");
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ loading: true, setup: null, accounts: [], error: null });
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await tiktokAdsApi.setup();
      setState({ loading: false, setup: data?.setup || null, accounts: data?.accounts || [], error: null });
    } catch (error) {
      setState({ loading: false, setup: null, accounts: [], error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Coming back from TikTok: ?tiktok_ads=connected | error&reason=…
  useEffect(() => {
    const outcome = params.get("tiktok_ads");
    if (!outcome) return;
    if (outcome === "connected") toast.success(t("tiktokAds.connect.connected"));
    else toast.error(t("tiktokAds.connect.failed", { reason: params.get("reason") || "" }));
    const next = new URLSearchParams(params);
    next.delete("tiktok_ads");
    next.delete("reason");
    setParams(next, { replace: true });
  }, [params, setParams, t]);

  const connect = async () => {
    setConnecting(true);
    try {
      const data = await tiktokAdsApi.startOAuth();
      if (data?.auth_url) window.location.assign(data.auth_url);
    } catch (error) {
      toast.error(errorMessage(error) || t("tiktokAds.errors.generic"));
      setConnecting(false);
    }
  };

  const sync = async (account) => {
    setBusy(`sync-${account.id}`);
    try {
      await tiktokAdsApi.sync(account.id, 30);
      toast.success(t("tiktokAds.connect.synced"));
      await load();
    } catch (error) {
      toast.error(errorMessage(error) || t("tiktokAds.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    const account = confirm;
    setBusy(`disconnect-${account.id}`);
    try {
      await tiktokAdsApi.disconnect(account.id);
      toast.success(t("tiktokAds.connect.disconnected"));
      setConfirm(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error) || t("tiktokAds.errors.generic"));
    } finally {
      setBusy(null);
    }
  };

  if (state.loading) return <LoadingState />;
  if (state.error) {
    const denied = state.error?.status === 403 && !errorCode(state.error).startsWith("TIKTOK_ADS_");
    return <EmptyState title={denied ? t("tiktokAds.errors.denied") : t("tiktokAds.errors.notReady")} description={errorMessage(state.error)} />;
  }

  const setupReady = Boolean(state.setup?.ready);

  return (
    <div className="tiktok-ads-page">
      <PageHeader
        title={t("tiktokAds.connect.title")}
        description={t("tiktokAds.connect.subtitle")}
        actions={canManage ? (
          <Button variant="primary" icon={Link2} loading={connecting} disabled={!setupReady} onClick={connect}>
            {state.accounts.length ? t("tiktokAds.connect.reconnect") : t("tiktokAds.connect.button")}
          </Button>
        ) : null}
      />

      {!setupReady ? (
        <div className="tiktok-ads-notice tiktok-ads-notice--danger" role="alert">
          {t("tiktokAds.connect.notConfigured", { problems: (state.setup?.problems || []).join(", ") })}
        </div>
      ) : null}

      {!state.accounts.length ? (
        <Card>
          <EmptyState title={t("tiktokAds.connect.emptyTitle")} description={t("tiktokAds.connect.emptyHint")} />
        </Card>
      ) : null}

      {state.accounts.map((account) => {
        const caps = account.capabilities || {};
        const waiting = !caps.ads_management || !caps.reporting || account.structure_state === "missing_permission" || account.report_state === "missing_permission";
        return (
          <Card
            key={account.id}
            title={account.name || account.advertiser_id}
            subtitle={`${t("tiktokAds.connect.advertiserId")}: ${account.advertiser_id}`}
            action={account.has_token
              ? <StatusBadge tone="success">{t("tiktokAds.connect.statusConnected")}</StatusBadge>
              : <StatusBadge tone="danger">{t("tiktokAds.connect.statusDisconnected")}</StatusBadge>}
          >
            <dl className="tiktok-ads-facts">
              <div><dt>{t("tiktokAds.connect.balance")}</dt><dd>{formatMoney(account.balance, account.currency, i18n.language)}</dd></div>
              <div><dt>{t("tiktokAds.connect.currency")}</dt><dd>{account.currency}</dd></div>
              <div><dt>{t("tiktokAds.connect.timezone")}</dt><dd>{account.timezone || "—"}</dd></div>
              <div><dt>{t("tiktokAds.connect.accountStatus")}</dt><dd>{account.status || "—"}</dd></div>
              <div><dt>{t("tiktokAds.connect.connectedAt")}</dt><dd>{formatDate(account.connected_at, i18n.language)}</dd></div>
              <div><dt>{t("tiktokAds.connect.lastSync")}</dt><dd>{formatDate(account.last_synced_at, i18n.language)}</dd></div>
            </dl>

            <div className="tiktok-ads-scopes">
              <span className="tiktok-ads-scopes__label">{t("tiktokAds.connect.permissions")}</span>
              {(caps.granted || []).length
                ? caps.granted.map((label) => <StatusBadge key={label} tone="info">{label}</StatusBadge>)
                : <span>{t("tiktokAds.connect.permissionsUnknown")}</span>}
            </div>

            {waiting ? (
              <div className="tiktok-ads-notice tiktok-ads-notice--warning">{t("tiktokAds.waitingPermission")}</div>
            ) : null}
            {account.last_sync_error && !waiting ? (
              <div className="tiktok-ads-notice tiktok-ads-notice--danger">{account.last_sync_error}</div>
            ) : null}

            {canManage && account.has_token ? (
              <div className="tiktok-ads-actions">
                <Button icon={RefreshCw} loading={busy === `sync-${account.id}`} onClick={() => sync(account)}>{t("tiktokAds.connect.syncNow")}</Button>
                <Button variant="danger" icon={Unplug} onClick={() => setConfirm(account)}>{t("tiktokAds.connect.disconnect")}</Button>
              </div>
            ) : null}
          </Card>
        );
      })}

      <Modal
        open={Boolean(confirm)}
        title={t("tiktokAds.connect.disconnectTitle")}
        description={t("tiktokAds.connect.disconnectBody", { name: confirm?.name || "" })}
        onClose={() => setConfirm(null)}
        footer={(
          <>
            <Button onClick={() => setConfirm(null)}>{t("tiktokAds.cancel")}</Button>
            <Button variant="danger" loading={Boolean(busy?.startsWith("disconnect"))} onClick={disconnect}>{t("tiktokAds.connect.disconnect")}</Button>
          </>
        )}
      />
    </div>
  );
}

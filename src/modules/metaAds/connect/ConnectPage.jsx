import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Check, CheckCircle2, ExternalLink, Home, Lock, Megaphone, Plug, RefreshCw, TriangleAlert, Unplug, X } from "lucide-react";

import { Button, Checkbox, EmptyState, LoadingState, Modal, Select, StatusBadge } from "../../../shared/ui";
import { metaAdsRequest, metaErrorMessage } from "../shared/metaAdsApi";
import { formatDateTime, localeFor } from "../shared/metaAdsFormat";
import { recordPath } from "../shared/metaAdsNav";
import "./connect.css";

// /meta-ads/connect — "ربط الحساب". The card is the screen Meta's reviewers start
// from (kept in English like the reference); below it, the connected accounts.
// Facebook comes back to /meta-ads/connect?state=… (pick accounts) or ?error=….

const TOKEN_TONE = { valid: "success", invalid: "danger", missing: "neutral" };

const errorText = (error, fallback) => metaErrorMessage(error) || fallback;

function Notice({ tone = "info", children, onClose, closeLabel }) {
  const Icon = tone === "danger" ? TriangleAlert : CheckCircle2;
  return (
    <div className={`mac-notice mac-notice--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <span>{children}</span>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label={closeLabel}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function OnboardingCard({ host, busy, disabled, onContinue }) {
  const { t } = useTranslation();
  const checks = ["check1", "check2", "check3", "check4"];
  return (
    // English copy on purpose (as the reference shows it), so the card reads left-to-right.
    <section className="mac-onboard" dir="ltr" aria-labelledby="mac-title">
      <div className="mac-logo">
        <img src="/icons/m1-192.png" alt="" />
      </div>
      <div className="mac-chips">
        <div className="mac-chip">
          <span className="mac-chip__icon mac-chip__icon--meta"><Megaphone size={14} aria-hidden="true" /></span>
          <span className="mac-chip__text">
            <span className="mac-chip__label">{t("metaAdsConnect.card.channel")}</span>
            <span className="mac-chip__value">{t("metaAdsConnect.card.channelName")}</span>
          </span>
        </div>
        <span className="mac-dots" aria-hidden="true"><i /><i /><i /><i /></span>
        <div className="mac-chip mac-chip--end">
          <span className="mac-chip__text">
            <span className="mac-chip__label">{t("metaAdsConnect.card.connectingTo")}</span>
            <span className="mac-chip__value" title={host}>{host}</span>
          </span>
          <span className="mac-chip__icon mac-chip__icon--home"><Home size={13} aria-hidden="true" /></span>
        </div>
      </div>
      <div className="mac-card">
        <h1 id="mac-title">{t("metaAdsConnect.card.title")}</h1>
        <p className="mac-card__subtitle">{t("metaAdsConnect.card.subtitle")}</p>
        <ul className="mac-checks">
          {checks.map((key) => (
            <li key={key}>
              <Check size={15} strokeWidth={2.5} aria-hidden="true" />
              {t(`metaAdsConnect.card.${key}`)}
            </li>
          ))}
        </ul>
        <button type="button" className="mac-fb-button" onClick={onContinue} disabled={busy || disabled} aria-busy={busy || undefined}>
          {busy ? <RefreshCw className="m1-spin" size={16} aria-hidden="true" /> : null}
          {t("metaAdsConnect.card.button")}
        </button>
        <p className="mac-card__hint">{t("metaAdsConnect.card.hint")}</p>
      </div>
      <div className="mac-secured">
        <Lock size={12} aria-hidden="true" />
        {t("metaAdsConnect.card.secured", { app: t("metaAdsConnect.card.appName") })}
      </div>
    </section>
  );
}

function AccountPicker({ state, onClose, onDone }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState({ ad_accounts: [], pages: [], meta_user: null });
  const [choice, setChoice] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    metaAdsRequest
      .get("/integrations/oauth/pending", { state })
      .then((result) => {
        if (!alive) return;
        const next = { ad_accounts: result.ad_accounts || [], pages: result.pages || [], meta_user: result.meta_user || null };
        setData(next);
        const defaultPage = next.pages[0]?.id || "";
        const initial = {};
        for (const account of next.ad_accounts) {
          initial[account.id] = { on: next.ad_accounts.length === 1 || account.connected === true, page: defaultPage };
        }
        setChoice(initial);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.status === 410 ? t("metaAdsConnect.picker.expired") : errorText(err, t("metaAdsConnect.picker.loadFailed")));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [state, t]);

  const selected = Object.entries(choice).filter(([, value]) => value.on);
  const pageById = useMemo(() => new Map(data.pages.map((page) => [page.id, page])), [data.pages]);

  const update = (id, patch) => setChoice((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await metaAdsRequest.post("/integrations/oauth/complete", {
        state,
        accounts: selected.map(([id, value]) => ({ ad_account_id: id, page_id: value.page || null })),
      });
      onDone(result.accounts || []);
    } catch (err) {
      setError(err?.status === 410 ? t("metaAdsConnect.picker.expired") : errorText(err, t("metaAdsConnect.picker.completeFailed")));
      setSaving(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose} disabled={saving}>{t("metaAdsConnect.picker.cancel")}</Button>
      <Button variant="primary" icon={Plug} onClick={submit} loading={saving} disabled={loading || !selected.length}>
        {t("metaAdsConnect.picker.connect")}
        {selected.length ? ` (${selected.length})` : ""}
      </Button>
    </>
  );

  return (
    <Modal open title={t("metaAdsConnect.picker.title")} description={t("metaAdsConnect.picker.description")} onClose={saving ? undefined : onClose} footer={footer} size="lg">
      {loading ? <LoadingState label={t("metaAdsConnect.picker.loading")} /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!loading && !error && !data.ad_accounts.length ? <EmptyState title={t("metaAdsConnect.picker.noAccounts")} /> : null}
      {!loading && data.ad_accounts.length ? (
        <div className="mac-picker">
          {data.meta_user?.name ? <div className="mac-picker__user">{t("metaAdsConnect.picker.metaUser", { name: data.meta_user.name })}</div> : null}
          {data.ad_accounts.map((account) => {
            const value = choice[account.id] || { on: false, page: "" };
            const page = pageById.get(value.page);
            return (
              <div key={account.id} className={`mac-picker__row${value.on ? " mac-picker__row--on" : ""}`}>
                <div className="mac-picker__head">
                  <Checkbox
                    aria-label={account.name || account.id}
                    checked={value.on}
                    onChange={(event) => update(account.id, { on: event.target.checked })}
                  />
                  <div className="mac-picker__meta">
                    <strong>{account.name || account.id}</strong>
                    <span className="mac-ltr">{account.id}{account.currency ? ` · ${account.currency}` : ""}</span>
                    {account.business_name ? <span>{t("metaAdsConnect.picker.business", { name: account.business_name })}</span> : null}
                    {account.connected ? <span><StatusBadge tone="info">{t("metaAdsConnect.picker.alreadyConnected")}</StatusBadge></span> : null}
                  </div>
                </div>
                {value.on ? (
                  <div className="mac-picker__page">
                    <Select label={t("metaAdsConnect.picker.page")} value={value.page} onChange={(event) => update(account.id, { page: event.target.value })}>
                      <option value="">{t("metaAdsConnect.picker.noPage")}</option>
                      {data.pages.map((item) => (
                        <option key={item.id} value={item.id}>{item.name || item.id}</option>
                      ))}
                    </Select>
                    {page ? (
                      <div className="mac-picker__ig">
                        {page.instagram_username
                          ? t("metaAdsConnect.picker.instagram", { username: `@${page.instagram_username}` })
                          : t("metaAdsConnect.picker.noInstagram")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="mac-picker__user">{t("metaAdsConnect.picker.selected", { count: selected.length })}</div>
        </div>
      ) : null}
    </Modal>
  );
}

function AccountRow({ account, busy, onReconnect, onDisconnect }) {
  const { t, i18n } = useTranslation();
  const locale = localeFor(i18n.language);
  const tokenStatus = account.token_status || (account.has_token ? "valid" : "missing");
  return (
    <div className="mac-account">
      <div className="mac-account__cell">
        <Link className="mac-account__name" to={recordPath("ad-accounts", account.id)}>{account.name || account.ad_account_id}</Link>
        <span className="mac-account__muted mac-ltr">{account.ad_account_id}</span>
        <span className="mac-account__muted">
          {t("metaAdsConnect.accounts.currency")}: <span className="mac-ltr">{account.currency || "—"}</span>
        </span>
      </div>
      <div className="mac-account__cell">
        <span className="mac-account__label">{t("metaAdsConnect.accounts.page")}</span>
        <span>{account.page_name || account.page_id || t("metaAdsConnect.accounts.noPage")}</span>
        {account.instagram_username ? <span className="mac-account__muted mac-ltr">@{account.instagram_username}</span> : null}
      </div>
      <div className="mac-account__cell">
        <span className="mac-account__label">{t("metaAdsConnect.accounts.token")}</span>
        <span><StatusBadge tone={TOKEN_TONE[tokenStatus] || "neutral"}>{t(`metaAdsConnect.accounts.tokenStatus.${tokenStatus}`)}</StatusBadge></span>
        {account.has_token && account.token_expires_at ? (
          <span className="mac-account__muted">{t("metaAdsConnect.accounts.expires", { date: formatDateTime(account.token_expires_at, locale) })}</span>
        ) : null}
        <span className="mac-account__muted">
          {t("metaAdsConnect.accounts.lastSync")}: {account.last_synced_at ? formatDateTime(account.last_synced_at, locale) : t("metaAdsConnect.accounts.never")}
        </span>
        {account.last_sync_error ? (
          <span className="mac-account__error">{t("metaAdsConnect.accounts.lastError", { message: String(account.last_sync_error).slice(0, 160) })}</span>
        ) : null}
      </div>
      <div className="mac-account__actions">
        <Button size="sm" variant="secondary" icon={RefreshCw} onClick={onReconnect} disabled={busy}>{t("metaAdsConnect.accounts.reconnect")}</Button>
        {account.has_token ? (
          <Button size="sm" variant="secondary" icon={Unplug} onClick={() => onDisconnect(account)} disabled={busy}>{t("metaAdsConnect.accounts.disconnect")}</Button>
        ) : null}
        <Link to={recordPath("ad-accounts", account.id)} className="m1-button m1-button--ghost m1-button--sm">
          <ExternalLink size={15} aria-hidden="true" />
          <span>{t("metaAdsConnect.accounts.open")}</span>
        </Link>
      </div>
    </div>
  );
}

export default function ConnectPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const pendingState = params.get("state") || "";
  const callbackError = params.get("error") || "";

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [setup, setSetup] = useState(null);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const host = typeof window !== "undefined" ? window.location.host : "";

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const result = await metaAdsRequest.get("/integrations/accounts");
      setAccounts(result.accounts || []);
    } catch (error) {
      setLoadError(errorText(error, t("metaAdsConnect.accounts.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    metaAdsRequest
      .get("/integrations/status")
      .then((result) => setSetup(result.setup || null))
      .catch(() => setSetup(null));
  }, [load]);

  const clearQuery = useCallback(() => setParams({}, { replace: true }), [setParams]);

  const startConnect = async () => {
    setStarting(true);
    setNotice(null);
    try {
      const result = await metaAdsRequest.get("/integrations/oauth/start");
      if (!result?.auth_url) throw new Error(t("metaAdsConnect.page.startFailed"));
      window.location.assign(result.auth_url);
    } catch (error) {
      setNotice({ tone: "danger", text: errorText(error, t("metaAdsConnect.page.startFailed")) });
      setStarting(false);
    }
  };

  const onConnected = (connected) => {
    clearQuery();
    setNotice({ tone: "success", text: t("metaAdsConnect.page.connected", { count: connected.length }) });
    void load();
  };

  const disconnect = async () => {
    if (!confirming) return;
    setDisconnecting(true);
    try {
      await metaAdsRequest.post(`/integrations/accounts/${confirming.id}/disconnect`);
      setNotice({ tone: "success", text: t("metaAdsConnect.page.disconnected") });
      setConfirming(null);
      await load();
    } catch (error) {
      setNotice({ tone: "danger", text: errorText(error, t("metaAdsConnect.disconnect.failed")) });
      setConfirming(null);
    } finally {
      setDisconnecting(false);
    }
  };

  const notConfigured = setup?.app_configured === false;

  return (
    <div className="mac-page">
      {callbackError ? (
        <Notice tone="danger" onClose={clearQuery} closeLabel={t("metaAdsConnect.page.dismiss")}>
          {t("metaAdsConnect.page.callbackError", { message: callbackError })}
        </Notice>
      ) : null}
      {notConfigured ? <Notice tone="danger">{t("metaAdsConnect.page.notConfigured")}</Notice> : null}
      {notice ? (
        <Notice tone={notice.tone} onClose={() => setNotice(null)} closeLabel={t("metaAdsConnect.page.dismiss")}>
          {notice.text}
        </Notice>
      ) : null}

      <OnboardingCard host={host} busy={starting} disabled={notConfigured} onContinue={startConnect} />

      <section className="mac-accounts" aria-labelledby="mac-accounts-title">
        <div className="mac-accounts__header">
          <h2 id="mac-accounts-title">{t("metaAdsConnect.accounts.title")}</h2>
          <p>{t("metaAdsConnect.accounts.subtitle")}</p>
        </div>
        {loading ? <LoadingState /> : null}
        {!loading && loadError ? <Notice tone="danger">{loadError}</Notice> : null}
        {!loading && !loadError && !accounts.length ? <EmptyState title={t("metaAdsConnect.accounts.empty")} /> : null}
        {!loading && accounts.length ? (
          <div className="mac-account-list">
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                busy={starting || disconnecting}
                onReconnect={startConnect}
                onDisconnect={setConfirming}
              />
            ))}
          </div>
        ) : null}
      </section>

      {pendingState ? <AccountPicker state={pendingState} onClose={clearQuery} onDone={onConnected} /> : null}

      <Modal
        open={Boolean(confirming)}
        title={t("metaAdsConnect.disconnect.title")}
        onClose={disconnecting ? undefined : () => setConfirming(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirming(null)} disabled={disconnecting}>{t("metaAdsConnect.picker.cancel")}</Button>
            <Button variant="danger" icon={Unplug} onClick={disconnect} loading={disconnecting}>{t("metaAdsConnect.disconnect.confirm")}</Button>
          </>
        )}
      >
        <p>{t("metaAdsConnect.disconnect.body", { name: confirming?.name || confirming?.ad_account_id || "" })}</p>
      </Modal>
    </div>
  );
}

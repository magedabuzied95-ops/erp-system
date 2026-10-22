import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { RefreshCw, X } from "lucide-react";

import {
  Button,
  EmptyState,
  LoadingState,
  PageHeader,
  SearchInput,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFoot,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
} from "../../shared/ui";
import ThemedSelect from "../../shared/ui/ThemedSelect";
import { hasPermission } from "../../shared/auth/authStorage";
import {
  errorCode,
  errorMessage,
  formatMoney,
  formatNumber,
  readSelectedAccountId,
  tiktokAdsApi,
  writeSelectedAccountId,
} from "./tiktokAdsApi";

const LEVELS = ["campaign", "adgroup", "ad"];
const DATE_PRESETS = ["1", "7", "14", "30", "90", "all"];

const useDebounced = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

// Delivery as TikTok reports it: review verdicts first, then on/off.
export const deliveryOf = (row = {}) => {
  const secondary = String(row.secondary_status || "");
  if (/AUDIT_DENY|ALL_REJECTED/.test(secondary)) return { key: "rejected", tone: "danger" };
  if (/_AUDIT$|_REAUDIT$/.test(secondary)) return { key: "inReview", tone: "warning" };
  if (row.operation_status === "ENABLE") return { key: "active", tone: "success" };
  if (row.operation_status === "DISABLE") return { key: "paused", tone: "neutral" };
  return { key: "unknown", tone: "neutral" };
};

// /tiktok-ads — campaigns / ad groups / ads with their numbers for a date window.
export default function AdsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const canManage = hasPermission("tiktok_ads.manage");

  const [boot, setBoot] = useState({ loading: true, accounts: [], error: null });
  const [accountId, setAccountId] = useState(() => readSelectedAccountId());
  const [level, setLevel] = useState("campaign");
  const [days, setDays] = useState("30");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [drill, setDrill] = useState({ campaign: null, adgroup: null });
  const [list, setList] = useState({ loading: false, rows: [], totals: null, counts: null, error: null });
  const [syncing, setSyncing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadBoot = useCallback(async () => {
    try {
      const data = await tiktokAdsApi.bootstrap();
      setBoot({ loading: false, accounts: data?.accounts || [], error: null });
    } catch (error) {
      setBoot({ loading: false, accounts: [], error });
    }
  }, []);

  useEffect(() => {
    void loadBoot();
  }, [loadBoot]);

  const accounts = boot.accounts;
  const account = accounts.find((item) => String(item.id) === String(accountId)) || accounts[0] || null;

  useEffect(() => {
    if (account && String(account.id) !== String(accountId)) {
      setAccountId(String(account.id));
      writeSelectedAccountId(account.id);
    }
  }, [account, accountId]);

  const params = useMemo(() => {
    if (!account) return null;
    const value = { account_id: account.id, level, days, q };
    if (level !== "campaign" && drill.campaign) value.campaign_id = drill.campaign.object_id;
    if (level === "ad" && drill.adgroup) value.adgroup_id = drill.adgroup.object_id;
    return value;
  }, [account, level, days, q, drill]);

  useEffect(() => {
    if (!params) return undefined;
    let cancelled = false;
    setList((current) => ({ ...current, loading: true, error: null }));
    tiktokAdsApi.data(params)
      .then((data) => {
        if (!cancelled) setList({ loading: false, rows: data?.rows || [], totals: data?.totals || null, counts: data?.counts || null, error: null });
      })
      .catch((error) => {
        if (!cancelled) setList({ loading: false, rows: [], totals: null, counts: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, [params, reloadKey]);

  const syncNow = async () => {
    if (!account) return;
    setSyncing(true);
    try {
      await tiktokAdsApi.sync(account.id, Number(days) || 30);
      toast.success(t("tiktokAds.connect.synced"));
      await loadBoot();
      setReloadKey((key) => key + 1);
    } catch (error) {
      toast.error(errorMessage(error) || t("tiktokAds.errors.generic"));
    } finally {
      setSyncing(false);
    }
  };

  const openChildren = (row) => {
    if (level === "campaign") {
      setDrill({ campaign: row, adgroup: null });
      setLevel("adgroup");
    } else if (level === "adgroup") {
      setDrill((current) => ({ ...current, adgroup: row }));
      setLevel("ad");
    }
  };

  if (boot.loading) return <LoadingState />;
  if (boot.error) {
    const denied = boot.error?.status === 403 && !errorCode(boot.error).startsWith("TIKTOK_ADS_");
    return <EmptyState title={denied ? t("tiktokAds.errors.denied") : t("tiktokAds.errors.notReady")} description={errorMessage(boot.error)} />;
  }
  if (!account) {
    return (
      <EmptyState
        title={t("tiktokAds.ads.noAccountTitle")}
        description={t("tiktokAds.ads.noAccountHint")}
        action={<Link className="m1-button m1-button--primary m1-button--md" to="/tiktok-ads/connect">{t("tiktokAds.connect.button")}</Link>}
      />
    );
  }

  const caps = account.capabilities || {};
  const waiting = !caps.ads_management || !caps.reporting || account.structure_state === "missing_permission" || account.report_state === "missing_permission";
  const money = (value) => formatMoney(value, account.currency, lang);
  const count = (value, digits = 0) => formatNumber(value, lang, digits);
  const counts = list.counts || {};
  const levelItems = LEVELS.map((key) => ({ value: key, label: `${t(`tiktokAds.levels.${key}`)}${counts[key] !== undefined ? ` (${count(counts[key])})` : ""}` }));

  const showBudget = level !== "ad";
  const metricCells = (row) => (
    <>
      <TableCell numeric>{money(row.spend)}</TableCell>
      <TableCell numeric>{count(row.impressions)}</TableCell>
      <TableCell numeric>{count(row.clicks)}</TableCell>
      <TableCell numeric>{row.ctr === null ? "—" : `${count(row.ctr, 2)}%`}</TableCell>
      <TableCell numeric>{row.cpc === null ? "—" : money(row.cpc)}</TableCell>
      <TableCell numeric>{count(row.conversions)}</TableCell>
      <TableCell numeric>{count(row.purchases)}</TableCell>
      <TableCell numeric>{money(row.purchase_value)}</TableCell>
      <TableCell numeric>{row.roas === null ? "—" : count(row.roas, 2)}</TableCell>
      <TableCell numeric>{row.cost_per_purchase === null ? "—" : money(row.cost_per_purchase)}</TableCell>
    </>
  );

  return (
    <div className="tiktok-ads-page">
      <PageHeader
        title={t("tiktokAds.title")}
        description={account.last_synced_at
          ? t("tiktokAds.ads.lastSync", { when: new Date(account.last_synced_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" }) })
          : t("tiktokAds.ads.neverSynced")}
        actions={canManage ? <Button icon={RefreshCw} loading={syncing} onClick={syncNow}>{t("tiktokAds.connect.syncNow")}</Button> : null}
      />

      {waiting ? <div className="tiktok-ads-notice tiktok-ads-notice--warning">{t("tiktokAds.waitingPermission")}</div> : null}

      <div className="tiktok-ads-toolbar">
        {accounts.length > 1 ? (
          <ThemedSelect
            value={String(account.id)}
            onChange={(next) => {
              setAccountId(next);
              writeSelectedAccountId(next);
              setDrill({ campaign: null, adgroup: null });
            }}
            options={accounts.map((item) => ({ value: String(item.id), label: item.name || item.advertiser_id }))}
            ariaLabel={t("tiktokAds.ads.account")}
          />
        ) : (
          <span className="tiktok-ads-toolbar__account">{account.name || account.advertiser_id}</span>
        )}
        <div className="tiktok-ads-presets" role="group" aria-label={t("tiktokAds.ads.window")}>
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`tiktok-ads-presets__item${days === preset ? " is-active" : ""}`}
              aria-pressed={days === preset}
              onClick={() => setDays(preset)}
            >
              {t(`tiktokAds.ads.presets.${preset}`)}
            </button>
          ))}
        </div>
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("tiktokAds.ads.search")} />
      </div>

      <Tabs value={level} onChange={setLevel} items={levelItems} ariaLabel={t("tiktokAds.ads.levelsLabel")} />

      {drill.campaign || drill.adgroup ? (
        <div className="tiktok-ads-drill">
          {drill.campaign ? (
            <button type="button" className="tiktok-ads-drill__chip" onClick={() => setDrill({ campaign: null, adgroup: null })}>
              {t("tiktokAds.levels.campaign")}: {drill.campaign.name} <X size={14} aria-hidden="true" />
            </button>
          ) : null}
          {drill.adgroup ? (
            <button type="button" className="tiktok-ads-drill__chip" onClick={() => setDrill((current) => ({ ...current, adgroup: null }))}>
              {t("tiktokAds.levels.adgroup")}: {drill.adgroup.name} <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {list.error ? <div className="tiktok-ads-notice tiktok-ads-notice--danger">{errorMessage(list.error) || t("tiktokAds.errors.generic")}</div> : null}

      {list.loading && !list.rows.length ? <LoadingState /> : !list.rows.length ? (
        <EmptyState title={waiting ? t("tiktokAds.ads.emptyWaiting") : t("tiktokAds.ads.empty")} description={waiting ? t("tiktokAds.waitingPermission") : t("tiktokAds.ads.emptyHint")} />
      ) : (
        <TableContainer>
          <Table density="compact" nowrap sticky>
            <TableHead>
              <TableRow>
                <TableHeaderCell>{t("tiktokAds.columns.name")}</TableHeaderCell>
                <TableHeaderCell>{t("tiktokAds.columns.delivery")}</TableHeaderCell>
                {showBudget ? <TableHeaderCell numeric>{t("tiktokAds.columns.budget")}</TableHeaderCell> : null}
                <TableHeaderCell numeric>{t("tiktokAds.columns.spend")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.impressions")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.clicks")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.ctr")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.cpc")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.conversions")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.purchases")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.purchaseValue")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.roas")}</TableHeaderCell>
                <TableHeaderCell numeric>{t("tiktokAds.columns.costPerPurchase")}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.rows.map((row) => {
                const delivery = deliveryOf(row);
                return (
                  <TableRow key={row.object_id}>
                    <TableCell>
                      {level === "ad" ? (
                        <span className="tiktok-ads-name">{row.name || row.object_id}</span>
                      ) : (
                        <button type="button" className="tiktok-ads-name tiktok-ads-name--link" onClick={() => openChildren(row)}>{row.name || row.object_id}</button>
                      )}
                    </TableCell>
                    <TableCell>
                      <span title={row.secondary_status || ""}><StatusBadge tone={delivery.tone}>{t(`tiktokAds.delivery.${delivery.key}`)}</StatusBadge></span>
                    </TableCell>
                    {showBudget ? (
                      <TableCell numeric>
                        {row.budget && Number(row.budget) > 0 ? `${money(row.budget)} · ${t(`tiktokAds.budgetMode.${row.budget_mode || "BUDGET_MODE_INFINITE"}`, { defaultValue: row.budget_mode || "" })}` : "—"}
                      </TableCell>
                    ) : null}
                    {metricCells(row)}
                  </TableRow>
                );
              })}
            </TableBody>
            {list.totals ? (
              <TableFoot>
                <TableRow>
                  <TableCell>{t("tiktokAds.columns.total")}</TableCell>
                  <TableCell />
                  {showBudget ? <TableCell /> : null}
                  {metricCells(list.totals)}
                </TableRow>
              </TableFoot>
            ) : null}
          </Table>
        </TableContainer>
      )}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { AlertTriangle, Folder, Layers, LayoutGrid, Plus, RefreshCw, Workflow, X, Zap } from "lucide-react";

import { Button, EmptyState, LoadingState, Modal, SearchInput, Select } from "../../../shared/ui";
import { hasPermission } from "../../../shared/auth/authStorage";
import {
  isForbiddenError,
  isNoAccountError,
  isNotReadyError,
  metaErrorMessage,
  readSelectedAccountId,
  writeSelectedAccountId,
} from "../shared/metaAdsApi";
import CreateWizard from "./wizard/CreateWizard";
import ManagerTable from "./list/ManagerTable";
import ColumnsMenu from "./list/ColumnsMenu";
import ChartsDrawer from "./list/ChartsDrawer";
import RulesModal from "./list/RulesModal";
import { managerApi, readColumnChoice, writeColumnChoice } from "./list/managerApi";
import "./list/adsManager.css";

const LEVELS = [
  { key: "campaign", icon: Folder },
  { key: "adset", icon: Layers },
  { key: "ad", icon: Workflow },
];
const DATE_PRESETS = ["all", "7", "30", "90"];
const EMPTY_COUNTS = { campaign: 0, adset: 0, ad: 0 };

const useDebounced = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

const errorKind = (error) => {
  if (isForbiddenError(error)) return "denied";
  if (isNotReadyError(error)) return "notReady";
  if (isNoAccountError(error)) return "noAccount";
  return "failed";
};

// /meta-ads — the Ads Manager main screen (campaigns / ad sets / ads lists).
export default function AdsManagerPage() {
  const { t, i18n } = useTranslation();
  const canManage = hasPermission("meta_ads.manage");

  const [boot, setBoot] = useState({ loading: true, data: null, error: null });
  const [accountId, setAccountId] = useState(() => readSelectedAccountId());
  const [level, setLevel] = useState("campaign");
  const [days, setDays] = useState("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const [drill, setDrill] = useState({ campaign: null, adset: null });
  const [list, setList] = useState({ loading: false, rows: [], counts: EMPTY_COUNTS, error: "" });
  const [reloadKey, setReloadKey] = useState(0);
  const [columnChoice, setColumnChoice] = useState(() => ({
    campaign: readColumnChoice("campaign"),
    adset: readColumnChoice("adset"),
    ad: readColumnChoice("ad"),
  }));
  const [selected, setSelected] = useState(() => new Set());
  const [pending, setPending] = useState(() => new Set());
  const [syncing, setSyncing] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [charts, setCharts] = useState(null);
  const [wizard, setWizard] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ------------------------------------------------------------ bootstrap
  const loadBoot = useCallback(async () => {
    try {
      const data = await managerApi.bootstrap();
      setBoot({ loading: false, data, error: null });
      return data;
    } catch (error) {
      setBoot({ loading: false, data: null, error });
      return null;
    }
  }, []);

  useEffect(() => {
    void loadBoot();
  }, [loadBoot]);

  const accounts = useMemo(() => boot.data?.accounts || [], [boot.data]);
  const account = accounts.find((item) => String(item.id) === String(accountId)) || null;

  // Fall back to the first account when the remembered one is gone.
  useEffect(() => {
    if (!accounts.length) return;
    if (!accounts.some((item) => String(item.id) === String(accountId))) {
      const first = String(accounts[0].id);
      setAccountId(first);
      writeSelectedAccountId(first);
    }
  }, [accounts, accountId]);

  // ------------------------------------------------------------ list data
  const params = useMemo(() => {
    if (!account) return null;
    const value = { account_id: account.id, level, days, q };
    if (level === "adset" && drill.campaign) value.campaign_id = drill.campaign.id;
    if (level === "ad") {
      if (drill.adset) value.adset_id = drill.adset.id;
      else if (drill.campaign) value.campaign_id = drill.campaign.id;
    }
    return value;
  }, [account, level, days, q, drill]);

  useEffect(() => {
    if (!params) return undefined;
    let alive = true;
    setList((current) => ({ ...current, loading: true, error: "" }));
    managerApi.data(params)
      .then((data) => {
        if (!alive) return;
        setList({ loading: false, rows: data?.rows || [], counts: data?.counts || EMPTY_COUNTS, error: "" });
      })
      .catch((error) => {
        if (!alive) return;
        setList({ loading: false, rows: [], counts: EMPTY_COUNTS, error: metaErrorMessage(error) || t("metaAdsManager.loadFailed") });
      });
    return () => {
      alive = false;
    };
  }, [params, reloadKey, t]);

  const reload = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    setSelected(new Set());
  }, [level, accountId]);

  // ------------------------------------------------------------ actions
  const changeAccount = (value) => {
    setAccountId(value);
    writeSelectedAccountId(value);
    setDrill({ campaign: null, adset: null });
  };

  const changeColumns = (choice) => {
    setColumnChoice((current) => ({ ...current, [level]: choice }));
    writeColumnChoice(level, choice);
  };

  const sync = async () => {
    if (!account || syncing) return;
    setSyncing(true);
    try {
      const data = await managerApi.sync(account.id);
      const result = data?.result || {};
      toast.success(t("metaAdsManager.syncDone", { campaigns: result.campaigns ?? 0, adsets: result.adsets ?? 0, ads: result.ads ?? 0 }));
      if (data?.warnings?.length) {
        toast(t("metaAdsManager.syncWarnings", { list: data.warnings.map((item) => item.message).join(" · ") }), { icon: "⚠️" });
      }
      await loadBoot();
      reload();
    } catch (error) {
      toast.error(metaErrorMessage(error) || t("metaAdsManager.syncFailed"));
    } finally {
      setSyncing(false);
    }
  };

  const toggleStatus = async (row, on) => {
    const key = String(row.id);
    const next = on ? "ACTIVE" : "PAUSED";
    const previous = { status: row.status, effective_status: row.effective_status };
    const patch = (values) => setList((current) => ({
      ...current,
      rows: current.rows.map((item) => (String(item.id) === key ? { ...item, ...values } : item)),
    }));
    patch({ status: next, effective_status: next });
    setPending((current) => new Set(current).add(key));
    try {
      const data = await managerApi.setStatus(level, row.id, next);
      patch({ status: data?.status || next, effective_status: data?.effective_status || next });
      toast.success(on ? t("metaAdsManager.status.turnedOn") : t("metaAdsManager.status.turnedOff"));
    } catch (error) {
      patch(previous);
      toast.error(metaErrorMessage(error) || t("metaAdsManager.status.failed"));
    } finally {
      setPending((current) => {
        const copy = new Set(current);
        copy.delete(key);
        return copy;
      });
    }
  };

  const campaignIdOf = (row) => (level === "campaign" ? row.id : row.campaign_id || null);

  const openEdit = (row) => setWizard({ draftCampaignId: campaignIdOf(row), focus: { level, id: row.id } });

  const duplicate = async (row) => {
    try {
      const data = await managerApi.duplicate(level, row.id, i18n.language);
      toast.success(t("metaAdsManager.duplicateDone"));
      reload();
      setWizard({ draftCampaignId: data?.campaign_id || null, focus: null });
    } catch (error) {
      toast.error(metaErrorMessage(error) || t("metaAdsManager.duplicateFailed"));
    }
  };

  const deleteDraft = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await managerApi.deleteDraft(level, confirmDelete.id);
      toast.success(t("metaAdsManager.deleteDone"));
      setConfirmDelete(null);
      reload();
    } catch (error) {
      toast.error(metaErrorMessage(error) || t("metaAdsManager.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const drillInto = (row) => {
    if (level === "campaign") {
      setDrill({ campaign: { id: row.id, name: row.name }, adset: null });
      setLevel("adset");
    } else if (level === "adset") {
      setDrill((current) => ({ campaign: current.campaign, adset: { id: row.id, name: row.name } }));
      setLevel("ad");
    }
    setSearch("");
  };

  const select = (key, checked) => setSelected((current) => {
    const copy = new Set(current);
    if (checked) copy.add(key);
    else copy.delete(key);
    return copy;
  });
  const selectAll = (checked) => setSelected(checked ? new Set(list.rows.map((row) => String(row.id))) : new Set());

  // ------------------------------------------------------------ render: blocking states
  if (boot.loading) return <LoadingState />;

  if (boot.error) {
    const kind = errorKind(boot.error);
    if (kind === "denied") return <EmptyState title={t("metaAds.common.deniedTitle")} description={t("metaAds.common.deniedBody")} />;
    if (kind === "notReady") return <EmptyState title={t("metaAds.common.notReadyTitle")} description={t("metaAds.common.notReadyBody")} />;
    return (
      <EmptyState
        title={t("metaAdsManager.loadFailed")}
        description={metaErrorMessage(boot.error)}
        action={<Button onClick={() => { setBoot({ loading: true, data: null, error: null }); void loadBoot(); }}>{t("metaAdsManager.retry")}</Button>}
      />
    );
  }

  if (!accounts.length) {
    return (
      <EmptyState
        title={t("metaAds.common.noAccountTitle")}
        description={t("metaAds.common.noAccountBody")}
        action={<Link className="m1-button m1-button--primary m1-button--md" to="/meta-ads/connect">{t("metaAds.common.connectAction")}</Link>}
      />
    );
  }

  const visible = columnChoice[level].visible;
  const counts = list.counts || EMPTY_COUNTS;
  const emptyText = q ? t("metaAdsManager.empty.search") : t(`metaAdsManager.empty.${level}`);
  const chips = [];
  if ((level === "adset" || level === "ad") && drill.campaign && !(level === "ad" && drill.adset)) {
    chips.push({ key: "campaign", label: t("metaAdsManager.filterChip.campaign", { name: drill.campaign.name }), clear: () => setDrill({ campaign: null, adset: null }) });
  }
  if (level === "ad" && drill.adset) {
    chips.push({ key: "adset", label: t("metaAdsManager.filterChip.adset", { name: drill.adset.name }), clear: () => setDrill((current) => ({ ...current, adset: null })) });
  }

  return (
    <div className="ma-page">
      <header className="ma-header">
        <div className="ma-header__start">
          <span className="ma-header__tile" aria-hidden="true"><LayoutGrid size={20} /></span>
          <h1 className="ma-header__title">{t("metaAdsManager.title")}</h1>
          <Select
            aria-label={t("metaAdsManager.accountSelect")}
            className="ma-header__account"
            value={String(account?.id || "")}
            onChange={(event) => changeAccount(event.target.value)}
          >
            {accounts.map((item) => (
              <option key={item.id} value={String(item.id)}>{`${item.name || item.ad_account_id} (${item.ad_account_id})`}</option>
            ))}
          </Select>
          {account?.currency ? <span className="ma-header__currency">{account.currency}</span> : null}
        </div>
        <div className="ma-header__end">
          <Select
            aria-label={t("metaAdsManager.datePreset")}
            className="ma-header__dates"
            value={days}
            onChange={(event) => setDays(event.target.value)}
          >
            {DATE_PRESETS.map((key) => <option key={key} value={key}>{t(`metaAdsManager.presets.${key}`)}</option>)}
          </Select>
          <button type="button" className="ma-plain-btn" onClick={() => setRulesOpen(true)}>
            <Zap size={17} aria-hidden="true" />
            <span>{t("metaAdsManager.rules")}</span>
          </button>
          {canManage ? (
            <button type="button" className="ma-plain-btn" onClick={sync} disabled={syncing || !account?.has_token} aria-busy={syncing || undefined}>
              <RefreshCw size={17} aria-hidden="true" className={syncing ? "ma-spin" : undefined} />
              <span>{syncing ? t("metaAdsManager.syncing") : t("metaAdsManager.sync")}</span>
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className="ma-create-btn" onClick={() => setWizard({ draftCampaignId: null, focus: null })}>
              <Plus size={18} aria-hidden="true" />
              <span>{t("metaAdsManager.create")}</span>
            </button>
          ) : null}
        </div>
      </header>

      {account && !account.has_token ? (
        <div className="ma-banner" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{t("metaAdsManager.noTokenBanner")}</span>
          <Link to="/meta-ads/connect" className="ma-banner__link">{t("metaAds.common.reconnect")}</Link>
        </div>
      ) : null}
      {account?.last_sync_error ? (
        <div className="ma-banner ma-banner--danger" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{t("metaAds.common.metaError", { message: account.last_sync_error })}</span>
        </div>
      ) : null}

      <section className="ma-card">
        <div className="ma-tabs" role="tablist" aria-label={t("metaAdsManager.tabs.aria")}>
          {LEVELS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={level === key}
              className={`ma-tab${level === key ? " is-active" : ""}`}
              onClick={() => setLevel(key)}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{t(`metaAdsManager.tabs.${key}`)}</span>
              <span className="ma-tab__count">{Number(counts[key] || 0).toLocaleString("en-US")}</span>
            </button>
          ))}
        </div>

        <div className="ma-toolbar">
          <div className="ma-toolbar__search">
            <SearchInput
              aria-label={t("metaAdsManager.searchPlaceholder")}
              placeholder={t("metaAdsManager.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
            />
          </div>
          {chips.map((chip) => (
            <span key={chip.key} className="ma-chip">
              <span className="ma-chip__text">{chip.label}</span>
              <button type="button" aria-label={t("metaAdsManager.filterChip.remove")} onClick={chip.clear}><X size={14} /></button>
            </span>
          ))}
          <span className="ma-toolbar__spacer" />
          <ColumnsMenu level={level} choice={columnChoice[level]} onChange={changeColumns} />
        </div>

        {!canManage ? <p className="ma-readonly">{t("metaAdsManager.readOnly")}</p> : null}
        {list.error ? <p className="ma-error" role="alert">{list.error}</p> : null}

        <ManagerTable
          level={level}
          rows={list.rows}
          loading={list.loading}
          visible={visible}
          canManage={canManage}
          pendingIds={pending}
          selectedIds={selected}
          onSelect={select}
          onSelectAll={selectAll}
          onToggleStatus={toggleStatus}
          onEdit={openEdit}
          onDuplicate={duplicate}
          onDelete={(row) => setConfirmDelete(row)}
          onCharts={(row) => setCharts({ level, row })}
          onDrill={drillInto}
          emptyText={emptyText}
        />
      </section>

      <ChartsDrawer
        target={charts}
        accountId={account?.id}
        days={days}
        currency={account?.currency}
        onClose={() => setCharts(null)}
      />

      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} accountId={account?.id} canManage={canManage} />

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => !deleting && setConfirmDelete(null)}
        title={t("metaAdsManager.deleteConfirmTitle")}
        size="sm"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)} disabled={deleting}>{t("metaAds.common.cancel")}</Button>
            <Button variant="danger" onClick={deleteDraft} loading={deleting}>{t("metaAds.common.delete")}</Button>
          </>
        )}
      >
        <p className="ma-confirm">{t("metaAdsManager.deleteConfirmBody", { name: confirmDelete?.name || "" })}</p>
      </Modal>

      <CreateWizard
        open={Boolean(wizard)}
        onClose={() => setWizard(null)}
        bootstrap={boot.data}
        accountId={account?.id}
        draftCampaignId={wizard?.draftCampaignId ?? null}
        focus={wizard?.focus ?? null}
        onSaved={() => {
          reload();
          void loadBoot();
        }}
      />
    </div>
  );
}

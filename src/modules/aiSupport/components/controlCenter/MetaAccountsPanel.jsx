// Messenger / Instagram accounts — inbox top bar → Messenger|Instagram → Accounts / Connect.
//
// Genie's shape and nothing more: a table of the connected Pages (or Instagram accounts), a record
// view with the numbers Meta reports, and a one-button connect page. The full Meta diagnostics
// panel (capabilities, tokens by hand, advanced mode) still exists under Config → All connections;
// it is not repeated here.
//
// mode: "messenger" | "instagram" (the account list) or "connect_messenger" | "connect_instagram".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { ArrowRight, Check, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { FaFacebookF, FaInstagram } from "react-icons/fa";

import { api } from "../../../../shared/api/api";
import {
  enableMetaWebhookSubscription,
  getMetaOAuthPages,
  getMetaWebhookSelfTest,
  selectMetaOAuthPage,
  startMetaOAuth,
} from "../../../marketing/services/marketingApi";
import { ActionButton, PanelSkeleton, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 401, 403, 404, 409, 500] };
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const ACTIVE_STATUSES = new Set(["fully_connected", "active", "connected", "saved"]);

const formatNumber = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString("en-US") : "—");

function StatusChip({ status }) {
  const { t } = useTranslation();
  const active = ACTIVE_STATUSES.has(clean(status).toLowerCase());
  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${active ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-rose-300/25 bg-rose-400/10 text-rose-100"}`}>
      {active ? t("aiSupport.metaAccounts.active") : t("aiSupport.metaAccounts.inactive")}
    </span>
  );
}

function Field({ label, value, ltr = false }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
      <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div dir={ltr ? "ltr" : "auto"} className="mt-0.5 truncate text-sm font-bold text-white">{value || "—"}</div>
    </div>
  );
}

// Facebook Login in a popup, then — when Meta hands back several Pages — the page picker. The
// server side is the same flow the full Meta panel uses (/meta/oauth/*).
function useMetaConnect({ onConnected }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState([]);
  const popupRef = useRef(null);
  const timersRef = useRef({ timeout: null, interval: null });

  const clearWatchers = useCallback(() => {
    window.clearTimeout(timersRef.current.timeout);
    window.clearInterval(timersRef.current.interval);
    timersRef.current = { timeout: null, interval: null };
    popupRef.current = null;
  }, []);

  useEffect(() => () => clearWatchers(), [clearWatchers]);

  useEffect(() => {
    const onMessage = async (event) => {
      if (event?.data?.type !== "meta-oauth") return;
      const payload = event.data.payload || {};
      try {
        if (!payload.success) {
          toast.error(payload.message || t("aiSupport.metaAccounts.connectFailed"));
          return;
        }
        if (payload.status === "pages_ready") {
          const result = await getMetaOAuthPages(SUPPRESSED);
          setPages(Array.isArray(result?.pages) ? result.pages : []);
          return;
        }
        setPages([]);
        toast.success(t("aiSupport.metaAccounts.connected"));
        onConnected?.();
      } catch (error) {
        toast.error(error?.message || t("aiSupport.metaAccounts.connectFailed"));
      } finally {
        clearWatchers();
        setBusy(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [clearWatchers, onConnected, t]);

  const start = useCallback(async () => {
    clearWatchers();
    setBusy(true);
    try {
      const result = await startMetaOAuth();
      if (!result?.auth_url) throw new Error(t("aiSupport.metaAccounts.connectFailed"));
      const popup = window.open(result.auth_url, "meta-oauth", "width=720,height=760,menubar=no,toolbar=no,status=no");
      if (!popup) {
        window.location.href = result.auth_url;
        return;
      }
      popupRef.current = popup;
      timersRef.current.timeout = window.setTimeout(() => { clearWatchers(); setBusy(false); }, OAUTH_TIMEOUT_MS);
      timersRef.current.interval = window.setInterval(() => {
        if (!popupRef.current?.closed) return;
        clearWatchers();
        setBusy(false);
      }, 500);
    } catch (error) {
      clearWatchers();
      setBusy(false);
      toast.error(error?.message || t("aiSupport.metaAccounts.connectFailed"));
    }
  }, [clearWatchers, t]);

  const choose = useCallback(async (page) => {
    setBusy(true);
    try {
      await selectMetaOAuthPage({ page_id: page.page_id });
      setPages([]);
      toast.success(t("aiSupport.metaAccounts.connected"));
      onConnected?.();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.metaAccounts.connectFailed"));
    } finally {
      setBusy(false);
    }
  }, [onConnected, t]);

  return { busy, pages, start, choose };
}

function PagePicker({ pages, busy, onChoose }) {
  const { t } = useTranslation();
  if (!pages.length) return null;
  return (
    <div className="rounded-2xl border border-amber-300/25 bg-amber-400/[0.06] p-3">
      <div className="mb-2 text-xs font-black text-amber-100">{t("aiSupport.metaAccounts.choosePage")}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {pages.map((page) => (
          <button
            key={page.page_id}
            type="button"
            disabled={busy}
            onClick={() => onChoose(page)}
            className="rounded-xl border border-white/10 bg-slate-950/50 p-3 text-start transition hover:border-cyan-300/30 disabled:opacity-50"
          >
            <div className="truncate text-sm font-black text-white">{page.page_name || page.page_id}</div>
            <div className="mt-1 truncate text-[11px] text-slate-400" dir="ltr">{page.page_id}</div>
            <div className="mt-1 truncate text-[11px] text-cyan-200">{page.instagram_username ? `@${page.instagram_username}` : t("aiSupport.metaAccounts.noInstagram")}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Genie's connect page: what connecting gives you, and one button.
function ConnectView({ platform, connect }) {
  const { t } = useTranslation();
  const instagram = platform === "instagram";
  const Icon = instagram ? FaInstagram : FaFacebookF;
  const points = instagram
    ? [t("aiSupport.metaAccounts.connectIg.p1"), t("aiSupport.metaAccounts.connectIg.p2"), t("aiSupport.metaAccounts.connectIg.p3")]
    : [t("aiSupport.metaAccounts.connectFb.p1"), t("aiSupport.metaAccounts.connectFb.p2"), t("aiSupport.metaAccounts.connectFb.p3")];
  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-6 text-center">
        <span className={`mx-auto grid h-14 w-14 place-items-center rounded-2xl ${instagram ? "bg-pink-500/15 text-pink-200" : "bg-blue-500/15 text-blue-200"}`}>
          <Icon className="h-7 w-7" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-lg font-black text-white">{instagram ? t("aiSupport.metaAccounts.connectIg.title") : t("aiSupport.metaAccounts.connectFb.title")}</h3>
        <p className="mt-1 text-xs leading-6 text-slate-400">{instagram ? t("aiSupport.metaAccounts.connectIg.subtitle") : t("aiSupport.metaAccounts.connectFb.subtitle")}</p>
        <ul className="mt-4 space-y-2 text-start">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-xs font-bold text-slate-200">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
        <ActionButton tone="meta" loading={connect.busy} onClick={connect.start} className="mt-5 w-full">
          {t("aiSupport.metaAccounts.continueWithFacebook")}
        </ActionButton>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">{t("aiSupport.metaAccounts.connectNote")}</p>
      </div>
      <PagePicker pages={connect.pages} busy={connect.busy} onChoose={connect.choose} />
    </div>
  );
}

function RecordView({ platform, account, onBack, onRefresh, refreshing }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("status");
  const [busy, setBusy] = useState("");
  const [webhookResult, setWebhookResult] = useState(null);
  const instagram = platform === "instagram";

  const verifyWebhook = async () => {
    setBusy("webhook");
    try {
      const [result] = await Promise.all([getMetaWebhookSelfTest(SUPPRESSED), enableMetaWebhookSubscription({}, SUPPRESSED)]);
      setWebhookResult(result || {});
      toast.success(t("aiSupport.metaAccounts.webhookChecked"));
    } catch (error) {
      toast.error(error?.message || t("aiSupport.metaAccounts.webhookFailed"));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-black text-cyan-200 hover:underline">
            <ArrowRight className="h-3.5 w-3.5 rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
            {t("aiSupport.metaAccounts.allAccounts")}
          </button>
          <span className="text-slate-600">/</span>
          <span className="text-sm font-black text-white">{instagram ? (account.username ? `@${account.username}` : account.account_id) : account.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton icon={RefreshCw} loading={refreshing} onClick={onRefresh}>{t("aiSupport.metaAccounts.syncNow")}</ActionButton>
          <StatusChip status={account.status} />
        </div>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
        {account.picture ? <img src={account.picture} alt="" className="h-14 w-14 rounded-2xl object-cover" referrerPolicy="no-referrer" /> : null}
        <div className="min-w-0">
          <div className="truncate text-base font-black text-white">{instagram ? account.profile_name || account.username : account.name}</div>
          <div className="truncate text-xs text-slate-400" dir="ltr">{instagram ? account.account_id : account.page_id}</div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-white/10">
        {["status", "credentials"].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-black transition ${tab === key ? "border-cyan-300 text-cyan-100" : "border-transparent text-slate-400 hover:text-white"}`}
          >
            {key === "status" ? t("aiSupport.metaAccounts.tabs.status") : t("aiSupport.metaAccounts.tabs.credentials")}
          </button>
        ))}
      </div>

      {tab === "status" ? (
        instagram ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("aiSupport.metaAccounts.columns.profileName")} value={account.profile_name} />
            <Field label={t("aiSupport.metaAccounts.columns.username")} value={account.username ? `@${account.username}` : ""} ltr />
            <Field label={t("aiSupport.metaAccounts.columns.type")} value={account.type} />
            <Field label={t("aiSupport.metaAccounts.followers")} value={formatNumber(account.followers)} ltr />
            <Field label={t("aiSupport.metaAccounts.posts")} value={formatNumber(account.media_count)} ltr />
            <Field label={t("aiSupport.metaAccounts.linkedPage")} value={account.page_name} />
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("aiSupport.metaAccounts.columns.username")} value={account.username ? `@${account.username}` : ""} ltr />
            <Field label={t("aiSupport.metaAccounts.columns.category")} value={account.category} />
            <Field label={t("aiSupport.metaAccounts.followers")} value={formatNumber(account.followers)} ltr />
            <Field label={t("aiSupport.metaAccounts.impressions")} value={formatNumber(account.impressions_28d)} ltr />
            <Field label={t("aiSupport.metaAccounts.reach")} value={formatNumber(account.reach_28d)} ltr />
            <Field label={t("aiSupport.metaAccounts.views")} value={formatNumber(account.views_28d)} ltr />
            <Field label={t("aiSupport.metaAccounts.engagements")} value={formatNumber(account.engagements_28d)} ltr />
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("aiSupport.metaAccounts.tokenStatus")} value={account.status} ltr />
            <Field label={t("aiSupport.metaAccounts.tokenExpires")} value={formatDateTime(account.token_expires_at)} />
            <Field label={t("aiSupport.metaAccounts.webhook")} value={account.webhook ? t("aiSupport.metaAccounts.webhookOn") : t("aiSupport.metaAccounts.webhookOff")} />
            <Field label={t("aiSupport.metaAccounts.lastWebhook")} value={formatDateTime(account.last_webhook_at)} />
          </div>
          <ActionButton tone="amber" icon={ShieldCheck} loading={busy === "webhook"} onClick={verifyWebhook}>{t("aiSupport.metaAccounts.verifyWebhook")}</ActionButton>
          {webhookResult ? (
            <p className={`rounded-xl border p-2.5 text-xs font-bold ${webhookResult.ok === false || webhookResult.success === false ? "border-rose-300/20 bg-rose-400/10 text-rose-100" : "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"}`}>
              {clean(webhookResult.message) || t("aiSupport.metaAccounts.webhookChecked")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function MetaAccountsPanel({ headers, mode = "messenger" }) {
  const { t } = useTranslation();
  const connectMode = mode.startsWith("connect_");
  const platform = mode.endsWith("instagram") ? "instagram" : "messenger";
  const [loading, setLoading] = useState(!connectMode);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState({ pages: [], instagram: [] });
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    try {
      const result = await api.get("/integrations/meta/accounts", { headers, params: refresh ? { refresh: "1" } : {}, ...SUPPRESSED });
      if (mountedRef.current) setData({ pages: result?.pages || [], instagram: result?.instagram || [] });
    } catch (error) {
      if (mountedRef.current) toast.error(error?.message || t("aiSupport.metaAccounts.loadFailed"));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [headers, t]);

  useEffect(() => { if (!connectMode) void load(); }, [connectMode, load]);

  const onConnected = useCallback(() => {
    setShowConnect(false);
    void load({ refresh: true });
  }, [load]);
  const connect = useMetaConnect({ onConnected });

  const rows = platform === "instagram" ? data.instagram : data.pages;
  const keyOf = (row) => (platform === "instagram" ? row.account_id : row.page_id);
  const visible = useMemo(() => {
    const needle = clean(query).toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [row.name, row.profile_name, row.username, row.page_id, row.account_id, row.category].some((value) => clean(value).toLowerCase().includes(needle)));
  }, [query, rows]);
  const selected = rows.find((row) => keyOf(row) === selectedKey) || null;

  if (connectMode) return <ConnectView platform={platform} connect={connect} />;
  if (loading) return <PanelSkeleton rows={3} />;
  if (selected) {
    return <RecordView platform={platform} account={selected} onBack={() => setSelectedKey("")} onRefresh={() => load({ refresh: true })} refreshing={refreshing} />;
  }
  if (showConnect) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setShowConnect(false)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.metaAccounts.allAccounts")}</button>
        <ConnectView platform={platform} connect={connect} />
      </div>
    );
  }

  const instagram = platform === "instagram";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton tone="primary" icon={Plus} onClick={() => setShowConnect(true)}>
          {instagram ? t("aiSupport.metaAccounts.connectInstagram") : t("aiSupport.metaAccounts.connectPage")}
        </ActionButton>
        <ActionButton icon={RefreshCw} loading={refreshing} onClick={() => load({ refresh: true })}>{t("aiSupport.metaAccounts.syncNow")}</ActionButton>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("aiSupport.metaAccounts.search")}
          className="ms-auto h-9 w-64 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
        />
        <span className="text-[11px] font-black text-slate-500" dir="ltr">{visible.length} / {rows.length}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              {instagram ? (
                <>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.profileName")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.accountName")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.username")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.status")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.type")}</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.pageName")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.pageId")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.status")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.username")}</th>
                  <th className="px-3 py-2 text-start">{t("aiSupport.metaAccounts.columns.category")}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={keyOf(row)} onClick={() => setSelectedKey(keyOf(row))} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                {instagram ? (
                  <>
                    <td className="px-3 py-2.5 font-black">{row.profile_name || "—"}</td>
                    <td className="px-3 py-2.5">{row.page_name || "—"}</td>
                    <td className="px-3 py-2.5" dir="ltr">{row.username ? `@${row.username}` : "—"}</td>
                    <td className="px-3 py-2.5"><StatusChip status={row.status} /></td>
                    <td className="px-3 py-2.5">{row.type}</td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2.5 font-black">{row.name}</td>
                    <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.page_id}</td>
                    <td className="px-3 py-2.5"><StatusChip status={row.status} /></td>
                    <td className="px-3 py-2.5" dir="ltr">{row.username ? `@${row.username}` : "—"}</td>
                    <td className="px-3 py-2.5">{row.category || "—"}</td>
                  </>
                )}
              </tr>
            ))}
            {!visible.length ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.metaAccounts.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <PagePicker pages={connect.pages} busy={connect.busy} onChoose={connect.choose} />
    </div>
  );
}

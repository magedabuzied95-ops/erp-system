// WhatsApp → Accounts (Genie parity): the official numbers as a table, a record view with Meta's
// live answer about each, and the Embedded Signup flow behind "+ Connect number". Data:
// GET /whatsapp/embedded-signup/accounts (connected integrations + the env-configured number).
// The Evolution numbers are not here — they live under WhatsApp Web.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { Activity, ArrowRight, BellRing, Copy, Link2Off, Plus, Receipt, RefreshCw } from "lucide-react";

import { api } from "../../../../shared/api/api";
import WhatsAppEmbeddedSignupCard from "../integrations/WhatsAppEmbeddedSignupCard.jsx";
import { ActionButton, PanelSkeleton, clean, formatDateTime } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

const TONE = {
  good: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  warn: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  bad: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  idle: "border-white/10 bg-white/[0.06] text-slate-200",
};

const nameTone = (value) => {
  const status = clean(value).toUpperCase();
  if (status === "APPROVED" || status === "AVAILABLE_WITHOUT_REVIEW") return "good";
  if (status === "DECLINED" || status === "REJECTED") return "bad";
  return status ? "warn" : "idle";
};
const qualityTone = (value) => ({ GREEN: "good", YELLOW: "warn", RED: "bad" }[clean(value).toUpperCase()] || "idle");

// Meta's tier names → the number of customers per 24h, the way Genie prints them.
const LIMITS = { TIER_50: "50", TIER_250: "250", TIER_1K: "1,000", TIER_2K: "2,000", TIER_10K: "10,000", TIER_100K: "100,000", TIER_UNLIMITED: "∞" };
const limitLabel = (value) => LIMITS[clean(value).toUpperCase()] || clean(value) || "—";

function Badge({ tone = "idle", children }) {
  return <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${TONE[tone]}`}>{children}</span>;
}

function Field({ label, children, ltr = false }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
      <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div dir={ltr ? "ltr" : "auto"} className="mt-0.5 truncate text-sm font-bold text-white">{children || "—"}</div>
    </div>
  );
}

// Same wording as the Embedded Signup card, so the two never describe one number differently.
const coexistenceLabel = (t, state) => (state ? t(`aiSupport.integrations.whatsapp.embeddedSignup.coexistenceState.${state}`, state) : "—");

const nameOf = (account) => clean(account.live?.verified_name || account.verified_name) || clean(account.display_phone_number) || account.phone_number_id;

function RecordView({ account, webhook, headers, onBack, onChanged, onOpenSection }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState("status");
  const [busy, setBusy] = useState("");
  const live = account.live || {};
  const embedded = account.source === "embedded_signup";

  const act = async (key, task, okText) => {
    setBusy(key);
    try {
      await task();
      if (okText) toast.success(okText);
      onChanged?.();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.waAccounts.actionFailed"));
    } finally {
      setBusy("");
    }
  };

  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("aiSupport.waAccounts.copied"));
    } catch {
      /* clipboard blocked: the value is on screen to copy by hand */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-black text-cyan-200 hover:underline">
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            {t("aiSupport.waAccounts.allAccounts")}
          </button>
          <span className="text-slate-600">/</span>
          <span className="text-sm font-black text-white">{nameOf(account)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {embedded ? (
            <>
              <ActionButton tone="emerald" icon={Activity} loading={busy === "test"} onClick={() => act("test", () => api.get("/whatsapp/embedded-signup/live-status", { headers, params: { id: account.id }, ...SUPPRESSED }), t("aiSupport.waAccounts.connectionOk"))}>
                {t("aiSupport.waAccounts.testConnection")}
              </ActionButton>
              <ActionButton icon={BellRing} loading={busy === "subscribe"} onClick={() => act("subscribe", () => api.post("/whatsapp/embedded-signup/subscribe", { id: account.id }, { headers, ...SUPPRESSED }), t("aiSupport.waAccounts.subscribed"))}>
                {t("aiSupport.waAccounts.subscribe")}
              </ActionButton>
            </>
          ) : null}
          <Badge tone={account.status === "connected" ? "good" : "bad"}>{account.status === "connected" ? t("aiSupport.waAccounts.active") : t("aiSupport.waAccounts.inactive")}</Badge>
        </div>
      </div>

      {live.ok === false ? (
        <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{t("aiSupport.waAccounts.metaError")}: {live.error}</p>
      ) : null}

      <div className="flex gap-1 border-b border-white/10">
        {["status", "credentials", "usage"].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => (key === "usage" ? onOpenSection?.("wa_usage") : setTab(key))}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-black transition ${tab === key ? "border-cyan-300 text-cyan-100" : "border-transparent text-slate-400 hover:text-white"}`}
          >
            {key === "status" ? t("aiSupport.waAccounts.tabs.status") : key === "credentials" ? t("aiSupport.waAccounts.tabs.credentials") : t("aiSupport.waAccounts.tabs.usage")}
          </button>
        ))}
      </div>

      {tab === "status" ? (
        <div className="space-y-3">
          {live.name_status && nameTone(live.name_status) !== "good" ? (
            <p className="rounded-xl border border-amber-300/20 bg-amber-400/10 p-2.5 text-xs leading-6 text-amber-100">{t("aiSupport.waAccounts.nameNotApproved")}</p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("aiSupport.waAccounts.columns.displayName")}>{live.verified_name || account.verified_name}</Field>
            <Field label={t("aiSupport.waAccounts.columns.nameStatus")}>{live.name_status ? <Badge tone={nameTone(live.name_status)}>{live.name_status}</Badge> : null}</Field>
            <Field label={t("aiSupport.waAccounts.columns.phone")} ltr>{live.display_phone_number || account.display_phone_number}</Field>
            <Field label={t("aiSupport.waAccounts.quality")}>{live.quality_rating ? <Badge tone={qualityTone(live.quality_rating)}>{live.quality_rating}</Badge> : null}</Field>
            <Field label={t("aiSupport.waAccounts.columns.limit")} ltr>{live.messaging_limit_tier ? limitLabel(live.messaging_limit_tier) : ""}</Field>
            <Field label={t("aiSupport.waAccounts.columns.coexistence")}>{account.coexistence_state ? coexistenceLabel(t, account.coexistence_state) : live.platform_type}</Field>
            <Field label={t("aiSupport.waAccounts.blueTick")}>{live.is_official_business_account ? t("aiSupport.waAccounts.yes") : t("aiSupport.waAccounts.no")}</Field>
            <Field label={t("aiSupport.waAccounts.businessVerification")}>{live.business_verification_status}</Field>
            <Field label={t("aiSupport.waAccounts.accountReview")}>{live.account_review_status}</Field>
          </div>
          <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waAccounts.limitExplainer")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t("aiSupport.waAccounts.columns.phoneNumberId")} ltr>{account.phone_number_id}</Field>
            <Field label={t("aiSupport.waAccounts.columns.wabaId")} ltr>{account.waba_id}</Field>
            <Field label={t("aiSupport.waAccounts.businessId")} ltr>{account.business_id}</Field>
            <Field label={t("aiSupport.waAccounts.source")}>{embedded ? t("aiSupport.waAccounts.sourceSignup") : t("aiSupport.waAccounts.sourceEnv")}</Field>
            <Field label={t("aiSupport.waAccounts.tokenExpires")}>{embedded ? formatDateTime(account.token_expires_at, t("aiSupport.waAccounts.noExpiry")) : ""}</Field>
            <Field label={t("aiSupport.waAccounts.webhookSubscribed")}>{live.webhook_subscribed || account.webhook_subscribed ? t("aiSupport.waAccounts.yes") : t("aiSupport.waAccounts.no")}</Field>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.waAccounts.callbackUrl")}</div>
            <div className="mt-1 flex items-center gap-2">
              <code dir="ltr" className="min-w-0 flex-1 truncate text-xs font-bold text-cyan-100">{webhook?.callback_url}</code>
              <button type="button" onClick={() => copy(webhook?.callback_url || "")} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-white/10" aria-label={t("aiSupport.waAccounts.copy")}>
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {t("aiSupport.waAccounts.verifyToken")}: {webhook?.verify_token_configured ? t("aiSupport.waAccounts.configured") : t("aiSupport.waAccounts.notConfigured")}
            </div>
          </div>
          {embedded ? (
            <ActionButton
              tone="rose"
              icon={Link2Off}
              loading={busy === "disconnect"}
              onClick={() => {
                if (!window.confirm(t("aiSupport.waAccounts.confirmDisconnect"))) return;
                void act("disconnect", () => api.post("/whatsapp/embedded-signup/disconnect", { id: account.id }, { headers, ...SUPPRESSED }), t("aiSupport.waAccounts.disconnected")).then(onBack);
              }}
            >
              {t("aiSupport.waAccounts.disconnect")}
            </ActionButton>
          ) : (
            <p className="text-[11px] leading-5 text-slate-500">{t("aiSupport.waAccounts.envNote")}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function WhatsAppAccountsPanel({ headers, onOpenSection }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [webhook, setWebhook] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [query, setQuery] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    try {
      const result = await api.get("/whatsapp/embedded-signup/accounts", { headers, params: refresh ? { refresh: "1" } : {}, ...SUPPRESSED });
      if (!mountedRef.current) return;
      setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
      setWebhook(result?.webhook || null);
    } catch (error) {
      if (mountedRef.current) toast.error(error?.message || t("aiSupport.waAccounts.loadFailed"));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = clean(query).toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((row) => [nameOf(row), row.display_phone_number, row.phone_number_id, row.waba_id].some((value) => clean(value).toLowerCase().includes(needle)));
  }, [accounts, query]);
  const selected = accounts.find((row) => String(row.id) === selectedId) || null;

  if (loading) return <PanelSkeleton rows={3} />;
  if (selected) {
    return (
      <RecordView
        account={selected}
        webhook={webhook}
        headers={headers}
        onBack={() => setSelectedId("")}
        onChanged={() => load({ refresh: true })}
        onOpenSection={onOpenSection}
      />
    );
  }
  if (connecting) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={() => setConnecting(false)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.waAccounts.allAccounts")}</button>
        <WhatsAppEmbeddedSignupCard onConnected={() => { setConnecting(false); void load({ refresh: true }); }} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton tone="primary" icon={Plus} onClick={() => setConnecting(true)}>{t("aiSupport.waAccounts.connectNumber")}</ActionButton>
        <ActionButton icon={RefreshCw} loading={refreshing} onClick={() => load({ refresh: true })}>{t("aiSupport.waAccounts.syncNow")}</ActionButton>
        {onOpenSection ? <ActionButton icon={Receipt} onClick={() => onOpenSection("wa_usage")}>{t("aiSupport.waAccounts.tabs.usage")}</ActionButton> : null}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("aiSupport.waAccounts.search")}
          className="ms-auto h-9 w-64 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
        />
        <span className="text-[11px] font-black text-slate-500" dir="ltr">{visible.length} / {accounts.length}</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.name")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.phone")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.phoneNumberId")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.displayName")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.nameStatus")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.limit")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.wabaId")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.waAccounts.columns.coexistence")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} onClick={() => setSelectedId(String(row.id))} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                <td className="px-3 py-2.5 font-black">
                  <span className="inline-flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${row.status === "connected" && row.live?.ok !== false ? "bg-emerald-300" : "bg-rose-300"}`} aria-hidden="true" />
                    {nameOf(row)}
                  </span>
                </td>
                <td className="px-3 py-2.5" dir="ltr">{row.live?.display_phone_number || row.display_phone_number || "—"}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.phone_number_id}</td>
                <td className="px-3 py-2.5">{row.live?.verified_name || row.verified_name || "—"}</td>
                <td className="px-3 py-2.5">{row.live?.name_status ? <Badge tone={nameTone(row.live.name_status)}>{row.live.name_status}</Badge> : "—"}</td>
                <td className="px-3 py-2.5" dir="ltr">{row.live?.messaging_limit_tier ? limitLabel(row.live.messaging_limit_tier) : "—"}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="ltr">{row.waba_id || "—"}</td>
                <td className="px-3 py-2.5">{coexistenceLabel(t, row.coexistence_state)}</td>
              </tr>
            ))}
            {!visible.length ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                  {t("aiSupport.waAccounts.empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

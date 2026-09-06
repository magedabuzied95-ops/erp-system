// WhatsApp integration panel — two independent transports under one roof.
//
// 1. Meta WhatsApp Cloud API: the inbox conversation channel, configured by
//    environment (access token + phone number id) and read back from
//    /ai-agent/channels/status.
// 2. Evolution API gateway: the manual gateway used for order confirmations and
//    test sends. Separate credentials, separate health, separate failure mode —
//    so it gets its own card rather than being folded into the one above.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MessageCircle, Phone, Plus, RefreshCw, Send, ShieldCheck } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { WhatsappPairingCard } from "../WhatsappSessionAlert";
import WhatsAppEmbeddedSignupCard from "./WhatsAppEmbeddedSignupCard.jsx";
import { isWhatsappSessionDown } from "../../services/whatsappSession";
import {
  ActionButton,
  CheckRow,
  FieldRow,
  PanelSection,
  PanelSkeleton,
  StatusPill,
  TextInput,
  clean,
  formatDateTime,
  stateLabel,
} from "./integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

export default function WhatsAppIntegrationPanel({ headers, onStatusChange }) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [gateway, setGateway] = useState(null);
  const [cloud, setCloud] = useState({});
  const [busy, setBusy] = useState("");
  const [test, setTest] = useState({ phone: "", message: "", instance: "" });
  const [accounts, setAccounts] = useState([]);
  const [newInstance, setNewInstance] = useState({ instance: "", displayName: "" });
  const [instanceResult, setInstanceResult] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Seeded once so a user editing the body is never overwritten by a re-render.
  useEffect(() => {
    setTest((current) => (current.message ? current : { ...current, message: t("aiSupport.integrations.whatsapp.testDefaultMessage") }));
  }, [t]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const [gatewayResult, channelsResult, accountsResult] = await Promise.allSettled([
      api.get("/whatsapp/status", { headers, ...SUPPRESSED }),
      api.get("/ai-agent/channels/status", { headers, ...SUPPRESSED }),
      api.get("/ai-agent/channel-accounts", { params: { platform: "whatsapp", include_inactive: "true" }, headers, ...SUPPRESSED }),
    ]);
    if (!mountedRef.current) return;
    setGateway(gatewayResult.status === "fulfilled" ? gatewayResult.value?.status || null : null);
    setCloud(channelsResult.status === "fulfilled" ? channelsResult.value?.channels?.whatsapp || {} : {});
    setAccounts(accountsResult.status === "fulfilled" && Array.isArray(accountsResult.value?.accounts) ? accountsResult.value.accounts : []);
    if (!silent) setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  const [testResult, setTestResult] = useState(null);
  const runTest = useCallback(async () => {
    setBusy("test");
    setTestResult(null);
    try {
      // A specific number goes through the instance-aware endpoint; the legacy
      // route stays the default so single-number behaviour is untouched.
      if (test.instance) {
        await api.post("/ai-agent/channels/whatsapp/test-send", { to: test.phone, message: test.message, instance: test.instance }, { headers });
      } else {
        await api.post("/whatsapp/send-test", { phone: test.phone, message: test.message }, { headers });
      }
      if (!mountedRef.current) return;
      setTestResult({ ok: true, text: t("aiSupport.integrations.whatsapp.testSent") });
      await load({ silent: true });
    } catch (error) {
      if (mountedRef.current) setTestResult({ ok: false, text: error?.message || t("aiSupport.integrations.whatsapp.testFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [headers, load, t, test]);

  const addInstance = useCallback(async () => {
    setBusy("instance");
    setInstanceResult(null);
    try {
      const payload = await api.post(
        "/ai-agent/channel-accounts",
        { platform: "whatsapp", instance: newInstance.instance.trim(), display_name: newInstance.displayName.trim() },
        { headers }
      );
      if (!mountedRef.current) return;
      const state = clean(payload?.connection?.state) || "unknown";
      setInstanceResult({
        ok: payload?.connection?.connected === true,
        text: payload?.connection?.connected === true
          ? t("aiSupport.integrations.whatsapp.instances.added")
          : `${t("aiSupport.integrations.whatsapp.instances.addedNotConnected")} (${state})`,
      });
      setNewInstance({ instance: "", displayName: "" });
      await load({ silent: true });
    } catch (error) {
      if (mountedRef.current) setInstanceResult({ ok: false, text: error?.message || t("aiSupport.integrations.whatsapp.instances.addFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [headers, load, newInstance, t]);

  const toggleInstance = useCallback(async (account) => {
    setBusy(`toggle:${account.id}`);
    try {
      await api.patch(`/ai-agent/channel-accounts/${encodeURIComponent(account.id)}`, { is_active: account.is_active === false }, { headers });
      await load({ silent: true });
    } catch (error) {
      if (mountedRef.current) setInstanceResult({ ok: false, text: error?.message || t("aiSupport.integrations.whatsapp.instances.updateFailed") });
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [headers, load, t]);

  const cloudConfigured = cloud.env_enabled === true && cloud.access_token_configured === true && cloud.phone_number_id_configured === true;
  const cloudState = cloud.effective_enabled === true && cloudConfigured ? "connected" : cloudConfigured || cloud.env_enabled === true ? "partial" : "off";
  const gatewayState = gateway?.connected === true ? "connected" : gateway?.configured === true ? "partial" : "off";
  const overall = cloudState === "connected" || gatewayState === "connected" ? "connected" : cloudState === "partial" || gatewayState === "partial" ? "partial" : "off";

  useEffect(() => { if (!loading) onStatusChange?.(overall); }, [loading, onStatusChange, overall]);

  if (loading) return <PanelSkeleton rows={2} />;

  return (
    <div className="space-y-4">
      <WhatsAppEmbeddedSignupCard onConnected={() => load({ silent: true })} />

      <PanelSection
        icon={MessageCircle}
        title={t("aiSupport.integrations.whatsapp.cloud.title")}
        subtitle={t("aiSupport.integrations.whatsapp.cloud.subtitle")}
        tone={cloudState === "connected" ? "emerald" : "slate"}
        action={
          <>
            <StatusPill state={cloudState}>{stateLabel(t, cloudState)}</StatusPill>
            <ActionButton tone="ghost" icon={RefreshCw} loading={busy === "refresh"} onClick={() => { setBusy("refresh"); load({ silent: true }).finally(() => mountedRef.current && setBusy("")); }}>
              {t("aiSupport.integrations.common.refresh")}
            </ActionButton>
          </>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <CheckRow ok={cloud.env_enabled === true} label={t("aiSupport.integrations.whatsapp.cloud.envEnabled")} />
          <CheckRow ok={cloud.access_token_configured === true} label={t("aiSupport.integrations.whatsapp.cloud.accessToken")} />
          <CheckRow ok={cloud.phone_number_id_configured === true} label={t("aiSupport.integrations.whatsapp.cloud.phoneNumberId")} />
          <CheckRow ok={Boolean(cloud.last_webhook_received_at)} label={t("aiSupport.integrations.whatsapp.cloud.webhookReceived")} />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <FieldRow label={t("aiSupport.integrations.whatsapp.cloud.lastWebhook")} value={formatDateTime(cloud.last_webhook_received_at, t("aiSupport.integrations.common.never"))} />
          <FieldRow label={t("aiSupport.integrations.whatsapp.cloud.aiReplies")} value={cloud.ai_replies_enabled === true ? t("aiSupport.integrations.common.on") : t("aiSupport.integrations.common.off")} />
        </div>
        {clean(cloud.last_send_error) ? (
          <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100">{cloud.last_send_error}</p>
        ) : null}
        <p className="mt-3 text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.whatsapp.cloud.envNote")}</p>
      </PanelSection>

      <PanelSection
        icon={ShieldCheck}
        title={t("aiSupport.integrations.whatsapp.gateway.title")}
        subtitle={t("aiSupport.integrations.whatsapp.gateway.subtitle")}
        tone={gatewayState === "connected" ? "emerald" : "slate"}
        action={<StatusPill state={gatewayState}>{stateLabel(t, gatewayState)}</StatusPill>}
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="grid gap-2">
            <FieldRow label={t("aiSupport.integrations.whatsapp.gateway.provider")} value="Evolution API" />
            <FieldRow
              label={t("aiSupport.integrations.whatsapp.gateway.connectionState")}
              value={gateway?.connected ? gateway?.state || "open" : gateway?.configured === false ? t("aiSupport.integrations.whatsapp.gateway.notConfigured") : gateway?.state || t("aiSupport.integrations.common.unknown")}
            />
            <FieldRow label={t("aiSupport.integrations.whatsapp.gateway.apiUrl")} value={gateway?.apiUrl} fallback={t("aiSupport.integrations.whatsapp.gateway.apiUrlMissing")} />
            <FieldRow label={t("aiSupport.integrations.whatsapp.gateway.apiKey")} value={gateway?.apiKeyConfigured ? t("aiSupport.integrations.whatsapp.gateway.configured") : ""} fallback={t("aiSupport.integrations.whatsapp.gateway.apiKeyMissing")} />
            <FieldRow label={t("aiSupport.integrations.whatsapp.gateway.instance")} value={gateway?.instanceName} fallback={t("aiSupport.integrations.whatsapp.gateway.instanceMissing")} />
            {isWhatsappSessionDown(gateway) ? (
              // Re-pairing used to mean opening Evolution's own manager on the VPS
              // with the gateway API key, so in practice a dropped session stayed
              // dropped. The key still never leaves the server; only the QR does.
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
                <div className="text-xs font-black text-white">{t("aiSupport.integrations.whatsapp.pairing.title")}</div>
                <WhatsappPairingCard headers={headers} onConnected={() => load({ silent: true })} className="mt-2" />
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            <div className="text-xs font-black text-white">{t("aiSupport.integrations.whatsapp.gateway.testTitle")}</div>
            {accounts.length ? (
              <label className="mt-2 block">
                <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.integrations.whatsapp.instances.testInstance")}</span>
                <select
                  value={test.instance}
                  onChange={(event) => setTest((current) => ({ ...current, instance: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300/40"
                >
                  <option value="">{t("aiSupport.integrations.whatsapp.instances.defaultInstance")}{clean(gateway?.instanceName) ? ` (${gateway.instanceName})` : ""}</option>
                  {accounts.filter((account) => account.is_active !== false).map((account) => (
                    <option key={account.id} value={account.external_account_id}>
                      {clean(account.display_name) || account.external_account_id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <TextInput
              label={t("aiSupport.integrations.whatsapp.gateway.testPhone")}
              className="mt-2"
              inputMode="tel"
              dir="ltr"
              placeholder="01000000000"
              value={test.phone}
              onChange={(event) => setTest((current) => ({ ...current, phone: event.target.value }))}
            />
            <label className="mt-2 block">
              <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.integrations.whatsapp.gateway.testMessage")}</span>
              <textarea
                rows={3}
                dir="auto"
                value={test.message}
                onChange={(event) => setTest((current) => ({ ...current, message: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/40"
              />
            </label>
            <ActionButton
              tone="emerald"
              icon={Send}
              loading={busy === "test"}
              disabled={!test.phone.trim() || !test.message.trim()}
              onClick={runTest}
              className="mt-2"
            >
              {t("aiSupport.integrations.whatsapp.gateway.sendTest")}
            </ActionButton>
            {testResult ? (
              <p className={`mt-2 rounded-xl border p-2.5 text-[11px] font-bold ${testResult.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>
                {testResult.text}
              </p>
            ) : null}
          </div>
        </div>
      </PanelSection>

      <PanelSection
        icon={Phone}
        title={t("aiSupport.integrations.whatsapp.instances.title")}
        subtitle={t("aiSupport.integrations.whatsapp.instances.subtitle")}
        tone="slate"
      >
        <div className="grid gap-2">
          <FieldRow
            label={t("aiSupport.integrations.whatsapp.instances.defaultInstance")}
            value={gateway?.instanceName}
            fallback={t("aiSupport.integrations.whatsapp.gateway.instanceMissing")}
          />
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2">
              <div className="min-w-0">
                <div dir="auto" className="truncate text-sm font-black text-white">{clean(account.display_name) || account.external_account_id}</div>
                <div dir="ltr" className="truncate text-[11px] text-slate-500">{account.external_account_id}</div>
              </div>
              <ActionButton
                tone={account.is_active === false ? "ghost" : "emerald"}
                loading={busy === `toggle:${account.id}`}
                onClick={() => toggleInstance(account)}
              >
                {account.is_active === false
                  ? t("aiSupport.integrations.whatsapp.instances.inactive")
                  : t("aiSupport.integrations.whatsapp.instances.active")}
              </ActionButton>
            </div>
          ))}
          {!accounts.length ? (
            <p className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] leading-5 text-slate-500">
              {t("aiSupport.integrations.whatsapp.instances.empty")}
            </p>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <TextInput
            label={t("aiSupport.integrations.whatsapp.instances.name")}
            dir="ltr"
            placeholder="store-branch-2"
            value={newInstance.instance}
            onChange={(event) => setNewInstance((current) => ({ ...current, instance: event.target.value }))}
          />
          <TextInput
            label={t("aiSupport.integrations.whatsapp.instances.displayName")}
            dir="auto"
            value={newInstance.displayName}
            onChange={(event) => setNewInstance((current) => ({ ...current, displayName: event.target.value }))}
          />
        </div>
        <ActionButton
          tone="emerald"
          icon={Plus}
          loading={busy === "instance"}
          disabled={!newInstance.instance.trim()}
          onClick={addInstance}
          className="mt-2"
        >
          {t("aiSupport.integrations.whatsapp.instances.add")}
        </ActionButton>
        {instanceResult ? (
          <p className={`mt-2 rounded-xl border p-2.5 text-[11px] font-bold ${instanceResult.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>
            {instanceResult.text}
          </p>
        ) : null}
        <p className="mt-3 text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.whatsapp.instances.note")}</p>
      </PanelSection>
    </div>
  );
}

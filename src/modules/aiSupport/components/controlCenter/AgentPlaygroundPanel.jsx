// Try the agent before a customer does.
//
// Runs against POST /ai-agent/test-reply, which runs the SAME decision the WhatsApp, Messenger and
// Instagram webhooks run (brain V2 + the OpenAI grounded rewrite) on a `test:` conversation id — no
// customer is messaged, no order is drafted. The conversation is remembered per admin, so follow-ups
// ("مقاس 42") behave like a real chat; "new conversation" forgets it. The OpenAI card above it says
// whether replies are being worded by the model right now or falling back to templates, and why.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, PlayCircle, PlugZap, RotateCcw, ShieldCheck } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { resolveProductImageUrl } from "../../../../shared/lib/imageUrls";
import { PanelSection } from "../integrations/integrationsUi.jsx";
import { Field, SelectInput, TextArea } from "./controlCenterUi.jsx";

const CHANNELS = [
  { id: "facebook_messenger", platform: "facebook" },
  { id: "instagram", platform: "instagram" },
  { id: "whatsapp", platform: "whatsapp" },
];

const channelLabel = (t, id) => {
  if (id === "instagram") return t("aiSupport.integrations.nav.instagram", "Instagram");
  if (id === "whatsapp") return t("aiSupport.integrations.nav.whatsapp");
  return t("aiSupport.integrations.nav.meta");
};

const formatTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

// One reason code → one sentence the owner can act on.
const openAiReason = (t, status, probe) => {
  const code = probe && !probe.ok ? probe.reason : status?.text_generation_block_reason;
  if (code) return t(`aiSupport.controlCenter.playground.openaiReasons.${code}`, code);
  if (status && !status.openai_api_key_loaded) return t("aiSupport.controlCenter.playground.openaiReasons.missing_key");
  if (status && !status.text_generation_enabled) return t("aiSupport.controlCenter.playground.openaiReasons.ai_support_disabled");
  return "";
};

function OpenAiStatusCard({ headers }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await api.getOpenAiStatus({ headers });
      setStatus(payload?.status || null);
    } catch {
      setStatus(null);
    }
  }, [headers]);

  useEffect(() => {
    load();
  }, [load]);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      const payload = await api.probeOpenAi({ headers });
      setProbe(payload?.probe || null);
      if (payload?.probe?.runtime) setStatus(payload.probe.runtime);
    } catch (err) {
      setProbe({ ok: false, reason: "request_failed", message: err?.message });
    } finally {
      setProbing(false);
    }
  }, [headers]);

  const working = probe ? probe.ok : Boolean(status?.text_generation_enabled && !status?.text_generation_temporarily_blocked);
  const reason = working ? "" : openAiReason(t, status, probe);

  return (
    <PanelSection icon={PlugZap} title={t("aiSupport.controlCenter.playground.openaiTitle")}>
      <div className="grid gap-3">
        <div
          className={`rounded-2xl border p-3 text-sm font-black ${
            working ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100"
          }`}
        >
          {working ? t("aiSupport.controlCenter.playground.openaiOk") : t("aiSupport.controlCenter.playground.openaiOff")}
          {reason ? <div className="mt-1 text-xs font-bold leading-5 opacity-90">{reason}</div> : null}
        </div>
        <div className="grid gap-2 text-[11px] font-bold text-slate-300 sm:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            {t("aiSupport.controlCenter.playground.openaiModel")}: <b className="text-white">{probe?.model || status?.text_model || "—"}</b>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            {t("aiSupport.controlCenter.playground.openaiLastSuccess")}: <b className="text-white">{formatTime(status?.last_success_at)}</b>
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3">
            {t("aiSupport.controlCenter.playground.openaiLastError")}:{" "}
            <b className="text-white" dir="auto">
              {status?.last_error ? `${status.last_error.status || ""} ${status.last_error.code || ""}`.trim() || "—" : "—"}
            </b>
          </div>
        </div>
        <button
          type="button"
          onClick={runProbe}
          disabled={probing}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 text-xs font-black text-cyan-100 transition disabled:opacity-40"
        >
          {probing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
          {t("aiSupport.controlCenter.playground.openaiProbe")}
        </button>
      </div>
    </PanelSection>
  );
}

export default function AgentPlaygroundPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ channelId: "facebook_messenger", message: "", customerName: "" });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [resetNext, setResetNext] = useState(false);

  const run = useCallback(async () => {
    if (!String(form.message || "").trim()) return;
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const channel = CHANNELS.find((item) => item.id === form.channelId) || CHANNELS[0];
      const payload = await api.testAIReply(
        {
          tenant_id: tenantId,
          channelId: channel.id,
          platform: channel.platform,
          message: form.message,
          customer_name: form.customerName || undefined,
          reset: resetNext || undefined,
        },
        { headers }
      );
      setResetNext(false);
      setResult(payload?.result || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.playground.error"));
    } finally {
      setRunning(false);
    }
  }, [form, headers, resetNext, t, tenantId]);

  const startOver = useCallback(() => {
    setResetNext(true);
    setResult(null);
    setForm((current) => ({ ...current, message: "" }));
  }, []);

  return (
    <div className="space-y-4">
      <OpenAiStatusCard headers={headers} />

      <PanelSection
        icon={PlayCircle}
        title={t("aiSupport.controlCenter.playground.title")}
        subtitle={t("aiSupport.controlCenter.playground.subtitle")}
      >
        <div className="grid gap-4">
          <Field label={t("aiSupport.controlCenter.playground.channel")}>
            <SelectInput
              value={form.channelId}
              onChange={(event) => {
                setForm((current) => ({ ...current, channelId: event.target.value }));
                setResetNext(true);
              }}
            >
              {CHANNELS.map((channel) => (
                <option key={channel.id} value={channel.id}>{channelLabel(t, channel.id)}</option>
              ))}
            </SelectInput>
          </Field>
          <Field label={t("aiSupport.controlCenter.playground.message")}>
            <TextArea
              value={form.message}
              placeholder={t("aiSupport.controlCenter.playground.messagePlaceholder")}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
            />
          </Field>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <button
              type="button"
              onClick={run}
              disabled={running || !String(form.message || "").trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 transition disabled:opacity-40"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="h-4 w-4" aria-hidden="true" />}
              {t("aiSupport.controlCenter.playground.run")}
            </button>
            <button
              type="button"
              onClick={startOver}
              title={t("aiSupport.controlCenter.playground.resetHint")}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/40 px-4 text-xs font-black text-slate-200 transition"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("aiSupport.controlCenter.playground.reset")}
            </button>
          </div>
          <p className="flex items-start gap-2 rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.06] p-3 text-[11px] leading-5 text-emerald-100/80">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t("aiSupport.controlCenter.playground.safetyNote")}
          </p>
        </div>
      </PanelSection>

      {error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{error}</div>
      ) : null}

      {result ? (
        <PanelSection icon={ShieldCheck} title={t("aiSupport.controlCenter.playground.resultTitle")}>
          <div className="grid gap-3">
            <div dir="auto" className="whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm leading-6 text-white">
              {result.finalReply || t("aiSupport.controlCenter.playground.noReply")}
            </div>
            {Array.isArray(result.productCards) && result.productCards.length ? (
              <div className="grid gap-2">
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.controlCenter.playground.products")}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {result.productCards.map((card, index) => (
                    <div key={`${card.id}-${card.color}-${index}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-2">
                      {card.image_url ? <img src={resolveProductImageUrl(card.image_url)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" loading="lazy" /> : null}
                      <div className="min-w-0 text-[11px] font-bold text-slate-300">
                        <div dir="auto" className="truncate text-white">{card.name || "—"}</div>
                        <div dir="auto" className="truncate">{[card.color, card.price != null ? card.price : ""].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold text-slate-300">
                {t("aiSupport.controlCenter.playground.intent")}: <b className="text-white">{result.intent || "—"}</b>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold text-slate-300">
                {t("aiSupport.controlCenter.playground.mode")}: <b className="text-white">{result.effectiveMode || "—"}</b>
              </div>
              <div
                className={`rounded-xl border p-3 text-[11px] font-bold ${
                  result.rewriteApplied ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-slate-950/40 text-slate-300"
                }`}
              >
                {t("aiSupport.controlCenter.playground.rewrite")}:{" "}
                <b>{result.rewriteApplied ? t("aiSupport.controlCenter.playground.rewriteApplied") : t("aiSupport.controlCenter.playground.rewriteSkipped")}</b>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold text-slate-300">
                {t("aiSupport.controlCenter.playground.elapsed")}:{" "}
                <b className="text-white">
                  {Number.isFinite(Number(result.elapsedMs)) ? `${(Number(result.elapsedMs) / 1000).toFixed(1)} ${t("aiSupport.controlCenter.playground.seconds")}` : "—"}
                </b>
              </div>
              <div
                className={`rounded-xl border p-3 text-[11px] font-bold sm:col-span-2 ${
                  result.wouldSendAutomatically
                    ? "border-amber-300/25 bg-amber-400/10 text-amber-100"
                    : "border-white/10 bg-slate-950/40 text-slate-300"
                }`}
              >
                {t("aiSupport.controlCenter.playground.wouldSend")}:{" "}
                <b>{result.wouldSendAutomatically ? t("aiSupport.controlCenter.playground.yes") : t("aiSupport.controlCenter.playground.no")}</b>
              </div>
            </div>
          </div>
        </PanelSection>
      ) : null}
    </div>
  );
}

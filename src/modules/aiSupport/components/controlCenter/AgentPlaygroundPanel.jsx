// Try the agent before a customer does.
//
// Runs against POST /ai-agent/test-reply, which builds a reply on a `test:` conversation id — no
// customer is messaged, no order is drafted, nothing is logged to a real thread. What it shows that
// a live conversation cannot: the intent the agent read, the mode in force, whether the safety guard
// rewrote the answer, and whether this reply would have gone out on its own.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, PlayCircle, ShieldCheck } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { PanelSection } from "../integrations/integrationsUi.jsx";
import { Field, SelectInput, TextArea, TextInput } from "./controlCenterUi.jsx";

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

export default function AgentPlaygroundPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ channelId: "facebook_messenger", message: "", productId: "", customerName: "" });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

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
          productId: form.productId || undefined,
          customer_name: form.customerName || undefined,
        },
        { headers }
      );
      setResult(payload?.result || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.playground.error"));
    } finally {
      setRunning(false);
    }
  }, [form, headers, t, tenantId]);

  return (
    <div className="space-y-4">
      <PanelSection
        icon={PlayCircle}
        title={t("aiSupport.controlCenter.playground.title")}
        subtitle={t("aiSupport.controlCenter.playground.subtitle")}
      >
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("aiSupport.controlCenter.playground.channel")}>
              <SelectInput value={form.channelId} onChange={(event) => setForm((current) => ({ ...current, channelId: event.target.value }))}>
                {CHANNELS.map((channel) => (
                  <option key={channel.id} value={channel.id}>{channelLabel(t, channel.id)}</option>
                ))}
              </SelectInput>
            </Field>
            <Field label={t("aiSupport.controlCenter.playground.productId")} hint={t("aiSupport.controlCenter.playground.productIdHint")}>
              <TextInput
                inputMode="numeric"
                value={form.productId}
                onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value.replace(/\D/g, "") }))}
              />
            </Field>
          </div>
          <Field label={t("aiSupport.controlCenter.playground.message")}>
            <TextArea
              value={form.message}
              placeholder={t("aiSupport.controlCenter.playground.messagePlaceholder")}
              onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))}
            />
          </Field>
          <button
            type="button"
            onClick={run}
            disabled={running || !String(form.message || "").trim()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 transition disabled:opacity-40"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="h-4 w-4" aria-hidden="true" />}
            {t("aiSupport.controlCenter.playground.run")}
          </button>
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
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold text-slate-300">
                {t("aiSupport.controlCenter.playground.intent")}: <b className="text-white">{result.intent || "—"}</b>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold text-slate-300">
                {t("aiSupport.controlCenter.playground.mode")}: <b className="text-white">{result.effectiveMode || "—"}</b>
              </div>
              <div className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-[11px] font-bold text-slate-300">
                {t("aiSupport.controlCenter.playground.safety")}: <b className="text-white">{result.safetyReason || t("aiSupport.controlCenter.playground.safetyClean")}</b>
              </div>
              <div
                className={`rounded-xl border p-3 text-[11px] font-bold ${
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

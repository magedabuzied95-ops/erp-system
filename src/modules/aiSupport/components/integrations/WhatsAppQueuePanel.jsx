// The WhatsApp outbound queue dashboard.
//
// What the operator needs at a glance during and after an outage: is the session up, how much is
// waiting, how much of that is already too old to send, and when did the session last drop and
// come back. Then the six actions that let them do something about it.
//
// Painted in explicit slate/white-alpha like its sibling panels — the integrations center is a
// fixed dark surface and does not follow the light/dark token theme.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Ban, Clock, Gauge, Pause, Play, RefreshCw, RotateCcw, Send, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../../shared/api/api";
import {
  ActionButton,
  FieldRow,
  PanelSection,
  PanelSkeleton,
  StatusPill,
  TextInput,
  clean,
  formatDateTime,
} from "./integrationsUi.jsx";
import { queueViewModel, relativeAge } from "./whatsappQueueView.js";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500] };

function Stat({ label, value, tone = "text-white" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2.5">
      <div className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

export default function WhatsAppQueuePanel({ headers }) {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [test, setTest] = useState({ phone: "", message: "" });
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    setTest((current) => (current.message ? current : { ...current, message: t("aiSupport.integrations.whatsapp.testDefaultMessage") }));
  }, [t]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const result = await api.get("/whatsapp/queue", { headers, ...SUPPRESSED }).catch(() => null);
    if (!mountedRef.current) return;
    setData(result || null);
    setLoading(false);
  }, [headers]);

  useEffect(() => { void load(); }, [load]);

  // The backlog is the whole point of this panel and it moves on its own, so it refreshes itself.
  useEffect(() => {
    const timer = setInterval(() => { void load({ silent: true }); }, 20000);
    return () => clearInterval(timer);
  }, [load]);

  const act = useCallback(async (key, request, successKey) => {
    setBusy(key);
    try {
      const result = await request();
      toast.success(t(successKey, result || {}));
      await load({ silent: true });
      return result;
    } catch (error) {
      toast.error(clean(error?.response?.data?.message) || t("aiSupport.integrations.queue.actionFailed"));
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [load, t]);

  if (loading) return <PanelSkeleton rows={4} />;
  if (!data) {
    return (
      <PanelSection icon={Gauge} title={t("aiSupport.integrations.queue.title")} tone="rose">
        <p className="text-xs text-slate-300">{t("aiSupport.integrations.queue.unavailable")}</p>
        <ActionButton className="mt-3" icon={RefreshCw} onClick={() => load()}>{t("aiSupport.integrations.common.refresh")}</ActionButton>
      </PanelSection>
    );
  }

  const { queue = {} } = data;
  const view = queueViewModel(data);
  const { paused, forReview, backlog, rate, preview, throughput, oldest } = view;

  return (
    <div className="space-y-4">
      {/*
        The review banner. After a long outage this is the first thing the operator sees, and it
        carries the exact sentence they need before deciding: how many are waiting, and how many
        of those the settings already consider too old to send.
      */}
      {forReview ? (
        <PanelSection
          icon={AlertTriangle}
          tone="amber"
          title={t("aiSupport.integrations.queue.reviewTitle")}
          subtitle={t(`aiSupport.integrations.queue.reason.${view.pauseReason}`, { defaultValue: queue.pause_reason || "" })}
        >
          <p dir="auto" className="text-xs font-bold leading-6 text-amber-100">
            {t("aiSupport.integrations.queue.reviewSummary", { pending: preview.pending || 0, stale: preview.stale || 0 })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              tone="emerald"
              icon={Play}
              loading={busy === "resume"}
              onClick={() => act("resume", () => api.post("/whatsapp/queue/resume", { expire_stale: true }, { headers }), "aiSupport.integrations.queue.resumed")}
            >
              {t("aiSupport.integrations.queue.resumeAndExpire")}
            </ActionButton>
            <ActionButton
              tone="rose"
              icon={Ban}
              loading={busy === "cancel"}
              onClick={() => act("cancel", () => api.post("/whatsapp/queue/cancel-pending", {}, { headers }), "aiSupport.integrations.queue.cancelled")}
            >
              {t("aiSupport.integrations.queue.cancelAll")}
            </ActionButton>
          </div>
        </PanelSection>
      ) : null}

      <PanelSection
        icon={Gauge}
        title={t("aiSupport.integrations.queue.title")}
        subtitle={t("aiSupport.integrations.queue.subtitle")}
        action={(
          <>
            <StatusPill state={view.connected ? "connected" : "error"}>
              {view.connected ? t("aiSupport.integrations.state.connected") : t("aiSupport.integrations.state.off")}
            </StatusPill>
            <StatusPill state={paused ? (forReview ? "error" : "partial") : "connected"}>
              {t(`aiSupport.integrations.queue.state.${view.state}`)}
            </StatusPill>
            <ActionButton icon={RefreshCw} loading={busy === "refresh"} onClick={() => act("refresh", async () => ({}), "aiSupport.integrations.common.refreshed")}>
              {t("aiSupport.integrations.common.refresh")}
            </ActionButton>
          </>
        )}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {view.stats.map((stat) => (
            <Stat
              key={stat.status}
              label={t(`aiSupport.integrations.queue.status.${stat.status}`)}
              value={stat.value.toLocaleString()}
              tone={stat.tone}
            />
          ))}
          <Stat label={t("aiSupport.integrations.queue.backlog")} value={backlog.toLocaleString()} tone={view.backlogOverThreshold ? "text-rose-200" : "text-white"} />
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <FieldRow label={t("aiSupport.integrations.queue.lastHour")} value={Number(throughput.last_hour || 0).toLocaleString()} />
          <FieldRow label={t("aiSupport.integrations.queue.last24h")} value={Number(throughput.last_24h || 0).toLocaleString()} />
          <FieldRow
            label={t("aiSupport.integrations.queue.oldestPending")}
            value={oldest ? `${relativeAge(oldest.created_at, t)} · ${formatDateTime(oldest.created_at)}` : "—"}
          />
          <FieldRow label={t("aiSupport.integrations.queue.lastDrain")} value={formatDateTime(queue.last_drain_at)} />
          <FieldRow label={t("aiSupport.integrations.queue.lastDisconnect")} value={formatDateTime(queue.last_disconnected_at)} />
          <FieldRow label={t("aiSupport.integrations.queue.lastReconnect")} value={formatDateTime(queue.last_connected_at)} />
        </div>

        {/*
          The pacing actually in force, so nobody has to guess what the worker is doing.
          Rendered as strings: FieldRow falls back to "—" on any falsy value, and 0 is a real
          setting here — it is how the operator switches a brake off, not a missing number.
        */}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <FieldRow label={t("aiSupport.integrations.queue.ratePerMinute")} value={String(rate.messages_per_minute ?? "")} />
          <FieldRow label={t("aiSupport.integrations.queue.batchSize")} value={String(rate.batch_size ?? "")} />
          <FieldRow label={t("aiSupport.integrations.queue.delayRange")} value={`${rate.min_delay_seconds ?? "—"} – ${rate.max_delay_seconds ?? "—"}s`} />
          <FieldRow
            label={t("aiSupport.integrations.queue.pauseThreshold")}
            value={view.thresholdDisabled ? t("aiSupport.integrations.queue.thresholdOff") : String(rate.pending_pause_threshold ?? "")}
          />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">{t("aiSupport.integrations.queue.settingsHint")}</p>
      </PanelSection>

      <PanelSection icon={Clock} title={t("aiSupport.integrations.queue.actionsTitle")} subtitle={t("aiSupport.integrations.queue.actionsSubtitle")}>
        <div className="flex flex-wrap gap-2">
          {paused ? (
            <ActionButton
              tone="emerald"
              icon={Play}
              loading={busy === "resume"}
              onClick={() => act("resume", () => api.post("/whatsapp/queue/resume", { expire_stale: true }, { headers }), "aiSupport.integrations.queue.resumed")}
            >
              {t("aiSupport.integrations.queue.resume")}
            </ActionButton>
          ) : (
            <ActionButton
              tone="amber"
              icon={Pause}
              loading={busy === "pause"}
              onClick={() => act("pause", () => api.post("/whatsapp/queue/pause", { reason: "manual" }, { headers }), "aiSupport.integrations.queue.paused")}
            >
              {t("aiSupport.integrations.queue.pause")}
            </ActionButton>
          )}
          <ActionButton
            icon={Trash2}
            loading={busy === "expire"}
            onClick={() => act("expire", () => api.post("/whatsapp/queue/expire-stale", {}, { headers }), "aiSupport.integrations.queue.expired")}
          >
            {t("aiSupport.integrations.queue.expireStale")}
          </ActionButton>
          <ActionButton
            icon={RotateCcw}
            loading={busy === "retry"}
            onClick={() => act("retry", () => api.post("/whatsapp/queue/retry-failed", {}, { headers }), "aiSupport.integrations.queue.retried")}
          >
            {t("aiSupport.integrations.queue.retryFailed")}
          </ActionButton>
          <ActionButton
            tone="rose"
            icon={Ban}
            loading={busy === "cancel"}
            onClick={() => act("cancel", () => api.post("/whatsapp/queue/cancel-pending", {}, { headers }), "aiSupport.integrations.queue.cancelled")}
          >
            {t("aiSupport.integrations.queue.cancelPending")}
          </ActionButton>
          <ActionButton
            icon={Gauge}
            loading={busy === "drain"}
            onClick={() => act("drain", () => api.post("/whatsapp/queue/drain", {}, { headers }), "aiSupport.integrations.queue.drained")}
          >
            {t("aiSupport.integrations.queue.drainNow")}
          </ActionButton>
        </div>
      </PanelSection>

      <PanelSection icon={Send} title={t("aiSupport.integrations.queue.testTitle")} subtitle={t("aiSupport.integrations.queue.testSubtitle")}>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextInput
            label={t("aiSupport.integrations.queue.testPhone")}
            dir="ltr"
            value={test.phone}
            onChange={(event) => setTest((current) => ({ ...current, phone: event.target.value }))}
            placeholder="201000000000"
          />
          <TextInput
            label={t("aiSupport.integrations.queue.testMessage")}
            dir="auto"
            value={test.message}
            onChange={(event) => setTest((current) => ({ ...current, message: event.target.value }))}
          />
        </div>
        <ActionButton
          className="mt-3"
          tone="primary"
          icon={Send}
          loading={busy === "test"}
          disabled={!clean(test.phone) || !clean(test.message)}
          onClick={() => act("test", () => api.post("/whatsapp/queue/test-send", { phone: test.phone, message: test.message }, { headers }), "aiSupport.integrations.whatsapp.testSent")}
        >
          {t("aiSupport.integrations.queue.sendTest")}
        </ActionButton>
      </PanelSection>
    </div>
  );
}

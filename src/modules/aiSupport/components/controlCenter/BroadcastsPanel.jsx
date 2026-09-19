// Campaigns: one message to many customers.
//
// The panel makes the guardrails visible instead of burying them, because this is the only screen in
// the inbox where one click reaches hundreds of people at once:
//   • the audience count is previewed, with a few names, BEFORE anything can be sent;
//   • opted-out customers are excluded by the server and cannot be filtered back in;
//   • quiet hours (22:00–09:00 Cairo) are shown when they are active, with the time it would go out;
//   • every campaign has a stop button that cancels whatever has not left the queue yet.
//
// Sending is additionally gated server-side by MARKETING_BROADCASTS_ENABLED, which ships OFF; until
// the owner turns it on, this panel builds and previews campaigns but the send is refused.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Megaphone, MoonStar, Send, Square, Users } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSection, PanelSkeleton } from "../integrations/integrationsUi.jsx";
import { Field, SelectInput, TextArea, TextInput } from "./controlCenterUi.jsx";

const EMPTY_AUDIENCE = { min_orders: "", min_spent: "", loyalty_tier: "all", bought_within_days: "", quiet_for_days: "" };

const numericAudience = (audience) => ({
  min_orders: Number(audience.min_orders) || 0,
  min_spent: Number(audience.min_spent) || 0,
  loyalty_tier: audience.loyalty_tier || "all",
  bought_within_days: Number(audience.bought_within_days) || 0,
  quiet_for_days: Number(audience.quiet_for_days) || 0,
});

export default function BroadcastsPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [form, setForm] = useState({ name: "", message_body: "", frequency_cap_days: 7, audience: EMPTY_AUDIENCE });
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statusPayload, listPayload] = await Promise.all([
        api.get("/marketing/broadcasts/status", { params: { tenant_id: tenantId }, headers }),
        api.get("/marketing/broadcasts", { params: { tenant_id: tenantId }, headers }),
      ]);
      setStatus(statusPayload || null);
      setBroadcasts(Array.isArray(listPayload?.broadcasts) ? listPayload.broadcasts : []);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The audience is re-counted on demand, never silently: the number on screen must be the number
  // the owner asked for, not a stale one from two filter changes ago.
  const runPreview = useCallback(async () => {
    setBusy("preview");
    setError("");
    setPreview(null);
    try {
      const payload = await api.post(
        "/marketing/broadcasts/audience/preview",
        { tenant_id: tenantId, audience: numericAudience(form.audience), frequency_cap_days: form.frequency_cap_days },
        { headers }
      );
      setPreview(payload || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.broadcasts.previewError"));
    } finally {
      setBusy("");
    }
  }, [form, headers, t, tenantId]);

  const createAndSend = useCallback(async () => {
    if (!preview || !Number(preview.total)) return;
    const confirmed = window.confirm(
      t("aiSupport.controlCenter.broadcasts.confirmSend", { count: Number(preview.total) })
    );
    if (!confirmed) return;
    setBusy("send");
    setError("");
    setMessage("");
    try {
      const created = await api.post(
        "/marketing/broadcasts",
        {
          tenant_id: tenantId,
          name: form.name,
          message_body: form.message_body,
          audience: numericAudience(form.audience),
          frequency_cap_days: form.frequency_cap_days,
        },
        { headers }
      );
      const id = created?.broadcast?.id;
      if (!id) throw new Error(t("aiSupport.controlCenter.broadcasts.createError"));
      const sent = await api.post(`/marketing/broadcasts/${id}/send`, { tenant_id: tenantId }, { headers });
      setMessage(
        sent?.deferred_to_morning
          ? t("aiSupport.controlCenter.broadcasts.queuedForMorning", { count: sent.queued || 0 })
          : t("aiSupport.controlCenter.broadcasts.queued", { count: sent?.queued || 0 })
      );
      setForm({ name: "", message_body: "", frequency_cap_days: 7, audience: EMPTY_AUDIENCE });
      setPreview(null);
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.broadcasts.sendError"));
    } finally {
      setBusy("");
    }
  }, [form, headers, load, preview, t, tenantId]);

  const stop = useCallback(async (id) => {
    if (!window.confirm(t("aiSupport.controlCenter.broadcasts.confirmStop"))) return;
    setBusy(`stop-${id}`);
    try {
      const result = await api.post(`/marketing/broadcasts/${id}/stop`, { tenant_id: tenantId }, { headers });
      setMessage(t("aiSupport.controlCenter.broadcasts.stopped", { count: result?.cancelled || 0 }));
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.broadcasts.stopError"));
    } finally {
      setBusy("");
    }
  }, [headers, load, t, tenantId]);

  const patchAudience = (updates) => {
    setForm((current) => ({ ...current, audience: { ...current.audience, ...updates } }));
    setPreview(null);
  };

  const canSend = useMemo(
    () => Boolean(status?.enabled) && Boolean(preview?.total) && String(form.message_body || "").trim().length > 0,
    [form.message_body, preview, status]
  );

  if (loading) return <PanelSkeleton rows={4} />;

  return (
    <div className="space-y-4">
      {!status?.enabled ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-300/25 bg-amber-400/10 p-3 text-[11px] font-bold leading-5 text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("aiSupport.controlCenter.broadcasts.disabledNote")}
        </div>
      ) : null}

      {status?.quiet_hours_active ? (
        <div className="flex items-start gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.07] p-3 text-[11px] font-bold leading-5 text-cyan-100">
          <MoonStar className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t("aiSupport.controlCenter.broadcasts.quietHours")}
        </div>
      ) : null}

      <PanelSection
        icon={Megaphone}
        title={t("aiSupport.controlCenter.broadcasts.newTitle")}
        subtitle={t("aiSupport.controlCenter.broadcasts.newSubtitle")}
      >
        <div className="grid gap-4">
          <Field label={t("aiSupport.controlCenter.broadcasts.name")}>
            <TextInput value={form.name} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} />
          </Field>
          <Field label={t("aiSupport.controlCenter.broadcasts.message")} hint={t("aiSupport.controlCenter.broadcasts.messageHint")}>
            <TextArea
              value={form.message_body}
              maxLength={900}
              placeholder={t("aiSupport.controlCenter.broadcasts.messagePlaceholder")}
              onChange={(event) => setForm((c) => ({ ...c, message_body: event.target.value }))}
            />
          </Field>

          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t("aiSupport.controlCenter.broadcasts.audience")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aiSupport.controlCenter.broadcasts.minOrders")}>
                <TextInput
                  inputMode="numeric"
                  value={form.audience.min_orders}
                  onChange={(event) => patchAudience({ min_orders: event.target.value.replace(/\D/g, "") })}
                />
              </Field>
              <Field label={t("aiSupport.controlCenter.broadcasts.minSpent")}>
                <TextInput
                  inputMode="numeric"
                  value={form.audience.min_spent}
                  onChange={(event) => patchAudience({ min_spent: event.target.value.replace(/\D/g, "") })}
                />
              </Field>
              <Field label={t("aiSupport.controlCenter.broadcasts.boughtWithin")} hint={t("aiSupport.controlCenter.broadcasts.daysHint")}>
                <TextInput
                  inputMode="numeric"
                  value={form.audience.bought_within_days}
                  onChange={(event) => patchAudience({ bought_within_days: event.target.value.replace(/\D/g, "") })}
                />
              </Field>
              <Field label={t("aiSupport.controlCenter.broadcasts.quietFor")} hint={t("aiSupport.controlCenter.broadcasts.daysHint")}>
                <TextInput
                  inputMode="numeric"
                  value={form.audience.quiet_for_days}
                  onChange={(event) => patchAudience({ quiet_for_days: event.target.value.replace(/\D/g, "") })}
                />
              </Field>
              <Field label={t("aiSupport.controlCenter.broadcasts.frequencyCap")} hint={t("aiSupport.controlCenter.broadcasts.frequencyCapHint")}>
                <SelectInput
                  value={String(form.frequency_cap_days)}
                  onChange={(event) => {
                    setForm((c) => ({ ...c, frequency_cap_days: Number(event.target.value) }));
                    setPreview(null);
                  }}
                >
                  <option value="7">7</option>
                  <option value="14">14</option>
                  <option value="30">30</option>
                </SelectInput>
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton tone="ghost" icon={Users} loading={busy === "preview"} onClick={runPreview}>
              {t("aiSupport.controlCenter.broadcasts.countThem")}
            </ActionButton>
            {preview ? (
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-black text-cyan-100">
                {t("aiSupport.controlCenter.broadcasts.audienceCount", { count: Number(preview.total) || 0 })}
                {preview.sample?.length ? ` — ${preview.sample.map((row) => row.name).filter(Boolean).join("، ")}` : ""}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={createAndSend}
            disabled={!canSend || busy === "send"}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-xs font-black text-slate-950 transition disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {t("aiSupport.controlCenter.broadcasts.send")}
          </button>

          {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{error}</div> : null}
          {message ? <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-bold text-emerald-100">{message}</div> : null}
        </div>
      </PanelSection>

      <PanelSection icon={Megaphone} title={t("aiSupport.controlCenter.broadcasts.historyTitle")}>
        {broadcasts.length ? (
          <div className="grid gap-2">
            {broadcasts.map((broadcast) => (
              <div key={broadcast.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/40 p-3">
                <div className="min-w-0 flex-1">
                  <div dir="auto" className="truncate text-sm font-black text-white">{broadcast.name || `#${broadcast.id}`}</div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {t("aiSupport.controlCenter.broadcasts.rowSummary", {
                      queued: broadcast.recipients_queued || 0,
                      skipped: broadcast.recipients_skipped || 0,
                    })}
                  </div>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-black text-slate-200">
                  {broadcast.status}
                </span>
                {broadcast.status === "sending" ? (
                  <button
                    type="button"
                    onClick={() => stop(broadcast.id)}
                    disabled={busy === `stop-${broadcast.id}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 text-[11px] font-black text-rose-100 disabled:opacity-40"
                  >
                    <Square className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("aiSupport.controlCenter.broadcasts.stop")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-500">
            {t("aiSupport.controlCenter.broadcasts.empty")}
          </div>
        )}
      </PanelSection>

      <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
        {t("aiSupport.controlCenter.broadcasts.note")}
      </p>
    </div>
  );
}

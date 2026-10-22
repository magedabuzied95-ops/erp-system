// Campaigns: one message to many customers — a list like Genie's (name, status, group, template,
// scheduled at, last run, sent/failed) and an editor.
//
// A campaign is either:
//   • Template (official WhatsApp) — an APPROVED Cloud API template, its {{n}} variables mapped to
//     the customer's name / phone / fixed text, sent through the official number; or
//   • Text (WhatsApp Web) — the original plain-text broadcast with {{customer_name}}, paced by the
//     WhatsApp queue.
// Either can go now or at a scheduled time (entered and shown on the Cairo clock, stored as UTC).
//
// The guardrails stay visible, because one click here reaches hundreds of people:
//   • the audience count is previewed, with a few names, BEFORE "send now" is possible;
//   • opted-out customers are excluded by the server and cannot be filtered back in;
//   • quiet hours (22:00–09:00 Cairo) are shown when they are active;
//   • a running campaign has a stop button, a scheduled one a cancel button.
//
// Sending and scheduling are gated server-side by MARKETING_BROADCASTS_ENABLED, which ships OFF.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CalendarClock, ListChecks, Megaphone, MoonStar, Pencil, Plus, Save, Send, Square, Users, X } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { formatInAppTimezone, instantToWallClock, wallClockToInstant } from "../../../../shared/lib/appTimezone";
import { ActionButton, PanelSkeleton, TextInput, clean } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502] };
const TAG_SPLIT = /[,،\n]/;

const EMPTY_AUDIENCE = { min_orders: "", min_spent: "", loyalty_tier: "all", bought_within_days: "", quiet_for_days: "", tags: "" };
const EMPTY_FORM = Object.freeze({
  id: null,
  name: "",
  channel_mode: "template",
  template_id: "",
  template_variables: [],
  message_body: "",
  group_name: "",
  frequency_cap_days: 7,
  audience: EMPTY_AUDIENCE,
  when: "now",
  scheduled_local: "",
  // Replies (GENI's Chatbot Flow / AI Workflow / Auto Lead Generation).
  chatbot_flow_id: "",
  ai_instructions: "",
  auto_lead_generation: true,
});

const numericAudience = (audience) => ({
  min_orders: Number(audience.min_orders) || 0,
  min_spent: Number(audience.min_spent) || 0,
  loyalty_tier: audience.loyalty_tier || "all",
  bought_within_days: Number(audience.bought_within_days) || 0,
  quiet_for_days: Number(audience.quiet_for_days) || 0,
  tags: String(audience.tags || "").split(TAG_SPLIT).map((item) => item.trim()).filter(Boolean),
});

// The group is merged into the tags server-side; strip it here so the tags line shows only extras.
const formFromBroadcast = (row) => {
  const audience = row.audience || {};
  const tags = (Array.isArray(audience.tags) ? audience.tags : []).filter((tag) => tag !== row.group_name);
  return {
    ...EMPTY_FORM,
    id: row.id,
    name: row.name || "",
    channel_mode: row.channel_mode === "template" ? "template" : "text",
    template_id: row.template_id ? String(row.template_id) : "",
    template_variables: Array.isArray(row.template_variables) ? row.template_variables : [],
    message_body: row.channel_mode === "template" ? "" : row.message_body || "",
    group_name: row.group_name || "",
    frequency_cap_days: Number(row.frequency_cap_days) || 7,
    audience: {
      min_orders: audience.min_orders ? String(audience.min_orders) : "",
      min_spent: audience.min_spent ? String(audience.min_spent) : "",
      loyalty_tier: audience.loyalty_tier || "all",
      bought_within_days: audience.bought_within_days ? String(audience.bought_within_days) : "",
      quiet_for_days: audience.quiet_for_days ? String(audience.quiet_for_days) : "",
      tags: tags.join(", "),
    },
    when: row.status === "scheduled" ? "schedule" : "now",
    scheduled_local: row.scheduled_at ? instantToWallClock(row.scheduled_at) : "",
    chatbot_flow_id: row.chatbot_flow_id ? String(row.chatbot_flow_id) : "",
    ai_instructions: row.ai_instructions || "",
    auto_lead_generation: row.auto_lead_generation !== false,
  };
};

const fillBody = (body = "", values = []) =>
  String(body).replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, index) => clean(values[Number(index) - 1]) || whole);

const STATUS_TONE = {
  draft: "border-white/10 bg-white/[0.06] text-slate-200",
  scheduled: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100",
  sending: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  completed: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  stopped: "border-orange-300/25 bg-orange-400/10 text-orange-100",
  failed: "border-rose-300/25 bg-rose-400/10 text-rose-100",
};

// Literal keys so a missing translation stays greppable.
const statusLabel = (t, status) => {
  if (status === "scheduled") return t("aiSupport.campaigns.status.scheduled");
  if (status === "sending") return t("aiSupport.campaigns.status.sending");
  if (status === "completed") return t("aiSupport.campaigns.status.completed");
  if (status === "stopped") return t("aiSupport.campaigns.status.stopped");
  if (status === "failed") return t("aiSupport.campaigns.status.failed");
  return t("aiSupport.campaigns.status.draft");
};
const sourceLabel = (t, source) => {
  if (source === "customer_name") return t("aiSupport.campaigns.variables.customerName");
  if (source === "customer_phone") return t("aiSupport.campaigns.variables.customerPhone");
  return t("aiSupport.campaigns.variables.static");
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  return (
    <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full border px-2.5 text-[10.5px] font-black ${STATUS_TONE[status] || STATUS_TONE.draft}`}>
      {statusLabel(t, status)}
    </span>
  );
}

function Field({ label, hint, children, className = "" }) {
  return (
    <div className={`block ${className}`}>
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{hint}</span> : null}
    </div>
  );
}

const textareaClass =
  "w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm font-bold leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/40 disabled:opacity-60";
const selectTrigger = "h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white";
const chipClass = (active) =>
  `h-8 rounded-full border px-3 text-[11px] font-black transition ${active ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`;

// WhatsApp's own colours, inline: the M1 theme remaps Tailwind's white/slate utilities.
const WA = { chat: "#efe7dd", bubble: "#ffffff", ink: "#111b21", muted: "#667781" };
function MessagePreview({ header = "", body = "", footer = "" }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-white/10 p-3" style={{ background: WA.chat }}>
      <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: WA.muted }}>
        {t("aiSupport.campaigns.preview")}
      </div>
      <div className="max-w-[320px] rounded-xl px-3 py-2 text-[13px] leading-6 shadow-sm" style={{ background: WA.bubble, color: WA.ink }}>
        {header ? <div dir="auto" className="mb-1 font-bold">{header}</div> : null}
        <div dir="auto" className="whitespace-pre-wrap">{body || "—"}</div>
        {footer ? <div dir="auto" className="mt-1 text-[11px]" style={{ color: WA.muted }}>{footer}</div> : null}
      </div>
    </div>
  );
}

// The Meta review account only ever runs template campaigns on the official number, so the
// WhatsApp Web text type is not offered (or named) there.
export default function BroadcastsPanel({ headers, tenantId, reviewerMode = false }) {
  const { t, i18n } = useTranslation();
  const locale = String(i18n?.language || "ar").startsWith("ar") ? "ar-EG" : "en-GB";
  const formatWhen = useCallback(
    (value) => (value ? formatInAppTimezone(value, { dateStyle: "medium", timeStyle: "short" }, locale) || "—" : "—"),
    [locale]
  );

  const [status, setStatus] = useState(null);
  const [broadcasts, setBroadcasts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [groups, setGroups] = useState([]);
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState(null); // null = the list
  const [preview, setPreview] = useState(null);
  const [showFilters, setShowFilters] = useState(false);
  const [log, setLog] = useState(null); // { id, rows }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statusPayload, listPayload, templatesPayload] = await Promise.all([
        api.get("/marketing/broadcasts/status", { params: { tenant_id: tenantId }, headers }),
        api.get("/marketing/broadcasts", { params: { tenant_id: tenantId, limit: 100 }, headers }),
        api.get("/marketing/broadcasts/templates/approved", { params: { tenant_id: tenantId }, headers, ...SUPPRESSED }).catch(() => null),
      ]);
      setStatus(statusPayload || null);
      setBroadcasts(Array.isArray(listPayload?.broadcasts) ? listPayload.broadcasts : []);
      setTemplates(Array.isArray(templatesPayload?.templates) ? templatesPayload.templates : []);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Customer groups (Config → Groups) are tags; a campaign targets one group.
  useEffect(() => {
    api.get("/inbox-config/org/groups", { headers, suppressErrorStatuses: [403, 404, 500, 502] })
      .then((payload) => setGroups(Array.isArray(payload?.groups) ? payload.groups : []))
      .catch(() => setGroups([]));
  }, [headers]);

  // The official number's chatbot flows, for "a flow answers replies to this campaign".
  useEffect(() => {
    api.get("/whatsapp-official/flows", { headers, suppressErrorStatuses: [403, 404, 500, 502] })
      .then((payload) => setFlows(Array.isArray(payload?.flows) ? payload.flows : []))
      .catch(() => setFlows([]));
  }, [headers]);

  const patch = (updates) => {
    setForm((current) => ({ ...current, ...updates }));
  };
  const patchAudience = (updates) => {
    setForm((current) => ({ ...current, audience: { ...current.audience, ...updates } }));
    setPreview(null);
  };

  const selectedTemplate = useMemo(
    () => (form ? templates.find((item) => String(item.id) === String(form.template_id)) || null : null),
    [form, templates]
  );
  const variableCount = Number(selectedTemplate?.variable_count) || 0;
  const variables = useMemo(
    () => Array.from({ length: variableCount }, (_, index) => form?.template_variables?.[index] || { source: index === 0 ? "customer_name" : "static", value: "" }),
    [form, variableCount]
  );
  const sampleName = preview?.sample?.[0]?.name || t("aiSupport.campaigns.variables.sampleName");
  const previewValues = variables.map((item, index) => {
    if (item.source === "customer_name") return sampleName;
    if (item.source === "customer_phone") return "01000000000";
    return clean(item.value) || clean(selectedTemplate?.body_examples?.[index]);
  });

  const setVariable = (index, changes) => {
    const next = variables.map((item, i) => (i === index ? { ...item, ...changes } : item));
    patch({ template_variables: next });
  };

  const extraTags = String(form?.audience?.tags || "").split(TAG_SPLIT).map((item) => item.trim()).filter(Boolean);

  const runPreview = useCallback(async () => {
    if (!form) return;
    setBusy("preview");
    setError("");
    setPreview(null);
    try {
      const audience = numericAudience(form.audience);
      if (form.group_name && !audience.tags.includes(form.group_name)) audience.tags.push(form.group_name);
      const payload = await api.post(
        "/marketing/broadcasts/audience/preview",
        { tenant_id: tenantId, audience, frequency_cap_days: form.frequency_cap_days },
        { headers }
      );
      setPreview(payload || null);
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.broadcasts.previewError"));
    } finally {
      setBusy("");
    }
  }, [form, headers, t, tenantId]);

  const payloadOf = (current) => ({
    tenant_id: tenantId,
    name: current.name,
    channel_mode: current.channel_mode,
    template_id: current.channel_mode === "template" ? Number(current.template_id) || null : null,
    template_variables: current.channel_mode === "template" ? variables : [],
    message_body: current.channel_mode === "text" ? current.message_body : "",
    group_name: current.group_name,
    audience: numericAudience(current.audience),
    frequency_cap_days: current.frequency_cap_days,
    chatbot_flow_id: current.channel_mode === "template" ? Number(current.chatbot_flow_id) || null : null,
    ai_instructions: current.ai_instructions,
    auto_lead_generation: current.auto_lead_generation !== false,
  });

  const formError = useMemo(() => {
    if (!form) return "";
    if (!clean(form.name)) return t("aiSupport.campaigns.errors.nameRequired");
    if (form.channel_mode === "template" && !selectedTemplate) return t("aiSupport.campaigns.errors.templateRequired");
    if (form.channel_mode === "template" && selectedTemplate?.header_media_missing) return t("aiSupport.campaigns.errors.headerMediaMissing");
    if (form.channel_mode === "text" && !clean(form.message_body)) return t("aiSupport.campaigns.errors.messageRequired");
    if (form.channel_mode === "template" && variables.some((item) => item.source === "static" && !clean(item.value))) {
      return t("aiSupport.campaigns.errors.variableRequired");
    }
    if (form.when === "schedule" && !wallClockToInstant(form.scheduled_local)) return t("aiSupport.campaigns.errors.scheduleRequired");
    return "";
  }, [form, selectedTemplate, t, variables]);

  // Save (create or update) and then optionally schedule or send.
  const submit = useCallback(async (action) => {
    if (!form || formError) return;
    if (action === "send") {
      if (!preview || !Number(preview.total)) {
        setError(t("aiSupport.campaigns.errors.countFirst"));
        return;
      }
      if (!window.confirm(t("aiSupport.controlCenter.broadcasts.confirmSend", { count: Number(preview.total) }))) return;
    }
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const body = payloadOf(form);
      const saved = form.id
        ? await api.put(`/marketing/broadcasts/${form.id}`, body, { headers })
        : await api.post("/marketing/broadcasts", body, { headers });
      const id = saved?.broadcast?.id;
      if (!id) throw new Error(t("aiSupport.controlCenter.broadcasts.createError"));
      if (action === "schedule") {
        await api.post(`/marketing/broadcasts/${id}/schedule`, { tenant_id: tenantId, scheduled_at: wallClockToInstant(form.scheduled_local) }, { headers });
        setMessage(t("aiSupport.campaigns.scheduledNotice", { when: formatWhen(wallClockToInstant(form.scheduled_local)) }));
      } else if (action === "send") {
        const sent = await api.post(`/marketing/broadcasts/${id}/send`, { tenant_id: tenantId }, { headers });
        setMessage(
          sent?.deferred_to_morning
            ? t("aiSupport.controlCenter.broadcasts.queuedForMorning", { count: sent?.queued || 0 })
            : t("aiSupport.controlCenter.broadcasts.queued", { count: sent?.queued || 0 })
        );
      } else {
        setMessage(t("aiSupport.campaigns.savedNotice"));
      }
      setForm(null);
      setPreview(null);
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.broadcasts.sendError"));
    } finally {
      setBusy("");
    }
    // payloadOf reads `variables`, which is derived from form + template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, formError, formatWhen, headers, load, preview, t, tenantId, variables]);

  const rowAction = useCallback(async (row, action) => {
    if (action === "stop" && !window.confirm(t("aiSupport.controlCenter.broadcasts.confirmStop"))) return;
    if (action === "send" && !window.confirm(t("aiSupport.campaigns.confirmSendNow"))) return;
    setBusy(`${action}-${row.id}`);
    setError("");
    setMessage("");
    try {
      if (action === "stop") {
        const result = await api.post(`/marketing/broadcasts/${row.id}/stop`, { tenant_id: tenantId }, { headers });
        setMessage(t("aiSupport.controlCenter.broadcasts.stopped", { count: result?.cancelled || 0 }));
      } else if (action === "cancel-schedule") {
        await api.post(`/marketing/broadcasts/${row.id}/cancel-schedule`, { tenant_id: tenantId }, { headers });
        setMessage(t("aiSupport.campaigns.scheduleCancelled"));
      } else if (action === "send") {
        const sent = await api.post(`/marketing/broadcasts/${row.id}/send`, { tenant_id: tenantId }, { headers });
        setMessage(
          sent?.deferred_to_morning
            ? t("aiSupport.controlCenter.broadcasts.queuedForMorning", { count: sent?.queued || 0 })
            : t("aiSupport.controlCenter.broadcasts.queued", { count: sent?.queued || 0 })
        );
      } else if (action === "log") {
        if (log?.id === row.id) {
          setLog(null);
        } else {
          const payload = await api.get(`/marketing/broadcasts/${row.id}/recipients`, { params: { tenant_id: tenantId }, headers });
          setLog({ id: row.id, rows: Array.isArray(payload?.recipients) ? payload.recipients : [] });
        }
        return;
      }
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.broadcasts.sendError"));
    } finally {
      setBusy("");
    }
  }, [headers, load, log, t, tenantId]);

  if (loading) return <PanelSkeleton rows={4} />;

  const notices = (
    <>
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
      {error ? <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-xs font-bold text-rose-100">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs font-bold text-emerald-100">{message}</div> : null}
    </>
  );

  /* ------------------------------------------------------------------ list */
  if (!form) {
    return (
      <div className="space-y-3">
        {notices}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-slate-400">{t("aiSupport.campaigns.count", { count: broadcasts.length })}</span>
          <ActionButton tone="primary" icon={Plus} className="ms-auto" onClick={() => { setError(""); setMessage(""); setPreview(null); setForm({ ...EMPTY_FORM, channel_mode: templates.length || reviewerMode ? "template" : "text" }); }}>
            {t("aiSupport.campaigns.new")}
          </ActionButton>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[860px] text-start text-xs">
            <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.name")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.status")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.group")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.template")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.scheduledAt")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.lastRun")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.campaigns.columns.results")}</th>
                <th className="px-3 py-2 text-end" aria-label={t("aiSupport.campaigns.columns.actions")} />
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((row) => {
                const isTemplate = row.channel_mode === "template";
                const sent = isTemplate ? Number(row.recipients_sent || row.sent_count) || 0 : Number(row.recipients_queued) || 0;
                const failed = isTemplate ? Number(row.recipients_failed || row.failed_count) || 0 : 0;
                const skipped = Number(row.recipients_skipped) || 0;
                const editable = ["draft", "scheduled"].includes(row.status);
                return (
                  <Fragment key={row.id}>
                    <tr className="border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                      <td className="px-3 py-2.5">
                        <div dir="auto" className="max-w-[220px] truncate font-black text-white">{row.name || `#${row.id}`}</div>
                        <div className="text-[10.5px] text-slate-500">
                          {isTemplate || reviewerMode ? t("aiSupport.campaigns.type.template") : t("aiSupport.campaigns.type.text")}
                        </div>
                        {row.last_error ? <div dir="auto" className="max-w-[220px] truncate text-[10.5px] text-rose-200" title={row.last_error}>{row.last_error}</div> : null}
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={row.status} /></td>
                      <td className="px-3 py-2.5" dir="auto">{row.group_name || "—"}</td>
                      <td className="px-3 py-2.5" dir="ltr">{isTemplate ? (row.template_name || `#${row.template_id}`) : "—"}</td>
                      <td className="px-3 py-2.5 text-slate-400">{formatWhen(row.scheduled_at)}</td>
                      <td className="px-3 py-2.5 text-slate-400">{formatWhen(row.last_run_at || row.started_at)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="font-black text-emerald-200">{t("aiSupport.campaigns.sentCount", { count: sent })}</span>
                        {failed ? <span className="ms-2 font-black text-rose-200">{t("aiSupport.campaigns.failedCount", { count: failed })}</span> : null}
                        {skipped ? <span className="ms-2 text-slate-500">{t("aiSupport.campaigns.skippedCount", { count: skipped })}</span> : null}
                        {isTemplate && Number(row.pending_count) ? <span className="ms-2 text-amber-200">{t("aiSupport.campaigns.pendingCount", { count: Number(row.pending_count) })}</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {editable ? (
                            <ActionButton icon={Pencil} onClick={() => { setError(""); setMessage(""); setPreview(null); setForm(formFromBroadcast(row)); }}>
                              {t("aiSupport.campaigns.edit")}
                            </ActionButton>
                          ) : null}
                          {editable && status?.enabled ? (
                            <ActionButton tone="emerald" icon={Send} loading={busy === `send-${row.id}`} onClick={() => rowAction(row, "send")}>
                              {t("aiSupport.campaigns.sendNow")}
                            </ActionButton>
                          ) : null}
                          {row.status === "scheduled" ? (
                            <ActionButton tone="amber" icon={X} loading={busy === `cancel-schedule-${row.id}`} onClick={() => rowAction(row, "cancel-schedule")}>
                              {t("aiSupport.campaigns.cancelSchedule")}
                            </ActionButton>
                          ) : null}
                          {row.status === "sending" ? (
                            <ActionButton tone="rose" icon={Square} loading={busy === `stop-${row.id}`} onClick={() => rowAction(row, "stop")}>
                              {t("aiSupport.controlCenter.broadcasts.stop")}
                            </ActionButton>
                          ) : null}
                          {!editable ? (
                            <ActionButton icon={ListChecks} loading={busy === `log-${row.id}`} onClick={() => rowAction(row, "log")}>
                              {t("aiSupport.campaigns.log")}
                            </ActionButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {log?.id === row.id ? (
                      <tr className="border-t border-white/5">
                        <td colSpan={8} className="bg-slate-950/40 px-3 py-2.5">
                          {log.rows.length ? (
                            <div className="grid max-h-64 gap-1 overflow-y-auto">
                              {log.rows.map((recipient) => (
                                <div key={recipient.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
                                  <span dir="auto" className="min-w-[120px] font-bold text-white">{recipient.customer_name || "—"}</span>
                                  <span dir="ltr" className="text-slate-500">{recipient.phone}</span>
                                  <StatusChip status={recipient.status} />
                                  {recipient.error_meaning || recipient.skip_reason ? (
                                    <span dir="ltr" className="text-rose-200" title={recipient.error_message || ""}>
                                      {recipient.error_meaning || recipient.skip_reason}{recipient.error_code ? ` (${recipient.error_code})` : ""}
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-500">{t("aiSupport.campaigns.logEmpty")}</div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {!broadcasts.length ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.controlCenter.broadcasts.empty")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
          {t("aiSupport.controlCenter.broadcasts.note")}
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------------ editor */
  const isTemplate = form.channel_mode === "template";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setForm(null); setPreview(null); setError(""); }} className="text-xs font-black text-cyan-200 hover:underline">
          {t("aiSupport.campaigns.backToList")}
        </button>
        <span className="text-slate-600">/</span>
        <span dir="auto" className="text-sm font-black text-white">{form.name || t("aiSupport.campaigns.new")}</span>
      </div>
      {notices}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4">
          <TextInput label={t("aiSupport.campaigns.fields.name")} dir="auto" maxLength={200} value={form.name} onChange={(event) => patch({ name: event.target.value })} />

          <Field label={t("aiSupport.campaigns.fields.messageType")}>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={chipClass(isTemplate)} onClick={() => patch({ channel_mode: "template" })}>
                {t("aiSupport.campaigns.type.template")}
              </button>
              {reviewerMode ? null : (
                <button type="button" className={chipClass(!isTemplate)} onClick={() => patch({ channel_mode: "text" })}>
                  {t("aiSupport.campaigns.type.text")}
                </button>
              )}
            </div>
          </Field>

          {isTemplate ? (
            <>
              <Field label={t("aiSupport.campaigns.fields.template")} hint={templates.length ? t("aiSupport.campaigns.fields.templateHint") : t("aiSupport.campaigns.fields.noApprovedTemplates")}>
                <ThemedSelect
                  value={String(form.template_id || "")}
                  placeholder={t("aiSupport.campaigns.fields.templatePlaceholder")}
                  onChange={(value) => patch({ template_id: value, template_variables: [] })}
                  options={templates.map((item) => ({ value: String(item.id), label: `${item.name} · ${item.language}` }))}
                  triggerClassName={selectTrigger}
                />
              </Field>
              {selectedTemplate?.header_media_missing ? (
                <p className="rounded-xl border border-rose-300/20 bg-rose-400/10 p-2.5 text-xs font-bold text-rose-100">{t("aiSupport.campaigns.errors.headerMediaMissing")}</p>
              ) : null}
              {variableCount ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="mb-2 text-xs font-black text-white">{t("aiSupport.campaigns.variables.title")}</div>
                  <div className="grid gap-2">
                    {variables.map((item, index) => (
                      <div key={index} className="grid items-center gap-2 md:grid-cols-[56px_180px_minmax(0,1fr)]">
                        <span dir="ltr" className="text-xs font-black text-cyan-100">{`{{${index + 1}}}`}</span>
                        <ThemedSelect
                          value={item.source}
                          onChange={(value) => setVariable(index, { source: value })}
                          options={["customer_name", "customer_phone", "static"].map((value) => ({ value, label: sourceLabel(t, value) }))}
                          triggerClassName={selectTrigger}
                        />
                        <TextInput
                          dir="auto"
                          maxLength={500}
                          value={item.value}
                          placeholder={item.source === "static" ? t("aiSupport.campaigns.variables.staticPlaceholder") : t("aiSupport.campaigns.variables.fallbackPlaceholder")}
                          onChange={(event) => setVariable(index, { value: event.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <Field label={t("aiSupport.controlCenter.broadcasts.message")} hint={t("aiSupport.controlCenter.broadcasts.messageHint")}>
              <textarea
                rows={5}
                dir="auto"
                maxLength={900}
                value={form.message_body}
                placeholder={t("aiSupport.controlCenter.broadcasts.messagePlaceholder")}
                onChange={(event) => patch({ message_body: event.target.value })}
                className={textareaClass}
              />
            </Field>
          )}

          {/* Replies: who answers a customer who writes back (GENI: Chatbot Flow, AI Workflow,
              Auto Lead Generation). Handled server-side by modules/campaignAttribution. Template
              campaigns only: a text broadcast leaves through WhatsApp Web, where neither the
              send nor the reply can be tied back to the campaign. */}
          {isTemplate ? (
          <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
            <div className="text-xs font-black text-white">{t("aiSupport.campaigns.replies.title")}</div>
            <Field label={t("aiSupport.campaigns.replies.chatbotFlow")} hint={t("aiSupport.campaigns.replies.chatbotFlowHint")}>
              <ThemedSelect
                value={String(form.chatbot_flow_id || "")}
                onChange={(value) => patch({ chatbot_flow_id: value })}
                options={[
                  { value: "", label: t("aiSupport.campaigns.replies.noFlow") },
                  ...flows.map((flow) => ({ value: String(flow.id), label: `${flow.name}${flow.status && flow.status !== "active" ? ` · ${flow.status}` : ""}` })),
                ]}
                triggerClassName={selectTrigger}
              />
            </Field>
            <Field label={t("aiSupport.campaigns.replies.aiInstructions")} hint={t("aiSupport.campaigns.replies.aiInstructionsHint")}>
              <textarea
                rows={3}
                dir="auto"
                maxLength={2000}
                value={form.ai_instructions}
                placeholder={t("aiSupport.campaigns.replies.aiInstructionsPlaceholder")}
                onChange={(event) => patch({ ai_instructions: event.target.value })}
                className={textareaClass}
              />
            </Field>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={form.auto_lead_generation !== false}
                onChange={(event) => patch({ auto_lead_generation: event.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400"
              />
              <span className="min-w-0">
                <span className="block text-xs font-black text-white">{t("aiSupport.campaigns.replies.autoLead")}</span>
                <span className="mt-0.5 block text-[11px] leading-5 text-slate-500">{t("aiSupport.campaigns.replies.autoLeadHint")}</span>
              </span>
            </label>
          </div>
          ) : null}

          <Field label={t("aiSupport.campaigns.fields.group")} hint={t("aiSupport.campaigns.fields.groupHint")}>
            <div className="flex flex-wrap gap-1.5" aria-label={t("aiSupport.inboxOrg.groups.pickForCampaign")}>
              <button type="button" className={chipClass(!form.group_name)} onClick={() => { patch({ group_name: "" }); setPreview(null); }}>
                {t("aiSupport.campaigns.fields.allCustomers")}
              </button>
              {groups.slice(0, 40).map((group) => (
                <button
                  key={group.name}
                  type="button"
                  className={chipClass(form.group_name === group.name)}
                  onClick={() => { patch({ group_name: form.group_name === group.name ? "" : group.name }); setPreview(null); }}
                >
                  <span dir="auto">{group.name}</span> · {group.customers}
                </button>
              ))}
            </div>
          </Field>

          <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
            <button type="button" onClick={() => setShowFilters((value) => !value)} className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400 hover:text-slate-200">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {t("aiSupport.campaigns.fields.moreFilters")}
              {extraTags.length || Number(form.audience.min_orders) || Number(form.audience.min_spent) || Number(form.audience.bought_within_days) || Number(form.audience.quiet_for_days) ? " •" : ""}
            </button>
            {showFilters ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <TextInput label={t("aiSupport.controlCenter.broadcasts.minOrders")} inputMode="numeric" value={form.audience.min_orders} onChange={(event) => patchAudience({ min_orders: event.target.value.replace(/\D/g, "") })} />
                <TextInput label={t("aiSupport.controlCenter.broadcasts.minSpent")} inputMode="numeric" value={form.audience.min_spent} onChange={(event) => patchAudience({ min_spent: event.target.value.replace(/\D/g, "") })} />
                <TextInput label={t("aiSupport.controlCenter.broadcasts.boughtWithin")} hint={t("aiSupport.controlCenter.broadcasts.daysHint")} inputMode="numeric" value={form.audience.bought_within_days} onChange={(event) => patchAudience({ bought_within_days: event.target.value.replace(/\D/g, "") })} />
                <TextInput label={t("aiSupport.controlCenter.broadcasts.quietFor")} hint={t("aiSupport.controlCenter.broadcasts.daysHint")} inputMode="numeric" value={form.audience.quiet_for_days} onChange={(event) => patchAudience({ quiet_for_days: event.target.value.replace(/\D/g, "") })} />
                <TextInput label={t("aiSupport.teamTools.tags.audienceLabel")} hint={t("aiSupport.teamTools.tags.audienceHint")} placeholder={t("aiSupport.teamTools.tags.placeholder")} value={form.audience.tags} onChange={(event) => patchAudience({ tags: event.target.value })} />
                <Field label={t("aiSupport.controlCenter.broadcasts.frequencyCap")} hint={t("aiSupport.controlCenter.broadcasts.frequencyCapHint")}>
                  <ThemedSelect
                    value={String(form.frequency_cap_days)}
                    onChange={(value) => { patch({ frequency_cap_days: Number(value) }); setPreview(null); }}
                    options={["7", "14", "30"].map((value) => ({ value, label: value }))}
                    triggerClassName={selectTrigger}
                  />
                </Field>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <ActionButton icon={Users} loading={busy === "preview"} onClick={runPreview}>
              {t("aiSupport.controlCenter.broadcasts.countThem")}
            </ActionButton>
            {preview ? (
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-black text-cyan-100">
                {t("aiSupport.controlCenter.broadcasts.audienceCount", { count: Number(preview.total) || 0 })}
                {preview.sample?.length ? ` — ${preview.sample.map((row) => row.name).filter(Boolean).join("، ")}` : ""}
              </span>
            ) : null}
          </div>

          <Field label={t("aiSupport.campaigns.fields.when")}>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={chipClass(form.when === "now")} onClick={() => patch({ when: "now" })}>
                {t("aiSupport.campaigns.whenNow")}
              </button>
              <button type="button" className={chipClass(form.when === "schedule")} onClick={() => patch({ when: "schedule" })}>
                {t("aiSupport.campaigns.whenSchedule")}
              </button>
              {form.when === "schedule" ? (
                <input
                  type="datetime-local"
                  value={form.scheduled_local}
                  onChange={(event) => patch({ scheduled_local: event.target.value })}
                  className="h-10 rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white outline-none focus:border-cyan-300/40"
                />
              ) : null}
            </div>
            {form.when === "schedule" ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{t("aiSupport.campaigns.scheduleHint")}</span> : null}
          </Field>

          {formError ? <p className="text-[11px] font-bold text-amber-200">{formError}</p> : null}

          <div className="flex flex-wrap gap-2">
            <ActionButton icon={Save} loading={busy === "save"} disabled={Boolean(formError) || Boolean(busy)} onClick={() => submit("save")}>
              {t("aiSupport.campaigns.saveDraft")}
            </ActionButton>
            {form.when === "schedule" ? (
              <ActionButton tone="primary" icon={CalendarClock} loading={busy === "schedule"} disabled={Boolean(formError) || !status?.enabled || Boolean(busy)} onClick={() => submit("schedule")}>
                {t("aiSupport.campaigns.saveAndSchedule")}
              </ActionButton>
            ) : (
              <ActionButton tone="primary" icon={Send} loading={busy === "send"} disabled={Boolean(formError) || !status?.enabled || !Number(preview?.total) || Boolean(busy)} onClick={() => submit("send")}>
                {t("aiSupport.controlCenter.broadcasts.send")}
              </ActionButton>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {isTemplate ? (
            selectedTemplate ? (
              <>
                <MessagePreview
                  header={selectedTemplate.header_format === "TEXT" ? selectedTemplate.header_text : ""}
                  body={fillBody(selectedTemplate.body_text, previewValues)}
                  footer={selectedTemplate.footer_text}
                />
                <div className="text-[11px] text-slate-500" dir="ltr">
                  {selectedTemplate.name} · {selectedTemplate.language} · {selectedTemplate.category}
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-xs text-slate-500">
                <Megaphone className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
                {t("aiSupport.campaigns.pickTemplateForPreview")}
              </div>
            )
          ) : (
            <MessagePreview body={String(form.message_body || "").replace(/\{\{\s*customer_name\s*\}\}/g, sampleName)} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const tone = status === "sent" || status === "queued"
    ? "text-emerald-200"
    : status === "failed"
      ? "text-rose-200"
      : status === "pending" || status === "sending"
        ? "text-amber-200"
        : "text-slate-400";
  return <span className={`text-[10.5px] font-black uppercase ${tone}`}>{status}</span>;
}

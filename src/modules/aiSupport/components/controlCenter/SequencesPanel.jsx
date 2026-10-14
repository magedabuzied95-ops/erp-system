import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Pencil, Plus, Power, Trash2, Workflow, X } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { resolveChatMediaUrl } from "../../../../shared/lib/imageUrls.js";
import { ActionButton, PanelSection } from "../integrations/integrationsUi.jsx";
import { Field, SelectInput, TextArea, TextInput, Toggle } from "./controlCenterUi.jsx";

/*
 * The sequences catalogue: what the shop sends, how long after the customer
 * goes quiet, and whether it starts by itself. Enrolling a conversation lives
 * in the inbox (ConversationTeamTools); this is only the recipe book.
 */
const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value ?? "").trim();
const CHANNEL_LABEL = { whatsapp: "WhatsApp", instagram: "Instagram", facebook_messenger: "Messenger", telegram: "Telegram" };
const ALL_CHANNELS = ["whatsapp", "instagram", "facebook_messenger", "telegram"];

const emptyStep = () => ({ delay_minutes: 120, body: "", media: [] });
const emptyForm = () => ({ name: "", trigger_type: "manual", is_active: true, channels: [...ALL_CHANNELS], cooldown_days: 14, stop_on_reply: true, stop_on_purchase: true, steps: [emptyStep()] });

const delayParts = (minutes) => {
  const total = Math.max(1, Number(minutes) || 1);
  if (total % (60 * 24) === 0) return { value: total / (60 * 24), unit: "days" };
  if (total % 60 === 0) return { value: total / 60, unit: "hours" };
  return { value: total, unit: "minutes" };
};
const minutesFrom = (value, unit) => {
  const amount = Math.max(1, Number(value) || 1);
  return unit === "days" ? amount * 60 * 24 : unit === "hours" ? amount * 60 : amount;
};

const describeDelay = (t, minutes) => {
  const { value, unit } = delayParts(minutes);
  return t(`aiSupport.teamTools.sequencesPanel.after.${unit}`, { count: value });
};

function StepEditor({ step, index, total, onChange, onRemove, onMove, headers, light = false }) {
  const { t } = useTranslation();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const parts = delayParts(step.delay_minutes);

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const payload = await api.post("/ai-inbox/quick-replies/upload", body, { headers });
      if (payload?.media?.url) onChange({ ...step, media: [...asArray(step.media), payload.media].slice(0, 3) });
    } catch (error) {
      window.alert(error?.message || t("aiSupport.teamTools.sequencesPanel.uploadError"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-black text-white">{t("aiSupport.teamTools.sequencesPanel.stepTitle", { index: index + 1 })}</div>
        <div className="flex items-center gap-1">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-slate-300 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-slate-300 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={total <= 1} onClick={onRemove} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-300 disabled:opacity-30"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <Field label={index === 0 ? t("aiSupport.teamTools.sequencesPanel.firstDelay") : t("aiSupport.teamTools.sequencesPanel.nextDelay")}>
          <div className="flex gap-2">
            <TextInput inputMode="numeric" value={parts.value} onChange={(event) => onChange({ ...step, delay_minutes: minutesFrom(event.target.value.replace(/\D/g, ""), parts.unit) })} className="!w-24" />
            <div className="min-w-0 flex-1">
              <SelectInput value={parts.unit} onChange={(event) => onChange({ ...step, delay_minutes: minutesFrom(parts.value, event.target.value) })}>
                <option value="minutes">{t("aiSupport.teamTools.sequencesPanel.units.minutes")}</option>
                <option value="hours">{t("aiSupport.teamTools.sequencesPanel.units.hours")}</option>
                <option value="days">{t("aiSupport.teamTools.sequencesPanel.units.days")}</option>
              </SelectInput>
            </div>
          </div>
        </Field>
        <Field label={t("aiSupport.teamTools.sequencesPanel.media")} hint={t("aiSupport.teamTools.sequencesPanel.mediaHint")}>
          <div className="flex flex-wrap items-center gap-2">
            {asArray(step.media).map((media, mediaIndex) => (
              <span key={`${media.url}-${mediaIndex}`} className="relative h-14 w-14 overflow-hidden rounded-xl ring-1 ring-white/15">
                {media.kind === "video" ? <span className="grid h-full w-full place-items-center bg-black/40 text-[10px] font-black text-white">🎬</span> : <img src={resolveChatMediaUrl(media.url)} alt="" className="h-full w-full object-cover" />}
                <button type="button" onClick={() => onChange({ ...step, media: asArray(step.media).filter((_, i) => i !== mediaIndex) })} className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white"><X className="h-3 w-3" /></button>
              </span>
            ))}
            {asArray(step.media).length < 3 ? (
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="grid h-14 w-14 place-items-center rounded-xl border border-dashed border-white/20 text-slate-400 hover:text-white disabled:opacity-50">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
              </button>
            ) : null}
            <input ref={fileRef} type="file" accept="image/*,video/mp4,video/quicktime" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
          </div>
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t("aiSupport.teamTools.sequencesPanel.body")} hint={t("aiSupport.teamTools.sequencesPanel.bodyHint")}>
          <TextArea value={step.body} maxLength={2000} onChange={(event) => onChange({ ...step, body: event.target.value })} placeholder={t("aiSupport.teamTools.sequencesPanel.bodyPlaceholder")} />
        </Field>
      </div>
    </div>
  );
}

export default function SequencesPanel({ headers, tenantId }) {
  const { t } = useTranslation();
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | id
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.get("/ai-inbox/sequences", { params: { tenant_id: tenantId }, headers });
      setSequences(asArray(payload?.sequences));
    } catch (err) {
      setError(err?.message || t("aiSupport.controlCenter.loadError"));
    } finally {
      setLoading(false);
    }
  }, [headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = () => {
    setForm(emptyForm());
    setEditing("new");
  };
  const startEdit = (sequence) => {
    setForm({
      name: sequence.name,
      trigger_type: sequence.trigger_type,
      is_active: sequence.is_active !== false,
      channels: asArray(sequence.channels).length ? [...sequence.channels] : [...ALL_CHANNELS],
      cooldown_days: sequence.cooldown_days ?? 14,
      stop_on_reply: sequence.stop_on_reply !== false,
      stop_on_purchase: sequence.stop_on_purchase !== false,
      steps: asArray(sequence.steps).length ? sequence.steps.map((step) => ({ ...step, media: asArray(step.media) })) : [emptyStep()],
    });
    setEditing(sequence.id);
  };
  const cancelEdit = () => {
    setEditing(null);
    setForm(emptyForm());
  };

  const patchStep = (index, next) => setForm((current) => ({ ...current, steps: current.steps.map((step, i) => (i === index ? next : step)) }));
  const moveStep = (index, direction) => setForm((current) => {
    const target = index + direction;
    if (target < 0 || target >= current.steps.length) return current;
    const steps = [...current.steps];
    [steps[index], steps[target]] = [steps[target], steps[index]];
    return { ...current, steps };
  });

  const save = async () => {
    if (!clean(form.name)) return setError(t("aiSupport.teamTools.sequencesPanel.nameRequired"));
    if (!form.steps.some((step) => clean(step.body) || asArray(step.media).length)) return setError(t("aiSupport.teamTools.sequencesPanel.stepRequired"));
    setSaving(true);
    setError("");
    try {
      const body = { ...form, tenant_id: tenantId, cooldown_days: Number(form.cooldown_days) || 0 };
      if (editing === "new") await api.post("/ai-inbox/sequences", body, { headers });
      else await api.patch(`/ai-inbox/sequences/${editing}`, body, { headers });
      cancelEdit();
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.teamTools.sequencesPanel.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (sequence) => {
    setBusyId(sequence.id);
    try {
      await api.patch(`/ai-inbox/sequences/${sequence.id}`, { tenant_id: tenantId, is_active: sequence.is_active === false }, { headers });
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.teamTools.sequencesPanel.saveError"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (sequence) => {
    if (!window.confirm(t("aiSupport.teamTools.sequencesPanel.deleteConfirm", { name: sequence.name }))) return;
    setBusyId(sequence.id);
    try {
      await api.delete(`/ai-inbox/sequences/${sequence.id}`, { params: { tenant_id: tenantId }, headers });
      await load();
    } catch (err) {
      setError(err?.message || t("aiSupport.teamTools.sequencesPanel.saveError"));
    } finally {
      setBusyId(null);
    }
  };

  const triggerLabel = useMemo(() => ({
    manual: t("aiSupport.teamTools.sequencesPanel.triggers.manual"),
    inquiry_no_purchase: t("aiSupport.teamTools.sequencesPanel.triggers.inquiryNoPurchase"),
  }), [t]);

  return (
    <div className="space-y-4" data-sequences-panel="true">
      <PanelSection
        icon={Workflow}
        title={t("aiSupport.teamTools.sequencesPanel.title")}
        subtitle={t("aiSupport.teamTools.sequencesPanel.subtitle")}
        action={editing ? null : <ActionButton icon={Plus} onClick={startCreate}>{t("aiSupport.teamTools.sequencesPanel.add")}</ActionButton>}
      >
        {error ? <div className="mb-3 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs font-bold text-rose-100">{error}</div> : null}

        {editing ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("aiSupport.teamTools.sequencesPanel.name")}>
                <TextInput value={form.name} maxLength={120} onChange={(event) => setForm((c) => ({ ...c, name: event.target.value }))} placeholder={t("aiSupport.teamTools.sequencesPanel.namePlaceholder")} />
              </Field>
              <Field label={t("aiSupport.teamTools.sequencesPanel.trigger")} hint={form.trigger_type === "inquiry_no_purchase" ? t("aiSupport.teamTools.sequencesPanel.triggers.inquiryHint") : t("aiSupport.teamTools.sequencesPanel.triggers.manualHint")}>
                <SelectInput value={form.trigger_type} onChange={(event) => setForm((c) => ({ ...c, trigger_type: event.target.value }))}>
                  <option value="manual">{triggerLabel.manual}</option>
                  <option value="inquiry_no_purchase">{triggerLabel.inquiry_no_purchase}</option>
                </SelectInput>
              </Field>
            </div>
            <Field label={t("aiSupport.teamTools.sequencesPanel.channels")}>
              <div className="flex flex-wrap gap-2">
                {ALL_CHANNELS.map((channel) => {
                  const on = form.channels.includes(channel);
                  return (
                    <button key={channel} type="button" onClick={() => setForm((c) => ({ ...c, channels: on ? c.channels.filter((item) => item !== channel) : [...c.channels, channel] }))} className={`rounded-full px-3 py-1.5 text-[11px] font-black ring-1 transition ${on ? "bg-cyan-400/15 text-cyan-100 ring-cyan-300/30" : "bg-white/[0.04] text-slate-400 ring-white/10"}`}>
                      {CHANNEL_LABEL[channel]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Toggle label={t("aiSupport.teamTools.sequencesPanel.stopOnReply")} hint={t("aiSupport.teamTools.sequencesPanel.stopOnReplyHint")} checked={form.stop_on_reply} onChange={(next) => setForm((c) => ({ ...c, stop_on_reply: next }))} />
              <Toggle label={t("aiSupport.teamTools.sequencesPanel.stopOnPurchase")} hint={t("aiSupport.teamTools.sequencesPanel.stopOnPurchaseHint")} checked={form.stop_on_purchase} onChange={(next) => setForm((c) => ({ ...c, stop_on_purchase: next }))} />
              <Field label={t("aiSupport.teamTools.sequencesPanel.cooldown")} hint={t("aiSupport.teamTools.sequencesPanel.cooldownHint")}>
                <TextInput inputMode="numeric" value={form.cooldown_days} onChange={(event) => setForm((c) => ({ ...c, cooldown_days: event.target.value.replace(/\D/g, "") }))} />
              </Field>
            </div>
            <div className="space-y-3">
              {form.steps.map((step, index) => (
                <StepEditor
                  key={index}
                  step={step}
                  index={index}
                  total={form.steps.length}
                  headers={headers}
                  onChange={(next) => patchStep(index, next)}
                  onRemove={() => setForm((c) => ({ ...c, steps: c.steps.filter((_, i) => i !== index) }))}
                  onMove={(direction) => moveStep(index, direction)}
                />
              ))}
              {form.steps.length < 8 ? (
                <ActionButton tone="ghost" icon={Plus} onClick={() => setForm((c) => ({ ...c, steps: [...c.steps, emptyStep()] }))}>{t("aiSupport.teamTools.sequencesPanel.addStep")}</ActionButton>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <ActionButton icon={saving ? Loader2 : Pencil} loading={saving} onClick={save}>{t("aiSupport.teamTools.sequencesPanel.save")}</ActionButton>
              <ActionButton tone="ghost" icon={X} onClick={cancelEdit}>{t("aiSupport.teamTools.sequencesPanel.cancel")}</ActionButton>
            </div>
          </div>
        ) : loading ? (
          <div className="grid h-32 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-cyan-300" /></div>
        ) : sequences.length ? (
          <div className="space-y-2">
            {sequences.map((sequence) => (
              <div key={sequence.id} className={`rounded-2xl border p-3 ${sequence.is_active === false ? "border-white/10 bg-white/[0.02] opacity-70" : "border-white/10 bg-white/[0.04]"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-white">{sequence.name}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${sequence.trigger_type === "inquiry_no_purchase" ? "bg-emerald-400/15 text-emerald-200" : "bg-white/[0.06] text-slate-300"}`}>{triggerLabel[sequence.trigger_type] || sequence.trigger_type}</span>
                      {sequence.is_active === false ? <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-black text-slate-400">{t("aiSupport.teamTools.sequencesPanel.paused")}</span> : null}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {asArray(sequence.steps).map((step, index) => `${index + 1}. ${describeDelay(t, step.delay_minutes)}`).join(" ← ")}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      {asArray(sequence.channels).map((channel) => CHANNEL_LABEL[channel] || channel).join(" · ")}
                      {" · "}
                      {t("aiSupport.teamTools.sequencesPanel.stats", { active: sequence.active_count || 0, completed: sequence.completed_count || 0, stopped: sequence.stopped_count || 0 })}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => void toggleActive(sequence)} disabled={busyId === sequence.id} title={sequence.is_active === false ? t("aiSupport.teamTools.sequencesPanel.resume") : t("aiSupport.teamTools.sequencesPanel.pause")} className={`grid h-9 w-9 place-items-center rounded-xl ${sequence.is_active === false ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"} disabled:opacity-50`}>
                      {busyId === sequence.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => startEdit(sequence)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-slate-200"><Pencil className="h-4 w-4" /></button>
                    <button type="button" onClick={() => void remove(sequence)} disabled={busyId === sequence.id} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-500/10 text-rose-300 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-slate-400">{t("aiSupport.teamTools.sequencesPanel.empty")}</div>
        )}
      </PanelSection>
    </div>
  );
}

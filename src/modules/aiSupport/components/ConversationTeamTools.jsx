import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, Check, Loader2, Play, Square, UserCheck, UserPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import ThemedSelect from "../../../shared/ui/ThemedSelect";

/*
 * The three team tools that act on ONE conversation: hand it to a colleague,
 * set a reminder to come back to it, start or stop a message sequence on it.
 *
 * One component for both inbox surfaces — the desktop workspace mounts it in
 * the thread tools, the PWA in a bottom sheet — so a fix lands on both.
 */
const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value ?? "").trim();

const toLocalInputValue = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const inOneHour = () => toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000));
const tomorrowAt = (hour) => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return toLocalInputValue(date);
};
const formatWhen = (value, locale) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

export const useInboxStaff = ({ headers, enabled = true } = {}) => {
  const [staff, setStaff] = useState([]);
  const [me, setMe] = useState({ id: null, name: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    api.get("/ai-inbox/staff", { headers })
      .then((payload) => {
        if (cancelled) return;
        setStaff(asArray(payload?.staff));
        setMe(payload?.me || { id: null, name: "" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, headers]);
  return { staff, me };
};

export const useMessageSequences = ({ headers, enabled = true } = {}) => {
  const [sequences, setSequences] = useState([]);
  const reload = useCallback(async () => {
    try {
      const payload = await api.get("/ai-inbox/sequences", { headers });
      setSequences(asArray(payload?.sequences));
    } catch {
      /* the picker simply stays empty */
    }
  }, [headers]);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  return { sequences, reload };
};

const SectionTitle = ({ icon: Icon, children, light }) => (
  <div className={`mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] ${light ? "text-slate-500" : "text-slate-400"}`}>
    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    {children}
  </div>
);

export default function ConversationTeamTools({
  conversation,
  headers,
  tenantId,
  staff = [],
  me = { id: null, name: "" },
  sequences = [],
  canReply = true,
  light = false,
  onAssigned,
  onNotice,
}) {
  const { t, i18n } = useTranslation();
  const sessionId = clean(conversation?.session_id || "");
  const routeId = encodeURIComponent(sessionId);
  const closed = (conversation?.conversation_status || conversation?.status) === "closed";
  const assignedId = String(conversation?.assigned_user_id || conversation?.assigned_user?.id || "");
  const assignedName = clean(conversation?.assigned_user?.name || conversation?.assigned_user_name || "");

  const [assignDraft, setAssignDraft] = useState(assignedId);
  const [assigning, setAssigning] = useState(false);
  useEffect(() => {
    setAssignDraft(assignedId);
  }, [assignedId, sessionId]);

  const [reminders, setReminders] = useState([]);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderWhen, setReminderWhen] = useState(inOneHour);
  const [reminderNote, setReminderNote] = useState("");
  const [reminderBusy, setReminderBusy] = useState("");

  const [enrollments, setEnrollments] = useState([]);
  const [sequenceDraft, setSequenceDraft] = useState("");
  const [sequenceBusy, setSequenceBusy] = useState("");

  const loadReminders = useCallback(async () => {
    if (!sessionId) return;
    try {
      const payload = await api.get(`/ai-inbox/conversations/${routeId}/reminders`, { headers });
      setReminders(asArray(payload?.reminders));
    } catch {
      setReminders([]);
    }
  }, [headers, routeId, sessionId]);

  const loadEnrollments = useCallback(async () => {
    if (!sessionId) return;
    try {
      const payload = await api.get(`/ai-inbox/conversations/${routeId}/sequences`, { headers });
      setEnrollments(asArray(payload?.enrollments));
    } catch {
      setEnrollments([]);
    }
  }, [headers, routeId, sessionId]);

  useEffect(() => {
    setReminders([]);
    setEnrollments([]);
    setReminderOpen(false);
    setReminderNote("");
    void loadReminders();
    void loadEnrollments();
  }, [loadEnrollments, loadReminders]);

  const notify = (tone, text) => onNotice?.({ tone, text });

  const staffOptions = useMemo(() => [
    { value: "", label: t("aiSupport.teamTools.assign.unassigned") },
    ...asArray(staff).map((person) => ({
      value: String(person.id),
      label: person.id === me.id
        ? t("aiSupport.teamTools.assign.meLabel", { name: person.name })
        : person.branch ? `${person.name} · ${person.branch}` : person.name,
    })),
  ], [me.id, staff, t]);

  const assign = async (targetId) => {
    if (!sessionId) return;
    const person = asArray(staff).find((item) => String(item.id) === String(targetId)) || null;
    setAssigning(true);
    try {
      const payload = await api.patch(`/ai-agent/inbox/${routeId}/assign`, {
        tenant_id: tenantId,
        assigned_user_id: person ? person.id : null,
        assigned_user_name: person ? person.name : "",
        channel: conversation?.channel || conversation?.source || "",
      }, { headers, perfComponent: "AiInbox.assignStaff" });
      onAssigned?.({ conversation: payload?.conversation || {}, assigned_user_id: person ? person.id : null, assigned_user_name: person ? person.name : "" });
      notify("emerald", person ? t("aiSupport.teamTools.assign.assignedToast", { name: person.name }) : t("aiSupport.teamTools.assign.unassignedToast"));
    } catch (error) {
      notify("rose", error?.message || t("aiSupport.teamTools.assign.error"));
      setAssignDraft(assignedId);
    } finally {
      setAssigning(false);
    }
  };

  const saveReminder = async () => {
    if (!sessionId) return;
    const when = new Date(reminderWhen);
    if (!Number.isFinite(when.getTime())) return notify("rose", t("aiSupport.teamTools.reminders.invalidTime"));
    setReminderBusy("save");
    try {
      await api.post(`/ai-inbox/conversations/${routeId}/reminders`, {
        tenant_id: tenantId,
        scheduled_at: when.toISOString(),
        note: reminderNote,
        channel: conversation?.channel || conversation?.source || "",
        customer_name: clean(conversation?.customer_name || conversation?.assigned_customer_name || conversation?.customer_profile?.name || ""),
      }, { headers });
      setReminderOpen(false);
      setReminderNote("");
      setReminderWhen(inOneHour());
      notify("emerald", t("aiSupport.teamTools.reminders.saved"));
      await loadReminders();
    } catch (error) {
      notify("rose", error?.message || t("aiSupport.teamTools.reminders.saveError"));
    } finally {
      setReminderBusy("");
    }
  };

  const closeReminder = async (reminder, action) => {
    setReminderBusy(`${action}:${reminder.id}`);
    try {
      await api.patch(`/ai-agent/followups/${reminder.id}/${action}`, { tenant_id: tenantId, reason: "closed_from_inbox" }, { headers });
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
    } catch (error) {
      notify("rose", error?.message || t("aiSupport.teamTools.reminders.saveError"));
    } finally {
      setReminderBusy("");
    }
  };

  const activeSequences = useMemo(() => asArray(sequences).filter((sequence) => sequence.is_active !== false && asArray(sequence.steps).length), [sequences]);
  const sequenceOptions = useMemo(() => [
    { value: "", label: t("aiSupport.teamTools.sequences.choose") },
    ...activeSequences.map((sequence) => ({ value: String(sequence.id), label: `${sequence.name} · ${t("aiSupport.teamTools.sequences.stepsCount", { count: asArray(sequence.steps).length })}` })),
  ], [activeSequences, t]);
  const runningEnrollments = enrollments.filter((item) => item.status === "active");

  const startSequence = async () => {
    if (!sessionId || !sequenceDraft) return;
    setSequenceBusy("start");
    try {
      await api.post(`/ai-inbox/conversations/${routeId}/sequences`, { tenant_id: tenantId, sequence_id: Number(sequenceDraft) }, { headers });
      setSequenceDraft("");
      notify("emerald", t("aiSupport.teamTools.sequences.started"));
      await loadEnrollments();
    } catch (error) {
      notify("rose", error?.message || t("aiSupport.teamTools.sequences.startError"));
    } finally {
      setSequenceBusy("");
    }
  };

  const stopSequence = async (enrollment) => {
    setSequenceBusy(`stop:${enrollment.id}`);
    try {
      await api.post(`/ai-inbox/conversations/${routeId}/sequences/${enrollment.id}/stop`, { tenant_id: tenantId }, { headers });
      notify("emerald", t("aiSupport.teamTools.sequences.stopped"));
      await loadEnrollments();
    } catch (error) {
      notify("rose", error?.message || t("aiSupport.teamTools.sequences.stopError"));
    } finally {
      setSequenceBusy("");
    }
  };

  if (!sessionId) return null;

  const box = light ? "border-[#E2E8F0] bg-white" : "border-white/10 bg-white/[0.035]";
  const input = light
    ? "border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:border-amber-500"
    : "border-white/10 bg-black/20 text-white placeholder:text-slate-600 focus:border-cyan-300/40";
  const ghost = light ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "border-white/10 bg-white/[0.06] text-white hover:bg-white/10";
  const primary = light ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-amber-400 text-slate-950 hover:bg-amber-300";
  const muted = light ? "text-slate-500" : "text-slate-400";

  return (
    <div data-conversation-team-tools="true" className="space-y-2.5">
      {/* Assign */}
      <div className={`rounded-2xl border p-2.5 ${box}`}>
        <SectionTitle icon={UserCheck} light={light}>{t("aiSupport.teamTools.assign.title")}</SectionTitle>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <ThemedSelect
              value={assignDraft}
              onChange={(next) => setAssignDraft(String(next ?? ""))}
              options={staffOptions}
              disabled={!canReply || assigning || closed}
              ariaLabel={t("aiSupport.teamTools.assign.title")}
              triggerClassName={`h-9 w-full rounded-xl border px-3 text-xs font-bold outline-none ${input}`}
            />
          </div>
          <button
            type="button"
            onClick={() => void assign(assignDraft)}
            disabled={!canReply || assigning || closed || assignDraft === assignedId}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${primary}`}
          >
            {assigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
            {t("aiSupport.teamTools.assign.assignButton")}
          </button>
        </div>
        <div className={`mt-1.5 text-[11px] font-bold ${muted}`}>
          {assignedName ? t("aiSupport.teamTools.assign.currently", { name: assignedName }) : t("aiSupport.teamTools.assign.nobody")}
        </div>
      </div>

      {/* Reminders */}
      <div className={`rounded-2xl border p-2.5 ${box}`}>
        <div className="flex items-center justify-between gap-2">
          <SectionTitle icon={AlarmClock} light={light}>{t("aiSupport.teamTools.reminders.title")}</SectionTitle>
          {!reminderOpen ? (
            <button type="button" onClick={() => setReminderOpen(true)} disabled={!canReply} className={`mb-1.5 inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-black transition disabled:opacity-45 ${ghost}`}>
              <AlarmClock className="h-3 w-3" />
              {t("aiSupport.teamTools.reminders.add")}
            </button>
          ) : null}
        </div>
        {reminders.length ? (
          <div className="space-y-1.5">
            {reminders.map((reminder) => (
              <div key={reminder.id} className={`flex items-start gap-2 rounded-xl border px-2.5 py-2 ${light ? "border-amber-200 bg-amber-50" : "border-amber-300/20 bg-amber-400/10"}`}>
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] font-black ${light ? "text-amber-900" : "text-amber-100"}`}>{formatWhen(reminder.scheduled_at, i18n.language)}</div>
                  {reminder.note ? <div dir="auto" className={`mt-0.5 text-[11px] ${light ? "text-amber-800" : "text-amber-100/80"}`}>{reminder.note}</div> : null}
                  {reminder.created_by_name ? <div className={`mt-0.5 text-[10px] ${muted}`}>{reminder.created_by_name}</div> : null}
                </div>
                <button type="button" onClick={() => void closeReminder(reminder, "done")} disabled={Boolean(reminderBusy)} title={t("aiSupport.teamTools.reminders.done")} aria-label={t("aiSupport.teamTools.reminders.done")} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-500 disabled:opacity-45">
                  {reminderBusy === `done:${reminder.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => void closeReminder(reminder, "cancel")} disabled={Boolean(reminderBusy)} title={t("aiSupport.teamTools.reminders.cancel")} aria-label={t("aiSupport.teamTools.reminders.cancel")} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-500 disabled:opacity-45">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : !reminderOpen ? (
          <div className={`text-[11px] ${muted}`}>{t("aiSupport.teamTools.reminders.empty")}</div>
        ) : null}
        {reminderOpen ? (
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1">
              {[
                ["hour", t("aiSupport.teamTools.reminders.inOneHour"), inOneHour],
                ["tomorrow9", t("aiSupport.teamTools.reminders.tomorrowMorning"), () => tomorrowAt(9)],
                ["tomorrow17", t("aiSupport.teamTools.reminders.tomorrowEvening"), () => tomorrowAt(17)],
              ].map(([key, label, make]) => (
                <button key={key} type="button" onClick={() => setReminderWhen(make())} className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${ghost}`}>
                  {label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={reminderWhen}
              onChange={(event) => setReminderWhen(event.target.value)}
              className={`h-9 w-full rounded-xl border px-3 text-xs font-bold outline-none ${input}`}
              aria-label={t("aiSupport.teamTools.reminders.when")}
            />
            <input
              value={reminderNote}
              onChange={(event) => setReminderNote(event.target.value)}
              maxLength={1000}
              placeholder={t("aiSupport.teamTools.reminders.notePlaceholder")}
              className={`h-9 w-full rounded-xl border px-3 text-xs font-bold outline-none ${input}`}
            />
            <div className="flex gap-1.5">
              <button type="button" onClick={() => void saveReminder()} disabled={reminderBusy === "save"} className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-[11px] font-black transition disabled:opacity-45 ${primary}`}>
                {reminderBusy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlarmClock className="h-3.5 w-3.5" />}
                {t("aiSupport.teamTools.reminders.save")}
              </button>
              <button type="button" onClick={() => setReminderOpen(false)} className={`h-9 rounded-xl border px-3 text-[11px] font-black ${ghost}`}>
                {t("aiSupport.teamTools.reminders.close")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Sequences */}
      <div className={`rounded-2xl border p-2.5 ${box}`}>
        <SectionTitle icon={Play} light={light}>{t("aiSupport.teamTools.sequences.title")}</SectionTitle>
        {runningEnrollments.length ? (
          <div className="mb-2 space-y-1.5">
            {runningEnrollments.map((enrollment) => (
              <div key={enrollment.id} className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${light ? "border-emerald-200 bg-emerald-50" : "border-emerald-300/20 bg-emerald-400/10"}`}>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-[11px] font-black ${light ? "text-emerald-900" : "text-emerald-100"}`}>{enrollment.sequence_name}</div>
                  <div className={`mt-0.5 text-[10px] ${light ? "text-emerald-800" : "text-emerald-100/80"}`}>
                    {t("aiSupport.teamTools.sequences.progress", { step: enrollment.current_step, total: enrollment.total_steps })}
                    {enrollment.next_run_at ? ` · ${t("aiSupport.teamTools.sequences.next", { time: formatWhen(enrollment.next_run_at, i18n.language) })}` : ""}
                  </div>
                </div>
                <button type="button" onClick={() => void stopSequence(enrollment)} disabled={!canReply || Boolean(sequenceBusy)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-rose-500/15 px-2 text-[10px] font-black text-rose-500 disabled:opacity-45">
                  {sequenceBusy === `stop:${enrollment.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                  {t("aiSupport.teamTools.sequences.stop")}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {activeSequences.length ? (
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <ThemedSelect
                value={sequenceDraft}
                onChange={(next) => setSequenceDraft(String(next ?? ""))}
                options={sequenceOptions}
                disabled={!canReply || closed || Boolean(sequenceBusy)}
                ariaLabel={t("aiSupport.teamTools.sequences.title")}
                triggerClassName={`h-9 w-full rounded-xl border px-3 text-xs font-bold outline-none ${input}`}
              />
            </div>
            <button type="button" onClick={() => void startSequence()} disabled={!canReply || closed || !sequenceDraft || Boolean(sequenceBusy)} className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-45 ${primary}`}>
              {sequenceBusy === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {t("aiSupport.teamTools.sequences.start")}
            </button>
          </div>
        ) : (
          <div className={`text-[11px] ${muted}`}>{t("aiSupport.teamTools.sequences.none")}</div>
        )}
      </div>
    </div>
  );
}

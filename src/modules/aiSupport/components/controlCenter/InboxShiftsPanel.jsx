// Shifts — inbox top bar → Config → Shifts.
//
// When a colleague is "on" to answer chats: days of the week and a start/end time on the shop's
// Cairo clock (an end before the start runs past midnight), for all channels or some, and who
// works it. Team auto-distribution only hands a new chat to a member who is on shift right now;
// someone with no shift at all is treated as always available. These are inbox shifts, not the
// HR attendance shifts. Server: server/routes/inboxTeams.js (/shifts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock3, Plus, Save, Trash2 } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, TextInput, ToggleRow, clean } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502] };
const CHANNELS = ["whatsapp", "facebook_messenger", "instagram", "telegram", "tiktok"];
// Saturday first: the Egyptian working week.
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
const EMPTY = Object.freeze({ id: null, name: "", days: [6, 0, 1, 2, 3, 4], start_time: "10:00", end_time: "18:00", applies_to_all: true, channels: [], is_active: true, members: [] });
const chip = (on) =>
  `h-8 rounded-full border px-3 text-[11px] font-black transition ${on ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`;

// Literal keys so a missing translation stays greppable.
const dayLabel = (t, day) => {
  if (day === 0) return t("aiSupport.inboxOrg.shifts.days.sun");
  if (day === 1) return t("aiSupport.inboxOrg.shifts.days.mon");
  if (day === 2) return t("aiSupport.inboxOrg.shifts.days.tue");
  if (day === 3) return t("aiSupport.inboxOrg.shifts.days.wed");
  if (day === 4) return t("aiSupport.inboxOrg.shifts.days.thu");
  if (day === 5) return t("aiSupport.inboxOrg.shifts.days.fri");
  return t("aiSupport.inboxOrg.shifts.days.sat");
};
const channelLabel = (t, value) => {
  if (value === "whatsapp") return t("aiSupport.inboxOrg.shifts.channel.whatsapp");
  if (value === "facebook_messenger") return t("aiSupport.inboxOrg.shifts.channel.messenger");
  if (value === "instagram") return t("aiSupport.inboxOrg.shifts.channel.instagram");
  if (value === "tiktok") return t("aiSupport.inboxOrg.shifts.channel.tiktok");
  return t("aiSupport.inboxOrg.shifts.channel.telegram");
};
const crossesMidnight = (start, end) => Boolean(start && end && end <= start && start !== end);

function Field({ label, hint, children }) {
  return (
    <div className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{hint}</span> : null}
    </div>
  );
}

export default function InboxShiftsPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const [shiftsPayload, staffPayload] = await Promise.all([
        api.get("/inbox-config/org/shifts", { headers, ...SUPPRESSED }),
        api.get("/ai-inbox/staff", { headers, ...SUPPRESSED }).catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setShifts(Array.isArray(shiftsPayload?.shifts) ? shiftsPayload.shifts : []);
      setStaff(Array.isArray(staffPayload?.staff) ? staffPayload.staff : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.shifts.loadFailed") });
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [headers, t]);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (key, task, okText) => {
    setBusy(key);
    setNotice(null);
    try {
      const result = await task();
      if (mountedRef.current && okText) setNotice({ ok: true, text: okText });
      return result;
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.shifts.actionFailed") });
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [t]);

  const people = useMemo(() => {
    const map = new Map(staff.map((person) => [Number(person.id), { user_id: Number(person.id), user_name: clean(person.name), branch: clean(person.branch) }]));
    for (const member of draft?.members || []) {
      if (!map.has(member.user_id)) map.set(member.user_id, { ...member, branch: "" });
    }
    return [...map.values()];
  }, [draft?.members, staff]);

  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const toggleMember = (person) =>
    patch({
      members: draft.members.some((member) => member.user_id === person.user_id)
        ? draft.members.filter((member) => member.user_id !== person.user_id)
        : [...draft.members, { user_id: person.user_id, user_name: person.user_name }],
    });

  const save = async () => {
    const body = {
      name: draft.name,
      days: draft.days,
      start_time: draft.start_time,
      end_time: draft.end_time,
      applies_to_all: draft.applies_to_all,
      channels: draft.applies_to_all ? [] : draft.channels,
      is_active: draft.is_active,
      members: draft.members,
    };
    const saved = await run("save", async () => {
      const payload = draft.id
        ? await api.patch(`/inbox-config/org/shifts/${draft.id}`, body, { headers, ...SUPPRESSED })
        : await api.post("/inbox-config/org/shifts", body, { headers, ...SUPPRESSED });
      return payload?.shift;
    }, t("aiSupport.inboxOrg.shifts.saved"));
    if (saved) {
      setDraft(saved);
      await load();
    }
  };

  const remove = async () => {
    if (!draft?.id) { setDraft(null); return; }
    if (!window.confirm(t("aiSupport.inboxOrg.shifts.confirmDelete"))) return;
    const done = await run("delete", () => api.delete(`/inbox-config/org/shifts/${draft.id}`, { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.shifts.deleted"));
    if (done) {
      setDraft(null);
      await load();
    }
  };

  if (loading) return <PanelSkeleton rows={3} />;

  const noticeBox = notice ? (
    <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p>
  ) : null;

  if (!draft) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">{t("aiSupport.inboxOrg.shifts.subtitle")}</p>
          <ActionButton tone="primary" icon={Plus} onClick={() => { setNotice(null); setDraft({ ...EMPTY }); }}>{t("aiSupport.inboxOrg.shifts.new")}</ActionButton>
        </div>
        {noticeBox}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-start text-xs">
            <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.shifts.columns.name")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.shifts.columns.hours")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.shifts.columns.days")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.shifts.columns.appliesTo")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.shifts.columns.members")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.shifts.columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id} onClick={() => { setNotice(null); setDraft(shift); }} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                  <td className="px-3 py-2.5 font-black" dir="auto">{shift.name}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5" dir="ltr"><Clock3 className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />{shift.start_time}–{shift.end_time}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">{DAY_ORDER.filter((day) => shift.days.includes(day)).map((day) => dayLabel(t, day)).join(" · ")}</td>
                  <td className="px-3 py-2.5 text-slate-400">
                    {shift.applies_to_all ? t("aiSupport.inboxOrg.shifts.allAccounts") : shift.channels.map((channel) => channelLabel(t, channel)).join(" · ")}
                  </td>
                  <td className="px-3 py-2.5">{shift.members.length}</td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${shift.is_active ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.06] text-slate-300"}`}>
                      {shift.is_active ? t("aiSupport.inboxOrg.shifts.active") : t("aiSupport.inboxOrg.shifts.inactive")}
                    </span>
                  </td>
                </tr>
              ))}
              {!shifts.length ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxOrg.shifts.empty")}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => setDraft(null)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.inboxOrg.shifts.backToList")}</button>
          <span className="text-slate-600">/</span>
          <span className="truncate text-sm font-black text-white" dir="auto">{draft.name || t("aiSupport.inboxOrg.shifts.new")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton tone="rose" icon={Trash2} loading={busy === "delete"} onClick={remove}>{t("aiSupport.inboxOrg.shifts.delete")}</ActionButton>
          <ActionButton tone="primary" icon={Save} loading={busy === "save"} disabled={!clean(draft.name) || !draft.days.length} onClick={save}>{t("aiSupport.inboxOrg.shifts.save")}</ActionButton>
        </div>
      </div>
      {noticeBox}

      <div className="grid gap-3 md:grid-cols-2">
        <TextInput className="md:col-span-2" label={t("aiSupport.inboxOrg.shifts.fields.name")} dir="auto" maxLength={120} value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        <TextInput label={t("aiSupport.inboxOrg.shifts.fields.start")} type="time" dir="ltr" value={draft.start_time} onChange={(event) => patch({ start_time: event.target.value })} />
        <TextInput
          label={t("aiSupport.inboxOrg.shifts.fields.end")}
          hint={crossesMidnight(draft.start_time, draft.end_time) ? t("aiSupport.inboxOrg.shifts.fields.overnight") : t("aiSupport.inboxOrg.shifts.fields.cairoTime")}
          type="time"
          dir="ltr"
          value={draft.end_time}
          onChange={(event) => patch({ end_time: event.target.value })}
        />
        <div className="md:col-span-2">
          <Field label={t("aiSupport.inboxOrg.shifts.fields.days")}>
            <div className="flex flex-wrap gap-1.5">
              {DAY_ORDER.map((day) => (
                <button key={day} type="button" onClick={() => patch({ days: toggle(draft.days, day) })} className={chip(draft.days.includes(day))}>{dayLabel(t, day)}</button>
              ))}
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label={t("aiSupport.inboxOrg.shifts.fields.appliesTo")}>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => patch({ applies_to_all: true, channels: [] })} className={chip(draft.applies_to_all)}>{t("aiSupport.inboxOrg.shifts.allAccounts")}</button>
              {CHANNELS.map((channel) => (
                <button
                  key={channel}
                  type="button"
                  onClick={() => {
                    const channels = toggle(draft.applies_to_all ? [] : draft.channels, channel);
                    patch({ applies_to_all: channels.length === 0, channels });
                  }}
                  className={chip(!draft.applies_to_all && draft.channels.includes(channel))}
                >
                  {channelLabel(t, channel)}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <ToggleRow
            title={t("aiSupport.inboxOrg.shifts.fields.active")}
            description={t("aiSupport.inboxOrg.shifts.fields.activeHint")}
            checked={draft.is_active}
            onChange={(value) => patch({ is_active: value })}
          />
        </div>
        <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <span className="text-xs font-black text-white">{t("aiSupport.inboxOrg.shifts.fields.members")} ({draft.members.length})</span>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("aiSupport.inboxOrg.shifts.fields.membersHint")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {people.map((person) => (
              <button key={person.user_id} type="button" onClick={() => toggleMember(person)} className={chip(draft.members.some((member) => member.user_id === person.user_id))} title={person.branch || undefined}>
                <span dir="auto">{person.user_name || `#${person.user_id}`}</span>
              </button>
            ))}
            {!people.length ? <span className="text-[11px] text-slate-500">{t("aiSupport.inboxOrg.shifts.noStaff")}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

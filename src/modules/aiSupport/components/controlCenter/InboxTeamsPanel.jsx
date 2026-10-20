// Teams — inbox top bar → Config → Teams.
//
// A team is a name, a distribution strategy, the channels it covers (none picked = all) and its
// members. Round robin / least busy teams hand every NEW unassigned chat on their channels to a
// member who is on shift right now, through the same path as the "assign to colleague" button.
// Members come from the inbox's own staff list (/ai-inbox/staff). Server: server/routes/inboxTeams.js.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Save, Trash2, Users } from "lucide-react";

import { api } from "../../../../shared/api/api";
import ThemedSelect from "../../../../shared/ui/ThemedSelect";
import { ActionButton, PanelSkeleton, TextInput, ToggleRow, clean } from "../integrations/integrationsUi.jsx";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502] };
const CHANNELS = ["whatsapp", "facebook_messenger", "instagram", "telegram"];
const DISTRIBUTIONS = ["manual", "round_robin", "least_busy", "broadcast"];
const EMPTY = Object.freeze({ id: null, name: "", distribution: "round_robin", channels: [], is_active: true, members: [] });
const selectTrigger = "h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-bold text-white";
const chip = (on) =>
  `h-8 rounded-full border px-3 text-[11px] font-black transition ${on ? "border-cyan-300/40 bg-cyan-400/10 text-cyan-100" : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"}`;

// Literal keys so a missing translation stays greppable.
const distributionLabel = (t, value) => {
  if (value === "round_robin") return t("aiSupport.inboxOrg.teams.distribution.roundRobin");
  if (value === "least_busy") return t("aiSupport.inboxOrg.teams.distribution.leastBusy");
  if (value === "broadcast") return t("aiSupport.inboxOrg.teams.distribution.broadcast");
  return t("aiSupport.inboxOrg.teams.distribution.manual");
};
const distributionHint = (t, value) => {
  if (value === "round_robin") return t("aiSupport.inboxOrg.teams.distributionHint.roundRobin");
  if (value === "least_busy") return t("aiSupport.inboxOrg.teams.distributionHint.leastBusy");
  if (value === "broadcast") return t("aiSupport.inboxOrg.teams.distributionHint.broadcast");
  return t("aiSupport.inboxOrg.teams.distributionHint.manual");
};
const channelLabel = (t, value) => {
  if (value === "whatsapp") return t("aiSupport.inboxOrg.teams.channel.whatsapp");
  if (value === "facebook_messenger") return t("aiSupport.inboxOrg.teams.channel.messenger");
  if (value === "instagram") return t("aiSupport.inboxOrg.teams.channel.instagram");
  return t("aiSupport.inboxOrg.teams.channel.telegram");
};

function Field({ label, hint, children }) {
  return (
    <div className="block">
      <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-[11px] leading-5 text-slate-500">{hint}</span> : null}
    </div>
  );
}

export default function InboxTeamsPanel({ headers }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const [teamsPayload, staffPayload] = await Promise.all([
        api.get("/inbox-config/org/teams", { headers, ...SUPPRESSED }),
        api.get("/ai-inbox/staff", { headers, ...SUPPRESSED }).catch(() => null),
      ]);
      if (!mountedRef.current) return;
      setTeams(Array.isArray(teamsPayload?.teams) ? teamsPayload.teams : []);
      setStaff(Array.isArray(staffPayload?.staff) ? staffPayload.staff : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.teams.loadFailed") });
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
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxOrg.teams.actionFailed") });
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [t]);

  // Everyone who can be picked: the staff list plus any saved member who has since left it.
  const people = useMemo(() => {
    const map = new Map(staff.map((person) => [Number(person.id), { user_id: Number(person.id), user_name: clean(person.name), branch: clean(person.branch) }]));
    for (const member of draft?.members || []) {
      if (!map.has(member.user_id)) map.set(member.user_id, { ...member, branch: "" });
    }
    return [...map.values()];
  }, [draft?.members, staff]);

  const patch = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const toggleChannel = (channel) =>
    patch({ channels: draft.channels.includes(channel) ? draft.channels.filter((item) => item !== channel) : [...draft.channels, channel] });
  const toggleMember = (person) =>
    patch({
      members: draft.members.some((member) => member.user_id === person.user_id)
        ? draft.members.filter((member) => member.user_id !== person.user_id)
        : [...draft.members, { user_id: person.user_id, user_name: person.user_name }],
    });

  const save = async () => {
    const body = { name: draft.name, distribution: draft.distribution, channels: draft.channels, is_active: draft.is_active, members: draft.members };
    const saved = await run("save", async () => {
      const payload = draft.id
        ? await api.patch(`/inbox-config/org/teams/${draft.id}`, body, { headers, ...SUPPRESSED })
        : await api.post("/inbox-config/org/teams", body, { headers, ...SUPPRESSED });
      return payload?.team;
    }, t("aiSupport.inboxOrg.teams.saved"));
    if (saved) {
      setDraft(saved);
      await load();
    }
  };

  const remove = async () => {
    if (!draft?.id) { setDraft(null); return; }
    if (!window.confirm(t("aiSupport.inboxOrg.teams.confirmDelete"))) return;
    const done = await run("delete", () => api.delete(`/inbox-config/org/teams/${draft.id}`, { headers, ...SUPPRESSED }), t("aiSupport.inboxOrg.teams.deleted"));
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
          <p className="text-xs text-slate-400">{t("aiSupport.inboxOrg.teams.subtitle")}</p>
          <ActionButton tone="primary" icon={Plus} onClick={() => { setNotice(null); setDraft({ ...EMPTY }); }}>{t("aiSupport.inboxOrg.teams.new")}</ActionButton>
        </div>
        {noticeBox}
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-start text-xs">
            <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
              <tr>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.teams.columns.name")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.teams.columns.distribution")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.teams.columns.members")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.teams.columns.channels")}</th>
                <th className="px-3 py-2 text-start">{t("aiSupport.inboxOrg.teams.columns.status")}</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team.id} onClick={() => { setNotice(null); setDraft(team); }} className="cursor-pointer border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                  <td className="px-3 py-2.5 font-black" dir="auto">{team.name}</td>
                  <td className="px-3 py-2.5">{distributionLabel(t, team.distribution)}</td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />{team.members.length}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-400">
                    {team.channels.length ? team.channels.map((channel) => channelLabel(t, channel)).join(" · ") : t("aiSupport.inboxOrg.teams.allChannels")}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[10.5px] font-black ${team.is_active ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.06] text-slate-300"}`}>
                      {team.is_active ? t("aiSupport.inboxOrg.teams.active") : t("aiSupport.inboxOrg.teams.inactive")}
                    </span>
                  </td>
                </tr>
              ))}
              {!teams.length ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxOrg.teams.empty")}</td></tr>
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
          <button type="button" onClick={() => setDraft(null)} className="text-xs font-black text-cyan-200 hover:underline">{t("aiSupport.inboxOrg.teams.backToList")}</button>
          <span className="text-slate-600">/</span>
          <span className="truncate text-sm font-black text-white" dir="auto">{draft.name || t("aiSupport.inboxOrg.teams.new")}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton tone="rose" icon={Trash2} loading={busy === "delete"} onClick={remove}>{t("aiSupport.inboxOrg.teams.delete")}</ActionButton>
          <ActionButton tone="primary" icon={Save} loading={busy === "save"} disabled={!clean(draft.name)} onClick={save}>{t("aiSupport.inboxOrg.teams.save")}</ActionButton>
        </div>
      </div>
      {noticeBox}

      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label={t("aiSupport.inboxOrg.teams.fields.name")} dir="auto" maxLength={120} value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
        <Field label={t("aiSupport.inboxOrg.teams.fields.distribution")} hint={distributionHint(t, draft.distribution)}>
          <ThemedSelect
            value={draft.distribution}
            onChange={(value) => patch({ distribution: value })}
            options={DISTRIBUTIONS.map((value) => ({ value, label: distributionLabel(t, value) }))}
            triggerClassName={selectTrigger}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label={t("aiSupport.inboxOrg.teams.fields.channels")} hint={t("aiSupport.inboxOrg.teams.fields.channelsHint")}>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => patch({ channels: [] })} className={chip(!draft.channels.length)}>{t("aiSupport.inboxOrg.teams.allChannels")}</button>
              {CHANNELS.map((channel) => (
                <button key={channel} type="button" onClick={() => toggleChannel(channel)} className={chip(draft.channels.includes(channel))}>{channelLabel(t, channel)}</button>
              ))}
            </div>
          </Field>
        </div>
        <div className="md:col-span-2">
          <ToggleRow
            title={t("aiSupport.inboxOrg.teams.fields.active")}
            description={t("aiSupport.inboxOrg.teams.fields.activeHint")}
            checked={draft.is_active}
            onChange={(value) => patch({ is_active: value })}
          />
        </div>
        <div className="md:col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-white">{t("aiSupport.inboxOrg.teams.fields.members")} ({draft.members.length})</span>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">{t("aiSupport.inboxOrg.teams.fields.membersHint")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {people.map((person) => {
              const on = draft.members.some((member) => member.user_id === person.user_id);
              return (
                <button key={person.user_id} type="button" onClick={() => toggleMember(person)} className={chip(on)} title={person.branch || undefined}>
                  <span dir="auto">{person.user_name || `#${person.user_id}`}</span>
                </button>
              );
            })}
            {!people.length ? <span className="text-[11px] text-slate-500">{t("aiSupport.inboxOrg.teams.noStaff")}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

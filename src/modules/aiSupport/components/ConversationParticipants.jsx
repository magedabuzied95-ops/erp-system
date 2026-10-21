import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Loader2, MoreVertical, Search, UserMinus, UserPlus, Users } from "lucide-react";
import { api } from "../../../shared/api/api";
import { aiInboxConversationEndpoint } from "../lib/conversationHelpers";

/*
 * Genie's Participants block: who is on this conversation.
 *   - the owner (assigned_user_id) — "Transfer chat" hands it to someone else
 *   - team members added to it (metadata.participants) — "Add" / remove
 * Each row: avatar with an online dot (green while they have the thread open),
 * name, "(أنت)" for you, a role badge, and a ⋮ (make owner / remove).
 * Staff come from /ai-inbox/staff, the people with the inbox switched on.
 */

const clean = (value) => String(value ?? "").trim();
const initials = (name = "") => (clean(name).split(/\s+/).map((part) => part[0]).join("").slice(0, 2) || "?").toUpperCase();
let staffCache = null;

function StaffPicker({ staff = [], excludeIds = [], onPick, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const close = (event) => { if (!ref.current?.contains(event.target)) onClose?.(); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [onClose]);
  const visible = staff.filter((person) => !excludeIds.includes(String(person.id)) && (!query || clean(person.name).toLowerCase().includes(query.toLowerCase())));
  return (
    <div ref={ref} className="absolute end-0 top-9 z-30 w-60 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl">
      <label className="relative m-2 flex h-8 items-center rounded-lg border border-border bg-surface-soft">
        <Search className="pointer-events-none absolute start-2 h-3.5 w-3.5 text-text-muted" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("aiSupport.inbox.participants.search")} className="h-8 w-full bg-transparent ps-7 pe-2 text-sm outline-none" />
      </label>
      <div className="max-h-56 overflow-y-auto pb-1">
        {visible.length ? visible.map((person) => (
          <button key={person.id} type="button" onClick={() => onPick(person)} className="flex w-full items-center gap-2 px-3 py-1.5 text-start text-sm hover:bg-surface-hover">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary-subtle text-[10px] font-black text-primary">{initials(person.name)}</span>
            <span dir="auto" className="min-w-0 flex-1 truncate">{person.name}</span>
            {person.branch ? <span className="truncate text-[10px] text-text-muted">{person.branch}</span> : null}
          </button>
        )) : <p className="px-3 py-4 text-center text-xs text-text-muted">{t("aiSupport.inbox.participants.nobody")}</p>}
      </div>
    </div>
  );
}

export default function ConversationParticipants({ conversation = {}, headers, tenantId, staffViewers = [], canManage = false, onAssigned, onParticipantsChange, onNotice }) {
  const { t } = useTranslation();
  const [staff, setStaff] = useState(staffCache?.staff || []);
  const [me, setMe] = useState(staffCache?.me || null);
  const [picker, setPicker] = useState("");
  const [rowMenu, setRowMenu] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionId = clean(conversation.session_id || conversation.conversation_id);

  useEffect(() => {
    let alive = true;
    api.get("/ai-inbox/staff", { headers, suppressErrorStatuses: [403, 404, 500, 502, 503] })
      .then((payload) => {
        if (!alive) return;
        staffCache = { staff: Array.isArray(payload?.staff) ? payload.staff : [], me: payload?.me || null };
        setStaff(staffCache.staff);
        setMe(staffCache.me);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [headers]);

  const ownerId = clean(conversation.assigned_user_id ?? conversation.assigned_user?.id ?? "");
  const ownerName = clean(conversation.assigned_user_name || conversation.assigned_user?.name);
  const added = useMemo(() => (Array.isArray(conversation.channel_metadata?.participants) ? conversation.channel_metadata.participants : []), [conversation.channel_metadata?.participants]);
  const viewingIds = new Set(staffViewers.map((viewer) => clean(viewer.id || viewer.user_id)));
  const viewingNames = new Set(staffViewers.map((viewer) => clean(viewer.name)));
  const byId = new Map(staff.map((person) => [String(person.id), person]));
  const rows = [
    ownerId ? { id: ownerId, name: ownerName || byId.get(ownerId)?.name || `#${ownerId}`, owner: true } : null,
    ...added.filter((item) => clean(item?.user_id) && clean(item.user_id) !== ownerId).map((item) => ({ id: clean(item.user_id), name: clean(item.name) || byId.get(clean(item.user_id))?.name || `#${item.user_id}`, owner: false })),
  ].filter(Boolean);
  // Someone viewing it who is neither owner nor added still shows, Genie-style, as present.
  for (const viewer of staffViewers) {
    const id = clean(viewer.id || viewer.user_id);
    if (rows.some((row) => (id && row.id === id) || row.name === clean(viewer.name))) continue;
    rows.push({ id, name: clean(viewer.name), owner: false, viewerOnly: true });
  }

  const assign = async (person) => {
    setBusy(true);
    try {
      const payload = await api.patch(`/ai-agent/inbox/${encodeURIComponent(sessionId)}/assign`, {
        tenant_id: tenantId,
        assigned_user_id: person ? person.id : null,
        assigned_user_name: person ? person.name : "",
        channel: conversation.channel || conversation.source || "",
      }, { headers, perfComponent: "AiInbox.transferChat" });
      onAssigned?.({ conversation: payload?.conversation || {}, assigned_user_id: person ? person.id : null, assigned_user_name: person ? person.name : "" });
      onNotice?.("emerald", person ? t("aiSupport.teamTools.assign.assignedToast", { name: person.name }) : t("aiSupport.teamTools.assign.unassignedToast"));
    } catch (error) {
      onNotice?.("rose", error?.message || t("aiSupport.teamTools.assign.error"));
    } finally {
      setBusy(false);
    }
  };
  const changeParticipant = async (action, person) => {
    setBusy(true);
    try {
      const payload = await api.patch(aiInboxConversationEndpoint(sessionId, "/participants"), { action, user_id: Number(person.id), name: person.name }, { headers });
      onParticipantsChange?.(Array.isArray(payload?.participants) ? payload.participants : []);
      onNotice?.("emerald", t(action === "add" ? "aiSupport.inbox.participants.added" : "aiSupport.inbox.participants.removed", { name: person.name }));
    } catch (error) {
      onNotice?.("rose", error?.message || t("aiSupport.inbox.participants.failed"));
    } finally {
      setBusy(false);
    }
  };
  const roleLabel = (id) => {
    const role = clean(byId.get(String(id))?.role).toLowerCase();
    if (!role) return "";
    return role === "employee" ? t("aiSupport.inbox.participants.roleEmployee") : role.includes("admin") || role.includes("owner") ? t("aiSupport.inbox.participants.roleAdmin") : role;
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-3" data-conversation-participants="true">
      <div className="relative mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-text">
          <Users className="h-4 w-4 text-text-muted" />
          {t("aiSupport.inbox.sidePanel.participants")}
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-muted" /> : null}
        </div>
        {canManage ? (
          <span className="flex gap-1.5">
            <button type="button" onClick={() => setPicker(picker === "transfer" ? "" : "transfer")} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-surface-hover"><ArrowLeftRight className="h-3.5 w-3.5" />{t("aiSupport.inbox.sidePanel.transfer")}</button>
            <button type="button" onClick={() => setPicker(picker === "add" ? "" : "add")} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold hover:bg-surface-hover"><UserPlus className="h-3.5 w-3.5" />{t("aiSupport.inbox.sidePanel.add")}</button>
          </span>
        ) : null}
        {picker ? (
          <StaffPicker
            staff={staff}
            excludeIds={picker === "transfer" ? [ownerId] : rows.filter((row) => !row.viewerOnly).map((row) => row.id)}
            onClose={() => setPicker("")}
            onPick={(person) => { setPicker(""); if (picker === "transfer") void assign(person); else void changeParticipant("add", person); }}
          />
        ) : null}
      </div>
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((row) => {
            const isMe = me && clean(me.id) === row.id;
            const online = (row.id && viewingIds.has(row.id)) || viewingNames.has(row.name) || isMe;
            const role = roleLabel(row.id);
            return (
              <li key={`${row.id}:${row.name}`} className="relative flex items-center gap-2 text-sm">
                <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-subtle text-xs font-black text-primary">
                  {initials(row.name)}
                  <span className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-surface ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span dir="auto">{row.name}</span>
                  {isMe ? <span className="ms-1 text-xs text-primary">({t("aiSupport.inbox.participants.you")})</span> : null}
                </span>
                {row.owner ? <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{t("aiSupport.inbox.sidePanel.owner")}</span> : null}
                {role && !row.owner ? <span className="rounded-full bg-surface-soft px-2 py-0.5 text-[10px] font-bold text-text-muted">{role}</span> : null}
                {row.viewerOnly ? <span className="text-[10px] text-text-muted">{t("aiSupport.inbox.sidePanel.viewingNow")}</span> : null}
                {canManage && !row.viewerOnly ? (
                  <span className="relative">
                    <button type="button" onClick={() => setRowMenu(rowMenu === row.id ? "" : row.id)} aria-label={t("aiSupport.inbox.actionsMenu.title")} className="grid h-7 w-7 place-items-center rounded-lg text-text-muted hover:bg-surface-hover">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    {rowMenu === row.id ? (
                      <span className="absolute end-0 top-8 z-30 block w-48 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-2xl">
                        {!row.owner ? (
                          <button type="button" onClick={() => { setRowMenu(""); void assign({ id: Number(row.id), name: row.name }); }} className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs hover:bg-surface-hover">
                            <ArrowLeftRight className="h-3.5 w-3.5" />{t("aiSupport.inbox.participants.makeOwner")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => { setRowMenu(""); if (row.owner) void assign(null); else void changeParticipant("remove", row); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs text-danger hover:bg-danger-subtle"
                        >
                          <UserMinus className="h-3.5 w-3.5" />{t(row.owner ? "aiSupport.inbox.participants.unassign" : "aiSupport.inbox.participants.remove")}
                        </button>
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-text-muted">{t("aiSupport.inbox.participants.empty")}</p>
      )}
    </section>
  );
}

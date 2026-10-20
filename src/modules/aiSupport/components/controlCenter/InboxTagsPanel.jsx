// Inbox tags — inbox top bar → Config → Tags.
//
// The central list behind the conversation labels modal (ConversationLabelsModal.jsx): the six
// pipeline stages plus every custom tag, with how many conversations carry each. Renaming or
// recolouring here also rewrites the copies already stored on conversations; pipeline stages can be
// renamed but not deleted (lead status is read from them). Server: server/routes/inboxTags.js.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Save, Tag, Trash2, X } from "lucide-react";

import { api } from "../../../../shared/api/api";
import { ActionButton, PanelSkeleton, TextInput, clean, formatDateTime } from "../integrations/integrationsUi.jsx";
import { conversationLabelClass, conversationLabelDotClass } from "../ConversationLabelsModal";
import { AI_INBOX_LABEL_COLOR_KEYS } from "../../../../../shared/aiInboxConversationLabels.js";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 500, 502] };
const EMPTY = Object.freeze({ id: null, name: "", description: "", color: "sky" });

function ColorPicker({ value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {AI_INBOX_LABEL_COLOR_KEYS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className={`grid h-8 w-8 place-items-center rounded-full border transition ${value === color ? "border-white/70 bg-white/10" : "border-transparent hover:bg-white/[0.06]"}`}
        >
          <span className={`h-3.5 w-3.5 rounded-full ${conversationLabelDotClass(color)}`} />
        </button>
      ))}
    </div>
  );
}

export default function InboxTagsPanel({ headers }) {
  const { t } = useTranslation();
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const payload = await api.get("/inbox-config/tags", { headers, ...SUPPRESSED });
      if (mountedRef.current) setTags(Array.isArray(payload?.tags) ? payload.tags : []);
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxConfig.tags.loadFailed") });
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
      return result || true;
    } catch (error) {
      if (mountedRef.current) setNotice({ ok: false, text: error?.message || t("aiSupport.inboxConfig.tags.actionFailed") });
      return null;
    } finally {
      if (mountedRef.current) setBusy("");
    }
  }, [t]);

  const save = async () => {
    if (!draft || !clean(draft.name)) return;
    const body = { name: clean(draft.name), description: draft.description || "", color: draft.color };
    const done = await run(
      "save",
      () => (draft.id
        ? api.patch(`/inbox-config/tags/${draft.id}`, body, { headers, ...SUPPRESSED })
        : api.post("/inbox-config/tags", body, { headers, ...SUPPRESSED })),
      t("aiSupport.inboxConfig.tags.saved")
    );
    if (done) {
      setDraft(null);
      await load();
    }
  };

  const remove = async (tag) => {
    const message = tag.uses
      ? t("aiSupport.inboxConfig.tags.confirmDeleteUsed", { count: tag.uses })
      : t("aiSupport.inboxConfig.tags.confirmDelete");
    if (!window.confirm(message)) return;
    const done = await run(`delete-${tag.id}`, () => api.delete(`/inbox-config/tags/${tag.id}`, { headers, ...SUPPRESSED }), t("aiSupport.inboxConfig.tags.deleted"));
    if (done) await load();
  };

  const visible = useMemo(() => {
    const needle = clean(query).toLowerCase();
    if (!needle) return tags;
    return tags.filter((tag) => clean(tag.name).toLowerCase().includes(needle) || clean(tag.description).toLowerCase().includes(needle));
  }, [query, tags]);

  if (loading) return <PanelSkeleton rows={3} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The page header already names the section; only the explainer here. */}
        <p className="text-xs text-slate-400">{t("aiSupport.inboxConfig.tags.subtitle")}</p>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("aiSupport.inboxConfig.tags.search")}
            className="h-9 w-48 rounded-full border border-white/10 bg-slate-950/70 px-3 text-xs font-bold text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
          />
          <ActionButton tone="primary" icon={Plus} onClick={() => { setNotice(null); setDraft({ ...EMPTY }); }}>{t("aiSupport.inboxConfig.tags.new")}</ActionButton>
        </div>
      </div>

      {notice ? <p className={`rounded-xl border p-2.5 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-rose-300/20 bg-rose-400/10 text-rose-100"}`}>{notice.text}</p> : null}

      {draft ? (
        <div className="space-y-3 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.04] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black text-white">{draft.id ? t("aiSupport.inboxConfig.tags.edit") : t("aiSupport.inboxConfig.tags.new")}</span>
            <span className={`inline-flex h-7 items-center rounded-lg border px-2.5 text-[11px] font-black ${conversationLabelClass(draft.color)}`} dir="auto">{clean(draft.name) || t("aiSupport.inboxConfig.tags.preview")}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <TextInput label={t("aiSupport.inboxConfig.tags.name")} dir="auto" maxLength={40} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} autoFocus />
            <TextInput label={t("aiSupport.inboxConfig.tags.description")} dir="auto" maxLength={500} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
          </div>
          <div>
            <span className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">{t("aiSupport.inboxConfig.tags.color")}</span>
            <div className="mt-1"><ColorPicker value={draft.color} label={t("aiSupport.inboxConfig.tags.color")} onChange={(color) => setDraft((current) => ({ ...current, color }))} /></div>
          </div>
          {draft.lead_status ? <p className="text-[11px] text-amber-200">{t("aiSupport.inboxConfig.tags.pipelineHint")}</p> : null}
          <div className="flex justify-end gap-2">
            <ActionButton icon={X} onClick={() => setDraft(null)}>{t("aiSupport.inboxConfig.tags.cancel")}</ActionButton>
            <ActionButton tone="emerald" icon={Save} loading={busy === "save"} disabled={!clean(draft.name)} onClick={save}>{t("aiSupport.inboxConfig.tags.save")}</ActionButton>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[640px] text-start text-xs">
          <thead className="bg-white/[0.04] text-[10.5px] uppercase tracking-[0.12em] text-slate-500">
            <tr>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.tags.columns.name")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.tags.columns.description")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.tags.columns.uses")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.tags.columns.createdBy")}</th>
              <th className="px-3 py-2 text-start">{t("aiSupport.inboxConfig.tags.columns.createdAt")}</th>
              <th className="px-3 py-2" aria-label={t("aiSupport.inboxConfig.tags.columns.actions")} />
            </tr>
          </thead>
          <tbody>
            {visible.map((tag) => (
              <tr key={tag.id} className="border-t border-white/5 text-slate-200 hover:bg-white/[0.04]">
                <td className="px-3 py-2.5">
                  <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-black ${conversationLabelClass(tag.color)}`} dir="auto">
                    {tag.lead_status ? <Tag className="h-3 w-3" aria-hidden="true" /> : null}
                    {tag.name}
                  </span>
                </td>
                <td className="max-w-[260px] truncate px-3 py-2.5 text-slate-400" dir="auto" title={tag.description}>{tag.description || "—"}</td>
                <td className="px-3 py-2.5 font-black">{tag.uses}</td>
                <td className="px-3 py-2.5 text-slate-400" dir="auto">
                  {tag.created_by_name === "system"
                    ? t("aiSupport.inboxConfig.tags.bySystem")
                    : tag.created_by_name === "imported"
                      ? t("aiSupport.inboxConfig.tags.byImport")
                      : tag.created_by_name || "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{formatDateTime(tag.created_at)}</td>
                <td className="px-3 py-2.5">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => { setNotice(null); setDraft({ ...tag }); }} aria-label={t("aiSupport.inboxConfig.tags.edit")} className="grid h-8 w-8 place-items-center rounded-lg text-slate-300 hover:bg-white/10">
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(tag)}
                      disabled={Boolean(tag.lead_status) || busy === `delete-${tag.id}`}
                      title={tag.lead_status ? t("aiSupport.inboxConfig.tags.pipelineHint") : undefined}
                      aria-label={t("aiSupport.inboxConfig.tags.delete")}
                      className="grid h-8 w-8 place-items-center rounded-lg text-rose-200 hover:bg-rose-400/10 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!visible.length ? (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">{t("aiSupport.inboxConfig.tags.empty")}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

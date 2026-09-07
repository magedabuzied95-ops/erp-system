/*
 * Conversation labels — shared by /admin/ai-inbox and the /inbox PWA.
 *
 * Labels drive the lead status the whole pipeline reads, so a label set on the
 * desktop and invisible on the phone meant two operators disagreed about the
 * same conversation.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, Pencil, Search, Tag, XCircle } from "lucide-react";

import { clean } from "../lib/conversationHelpers";
import {
  AI_INBOX_DEFAULT_LABELS,
  customAiInboxLabel,
  normalizeAiInboxConversationLabels,
} from "../../../../shared/aiInboxConversationLabels.js";

const CONVERSATION_LABEL_CLASSES = {
  sky: "border-sky-400/35 bg-sky-500/15 text-sky-100",
  cyan: "border-cyan-400/35 bg-cyan-500/15 text-cyan-100",
  amber: "border-amber-400/35 bg-amber-500/15 text-amber-100",
  violet: "border-violet-400/35 bg-violet-500/15 text-violet-100",
  emerald: "border-emerald-400/35 bg-emerald-500/15 text-emerald-100",
  rose: "border-rose-400/35 bg-rose-500/15 text-rose-100",
  orange: "border-orange-400/35 bg-orange-500/15 text-orange-100",
  teal: "border-teal-400/35 bg-teal-500/15 text-teal-100",
};

const CONVERSATION_LABEL_DOT_CLASSES = {
  sky: "bg-sky-400",
  cyan: "bg-cyan-400",
  amber: "bg-amber-400",
  violet: "bg-violet-400",
  emerald: "bg-emerald-400",
  rose: "bg-rose-400",
  orange: "bg-orange-400",
  teal: "bg-teal-400",
};

export const conversationLabelClass = (color = "sky") => CONVERSATION_LABEL_CLASSES[color] || CONVERSATION_LABEL_CLASSES.sky;
export const conversationLabelDotClass = (color = "sky") => CONVERSATION_LABEL_DOT_CLASSES[color] || CONVERSATION_LABEL_DOT_CLASSES.sky;

function ConversationLabelsModal({ open, labels = [], saving = false, onClose, onSave }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [draftLabels, setDraftLabels] = useState([]);
  const [editingLabel, setEditingLabel] = useState(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setEditingLabel(null);
    setDraftLabels(normalizeAiInboxConversationLabels(labels));
  }, [labels, open]);

  if (!open) return null;

  const normalizedQuery = clean(query).toLowerCase();
  const selectedIds = new Set(draftLabels.map((label) => label.id));
  const availableLabels = AI_INBOX_DEFAULT_LABELS.filter((label) => !selectedIds.has(label.id) && (!normalizedQuery || label.name.toLowerCase().includes(normalizedQuery)));
  const customCandidate = customAiInboxLabel(query);
  const canCreateCustom = Boolean(customCandidate && !selectedIds.has(customCandidate.id) && !AI_INBOX_DEFAULT_LABELS.some((label) => label.id === customCandidate.id));
  const addLabel = (label) => setDraftLabels((current) => normalizeAiInboxConversationLabels([...current, label]));
  const saveLabelEdit = () => {
    const nextName = clean(editingLabel?.name).slice(0, 40);
    if (!editingLabel?.id || !nextName) return;
    setDraftLabels((current) => normalizeAiInboxConversationLabels(current.map((label) => (
      label.id === editingLabel.id ? { ...label, name: nextName, color: editingLabel.color } : label
    ))));
    setEditingLabel(null);
  };

  return (
    <div className="fixed inset-0 z-[2147482600] grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose?.(); }}>
      <section dir="rtl" role="dialog" aria-modal="true" aria-label={t("aiSupport.inbox.ui.conversationLabels")} className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-[#20231f] text-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2"><Tag className="h-5 w-5 text-amber-300" /><div><h3 className="text-base font-black">{t("aiSupport.inbox.ui.conversationLabels")}</h3><p className="text-[11px] text-slate-400">{t("aiSupport.inbox.ui.labelsHint")}</p></div></div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t("aiSupport.inbox.ui.closeLabels")} className="grid h-9 w-9 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"><XCircle className="h-5 w-5" /></button>
        </header>

        <div className="space-y-4 p-5">
          <label className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-amber-300/40">
            <Search className="h-4 w-4 text-slate-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("aiSupport.inbox.labels.search")} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" autoFocus />
          </label>

          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.labels.current")} ({draftLabels.length})</div>
            <div className="flex min-h-10 flex-wrap gap-2 rounded-xl border border-white/8 bg-black/15 p-2">
              {draftLabels.length ? draftLabels.map((label) => (
                <span key={label.id} className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-black ${conversationLabelClass(label.color)}`}>
                  {label.name}
                  <button type="button" onClick={() => setEditingLabel({ ...label })} aria-label={`Edit ${label.name}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-black/20"><Pencil className="h-2.5 w-2.5" /></button>
                  <button type="button" onClick={() => setDraftLabels((current) => current.filter((item) => item.id !== label.id))} aria-label={`Remove ${label.name}`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-black/20">×</button>
                </span>
              )) : <span className="px-1 py-1.5 text-xs text-slate-500">{t("aiSupport.inbox.labels.none")}</span>}
            </div>
            {editingLabel ? (
              <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-amber-200">{t("aiSupport.inbox.labels.edit")}</div>
                <input value={editingLabel.name} onChange={(event) => setEditingLabel((current) => ({ ...current, name: event.target.value }))} maxLength={40} aria-label={t("aiSupport.inbox.ui.labelName")} className="h-9 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm font-bold text-white outline-none focus:border-amber-300/40" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {Object.keys(CONVERSATION_LABEL_DOT_CLASSES).map((color) => (
                    <button key={color} type="button" onClick={() => setEditingLabel((current) => ({ ...current, color }))} aria-label={`Label color ${color}`} className={`grid h-7 w-7 place-items-center rounded-full border ${editingLabel.color === color ? "border-white bg-white/10" : "border-transparent"}`}><span className={`h-3 w-3 rounded-full ${conversationLabelDotClass(color)}`} /></button>
                  ))}
                  <div className="mr-auto flex gap-1.5">
                    <button type="button" onClick={() => setEditingLabel(null)} className="h-8 rounded-lg border border-white/10 px-3 text-[11px] font-bold text-slate-300">{t("aiSupport.inbox.ui.cancel")}</button>
                    <button type="button" onClick={saveLabelEdit} disabled={!clean(editingLabel.name)} className="h-8 rounded-lg bg-amber-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-40">{t("aiSupport.inbox.ui.saveEdit")}</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t("aiSupport.inbox.labels.available")}</div>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-white/8 bg-black/15 p-1.5">
              {availableLabels.map((label) => (
                <button key={label.id} type="button" onClick={() => addLabel(label)} className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-right transition hover:bg-white/[0.07]">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${conversationLabelDotClass(label.color)}`} />
                  <span className="flex-1 text-sm font-bold text-slate-200">{label.name}</span>
                  <span className="text-lg text-slate-500">+</span>
                </button>
              ))}
              {canCreateCustom ? (
                <button type="button" onClick={() => { addLabel(customCandidate); setQuery(""); }} className="flex h-11 w-full items-center gap-3 rounded-lg border border-dashed border-amber-300/25 bg-amber-300/[0.06] px-2.5 text-right transition hover:bg-amber-300/10">
                  <Tag className="h-4 w-4 text-amber-300" /><span className="flex-1 text-sm font-black text-amber-100">{t("aiSupport.inbox.labels.create")} “{customCandidate.name}”</span><span className="text-lg text-amber-300">+</span>
                </button>
              ) : null}
              {!availableLabels.length && !canCreateCustom ? <div className="p-4 text-center text-xs text-slate-500">{t("aiSupport.inbox.labels.noOthers")}</div> : null}
            </div>
          </div>
        </div>

        <footer className="border-t border-white/10 p-4">
          <button type="button" onClick={async () => { const saved = await onSave?.(draftLabels); if (saved !== false) onClose?.(); }} disabled={saving} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-300 text-sm font-black text-slate-950 shadow-lg disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Done
          </button>
        </footer>
      </section>
    </div>
  );
}

export default ConversationLabelsModal;

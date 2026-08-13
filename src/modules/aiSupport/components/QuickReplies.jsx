import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value ?? "").trim();

const normalizeReply = (reply = {}, index = 0) => ({
  id: Number(reply.id),
  name: clean(reply.name),
  message: clean(reply.message),
  is_active: reply.is_active !== false,
  sort_order: Number(reply.sort_order ?? index),
});

const responseReplies = (payload = {}) => asArray(payload?.quick_replies || payload?.data?.quick_replies).map(normalizeReply);

export const resolveQuickReplyMessage = (message = "", customerName = "") => {
  const fullName = clean(customerName) || "there";
  const firstName = fullName.split(/\s+/).filter(Boolean)[0] || fullName;
  return String(message || "")
    .replace(/{{\s*(?:name|customer_name)\s*}}/gi, fullName)
    .replace(/{{\s*first_name\s*}}/gi, firstName);
};

export function useQuickReplies({ headers, tenantId } = {}) {
  const { t } = useTranslation();
  const [quickReplies, setQuickReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!tenantId) return;
    if (!silent) setLoading(true);
    try {
      const payload = await api.get("/ai-inbox/quick-replies", {
        params: { tenant_id: tenantId, include_inactive: "true" },
        headers,
      });
      setQuickReplies(responseReplies(payload));
    } catch (error) {
      if (!silent) toast.error(error?.message || t("aiSupport.quickReplies.loadError"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [headers, t, tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createReply = useCallback(async (input) => {
    setSaving(true);
    try {
      const payload = await api.post("/ai-inbox/quick-replies", { ...input, tenant_id: tenantId }, { headers });
      const created = normalizeReply(payload?.quick_reply || payload?.data?.quick_reply, quickReplies.length);
      setQuickReplies((current) => [...current, created]);
      toast.success(t("aiSupport.quickReplies.added"));
      return created;
    } finally {
      setSaving(false);
    }
  }, [headers, quickReplies.length, t, tenantId]);

  const updateReply = useCallback(async (id, patch) => {
    setSaving(true);
    try {
      const payload = await api.patch(`/ai-inbox/quick-replies/${encodeURIComponent(id)}`, { ...patch, tenant_id: tenantId }, { headers });
      const updated = normalizeReply(payload?.quick_reply || payload?.data?.quick_reply);
      setQuickReplies((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(t("aiSupport.quickReplies.updated"));
      return updated;
    } finally {
      setSaving(false);
    }
  }, [headers, t, tenantId]);

  const deleteReply = useCallback(async (id) => {
    setSaving(true);
    try {
      await api.delete(`/ai-inbox/quick-replies/${encodeURIComponent(id)}`, { params: { tenant_id: tenantId }, headers });
      setQuickReplies((current) => current.filter((item) => item.id !== Number(id)));
      toast.success(t("aiSupport.quickReplies.deleted"));
    } finally {
      setSaving(false);
    }
  }, [headers, t, tenantId]);

  const reorderReplies = useCallback(async (ordered) => {
    const normalized = ordered.map((item, index) => ({ ...item, sort_order: index }));
    const previous = quickReplies;
    setQuickReplies(normalized);
    setSaving(true);
    try {
      const payload = await api.put("/ai-inbox/quick-replies/reorder", {
        tenant_id: tenantId,
        ordered_ids: normalized.map((item) => item.id),
      }, { headers });
      setQuickReplies(responseReplies(payload));
    } catch (error) {
      setQuickReplies(previous);
      throw error;
    } finally {
      setSaving(false);
    }
  }, [headers, quickReplies, tenantId]);

  return { quickReplies, loading, saving, load, createReply, updateReply, deleteReply, reorderReplies };
}

export function QuickRepliesPicker({ replies = [], customerName = "", onUse, light = false }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const activeReplies = useMemo(() => asArray(replies).filter((reply) => reply.is_active !== false), [replies]);
  const visibleReplies = useMemo(() => {
    const needle = clean(query).toLowerCase();
    return activeReplies.filter((reply) => !needle || `${reply.name} ${reply.message}`.toLowerCase().includes(needle));
  }, [activeReplies, query]);

  if (!activeReplies.length) return null;
  return (
    <div className="mb-2" data-ai-inbox-quick-replies="true">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-8 items-center gap-2 rounded-xl border px-3 text-[11px] font-black transition ${light ? "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100" : "border-amber-300/25 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"}`}
        aria-expanded={open}
      >
        <Zap className="h-3.5 w-3.5" />
        {t("aiSupport.quickReplies.title")}
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${light ? "bg-slate-200 text-slate-700" : "bg-amber-300/15 text-amber-100"}`}>{activeReplies.length}</span>
      </button>
      {open ? (
        <div className={`mt-2 overflow-hidden rounded-2xl border shadow-xl ${light ? "border-slate-200 bg-white" : "border-white/10 bg-[#181b18]"}`}>
          <div className={`flex items-center gap-2 border-b px-3 py-2 ${light ? "border-slate-200" : "border-white/10"}`}>
            <Search className={`h-4 w-4 ${light ? "text-slate-400" : "text-slate-500"}`} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("aiSupport.quickReplies.searchPlaceholder")} className={`min-w-0 flex-1 border-0 bg-transparent text-xs outline-none ${light ? "text-slate-900 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`} />
            <span className={`text-[10px] ${light ? "text-slate-400" : "text-slate-500"}`}>{t("aiSupport.quickReplies.available", { count: visibleReplies.length })}</span>
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5">
            {visibleReplies.map((reply) => (
              <button
                key={reply.id}
                type="button"
                onClick={() => {
                  onUse?.(resolveQuickReplyMessage(reply.message, customerName), reply);
                  setOpen(false);
                  setQuery("");
                }}
                className={`group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${light ? "hover:bg-slate-50" : "hover:bg-white/[0.06]"}`}
              >
                <Zap className={`mt-0.5 h-4 w-4 shrink-0 ${light ? "text-amber-500" : "text-amber-300"}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-black ${light ? "text-slate-900" : "text-white"}`}>{reply.name}</span>
                  <span className={`mt-0.5 block truncate text-[11px] ${light ? "text-slate-500" : "text-slate-400"}`}>{resolveQuickReplyMessage(reply.message, customerName)}</span>
                </span>
                <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-400 opacity-0 transition group-hover:opacity-100" />
              </button>
            ))}
            {!visibleReplies.length ? <div className={`px-3 py-6 text-center text-xs ${light ? "text-slate-400" : "text-slate-500"}`}>{t("aiSupport.quickReplies.noMatching")}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuickRepliesConfig({ open, onClose, replies = [], loading = false, saving = false, onCreate, onUpdate, onDelete, onReorder, light = false }) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ name: "", message: "", is_active: true });
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraft({ name: "", message: "", is_active: true });
    }
  }, [open]);

  if (!open) return null;
  const startCreate = () => {
    setEditingId("new");
    setDraft({ name: "", message: "", is_active: true });
  };
  const startEdit = (reply) => {
    setEditingId(reply.id);
    setDraft({ name: reply.name, message: reply.message, is_active: reply.is_active !== false });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ name: "", message: "", is_active: true });
  };
  const saveDraft = async () => {
    if (!clean(draft.name) || !clean(draft.message)) return toast.error(t("aiSupport.quickReplies.required"));
    try {
      if (editingId === "new") await onCreate?.(draft);
      else await onUpdate?.(editingId, draft);
      cancelEdit();
    } catch (error) {
      toast.error(error?.message || t("aiSupport.quickReplies.saveError"));
    }
  };
  const move = async (id, direction) => {
    const index = replies.findIndex((reply) => reply.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= replies.length) return;
    const ordered = [...replies];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    try {
      await onReorder?.(ordered);
    } catch (error) {
      toast.error(error?.message || t("aiSupport.quickReplies.reorderError"));
    }
  };
  const dropBefore = async (targetId) => {
    if (!draggedId || draggedId === targetId) return setDraggedId(null);
    const ordered = [...replies];
    const from = ordered.findIndex((item) => item.id === draggedId);
    const to = ordered.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return setDraggedId(null);
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    setDraggedId(null);
    try {
      await onReorder?.(ordered);
    } catch (error) {
      toast.error(error?.message || t("aiSupport.quickReplies.reorderError"));
    }
  };

  return (
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-slate-950/75 p-3 backdrop-blur-sm md:items-center" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={`flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border shadow-[0_30px_100px_rgba(0,0,0,0.45)] ${light ? "border-slate-200 bg-white text-slate-900" : "border-white/10 bg-[#171a17] text-white"}`}>
        <header className={`flex items-center justify-between gap-3 border-b px-4 py-4 md:px-5 ${light ? "border-slate-200" : "border-white/10"}`}>
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${light ? "bg-slate-100 text-slate-700" : "bg-amber-400/10 text-amber-200"}`}><Settings className="h-5 w-5" /></span>
            <div><div className="text-lg font-black">{t("aiSupport.quickReplies.config")}</div><div className={`text-xs ${light ? "text-slate-500" : "text-slate-400"}`}>{t("aiSupport.quickReplies.subtitle")}</div></div>
          </div>
          <button type="button" onClick={onClose} className={`grid h-10 w-10 place-items-center rounded-xl ${light ? "bg-slate-100 text-slate-600" : "bg-white/[0.06] text-slate-300"}`}><X className="h-5 w-5" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className={`min-h-0 flex-1 overflow-y-auto p-3 md:p-4 ${light ? "bg-slate-50/70" : "bg-black/10"}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><div className="text-sm font-black">{t("aiSupport.quickReplies.title")}</div><div className={`text-[11px] ${light ? "text-slate-500" : "text-slate-400"}`}>{t("aiSupport.quickReplies.reorderHint")}</div></div>
              <button type="button" onClick={startCreate} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black ${light ? "bg-slate-900 text-white" : "bg-amber-400 text-slate-950"}`}><Plus className="h-4 w-4" /> {t("aiSupport.quickReplies.addReply")}</button>
            </div>
            {loading ? <div className="grid h-48 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-amber-400" /></div> : (
              <div className="space-y-2">
                {replies.map((reply, index) => (
                  <div
                    key={reply.id}
                    draggable={!saving}
                    onDragStart={() => setDraggedId(reply.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropBefore(reply.id)}
                    className={`flex items-start gap-2 rounded-2xl border p-3 transition ${draggedId === reply.id ? "opacity-45" : ""} ${light ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.035]"}`}
                  >
                    <GripVertical className={`mt-2 h-4 w-4 shrink-0 cursor-grab ${light ? "text-slate-300" : "text-slate-600"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-black">{reply.name}</span>{reply.is_active === false ? <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[9px] font-black text-slate-400">{t("aiSupport.quickReplies.disabled")}</span> : null}</div>
                      <div className={`mt-1 line-clamp-2 text-[11px] leading-5 ${light ? "text-slate-500" : "text-slate-400"}`}>{reply.message}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" disabled={index === 0 || saving} onClick={() => void move(reply.id, -1)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-500/10 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" disabled={index === replies.length - 1 || saving} onClick={() => void move(reply.id, 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-500/10 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => startEdit(reply)} className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500/10 text-sky-400"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => window.confirm(t("aiSupport.quickReplies.deleteConfirm", { name: reply.name })) && onDelete?.(reply.id).catch((error) => toast.error(error?.message || t("aiSupport.quickReplies.deleteError")))} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
                {!replies.length ? <div className={`rounded-2xl border border-dashed px-4 py-12 text-center text-sm ${light ? "border-slate-300 text-slate-400" : "border-white/10 text-slate-500"}`}>{t("aiSupport.quickReplies.empty")}</div> : null}
              </div>
            )}
          </div>

          <aside className={`w-full shrink-0 border-t p-4 md:w-[340px] md:border-l md:border-t-0 ${light ? "border-slate-200" : "border-white/10"}`}>
            {editingId ? (
              <div>
                <div className="text-sm font-black">{editingId === "new" ? t("aiSupport.quickReplies.addTitle") : t("aiSupport.quickReplies.editTitle")}</div>
                <label className={`mt-4 block text-[11px] font-black uppercase tracking-[0.12em] ${light ? "text-slate-500" : "text-slate-400"}`}>{t("aiSupport.quickReplies.name")}</label>
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} placeholder={t("aiSupport.quickReplies.namePlaceholder")} className={`mt-1 h-11 w-full rounded-xl border px-3 text-sm outline-none ${light ? "border-slate-200 bg-white" : "border-white/10 bg-black/20"}`} />
                <label className={`mt-4 block text-[11px] font-black uppercase tracking-[0.12em] ${light ? "text-slate-500" : "text-slate-400"}`}>{t("aiSupport.quickReplies.message")}</label>
                <textarea value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} maxLength={4000} placeholder={t("aiSupport.quickReplies.messagePlaceholder")} className={`mt-1 h-40 w-full resize-none rounded-xl border p-3 text-sm leading-6 outline-none ${light ? "border-slate-200 bg-white" : "border-white/10 bg-black/20"}`} />
                <div className={`mt-2 text-[10px] ${light ? "text-slate-400" : "text-slate-500"}`}>{t("aiSupport.quickReplies.variables")}: {"{{name}}"} / {"{{first_name}}"}</div>
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-bold"><input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 accent-amber-400" /> {t("aiSupport.quickReplies.availableToAgents")}</label>
                <div className="mt-5 flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void saveDraft()} className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-50 ${light ? "bg-slate-900 text-white" : "bg-amber-400 text-slate-950"}`}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("aiSupport.quickReplies.save")}</button>
                  <button type="button" onClick={cancelEdit} className="h-10 rounded-xl bg-slate-500/10 px-4 text-xs font-black">{t("aiSupport.quickReplies.cancel")}</button>
                </div>
              </div>
            ) : (
              <div className={`rounded-2xl border border-dashed p-6 text-center ${light ? "border-slate-300 text-slate-500" : "border-white/10 text-slate-400"}`}>
                <Zap className="mx-auto h-7 w-7 text-amber-400" />
                <div className="mt-3 text-sm font-black">{t("aiSupport.quickReplies.reusableTitle")}</div>
                <div className="mt-1 text-xs leading-5">{t("aiSupport.quickReplies.reusableDescription")}</div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

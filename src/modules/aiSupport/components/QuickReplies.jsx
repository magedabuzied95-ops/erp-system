import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Settings,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import { useTheme } from "../../../theme/useTheme";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value ?? "").trim();

const normalizeReply = (reply = {}, index = 0) => ({
  id: Number(reply.id),
  name: clean(reply.name),
  message: clean(reply.message),
  shortcut: clean(reply.shortcut),
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

export function QuickRepliesPicker({ replies = [], customerName = "", value = "", onUse, light: lightOverride }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const light = typeof lightOverride === "boolean" ? lightOverride : theme?.mode === "light";
  const slashMatch = String(value || "").match(/^\s*\/([^\n]*)$/);
  const query = slashMatch?.[1] || "";
  const activeReplies = useMemo(() => asArray(replies).filter((reply) => reply.is_active !== false), [replies]);
  const visibleReplies = useMemo(() => {
    const needle = clean(query).toLowerCase();
    const hasExactShortcut = /^\d+$/.test(needle) && activeReplies.some((reply) => reply.shortcut === needle);
    return activeReplies.filter((reply) => {
      if (!needle) return true;
      if (hasExactShortcut) return reply.shortcut === needle;
      return `${reply.shortcut} ${reply.name} ${reply.message}`.toLowerCase().includes(needle);
    });
  }, [activeReplies, query]);

  if (!activeReplies.length || !slashMatch) return null;
  return (
    <div className={`mb-2 overflow-hidden rounded-2xl border shadow-[0_16px_45px_rgba(55,42,15,0.16)] ${light ? "border-[#d8c89f] bg-[#fffdf8]" : "border-amber-300/20 bg-[#1a1d1a] shadow-black/30"}`} data-ai-inbox-quick-replies="true">
      <div className={`flex items-center gap-2 border-b px-3 py-2.5 ${light ? "border-[#e8dfcb] bg-[#f7f1e4]" : "border-white/10 bg-white/[0.035]"}`}>
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${light ? "bg-[#f2dfad] text-[#9b6c00]" : "bg-amber-400/10 text-amber-300"}`}><Zap className="h-3.5 w-3.5" /></span>
        <span className={`min-w-0 flex-1 text-xs font-black ${light ? "text-[#302b21]" : "text-white"}`}>{t("aiSupport.quickReplies.title")}</span>
        <span dir="ltr" className={`max-w-[45%] truncate rounded-lg px-2 py-1 font-mono text-[10px] ${light ? "bg-white text-[#7b6d52] ring-1 ring-[#e4d9c1]" : "bg-black/20 text-slate-400 ring-1 ring-white/10"}`}>/{query}</span>
        <span className={`rounded-full px-2 py-1 text-[9px] font-black ${light ? "bg-[#ead8aa] text-[#765000]" : "bg-amber-300/10 text-amber-200"}`}>{visibleReplies.length}</span>
      </div>
      <div className="max-h-56 overflow-y-auto p-1.5">
        {visibleReplies.map((reply) => (
          <button
            key={reply.id}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onUse?.(resolveQuickReplyMessage(reply.message, customerName), reply)}
            className={`group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${light ? "hover:bg-[#f8f0dd]" : "hover:bg-white/[0.06]"}`}
          >
            <span dir="ltr" className={`mt-0.5 inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-lg px-1.5 font-mono text-[10px] font-black ${light ? "bg-[#f2dfad] text-[#805800]" : "bg-amber-400/10 text-amber-200 ring-1 ring-amber-300/15"}`}>/{reply.shortcut}</span>
            <span className="min-w-0 flex-1">
              <span className={`block text-xs font-black ${light ? "text-[#28251f]" : "text-white"}`}>{reply.name}</span>
              <span className={`mt-0.5 block truncate text-[11px] ${light ? "text-[#746c5e]" : "text-slate-400"}`}>{resolveQuickReplyMessage(reply.message, customerName)}</span>
            </span>
            <Check className={`mt-1 h-4 w-4 shrink-0 opacity-0 transition group-hover:opacity-100 ${light ? "text-[#a67100]" : "text-emerald-400"}`} />
          </button>
        ))}
        {!visibleReplies.length ? <div className={`px-3 py-7 text-center text-xs ${light ? "text-[#8b816f]" : "text-slate-500"}`}>{t("aiSupport.quickReplies.noMatching")}</div> : null}
      </div>
    </div>
  );
}

export function QuickRepliesConfig({ open, onClose, replies = [], loading = false, saving = false, onCreate, onUpdate, onDelete, onReorder, light: lightOverride }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const light = typeof lightOverride === "boolean" ? lightOverride : theme?.mode === "light";
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({ shortcut: "", name: "", message: "", is_active: true });
  const [draggedId, setDraggedId] = useState(null);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraft({ shortcut: "", name: "", message: "", is_active: true });
    }
  }, [open]);

  if (!open) return null;
  const nextShortcut = () => {
    const used = new Set(asArray(replies).map((reply) => Number(reply.shortcut)).filter((value) => Number.isInteger(value) && value > 0));
    let candidate = 1;
    while (used.has(candidate) && candidate < 9999) candidate += 1;
    return String(candidate);
  };
  const startCreate = () => {
    setEditingId("new");
    setDraft({ shortcut: nextShortcut(), name: "", message: "", is_active: true });
  };
  const startEdit = (reply) => {
    setEditingId(reply.id);
    setDraft({ shortcut: reply.shortcut, name: reply.name, message: reply.message, is_active: reply.is_active !== false });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft({ shortcut: "", name: "", message: "", is_active: true });
  };
  const saveDraft = async () => {
    if (!clean(draft.name) || !clean(draft.message)) return toast.error(t("aiSupport.quickReplies.required"));
    if (!/^\d{1,4}$/.test(clean(draft.shortcut)) || Number(draft.shortcut) <= 0) return toast.error(t("aiSupport.quickReplies.shortcutInvalid"));
    const duplicate = asArray(replies).some((reply) => reply.id !== editingId && reply.shortcut === String(Number(draft.shortcut)));
    if (duplicate) return toast.error(t("aiSupport.quickReplies.shortcutDuplicate"));
    try {
      const payload = { ...draft, shortcut: String(Number(draft.shortcut)) };
      if (editingId === "new") await onCreate?.(payload);
      else await onUpdate?.(editingId, payload);
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
    <div className="fixed inset-0 z-[260] flex items-end justify-center bg-[#17130d]/60 p-3 backdrop-blur-sm md:items-center" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className={`flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border shadow-[0_30px_100px_rgba(47,35,12,0.36)] ${light ? "border-[#d8cba9] bg-[#f8f4eb] text-[#28251f]" : "border-amber-300/15 bg-[#181a18] text-white"}`}>
        <header className={`flex items-center justify-between gap-3 border-b px-4 py-4 md:px-5 ${light ? "border-[#ded4bd] bg-[#f5efe2]" : "border-white/10 bg-[#171917]"}`}>
          <div className="flex items-center gap-3">
            <span className={`grid h-11 w-11 place-items-center rounded-2xl ${light ? "bg-[#fff8e7] text-[#a87400] ring-1 ring-[#e6d4a6]" : "bg-amber-400/10 text-amber-200"}`}><Settings className="h-5 w-5" /></span>
            <div><div className="text-lg font-black">{t("aiSupport.quickReplies.config")}</div><div className={`text-xs ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.quickReplies.subtitle")}</div></div>
          </div>
          <button type="button" onClick={onClose} className={`grid h-10 w-10 place-items-center rounded-xl transition ${light ? "bg-white text-[#625b4d] ring-1 ring-[#e3dbc9] hover:bg-[#f5efe2]" : "bg-white/[0.06] text-slate-300 hover:bg-white/10"}`}><X className="h-5 w-5" /></button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className={`min-h-0 flex-1 overflow-y-auto p-3 md:p-4 ${light ? "bg-[#f3eee4]" : "bg-black/10"}`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div><div className="text-sm font-black">{t("aiSupport.quickReplies.title")}</div><div className={`text-[11px] ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.quickReplies.reorderHint")}</div></div>
              <button type="button" onClick={startCreate} className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-black transition ${light ? "bg-[#b98508] text-white hover:bg-[#9f7107]" : "bg-amber-400 text-slate-950"}`}><Plus className="h-4 w-4" /> {t("aiSupport.quickReplies.addReply")}</button>
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
                    className={`flex items-start gap-2 rounded-2xl border p-3 transition ${draggedId === reply.id ? "opacity-45" : ""} ${light ? "border-[#ddd3be] bg-[#fffdf9] hover:border-[#cdbb8f]" : "border-white/10 bg-white/[0.035]"}`}
                  >
                    <GripVertical className={`mt-2 h-4 w-4 shrink-0 cursor-grab ${light ? "text-[#b1a58e]" : "text-slate-600"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span dir="ltr" className={`rounded-lg px-2 py-0.5 font-mono text-[10px] font-black ${light ? "bg-[#f2dfad] text-[#805800]" : "bg-amber-400/10 text-amber-200"}`}>/{reply.shortcut}</span><span className="text-xs font-black">{reply.name}</span>{reply.is_active === false ? <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[9px] font-black text-slate-400">{t("aiSupport.quickReplies.disabled")}</span> : null}</div>
                      <div className={`mt-1 line-clamp-2 text-[11px] leading-5 ${light ? "text-[#746c5e]" : "text-slate-400"}`}>{reply.message}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button type="button" disabled={index === 0 || saving} onClick={() => void move(reply.id, -1)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-500/10 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" disabled={index === replies.length - 1 || saving} onClick={() => void move(reply.id, 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-slate-500/10 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => startEdit(reply)} className={`grid h-8 w-8 place-items-center rounded-lg ${light ? "bg-[#fff3d2] text-[#9a6a00]" : "bg-amber-400/10 text-amber-300"}`}><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => window.confirm(t("aiSupport.quickReplies.deleteConfirm", { name: reply.name })) && onDelete?.(reply.id).catch((error) => toast.error(error?.message || t("aiSupport.quickReplies.deleteError")))} className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500/10 text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                ))}
                {!replies.length ? <div className={`rounded-2xl border border-dashed px-4 py-12 text-center text-sm ${light ? "border-[#d8c9a7] bg-[#fffaf0] text-[#746b5b]" : "border-white/10 text-slate-500"}`}>{t("aiSupport.quickReplies.empty")}</div> : null}
              </div>
            )}
          </div>

          <aside className={`w-full shrink-0 border-t p-4 md:w-[340px] md:border-l md:border-t-0 ${light ? "border-[#ddd1b6] bg-[#fbf8f1]" : "border-white/10"}`}>
            {editingId ? (
              <div>
                <div className="text-sm font-black">{editingId === "new" ? t("aiSupport.quickReplies.addTitle") : t("aiSupport.quickReplies.editTitle")}</div>
                <label className={`mt-4 block text-[11px] font-black uppercase tracking-[0.12em] ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.quickReplies.shortcut")}</label>
                <div dir="ltr" className={`mt-1 flex h-11 items-center overflow-hidden rounded-xl border transition ${light ? "border-[#ddd1b6] bg-white text-[#28251f] focus-within:border-[#b98508]" : "border-white/10 bg-black/20"}`}>
                  <span className={`grid h-full w-10 place-items-center border-r font-mono text-sm font-black ${light ? "border-[#e6ddca] bg-[#f7f1e4] text-[#9a6a00]" : "border-white/10 bg-white/[0.04] text-amber-300"}`}>/</span>
                  <input value={draft.shortcut} onChange={(event) => setDraft((current) => ({ ...current, shortcut: event.target.value.replace(/\D/g, "").slice(0, 4) }))} inputMode="numeric" maxLength={4} placeholder="1" className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 font-mono text-sm font-black outline-none" />
                </div>
                <div className={`mt-1 text-[10px] ${light ? "text-[#8b816f]" : "text-slate-500"}`}>{t("aiSupport.quickReplies.shortcutHint")}</div>
                <label className={`mt-4 block text-[11px] font-black uppercase tracking-[0.12em] ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.quickReplies.name")}</label>
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} placeholder={t("aiSupport.quickReplies.namePlaceholder")} className={`mt-1 h-11 w-full rounded-xl border px-3 text-sm outline-none transition ${light ? "border-[#ddd1b6] bg-white text-[#28251f] focus:border-[#b98508]" : "border-white/10 bg-black/20"}`} />
                <label className={`mt-4 block text-[11px] font-black uppercase tracking-[0.12em] ${light ? "text-[#756c5b]" : "text-slate-400"}`}>{t("aiSupport.quickReplies.message")}</label>
                <textarea value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} maxLength={4000} placeholder={t("aiSupport.quickReplies.messagePlaceholder")} className={`mt-1 h-40 w-full resize-none rounded-xl border p-3 text-sm leading-6 outline-none transition ${light ? "border-[#ddd1b6] bg-white text-[#28251f] focus:border-[#b98508]" : "border-white/10 bg-black/20"}`} />
                <div className={`mt-2 text-[10px] ${light ? "text-slate-400" : "text-slate-500"}`}>{t("aiSupport.quickReplies.variables")}: {"{{name}}"} / {"{{first_name}}"}</div>
                <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs font-bold"><input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} className="h-4 w-4 accent-amber-400" /> {t("aiSupport.quickReplies.availableToAgents")}</label>
                <div className="mt-5 flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void saveDraft()} className={`inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-xs font-black disabled:opacity-50 ${light ? "bg-[#b98508] text-white" : "bg-amber-400 text-slate-950"}`}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t("aiSupport.quickReplies.save")}</button>
                  <button type="button" onClick={cancelEdit} className="h-10 rounded-xl bg-slate-500/10 px-4 text-xs font-black">{t("aiSupport.quickReplies.cancel")}</button>
                </div>
              </div>
            ) : (
              <div className={`rounded-2xl border border-dashed p-6 text-center ${light ? "border-[#d8c9a7] bg-[#fffaf0] text-[#746b5b]" : "border-white/10 text-slate-400"}`}>
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

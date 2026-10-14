import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Tag, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value ?? "").trim();

/*
 * Tags on the PERSON ("VIP", "جملة", "بيرجّع كتير"), saved on the customers row,
 * so they are the same on WhatsApp, Instagram and at the till. The suggestions
 * are the tags the shop already uses, most common first, so the team converges
 * on one spelling instead of five.
 */
export default function CustomerTagsEditor({ customerId = "", tags = [], onChange, headers, light = true, compact = false }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(() => asArray(tags));
  const [draft, setDraft] = useState("");
  const [catalog, setCatalog] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    setValue(asArray(tags));
  }, [tags]);

  useEffect(() => {
    let cancelled = false;
    api.get("/customers/tags", { headers })
      .then((payload) => {
        if (!cancelled) setCatalog(asArray(payload?.tags).map((item) => clean(item?.tag || item)).filter(Boolean));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [headers]);

  const persist = useCallback(async (next) => {
    if (!customerId) return;
    setSaving(true);
    setError("");
    try {
      const payload = await api.put(`/customers/${encodeURIComponent(customerId)}/tags`, { tags: next }, { headers });
      const saved = asArray(payload?.tags);
      setValue(saved);
      onChange?.(saved);
    } catch (err) {
      setError(err?.message || t("aiSupport.teamTools.tags.saveError"));
    } finally {
      setSaving(false);
    }
  }, [customerId, headers, onChange, t]);

  const add = useCallback((raw) => {
    const tag = clean(raw).replace(/\s+/g, " ").slice(0, 40);
    if (!tag) return;
    if (value.some((item) => item.toLowerCase() === tag.toLowerCase())) {
      setDraft("");
      return;
    }
    const next = [...value, tag];
    setValue(next);
    setDraft("");
    void persist(next);
  }, [persist, value]);

  const remove = useCallback((tag) => {
    const next = value.filter((item) => item !== tag);
    setValue(next);
    void persist(next);
  }, [persist, value]);

  const suggestions = useMemo(() => {
    const needle = clean(draft).toLowerCase();
    return catalog
      .filter((tag) => !value.some((item) => item.toLowerCase() === tag.toLowerCase()))
      .filter((tag) => !needle || tag.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [catalog, draft, value]);

  if (!customerId) {
    return (
      <div className={`rounded-xl border border-dashed px-3 py-2 text-[11px] ${light ? "border-slate-300 text-slate-500" : "border-white/15 text-slate-400"}`}>
        {t("aiSupport.teamTools.tags.noCustomer")}
      </div>
    );
  }

  return (
    <div data-customer-tags="editor" className={compact ? "" : `rounded-2xl border p-3 ${light ? "border-[#E2E8F0] bg-white" : "border-white/10 bg-white/[0.04]"}`}>
      <div className={`mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] ${light ? "text-slate-500" : "text-slate-400"}`}>
        <Tag className="h-3.5 w-3.5" aria-hidden="true" />
        {t("aiSupport.teamTools.tags.title")}
        {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <span key={tag} className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-black ${light ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : "bg-amber-400/15 text-amber-100 ring-1 ring-amber-300/25"}`}>
            {tag}
            <button type="button" onClick={() => remove(tag)} disabled={saving} aria-label={t("aiSupport.teamTools.tags.remove", { tag })} className="grid h-4 w-4 place-items-center rounded-full opacity-70 hover:opacity-100 disabled:opacity-40">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <span className={`inline-flex h-7 min-w-[120px] items-center gap-1 rounded-full border px-2 ${light ? "border-slate-300 bg-white" : "border-white/15 bg-black/20"}`}>
          <Plus className={`h-3 w-3 shrink-0 ${light ? "text-slate-400" : "text-slate-500"}`} aria-hidden="true" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                add(draft);
              }
            }}
            disabled={saving}
            placeholder={t("aiSupport.teamTools.tags.placeholder")}
            className={`h-full min-w-0 flex-1 bg-transparent text-[11px] font-bold outline-none ${light ? "text-slate-800 placeholder:text-slate-400" : "text-white placeholder:text-slate-500"}`}
          />
        </span>
      </div>
      {suggestions.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {suggestions.map((tag) => (
            <button key={tag} type="button" onClick={() => add(tag)} disabled={saving} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${light ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-white/[0.06] text-slate-300 hover:bg-white/10"}`}>
              + {tag}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <div className="mt-2 text-[11px] font-bold text-rose-500">{error}</div> : null}
    </div>
  );
}

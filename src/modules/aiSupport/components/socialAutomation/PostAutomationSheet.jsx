import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "../../../../shared/api/api";
import AutomationSettingsPanel from "./AutomationSettingsPanel.jsx";
import { buildAutomationDraft, normalizeAutomationConfig, serializeAutomationDraft } from "./automationEngine.js";

const clean = (value = "") => String(value ?? "").trim();

/* The per-post automation switches, for the AI Inbox PWA.

   The desktop drawer lives inside SocialCommentsWorkspace and carries its load/save logic with it,
   so the PWA had no way to turn a post's automation on — or its "hide customer comments" switch.
   This is the phone's version: the SAME AutomationSettingsPanel, the SAME engine functions for the
   draft, the merge and the payload, and the same GET/PUT the desktop uses. Nothing here decides
   what a switch means.

   Each tap saves on its own and the switches lock while it does. A phone has no "save draft"
   moment to forget, and two PUTs in flight could land out of order and show a state that is not
   the one saved. After every save it READS BACK, and draws what the server returned — the same
   read-back that exposed the bug where saved switches flipped back a few seconds later. */

const routePostIdFor = (post = {}) =>
  clean(
    post?.canonical_post_id ||
      post?.canonicalPostId ||
      post?.final_canonical_post_id ||
      post?.post_id ||
      post?.postId ||
      post?.id ||
      ""
  );

export default function PostAutomationSheet({ open = false, post = null, tenantId = "", onClose }) {
  const routePostId = routePostIdFor(post || {});
  const platform = clean(post?.platform || post?.source_platform || "facebook").toLowerCase() || "facebook";
  const [draft, setDraft] = useState(() => buildAutomationDraft(post || {}));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const requestRef = useRef(0);
  // The post is only a fallback for defaults. Held in a ref so a parent that hands over a fresh
  // object on every render cannot turn the load effect into a reload loop.
  const postRef = useRef(post);
  postRef.current = post;

  const readBack = useCallback(async () => {
    const payload = await api.get(`/social-comments/automation/${encodeURIComponent(routePostId)}`, {
      params: { tenant_id: tenantId, platform },
    });
    const config = payload?.config || payload?.data || payload || {};
    return normalizeAutomationConfig(config, postRef.current || {});
  }, [routePostId, tenantId, platform]);

  useEffect(() => {
    if (!open || !routePostId) return undefined;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setLoadError("");
    readBack()
      .then((normalized) => {
        if (requestRef.current === requestId) setDraft(normalized);
      })
      .catch((error) => {
        if (requestRef.current === requestId) setLoadError(error?.message || "تعذر تحميل إعدادات البوست");
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false);
      });
    return undefined;
  }, [open, routePostId, readBack]);

  const handleChange = useCallback(
    async (patch = {}) => {
      if (saving || loading || !routePostId) return;
      const previous = draft;
      const next = { ...draft, ...patch };
      setDraft(next);
      setSaving(true);
      try {
        await api.put(`/social-comments/automation/${encodeURIComponent(routePostId)}`, {
          tenant_id: tenantId,
          platform,
          canonical_post_id: routePostId,
          post_id: routePostId,
          ...serializeAutomationDraft(next, postRef.current || {}),
        });
        const saved = await readBack();
        setDraft(saved);
        // The server is the judge. If it did not keep a switch, say so instead of letting the
        // screen agree with a state that was never stored.
        const lost = Object.keys(patch).filter((key) => Boolean(saved?.[key]) !== Boolean(patch[key]));
        if (lost.length) toast.error("الإعداد ما اتحفظش — جرّب تاني");
      } catch (error) {
        setDraft(previous);
        toast.error(error?.message || "تعذر حفظ الإعداد");
      } finally {
        setSaving(false);
      }
    },
    [draft, loading, platform, readBack, routePostId, saving, tenantId]
  );

  if (!open) return null;

  const caption = clean(post?.caption || post?.message || post?.title || post?.post_message || "");
  const productName = clean(post?.product_name || post?.primary_product?.name || post?.linked_products?.[0]?.name || "");

  return (
    <div className="fixed inset-0 z-[80]" dir="rtl">
      <button
        type="button"
        aria-label="إغلاق إعدادات الأتمتة"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
      />
      <aside className="absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col overflow-hidden rounded-t-[28px] border-t border-white/10 bg-slate-950 shadow-[0_24px_80px_rgba(0,0,0,0.32)]">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-black text-slate-400">الأتمتة</div>
            <div className="mt-1 line-clamp-2 text-sm font-black text-white">{caption || "البوست"}</div>
            {productName ? (
              <span className="mt-2 inline-flex rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-black text-emerald-100">
                {productName}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-200"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm font-black text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              بيحمّل إعدادات البوست…
            </div>
          ) : loadError ? (
            <div className="rounded-2xl border border-rose-300/30 bg-rose-400/10 p-3 text-sm font-black text-rose-100">{loadError}</div>
          ) : (
            <div className={saving ? "pointer-events-none opacity-70" : ""}>
              <AutomationSettingsPanel settings={draft} onChange={handleChange} />
              <div className="mt-2 min-h-5 text-center text-[11px] font-black text-slate-400">
                {saving ? "بيحفظ…" : "كل مفتاح بيتحفظ لوحده أول ما تدوس عليه"}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

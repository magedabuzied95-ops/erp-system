import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { api } from "../../shared/api/api";

const clean = (value = "") => String(value || "").trim();
const isRtlText = (value = "") => /[\u0600-\u06ff]/.test(String(value || ""));

function StatusPill({ children, tone = "slate" }) {
  const tones = {
    emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-100",
    violet: "border-violet-400/20 bg-violet-400/10 text-violet-100",
    slate: "border-white/10 bg-white/[0.055] text-slate-300",
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black ${tones[tone] || tones.slate}`}>
      {children}
    </span>
  );
}

export default function AISuggestedReplies({
  conversationId,
  channelId,
  platform,
  lastCustomerMessage,
  productId,
  onUseSuggestion,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [meta, setMeta] = useState({});

  if (!conversationId || !clean(lastCustomerMessage)) return null;

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await api.getAISuggestedReplies({
        conversationId,
        channelId,
        platform,
        message: lastCustomerMessage,
        productId,
      });
      setSuggestions(Array.isArray(payload.suggestions) ? payload.suggestions : []);
      setMeta(payload.meta || {});
    } catch (err) {
      setSuggestions([]);
      setMeta({});
      setError(err?.message || "Failed to generate AI suggestions");
    } finally {
      setLoading(false);
    }
  };

  const mode = clean(meta.effectiveMode);
  const modeNote = mode === "fully_automatic"
    ? "AI may auto-reply for this channel. Suggestions are for manual review."
    : mode
      ? "Suggest only mode: AI will not send automatically."
      : "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-400">
            <Sparkles className="h-4 w-4" />
            AI Suggested Replies
          </div>
          {modeNote ? <p className="mt-1 text-xs font-bold text-slate-500">{modeNote}</p> : null}
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={loading}
          className="inline-flex h-[var(--control-height-md)] items-center justify-center gap-2 rounded-xl border border-violet-300/20 bg-violet-400/10 px-3 text-xs font-black text-violet-100 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {suggestions.length ? "Regenerate" : "Generate AI suggestions"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {meta.intent ? <StatusPill tone="violet">Intent: {meta.intent}</StatusPill> : null}
        {meta.effectiveMode ? <StatusPill tone={meta.effectiveMode === "fully_automatic" ? "emerald" : "amber"}>Mode: {meta.effectiveMode}</StatusPill> : null}
        {meta.safetyReason ? <StatusPill>Safety: {meta.safetyReason}</StatusPill> : null}
      </div>

      {meta.escalated ? (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3 text-sm font-bold leading-6 text-amber-100">
          This conversation may need human attention. AI suggestions are review-only.
          <span className="block" dir="rtl">المحادثة دي محتاجة تدخل بشري. اقتراحات الذكاء الاصطناعي للمراجعة فقط.</span>
          {meta.escalationKeyword ? <span className="mt-1 block text-xs text-amber-200/80">Keyword: {meta.escalationKeyword}</span> : null}
        </div>
      ) : null}

      {error ? <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{error}</div> : null}

      {!suggestions.length && !error ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
          Generate 2-3 staff-only drafts from the latest customer message. Nothing is sent until you use and send it manually.
        </div>
      ) : null}

      {suggestions.length ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {suggestions.map((suggestion, index) => {
            const text = clean(suggestion?.text || suggestion);
            return (
              <div key={suggestion?.id || `${text}-${index}`} className="rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-slate-100">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-violet-200">{suggestion?.label || `Suggestion ${index + 1}`}</span>
                  {suggestion?.tone ? <StatusPill>{suggestion.tone}</StatusPill> : null}
                </div>
                <p dir={isRtlText(text) ? "rtl" : "auto"} className="whitespace-pre-wrap">{text}</p>
                <button
                  type="button"
                  onClick={() => onUseSuggestion?.(text)}
                  disabled={!text}
                  className="mt-3 h-[var(--control-height-md)] w-full rounded-lg border border-emerald-300/20 bg-emerald-400/10 text-xs font-black text-emerald-100 disabled:opacity-50"
                >
                  Use
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

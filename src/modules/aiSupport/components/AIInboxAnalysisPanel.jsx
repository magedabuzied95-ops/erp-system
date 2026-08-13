import { memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";

const AIInboxAnalysisPanel = memo(function AIInboxAnalysisPanel({ analysis, copilot, loading, cacheHit, onTrack, flags }) {
  const { t } = useTranslation();
  const viewedRef = useRef(new Set());
  useEffect(() => {
    if (!copilot) return;
    copilot.suggestions.forEach((suggestion) => {
      if (viewedRef.current.has(suggestion.id)) return;
      viewedRef.current.add(suggestion.id);
      onTrack(suggestion, "Suggestion Viewed");
    });
  }, [copilot, onTrack]);

  if (!flags.AI_ENABLED) return null;
  if (loading) return <div className="mb-2 animate-pulse rounded-2xl border border-slate-200 bg-white p-3"><div className="h-3 w-24 rounded bg-slate-200" /><div className="mt-3 h-8 rounded bg-slate-100" /></div>;
  if (!analysis) return null;
  const intelligence = analysis.conversation;
  const debug = typeof window !== "undefined" && Boolean(window.AI_DEBUG);

  return (
    <section className="mb-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" aria-label={t("aiSupport.inbox.analysis.intelligence")}>
      {intelligence ? (
        <div className="flex flex-wrap gap-1.5 text-[10px] font-black text-slate-700">
          <span className="rounded-full bg-slate-100 px-2 py-1">{intelligence.intent.join(" · ")}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1">{intelligence.customerMood}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1">{t("aiSupport.inbox.analysis.leadScore", { score: intelligence.leadScore })}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1">{intelligence.priority}</span>
          {intelligence.buyingSignals.map((signal) => <span key={signal} className="rounded-full bg-slate-100 px-2 py-1">{signal}</span>)}
          {intelligence.objections.map((objection) => <span key={objection} className="rounded-full bg-slate-100 px-2 py-1">{t("aiSupport.inbox.analysis.objection", { objection })}</span>)}
        </div>
      ) : null}
      {flags.COPILOT_ENABLED && copilot ? (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><Sparkles className="h-3.5 w-3.5" />{t("aiSupport.inbox.analysis.copilot")}</div>
          <ul className="mt-2 space-y-1 text-xs text-slate-700">{copilot.summary.map((item) => <li key={item}>• {item}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {copilot.suggestions.map((suggestion) => <button key={suggestion.id} type="button" onClick={() => onTrack(suggestion, "Suggestion Accepted")} className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-black text-slate-700">{suggestion.title}</button>)}
            {copilot.quickReplies.map((reply) => <button key={`${reply.intent}:${reply.title}`} type="button" onClick={() => onTrack(reply, "Quick Reply Used")} className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black text-slate-700">{reply.title}</button>)}
          </div>
          {copilot.warnings.length ? <div className="mt-2 text-[11px] font-semibold text-slate-600">{copilot.warnings.map((warning) => warning.title).join(" · ")}</div> : null}
          {copilot.recommendedActions.map((action) => <button key={action.action} type="button" disabled={!action.permitted} onClick={() => onTrack(action, "Recommendation Executed")} className="mt-2 mr-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-black text-slate-700 disabled:opacity-50">{action.action}</button>)}
        </div>
      ) : null}
      {debug ? (
        <details className="mt-3 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
          <summary className="cursor-pointer font-black">{t("aiSupport.inbox.analysis.debug")}</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ executionTime: analysis.executionTime, engineVersions: analysis.engineVersions, confidence: analysis.confidence, processingSteps: analysis.processingSteps, errors: analysis.errors.map(({ engine }) => ({ engine })), cacheStatus: cacheHit ? "hit" : "miss" }, null, 2)}</pre>
        </details>
      ) : null}
    </section>
  );
});

export default AIInboxAnalysisPanel;

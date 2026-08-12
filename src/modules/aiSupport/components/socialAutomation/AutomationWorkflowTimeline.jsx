import { Clock3, MessageCircle, ShoppingBag, Sparkles, ThumbsUp } from "lucide-react";

const stepIconMap = {
  "Comment Received": <MessageCircle className="h-4 w-4" />,
  "Resolve Product": <ShoppingBag className="h-4 w-4" />,
  "Like Comment": <ThumbsUp className="h-4 w-4" />,
  "Public Reply": <Sparkles className="h-4 w-4" />,
  "Private Message": <MessageCircle className="h-4 w-4" />,
  "AI Conversation": <Sparkles className="h-4 w-4" />,
  "Lead Created": <ShoppingBag className="h-4 w-4" />,
  "Order Opportunity": <Clock3 className="h-4 w-4" />,
};

export default function AutomationWorkflowTimeline({ steps = [], state = {} }) {
  const orderedSteps = Array.isArray(steps) ? steps : [];

  return (
    <section className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Workflow Timeline</div>
      <div className="mt-1 text-sm font-black text-white">ManyChat-style flow preview</div>

      <div className="mt-3 space-y-2">
        {orderedSteps.map((step, index) => {
          const active = Boolean(state?.[step]);
          return (
            <div
              key={step}
              className={`flex items-start gap-3 rounded-2xl border p-3 ${ active ? "border-cyan-300/30 bg-cyan-300/10" : "border-white/10 bg-white/[0.03]" }`}
            >
              <div className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${ active ? "border-cyan-300/30 bg-cyan-300 text-slate-950" : "border-white/10 bg-white/[0.05] text-slate-300" }`}>
                {stepIconMap[step] || <span className="text-[11px] font-black">{index + 1}</span>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black text-white">{step}</div>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ${ active ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-slate-400" }`}>
                    {active ? "Enabled" : "Idle"}
                  </span>
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-400">
                  {step === "Comment Received"
                    ? "Trigger a workflow when a comment is detected."
                    : step === "Resolve Product"
                      ? "Resolve the linked product from the post metadata."
                      : step === "Like Comment"
                        ? "Optionally like the comment before replying."
                        : step === "Public Reply"
                          ? "Send a public acknowledgment or sales response."
                          : step === "Private Message"
                            ? "Send the private follow-up using the existing delivery flow."
                            : step === "AI Conversation"
                              ? "Continue the conversation with an AI opening prompt."
                              : step === "Lead Created"
                                ? "Create a CRM lead when intent is high."
                                : "Track the order opportunity and move it forward."}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}


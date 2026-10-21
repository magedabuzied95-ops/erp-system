import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GitBranch, Loader2, Pencil, UserRound } from "lucide-react";
import ConversationLabelsModal from "./ConversationLabelsModal";
import { aiInboxLabelsFromConversation } from "../../../../shared/aiInboxConversationLabels.js";

/*
 * Customer 360's conversation card: the three things the inbox filter panel
 * filters by that an operator sets by hand — the stage, the labels and who
 * owns the thread. Each one saves through the inbox's own handler, so the list
 * row, the header chips and the filters all see the same value.
 */

const LABEL_DOTS = { sky: "#0ea5e9", cyan: "#06b6d4", amber: "#f59e0b", violet: "#8b5cf6", emerald: "#10b981", rose: "#f43f5e", orange: "#f97316", teal: "#14b8a6" };

export default function ConversationCrmCard({
  conversation = null,
  stageOptions = [],
  currentStage = "new",
  busy = "",
  onStageChange,
  onLabelsChange,
  onAssign,
}) {
  const { t } = useTranslation();
  const [labelsOpen, setLabelsOpen] = useState(false);
  if (!conversation) return null;
  const labels = aiInboxLabelsFromConversation(conversation);
  const assignedName = String(conversation.assigned_user_name || conversation.assigned_user?.name || "").trim();
  const sectionTitle = "mb-1.5 text-[11px] font-black text-slate-500";

  return (
    <div data-customer-360="conversation-crm" className="rounded-2xl border border-[#E2E8F0] bg-white p-3">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
        {t("aiSupport.inbox.crmCard.title")}
        {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
      </div>

      <div className="space-y-3">
        <div>
          <div className={sectionTitle}>{t("aiSupport.inbox.crmCard.stage")}</div>
          <div role="radiogroup" aria-label={t("aiSupport.inbox.crmCard.stage")} className="flex flex-wrap gap-1.5">
            {stageOptions.map((stage) => {
              const on = stage.id === currentStage;
              return (
                <button
                  key={stage.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={Boolean(busy) || on}
                  onClick={() => onStageChange?.(stage.id)}
                  className={`h-7 rounded-full px-2.5 text-[11px] font-black transition disabled:cursor-default ${on ? "bg-primary text-primary-foreground" : "bg-slate-100 text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300"}`}
                >
                  {stage.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className={sectionTitle.replace("mb-1.5 ", "")}>{t("aiSupport.inbox.crmCard.labels")}</span>
            <button type="button" onClick={() => setLabelsOpen(true)} disabled={Boolean(busy)} className="inline-flex items-center gap-1 text-[11px] font-black text-primary hover:underline disabled:opacity-50">
              <Pencil className="h-3 w-3" aria-hidden="true" />
              {t("aiSupport.inbox.crmCard.editLabels")}
            </button>
          </div>
          {labels.length ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => (
                <span key={label.id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-slate-100 px-2.5 text-[11px] font-black text-slate-700 ring-1 ring-slate-200">
                  <span className="h-2 w-2 rounded-full" style={{ background: LABEL_DOTS[label.color] || "#94a3b8" }} />
                  {label.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500">{t("aiSupport.inbox.crmCard.noLabels")}</p>
          )}
        </div>

        <div>
          <div className={sectionTitle}>{t("aiSupport.inbox.crmCard.owner")}</div>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-700">
              <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="truncate">{assignedName || t("aiSupport.inbox.filterPanel.unassigned")}</span>
            </span>
            {onAssign ? (
              <button type="button" onClick={() => onAssign()} className="shrink-0 text-[11px] font-black text-primary hover:underline">
                {t(assignedName ? "aiSupport.inbox.crmCard.reassign" : "aiSupport.inbox.crmCard.assign")}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <ConversationLabelsModal
        open={labelsOpen}
        labels={labels}
        saving={busy === "labels"}
        onClose={() => setLabelsOpen(false)}
        onSave={onLabelsChange}
      />
    </div>
  );
}

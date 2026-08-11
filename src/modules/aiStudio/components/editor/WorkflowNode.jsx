import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, ShieldAlert, Check, X } from "lucide-react";
import { NODE_META } from "../../lib/workflowGraph";
import { NODE_ICON, ACCENT, RISK_BADGE, EXEC_RING, EXEC_LABEL, EXEC_ICON, EXEC_BADGE, DisconnectedIcon } from "./nodeKit";

// One custom node renderer for every semantic type (xyflow passes `type`).
// Purely presentational — reads data prepared by the editor page.
function WorkflowNodeBase({ type, data, selected }) {
  const meta = NODE_META[type] || NODE_META.end;
  const accent = ACCENT[meta.accent] || ACCENT.slate;
  const Icon = NODE_ICON[meta.icon] || NODE_ICON.Flag;
  const cfg = data?.config || {};
  const toolMeta = data?.toolMeta || null;
  const execState = data?.execState || null;
  const disconnected = data?.disconnected || false;
  const warnings = data?.warnings || [];
  const errors = data?.errors || [];
  const hasTool = type === "tool" || type === "action";
  const isSensitive = toolMeta?.riskLevel === "SENSITIVE";
  const displayName = cfg.label || toolMeta?.name || meta.label;

  const ring = execState
    ? EXEC_RING[execState] || ""
    : errors.length
    ? "ring-2 ring-rose-500/80"
    : selected
    ? "ring-2 ring-white/60"
    : "";

  const ExecIcon = execState ? EXEC_ICON[execState] : null;

  return (
    <div
      className={`w-[248px] rounded-2xl border ${accent.border} bg-slate-950/90 shadow-[0_12px_34px_rgba(0,0,0,0.4)] backdrop-blur transition ${ring} ${
        selected ? "border-white/40" : ""
      } ${disconnected && !execState ? "opacity-90" : ""}`}
      dir="ltr"
    >
      {type !== "trigger" ? <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white/50 !bg-slate-700" /> : null}

      {/* header */}
      <div className="flex items-center gap-2.5 rounded-t-2xl border-b border-white/10 px-3 py-2.5">
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${accent.chip}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-black leading-tight text-white">{displayName}</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{meta.label}</div>
        </div>
        {execState && ExecIcon ? (
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${EXEC_BADGE[execState] || ""}`}>
            <ExecIcon className={`h-3 w-3 ${execState === "running" ? "animate-spin" : ""}`} />
            {EXEC_LABEL[execState] || execState}
          </span>
        ) : null}
      </div>

      {/* body */}
      <div className="space-y-1.5 px-3 py-2.5 text-[11px] text-slate-300">
        {type === "trigger" ? <div className="text-slate-400">Runs <span className="font-bold text-slate-200">{cfg.triggerType || "manually"}</span></div> : null}
        {type === "agent" ? <div className="text-slate-400">{cfg.mode === "llm_grounded" ? "LLM grounded" : "Read-only analysis"}</div> : null}
        {type === "condition" ? (
          <div className="truncate font-mono text-[10px] text-slate-200" title={`${cfg.condition?.left || "?"} ${cfg.condition?.op || "?"} ${cfg.condition?.right ?? ""}`}>
            {cfg.condition?.left || "path?"} <span className="text-amber-200">{cfg.condition?.op || "op?"}</span>
          </div>
        ) : null}
        {type === "approval" ? <div className="text-slate-400">Pauses for human approval</div> : null}
        {type === "end" ? <div className="text-slate-500">Ends this path</div> : null}
        {hasTool ? (
          <div className="space-y-1.5">
            {toolMeta ? <div className="text-slate-400">{toolMeta.description ? toolMeta.description.slice(0, 70) : ""}</div> : <div className="text-rose-200">No tool selected</div>}
            {toolMeta ? (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${RISK_BADGE[toolMeta.riskLevel] || RISK_BADGE.READ}`}>
                {toolMeta.riskLevel === "READ" ? "Read only" : toolMeta.riskLevel === "WRITE" ? "Writes data" : "Approval required"}
              </span>
            ) : null}
          </div>
        ) : null}

        {isSensitive || type === "approval" ? (
          <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-rose-100">
            <ShieldAlert className="h-3 w-3" /> Human approval required
          </div>
        ) : null}

        {/* Disconnected-from-trigger warning (editor UX; icon + text, not colour alone) */}
        {disconnected && !execState ? (
          <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-100">
            <DisconnectedIcon className="h-3 w-3" /> Not in path — won’t run
          </div>
        ) : null}

        {errors.length ? (
          <div className="mt-1 flex items-start gap-1 rounded-lg border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-[9px] font-bold text-rose-100">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{errors[0]}</span>
          </div>
        ) : warnings.length && !disconnected ? (
          <div className="mt-1 flex items-start gap-1 rounded-lg border border-amber-300/40 bg-amber-300/10 px-2 py-1 text-[9px] font-bold text-amber-100">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{warnings[0]}</span>
          </div>
        ) : null}
      </div>

      {/* source handles */}
      {type === "condition" ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "40%" }} className="!h-3 !w-3 !border-2 !border-emerald-300/70 !bg-emerald-500" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: "72%" }} className="!h-3 !w-3 !border-2 !border-rose-300/70 !bg-rose-500" />
          <span className="pointer-events-none absolute right-2 top-[34%] inline-flex items-center gap-0.5 text-[8px] font-black text-emerald-300"><Check className="h-2.5 w-2.5" />True</span>
          <span className="pointer-events-none absolute right-2 top-[66%] inline-flex items-center gap-0.5 text-[8px] font-black text-rose-300"><X className="h-2.5 w-2.5" />False</span>
        </>
      ) : type !== "end" ? (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white/50 !bg-slate-500" />
      ) : null}
    </div>
  );
}

const WorkflowNode = memo(WorkflowNodeBase);
export default WorkflowNode;

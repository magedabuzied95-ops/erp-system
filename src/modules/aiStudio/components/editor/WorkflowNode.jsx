import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { NODE_META, RISK_META } from "../../lib/workflowGraph";
import { NODE_ICON, ACCENT, RISK_BADGE, EXEC_RING, EXEC_LABEL } from "./nodeKit";

// A single custom node renderer for every semantic type (xyflow passes `type`).
// Purely presentational — it reads data prepared by the editor page.
function WorkflowNodeBase({ type, data, selected }) {
  const meta = NODE_META[type] || NODE_META.end;
  const accent = ACCENT[meta.accent] || ACCENT.slate;
  const Icon = NODE_ICON[meta.icon] || NODE_ICON.Flag;
  const cfg = data?.config || {};
  const toolMeta = data?.toolMeta || null; // { riskLevel, requiredPermission, requiresApproval, executable, name }
  const execState = data?.execState || null;
  const errors = data?.errors || [];
  const hasTool = type === "tool" || type === "action";
  const isSensitive = toolMeta?.riskLevel === "SENSITIVE";
  const displayName = cfg.label || toolMeta?.name || meta.label;

  const ring = execState ? EXEC_RING[execState] || "" : errors.length ? "ring-2 ring-rose-500/80" : selected ? "ring-2 ring-white/40" : "";

  return (
    <div
      className={`w-[220px] rounded-2xl border ${accent.border} bg-slate-950/85 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur ${ring}`}
      dir="ltr"
    >
      {/* target handle (all except trigger) */}
      {type !== "trigger" ? <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-white/40 !bg-slate-700" /> : null}

      <div className="flex items-center gap-2 rounded-t-2xl border-b border-white/10 px-3 py-2">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${accent.chip}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-black text-white">{displayName}</div>
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">{meta.label}</div>
        </div>
        {execState ? (
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-white/80">{EXEC_LABEL[execState] || execState}</span>
        ) : null}
      </div>

      <div className="space-y-1.5 px-3 py-2 text-[11px] text-slate-300">
        {type === "trigger" ? <div className="text-slate-400">Trigger: <span className="font-bold text-slate-200">{cfg.triggerType || "manual"}</span></div> : null}
        {type === "agent" ? <div className="text-slate-400">Mode: <span className="font-bold text-slate-200">{cfg.mode || "read_only_analysis"}</span></div> : null}
        {type === "condition" ? (
          <div className="truncate text-slate-400" title={`${cfg.condition?.left || "?"} ${cfg.condition?.op || "?"} ${cfg.condition?.right ?? ""}`}>
            <span className="font-mono text-[10px] text-slate-200">{cfg.condition?.left || "path?"}</span> {cfg.condition?.op || "op?"}
          </div>
        ) : null}
        {type === "approval" ? <div className="text-slate-400">Human approval gate</div> : null}
        {type === "end" ? <div className="text-slate-500">Terminates this path</div> : null}
        {hasTool ? (
          <div className="space-y-1">
            <div className="truncate font-mono text-[10px] text-slate-200" title={cfg.tool}>{cfg.tool || "no tool selected"}</div>
            {toolMeta ? (
              <div className="flex flex-wrap items-center gap-1">
                <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${RISK_BADGE[toolMeta.riskLevel] || RISK_BADGE.READ}`}>
                  {RISK_META[toolMeta.riskLevel]?.label || toolMeta.riskLevel}
                </span>
                {toolMeta.requiredPermission ? <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[8px] font-bold text-slate-400">{toolMeta.requiredPermission}</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Intrinsic approval gate — the executor enforces this for SENSITIVE tools/actions. */}
        {isSensitive || type === "approval" ? (
          <div className="mt-1 flex items-center gap-1 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-rose-100">
            <ShieldAlert className="h-3 w-3" /> Human approval required
          </div>
        ) : null}

        {errors.length ? (
          <div className="mt-1 flex items-start gap-1 rounded-lg border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-[9px] font-bold text-rose-100">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> <span>{errors[0]}</span>
          </div>
        ) : null}
      </div>

      {/* source handles */}
      {type === "condition" ? (
        <>
          <Handle id="true" type="source" position={Position.Right} style={{ top: "38%" }} className="!h-2.5 !w-2.5 !border-emerald-300/60 !bg-emerald-500" />
          <Handle id="false" type="source" position={Position.Right} style={{ top: "68%" }} className="!h-2.5 !w-2.5 !border-rose-300/60 !bg-rose-500" />
          <span className="pointer-events-none absolute right-1 top-[30%] text-[8px] font-black text-emerald-300">T</span>
          <span className="pointer-events-none absolute right-1 top-[60%] text-[8px] font-black text-rose-300">F</span>
        </>
      ) : type !== "end" ? (
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-white/40 !bg-slate-500" />
      ) : null}
    </div>
  );
}

const WorkflowNode = memo(WorkflowNodeBase);
export default WorkflowNode;

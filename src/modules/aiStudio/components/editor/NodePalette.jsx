import { useMemo, useState } from "react";
import { Search, Plus, Lock } from "lucide-react";
import { RISK_BADGE } from "./nodeKit";

// Left palette. Groups are built by buildPalette() from the REAL server registry, so it
// stays dynamic as new tools are registered. Items are draggable and click-to-add.
export default function NodePalette({ palette, onAdd, disabled }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return palette
      .map((group) => ({
        ...group,
        items: group.items.filter((it) => !term || `${it.label} ${it.description} ${it.toolId || ""} ${it.riskLevel || ""}`.toLowerCase().includes(term)),
      }))
      .filter((group) => group.items.length);
  }, [palette, q]);

  const startDrag = (e, item) => {
    if (item.disabled || disabled) { e.preventDefault(); return; }
    e.dataTransfer.setData("application/x-wf-node", JSON.stringify(item));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search nodes & tools…"
            dir="ltr"
            className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-2 text-[12px] text-white placeholder:text-slate-500 focus:border-cyan-300/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-2.5">
        {filtered.map((group) => (
          <div key={group.group}>
            <div className="px-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{group.group}</div>
            {group.subtitle ? <div className="px-1 pb-1 text-[9px] font-semibold text-slate-600">{group.subtitle}</div> : null}
            <div className="mt-1 space-y-1.5">
              {group.items.map((item, i) => (
                <button
                  key={`${group.group}-${item.toolId || item.nodeType}-${i}`}
                  type="button"
                  draggable={!item.disabled && !disabled}
                  onDragStart={(e) => startDrag(e, item)}
                  onClick={() => !item.disabled && !disabled && onAdd(item)}
                  disabled={item.disabled || disabled}
                  title={item.disabled ? item.disabledReason : item.description}
                  className={`group flex w-full items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition ${
                    item.disabled
                      ? "cursor-not-allowed border-white/5 bg-white/[0.015] opacity-55"
                      : "border-white/10 bg-white/[0.04] hover:border-cyan-300/40 hover:bg-white/[0.07]"
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    {item.disabled ? <Lock className="h-3.5 w-3.5 text-slate-500" /> : <Plus className="h-3.5 w-3.5 text-slate-400 group-hover:text-cyan-200" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12px] font-bold text-white">{item.label}</span>
                      {item.riskLevel ? (
                        <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase ${RISK_BADGE[item.riskLevel]}`}>
                          {item.riskLevel === "READ" ? "Read" : item.riskLevel === "WRITE" ? "Write" : "Sensitive"}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block overflow-hidden text-[10px] leading-snug text-slate-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">{item.disabled ? item.disabledReason : item.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 ? <div className="px-1 py-6 text-center text-[12px] text-slate-500">No nodes match “{q}”.</div> : null}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { Trash2, ShieldAlert, Info, Code2, AlertTriangle, Eye } from "lucide-react";
import { CONDITION_OPS, NODE_META, RISK_META } from "../../lib/workflowGraph";
import { RISK_BADGE } from "./nodeKit";

const label = "text-[10px] font-black uppercase tracking-[0.14em] text-slate-500";
const field = "h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[12px] text-white placeholder:text-slate-600 focus:border-cyan-300/40 focus:outline-none";

// Input value can be a literal or a { $from: "context.path" } reference (executor resolves it).
function InputField({ name, spec, value, onChange }) {
  const isFrom = value && typeof value === "object" && typeof value.$from === "string";
  const mode = isFrom ? "from" : "value";
  const setMode = (m) => (m === "from" ? onChange({ $from: "" }) : onChange(""));
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold text-slate-200">{name}{spec?.required ? <span className="text-rose-300"> *</span> : null}</span>
        <div className="flex rounded-md border border-white/10 text-[9px] font-black uppercase">
          <button type="button" onClick={() => setMode("value")} className={`px-1.5 py-0.5 ${mode === "value" ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>Value</button>
          <button type="button" onClick={() => setMode("from")} className={`px-1.5 py-0.5 ${mode === "from" ? "bg-cyan-300 text-slate-950" : "text-slate-400"}`}>From step</button>
        </div>
      </div>
      {spec?.description ? <div className="mt-1 text-[10px] text-slate-500">{spec.description}</div> : null}
      {mode === "from" ? (
        <input dir="ltr" value={value.$from} onChange={(e) => onChange({ $from: e.target.value })} placeholder="e.g. steps.search.output.products" className={`${field} mt-1.5 font-mono`} />
      ) : (
        <input dir="ltr" value={value ?? ""} onChange={(e) => onChange(spec?.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} placeholder={spec?.type === "number" ? "0" : "literal value"} className={`${field} mt-1.5`} />
      )}
    </div>
  );
}

export default function NodeConfigPanel({ node, registry, capabilities, errors = [], onChange, onDelete }) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonErr, setJsonErr] = useState("");

  const cfg = node?.config || {};
  const type = node?.type;
  const meta = NODE_META[type];
  const tool = useMemo(() => (registry?.tools || []).find((t) => t.id === cfg.tool) || null, [registry, cfg.tool]);
  const agentModes = capabilities?.agentModes || [];
  const triggerTypes = capabilities?.triggerTypes || [];

  useEffect(() => { setJsonOpen(false); setJsonErr(""); }, [node?.id]);

  if (!node) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-500">
        <Eye className="h-5 w-5" />
        <div className="text-[12px]">Select a node to configure it,<br />or drag one in from the palette.</div>
      </div>
    );
  }

  const set = (patch) => onChange({ ...cfg, ...patch });
  const setCondition = (patch) => set({ condition: { ...(cfg.condition || {}), ...patch } });
  const setInput = (name, val) => set({ input: { ...(cfg.input || {}), [name]: val } });

  const opDef = CONDITION_OPS.find((o) => o.id === (cfg.condition?.op || "exists"));

  const openJson = () => { setJsonText(JSON.stringify(cfg, null, 2)); setJsonErr(""); setJsonOpen(true); };
  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Config must be a JSON object.");
      setJsonErr("");
      onChange(parsed);
      setJsonOpen(false);
    } catch (e) { setJsonErr(e.message || "Invalid JSON"); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">{meta?.label || type} config</div>
          <div className="truncate font-mono text-[10px] text-slate-500" title={node.id}>{node.id}</div>
        </div>
        <button type="button" onClick={onDelete} title="Delete node" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {errors.length ? (
          <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-2.5 py-2 text-[11px] font-semibold text-rose-100">
            <div className="mb-0.5 flex items-center gap-1 font-black uppercase tracking-wide"><AlertTriangle className="h-3.5 w-3.5" />Validation</div>
            <ul className="list-disc pl-4">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        ) : null}

        {/* Display name (stored as config.label — safe/ignored by executor) */}
        {type !== "end" ? (
          <div>
            <div className={label}>Display name</div>
            <input value={cfg.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder={meta?.label} className={`${field} mt-1`} dir="ltr" />
          </div>
        ) : null}

        {type === "trigger" ? (
          <div>
            <div className={label}>Trigger type</div>
            <select value={cfg.triggerType || "manual"} onChange={(e) => set({ triggerType: e.target.value })} className={`${field} mt-1`}>
              {triggerTypes.map((t) => <option key={t.id} value={t.id} disabled={!t.available}>{t.label}{t.available ? "" : " — coming later"}</option>)}
            </select>
            <p className="mt-1.5 text-[10px] text-slate-500">Only <b>manual</b> is wired in this phase. Production channel webhooks are not rerouted through workflows.</p>
          </div>
        ) : null}

        {type === "agent" ? (
          <div className="space-y-2">
            <div>
              <div className={label}>Agent mode</div>
              <select value={cfg.mode || "read_only_analysis"} onChange={(e) => set({ mode: e.target.value })} className={`${field} mt-1`}>
                {agentModes.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.label}{m.available ? "" : " — unavailable"}</option>)}
              </select>
              <p className="mt-1.5 text-[10px] text-slate-500">{agentModes.find((m) => m.id === (cfg.mode || "read_only_analysis"))?.description || "Reuses the existing AI. Read-only summary by default."}</p>
            </div>
            {(cfg.mode || "read_only_analysis") === "llm_grounded" ? (
              <div>
                <div className={label}>Prompt (optional)</div>
                <textarea value={cfg.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} rows={3} dir="ltr" className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[12px] text-white focus:border-cyan-300/40 focus:outline-none" placeholder="Falls back to the trigger query if empty." />
              </div>
            ) : null}
          </div>
        ) : null}

        {type === "condition" ? (
          <div className="space-y-2">
            <div>
              <div className={label}>Source path</div>
              <input dir="ltr" value={cfg.condition?.left || ""} onChange={(e) => setCondition({ left: e.target.value })} placeholder="e.g. steps.search.output.products.length" className={`${field} mt-1 font-mono`} />
            </div>
            <div>
              <div className={label}>Operator</div>
              <select value={cfg.condition?.op || "exists"} onChange={(e) => setCondition({ op: e.target.value })} className={`${field} mt-1`}>
                {CONDITION_OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            {opDef?.needsValue ? (
              <div>
                <div className={label}>Comparison value</div>
                <input dir="ltr" value={cfg.condition?.right ?? ""} onChange={(e) => setCondition({ right: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} placeholder="value" className={`${field} mt-1`} />
              </div>
            ) : null}
            <p className="flex items-start gap-1 text-[10px] text-slate-500"><Info className="mt-0.5 h-3 w-3 shrink-0" />Branches follow the <b className="text-emerald-300">T</b>/<b className="text-rose-300">F</b> handles on the node.</p>
          </div>
        ) : null}

        {(type === "tool" || type === "action") ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-[12px] font-bold text-white">{tool?.id || cfg.tool || "—"}</span>
                {tool ? <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase ${RISK_BADGE[tool.riskLevel]}`}>{RISK_META[tool.riskLevel]?.label}</span> : null}
              </div>
              {tool ? <div className="mt-1 text-[11px] text-slate-400">{tool.description}</div> : null}
              {tool ? (
                <div className="mt-1.5 grid grid-cols-1 gap-1 text-[10px] text-slate-500">
                  <div>Permission: <span className="font-mono text-slate-300">{tool.requiredPermission || "—"}</span></div>
                  <div>Output: <span className="text-slate-400">{tool.outputDescription || "—"}</span></div>
                </div>
              ) : null}
              {tool?.riskLevel === "SENSITIVE" ? (
                <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-rose-100">
                  <ShieldAlert className="h-3.5 w-3.5" /> Human approval required — enforced server-side
                </div>
              ) : tool?.riskLevel === "WRITE" ? (
                <div className="mt-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-bold text-amber-100">Approval required by default for writes.</div>
              ) : null}
            </div>

            {tool && tool.inputSchema && Object.keys(tool.inputSchema).length ? (
              <div className="space-y-1.5">
                <div className={label}>Inputs</div>
                {Object.entries(tool.inputSchema).map(([name, spec]) => (
                  <InputField key={name} name={name} spec={spec} value={(cfg.input || {})[name] ?? ""} onChange={(v) => setInput(name, v)} />
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-slate-500">This tool takes no inputs.</p>
            )}
          </div>
        ) : null}

        {type === "approval" ? (
          <div className="space-y-2">
            <div>
              <div className={label}>Approval label</div>
              <input dir="ltr" value={cfg.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder="Human approval" className={`${field} mt-1`} />
            </div>
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-100">
              Pauses the run and creates a pending approval. On <b>approve</b>, RBAC is re-checked and the run resumes; on <b>reject</b>, the run stops. Decide it in <b>AI Studio → Approvals</b>.
            </div>
          </div>
        ) : null}

        {type === "end" ? <p className="text-[11px] text-slate-500">The run ends when this node is reached (or a path has no outgoing edge).</p> : null}

        {/* Advanced JSON (config only — never code; validated before applying) */}
        {type !== "end" ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02]">
            <button type="button" onClick={() => (jsonOpen ? setJsonOpen(false) : openJson())} className="flex w-full items-center gap-2 px-2.5 py-2 text-[11px] font-black text-slate-300">
              <Code2 className="h-3.5 w-3.5" /> Advanced (raw config JSON)
            </button>
            {jsonOpen ? (
              <div className="space-y-2 border-t border-white/10 p-2.5">
                <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8} dir="ltr" spellCheck={false} className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-2 font-mono text-[11px] text-slate-200 focus:border-cyan-300/40 focus:outline-none" />
                {jsonErr ? <div className="text-[10px] font-bold text-rose-300">{jsonErr}</div> : null}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setJsonOpen(false)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">Cancel</button>
                  <button type="button" onClick={applyJson} className="rounded-lg border border-cyan-300/40 bg-cyan-300/10 px-2.5 py-1 text-[11px] font-black text-cyan-100">Apply</button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

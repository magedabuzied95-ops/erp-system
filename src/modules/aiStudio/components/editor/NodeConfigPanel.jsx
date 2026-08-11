import { useEffect, useMemo, useState } from "react";
import { Trash2, ShieldAlert, Info, Code2, AlertTriangle, Eye, Pencil, GitBranch, Check, X, Bot, KeyRound } from "lucide-react";
import { CONDITION_OPS, NODE_META, RISK_META, humanizeField } from "../../lib/workflowGraph";
import { RISK_BADGE, RISK_INFO } from "./nodeKit";

const labelCls = "text-[10px] font-black uppercase tracking-[0.14em] text-slate-500";
const field = "h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[12px] text-white placeholder:text-slate-600 focus:border-primary/40 focus:outline-none";

// Section wrapper for a clear NODE / INPUTS / BEHAVIOR / SECURITY / ADVANCED hierarchy.
function Section({ title, icon: Icon, children }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {title}
      </div>
      {children}
    </section>
  );
}

// Split an existing $from path into a known base + field suffix for the structured selector.
const splitFrom = (path, bases) => {
  const p = String(path || "");
  let best = null;
  for (const b of bases) {
    if (p === b.value) { best = { base: b.value, suffix: "" }; break; }
    if (p.startsWith(b.value + ".")) { const cand = { base: b.value, suffix: p.slice(b.value.length + 1) }; if (!best || b.value.length > best.base.length) best = cand; }
  }
  return best || { base: "__custom__", suffix: p };
};

// One configurable input: Fixed value | From previous step (structured; no manual $from needed).
function InputField({ name, spec, value, onChange, stepOptions }) {
  const isFrom = value && typeof value === "object" && typeof value.$from === "string";
  const mode = isFrom ? "from" : "value";
  const bases = stepOptions || [];
  const parsed = isFrom ? splitFrom(value.$from, bases) : { base: bases[0]?.value || "__custom__", suffix: "" };

  const setMode = (m) => (m === "from" ? onChange({ $from: bases[0]?.value || "" }) : onChange(""));
  const setFrom = (base, suffix) => {
    if (base === "__custom__") return onChange({ $from: suffix });
    onChange({ $from: suffix ? `${base}.${suffix}` : base });
  };

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.025] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-200">{humanizeField(name)}{spec?.required ? <span className="text-rose-300"> *</span> : null}</span>
        <div className="flex overflow-hidden rounded-md border border-white/10 text-[9px] font-black uppercase">
          <button type="button" onClick={() => setMode("value")} className={`px-2 py-0.5 ${mode === "value" ? "bg-primary text-slate-950" : "text-slate-400 hover:text-slate-200"}`}>Fixed value</button>
          <button type="button" onClick={() => setMode("from")} className={`px-2 py-0.5 ${mode === "from" ? "bg-primary text-slate-950" : "text-slate-400 hover:text-slate-200"}`}>From step</button>
        </div>
      </div>
      {spec?.description ? <div className="mt-1 text-[10px] text-slate-500">{spec.description}</div> : null}

      {mode === "from" ? (
        <div className="mt-1.5 space-y-1.5">
          <select value={parsed.base} onChange={(e) => setFrom(e.target.value, parsed.suffix)} className={field}>
            {bases.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            <option value="__custom__">Custom path…</option>
          </select>
          <input dir="ltr" value={parsed.suffix} onChange={(e) => setFrom(parsed.base, e.target.value)} placeholder={parsed.base === "__custom__" ? "full context path" : "field (optional), e.g. products.length"} className={`${field} font-mono`} />
          <div className="text-[10px] text-slate-600">Uses the output of a previous step at run time.</div>
        </div>
      ) : (
        <input dir="ltr" value={value ?? ""} onChange={(e) => onChange(spec?.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} placeholder={spec?.type === "number" ? "0" : "Enter a value"} className={`${field} mt-1.5`} />
      )}
    </div>
  );
}

export default function NodeConfigPanel({ node, registry, capabilities, errors = [], warnings = [], stepOptions = [], grantedToolIds = [], onGrantTool, onRevokeTool, onChange, onDelete }) {
  const [jsonOpen, setJsonOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonErr, setJsonErr] = useState("");

  const cfg = node?.config || {};
  const type = node?.type;
  const meta = NODE_META[type];
  const tool = useMemo(() => (registry?.tools || []).find((t) => t.id === cfg.tool) || null, [registry, cfg.tool]);
  const agentModes = capabilities?.agentModes || [];
  const triggerTypes = capabilities?.triggerTypes || [];
  const currentMode = cfg.mode || "read_only_analysis";
  const modeInfo = agentModes.find((m) => m.id === currentMode);

  useEffect(() => { setJsonOpen(false); setAdvOpen(false); setJsonErr(""); }, [node?.id]);

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
      setJsonErr(""); onChange(parsed); setJsonOpen(false);
    } catch (e) { setJsonErr(e.message || "Invalid JSON"); }
  };

  const RiskIcon = tool ? { READ: Eye, WRITE: Pencil, SENSITIVE: ShieldAlert }[tool.riskLevel] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">{meta?.label || type}</div>
          <div className="truncate text-[10px] text-slate-500">Configure this node</div>
        </div>
        <button type="button" onClick={onDelete} title="Delete node" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {(errors.length || warnings.length) ? (
          <div className={`rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${errors.length ? "border-rose-500/50 bg-rose-500/10 text-rose-100" : "border-amber-300/40 bg-amber-300/10 text-amber-100"}`}>
            <div className="mb-0.5 flex items-center gap-1 font-black uppercase tracking-wide"><AlertTriangle className="h-3.5 w-3.5" />{errors.length ? "Errors" : "Warnings"}</div>
            <ul className="list-disc pl-4">{(errors.length ? errors : warnings).map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        ) : null}

        {/* NODE */}
        <Section title="Node" icon={meta?.icon === "GitBranch" ? GitBranch : undefined}>
          {type !== "end" ? (
            <div>
              <div className={labelCls}>Display name</div>
              <input value={cfg.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder={tool?.name || meta?.label} className={`${field} mt-1`} dir="ltr" />
            </div>
          ) : <p className="text-[11px] text-slate-500">The run ends when this node is reached.</p>}
        </Section>

        {/* INPUTS */}
        {(type === "tool" || type === "action") ? (
          <Section title="Inputs">
            {tool && tool.inputSchema && Object.keys(tool.inputSchema).length ? (
              Object.entries(tool.inputSchema).map(([name, spec]) => (
                <InputField key={name} name={name} spec={spec} value={(cfg.input || {})[name] ?? ""} onChange={(v) => setInput(name, v)} stepOptions={stepOptions} />
              ))
            ) : <p className="text-[11px] text-slate-500">This action takes no inputs.</p>}
          </Section>
        ) : null}

        {/* CONDITION (IF / THEN) */}
        {type === "condition" ? (
          <Section title="Condition" icon={GitBranch}>
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/[0.05] p-2.5 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-wide text-amber-200">If</div>
              <input dir="ltr" value={cfg.condition?.left || ""} onChange={(e) => setCondition({ left: e.target.value })} placeholder="value to check, e.g. steps.search.output.products.length" className={`${field} font-mono`} />
              <select value={cfg.condition?.op || "exists"} onChange={(e) => setCondition({ op: e.target.value })} className={field}>
                {CONDITION_OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {opDef?.needsValue ? (
                <input dir="ltr" value={cfg.condition?.right ?? ""} onChange={(e) => setCondition({ right: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} placeholder="compared to…" className={field} />
              ) : null}
              <div className="flex items-center gap-3 border-t border-white/10 pt-2 text-[10px] font-bold">
                <span className="text-slate-500 uppercase tracking-wide">Then</span>
                <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" />True → green handle</span>
                <span className="inline-flex items-center gap-1 text-rose-300"><X className="h-3 w-3" />False → red handle</span>
              </div>
            </div>
          </Section>
        ) : null}

        {/* BEHAVIOR — trigger type + schema-driven trigger config */}
        {type === "trigger" ? (() => {
          const tt = cfg.triggerType || "manual";
          const trg = triggerTypes.find((t) => t.id === tt) || null;
          const schema = trg?.configSchema || {};
          const isChannel = trg?.category === "CHANNEL";
          return (
            <Section title="Behavior">
              <div className={labelCls}>Trigger type</div>
              <select value={tt} onChange={(e) => set({ triggerType: e.target.value })} className={`${field} mt-1`}>
                {triggerTypes.map((t) => (
                  <option key={t.id} value={t.id} disabled={t.category === "CHANNEL"}>
                    {t.label}{t.category === "CHANNEL" ? " — coming later" : t.available ? "" : " — automation off"}
                  </option>
                ))}
              </select>
              {trg?.description ? <p className="mt-1.5 text-[10px] text-slate-500">{trg.description}</p> : null}
              {trg && !trg.available && !isChannel && tt !== "manual" ? (
                <div className="mt-1.5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-bold text-amber-100">Automation is off — this trigger won’t fire until an admin enables workflow automation.</div>
              ) : null}

              {/* schema-driven trigger config fields */}
              {Object.entries(schema).map(([fname, spec]) => (
                <div key={fname} className="mt-2">
                  <div className={labelCls}>{spec.label || humanizeField(fname)}</div>
                  {spec.type === "enum" ? (
                    <select value={cfg[fname] ?? spec.values?.[0] ?? ""} onChange={(e) => set({ [fname]: e.target.value })} className={`${field} mt-1`}>
                      {(spec.values || []).map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input dir="ltr" value={cfg[fname] ?? ""} onChange={(e) => set({ [fname]: spec.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value })}
                      placeholder={spec.type === "number" ? "Any (leave blank)" : (spec.description || "")} className={`${field} mt-1`} />
                  )}
                  {spec.description ? <p className="mt-0.5 text-[10px] text-slate-500">{spec.description}</p> : null}
                </div>
              ))}
            </Section>
          );
        })() : null}

        {type === "agent" ? (
          <Section title="Behavior" icon={Bot}>
            <div className={labelCls}>Mode</div>
            <select value={currentMode} onChange={(e) => set({ mode: e.target.value })} className={`${field} mt-1`}>
              {agentModes.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{m.label}{m.available ? "" : " — unavailable"}</option>)}
            </select>
            <div className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] ${modeInfo && !modeInfo.available ? "border-slate-500/30 bg-slate-500/10 text-slate-300" : "border-violet-300/25 bg-violet-300/[0.06] text-violet-100"}`}>
              {currentMode === "read_only_analysis"
                ? "Analyzes workflow context without changing ERP data."
                : modeInfo && !modeInfo.available
                ? (modeInfo.description || "Unavailable on this server.")
                : "Uses the existing AI to produce a grounded answer."}
            </div>
            {currentMode === "llm_grounded" && (!modeInfo || modeInfo.available) ? (
              <div className="mt-2">
                <div className={labelCls}>Prompt (optional)</div>
                <textarea value={cfg.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} rows={3} dir="ltr" className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[12px] text-white focus:border-primary/40 focus:outline-none" placeholder="Falls back to the trigger query if empty." />
              </div>
            ) : null}
          </Section>
        ) : null}

        {type === "approval" ? (
          <Section title="Behavior" icon={ShieldAlert}>
            <div>
              <div className={labelCls}>Approval label</div>
              <input dir="ltr" value={cfg.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder="Human approval" className={`${field} mt-1`} />
            </div>
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-100">
              The workflow <b>pauses here</b> until an authorized user decides.<br />
              <span className="inline-flex items-center gap-1 text-emerald-200"><Check className="h-3 w-3" /> Approve → continue</span> ·
              <span className="ml-1 inline-flex items-center gap-1 text-rose-200"><X className="h-3 w-3" /> Reject → stop</span><br />
              Decide it in <b>AI Studio → Approvals</b>. RBAC is re-checked on approval.
            </div>
          </Section>
        ) : null}

        {/* SECURITY / RISK */}
        {(type === "tool" || type === "action") && tool ? (
          <Section title="Security / Risk" icon={RiskIcon || Info}>
            <div className={`rounded-xl border px-2.5 py-2 ${RISK_BADGE[tool.riskLevel]}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide">
                {RiskIcon ? <RiskIcon className="h-3.5 w-3.5" /> : null}{RISK_META[tool.riskLevel]?.label}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold opacity-90">{RISK_INFO[tool.riskLevel]?.line}</div>
            </div>
            {tool.riskLevel === "SENSITIVE" ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-rose-100">
                <ShieldAlert className="h-3.5 w-3.5" /> Human approval required — cannot be delegated
              </div>
            ) : null}

            {/* Automation Permissions — delegated WRITE grants (Phase 5) */}
            {tool.automaticExecution === "AUTO" ? (
              <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.06] px-2.5 py-1.5 text-[10px] font-bold text-emerald-100"><Eye className="mr-1 inline h-3 w-3" />Read only — automatic runs allowed.</div>
            ) : tool.automaticExecution === "DELEGATABLE" ? (
              (() => {
                const granted = grantedToolIds?.includes(tool.id);
                return (
                  <div className={`rounded-xl border px-2.5 py-2 ${granted ? "border-emerald-300/30 bg-emerald-300/[0.06]" : "border-amber-300/30 bg-amber-300/[0.06]"}`}>
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-300">Automation permission</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{granted
                      ? "Granted — automatic runs may create internal follow-ups. No customer messaging or order changes."
                      : "Not granted — automatic runs cannot execute this write until an admin grants it."}</div>
                    {granted ? (
                      <button type="button" onClick={() => onRevokeTool?.(tool.id)} className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-100 hover:bg-rose-500/20"><KeyRound className="h-3 w-3" />Revoke automatic permission</button>
                    ) : (
                      <button type="button" onClick={() => onGrantTool?.(tool.id)} className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary hover:bg-primary/20"><KeyRound className="h-3 w-3" />Grant automatic permission</button>
                    )}
                  </div>
                );
              })()
            ) : tool.automaticExecution === "APPROVAL_REQUIRED" ? (
              <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.06] px-2.5 py-1.5 text-[10px] font-bold text-rose-100">Cannot be delegated — always routes to human approval.</div>
            ) : null}

            <div className="text-[10px] text-slate-500">Requires permission: <span className="font-mono text-slate-300">{tool.requiredPermission || "—"}</span></div>
          </Section>
        ) : null}

        {/* ADVANCED (technical identifiers + raw JSON) */}
        {type !== "end" ? (
          <Section title="Advanced" icon={Code2}>
            <button type="button" onClick={() => setAdvOpen((v) => !v)} className="text-[11px] font-bold text-slate-400 hover:text-slate-200">{advOpen ? "Hide" : "Show"} technical details</button>
            {advOpen ? (
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                <div className="text-[10px] text-slate-500">Node ID: <span className="font-mono text-slate-300">{node.id}</span></div>
                {tool ? <div className="text-[10px] text-slate-500">Tool ID: <span className="font-mono text-slate-300">{tool.id}</span></div> : null}
                {!jsonOpen ? (
                  <button type="button" onClick={openJson} className="inline-flex items-center gap-1 text-[11px] font-black text-primary hover:text-primary"><Code2 className="h-3.5 w-3.5" /> Edit raw config JSON</button>
                ) : (
                  <div className="space-y-2">
                    <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8} dir="ltr" spellCheck={false} className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2.5 py-2 font-mono text-[11px] text-slate-200 focus:border-primary/40 focus:outline-none" />
                    {jsonErr ? <div className="text-[10px] font-bold text-rose-300">{jsonErr}</div> : null}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setJsonOpen(false)} className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">Cancel</button>
                      <button type="button" onClick={applyJson} className="rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary">Apply</button>
                    </div>
                  </div>
                )}
                <p className="text-[9px] text-slate-600">Raw config only — never code. Validated before applying; the server re-validates on save.</p>
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2, ShieldAlert, Info, Code2, AlertTriangle, Eye, Pencil, GitBranch, Check, X, Bot, KeyRound } from "lucide-react";
import { CONDITION_OPS, NODE_META, RISK_META, humanizeField } from "../../lib/workflowGraph";
import { RISK_BADGE, RISK_INFO } from "./nodeKit";
import { issueText } from "../../lib/issueText";

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
  const { t } = useTranslation();
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
    <div className="rounded-[var(--radius-card)] border border-white/8 bg-white/[0.025] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-200">{humanizeField(name)}{spec?.required ? <span className="text-rose-300"> *</span> : null}</span>
        <div className="flex overflow-hidden rounded-md border border-white/10 text-[9px] font-black uppercase">
          <button type="button" onClick={() => setMode("value")} className={`px-2 py-0.5 ${mode === "value" ? "bg-primary text-slate-950" : "text-slate-400 hover:text-slate-200"}`}>{t("aiStudio.workflow.config.fixedValue")}</button>
          <button type="button" onClick={() => setMode("from")} className={`px-2 py-0.5 ${mode === "from" ? "bg-primary text-slate-950" : "text-slate-400 hover:text-slate-200"}`}>{t("aiStudio.workflow.config.fromStep")}</button>
        </div>
      </div>
      {spec?.description ? <div className="mt-1 text-[10px] text-slate-500">{spec.description}</div> : null}

      {mode === "from" ? (
        <div className="mt-1.5 space-y-1.5">
          <select value={parsed.base} onChange={(e) => setFrom(e.target.value, parsed.suffix)} className={field}>
            {bases.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            <option value="__custom__">{t("aiStudio.workflow.config.customPath")}</option>
          </select>
          <input dir="ltr" value={parsed.suffix} onChange={(e) => setFrom(parsed.base, e.target.value)} placeholder={parsed.base === "__custom__" ? t("aiStudio.workflow.config.fullContextPath") : t("aiStudio.workflow.config.fieldOptional")} className={`${field} font-mono`} />
          <div className="text-[10px] text-slate-600">{t("aiStudio.workflow.config.fromStepHint")}</div>
        </div>
      ) : (
        <input dir="ltr" value={value ?? ""} onChange={(e) => onChange(spec?.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)} placeholder={spec?.type === "number" ? "0" : t("aiStudio.workflow.config.enterValue")} className={`${field} mt-1.5`} />
      )}
    </div>
  );
}

export default function NodeConfigPanel({ node, registry, capabilities, errors = [], warnings = [], stepOptions = [], grantedToolIds = [], onGrantTool, onRevokeTool, onChange, onDelete }) {
  const { t } = useTranslation();
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
        <div className="text-[12px]">{t("aiStudio.workflow.config.emptyState")}<br />{t("aiStudio.workflow.config.emptyStateHint")}</div>
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
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("aiStudio.workflow.config.jsonMustBeObject"));
      setJsonErr(""); onChange(parsed); setJsonOpen(false);
    } catch (e) { setJsonErr(e.message || t("aiStudio.workflow.config.invalidJson")); }
  };

  const RiskIcon = tool ? { READ: Eye, WRITE: Pencil, SENSITIVE: ShieldAlert }[tool.riskLevel] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300">{meta?.labelKey ? t(meta.labelKey, { defaultValue: meta.label }) : type}</div>
          <div className="truncate text-[10px] text-slate-500">{t("aiStudio.workflow.config.subtitle")}</div>
        </div>
        <button type="button" onClick={onDelete} title={t("aiStudio.workflow.config.deleteNode")} className="inline-flex h-[var(--control-height-sm)] w-8 items-center justify-center rounded-[var(--radius-control)] border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {(errors.length || warnings.length) ? (
          <div className={`rounded-lg border px-2.5 py-2 text-[11px] font-semibold ${errors.length ? "border-rose-500/50 bg-rose-500/10 text-rose-100" : "border-amber-300/40 bg-amber-300/10 text-amber-100"}`}>
            <div className="mb-0.5 flex items-center gap-1 font-black uppercase tracking-wide"><AlertTriangle className="h-3.5 w-3.5" />{errors.length ? t("aiStudio.workflow.config.errors") : t("aiStudio.workflow.config.warnings")}</div>
            <ul className="list-disc pl-4">{(errors.length ? errors : warnings).map((e, i) => <li key={i}>{issueText(t, e)}</li>)}</ul>
          </div>
        ) : null}

        {/* NODE */}
        <Section title={t("aiStudio.workflow.config.sections.node")} icon={meta?.icon === "GitBranch" ? GitBranch : undefined}>
          {type !== "end" ? (
            <div>
              <div className={labelCls}>{t("aiStudio.workflow.config.displayName")}</div>
              <input value={cfg.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder={tool?.name || (meta?.labelKey ? t(meta.labelKey, { defaultValue: meta.label }) : "")} className={`${field} mt-1`} dir="ltr" />
            </div>
          ) : <p className="text-[11px] text-slate-500">{t("aiStudio.workflow.config.endNote")}</p>}
        </Section>

        {/* INPUTS */}
        {(type === "tool" || type === "action") ? (
          <Section title={t("aiStudio.workflow.config.sections.inputs")}>
            {tool && tool.inputSchema && Object.keys(tool.inputSchema).length ? (
              Object.entries(tool.inputSchema).map(([name, spec]) => (
                <InputField key={name} name={name} spec={spec} value={(cfg.input || {})[name] ?? ""} onChange={(v) => setInput(name, v)} stepOptions={stepOptions} />
              ))
            ) : <p className="text-[11px] text-slate-500">{t("aiStudio.workflow.config.noInputs")}</p>}
          </Section>
        ) : null}

        {/* CONDITION (IF / THEN) */}
        {type === "condition" ? (
          <Section title={t("aiStudio.workflow.config.sections.condition")} icon={GitBranch}>
            <div className="rounded-xl border border-amber-300/25 bg-amber-300/[0.05] p-2.5 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-wide text-amber-200">{t("aiStudio.workflow.config.if")}</div>
              <input dir="ltr" value={cfg.condition?.left || ""} onChange={(e) => setCondition({ left: e.target.value })} placeholder={t("aiStudio.workflow.config.leftPlaceholder")} className={`${field} font-mono`} />
              <select value={cfg.condition?.op || "exists"} onChange={(e) => setCondition({ op: e.target.value })} className={field}>
                {CONDITION_OPS.map((o) => <option key={o.id} value={o.id}>{t(o.labelKey, { defaultValue: o.label })}</option>)}
              </select>
              {opDef?.needsValue ? (
                <input dir="ltr" value={cfg.condition?.right ?? ""} onChange={(e) => setCondition({ right: /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value })} placeholder={t("aiStudio.workflow.config.comparedTo")} className={field} />
              ) : null}
              <div className="flex items-center gap-3 border-t border-white/10 pt-2 text-[10px] font-bold">
                <span className="text-slate-500 uppercase tracking-wide">{t("aiStudio.workflow.config.then")}</span>
                <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="h-3 w-3" />{t("aiStudio.workflow.config.trueHandle")}</span>
                <span className="inline-flex items-center gap-1 text-rose-300"><X className="h-3 w-3" />{t("aiStudio.workflow.config.falseHandle")}</span>
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
            <Section title={t("aiStudio.workflow.config.sections.behavior")}>
              <div className={labelCls}>{t("aiStudio.workflow.config.triggerType")}</div>
              <select value={tt} onChange={(e) => set({ triggerType: e.target.value })} className={`${field} mt-1`}>
                {triggerTypes.map((tt2) => (
                  <option key={tt2.id} value={tt2.id} disabled={tt2.category === "CHANNEL"}>
                    {t(tt2.labelKey, { defaultValue: tt2.label })}{tt2.category === "CHANNEL" ? t("aiStudio.workflow.config.comingLater") : tt2.available ? "" : t("aiStudio.workflow.config.automationOffSuffix")}
                  </option>
                ))}
              </select>
              {trg?.description ? <p className="mt-1.5 text-[10px] text-slate-500">{trg.description}</p> : null}
              {trg && !trg.available && !isChannel && tt !== "manual" ? (
                <div className="mt-1.5 rounded-lg border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[10px] font-bold text-amber-100">{t("aiStudio.workflow.config.automationOffNote")}</div>
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
                      placeholder={spec.type === "number" ? t("aiStudio.workflow.config.anyBlank") : (spec.description || "")} className={`${field} mt-1`} />
                  )}
                  {spec.description ? <p className="mt-0.5 text-[10px] text-slate-500">{spec.description}</p> : null}
                </div>
              ))}
            </Section>
          );
        })() : null}

        {type === "agent" ? (
          <Section title={t("aiStudio.workflow.config.sections.behavior")} icon={Bot}>
            <div className={labelCls}>{t("aiStudio.workflow.config.mode")}</div>
            <select value={currentMode} onChange={(e) => set({ mode: e.target.value })} className={`${field} mt-1`}>
              {agentModes.map((m) => <option key={m.id} value={m.id} disabled={!m.available}>{t(m.labelKey, { defaultValue: m.label })}{m.available ? "" : t("aiStudio.workflow.config.unavailableSuffix")}</option>)}
            </select>
            <div className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] ${modeInfo && !modeInfo.available ? "border-slate-500/30 bg-slate-500/10 text-slate-300" : "border-violet-300/25 bg-violet-300/[0.06] text-violet-100"}`}>
              {currentMode === "read_only_analysis"
                ? t("aiStudio.workflow.config.readOnlyModeNote")
                : modeInfo && !modeInfo.available
                ? (modeInfo.description || t("aiStudio.workflow.config.unavailableOnServer"))
                : t("aiStudio.workflow.config.groundedModeNote")}
            </div>
            {currentMode === "llm_grounded" && (!modeInfo || modeInfo.available) ? (
              <div className="mt-2">
                <div className={labelCls}>{t("aiStudio.workflow.config.promptOptional")}</div>
                <textarea value={cfg.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} rows={3} dir="ltr" className="mt-1 w-full rounded-[var(--radius-control)] border border-white/10 bg-white/[0.04] px-2.5 py-2 text-[12px] text-white focus:border-primary/40 focus:outline-none" placeholder={t("aiStudio.workflow.config.promptPlaceholder")} />
              </div>
            ) : null}
          </Section>
        ) : null}

        {type === "approval" ? (
          <Section title={t("aiStudio.workflow.config.sections.behavior")} icon={ShieldAlert}>
            <div>
              <div className={labelCls}>{t("aiStudio.workflow.config.approvalLabel")}</div>
              <input dir="ltr" value={cfg.label || ""} onChange={(e) => set({ label: e.target.value })} placeholder={t("aiStudio.workflow.nodes.approval")} className={`${field} mt-1`} />
            </div>
            <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-100">
              {t("aiStudio.workflow.config.pausesBefore")} <b>{t("aiStudio.workflow.config.pausesHere")}</b> {t("aiStudio.workflow.config.pausesAfter")}<br />
              <span className="inline-flex items-center gap-1 text-emerald-200"><Check className="h-3 w-3" /> {t("aiStudio.workflow.config.approveContinue")}</span> ·
              <span className="ml-1 inline-flex items-center gap-1 text-rose-200"><X className="h-3 w-3" /> {t("aiStudio.workflow.config.rejectStop")}</span><br />
              {t("aiStudio.workflow.config.decideInBefore")} <b>{t("aiStudio.workflow.config.decideInPlace")}</b>{t("aiStudio.workflow.config.decideInAfter")}
            </div>
          </Section>
        ) : null}

        {/* SECURITY / RISK */}
        {(type === "tool" || type === "action") && tool ? (
          <Section title={t("aiStudio.workflow.config.sections.security")} icon={RiskIcon || Info}>
            <div className={`rounded-xl border px-2.5 py-2 ${RISK_BADGE[tool.riskLevel]}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide">
                {RiskIcon ? <RiskIcon className="h-3.5 w-3.5" /> : null}{RISK_META[tool.riskLevel]?.label}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold opacity-90">{RISK_INFO[tool.riskLevel] ? t(RISK_INFO[tool.riskLevel].lineKey, { defaultValue: RISK_INFO[tool.riskLevel].line }) : ""}</div>
            </div>
            {tool.riskLevel === "SENSITIVE" ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-rose-100">
                <ShieldAlert className="h-3.5 w-3.5" /> {t("aiStudio.workflow.config.sensitiveBadge")}
              </div>
            ) : null}

            {/* Automation Permissions — delegated WRITE grants (Phase 5) */}
            {tool.automaticExecution === "AUTO" ? (
              <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/[0.06] px-2.5 py-1.5 text-[10px] font-bold text-emerald-100"><Eye className="mr-1 inline h-3 w-3" />{t("aiStudio.workflow.config.autoAllowed")}</div>
            ) : tool.automaticExecution === "DELEGATABLE" ? (
              (() => {
                const granted = grantedToolIds?.includes(tool.id);
                return (
                  <div className={`rounded-xl border px-2.5 py-2 ${granted ? "border-emerald-300/30 bg-emerald-300/[0.06]" : "border-amber-300/30 bg-amber-300/[0.06]"}`}>
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-300">{t("aiStudio.workflow.config.automationPermission")}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">{granted
                      ? t("aiStudio.workflow.config.granted")
                      : t("aiStudio.workflow.config.notGranted")}</div>
                    {granted ? (
                      <button type="button" onClick={() => onRevokeTool?.(tool.id)} className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[10px] font-black text-rose-100 hover:bg-rose-500/20"><KeyRound className="h-3 w-3" />{t("aiStudio.workflow.config.revoke")}</button>
                    ) : (
                      <button type="button" onClick={() => onGrantTool?.(tool.id)} className="mt-1.5 inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-primary/40 bg-primary/10 px-2.5 py-1 text-[10px] font-black text-primary hover:bg-primary/20"><KeyRound className="h-3 w-3" />{t("aiStudio.workflow.config.grant")}</button>
                    )}
                  </div>
                );
              })()
            ) : tool.automaticExecution === "APPROVAL_REQUIRED" ? (
              <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.06] px-2.5 py-1.5 text-[10px] font-bold text-rose-100">{t("aiStudio.workflow.config.cannotDelegate")}</div>
            ) : null}

            <div className="text-[10px] text-slate-500">{t("aiStudio.workflow.config.requiresPermission")} <span className="font-mono text-slate-300">{tool.requiredPermission || "—"}</span></div>
          </Section>
        ) : null}

        {/* ADVANCED (technical identifiers + raw JSON) */}
        {type !== "end" ? (
          <Section title={t("aiStudio.workflow.config.sections.advanced")} icon={Code2}>
            <button type="button" onClick={() => setAdvOpen((v) => !v)} className="text-[11px] font-bold text-slate-400 hover:text-slate-200">{advOpen ? t("aiStudio.workflow.config.hideTechnical") : t("aiStudio.workflow.config.showTechnical")}</button>
            {advOpen ? (
              <div className="space-y-2 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.02] p-2.5">
                <div className="text-[10px] text-slate-500">{t("aiStudio.workflow.config.nodeId")} <span className="font-mono text-slate-300">{node.id}</span></div>
                {tool ? <div className="text-[10px] text-slate-500">{t("aiStudio.workflow.config.toolId")} <span className="font-mono text-slate-300">{tool.id}</span></div> : null}
                {!jsonOpen ? (
                  <button type="button" onClick={openJson} className="inline-flex items-center gap-1 text-[11px] font-black text-primary hover:text-primary"><Code2 className="h-3.5 w-3.5" /> {t("aiStudio.workflow.config.editRawJson")}</button>
                ) : (
                  <div className="space-y-2">
                    <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8} dir="ltr" spellCheck={false} className="w-full rounded-[var(--radius-control)] border border-white/10 bg-slate-950/60 px-2.5 py-2 font-mono text-[11px] text-slate-200 focus:border-primary/40 focus:outline-none" />
                    {jsonErr ? <div className="text-[10px] font-bold text-rose-300">{jsonErr}</div> : null}
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setJsonOpen(false)} className="rounded-[var(--radius-control)] border border-white/10 px-2.5 py-1 text-[11px] font-bold text-slate-300">{t("aiStudio.workflow.config.cancel")}</button>
                      <button type="button" onClick={applyJson} className="rounded-[var(--radius-control)] border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-black text-primary">{t("aiStudio.workflow.config.apply")}</button>
                    </div>
                  </div>
                )}
                <p className="text-[9px] text-slate-600">{t("aiStudio.workflow.config.rawConfigNote")}</p>
              </div>
            ) : null}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

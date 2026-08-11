import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Save, Play, Loader2, CheckCircle2, AlertTriangle, Undo2, Redo2, Circle, ShieldCheck,
  Maximize2, Minimize2, PanelLeft, PanelRight, Unlink, ChevronDown,
} from "lucide-react";
import { hasPermission } from "../../permissions/lib/rbacStore";
import { useStudioHeaders } from "../lib/studioRequest";
import { getWorkflow, updateWorkflow, listTools, runWorkflow, getRun, validateDefinition } from "../services/aiStudioApi";
import {
  definitionToGraph, graphToDefinition, buildPalette, validateGraphStructure, mapServerErrorsToNodes,
  definitionsEqual, newNodeId, defaultConfigFor, DEFAULT_AGENT_MODES, DEFAULT_TRIGGER_TYPES,
  computeEditorWarnings, execStatesForRun, edgeExecClasses, disconnectedNodeIds, NODE_META,
} from "../lib/workflowGraph";
import WorkflowCanvas from "../components/editor/WorkflowCanvas";
import NodePalette from "../components/editor/NodePalette";
import NodeConfigPanel from "../components/editor/NodeConfigPanel";
import ExecutionDrawer from "../components/editor/ExecutionDrawer";
import { fmtTime } from "../components/editor/nodeKit";

const clone = (v) => JSON.parse(JSON.stringify(v));
const RUN_TERMINAL = new Set(["completed", "failed", "rejected", "cancelled", "awaiting_approval"]);
const ORIGIN = { x: 60, y: 60 };

export default function AiStudioWorkflowEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { headers } = useStudioHeaders();
  const canEdit = hasPermission("settings.edit");

  // ---- meta ----
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [version, setVersion] = useState(1);
  const [updatedAt, setUpdatedAt] = useState(null);

  // ---- graph (xyflow shape) ----
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  // ---- registry / capabilities ----
  const [registry, setRegistry] = useState({ tools: [] });
  const [capabilities, setCapabilities] = useState({ agentModes: DEFAULT_AGENT_MODES, triggerTypes: DEFAULT_TRIGGER_TYPES });

  // ---- history ----
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [, forceRender] = useReducer((x) => x + 1, 0);

  // ---- saved snapshot for dirty detection ----
  const savedRef = useRef({ name: "", enabled: false, defObj: { version: 1, nodes: [], edges: [] } });

  // ---- validation + run ----
  const [serverErrors, setServerErrors] = useState(null); // { nodeErrors, general } from last save attempt
  const [status, setStatus] = useState({ kind: "", msg: "" }); // banner
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inputText, setInputText] = useState('{\n  "query": "nike"\n}');
  const [run, setRun] = useState(null);
  const [steps, setSteps] = useState([]);
  const viewportRef = useRef(null);
  const pollRef = useRef(null);

  // ---- Phase 3.5 UX state ----
  const [focusMode, setFocusMode] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [showConfig, setShowConfig] = useState(true);
  const [issuesOpen, setIssuesOpen] = useState(false);

  // ---------- load ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [wfRes, toolsRes] = await Promise.all([getWorkflow(id, headers), listTools(headers)]);
        if (!alive) return;
        if (toolsRes) { setRegistry({ tools: toolsRes.tools || [] }); if (toolsRes.capabilities) setCapabilities(toolsRes.capabilities); }
        const wf = wfRes?.workflow;
        if (!wf) { setStatus({ kind: "error", msg: "Workflow not found." }); setLoading(false); return; }
        const def = wf.definition && typeof wf.definition === "object" ? wf.definition : { version: 1, nodes: [], edges: [] };
        const g = definitionToGraph(def);
        setName(wf.name || "");
        setEnabled(Boolean(wf.enabled));
        setVersion(Number(wf.version || 1));
        setUpdatedAt(wf.updated_at || null);
        setNodes(g.nodes);
        setEdges(g.edges);
        viewportRef.current = g.viewport || null;
        savedRef.current = { name: wf.name || "", enabled: Boolean(wf.enabled), defObj: graphToDefinition(g, { version: wf.version || 1 }) };
      } catch (e) {
        if (alive) setStatus({ kind: "error", msg: e?.message || "Failed to load workflow." });
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [id, headers]);

  // ---------- current definition ----------
  const currentDefinition = useMemo(
    () => graphToDefinition({ nodes, edges }, { version, viewport: viewportRef.current }),
    [nodes, edges, version]
  );

  // ---------- client validation (live) ----------
  const clientValidation = useMemo(() => validateGraphStructure(currentDefinition, registry), [currentDefinition, registry]);
  const clientNodeErrors = useMemo(() => {
    const map = {};
    for (const e of clientValidation.errors) if (e.nodeId) (map[e.nodeId] = map[e.nodeId] || []).push(e.message);
    return map;
  }, [clientValidation]);

  // combined node errors (client live + server from last save)
  const nodeErrorsFor = useCallback(
    (nid) => [...(clientNodeErrors[nid] || []), ...((serverErrors?.nodeErrors || {})[nid] || [])],
    [clientNodeErrors, serverErrors]
  );

  // ---------- editor warnings (advisory; distinct from server validation errors) ----------
  const editorWarnings = useMemo(() => computeEditorWarnings(currentDefinition, registry), [currentDefinition, registry]);
  const warningsByNode = useMemo(() => {
    const m = {};
    for (const w of editorWarnings) if (w.nodeId) (m[w.nodeId] = m[w.nodeId] || []).push(w.message);
    return m;
  }, [editorWarnings]);
  const disconnected = useMemo(() => new Set(disconnectedNodeIds(currentDefinition)), [currentDefinition]);

  // ---------- execution states (waiting/skipped enriched) ----------
  const execInfo = useMemo(() => (run ? execStatesForRun(run, steps, currentDefinition) : { states: {}, currentNodeId: null }), [run, steps, currentDefinition]);
  const execStates = execInfo.states;

  // ---------- step options for "From previous step" selector ----------
  const stepOptions = useMemo(() => {
    const opts = [{ value: "trigger.input", label: "Trigger input" }];
    for (const n of nodes) {
      const t = n.data?.nodeType || n.type;
      if (t === "trigger" || t === "end" || n.id === selectedId) continue;
      const nm = n.data?.config?.label || (registry.tools.find((x) => x.id === n.data?.config?.tool)?.name) || NODE_META[t]?.label || n.id;
      opts.push({ value: `steps.${n.id}.output`, label: `${nm} → output` });
    }
    return opts;
  }, [nodes, selectedId, registry]);

  // ---------- display nodes (enriched) ----------
  const toolMetaFor = useCallback((toolId) => registry.tools.find((t) => t.id === toolId) || null, [registry]);
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedId,
        data: {
          ...n.data,
          toolMeta: n.data?.config?.tool ? toolMetaFor(n.data.config.tool) : null,
          execState: execStates[n.id]?.state || null,
          disconnected: disconnected.has(n.id),
          warnings: warningsByNode[n.id] || [],
          errors: nodeErrorsFor(n.id),
        },
      })),
    [nodes, selectedId, toolMetaFor, execStates, disconnected, warningsByNode, nodeErrorsFor]
  );

  // ---------- display edges (execution-path styling) ----------
  const displayEdges = useMemo(() => {
    if (!run) return edges;
    const { path, current, failed } = edgeExecClasses(execStates, currentDefinition, execInfo.currentNodeId);
    return edges.map((e) => {
      const key = `${e.source}->${e.target}`;
      const cls = current.has(key) ? "wf-edge-current" : failed.has(key) ? "wf-edge-failed" : path.has(key) ? "wf-edge-path" : "";
      return cls ? { ...e, className: cls } : { ...e, className: "" };
    });
  }, [edges, run, execStates, currentDefinition, execInfo.currentNodeId]);

  // ---------- dirty ----------
  const isDirty = useMemo(
    () => name !== savedRef.current.name || enabled !== savedRef.current.enabled || !definitionsEqual(currentDefinition, savedRef.current.defObj),
    [name, enabled, currentDefinition]
  );

  // ---------- history ----------
  const commit = useCallback(() => {
    undoStack.current.push({ nodes: clone(nodes), edges: clone(edges) });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setServerErrors(null); // any edit invalidates prior server errors
    forceRender();
  }, [nodes, edges]);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push({ nodes: clone(nodes), edges: clone(edges) });
    const prev = undoStack.current.pop();
    setNodes(prev.nodes); setEdges(prev.edges);
    forceRender();
  }, [nodes, edges]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push({ nodes: clone(nodes), edges: clone(edges) });
    const next = redoStack.current.pop();
    setNodes(next.nodes); setEdges(next.edges);
    forceRender();
  }, [nodes, edges]);

  // ---------- palette add ----------
  const palette = useMemo(() => buildPalette(registry, capabilities), [registry, capabilities]);

  const addNode = useCallback(
    (item, position) => {
      if (!canEdit || item.disabled) return;
      commit();
      const type = item.nodeType;
      const cfg = item.kind === "tool" ? defaultConfigFor(type, { toolId: item.toolId }) : { ...defaultConfigFor(type), ...(item.config || {}) };
      const nid = newNodeId(type);
      const pos = position || { x: 120 + Math.random() * 120, y: 120 + Math.random() * 120 };
      setNodes((nds) => [...nds, { id: nid, type, position: pos, data: { nodeType: type, config: cfg } }]);
      setSelectedId(nid);
    },
    [canEdit, commit]
  );

  const addTrigger = useCallback(() => {
    if (!canEdit) return;
    commit();
    const nid = newNodeId("trigger");
    setNodes((nds) => [...nds, { id: nid, type: "trigger", position: { ...ORIGIN }, data: { nodeType: "trigger", config: { triggerType: "manual" } } }]);
    setSelectedId(nid);
  }, [canEdit, commit]);

  const enterFocus = useCallback(() => { setFocusMode(true); setShowPalette(false); setShowConfig(false); }, []);
  const exitFocus = useCallback(() => { setFocusMode(false); setShowPalette(true); setShowConfig(true); }, []);

  // ---------- config panel edits ----------
  const selectedNode = useMemo(() => {
    const n = nodes.find((x) => x.id === selectedId);
    return n ? { id: n.id, type: n.data?.nodeType || n.type, config: n.data?.config || {} } : null;
  }, [nodes, selectedId]);

  // Config-field edits are not pushed to the undo stack (undo/redo covers canvas structure —
  // add/move/delete/connect — not per-keystroke form typing). Any edit clears stale server errors.
  const updateSelectedConfig = useCallback(
    (nextConfig) => {
      if (!canEdit) return;
      setServerErrors(null);
      setNodes((nds) => nds.map((n) => (n.id === selectedId ? { ...n, data: { ...n.data, config: nextConfig } } : n)));
    },
    [canEdit, selectedId]
  );

  const deleteSelected = useCallback(() => {
    if (!canEdit || !selectedId) return;
    commit();
    setNodes((nds) => nds.filter((n) => n.id !== selectedId));
    setEdges((eds) => eds.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  }, [canEdit, commit, selectedId]);

  // ---------- save ----------
  const persist = useCallback(async () => {
    setSaving(true); setStatus({ kind: "", msg: "" });
    const def = graphToDefinition({ nodes, edges }, { version, viewport: viewportRef.current });
    try {
      // 1) authoritative server validation
      const vres = await validateDefinition(def, headers);
      if (!vres?.valid) {
        const mapped = mapServerErrorsToNodes(vres?.errors || []);
        setServerErrors(mapped);
        setStatus({ kind: "error", msg: `Cannot save — ${(vres?.errors || []).length} validation error(s).` });
        setSaving(false);
        return false;
      }
      // 2) derive trigger type from the trigger node
      const triggerNode = def.nodes.find((n) => n.type === "trigger");
      const triggerType = triggerNode?.config?.triggerType || "manual";
      const res = await updateWorkflow(id, { name, enabled, triggerType, definition: def }, headers);
      const wf = res?.workflow;
      if (wf) {
        setVersion(Number(wf.version || version));
        setUpdatedAt(wf.updated_at || null);
        savedRef.current = { name: wf.name || name, enabled: Boolean(wf.enabled), defObj: graphToDefinition(definitionToGraph(wf.definition || def), { version: wf.version || version }) };
      }
      setServerErrors(null);
      setStatus({ kind: "ok", msg: "Saved." });
      setSaving(false);
      return true;
    } catch (e) {
      const details = e?.responseBody?.details;
      if (Array.isArray(details)) setServerErrors(mapServerErrorsToNodes(details));
      setStatus({ kind: "error", msg: e?.responseBody?.message || e?.message || "Save failed." });
      setSaving(false);
      return false;
    }
  }, [nodes, edges, version, headers, id, name, enabled]);

  // ---------- run ----------
  const pollRun = useCallback(
    async (runId, attempt = 0) => {
      try {
        const res = await getRun(runId, headers);
        if (res?.run) { setRun(res.run); setSteps(res.steps || []); }
        const st = res?.run?.status;
        if (!RUN_TERMINAL.has(st) && attempt < 20) {
          pollRef.current = setTimeout(() => pollRun(runId, attempt + 1), 1200);
        } else {
          setRunning(false);
        }
      } catch {
        setRunning(false);
      }
    },
    [headers]
  );

  const doRun = useCallback(async () => {
    if (!canEdit) return;
    // Save-then-run: server is the only executor.
    if (isDirty) {
      const ok = await persist();
      if (!ok) { setDrawerOpen(true); return; }
    }
    let input;
    try { input = inputText.trim() ? JSON.parse(inputText) : {}; } catch { setStatus({ kind: "error", msg: "Run input is not valid JSON." }); setDrawerOpen(true); return; }
    if (pollRef.current) clearTimeout(pollRef.current); // cancel any in-flight poll chain
    setDrawerOpen(true); setRunning(true); setRun(null); setSteps([]); setStatus({ kind: "", msg: "" });
    try {
      const res = await runWorkflow(id, input, headers);
      if (res?.run) {
        setRun(res.run);
        // fetch steps + follow until terminal
        pollRun(res.run.id, 0);
      } else { setRunning(false); }
    } catch (e) {
      setRunning(false);
      setStatus({ kind: "error", msg: e?.responseBody?.message || e?.message || "Run failed." });
    }
  }, [canEdit, isDirty, persist, inputText, id, headers, pollRun]);

  // ---------- navigation guards ----------
  useEffect(() => {
    const handler = (e) => { if (isDirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const guardedBack = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Leave the editor and discard them?")) return;
    navigate("/ai-studio/workflows");
  }, [isDirty, navigate]);

  // ---------- keyboard shortcuts (undo/redo) ----------
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---------- unified issue lists (errors vs advisory warnings) ----------
  const errorIssues = useMemo(() => {
    const list = clientValidation.errors.map((e) => ({ nodeId: e.nodeId || null, message: e.message }));
    for (const m of serverErrors?.general || []) list.push({ nodeId: null, message: m });
    for (const [nid, msgs] of Object.entries(serverErrors?.nodeErrors || {})) for (const m of msgs) list.push({ nodeId: nid, message: m });
    return list;
  }, [clientValidation, serverErrors]);
  const warningIssues = editorWarnings;
  const totalErrors = errorIssues.length;
  const totalWarnings = warningIssues.length;

  const saveState = saving ? "saving" : status.kind === "error" ? "failed" : isDirty ? "unsaved" : "saved";

  const focusIssue = (nid) => { if (nid) setSelectedId(nid); setIssuesOpen(false); };

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center gap-2 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading editor…
      </div>
    );
  }

  return (
    <div dir="ltr" className="flex h-[calc(100vh-64px)] flex-col text-white">
      {/* ---- header ---- */}
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-slate-950/60 px-3 py-2.5 backdrop-blur">
        <button type="button" onClick={guardedBack} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-3 text-[12px] font-black hover:border-white/20">
          <ArrowLeft className="h-4 w-4" /> Workflows
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          placeholder="Workflow name"
          className="h-9 min-w-[180px] flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-[14px] font-black text-white focus:border-cyan-300/40 focus:outline-none disabled:opacity-60"
        />
        <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-bold text-slate-300 sm:inline">v{version}</span>

        {/* validation status — click to inspect issues */}
        <div className="relative">
          <button
            type="button"
            onClick={() => (totalErrors || totalWarnings) && setIssuesOpen((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${
              totalErrors ? "border-rose-400/40 bg-rose-500/10 text-rose-100" : totalWarnings ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-emerald-300/30 bg-emerald-400/10 text-emerald-100"
            } ${totalErrors || totalWarnings ? "cursor-pointer" : "cursor-default"}`}
          >
            {totalErrors ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {totalErrors ? `Invalid — ${totalErrors} issue${totalErrors > 1 ? "s" : ""}` : totalWarnings ? `Valid · ${totalWarnings} warning${totalWarnings > 1 ? "s" : ""}` : "Valid"}
            {(totalErrors || totalWarnings) ? <ChevronDown className="h-3 w-3" /> : null}
          </button>
          {issuesOpen && (totalErrors || totalWarnings) ? (
            <div className="absolute left-0 top-full z-30 mt-1 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
              {totalErrors ? <div className="px-1 pb-1 text-[9px] font-black uppercase tracking-wide text-rose-300">Errors (block save)</div> : null}
              {errorIssues.map((it, i) => (
                <button key={`e${i}`} type="button" onClick={() => focusIssue(it.nodeId)} className="flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-rose-100 hover:bg-white/5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>{it.message}</span>
                </button>
              ))}
              {totalWarnings ? <div className="px-1 pb-1 pt-1.5 text-[9px] font-black uppercase tracking-wide text-amber-300">Warnings (advisory)</div> : null}
              {warningIssues.map((it, i) => (
                <button key={`w${i}`} type="button" onClick={() => focusIssue(it.nodeId)} className="flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-amber-100 hover:bg-white/5">
                  <Unlink className="mt-0.5 h-3 w-3 shrink-0" /><span>{it.message}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* save state */}
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${saveState === "saving" ? "text-cyan-200" : saveState === "unsaved" ? "text-amber-200" : saveState === "failed" ? "text-rose-200" : "text-slate-500"}`}>
          {saveState === "saving" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className={`h-2.5 w-2.5 ${saveState === "unsaved" ? "fill-amber-300 text-amber-300" : saveState === "failed" ? "fill-rose-400 text-rose-400" : "fill-slate-600 text-slate-600"}`} />}
          {saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved" : saveState === "failed" ? "Save failed" : updatedAt ? `Saved ${fmtTime(updatedAt)}` : "Saved"}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => canEdit && setEnabled((v) => !v)} disabled={!canEdit} title="Enable/disable this workflow"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black ${enabled ? "border-emerald-300/40 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> {enabled ? "Enabled" : "Disabled"}
          </button>

          <button type="button" onClick={undo} disabled={!undoStack.current.length} title="Undo (Ctrl+Z)" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 hover:border-white/20 disabled:opacity-40"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redo} disabled={!redoStack.current.length} title="Redo (Ctrl+Y)" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 hover:border-white/20 disabled:opacity-40"><Redo2 className="h-4 w-4" /></button>

          <button type="button" onClick={focusMode ? exitFocus : enterFocus} title={focusMode ? "Exit focus mode" : "Focus mode (maximize canvas)"} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-300 hover:border-white/20">
            {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button type="button" onClick={persist} disabled={!canEdit || saving} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-[12px] font-black hover:border-white/20 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          <button type="button" onClick={doRun} disabled={!canEdit || running} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-cyan-300/40 bg-cyan-300/15 px-3.5 text-[12px] font-black text-cyan-50 hover:bg-cyan-300/25 disabled:opacity-50">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run
          </button>
        </div>
      </header>

      {status.msg ? (
        <div className={`px-3 py-1.5 text-[12px] font-bold ${status.kind === "error" ? "bg-rose-500/10 text-rose-100" : "bg-emerald-400/10 text-emerald-100"}`}>{status.msg}</div>
      ) : null}
      {!canEdit ? <div className="bg-amber-300/10 px-3 py-1.5 text-[12px] font-bold text-amber-100">Read-only — you need the settings.edit permission to change or run workflows.</div> : null}

      {/* ---- body ---- */}
      <div className="flex min-h-0 flex-1">
        {showPalette ? (
          <aside className="relative hidden w-64 shrink-0 border-r border-white/10 bg-slate-950/50 lg:block">
            <NodePalette palette={palette} onAdd={(item) => addNode(item, null)} disabled={!canEdit} />
            <button type="button" onClick={() => setShowPalette(false)} title="Hide palette" className="absolute right-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-slate-900/80 text-slate-400 hover:text-white"><PanelLeft className="h-3.5 w-3.5" /></button>
          </aside>
        ) : (
          <button type="button" onClick={() => setShowPalette(true)} title="Show palette" className="hidden w-8 shrink-0 items-center justify-center border-r border-white/10 bg-slate-950/50 text-slate-400 hover:text-white lg:flex"><PanelLeft className="h-4 w-4" /></button>
        )}

        <main className="relative min-w-0 flex-1">
          <WorkflowCanvas
            nodes={displayNodes}
            edges={displayEdges}
            setNodes={setNodes}
            setEdges={setEdges}
            onCommit={commit}
            onSelect={setSelectedId}
            onDropItem={addNode}
            onAddTrigger={addTrigger}
            isEmpty={nodes.length === 0}
          />
        </main>

        {showConfig ? (
          <aside className="relative hidden w-80 shrink-0 border-l border-white/10 bg-slate-950/50 xl:block">
            <NodeConfigPanel
              node={selectedNode}
              registry={registry}
              capabilities={capabilities}
              stepOptions={stepOptions}
              errors={selectedNode ? nodeErrorsFor(selectedNode.id) : []}
              warnings={selectedNode ? (warningsByNode[selectedNode.id] || []) : []}
              onChange={updateSelectedConfig}
              onDelete={deleteSelected}
            />
            <button type="button" onClick={() => setShowConfig(false)} title="Hide config" className="absolute left-1.5 top-1.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/10 bg-slate-900/80 text-slate-400 hover:text-white"><PanelRight className="h-3.5 w-3.5" /></button>
          </aside>
        ) : (
          <button type="button" onClick={() => setShowConfig(true)} title="Show config" className="hidden w-8 shrink-0 items-center justify-center border-l border-white/10 bg-slate-950/50 text-slate-400 hover:text-white xl:flex"><PanelRight className="h-4 w-4" /></button>
        )}

        {drawerOpen ? (
          <ExecutionDrawer
            open={drawerOpen}
            run={run}
            steps={steps}
            running={running}
            inputText={inputText}
            onInputChange={setInputText}
            onRun={doRun}
            onClose={() => setDrawerOpen(false)}
            onViewFull={() => navigate("/ai-studio/executions")}
            onFocusNode={setSelectedId}
          />
        ) : null}
      </div>

      {/* ---- validation / status bar ---- */}
      <footer className="flex items-center gap-3 border-t border-white/10 bg-slate-950/60 px-3 py-1.5 text-[11px]">
        <button type="button" onClick={() => setDrawerOpen((v) => !v)} className="inline-flex items-center gap-1 font-black text-cyan-200 hover:text-cyan-100"><Play className="h-3 w-3" /> Run panel</button>
        <span className="text-slate-600">·</span>
        {totalErrors === 0 && totalWarnings === 0 ? (
          <span className="text-emerald-200">No issues.</span>
        ) : (
          <button type="button" onClick={() => setIssuesOpen(true)} className="inline-flex items-center gap-2">
            {totalErrors ? <span className="text-rose-200">{totalErrors} error{totalErrors > 1 ? "s" : ""}</span> : null}
            {totalWarnings ? <span className="text-amber-200">{totalWarnings} warning{totalWarnings > 1 ? "s" : ""}</span> : null}
            <span className="text-slate-500 underline">view</span>
          </button>
        )}
        <span className="ml-auto text-slate-600">{nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge{edges.length === 1 ? "" : "s"}</span>
      </footer>
    </div>
  );
}

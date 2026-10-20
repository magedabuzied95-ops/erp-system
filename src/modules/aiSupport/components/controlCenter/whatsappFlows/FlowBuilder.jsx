// Chatbot flow builder — a full-screen overlay opened from the flows list ("Build").
// Header (name, status, Save · Publish · Activate), node palette on one side, the React Flow canvas
// in the middle (minimap, zoom, fit, lock), and the node editor / flow settings on the other side.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Loader2,
  Monitor,
  Pause,
  Play,
  Save,
  Search,
  Settings2,
  Upload,
  X,
} from "lucide-react";

import { api } from "../../../../../shared/api/api";
import FlowNode from "./FlowNode.jsx";
import { FlowBuilderContext } from "./flowBuilderContext.js";
import FlowSettings from "./FlowSettings.jsx";
import NodeEditor from "./NodeEditor.jsx";
import { KINDS, KIND_ORDER, cloneData, defaultData, outputsOf, toServerGraph, uid } from "./flowModel.js";
import { STATUS_TONE, apiErrorText, errorText, kindSubtitle, kindTitle, statusLabel } from "./flowLabels.js";

const SUPPRESSED = { suppressErrorStatuses: [400, 403, 404, 409, 413, 422, 500, 502] };
const DRAG_TYPE = "application/x-wa-flow-node";
const EDGE_COLOR = "#22c55e";
const nodeTypes = Object.fromEntries(KIND_ORDER.map((kind) => [kind, FlowNode]));
const EDGE_DEFAULTS = {
  type: "default",
  markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR, width: 18, height: 18 },
  style: { stroke: EDGE_COLOR, strokeWidth: 2 },
};

const CANVAS_CSS = `
.waf-canvas .react-flow__edge-path { stroke: ${EDGE_COLOR}; stroke-width: 2; }
.waf-canvas .react-flow__edge.selected .react-flow__edge-path,
.waf-canvas .react-flow__edge:hover .react-flow__edge-path { stroke: #86efac; stroke-width: 3; }
.waf-canvas .react-flow__controls-button { background: #1e293b; border-color: rgba(255,255,255,0.08); }
.waf-canvas .react-flow__controls-button svg { fill: #e2e8f0; }
.waf-canvas .react-flow__controls-button:hover { background: #334155; }
.waf-canvas .react-flow__handle { transition: transform .1s; }
.waf-canvas .react-flow__handle:hover { transform: scale(1.35); }
`;

const decorateEdge = (edge) => ({ ...EDGE_DEFAULTS, ...edge, sourceHandle: edge.sourceHandle || "next" });

function useNarrowScreen(query = "(max-width: 899px)") {
  const [narrow, setNarrow] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [query]);
  return narrow;
}

function Palette({ onAdd }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const needle = query.trim().toLowerCase();
  const groups = [
    { key: "interactive", label: t("waOfficialFlows.palette.interactive") },
    { key: "messages", label: t("waOfficialFlows.palette.messages") },
  ];
  return (
    <aside className="flex w-64 shrink-0 flex-col border-e border-white/10 bg-white/[0.02]">
      <div className="border-b border-white/10 p-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("waOfficialFlows.palette.search")}
            className="h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 ps-9 pe-3 text-sm font-bold text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {groups.map((group) => {
          const items = KIND_ORDER.filter((kind) => KINDS[kind].group === group.key).filter((kind) => {
            if (!needle) return true;
            return `${kindTitle(t, kind)} ${kindSubtitle(t, kind)}`.toLowerCase().includes(needle);
          });
          if (!items.length) return null;
          const open = !collapsed[group.key] || Boolean(needle);
          return (
            <div key={group.key} className="mb-2">
              <button
                type="button"
                onClick={() => setCollapsed((current) => ({ ...current, [group.key]: !current[group.key] }))}
                className="flex w-full items-center justify-between px-2 py-2 text-[10.5px] font-black uppercase tracking-[0.16em] text-slate-500 hover:text-slate-300"
              >
                {group.label}
                <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
              </button>
              {open ? items.map((kind) => {
                const Icon = KINDS[kind].icon;
                return (
                  <button
                    key={kind}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, kind);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => onAdd(kind)}
                    title={t("waOfficialFlows.palette.dragHint")}
                    className="flex w-full cursor-grab items-center gap-3 rounded-xl px-2 py-2 text-start transition hover:bg-white/[0.05] active:cursor-grabbing"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: `${KINDS[kind].color}26`, color: KINDS[kind].color }}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-black text-slate-100">{kindTitle(t, kind)}</span>
                      <span className="block truncate text-[11px] text-slate-500">{kindSubtitle(t, kind)}</span>
                    </span>
                  </button>
                );
              }) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function BuilderInner({ flowId, headers, onClose, onChanged }) {
  const { t } = useTranslation();
  const { screenToFlowPosition, getViewport, setCenter } = useReactFlow();
  const wrapperRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [flow, setFlow] = useState(null);
  const [name, setName] = useState("");
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [trigger, setTrigger] = useState({ type: "any_message", keywords: [] });
  const [phoneNumberIds, setPhoneNumberIds] = useState([]);
  const [meta, setMeta] = useState({ numbers: [], templates: [] });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [problems, setProblems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [locked, setLocked] = useState(false);

  const applyFlow = useCallback((next, { replaceGraph = true } = {}) => {
    setFlow(next);
    setName(next.name || "");
    setTrigger(next.trigger || { type: "any_message", keywords: [] });
    setPhoneNumberIds(Array.isArray(next.phone_number_ids) ? next.phone_number_ids : []);
    if (replaceGraph) {
      setNodes((next.graph?.nodes || []).map((node) => ({ ...node, data: node.data || {} })));
      setEdges((next.graph?.edges || []).map(decorateEdge));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [flowPayload, metaPayload] = await Promise.all([
          api.get(`/whatsapp-official/flows/${flowId}`, { headers, ...SUPPRESSED }),
          api.get("/whatsapp-official/flows/meta", { headers, ...SUPPRESSED }).catch(() => ({})),
        ]);
        if (cancelled) return;
        applyFlow(flowPayload.flow);
        setMeta({
          numbers: Array.isArray(metaPayload?.numbers) ? metaPayload.numbers : [],
          templates: Array.isArray(metaPayload?.templates) ? metaPayload.templates : [],
        });
      } catch (error) {
        if (!cancelled) setLoadError(error?.message || t("waOfficialFlows.builder.loadFailed"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [applyFlow, flowId, headers, t]);

  const touch = useCallback(() => { setDirty(true); setNotice(null); }, []);

  /* ---------------------------------------------------------------- graph edits */

  const onNodesChange = useCallback((changes) => {
    if (changes.some((change) => change.type === "remove" || (change.type === "position" && change.dragging === false))) touch();
    setNodes((current) => applyNodeChanges(changes, current));
  }, [touch]);

  const onEdgesChange = useCallback((changes) => {
    if (changes.some((change) => change.type === "remove")) touch();
    setEdges((current) => applyEdgeChanges(changes, current));
  }, [touch]);

  const onConnect = useCallback((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const handle = connection.sourceHandle || "next";
    touch();
    // One edge per output: a new wire replaces the old one from the same button.
    setEdges((current) => [
      ...current.filter((edge) => !(edge.source === connection.source && (edge.sourceHandle || "next") === handle)),
      decorateEdge({ id: uid("e"), source: connection.source, sourceHandle: handle, target: connection.target }),
    ]);
  }, [touch]);

  const addNode = useCallback((kind, position) => {
    const id = uid("n");
    touch();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      { id, type: kind, position, selected: true, data: { ...defaultData(kind), ...(current.length ? {} : { is_start: true }) } },
    ]);
    setSelectedId(id);
  }, [touch]);

  const addAtCenter = useCallback((kind) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const position = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2 - 120 + Math.random() * 40, y: rect.top + rect.height / 3 + Math.random() * 40 })
      : { x: 0, y: 0 };
    addNode(kind, position);
  }, [addNode, screenToFlowPosition]);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData(DRAG_TYPE);
    if (!KINDS[kind] || locked) return;
    addNode(kind, screenToFlowPosition({ x: event.clientX - 120, y: event.clientY - 20 }));
  }, [addNode, locked, screenToFlowPosition]);

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const copyNode = useCallback((id) => {
    const original = nodes.find((node) => node.id === id);
    if (!original) return;
    const copyId = uid("n");
    touch();
    setNodes((current) => [
      ...current.map((node) => ({ ...node, selected: false })),
      {
        id: copyId,
        type: original.type,
        position: { x: original.position.x + 40, y: original.position.y + 40 },
        selected: true,
        data: { ...cloneData(original.type, original.data), label: original.data?.label ? `${original.data.label} (${t("waOfficialFlows.node.copySuffix")})` : "" },
      },
    ]);
    setSelectedId(copyId);
  }, [nodes, t, touch]);

  const deleteNode = useCallback((id) => {
    touch();
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, [touch]);

  const updateNodeData = useCallback((id, patch) => {
    touch();
    let outputs = null;
    setNodes((current) => current.map((node) => {
      if (node.id !== id) return node;
      const next = { ...node, data: { ...node.data, ...patch } };
      outputs = new Set(outputsOf(next).map((output) => output.id));
      return next;
    }));
    // A removed button takes its wire with it.
    setEdges((current) => (outputs ? current.filter((edge) => edge.source !== id || outputs.has(edge.sourceHandle || "next")) : current));
  }, [touch]);

  const setStart = useCallback((id, value) => {
    touch();
    setNodes((current) => current.map((node) => ({
      ...node,
      data: { ...node.data, is_start: node.id === id ? value : value ? false : node.data?.is_start === true },
    })));
  }, [touch]);

  const onSelectionChange = useCallback(({ nodes: selected }) => {
    setSelectedId(selected?.length === 1 ? selected[0].id : null);
  }, []);

  /* ---------------------------------------------------------------- server actions */

  const graphPayload = () => toServerGraph(nodes, edges, getViewport());

  const save = async () => {
    const payload = await api.put(
      `/whatsapp-official/flows/${flowId}`,
      { name: name.trim() || flow?.name, graph: graphPayload(), trigger, phone_number_ids: phoneNumberIds },
      { headers, ...SUPPRESSED }
    );
    applyFlow(payload.flow, { replaceGraph: false });
    setDirty(false);
    onChanged?.();
    return payload.flow;
  };

  const publish = async () => {
    try {
      const payload = await api.post(`/whatsapp-official/flows/${flowId}/publish`, {}, { headers, ...SUPPRESSED });
      applyFlow(payload.flow, { replaceGraph: false });
      setProblems([]);
      onChanged?.();
      return payload.flow;
    } catch (error) {
      const list = error?.responseBody?.errors;
      if (Array.isArray(list)) {
        setProblems(list);
        return null;
      }
      throw error;
    }
  };

  const run = async (key, action) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      const body = error?.responseBody || {};
      setNotice({ ok: false, text: apiErrorText(t, body.code, error?.message) });
    } finally {
      setBusy("");
    }
  };

  const onSave = () => run("save", async () => {
    await save();
    setNotice({ ok: true, text: t("waOfficialFlows.builder.saved") });
  });

  const onPublish = () => run("publish", async () => {
    if (dirty) await save();
    const published = await publish();
    if (published) setNotice({ ok: true, text: t("waOfficialFlows.builder.published", { version: published.version }) });
  });

  const onToggleActive = () => run("activate", async () => {
    if (flow?.status === "active") {
      const payload = await api.post(`/whatsapp-official/flows/${flowId}/deactivate`, {}, { headers, ...SUPPRESSED });
      applyFlow(payload.flow, { replaceGraph: false });
      onChanged?.();
      setNotice({ ok: true, text: t("waOfficialFlows.builder.deactivated") });
      return;
    }
    let current = flow;
    if (dirty) current = await save();
    if (!current?.published || current?.has_unpublished) {
      const published = await publish();
      if (!published) return;
    }
    const payload = await api.post(`/whatsapp-official/flows/${flowId}/activate`, {}, { headers, ...SUPPRESSED });
    applyFlow(payload.flow, { replaceGraph: false });
    onChanged?.();
    setNotice({ ok: true, text: t("waOfficialFlows.builder.activated") });
  });

  const close = useCallback(() => {
    if (dirty && !window.confirm(t("waOfficialFlows.builder.unsavedConfirm"))) return;
    onClose();
  }, [dirty, onClose, t]);

  // The control center overlay closes on Escape (a window listener). Stopping it at the document, after
  // the element handlers ran, keeps dropdowns working while Escape here only deselects.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setSelectedId(null);
      setNodes((current) => current.map((node) => (node.selected ? { ...node, selected: false } : node)));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const nodeErrors = useMemo(() => {
    const map = {};
    for (const problem of problems) {
      if (!problem.node_id) continue;
      (map[problem.node_id] ||= []).push(problem);
    }
    return map;
  }, [problems]);

  const context = useMemo(() => ({ onCopy: copyNode, onDelete: deleteNode, nodeErrors, locked }), [copyNode, deleteNode, nodeErrors, locked]);
  const selectedNode = nodes.find((node) => node.id === selectedId) || null;

  const focusNode = (id) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    setNodes((current) => current.map((item) => ({ ...item, selected: item.id === id })));
    setSelectedId(id);
    setCenter(node.position.x + 120, node.position.y + 120, { zoom: 1, duration: 300 });
  };

  if (loading) {
    return <div className="grid flex-1 place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /></div>;
  }
  if (loadError || !flow) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-sm font-bold text-rose-200">{loadError || t("waOfficialFlows.builder.loadFailed")}</p>
          <button type="button" onClick={onClose} className="h-9 rounded-xl bg-white/[0.08] px-4 text-xs font-black text-white">{t("waOfficialFlows.builder.back")}</button>
        </div>
      </div>
    );
  }

  const status = flow.status || "draft";
  const unpublished = dirty || flow.has_unpublished;

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-2.5">
        <button type="button" onClick={close} aria-label={t("waOfficialFlows.builder.back")} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-slate-300 hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
        </button>
        <input
          dir="auto"
          value={name}
          onChange={(event) => { setName(event.target.value); touch(); }}
          aria-label={t("waOfficialFlows.builder.flowName")}
          className="h-9 min-w-0 max-w-[340px] flex-1 rounded-lg border border-transparent bg-transparent px-2 text-base font-black text-white outline-none hover:border-white/10 focus:border-cyan-300/40"
        />
        <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[11px] font-black ${STATUS_TONE[status] || STATUS_TONE.draft}`}>{statusLabel(t, status)}</span>
        {unpublished ? <span className="shrink-0 text-[11px] font-bold text-amber-200">{t("waOfficialFlows.builder.unpublished")}</span> : null}
        {flow.version ? <span className="shrink-0 text-[11px] text-slate-500">v{flow.version}</span> : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setSelectedId(null); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-100 hover:bg-white/10"
          >
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />{t("waOfficialFlows.builder.settings")}
          </button>
          <button type="button" onClick={onSave} disabled={Boolean(busy) || !dirty} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-xs font-black text-white hover:bg-blue-500 disabled:opacity-50">
            {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}{t("waOfficialFlows.builder.save")}
          </button>
          <button type="button" onClick={onPublish} disabled={Boolean(busy)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-orange-600 px-3.5 text-xs font-black text-white hover:bg-orange-500 disabled:opacity-50">
            {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}{t("waOfficialFlows.builder.publish")}
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            disabled={Boolean(busy)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-black text-white disabled:opacity-50 ${status === "active" ? "bg-slate-600 hover:bg-slate-500" : "bg-green-600 hover:bg-green-500"}`}
          >
            {busy === "activate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : status === "active" ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
            {status === "active" ? t("waOfficialFlows.builder.deactivate") : t("waOfficialFlows.builder.activate")}
          </button>
        </div>
      </header>

      {notice ? (
        <div className={`flex items-center justify-between gap-2 border-b px-4 py-2 text-xs font-bold ${notice.ok ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-400/10 text-amber-100"}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={t("waOfficialFlows.editor.close")}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <Palette onAdd={(kind) => !locked && addAtCenter(kind)} />

        <div ref={wrapperRef} dir="ltr" className="waf-canvas relative min-w-0 flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <style>{CANVAS_CSS}</style>
          <FlowBuilderContext.Provider value={context}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onSelectionChange={onSelectionChange}
              isValidConnection={(connection) => connection.source !== connection.target}
              defaultEdgeOptions={EDGE_DEFAULTS}
              connectionLineStyle={{ stroke: EDGE_COLOR, strokeWidth: 2 }}
              defaultViewport={flow.graph?.viewport?.zoom ? flow.graph.viewport : undefined}
              fitView={!flow.graph?.viewport?.zoom}
              fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
              deleteKeyCode={["Delete", "Backspace"]}
              minZoom={0.15}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              className="!bg-[#0b1120]"
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(148,163,184,0.25)" />
              <Controls position="top-right" showInteractive onInteractiveChange={(interactive) => setLocked(!interactive)} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) => KINDS[node.type]?.color || "#64748b"}
                maskColor="rgba(2,6,23,0.6)"
                className="!rounded-xl !border !border-white/10 !bg-slate-900"
              />
            </ReactFlow>
          </FlowBuilderContext.Provider>

          {!nodes.length ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-xs space-y-1.5">
                <div className="text-base font-black text-white">{t("waOfficialFlows.builder.emptyTitle")}</div>
                <div className="text-xs leading-5 text-slate-400">{t("waOfficialFlows.builder.emptyHint")}</div>
              </div>
            </div>
          ) : null}

          {problems.length ? (
            <div className="absolute bottom-3 left-3 z-10 max-h-[45%] w-[320px] overflow-y-auto rounded-xl border border-rose-300/25 bg-slate-950/95 p-2.5 shadow-xl">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span dir="auto" className="inline-flex items-center gap-1.5 text-xs font-black text-rose-200">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t("waOfficialFlows.builder.problems", { count: problems.length })}
                </span>
                <button type="button" onClick={() => setProblems([])} aria-label={t("waOfficialFlows.editor.close")} className="text-slate-400 hover:text-white"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
              </div>
              <ul className="space-y-1">
                {problems.map((problem, index) => {
                  const node = nodes.find((item) => item.id === problem.node_id);
                  return (
                    <li key={`${problem.node_id}-${problem.code}-${index}`}>
                      <button type="button" dir="auto" disabled={!node} onClick={() => focusNode(problem.node_id)} className="w-full rounded-lg px-2 py-1.5 text-start text-[11px] leading-4 text-slate-200 hover:bg-white/[0.06] disabled:cursor-default">
                        {node ? <span className="font-black text-white">{node.data?.label || kindTitle(t, node.type)}: </span> : null}
                        {errorText(t, problem)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        <aside className="flex w-[340px] shrink-0 flex-col border-s border-white/10 bg-white/[0.02]">
          {selectedNode ? (
            <NodeEditor
              node={selectedNode}
              onChange={updateNodeData}
              onSetStart={setStart}
              onClose={() => { setSelectedId(null); setNodes((current) => current.map((node) => ({ ...node, selected: false }))); }}
              templates={meta.templates}
              headers={headers}
              locked={locked}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="border-b border-white/10 px-3 py-2.5 text-sm font-black text-white">{t("waOfficialFlows.settings.title")}</div>
              <FlowSettings
                flowId={flowId}
                trigger={trigger}
                numbers={meta.numbers}
                phoneNumberIds={phoneNumberIds}
                onTrigger={(next) => { setTrigger(next); touch(); }}
                onNumbers={(next) => { setPhoneNumberIds(next); touch(); }}
                headers={headers}
                dirty={dirty}
                locked={locked}
              />
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

export default function FlowBuilder({ flowId, headers, onClose, onChanged }) {
  const { t } = useTranslation();
  const narrow = useNarrowScreen();
  return (
    <div className="fixed inset-0 z-[320] flex flex-col bg-[#0b1120] text-white">
      {narrow ? (
        <div className="grid flex-1 place-items-center p-6 text-center">
          <div className="max-w-sm space-y-3">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-200">
              <Monitor className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="text-base font-black">{t("waOfficialFlows.builder.desktopTitle")}</div>
            <p className="text-sm leading-6 text-slate-400">{t("waOfficialFlows.builder.desktopHint")}</p>
            <button type="button" onClick={onClose} className="h-10 rounded-xl bg-white/[0.08] px-5 text-xs font-black text-white hover:bg-white/15">{t("waOfficialFlows.builder.back")}</button>
          </div>
        </div>
      ) : (
        <ReactFlowProvider>
          <BuilderInner flowId={flowId} headers={headers} onClose={onClose} onChanged={onChanged} />
        </ReactFlowProvider>
      )}
    </div>
  );
}

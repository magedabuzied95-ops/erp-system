import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

// Interaction/execution styling that xyflow's base CSS doesn't cover. Scoped to .wf-canvas.
// Edge colours are the graph's semantic vocabulary — idle, executed, running,
// failed — so they read from the shipped status tokens rather than the slate and
// cyan literals they used to hardcode. This <style> is injected in the body, so
// it outranks the page-level sheet on source order and is the single owner of
// edge and handle presentation.
const CANVAS_CSS = `
.wf-canvas .react-flow__edge-path { stroke: var(--border-strong); stroke-width: 2; transition: stroke .15s, stroke-width .15s; }
.wf-canvas .react-flow__edge:hover .react-flow__edge-path { stroke: var(--text-secondary); stroke-width: 2.5; }
.wf-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: var(--primary); stroke-width: 2.5; }
.wf-canvas .react-flow__edge.wf-edge-path .react-flow__edge-path { stroke: var(--success); }
.wf-canvas .react-flow__edge.wf-edge-current .react-flow__edge-path { stroke: var(--info); stroke-width: 2.5; stroke-dasharray: 6 4; animation: wf-dash 0.6s linear infinite; }
.wf-canvas .react-flow__edge.wf-edge-failed .react-flow__edge-path { stroke: var(--danger); }
@keyframes wf-dash { to { stroke-dashoffset: -20; } }
.wf-canvas .react-flow__handle { transition: transform .1s, background .1s; }
.wf-canvas .react-flow__handle:hover { transform: scale(1.35); }
`;
import WorkflowNode from "./WorkflowNode";

// Register the same custom renderer for every semantic node type (xyflow passes `type`).
const NODE_TYPES = ["trigger", "condition", "tool", "agent", "approval", "action", "end"];
const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, WorkflowNode]));

const miniMapColor = (n) => {
  const risk = n?.data?.toolMeta?.riskLevel;
  if (risk === "SENSITIVE") return "#f43f5e";
  if (risk === "WRITE") return "#f59e0b";
  if (n.type === "trigger") return "#22d3ee";
  if (n.type === "condition") return "#fbbf24";
  if (n.type === "agent") return "#a78bfa";
  return "#64748b";
};

function CanvasInner({ nodes, edges, setNodes, setEdges, onCommit, onSelect, onDropItem, isEmpty, onAddTrigger }) {
  const { t } = useTranslation();
  const wrapperRef = useRef(null);
  const dragSnapshot = useRef(null);
  const { screenToFlowPosition } = useReactFlow();

  const onNodesChange = useCallback(
    (changes) => {
      // Node removals are committed to history; live moves/selection are not.
      if (changes.some((c) => c.type === "remove")) onCommit();
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes, onCommit]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      if (changes.some((c) => c.type === "remove")) onCommit();
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges, onCommit]
  );

  const onConnect = useCallback(
    (conn) => {
      onCommit();
      setEdges((eds) =>
        addEdge(
          {
            ...conn,
            data: { when: conn.sourceHandle === "true" || conn.sourceHandle === "false" ? conn.sourceHandle : null },
            label: conn.sourceHandle === "true" || conn.sourceHandle === "false" ? conn.sourceHandle : undefined,
          },
          eds
        )
      );
    },
    [setEdges, onCommit]
  );

  const onSelectionChange = useCallback(({ nodes: sel }) => onSelect(sel && sel[0] ? sel[0].id : null), [onSelect]);

  // Snapshot BEFORE the move so undo restores the pre-drag position. Guard against the
  // repeated drag-start events xyflow can fire during a single grab.
  const onNodeDragStart = useCallback(() => { if (!dragSnapshot.current) { dragSnapshot.current = true; onCommit(); } }, [onCommit]);
  const onNodeDragStop = useCallback(() => { dragSnapshot.current = false; }, []);

  const onDragOver = useCallback((e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }, []);
  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/x-wf-node");
      if (!raw) return;
      let item;
      try { item = JSON.parse(raw); } catch { return; }
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      onDropItem(item, position);
    },
    [screenToFlowPosition, onDropItem]
  );

  return (
    <div ref={wrapperRef} className="wf-canvas relative h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
      <style>{CANVAS_CSS}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#94a3b8" } }}
        connectionLineStyle={{ stroke: "var(--primary)", strokeWidth: 2 }}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-strong)" />
        <Controls showInteractive={false} className="!rounded-[var(--radius-card)] !border !border-[var(--border)] !bg-[var(--card)] !shadow-none [&_button]:!border-[var(--border)] [&_button]:!bg-[var(--surface-soft)] [&_button]:!text-[var(--text)] [&_button:hover]:!bg-[var(--surface-hover)]" />
        <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="var(--overlay-scrim)" className="!rounded-[var(--radius-card)] !border !border-[var(--border)] !bg-[var(--card)]" />
      </ReactFlow>

      {isEmpty ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="pointer-events-none flex flex-col items-center gap-2 text-slate-400">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10"><Zap className="h-6 w-6 text-primary" /></span>
            <div className="text-[15px] font-black text-white">{t("aiStudio.workflow.canvas.emptyTitle")}</div>
            <div className="max-w-[280px] text-[12px] text-slate-500">{t("aiStudio.workflow.canvas.emptyHint")}</div>
          </div>
          {onAddTrigger ? (
            <button type="button" onClick={onAddTrigger} className="pointer-events-auto inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-primary/40 bg-primary/15 px-4 text-[12px] font-black text-primary hover:bg-primary/25">
              <Zap className="h-4 w-4" /> {t("aiStudio.workflow.canvas.addManualTrigger")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Provider wrapper so screenToFlowPosition/useReactFlow work.
export default function WorkflowCanvas(props) {
  const memoNodes = useMemo(() => props.nodes, [props.nodes]);
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} nodes={memoNodes} />
    </ReactFlowProvider>
  );
}

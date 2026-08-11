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

// Interaction/execution styling that xyflow's base CSS doesn't cover. Scoped to .wf-canvas.
const CANVAS_CSS = `
.wf-canvas .react-flow__edge-path { stroke: #94a3b8; stroke-width: 2; transition: stroke .15s, stroke-width .15s; }
.wf-canvas .react-flow__edge:hover .react-flow__edge-path { stroke: #cbd5e1; stroke-width: 2.5; }
.wf-canvas .react-flow__edge.selected .react-flow__edge-path { stroke: #67e8f9; stroke-width: 2.5; }
.wf-canvas .react-flow__edge.wf-edge-path .react-flow__edge-path { stroke: #34d399; }
.wf-canvas .react-flow__edge.wf-edge-current .react-flow__edge-path { stroke: #22d3ee; stroke-width: 2.5; stroke-dasharray: 6 4; animation: wf-dash 0.6s linear infinite; }
.wf-canvas .react-flow__edge.wf-edge-failed .react-flow__edge-path { stroke: #fb7185; }
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
        connectionLineStyle={{ stroke: "#67e8f9", strokeWidth: 2 }}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#2a3648" />
        <Controls showInteractive={false} className="!rounded-xl !border !border-white/10 !bg-slate-900/85 !shadow-none [&_button]:!border-white/10 [&_button]:!bg-slate-800/80 [&_button]:!text-slate-200 [&_button:hover]:!bg-slate-700" />
        <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(2,6,23,0.65)" className="!rounded-xl !border !border-white/10 !bg-slate-900/85" />
      </ReactFlow>

      {isEmpty ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="pointer-events-none flex flex-col items-center gap-2 text-slate-400">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10"><Zap className="h-6 w-6 text-cyan-200" /></span>
            <div className="text-[15px] font-black text-white">Start with a Trigger</div>
            <div className="max-w-[280px] text-[12px] text-slate-500">Every workflow begins with a trigger. Drag one from the left, or add a manual trigger to begin.</div>
          </div>
          {onAddTrigger ? (
            <button type="button" onClick={onAddTrigger} className="pointer-events-auto inline-flex h-9 items-center gap-2 rounded-full border border-cyan-300/40 bg-cyan-300/15 px-4 text-[12px] font-black text-cyan-50 hover:bg-cyan-300/25">
              <Zap className="h-4 w-4" /> Add Manual Trigger
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

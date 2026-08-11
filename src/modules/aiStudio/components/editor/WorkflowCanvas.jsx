import { useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Workflow } from "lucide-react";
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

function CanvasInner({ nodes, edges, setNodes, setEdges, onCommit, onSelect, onDropItem, isEmpty }) {
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
    <div ref={wrapperRef} className="relative h-full w-full" onDrop={onDrop} onDragOver={onDragOver}>
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
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ animated: false, style: { stroke: "#64748b", strokeWidth: 1.5 } }}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
        className="!bg-transparent"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#334155" />
        <Controls className="!rounded-lg !border !border-white/10 !bg-slate-900/80 !shadow-none [&_button]:!border-white/10 [&_button]:!bg-slate-800/80 [&_button]:!text-slate-200 [&_button:hover]:!bg-slate-700" />
        <MiniMap pannable zoomable nodeColor={miniMapColor} maskColor="rgba(2,6,23,0.6)" className="!rounded-lg !border !border-white/10 !bg-slate-900/80" />
      </ReactFlow>

      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-slate-500">
          <Workflow className="h-8 w-8 opacity-60" />
          <div className="text-[13px] font-bold">Drag nodes from the palette to start,</div>
          <div className="text-[11px]">or click a palette item to drop it on the canvas.</div>
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

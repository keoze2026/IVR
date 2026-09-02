/**
 * Infinite interactive visual canvas for IVR Flow graph authoring.
 */

import {
  useRef,
  useState,
  useCallback,
  type FC,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  FlowDefinition,
  NodeSpec,
  ValidationReport,
} from "@/types/domain";
import { FlowNodeCard } from "./FlowNodeCard";
import { FlowEdgesLayer } from "./FlowEdgesLayer";
import {
  getGraphEdges,
  indexValidationIssues,
} from "../utils/graph";
import {
  snapToGrid,
  NODE_WIDTH,
  NODE_MIN_HEIGHT,
  type Point,
} from "../utils/geometry";

interface FlowCanvasProps {
  doc: FlowDefinition;
  specs: Map<string, NodeSpec>;
  selectedNodeIds: string[];
  report: ValidationReport | null;
  readOnly: boolean;
  zoom: number;
  pan: Point;
  onPanChange: (pan: Point) => void;
  onZoomChange: (zoom: number) => void;
  onSelectNodes: (ids: string[]) => void;
  onUpdatePositions: (positions: Record<string, Point>) => void;
  onAddNode: (type: string, position: Point) => void;
  onConnect: (sourceNodeId: string, portId: string, targetNodeId: string | null) => void;
  onSetEntry: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onDuplicateNode: (id: string) => void;
}

interface DraggingNodeState {
  nodes: { id: string; originalPos: Point }[];
  startX: number;
  startY: number;
}

interface ConnectingWireState {
  sourceNodeId: string;
  sourcePortId: string;
  sourcePoint: Point;
  currentPoint: Point;
}

export const FlowCanvas: FC<FlowCanvasProps> = ({
  doc,
  specs,
  selectedNodeIds,
  report,
  readOnly,
  zoom,
  pan,
  onPanChange,
  onZoomChange,
  onSelectNodes,
  onUpdatePositions,
  onAddNode,
  onConnect,
  onSetEntry,
  onDeleteNode,
  onDuplicateNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Interaction states
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });
  const [draggingNode, setDraggingNode] = useState<DraggingNodeState | null>(null);
  const [marqueeStart, setMarqueeStart] = useState<Point | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<Point | null>(null);
  const [connectingWire, setConnectingWire] = useState<ConnectingWireState | null>(null);
  const [connectingHoverTarget, setConnectingHoverTarget] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Port offsets: nodeId -> portId -> Y offset
  const [portOffsets, setPortOffsets] = useState<Record<string, Record<string, number>>>({});

  const nodePositions = (doc.metadata?.positions ?? {}) as Record<string, Point>;
  const edges = getGraphEdges(doc, specs);
  const { byNode, unreachableNodes } = indexValidationIssues(report);

  const handleRegisterPortOffset = useCallback(
    (nodeId: string, portId: string, offsetTop: number) => {
      setPortOffsets((prev) => {
        const current = prev[nodeId] ?? {};
        if (current[portId] === offsetTop) return prev;
        return {
          ...prev,
          [nodeId]: { ...current, [portId]: offsetTop },
        };
      });
    },
    [],
  );

  // Convert client viewport coordinates to canvas graph coordinates
  const clientToCanvasCoords = useCallback(
    (clientX: number, clientY: number): Point => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  // Canvas Panning Handlers
  const handleCanvasMouseDown = (e: ReactMouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).tagName === "svg") {
      if (e.button === 1 || e.shiftKey) {
        setIsPanning(true);
        setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      } else if (e.button === 0) {
        const pt = clientToCanvasCoords(e.clientX, e.clientY);
        setMarqueeStart(pt);
        setMarqueeCurrent(pt);
      }
      onSelectNodes([]);
      setSelectedEdgeId(null);
    }
  };

  const handleMouseMove = (e: ReactMouseEvent) => {
    // 1. Panning canvas
    if (isPanning) {
      onPanChange({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    // 2. Dragging a node card
    if (draggingNode) {
      const dx = (e.clientX - draggingNode.startX) / zoom;
      const dy = (e.clientY - draggingNode.startY) / zoom;
      
      const newPositions = { ...nodePositions };
      for (const { id, originalPos } of draggingNode.nodes) {
        newPositions[id] = {
          x: snapToGrid(originalPos.x + dx),
          y: snapToGrid(originalPos.y + dy),
        };
      }

      onUpdatePositions(newPositions);
      return;
    }

    // 2.5 Marquee selection
    if (marqueeStart) {
      setMarqueeCurrent(clientToCanvasCoords(e.clientX, e.clientY));
      return;
    }

    // 3. Dragging a connection wire
    if (connectingWire) {
      const currentCanvasPoint = clientToCanvasCoords(e.clientX, e.clientY);
      setConnectingWire((prev) =>
        prev ? { ...prev, currentPoint: currentCanvasPoint } : null,
      );

      // Check if hovering over any node
      const targetEl = document.elementFromPoint(e.clientX, e.clientY);
      const targetCard = targetEl?.closest("[data-input-socket]");
      const targetNodeId = targetCard?.getAttribute("data-input-socket") ?? null;

      if (targetNodeId && targetNodeId !== connectingWire.sourceNodeId) {
        setConnectingHoverTarget(targetNodeId);
      } else {
        setConnectingHoverTarget(null);
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    setDraggingNode(null);

    if (marqueeStart && marqueeCurrent) {
      const minX = Math.min(marqueeStart.x, marqueeCurrent.x);
      const maxX = Math.max(marqueeStart.x, marqueeCurrent.x);
      const minY = Math.min(marqueeStart.y, marqueeCurrent.y);
      const maxY = Math.max(marqueeStart.y, marqueeCurrent.y);

      const selected = Object.keys(nodePositions).filter((id) => {
        const p = nodePositions[id]!;
        // Simple bounding box intersection (assuming NODE_WIDTH=260, NODE_MIN_HEIGHT=120)
        return p.x < maxX && p.x + NODE_WIDTH > minX && p.y < maxY && p.y + NODE_MIN_HEIGHT > minY;
      });

      if (selected.length > 0) {
        onSelectNodes(selected);
      }
      setMarqueeStart(null);
      setMarqueeCurrent(null);
    }

    if (connectingWire) {
      if (connectingHoverTarget) {
        onConnect(
          connectingWire.sourceNodeId,
          connectingWire.sourcePortId,
          connectingHoverTarget,
        );
      }
      setConnectingWire(null);
      setConnectingHoverTarget(null);
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.3), 2.0);

    // Zoom centered on cursor position
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      onZoomChange(newZoom);
      onPanChange({ x: newPanX, y: newPanY });
    }
  };

  // Drag node card start
  const handleNodeDragStart = (nodeId: string, e: ReactMouseEvent) => {
    let activeIds = selectedNodeIds;
    if (!selectedNodeIds.includes(nodeId)) {
      activeIds = [nodeId];
      onSelectNodes(activeIds);
    }
    
    const nodes = activeIds.map((id) => ({
      id,
      originalPos: nodePositions[id] ?? { x: 0, y: 0 },
    }));

    setDraggingNode({
      nodes,
      startX: e.clientX,
      startY: e.clientY,
    });
  };

  // Start wire connection from a port handle
  const handleStartConnect = (
    sourceNodeId: string,
    sourcePortId: string,
    socketPoint: Point,
  ) => {
    setConnectingWire({
      sourceNodeId,
      sourcePortId,
      sourcePoint: socketPoint,
      currentPoint: socketPoint,
    });
  };

  // End wire connection on target node
  const handleEndConnect = (targetNodeId: string) => {
    if (connectingWire && connectingWire.sourceNodeId !== targetNodeId) {
      onConnect(
        connectingWire.sourceNodeId,
        connectingWire.sourcePortId,
        targetNodeId,
      );
    }
    setConnectingWire(null);
    setConnectingHoverTarget(null);
  };

  // Drag and drop from palette onto canvas
  const handleDragOver = (e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData("application/ivr-node-type");
    if (nodeType && !readOnly) {
      const canvasPos = clientToCanvasCoords(e.clientX, e.clientY);
      onAddNode(nodeType, {
        x: snapToGrid(canvasPos.x),
        y: snapToGrid(canvasPos.y),
      });
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleCanvasMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative size-full overflow-hidden bg-void select-none ${
        isPanning ? "cursor-grabbing" : "cursor-default"
      }`}
      style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, #2c3037 1.5px, transparent 0)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* Scaled and Panned World Container */}
      <div
        className="absolute left-0 top-0 size-full origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* SVG Edges Layer */}
        <FlowEdgesLayer
          edges={edges}
          nodePositions={nodePositions}
          portOffsets={portOffsets}
          connecting={connectingWire}
          selectedEdgeId={selectedEdgeId}
          readOnly={readOnly}
          onSelectEdge={setSelectedEdgeId}
          onDisconnectEdge={(sourceId, portId) => onConnect(sourceId, portId, null)}
        />

        {/* Node Cards Layer */}
        {Object.entries(doc.nodes).map(([nodeId, node]) => {
          const spec = specs.get(node.type);
          const pos = nodePositions[nodeId] ?? { x: 80, y: 80 };
          const isEntry = doc.entry === nodeId;
          const isSelected = selectedNodeIds.includes(nodeId);
          const isUnreachable = unreachableNodes.has(nodeId);
          const issues = byNode.get(nodeId) ?? [];

          return (
            <FlowNodeCard
              key={nodeId}
              id={nodeId}
              node={node}
              spec={spec}
              position={pos}
              isEntry={isEntry}
              isSelected={isSelected}
              isUnreachable={isUnreachable}
              isConnectingTarget={connectingHoverTarget === nodeId}
              issues={issues}
              readOnly={readOnly}
              onSelect={(id) => onSelectNodes(id ? [id] : [])}
              onDragStart={handleNodeDragStart}
              onStartConnect={handleStartConnect}
              onEndConnect={handleEndConnect}
              onSetEntry={onSetEntry}
              onDelete={onDeleteNode}
              onDuplicate={onDuplicateNode}
              onRegisterPortOffset={handleRegisterPortOffset}
            />
          );
        })}
        {/* Marquee Selection Box */}
        {marqueeStart && marqueeCurrent && (
          <div
            className="absolute rounded border border-signal bg-signal/10 pointer-events-none"
            style={{
              left: Math.min(marqueeStart.x, marqueeCurrent.x),
              top: Math.min(marqueeStart.y, marqueeCurrent.y),
              width: Math.abs(marqueeStart.x - marqueeCurrent.x),
              height: Math.abs(marqueeStart.y - marqueeCurrent.y),
            }}
          />
        )}
      </div>
    </div>
  );
};

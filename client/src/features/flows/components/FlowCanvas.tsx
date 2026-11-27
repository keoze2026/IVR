/**
 * Infinite interactive visual canvas for IVR Flow graph authoring.
 */

import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type FC,
  type PointerEvent as ReactPointerEvent,
  type DragEvent as ReactDragEvent,
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
  const worldRef = useRef<HTMLDivElement>(null);

  // Fingers on the canvas, and the pinch two of them are making. `anchor` is
  // the point of the graph that stays under the middle of the pinch.
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; zoom: number; anchor: Point } | null>(null);

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

  // Pointer position within the visible canvas
  const pointInView = (e: ReactPointerEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  /** Drop whatever is in progress without applying it. */
  const cancelGestures = () => {
    setIsPanning(false);
    setDraggingNode(null);
    setMarqueeStart(null);
    setMarqueeCurrent(null);
    setConnectingWire(null);
    setConnectingHoverTarget(null);
  };

  const spread = (a: Point, b: Point) => Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
  const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // Counted before a card or port sees the event, so a second finger zooms
  // instead of starting another drag.
  const handlePointerDownCapture = (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (e.isPrimary) {
      touches.current.clear();
      pinch.current = null;
    }
    touches.current.set(e.pointerId, pointInView(e));
    if (touches.current.size < 2) return;

    e.stopPropagation();
    const [a, b] = [...touches.current.values()] as [Point, Point];
    const centre = middle(a, b);
    cancelGestures();
    pinch.current = {
      distance: spread(a, b),
      zoom,
      anchor: { x: (centre.x - pan.x) / zoom, y: (centre.y - pan.y) / zoom },
    };
  };

  const handlePointerEndCapture = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId);
    // The finger left on the glass after a pinch does nothing until lifted.
    if (touches.current.size === 0) pinch.current = null;
  };

  // Canvas Panning Handlers
  const handleCanvasPointerDown = (e: ReactPointerEvent) => {
    // The world layer covers most of the canvas, so it counts as background too.
    if (e.target === containerRef.current || e.target === worldRef.current) {
      // A finger or pen drags the view; a mouse draws a selection box.
      if (e.pointerType !== "mouse" || e.button === 1 || e.shiftKey) {
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

  const handlePointerMove = (e: ReactPointerEvent) => {
    // 0. Two fingers zoom and move together
    if (touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, pointInView(e));
    }
    if (pinch.current) {
      const [a, b] = [...touches.current.values()];
      if (a && b) {
        const { distance, zoom: startZoom, anchor } = pinch.current;
        const nextZoom = Math.min(Math.max((startZoom * spread(a, b)) / distance, 0.3), 2.0);
        const centre = middle(a, b);
        onZoomChange(nextZoom);
        onPanChange({
          x: centre.x - anchor.x * nextZoom,
          y: centre.y - anchor.y * nextZoom,
        });
      }
      return;
    }

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
      // A fingertip hides the small input socket, so the whole card counts.
      const targetCard = targetEl?.closest(
        e.pointerType === "mouse"
          ? "[data-input-socket]"
          : "[data-input-socket], [data-node-card]",
      );
      const targetNodeId =
        targetCard?.getAttribute("data-input-socket") ??
        targetCard?.getAttribute("data-node-card") ??
        null;

      if (targetNodeId && targetNodeId !== connectingWire.sourceNodeId) {
        setConnectingHoverTarget(targetNodeId);
      } else {
        setConnectingHoverTarget(null);
      }
    }
  };

  const handlePointerUp = () => {
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

  // Mouse wheel zoom. Attached natively because React's wheel listener is
  // passive, which would let the page scroll while the canvas zooms.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoom * zoomFactor, 0.3), 2.0);

      // Zoom centered on cursor position
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
      const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

      onZoomChange(newZoom);
      onPanChange({ x: newPanX, y: newPanY });
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoom, pan, onZoomChange, onPanChange]);

  // Drag node card start
  const handleNodeDragStart = (nodeId: string, e: ReactPointerEvent) => {
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
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUpCapture={handlePointerEndCapture}
      onPointerCancelCapture={handlePointerEndCapture}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelGestures}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      // touch-none: swipes here move the graph, not the page.
      className={`relative size-full touch-none overflow-hidden bg-void select-none ${
        isPanning ? "cursor-grabbing" : "cursor-default"
      }`}
      style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, var(--color-edge-bright) 1px, transparent 0)`,
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* Scaled and Panned World Container */}
      <div
        ref={worldRef}
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

/**
 * SVG bezier wire connection layer for IVR Flow canvas.
 */

import { type FC } from "react";
import type { GraphEdge } from "../utils/graph";
import {
  computeBezierPath,
  computeBezierMidpoint,
  type Point,
} from "../utils/geometry";

interface ConnectingState {
  sourceNodeId: string;
  sourcePortId: string;
  sourcePoint: Point;
  currentPoint: Point;
}

interface FlowEdgesLayerProps {
  edges: GraphEdge[];
  nodePositions: Record<string, Point>;
  portOffsets: Record<string, Record<string, number>>; // nodeId -> portId -> Y offset
  connecting: ConnectingState | null;
  selectedEdgeId: string | null;
  readOnly: boolean;
  onSelectEdge: (edgeId: string | null) => void;
  onDisconnectEdge: (sourceNodeId: string, portId: string) => void;
}

const NODE_WIDTH = 260;

export const FlowEdgesLayer: FC<FlowEdgesLayerProps> = ({
  edges,
  nodePositions,
  portOffsets,
  connecting,
  selectedEdgeId,
  readOnly,
  onSelectEdge,
  onDisconnectEdge,
}) => {
  const getEdgeColor = (kind: GraphEdge["kind"], isDangling: boolean) => {
    if (isDangling) return "#f05c60"; // rust
    switch (kind) {
      case "optout":
        return "#f0b429"; // amber
      case "timeout":
        return "#fb923c"; // orange
      case "invalid":
      case "fail":
        return "#f05c60"; // rust
      case "dtmf":
        return "#38bdf8"; // sky blue
      case "condition":
        return "#c084fc"; // purple
      default:
        return "#2aa866"; // live-bright green
    }
  };

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <defs>
        {/* Normal Green Arrow */}
        <marker
          id="arrow-next"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#2aa866" />
        </marker>

        {/* DTMF Blue Arrow */}
        <marker
          id="arrow-dtmf"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#38bdf8" />
        </marker>

        {/* Opt-out Amber Arrow */}
        <marker
          id="arrow-optout"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#f0b429" />
        </marker>

        {/* Red / Dangling Arrow */}
        <marker
          id="arrow-rust"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#f05c60" />
        </marker>

        {/* Purple Condition Arrow */}
        <marker
          id="arrow-condition"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#c084fc" />
        </marker>

        {/* Orange Timeout Arrow */}
        <marker
          id="arrow-timeout"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 8 5 L 0 9 z" fill="#fb923c" />
        </marker>
      </defs>

      {/* Render existing edges */}
      {edges.map((edge) => {
        const sourcePos = nodePositions[edge.sourceNodeId];
        const targetPos = nodePositions[edge.targetNodeId];

        if (!sourcePos) return null;

        const portYOffset = portOffsets[edge.sourceNodeId]?.[edge.sourcePortId] ?? 36;
        const sourcePoint: Point = {
          x: sourcePos.x + NODE_WIDTH,
          y: sourcePos.y + portYOffset,
        };

        const targetPoint: Point = targetPos
          ? { x: targetPos.x, y: targetPos.y + 36 }
          : { x: sourcePoint.x + 120, y: sourcePoint.y + 60 }; // Dangling floating point

        const path = computeBezierPath(sourcePoint, targetPoint);
        const midpoint = computeBezierMidpoint(sourcePoint, targetPoint);
        const color = getEdgeColor(edge.kind, edge.isDangling);
        const isSelected = selectedEdgeId === edge.id;

        const markerId = edge.isDangling
          ? "arrow-rust"
          : edge.kind === "optout"
            ? "arrow-optout"
            : edge.kind === "dtmf"
              ? "arrow-dtmf"
              : edge.kind === "condition"
                ? "arrow-condition"
                : edge.kind === "timeout"
                  ? "arrow-timeout"
                  : edge.kind === "invalid" || edge.kind === "fail"
                    ? "arrow-rust"
                    : "arrow-next";

        return (
          <g key={edge.id} className="group">
            {/* Invisible thick path for easier clicking */}
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth="24"
              className="pointer-events-auto cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                onSelectEdge(isSelected ? null : edge.id);
              }}
            />

            {/* Glowing background on select */}
            {isSelected && (
              <path
                d={path}
                fill="none"
                stroke="#b8ff3c"
                strokeWidth="5"
                strokeOpacity="0.4"
              />
            )}

            {/* Actual visible wire */}
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={isSelected ? "2.5" : "1.8"}
              strokeDasharray={edge.isDangling ? "5 4" : undefined}
              markerEnd={`url(#${markerId})`}
              className="transition-all duration-150 group-hover:stroke-width-[2.5]"
            />

            {/* Edge Label Badge */}
            <foreignObject
              x={midpoint.x - 55}
              y={midpoint.y - 12}
              width="110"
              height="26"
              className="pointer-events-none overflow-visible"
            >
              <div className="flex items-center justify-center">
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEdge(isSelected ? null : edge.id);
                  }}
                  className={`pointer-events-auto flex items-center gap-1 rounded-full border px-2 py-0.5 shadow-md backdrop-blur-sm transition-all duration-150 ${
                    isSelected
                      ? "border-signal bg-panel text-signal ring-1 ring-signal/50"
                      : edge.isDangling
                        ? "border-rust/80 bg-void text-rust"
                        : "border-edge-bright bg-void/90 text-chalk hover:border-signal/70 hover:text-signal"
                  }`}
                >
                  <span className="num max-w-[70px] truncate text-[10px] font-medium leading-none">
                    {edge.label}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      title="Disconnect transition"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDisconnectEdge(edge.sourceNodeId, edge.sourcePortId);
                      }}
                      className="ml-0.5 text-[10px] text-ash hover:text-rust"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </foreignObject>
          </g>
        );
      })}

      {/* Render active connecting wire */}
      {connecting && (
        <g>
          <path
            d={computeBezierPath(connecting.sourcePoint, connecting.currentPoint)}
            fill="none"
            stroke="#b8ff3c"
            strokeWidth="2.5"
            strokeDasharray="4 4"
            className="animate-pulse"
          />
          <circle
            cx={connecting.currentPoint.x}
            cy={connecting.currentPoint.y}
            r="4"
            fill="#b8ff3c"
          />
        </g>
      )}
    </svg>
  );
};

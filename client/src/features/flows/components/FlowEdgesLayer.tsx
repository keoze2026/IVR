/**
 * SVG bezier wire connection layer for IVR Flow canvas.
 */

import { type FC } from "react";
import type { GraphEdge } from "../utils/graph";
import {
  computeBezierPath,
  computeBezierMidpoint,
  NODE_WIDTH,
  type Point,
} from "../utils/geometry";
import { DANGLING_COLOR, KIND_COLORS } from "./nodeMeta";

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
  const markers: [string, string][] = [
    ...Object.entries(KIND_COLORS),
    ["dangling", DANGLING_COLOR],
  ];

  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <defs>
        {markers.map(([name, color]) => (
          <marker
            key={name}
            id={`arrow-${name}`}
            viewBox="0 0 10 10"
            refX="6"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 8 5 L 0 9 z" fill={color} />
          </marker>
        ))}
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
        const color = edge.isDangling ? DANGLING_COLOR : KIND_COLORS[edge.kind];
        const markerId = `arrow-${edge.isDangling ? "dangling" : edge.kind}`;
        const isSelected = selectedEdgeId === edge.id;

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
                stroke="var(--color-signal)"
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
              x={midpoint.x - 70}
              y={midpoint.y - 14}
              width="140"
              height="28"
              className="pointer-events-none overflow-visible"
            >
              <div className="flex h-7 items-center justify-center">
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEdge(isSelected ? null : edge.id);
                  }}
                  className={`pointer-events-auto flex h-7 items-center gap-1 rounded-full border bg-panel pl-2.5 shadow-sm ${
                    readOnly ? "pr-2.5" : "pr-0.5"
                  } ${
                    isSelected
                      ? "border-signal text-signal ring-1 ring-signal/50"
                      : edge.isDangling
                        ? "border-rust text-rust"
                        : "border-edge-bright text-chalk hover:border-signal/70 hover:text-signal"
                  }`}
                >
                  <span
                    className="num max-w-[90px] truncate text-[11px] font-medium leading-none"
                    title={edge.label}
                  >
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
                      className="relative flex size-6 items-center justify-center rounded-full text-xs text-ash after:absolute after:-inset-1.5 hover:bg-bad-soft hover:text-rust"
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
            stroke="var(--color-signal)"
            strokeWidth="2.5"
            strokeDasharray="4 4"
            className="animate-pulse"
          />
          <circle
            cx={connecting.currentPoint.x}
            cy={connecting.currentPoint.y}
            r="4"
            fill="var(--color-signal)"
          />
        </g>
      )}
    </svg>
  );
};

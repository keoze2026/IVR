/**
 * Interactive canvas node card component for IVR flow builder.
 */

import { useRef, useEffect, type FC, type MouseEvent } from "react";
import type { FlowNode, NodeSpec, ValidationIssue } from "@/types/domain";
import { getOutputPorts, type OutputPort } from "../utils/graph";
import { NODE_WIDTH, type Point } from "../utils/geometry";
import { KIND_COLORS, NodeIcon, nodeLabel } from "./nodeMeta";

interface FlowNodeCardProps {
  id: string;
  node: FlowNode;
  spec?: NodeSpec;
  position: Point;
  isEntry: boolean;
  isSelected: boolean;
  isUnreachable: boolean;
  isConnectingTarget: boolean;
  issues: ValidationIssue[];
  readOnly: boolean;
  onSelect: (id: string) => void;
  onDragStart: (id: string, e: MouseEvent) => void;
  onStartConnect: (id: string, portId: string, socketPoint: Point) => void;
  onEndConnect: (targetNodeId: string) => void;
  onSetEntry: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRegisterPortOffset: (nodeId: string, portId: string, offsetTop: number) => void;
}

export const FlowNodeCard: FC<FlowNodeCardProps> = ({
  id,
  node,
  spec,
  position,
  isEntry,
  isSelected,
  isUnreachable,
  isConnectingTarget,
  issues,
  readOnly,
  onSelect,
  onDragStart,
  onStartConnect,
  onEndConnect,
  onSetEntry,
  onDelete,
  onDuplicate,
  onRegisterPortOffset,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const ports = getOutputPorts(id, node, spec);

  const hasErrors = issues.some((i) => i.level === "error");
  const hasWarnings = issues.some((i) => i.level === "warning");

  const socketCentre = (socketEl: HTMLElement) =>
    (cardRef.current?.clientTop ?? 0) +
    socketEl.offsetTop +
    socketEl.offsetHeight / 2;

  // Measure and register port socket Y offsets relative to the card top.
  // Layout offsets, not screen rects: the canvas scales cards with a CSS
  // transform, and wires are drawn in unscaled canvas coordinates.
  useEffect(() => {
    ports.forEach((port) => {
      const socketEl = cardRef.current?.querySelector<HTMLElement>(
        `[data-port-socket="${port.id}"]`,
      );
      if (socketEl) onRegisterPortOffset(id, port.id, socketCentre(socketEl));
    });
  }, [id, ports, onRegisterPortOffset]);

  const handleSocketMouseDown = (e: MouseEvent, port: OutputPort) => {
    e.stopPropagation();
    if (readOnly) return;
    onStartConnect(id, port.id, {
      x: position.x + NODE_WIDTH,
      y: position.y + socketCentre(e.currentTarget as HTMLElement),
    });
  };

  return (
    <div
      ref={cardRef}
      data-node-card={id}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        width: `${NODE_WIDTH}px`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      onMouseUp={() => {
        if (isConnectingTarget) {
          onEndConnect(id);
        }
      }}
      className={`group absolute left-0 top-0 select-none rounded-xl border bg-panel shadow-[var(--shadow-card)] transition-shadow duration-150 ${
        isSelected
          ? "border-signal shadow-[0_0_0_3px_rgba(11,132,87,0.22)]"
          : isConnectingTarget
            ? "border-signal ring-2 ring-signal"
            : isUnreachable
              ? "border-dashed border-edge-bright opacity-60 hover:opacity-100"
              : "border-edge-bright hover:border-signal/60"
      }`}
    >
      {/* Input connector handle on the left (target drop socket) */}
      <div
        data-input-socket={id}
        title={`Connect to ${id}`}
        onMouseUp={(e) => {
          e.stopPropagation();
          onEndConnect(id);
        }}
        className={`absolute -left-2.5 top-7 z-10 size-5 rounded-full border-2 shadow-sm transition-all after:absolute after:-inset-2 ${
          isConnectingTarget
            ? "scale-125 border-panel bg-signal"
            : "border-ash-dim bg-panel group-hover:border-signal"
        }`}
      />

      {/* Header & Drag Handle */}
      <div
        onMouseDown={(e) => {
          if (!readOnly && e.button === 0) {
            onDragStart(id, e);
          }
        }}
        className={`flex items-center justify-between gap-2 border-b border-edge px-3 py-2.5 ${
          readOnly ? "" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-live text-signal">
            <NodeIcon type={node.type} />
          </span>
          <div className="min-w-0 leading-tight">
            <div className="num truncate text-sm font-semibold text-chalk" title={id}>
              {id}
            </div>
            <div className="truncate text-[11px] text-ash-dim first-letter:uppercase">
              {nodeLabel(node.type)}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isEntry && (
            <span className="rounded-full bg-signal px-2 py-0.5 text-[11px] font-medium text-white">
              Start
            </span>
          )}
          {spec?.terminal && (
            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ash">
              End
            </span>
          )}
          {hasErrors ? (
            <span className="size-2.5 rounded-full bg-rust" role="img" aria-label="Has errors" title="Has errors" />
          ) : hasWarnings ? (
            <span className="size-2.5 rounded-full bg-amber" role="img" aria-label="Has warnings" title="Has warnings" />
          ) : null}
        </div>
      </div>

      {/* Node Content / Preview */}
      <div className="space-y-2 px-3 py-2.5 empty:hidden">
        {/* Prompt snippet */}
        {node.prompt?.text ? (
          <p className="line-clamp-2 text-xs text-ash" title={node.prompt.text}>
            “{node.prompt.text}”
          </p>
        ) : node.prompt?.asset ? (
          <p className="num truncate text-[11px] text-ash">
            Audio: {node.prompt.asset}
          </p>
        ) : node.type === "hangup" ? (
          <p className="text-xs text-ash-dim">Ends the call</p>
        ) : null}

        {/* Collect variable */}
        {node.type === "collect" && (node as any).variable && (
          <div className="truncate rounded-lg bg-void px-2 py-1 text-[11px] text-ash">
            Save as <span className="num text-signal">{`{{${(node as any).variable}}}`}</span>
          </div>
        )}

        {/* Transfer endpoint */}
        {node.type === "transfer" && (node as any).endpoint && (
          <div className="truncate rounded-lg bg-void px-2 py-1 text-[11px] text-ash">
            To <span className="num text-chalk">{(node as any).endpoint}</span>
          </div>
        )}

        {/* Disposition pill */}
        {node.disposition && (
          <span className="inline-block rounded-full bg-raised px-2 py-0.5 text-[11px] text-ash">
            Outcome: <span className="text-chalk">{node.disposition.replace(/_/g, " ")}</span>
          </span>
        )}
      </div>

      {/* Output Port Connectors on the right */}
      {ports.length > 0 && (
        <div className="space-y-0.5 rounded-b-xl border-t border-edge bg-void p-1.5">
          {ports.map((port) => (
            <div
              key={port.id}
              className="group/port flex min-h-8 items-center justify-between rounded-lg px-2 text-xs hover:bg-raised"
            >
              <span className="num max-w-[200px] truncate text-ash group-hover/port:text-chalk">
                {port.label}
              </span>

              {/* Port Socket Handle */}
              <div
                data-port-socket={port.id}
                title={
                  readOnly
                    ? `Goes to ${port.target || "nothing"}`
                    : `Drag to connect ${port.label} to another step`
                }
                onMouseDown={(e) => handleSocketMouseDown(e, port)}
                style={
                  port.target
                    ? { backgroundColor: KIND_COLORS[port.kind], borderColor: "#fff" }
                    : undefined
                }
                className={`relative z-10 -mr-[17px] size-[18px] shrink-0 rounded-full border-2 border-ash-dim bg-panel shadow-sm transition-transform duration-150 after:absolute after:-inset-[7px] ${
                  readOnly ? "" : "cursor-crosshair hover:scale-125"
                }`}
              />
            </div>
          ))}
        </div>
      )}

      {/* Actions float above the card so they do not change its height. Always
          shown on the selected step, since touch screens have no hover. */}
      {!readOnly && (
        <div
          className={`absolute bottom-full right-0 pb-1.5 ${
            isSelected ? "visible" : "invisible group-hover:visible"
          }`}
        >
          <div className="flex items-center gap-1 rounded-xl border border-edge bg-panel p-1 shadow-md">
            {!isEntry && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetEntry(id);
                }}
                className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-ash hover:bg-live hover:text-signal"
              >
                Set as start
              </button>
            )}
            <button
              type="button"
              title="Duplicate step"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(id);
              }}
              className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-ash hover:bg-raised hover:text-chalk"
            >
              Duplicate
            </button>
            <button
              type="button"
              title="Delete step"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
              className="min-h-9 rounded-lg px-2.5 text-xs font-medium text-ash hover:bg-[#fdeaea] hover:text-rust"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

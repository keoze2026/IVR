/**
 * Interactive canvas node card component for IVR flow builder.
 */

import { useRef, useEffect, type FC, type MouseEvent } from "react";
import type { FlowNode, NodeSpec, ValidationIssue } from "@/types/domain";
import { getOutputPorts, type OutputPort } from "../utils/graph";
import { NODE_WIDTH, type Point } from "../utils/geometry";

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

const TYPE_ICONS: Record<string, string> = {
  play: "▶",
  menu: "⌨",
  collect: "#",
  transfer: "⮂",
  opt_out: "⊘",
  voicemail: "⌕",
  record: "●",
  branch: "🔀",
  hangup: "✆",
};

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

  // Measure and register port socket Y offsets relative to the card top
  useEffect(() => {
    if (!cardRef.current) return;
    const cardRect = cardRef.current.getBoundingClientRect();

    ports.forEach((port) => {
      const socketEl = cardRef.current?.querySelector(`[data-port-socket="${port.id}"]`);
      if (socketEl) {
        const socketRect = socketEl.getBoundingClientRect();
        const offsetTop = socketRect.top - cardRect.top + socketRect.height / 2;
        onRegisterPortOffset(id, port.id, offsetTop);
      }
    });
  }, [id, ports, onRegisterPortOffset]);

  const handleSocketMouseDown = (e: MouseEvent, port: OutputPort) => {
    e.stopPropagation();
    if (readOnly) return;
    const socketEl = e.currentTarget as HTMLElement;
    const rect = socketEl.getBoundingClientRect();
    onStartConnect(id, port.id, {
      x: position.x + NODE_WIDTH,
      y: position.y + (socketEl.offsetTop + rect.height / 2),
    });
  };

  return (
    <div
      ref={cardRef}
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
      className={`group absolute left-0 top-0 select-none rounded-[--radius-card] border transition-shadow duration-150 ${
        isSelected
          ? "border-signal bg-panel shadow-[0_0_0_2px_rgba(184,255,60,0.3)]"
          : isConnectingTarget
            ? "border-signal bg-raised ring-2 ring-signal"
            : isUnreachable
              ? "border-dashed border-edge bg-void/80 opacity-60 hover:opacity-100"
              : "border-edge bg-panel hover:border-edge-bright"
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
        className={`absolute -left-2.5 top-7 size-5 rounded-full border-2 border-panel transition-all ${
          isConnectingTarget
            ? "scale-125 bg-signal"
            : "bg-edge group-hover:bg-edge-bright"
        }`}
      />

      {/* Header & Drag Handle */}
      <div
        onMouseDown={(e) => {
          if (!readOnly && e.button === 0) {
            onDragStart(id, e);
          }
        }}
        className="flex cursor-grab items-center justify-between border-b border-edge/80 px-3 py-2 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded bg-void text-xs font-semibold text-signal">
            {TYPE_ICONS[node.type] || "●"}
          </span>
          <span className="num truncate text-xs font-semibold text-chalk" title={id}>
            {id}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {isEntry && (
            <span className="rounded bg-signal px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-void">
              Entry
            </span>
          )}
          {spec?.terminal && (
            <span className="rounded bg-void px-1 py-0.5 text-[9px] text-ash-dim">
              End
            </span>
          )}
          {hasErrors ? (
            <span className="size-2 rounded-full bg-rust" title="Node has validation errors" />
          ) : hasWarnings ? (
            <span className="size-2 rounded-full bg-amber" title="Node has warnings" />
          ) : null}
        </div>
      </div>

      {/* Node Content / Preview */}
      <div className="space-y-2 p-2.5">
        {/* Prompt snippet */}
        {node.prompt?.text ? (
          <p className="line-clamp-2 text-xs italic text-ash" title={node.prompt.text}>
            “{node.prompt.text}”
          </p>
        ) : node.prompt?.asset ? (
          <p className="num truncate text-[11px] text-amber">
            Audio: {node.prompt.asset}
          </p>
        ) : node.type === "hangup" ? (
          <p className="text-[11px] text-ash-dim">Hangs up call</p>
        ) : null}

        {/* Collect variable */}
        {node.type === "collect" && (node as any).variable && (
          <div className="flex items-center gap-1 rounded bg-void px-2 py-1 text-[11px]">
            <span className="text-ash">Store into:</span>
            <span className="num text-signal">{`{{${(node as any).variable}}}`}</span>
          </div>
        )}

        {/* Transfer endpoint */}
        {node.type === "transfer" && (node as any).endpoint && (
          <div className="truncate rounded bg-void px-2 py-1 text-[11px] text-ash">
            Target: <span className="num text-chalk">{(node as any).endpoint}</span>
          </div>
        )}

        {/* Disposition pill */}
        {node.disposition && (
          <div className="flex items-center gap-1">
            <span className="rounded border border-edge bg-void px-1.5 py-0.5 text-[10px] text-ash-dim">
              outcome: <span className="text-chalk">{node.disposition}</span>
            </span>
          </div>
        )}
      </div>

      {/* Output Port Connectors on the right */}
      {ports.length > 0 && (
        <div className="border-t border-edge/60 bg-void/40 p-1.5 space-y-1">
          {ports.map((port) => {
            const isConnected = Boolean(port.target);
            return (
              <div
                key={port.id}
                className="group/port flex items-center justify-between rounded px-2 py-1 text-[11px] transition-colors hover:bg-raised"
              >
                <span className="num max-w-[170px] truncate text-[11px] text-ash group-hover/port:text-chalk">
                  {port.label}
                </span>

                {/* Port Socket Handle */}
                <div
                  data-port-socket={port.id}
                  title={
                    readOnly
                      ? `Transition: ${port.target || "none"}`
                      : `Drag to connect ${port.label} → another node`
                  }
                  onMouseDown={(e) => handleSocketMouseDown(e, port)}
                  className={`-mr-3.5 size-4.5 cursor-crosshair rounded-full border-2 border-panel shadow-sm transition-all duration-150 hover:scale-125 ${
                    isConnected
                      ? port.kind === "optout"
                        ? "bg-amber"
                        : port.kind === "dtmf"
                          ? "bg-sky-400"
                          : port.kind === "timeout"
                            ? "bg-orange-400"
                            : port.kind === "invalid" || port.kind === "fail"
                              ? "bg-rust"
                              : "bg-live-bright"
                      : "border-edge-bright bg-edge hover:bg-signal"
                  }`}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Action Footer Menu on Hover */}
      {!readOnly && (
        <div className="flex items-center justify-between border-t border-edge/60 bg-void/80 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
          {!isEntry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetEntry(id);
              }}
              className="text-[10px] text-ash hover:text-signal"
            >
              Make Entry
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              title="Duplicate node"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate(id);
              }}
              className="text-[10px] text-ash hover:text-chalk"
            >
              Copy
            </button>
            <button
              type="button"
              title="Delete node"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(id);
              }}
              className="text-[10px] text-ash hover:text-rust"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

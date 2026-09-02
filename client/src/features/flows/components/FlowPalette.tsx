/**
 * Left sidebar palette containing draggable DSL node types for IVR flows.
 */

import { useState, type FC, type DragEvent } from "react";
import type { NodeSpec } from "@/types/domain";
import { Panel } from "@/components/ui";

interface FlowPaletteProps {
  specs: NodeSpec[];
  readOnly: boolean;
  onAddNode: (type: string, position?: { x: number; y: number }) => void;
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

export const FlowPalette: FC<FlowPaletteProps> = ({
  specs,
  readOnly,
  onAddNode,
}) => {
  const [filter, setFilter] = useState("");

  const filtered = specs.filter((s) =>
    s.type.toLowerCase().includes(filter.toLowerCase()) ||
    s.description.toLowerCase().includes(filter.toLowerCase()),
  );

  const handleDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData("application/ivr-node-type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <Panel className="flex h-full w-60 shrink-0 flex-col overflow-hidden">
      <div className="border-b border-edge p-3">
        <div className="flex items-center justify-between">
          <span className="eyebrow">Node Palette</span>
          <span className="num text-[10px] text-ash-dim">{specs.length} types</span>
        </div>
        <input
          type="search"
          placeholder="Filter nodes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mt-2 w-full rounded border border-edge bg-void px-2.5 py-1 text-xs text-chalk placeholder:text-ash-dim focus:border-signal focus:outline-none"
        />
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.map((spec) => (
          <div
            key={spec.type}
            draggable={!readOnly}
            onDragStart={(e) => handleDragStart(e, spec.type)}
            onClick={() => !readOnly && onAddNode(spec.type)}
            className={`group flex cursor-grab items-start gap-2.5 rounded-lg border border-transparent p-2 transition-all ${
              readOnly
                ? "cursor-not-allowed opacity-50"
                : "hover:border-edge-bright hover:bg-raised active:cursor-grabbing"
            }`}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-void text-xs font-semibold text-signal group-hover:scale-105">
              {TYPE_ICONS[spec.type] || "●"}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="num text-xs font-medium text-chalk group-hover:text-signal">
                  {spec.type}
                </span>
                {spec.terminal && (
                  <span className="rounded bg-void px-1 py-0.5 text-[9px] text-ash-dim">
                    ends
                  </span>
                )}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-ash-dim">
                {spec.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-edge/80 bg-void/50 p-2.5 text-[11px] text-ash-dim">
        💡 Drag node onto canvas or click to add.
      </div>
    </Panel>
  );
};

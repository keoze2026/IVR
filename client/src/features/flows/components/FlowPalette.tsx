/**
 * Draggable DSL node types for IVR flows: a row above the canvas on narrow
 * screens, a column beside it on wide ones.
 */

import { useState, type FC, type DragEvent } from "react";

import { Input, Panel, cx } from "@/components/ui";
import type { NodeSpec } from "@/types/domain";

import { NodeIcon } from "./nodeMeta";

interface FlowPaletteProps {
  specs: NodeSpec[];
  readOnly: boolean;
  onAddNode: (type: string, position?: { x: number; y: number }) => void;
}

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
    <Panel className="flex min-h-0 flex-col overflow-hidden xl:h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge p-3 xl:block">
        <div className="flex items-center justify-between gap-2">
          <h2 className="display text-sm font-semibold text-chalk">Node Palette</h2>
          <span className="num text-[11px] text-ash-dim">{specs.length} types</span>
        </div>
        <Input
          type="search"
          placeholder="Filter nodes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-52 xl:mt-2 xl:max-w-none"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto p-2 xl:min-h-0 xl:flex-1 xl:flex-col xl:gap-1 xl:overflow-x-hidden xl:overflow-y-auto">
        {filtered.map((spec) => (
          <div
            key={spec.type}
            draggable={!readOnly}
            onDragStart={(e) => handleDragStart(e, spec.type)}
            onClick={() => !readOnly && onAddNode(spec.type)}
            className={cx(
              "press group flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl border border-edge px-2.5 py-2 xl:items-start",
              readOnly
                ? "cursor-not-allowed opacity-50"
                : "cursor-grab hover:border-signal/50 hover:bg-live active:cursor-grabbing",
            )}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-live text-signal group-hover:bg-panel">
              <NodeIcon type={spec.type} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="num whitespace-nowrap text-sm font-medium text-chalk">
                  {spec.type}
                </span>
                {spec.terminal && (
                  <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ash">
                    ends
                  </span>
                )}
              </div>
              <p className="mt-0.5 hidden text-xs leading-snug text-ash-dim xl:line-clamp-2">
                {spec.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-edge p-2.5 text-xs text-ash-dim">
        Drag node onto canvas or click to add.
      </div>
    </Panel>
  );
};

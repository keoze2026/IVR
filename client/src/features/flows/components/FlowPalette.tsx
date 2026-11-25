/**
 * The step types that can be added to a flow: a row above the canvas on narrow
 * screens, a column beside it on wide ones.
 */

import { useState, type FC, type DragEvent } from "react";

import { Input, Panel } from "@/components/ui";
import type { NodeSpec } from "@/types/domain";

import { NodeIcon, nodeLabel } from "./nodeMeta";

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
  const term = filter.toLowerCase();

  const filtered = specs.filter((s) =>
    `${s.type} ${nodeLabel(s.type)} ${s.description}`.toLowerCase().includes(term),
  );

  const handleDragStart = (e: DragEvent, type: string) => {
    e.dataTransfer.setData("application/ivr-node-type", type);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden xl:h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge p-3 xl:block">
        <div>
          <h2 className="display text-sm font-semibold text-chalk">Add a step</h2>
          <p className="text-xs text-ash-dim">Click, or drag onto the canvas.</p>
        </div>
        <Input
          type="search"
          placeholder="Search steps"
          aria-label="Search steps"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-52 xl:mt-2 xl:max-w-none"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto p-2 xl:min-h-0 xl:flex-1 xl:flex-col xl:gap-1 xl:overflow-x-hidden xl:overflow-y-auto">
        {filtered.map((spec) => (
          <div
            key={spec.type}
            role="button"
            tabIndex={readOnly ? -1 : 0}
            aria-disabled={readOnly || undefined}
            title={spec.description}
            draggable={!readOnly}
            onDragStart={(e) => handleDragStart(e, spec.type)}
            onClick={() => !readOnly && onAddNode(spec.type)}
            onKeyDown={(e) => {
              if (!readOnly && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onAddNode(spec.type);
              }
            }}
            className="press group flex min-h-11 shrink-0 cursor-grab items-center gap-2.5 rounded-xl border border-edge px-2.5 py-2 hover:border-signal/50 hover:bg-live active:cursor-grabbing xl:items-start"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-live text-signal group-hover:bg-panel">
              <NodeIcon type={spec.type} />
            </span>

            <div className="min-w-0 flex-1">
              <span className="block whitespace-nowrap text-sm font-medium text-chalk first-letter:uppercase">
                {nodeLabel(spec.type)}
              </span>
              <p className="mt-0.5 hidden text-xs leading-snug text-ash-dim xl:line-clamp-2">
                {spec.description}
              </p>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-2 py-3 text-sm text-ash">No matching steps.</p>
        )}
      </div>
    </Panel>
  );
};

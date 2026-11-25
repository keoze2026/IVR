/**
 * Canvas toolbar: view switch, auto-arrange and zoom controls.
 */

import type { FC, ReactNode } from "react";

import { cx } from "@/components/ui";

interface FlowToolbarProps {
  zoom: number;
  nodeCount: number;
  edgeCount: number;
  viewMode: "canvas" | "outline";
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitView: () => void;
  onAutoLayout: () => void;
  onToggleViewMode: () => void;
}

export const FlowToolbar: FC<FlowToolbarProps> = ({
  zoom,
  nodeCount,
  edgeCount,
  viewMode,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitView,
  onAutoLayout,
  onToggleViewMode,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge bg-panel px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="flex rounded-xl bg-raised p-1">
          {(
            [
              ["canvas", "Visual Graph"],
              ["outline", "Outline View"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode}
              onClick={() => viewMode !== mode && onToggleViewMode()}
              className={cx(
                "press min-h-9 rounded-lg px-3 text-sm font-medium",
                viewMode === mode
                  ? "bg-panel text-signal shadow-sm"
                  : "text-ash hover:text-chalk",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="num hidden text-xs text-ash-dim sm:inline xl:hidden 2xl:inline">
          {nodeCount} nodes · {edgeCount} wires
        </span>
      </div>

      {viewMode === "canvas" && (
        <div className="flex flex-wrap items-center gap-1">
          <ToolButton title="Auto-arrange nodes hierarchically" onClick={onAutoLayout}>
            Auto Layout
          </ToolButton>
          <ToolButton title="Zoom out (-)" onClick={onZoomOut}>
            −
          </ToolButton>
          <ToolButton title="Reset to 100%" onClick={onResetZoom}>
            <span className="num min-w-10">{Math.round(zoom * 100)}%</span>
          </ToolButton>
          <ToolButton title="Zoom in (+)" onClick={onZoomIn}>
            +
          </ToolButton>
          <ToolButton title="Fit to view" onClick={onFitView}>
            Fit
          </ToolButton>
        </div>
      )}
    </div>
  );
};

function ToolButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="press flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium text-ash ring-1 ring-inset ring-edge hover:bg-live hover:text-signal"
    >
      {children}
    </button>
  );
}

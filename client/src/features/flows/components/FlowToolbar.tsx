/**
 * Floating canvas toolbar for zoom controls, auto-layout, and view toggles.
 */

import type { FC } from "react";

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
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-edge bg-panel/90 px-3 py-1.5 shadow-lg backdrop-blur-md">
      {/* View Switcher & Stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-lg border border-edge bg-void p-0.5">
          <button
            type="button"
            onClick={() => viewMode !== "canvas" && onToggleViewMode()}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === "canvas"
                ? "bg-raised text-signal shadow-sm"
                : "text-ash hover:text-chalk"
            }`}
          >
            Visual Graph
          </button>
          <button
            type="button"
            onClick={() => viewMode !== "outline" && onToggleViewMode()}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              viewMode === "outline"
                ? "bg-raised text-signal shadow-sm"
                : "text-ash hover:text-chalk"
            }`}
          >
            Outline View
          </button>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          <span className="num text-xs text-ash">
            <span className="text-chalk">{nodeCount}</span> nodes
          </span>
          <span className="text-edge">·</span>
          <span className="num text-xs text-ash">
            <span className="text-chalk">{edgeCount}</span> wires
          </span>
        </div>
      </div>

      {/* Canvas Actions */}
      {viewMode === "canvas" && (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            title="Auto-arrange nodes hierarchically"
            onClick={onAutoLayout}
            className="flex items-center gap-1 rounded border border-edge bg-void px-2 py-1 text-xs text-ash hover:border-signal/50 hover:text-signal"
          >
            <span>🪄</span>
            <span>Auto Layout</span>
          </button>

          <div className="h-4 w-px bg-edge mx-1" />

          {/* Zoom controls */}
          <button
            type="button"
            title="Zoom out (-)"
            onClick={onZoomOut}
            className="flex size-7 items-center justify-center rounded border border-edge bg-void text-xs font-bold text-ash hover:text-chalk"
          >
            −
          </button>

          <button
            type="button"
            title="Reset to 100%"
            onClick={onResetZoom}
            className="num min-w-12 rounded border border-edge bg-void px-1.5 py-1 text-center text-xs text-ash hover:text-chalk"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            title="Zoom in (+)"
            onClick={onZoomIn}
            className="flex size-7 items-center justify-center rounded border border-edge bg-void text-xs font-bold text-ash hover:text-chalk"
          >
            +
          </button>

          <button
            type="button"
            title="Fit to view"
            onClick={onFitView}
            className="rounded border border-edge bg-void px-2 py-1 text-xs text-ash hover:text-chalk"
          >
            Fit
          </button>
        </div>
      )}
    </div>
  );
};

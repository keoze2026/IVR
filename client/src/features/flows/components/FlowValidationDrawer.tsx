/**
 * Bottom drawer displaying real-time flow validation results and short-circuit notices.
 */

import { useState, type FC } from "react";
import type { ValidationReport } from "@/types/domain";
import { Panel } from "@/components/ui";

interface FlowValidationDrawerProps {
  report: ValidationReport | null;
  isValidating: boolean;
  onSelectNode: (nodeId: string) => void;
}

export const FlowValidationDrawer: FC<FlowValidationDrawerProps> = ({
  report,
  isValidating,
  onSelectNode,
}) => {
  const [collapsed, setCollapsed] = useState(false);

  const errors = report?.errors ?? [];
  const warnings = report?.warnings ?? [];
  const totalCount = errors.length + warnings.length;

  const structuralErrors = errors.filter(
    (i) => i.node !== "" && !["dangling_transition", "no_terminal_path"].includes(i.code),
  );
  const graphChecksRan = structuralErrors.length === 0;

  return (
    <Panel className="overflow-hidden border-t border-edge">
      {/* Drawer Header */}
      <div
        onClick={() => setCollapsed(!collapsed)}
        className="flex cursor-pointer items-center justify-between border-b border-edge/80 px-4 py-2.5 hover:bg-raised"
      >
        <div className="flex items-center gap-2">
          <span className="eyebrow">Flow Checks</span>
          {isValidating ? (
            <span className="text-[11px] text-ash animate-pulse">verifying…</span>
          ) : report?.ok && warnings.length === 0 ? (
            <span className="rounded bg-live/20 px-2 py-0.5 text-[10px] font-medium text-live-bright">
              ✓ Ready to Publish
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              {errors.length > 0 && (
                <span className="rounded bg-rust/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rust">
                  {errors.length} error{errors.length > 1 ? "s" : ""}
                </span>
              )}
              {warnings.length > 0 && (
                <span className="rounded bg-amber/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber">
                  {warnings.length} warning{warnings.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          className="text-xs text-ash hover:text-chalk"
        >
          {collapsed ? "▲ Expand" : "▼ Collapse"}
        </button>
      </div>

      {/* Drawer Body */}
      {!collapsed && (
        <div>
          {!graphChecksRan && (
            <div className="border-b border-amber/30 bg-void px-4 py-2 text-xs text-amber">
              ⚠️ Fix the {structuralErrors.length} field error
              {structuralErrors.length > 1 ? "s" : ""} below to see reachability and
              dangling-transition checks — they only run once the document parses cleanly.
            </div>
          )}

          <div className="max-h-44 divide-y divide-edge/60 overflow-y-auto">
            {totalCount === 0 && report?.ok && (
              <div className="p-4 text-center text-xs text-live-bright">
                All transitions and node configurations are valid. No publish blockers found.
              </div>
            )}

            {errors.map((issue, idx) => (
              <div
                key={`e-${idx}`}
                onClick={() => issue.node && onSelectNode(issue.node)}
                className={`flex items-start justify-between px-4 py-2 transition-colors ${
                  issue.node ? "cursor-pointer hover:bg-raised" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-rust" />
                  <div>
                    <span className="text-xs font-medium text-chalk">
                      {issue.message}
                    </span>
                    <span className="num ml-2 text-[10px] text-ash-dim">
                      [{issue.code}]
                    </span>
                  </div>
                </div>
                {issue.node && (
                  <span className="num rounded border border-edge bg-void px-1.5 py-0.5 text-[10px] text-signal">
                    {issue.node} →
                  </span>
                )}
              </div>
            ))}

            {warnings.map((issue, idx) => (
              <div
                key={`w-${idx}`}
                onClick={() => issue.node && onSelectNode(issue.node)}
                className={`flex items-start justify-between px-4 py-2 transition-colors ${
                  issue.node ? "cursor-pointer hover:bg-raised" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber" />
                  <div>
                    <span className="text-xs text-chalk">{issue.message}</span>
                    <span className="num ml-2 text-[10px] text-ash-dim">
                      [{issue.code}]
                    </span>
                  </div>
                </div>
                {issue.node && (
                  <span className="num rounded border border-edge bg-void px-1.5 py-0.5 text-[10px] text-ash">
                    {issue.node} →
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
};

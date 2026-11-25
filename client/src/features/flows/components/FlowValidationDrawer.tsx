/**
 * Live validation results, with the short-circuit notice.
 */

import { useState, type FC } from "react";

import { ChevronIcon } from "@/components/icons";
import { Badge, ErrorState, Panel, cx } from "@/components/ui";
import type { ValidationIssue, ValidationReport } from "@/types/domain";

interface FlowValidationDrawerProps {
  report: ValidationReport | null;
  isValidating: boolean;
  /** Set when the check itself could not run, so the results may be stale. */
  failure?: unknown;
  onSelectNode: (nodeId: string) => void;
}

export const FlowValidationDrawer: FC<FlowValidationDrawerProps> = ({
  report,
  isValidating,
  failure,
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
    <Panel className="overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-void"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="display text-sm font-semibold text-chalk">Checks</span>
          {isValidating ? (
            <span className="animate-pulse text-xs text-ash">Checking…</span>
          ) : report?.ok && warnings.length === 0 ? (
            <Badge tone="good">Ready to publish</Badge>
          ) : (
            <>
              {errors.length > 0 && (
                <Badge tone="bad">
                  {errors.length} error{errors.length > 1 ? "s" : ""}
                </Badge>
              )}
              {warnings.length > 0 && (
                <Badge tone="warn">
                  {warnings.length} warning{warnings.length > 1 ? "s" : ""}
                </Badge>
              )}
            </>
          )}
        </span>

        <ChevronIcon className={cx("size-5 text-ash", !collapsed && "rotate-180")} />
      </button>

      {!collapsed && (
        <div className={cx((failure || !graphChecksRan || totalCount > 0) && "border-t border-edge")}>
          {Boolean(failure) && (
            <div className="p-3">
              <ErrorState error={failure} />
            </div>
          )}

          {!graphChecksRan && (
            <p className="border-b border-edge bg-[#fdf1dc] px-4 py-2 text-sm text-amber">
              Fix the {structuralErrors.length} field error
              {structuralErrors.length > 1 ? "s" : ""} first. Broken-link and
              unreachable-step checks run after that.
            </p>
          )}

          {totalCount > 0 && (
            <ul className="max-h-56 divide-y divide-edge overflow-y-auto">
              {errors.map((issue, idx) => (
                <IssueRow key={`e-${idx}`} issue={issue} tone="bad" onSelectNode={onSelectNode} />
              ))}
              {warnings.map((issue, idx) => (
                <IssueRow key={`w-${idx}`} issue={issue} tone="warn" onSelectNode={onSelectNode} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
};

function IssueRow({
  issue,
  tone,
  onSelectNode,
}: {
  issue: ValidationIssue;
  tone: "bad" | "warn";
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        title={issue.code}
        disabled={!issue.node}
        onClick={() => issue.node && onSelectNode(issue.node)}
        className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left enabled:hover:bg-void"
      >
        <span
          className={cx("size-2 shrink-0 rounded-full", tone === "bad" ? "bg-rust" : "bg-amber")}
          aria-hidden
        />
        <span className="min-w-0 flex-1 break-words text-sm text-chalk">
          <span className="sr-only">{tone === "bad" ? "Error: " : "Warning: "}</span>
          {issue.message}
        </span>
        {issue.node && (
          <span className="num max-w-[40%] shrink-0 truncate rounded-lg bg-raised px-2 py-1 text-xs text-signal">
            {issue.node} →
          </span>
        )}
      </button>
    </li>
  );
}

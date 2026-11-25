/**
 * Context-aware property inspector for the currently selected IVR flow node.
 */

import type { FC, ReactNode } from "react";
import type {
  BranchCondition,
  FlowDefinition,
  FlowNode,
  NodeSpec,
  ValidationIssue,
} from "@/types/domain";
import { Input, Panel, Select, Textarea, cx } from "@/components/ui";

import { NodeIcon, nodeLabel } from "./nodeMeta";

interface FlowInspectorProps {
  doc: FlowDefinition;
  selectedIds: string[];
  spec?: NodeSpec;
  issues: ValidationIssue[];
  readOnly: boolean;
  onChange: (id: string, patch: Partial<FlowNode>) => void;
  onRenameNode: (oldId: string, newId: string) => void;
  onClose: () => void;
}

const BRANCH_OPS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "is not" },
  { value: "gt", label: "is more than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "in", label: "is in list" },
  { value: "starts_with", label: "starts with" },
  { value: "is_set", label: "is set" },
  { value: "is_empty", label: "is empty" },
];

export const FlowInspector: FC<FlowInspectorProps> = ({
  doc,
  selectedIds,
  spec,
  issues,
  readOnly,
  onChange,
  onRenameNode,
  onClose,
}) => {
  if (selectedIds.length !== 1) {
    const many = selectedIds.length > 1;
    return (
      <Panel className="flex min-h-28 flex-col items-center justify-center p-6 text-center lg:h-full">
        <p className="display text-sm font-semibold text-chalk">
          {many ? `${selectedIds.length} steps selected` : "No step selected"}
        </p>
        <p className="mt-1 text-sm text-ash">
          {many
            ? readOnly
              ? "Select one step to see its settings."
              : "Select one to edit it. Delete removes them; Ctrl+D copies them."
            : "Select a step to see its settings."}
        </p>
      </Panel>
    );
  }

  const selectedId = selectedIds[0]!;
  if (!doc.nodes[selectedId]) return null;

  const node = doc.nodes[selectedId]!;
  const nodeIds = Object.keys(doc.nodes);
  const targetChoices = nodeIds.filter((id) => id !== selectedId);

  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");

  const targetOptions = targetChoices.map((t) => (
    <option key={t} value={t}>
      {t}
    </option>
  ));

  /** One "go to step" setting. */
  const transition = (field: string, label: string, empty: string) => (
    <Labelled label={label}>
      <Select
        value={(node[field] as string) ?? ""}
        disabled={readOnly}
        onChange={(e) =>
          onChange(selectedId, { [field]: e.target.value || undefined })
        }
      >
        <option value="">{empty}</option>
        {targetOptions}
      </Select>
    </Labelled>
  );

  const setCondition = (idx: number, patch: Partial<BranchCondition>) => {
    const next = [...(node.conditions ?? [])];
    next[idx] = { ...next[idx]!, ...patch };
    onChange(selectedId, { conditions: next });
  };

  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden lg:h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-live text-signal">
          <NodeIcon type={node.type} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="num truncate text-sm font-semibold text-chalk">
            {selectedId}
          </h2>
          <p className="text-xs text-ash-dim first-letter:uppercase">
            {nodeLabel(node.type)}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close step settings"
          className="press flex size-9 shrink-0 items-center justify-center rounded-full text-ash hover:bg-raised hover:text-chalk"
        >
          ✕
        </button>
      </div>

      {/* Body scrollable form */}
      <div className="flex-1 space-y-4 p-4 lg:min-h-0 lg:overflow-y-auto">
        {/* Validation Issues on this Node */}
        {issues.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-edge bg-void p-3">
            {[...errors, ...warnings].map((issue, idx) => (
              <li
                key={idx}
                className={cx(
                  "flex items-start gap-2 text-sm",
                  issue.level === "error" ? "text-rust" : "text-amber",
                )}
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                <span className="min-w-0 break-words">
                  <span className="sr-only">
                    {issue.level === "error" ? "Error: " : "Warning: "}
                  </span>
                  {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        {spec?.description && (
          <p className="text-xs text-ash">{spec.description}</p>
        )}

        <Labelled label="Step name">
          <Input
            type="text"
            value={selectedId}
            disabled={readOnly}
            onChange={(e) => {
              const newId = e.target.value.trim();
              if (newId && newId !== selectedId) {
                onRenameNode(selectedId, newId);
              }
            }}
            className="num"
          />
        </Labelled>

        {/* Prompts (TTS / Audio / Live Say) */}
        {node.prompt !== undefined && (
          <Section title="Message">
            <Select
              aria-label="Message type"
              value={node.prompt.kind}
              disabled={readOnly}
              onChange={(e) =>
                onChange(selectedId, {
                  prompt: { ...node.prompt!, kind: e.target.value as any },
                })
              }
            >
              <option value="tts">Text to speech</option>
              <option value="say">Text to speech, personalised per contact</option>
              <option value="audio">Audio file</option>
            </Select>

            {node.prompt.kind === "audio" ? (
              <Input
                type="text"
                aria-label="Audio asset ID"
                value={node.prompt.asset ?? ""}
                disabled={readOnly}
                placeholder="Audio asset ID"
                onChange={(e) =>
                  onChange(selectedId, {
                    prompt: { ...node.prompt!, asset: e.target.value },
                  })
                }
                className="num"
              />
            ) : (
              <Textarea
                aria-label="Message text"
                value={node.prompt.text ?? ""}
                disabled={readOnly}
                rows={3}
                placeholder="Hello {{first_name}}..."
                onChange={(e) =>
                  onChange(selectedId, {
                    prompt: { ...node.prompt!, text: e.target.value },
                  })
                }
              />
            )}

            <label className="flex min-h-9 items-center gap-2 text-sm text-ash">
              <input
                type="checkbox"
                checked={node.barge_in ?? false}
                disabled={readOnly}
                onChange={(e) =>
                  onChange(selectedId, { barge_in: e.target.checked })
                }
                className="size-4 accent-[var(--color-signal)]"
              />
              Keypress can interrupt
            </label>
          </Section>
        )}

        {/* Menu Keypresses & Options */}
        {node.type === "menu" && (
          <Section
            title="Keys"
            aside={`${Object.keys(node.options ?? {}).length}/12`}
          >
            {Object.entries(node.options ?? {}).map(([digit, target]) => (
              <div key={digit} className="flex items-center gap-2">
                <span className="num flex size-9 shrink-0 items-center justify-center rounded-lg bg-live text-sm font-bold text-signal">
                  {digit}
                </span>
                <Select
                  aria-label={`Key ${digit} goes to`}
                  value={target}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(selectedId, {
                      options: { ...node.options, [digit]: e.target.value },
                    })
                  }
                  className="min-w-0"
                >
                  <option value="">Choose a step…</option>
                  {targetOptions}
                </Select>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove key ${digit}`}
                    onClick={() => {
                      const next = { ...node.options };
                      delete next[digit];
                      onChange(selectedId, { options: next });
                    }}
                    className="press flex size-9 shrink-0 items-center justify-center rounded-lg text-ash hover:bg-[#fdeaea] hover:text-rust"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            {/* Quick-add digit buttons */}
            {!readOnly && (
              <div>
                <span className="eyebrow mb-1 block">Add a key</span>
                <div className="flex flex-wrap gap-1.5">
                  {"123456789*0#"
                    .split("")
                    .filter((d) => !(node.options ?? {})[d])
                    .map((digit) => (
                      <button
                        key={digit}
                        type="button"
                        aria-label={`Add key ${digit}`}
                        onClick={() =>
                          onChange(selectedId, {
                            options: {
                              ...node.options,
                              [digit]: targetChoices[0] || "",
                            },
                          })
                        }
                        className="press num size-9 rounded-lg text-sm text-ash ring-1 ring-inset ring-edge hover:bg-live hover:text-signal"
                      >
                        {digit}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Collect Node Inputs */}
        {node.type === "collect" && (
          <Section title="Collect digits">
            <Labelled label="Save digits as">
              <Input
                type="text"
                value={(node as any).variable ?? ""}
                disabled={readOnly}
                placeholder="account_number"
                onChange={(e) =>
                  onChange(selectedId, { variable: e.target.value } as any)
                }
                className="num"
              />
            </Labelled>
          </Section>
        )}

        {/* Branch Conditions */}
        {node.type === "branch" && (
          <Section title="Conditions">
            {(node.conditions ?? []).map((cond, idx) => (
              <div key={idx} className="space-y-2 rounded-xl border border-edge bg-void p-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Rule {idx + 1}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      aria-label={`Remove rule ${idx + 1}`}
                      onClick={() => {
                        const next = [...(node.conditions ?? [])];
                        next.splice(idx, 1);
                        onChange(selectedId, { conditions: next });
                      }}
                      className="press min-h-9 rounded-lg px-2 text-xs font-medium text-ash hover:text-rust"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <Input
                  type="text"
                  aria-label={`Rule ${idx + 1} variable`}
                  value={cond.variable}
                  disabled={readOnly}
                  placeholder="Variable"
                  onChange={(e) => setCondition(idx, { variable: e.target.value })}
                  className="num"
                />
                <Select
                  aria-label={`Rule ${idx + 1} comparison`}
                  value={cond.op}
                  disabled={readOnly}
                  onChange={(e) => setCondition(idx, { op: e.target.value })}
                >
                  {BRANCH_OPS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </Select>
                <Input
                  type="text"
                  aria-label={`Rule ${idx + 1} value`}
                  value={(cond.value as string) ?? ""}
                  disabled={readOnly}
                  placeholder="Value"
                  onChange={(e) => setCondition(idx, { value: e.target.value })}
                />
                <Select
                  aria-label={`Rule ${idx + 1} goes to`}
                  value={cond.then}
                  disabled={readOnly}
                  onChange={(e) => setCondition(idx, { then: e.target.value })}
                >
                  <option value="">Then go to…</option>
                  {targetOptions}
                </Select>
              </div>
            ))}

            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  const next = [...(node.conditions ?? [])];
                  next.push({ variable: "status", op: "eq", value: "active", then: "" });
                  onChange(selectedId, { conditions: next });
                }}
                className="press min-h-10 w-full rounded-xl border border-dashed border-edge-bright text-sm font-medium text-signal hover:bg-live"
              >
                + Add rule
              </button>
            )}
          </Section>
        )}

        {/* Fall-through / Standard Transitions */}
        <Section title="What happens next">
          {node.type !== "hangup" &&
            node.type !== "voicemail" &&
            transition("next", "Next step", "None (hang up)")}

          {(node.type === "menu" || node.type === "collect") && (
            <>
              {transition("on_timeout", "If no key is pressed", "None")}
              {transition("on_invalid", "If the wrong key is pressed", "None")}
            </>
          )}

          {node.type === "transfer" &&
            transition("on_fail", "If the transfer fails", "None")}

          {node.type === "branch" &&
            transition("default", "Otherwise go to", "None")}

          <Labelled label="Record outcome as">
            <Select
              value={node.disposition ?? ""}
              disabled={readOnly}
              onChange={(e) =>
                onChange(selectedId, { disposition: e.target.value || undefined })
              }
            >
              <option value="">None</option>
              {[
                "confirmed",
                "transferred",
                "opted_out",
                "voicemail",
                "no_input",
                "abandoned",
              ].map((d) => (
                <option key={d} value={d}>
                  {d.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Labelled>
        </Section>
      </div>
    </Panel>
  );
};

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2 border-t border-edge pt-3">
      <div className="flex items-center justify-between">
        <h3 className="display text-sm font-semibold text-chalk">{title}</h3>
        {aside && <span className="num text-xs text-ash-dim">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** A caption wrapped around its control, so no ids are needed. */
function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="eyebrow block">{label}</span>
      {children}
    </label>
  );
}

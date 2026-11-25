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

import { NodeIcon } from "./nodeMeta";

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
  { value: "eq", label: "==" },
  { value: "neq", label: "!=" },
  { value: "gt", label: ">" },
  { value: "gte", label: ">=" },
  { value: "lt", label: "<" },
  { value: "lte", label: "<=" },
  { value: "in", label: "in list" },
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
          {many ? `${selectedIds.length} Nodes Selected` : "No Node Selected"}
        </p>
        <p className="mt-1 text-sm text-ash">
          {many
            ? "Group editing is not supported. Please select a single node to inspect its properties."
            : "Click any node or wire on the canvas to inspect and configure its settings."}
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
          <div className="flex items-center gap-2">
            <span className="eyebrow">Inspector</span>
            <span className="num rounded bg-void px-1.5 py-0.5 text-[11px] text-signal">
              {node.type}
            </span>
          </div>
          <h2 className="num truncate text-sm font-semibold text-chalk">
            {selectedId}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
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
            <li className="eyebrow !text-rust">Node Checks</li>
            {[...errors, ...warnings].map((issue, idx) => (
              <li
                key={idx}
                className={cx(
                  "flex items-start gap-2 text-sm",
                  issue.level === "error" ? "text-rust" : "text-amber",
                )}
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                <span className="min-w-0 break-words">{issue.message}</span>
              </li>
            ))}
          </ul>
        )}

        {spec?.description && (
          <p className="text-xs text-ash">{spec.description}</p>
        )}

        <Labelled label="Node ID">
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
          <Section title="Prompt Audio">
            <Select
              value={node.prompt.kind}
              disabled={readOnly}
              onChange={(e) =>
                onChange(selectedId, {
                  prompt: { ...node.prompt!, kind: e.target.value as any },
                })
              }
            >
              <option value="tts">Speak (pre-rendered TTS)</option>
              <option value="say">Speak (dynamic per-contact)</option>
              <option value="audio">Play Audio Asset (Upload)</option>
            </Select>

            {node.prompt.kind === "audio" ? (
              <Input
                type="text"
                value={node.prompt.asset ?? ""}
                disabled={readOnly}
                placeholder="Asset UUID (e.g. ast_1234)"
                onChange={(e) =>
                  onChange(selectedId, {
                    prompt: { ...node.prompt!, asset: e.target.value },
                  })
                }
                className="num"
              />
            ) : (
              <Textarea
                value={node.prompt.text ?? ""}
                disabled={readOnly}
                rows={3}
                placeholder="Prompt text (e.g. Hello {{first_name}}...)"
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
              Barge-in
            </label>
          </Section>
        )}

        {/* Menu Keypresses & Options */}
        {node.type === "menu" && (
          <Section
            title="Keypress Routes"
            aside={`${Object.keys(node.options ?? {}).length}/12`}
          >
            {Object.entries(node.options ?? {}).map(([digit, target]) => (
              <div key={digit} className="flex items-center gap-2">
                <span className="num flex size-9 shrink-0 items-center justify-center rounded-lg bg-live text-sm font-bold text-signal">
                  {digit}
                </span>
                <Select
                  value={target}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(selectedId, {
                      options: { ...node.options, [digit]: e.target.value },
                    })
                  }
                  className="min-w-0"
                >
                  <option value="">— select target —</option>
                  {targetOptions}
                </Select>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...node.options };
                      delete next[digit];
                      onChange(selectedId, { options: next });
                    }}
                    className="press flex size-9 shrink-0 items-center justify-center rounded-lg text-ash hover:bg-bad-soft hover:text-rust"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}

            {/* Quick-add digit buttons */}
            {!readOnly && (
              <div>
                <div className="flex flex-wrap gap-1.5">
                  {"123456789*0#"
                    .split("")
                    .filter((d) => !(node.options ?? {})[d])
                    .map((digit) => (
                      <button
                        key={digit}
                        type="button"
                        onClick={() =>
                          onChange(selectedId, {
                            options: {
                              ...node.options,
                              [digit]: targetChoices[0] || "",
                            },
                          })
                        }
                        className="press num h-9 min-w-9 rounded-lg px-1.5 text-sm text-ash ring-1 ring-inset ring-edge hover:bg-live hover:text-signal"
                      >
                        +{digit}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Collect Node Inputs */}
        {node.type === "collect" && (
          <Section title="Collect Digits">
            <Labelled label="Save into Variable">
              <Input
                type="text"
                value={(node as any).variable ?? ""}
                disabled={readOnly}
                placeholder="e.g. account_number"
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
          <Section title="Branch Conditions">
            {(node.conditions ?? []).map((cond, idx) => (
              <div key={idx} className="space-y-2 rounded-xl border border-edge bg-void p-3">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Rule #{idx + 1}</span>
                  {!readOnly && (
                    <button
                      type="button"
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
                  value={cond.variable}
                  disabled={readOnly}
                  placeholder="variable"
                  onChange={(e) => setCondition(idx, { variable: e.target.value })}
                  className="num"
                />
                <Select
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
                  value={(cond.value as string) ?? ""}
                  disabled={readOnly}
                  placeholder="value to compare"
                  onChange={(e) => setCondition(idx, { value: e.target.value })}
                />
                <Select
                  value={cond.then}
                  disabled={readOnly}
                  onChange={(e) => setCondition(idx, { then: e.target.value })}
                >
                  <option value="">— target if matched —</option>
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
                + Add Condition Rule
              </button>
            )}
          </Section>
        )}

        {/* Fall-through / Standard Transitions */}
        <Section title="Transitions">
          {node.type !== "hangup" &&
            node.type !== "voicemail" &&
            transition("next", "Next Step", "— none (hangup) —")}

          {(node.type === "menu" || node.type === "collect") && (
            <>
              {transition("on_timeout", "On Timeout", "— none —")}
              {transition("on_invalid", "On Invalid Input", "— none —")}
            </>
          )}

          {node.type === "transfer" &&
            transition("on_fail", "On Transfer Fail", "— none —")}

          {node.type === "branch" &&
            transition("default", "Default Target (Fallback)", "— none —")}
        </Section>

        {/* Call Disposition / Outcome */}
        <div className="border-t border-edge pt-3">
          <Labelled label="Records Outcome As">
            <Select
              value={node.disposition ?? ""}
              disabled={readOnly}
              onChange={(e) =>
                onChange(selectedId, { disposition: e.target.value || undefined })
              }
            >
              <option value="">— none —</option>
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
        </div>
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

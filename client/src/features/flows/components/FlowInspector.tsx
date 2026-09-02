/**
 * Context-aware property inspector for the currently selected IVR flow node.
 */

import type { FC } from "react";
import type {
  FlowDefinition,
  FlowNode,
  NodeSpec,
  ValidationIssue,
} from "@/types/domain";
import { Panel, Select } from "@/components/ui";

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
  if (selectedIds.length === 0) {
    return (
      <Panel className="flex h-full w-80 shrink-0 flex-col items-center justify-center p-6 text-center">
        <span className="text-2xl text-ash-dim">👆</span>
        <p className="mt-2 text-sm font-medium text-chalk">No Node Selected</p>
        <p className="mt-1 text-xs text-ash">
          Click any node or wire on the canvas to inspect and configure its settings.
        </p>
      </Panel>
    );
  }

  if (selectedIds.length > 1) {
    return (
      <Panel className="flex h-full w-80 shrink-0 flex-col items-center justify-center p-6 text-center">
        <span className="text-2xl text-ash-dim">🗂️</span>
        <p className="mt-2 text-sm font-medium text-chalk">{selectedIds.length} Nodes Selected</p>
        <p className="mt-1 text-xs text-ash">
          Group editing is not supported. Please select a single node to inspect its properties.
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

  return (
    <Panel className="flex h-full w-80 shrink-0 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="eyebrow">Inspector</span>
            <span className="num rounded bg-void px-1.5 py-0.5 text-[10px] text-signal">
              {node.type}
            </span>
          </div>
          <p className="num mt-0.5 truncate text-sm font-semibold text-chalk">
            {selectedId}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-ash hover:bg-raised hover:text-chalk"
        >
          ✕
        </button>
      </div>

      {/* Body scrollable form */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Validation Issues on this Node */}
        {issues.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-edge bg-void p-3">
            <span className="eyebrow text-rust">Node Checks</span>
            {errors.map((e, idx) => (
              <div key={idx} className="flex items-start gap-1.5 text-xs text-rust">
                <span className="mt-0.5">●</span>
                <span>{e.message}</span>
              </div>
            ))}
            {warnings.map((w, idx) => (
              <div key={idx} className="flex items-start gap-1.5 text-xs text-amber">
                <span className="mt-0.5">●</span>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Node Identifier */}
        <div>
          <label className="eyebrow mb-1 block">Node ID</label>
          <input
            type="text"
            value={selectedId}
            disabled={readOnly}
            onChange={(e) => {
              const newId = e.target.value.trim();
              if (newId && newId !== selectedId) {
                onRenameNode(selectedId, newId);
              }
            }}
            className="num w-full rounded border border-edge bg-void px-3 py-1.5 text-xs text-chalk focus:border-signal focus:outline-none"
          />
        </div>

        {/* Node Description from Spec */}
        {spec?.description && (
          <p className="text-xs text-ash">{spec.description}</p>
        )}

        {/* Prompts (TTS / Audio / Live Say) */}
        {node.prompt !== undefined && (
          <div className="space-y-2 border-t border-edge/80 pt-3">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Prompt Audio</span>
              <label className="flex items-center gap-1.5 text-[11px] text-ash">
                <input
                  type="checkbox"
                  checked={node.barge_in ?? false}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(selectedId, { barge_in: e.target.checked })
                  }
                  className="rounded border-edge bg-void text-signal focus:ring-0"
                />
                Barge-in
              </label>
            </div>

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
              <input
                type="text"
                value={node.prompt.asset ?? ""}
                disabled={readOnly}
                placeholder="Asset UUID (e.g. ast_1234)"
                onChange={(e) =>
                  onChange(selectedId, {
                    prompt: { ...node.prompt!, asset: e.target.value },
                  })
                }
                className="num w-full rounded border border-edge bg-void px-3 py-1.5 text-xs text-chalk focus:border-signal focus:outline-none"
              />
            ) : (
              <textarea
                value={node.prompt.text ?? ""}
                disabled={readOnly}
                rows={3}
                placeholder="Prompt text (e.g. Hello {{first_name}}...)"
                onChange={(e) =>
                  onChange(selectedId, {
                    prompt: { ...node.prompt!, text: e.target.value },
                  })
                }
                className="w-full rounded border border-edge bg-void px-3 py-1.5 text-xs text-chalk focus:border-signal focus:outline-none"
              />
            )}
          </div>
        )}

        {/* Menu Keypresses & Options */}
        {node.type === "menu" && (
          <div className="space-y-2 border-t border-edge/80 pt-3">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Keypress Routes</span>
              <span className="num text-[10px] text-ash-dim">
                {Object.keys(node.options ?? {}).length}/12
              </span>
            </div>

            <div className="space-y-1.5">
              {Object.entries(node.options ?? {}).map(([digit, target]) => (
                <div key={digit} className="flex items-center gap-1.5">
                  <span className="num flex size-7 shrink-0 items-center justify-center rounded border border-edge bg-void text-xs font-bold text-signal">
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
                    className="text-xs"
                  >
                    <option value="">— select target —</option>
                    {targetChoices.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...node.options };
                        delete next[digit];
                        onChange(selectedId, { options: next });
                      }}
                      className="p-1 text-ash hover:text-rust"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Quick-add digit buttons */}
            {!readOnly && (
              <div className="flex flex-wrap gap-1 pt-1">
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
                      className="num rounded border border-edge bg-void px-2 py-0.5 text-xs text-ash hover:border-signal hover:text-signal"
                    >
                      +{digit}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Collect Node Inputs */}
        {node.type === "collect" && (
          <div className="space-y-2 border-t border-edge/80 pt-3">
            <span className="eyebrow">Collect Digits</span>
            <div>
              <label className="text-[11px] text-ash">Save into Variable</label>
              <input
                type="text"
                value={(node as any).variable ?? ""}
                disabled={readOnly}
                placeholder="e.g. account_number"
                onChange={(e) =>
                  onChange(selectedId, { variable: e.target.value } as any)
                }
                className="num mt-1 w-full rounded border border-edge bg-void px-3 py-1.5 text-xs text-chalk focus:border-signal focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Branch Conditions */}
        {node.type === "branch" && (
          <div className="space-y-2 border-t border-edge/80 pt-3">
            <span className="eyebrow">Branch Conditions</span>
            {(node.conditions ?? []).map((cond, idx) => (
              <div key={idx} className="space-y-1 rounded border border-edge bg-void p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-ash">Rule #{idx + 1}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...(node.conditions ?? [])];
                        next.splice(idx, 1);
                        onChange(selectedId, { conditions: next });
                      }}
                      className="text-[10px] text-ash hover:text-rust"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    value={cond.variable}
                    disabled={readOnly}
                    placeholder="variable"
                    onChange={(e) => {
                      const next = [...(node.conditions ?? [])];
                      next[idx] = { ...next[idx]!, variable: e.target.value };
                      onChange(selectedId, { conditions: next });
                    }}
                    className="num rounded border border-edge bg-panel px-2 py-1 text-xs text-chalk"
                  />
                  <Select
                    value={cond.op}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = [...(node.conditions ?? [])];
                      next[idx] = { ...next[idx]!, op: e.target.value };
                      onChange(selectedId, { conditions: next });
                    }}
                  >
                    {BRANCH_OPS.map((op) => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <input
                  type="text"
                  value={(cond.value as string) ?? ""}
                  disabled={readOnly}
                  placeholder="value to compare"
                  onChange={(e) => {
                    const next = [...(node.conditions ?? [])];
                    next[idx] = { ...next[idx]!, value: e.target.value };
                    onChange(selectedId, { conditions: next });
                  }}
                  className="w-full rounded border border-edge bg-panel px-2 py-1 text-xs text-chalk"
                />
                <Select
                  value={cond.then}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = [...(node.conditions ?? [])];
                    next[idx] = { ...next[idx]!, then: e.target.value };
                    onChange(selectedId, { conditions: next });
                  }}
                >
                  <option value="">— target if matched —</option>
                  {targetChoices.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
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
                className="w-full rounded border border-dashed border-edge py-1.5 text-xs text-ash hover:border-signal hover:text-signal"
              >
                + Add Condition Rule
              </button>
            )}
          </div>
        )}

        {/* Fall-through / Standard Transitions */}
        <div className="space-y-2 border-t border-edge/80 pt-3">
          <span className="eyebrow">Transitions</span>

          {node.type !== "hangup" && node.type !== "voicemail" && (
            <div>
              <label className="text-[11px] text-ash">Next Step</label>
              <Select
                value={node.next ?? ""}
                disabled={readOnly}
                onChange={(e) => onChange(selectedId, { next: e.target.value || undefined })}
              >
                <option value="">— none (hangup) —</option>
                {targetChoices.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {(node.type === "menu" || node.type === "collect") && (
            <>
              <div>
                <label className="text-[11px] text-ash">On Timeout</label>
                <Select
                  value={node.on_timeout ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(selectedId, { on_timeout: e.target.value || undefined })
                  }
                >
                  <option value="">— none —</option>
                  {targetChoices.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-[11px] text-ash">On Invalid Input</label>
                <Select
                  value={node.on_invalid ?? ""}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(selectedId, { on_invalid: e.target.value || undefined })
                  }
                >
                  <option value="">— none —</option>
                  {targetChoices.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {node.type === "transfer" && (
            <div>
              <label className="text-[11px] text-ash">On Transfer Fail</label>
              <Select
                value={(node as any).on_fail ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  onChange(selectedId, { on_fail: e.target.value || undefined } as any)
                }
              >
                <option value="">— none —</option>
                {targetChoices.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {node.type === "branch" && (
            <div>
              <label className="text-[11px] text-ash">Default Target (Fallback)</label>
              <Select
                value={(node as any).default ?? ""}
                disabled={readOnly}
                onChange={(e) =>
                  onChange(selectedId, { default: e.target.value || undefined } as any)
                }
              >
                <option value="">— none —</option>
                {targetChoices.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>

        {/* Call Disposition / Outcome */}
        <div className="border-t border-edge/80 pt-3">
          <label className="eyebrow mb-1 block">Records Outcome As</label>
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
        </div>
      </div>
    </Panel>
  );
};

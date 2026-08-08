/**
 * The flow builder.
 *
 * Three things about the backend shape this screen:
 *
 * 1. The palette is built from `GET flows/node-types/`, which the backend
 *    generates from its own NODE_SPECS specifically so the builder cannot
 *    drift from the DSL. Nothing here is hardcoded.
 *
 * 2. Validation short-circuits. If any node-level error exists, the validator
 *    skips graph, reference and advisory checks entirely — so a document with
 *    one bad field shows *no* dangling-transition feedback. The issue drawer
 *    says so out loud, because otherwise a clean-looking graph reads as a
 *    valid graph.
 *
 * 3. Drafts with a dangling edge cannot be saved (G-02). The backend rejects
 *    `dangling_transition` and `no_terminal_path` on write, which is the
 *    normal state of a half-drawn flow. So the builder holds the document
 *    locally and tells you plainly when the server will refuse it, rather than
 *    autosaving into a 400 loop.
 *
 * Canvas positions live in `definition.metadata.positions` — the only legal
 * place for them, since any unknown key on a *node* is a hard error.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { ClipButton } from "@/components/styled/ClipButton";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { BackLink, Button, ErrorState, Panel, Select, cx } from "@/components/ui";
import { ApiError } from "@/lib/errors";
import {
  useFlowVersion,
  useNodeTypes,
  usePublishVersion,
  useSaveDraft,
  useValidateFlow,
} from "@/lib/queries/resources";
import { useCan } from "@/lib/session";
import type {
  FlowDefinition,
  FlowNode,
  NodeSpec,
  ValidationIssue,
  ValidationReport,
} from "@/types/domain";

/** Edge labels exactly as the validator names them, so an error points at
 *  something the operator can see on the canvas. */
function edgesOf(id: string, node: FlowNode, spec?: NodeSpec) {
  const out: { from: string; to: string; label: string }[] = [];
  for (const field of spec?.transitions ?? []) {
    const target = node[field];
    if (typeof target === "string" && target) {
      out.push({ from: id, to: target, label: field });
    }
  }
  if (node.type === "menu" && node.options) {
    for (const [digit, target] of Object.entries(node.options)) {
      out.push({ from: id, to: target, label: `options.${digit}` });
    }
  }
  if (node.type === "branch" && node.conditions) {
    node.conditions.forEach((c, i) => {
      if (c.then) out.push({ from: id, to: c.then, label: `conditions[${i}]` });
    });
  }
  if (typeof node.next === "string" && node.next && !spec?.transitions.includes("next")) {
    out.push({ from: id, to: node.next, label: "next" });
  }
  return out;
}

export function FlowBuilderPage() {
  const { versionId } = useParams();
  const canEdit = useCan("flow.edit");
  const canPublish = useCan("flow.publish");

  const version = useFlowVersion(versionId);
  const catalogue = useNodeTypes();
  const validate = useValidateFlow();
  const save = useSaveDraft(versionId ?? "");
  const publish = usePublishVersion(versionId ?? "");

  const [doc, setDoc] = useState<FlowDefinition | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);

  useEffect(() => {
    if (version.data && !doc) {
      setDoc(version.data.definition);
      setReport(version.data.validation_report);
      setSelected(version.data.definition.entry);
    }
  }, [version.data, doc]);

  // The dry-run endpoint is built for exactly this — it always returns 200
  // and never saves, so it is safe to call on every edit.
  useEffect(() => {
    if (!doc) return;
    const timer = setTimeout(() => {
      validate.mutate(
        { definition: doc },
        { onSuccess: setReport },
      );
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  const specs = useMemo(() => {
    const map = new Map<string, NodeSpec>();
    catalogue.data?.nodes.forEach((s) => map.set(s.type, s));
    return map;
  }, [catalogue.data]);

  if (version.isLoading || catalogue.isLoading)
    return <PulseLoader label="Loading the flow" />;
  if (version.error) return <ErrorState error={version.error} />;
  if (!version.data || !doc) return null;

  const published = version.data.is_published;
  const readOnly = published || !canEdit;
  const nodeIds = Object.keys(doc.nodes);

  // Node-level errors suppress every graph check. Detect that so the drawer
  // can explain the silence instead of implying the graph is clean.
  const structural = (report?.errors ?? []).filter(
    (i) => i.node !== "" && !["dangling_transition", "no_terminal_path"].includes(i.code),
  );
  const graphChecksRan = structural.length === 0;

  // What the backend will refuse on a draft write, as opposed to at publish.
  const blocksSave = (report?.errors ?? []).filter(
    (i) => !["unknown_asset", "unknown_endpoint"].includes(i.code),
  );

  function update(id: string, patch: Partial<FlowNode>) {
    setDoc((d) =>
      d ? { ...d, nodes: { ...d.nodes, [id]: { ...d.nodes[id]!, ...patch } } } : d,
    );
  }

  function addNode(type: string) {
    const base = type.slice(0, 6);
    let id = base;
    let n = 1;
    while (doc!.nodes[id]) id = `${base}_${++n}`;
    const spec = specs.get(type);
    const node: FlowNode = { type: type as FlowNode["type"] };
    if (spec?.required.includes("prompt")) {
      node.prompt = { kind: "tts", text: "" };
    }
    if (type === "menu") node.options = {};
    if (type === "branch") node.conditions = [];
    setDoc({ ...doc!, nodes: { ...doc!.nodes, [id]: node } });
    setSelected(id);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <BackLink to={`/flows/${version.data.flow}`}>Versions</BackLink>
          <h1 className="display mt-2 flex items-center gap-3 text-xl font-semibold text-chalk">
            Version {version.data.version}
            {published ? (
              <span className="rounded border border-live-bright/40 bg-live/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-live-bright">
                published · immutable
              </span>
            ) : (
              <span className="rounded border border-signal/40 bg-signal/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal">
                draft
              </span>
            )}
          </h1>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {blocksSave.length > 0 && (
              <span className="text-xs text-amber">
                {blocksSave.length} error{blocksSave.length > 1 ? "s" : ""} —
                this cannot be saved yet
              </span>
            )}
            <Button
              variant="secondary"
              loading={save.isPending}
              disabled={blocksSave.length > 0}
              onClick={() => save.mutate({ definition: doc })}
            >
              Save draft
            </Button>
            {canPublish && (
              <ClipButton
                disabled={(report?.errors.length ?? 0) > 0 || publish.isPending}
                onClick={() => publish.mutate()}
              >
                Publish
              </ClipButton>
            )}
          </div>
        )}
      </header>

      {publish.error instanceof ApiError && publish.error.isInvalidFlow && (
        <div className="rounded border border-rust/40 bg-rust/10 px-4 py-3">
          <p className="text-sm font-medium text-rust">
            Publish refused. These must be fixed first.
          </p>
          <ul className="mt-2 space-y-1">
            {((publish.error.detail as ValidationReport)?.errors ?? []).map(
              (issue, i) => (
                <li key={i} className="text-sm text-chalk">
                  <span className="num text-xs text-ash">{issue.node || "flow"}</span>{" "}
                  {issue.message}
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_20rem]">
        {/* --- palette, straight from the server --------------------- */}
        <Panel className="h-fit">
          <div className="border-b border-edge px-3 py-2.5">
            <span className="eyebrow">Add a node</span>
          </div>
          <div className="space-y-0.5 p-2">
            {(catalogue.data?.nodes ?? []).map((spec) => (
              <button
                key={spec.type}
                disabled={readOnly}
                onClick={() => addNode(spec.type)}
                title={spec.description}
                className="w-full rounded px-2.5 py-1.5 text-left text-[13px] text-ash transition-colors hover:bg-raised hover:text-chalk disabled:opacity-40"
              >
                <span className="num">{spec.type}</span>
                {spec.terminal && (
                  <span className="ml-1.5 text-[10px] text-ash-dim">ends</span>
                )}
              </button>
            ))}
          </div>
        </Panel>

        {/* --- the graph --------------------------------------------- */}
        <Panel className="min-h-[22rem] overflow-auto p-3 lg:min-h-[28rem] lg:p-4">
          <div className="space-y-2">
            {nodeIds.map((id) => {
              const node = doc.nodes[id]!;
              const spec = specs.get(node.type);
              const edges = edgesOf(id, node, spec);
              const issues = (report?.errors ?? [])
                .concat(report?.warnings ?? [])
                .filter((i) => i.node === id);
              const unreachable = issues.some((i) => i.code === "unreachable");

              return (
                <div key={id}>
                  <button
                    onClick={() => setSelected(id)}
                    className={cx(
                      "w-full rounded border px-3 py-2.5 text-left transition-colors",
                      selected === id
                        ? "border-signal bg-signal/[0.08]"
                        : "border-edge bg-void hover:border-edge-bright",
                      unreachable && "opacity-45",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {id === doc.entry && (
                        <span className="rounded bg-signal px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-void">
                          entry
                        </span>
                      )}
                      <span className="num text-sm text-chalk">{id}</span>
                      <span className="num text-[11px] text-ash">{node.type}</span>
                      {spec?.terminal && (
                        <span className="text-[10px] text-ash-dim">terminal</span>
                      )}
                      {issues.some((i) => i.level === "error") && (
                        <span className="ml-auto size-1.5 rounded-full bg-rust" />
                      )}
                      {issues.length > 0 &&
                        !issues.some((i) => i.level === "error") && (
                          <span className="ml-auto size-1.5 rounded-full bg-amber" />
                        )}
                    </div>

                    {node.prompt?.text && (
                      <p className="mt-1 truncate text-xs text-ash">
                        “{node.prompt.text}”
                      </p>
                    )}
                  </button>

                  {edges.length > 0 && (
                    <div className="ml-6 mt-1 flex flex-wrap gap-1.5">
                      {edges.map((edge, i) => {
                        const missing = !doc.nodes[edge.to];
                        return (
                          <span
                            key={i}
                            className={cx(
                              "num rounded border px-1.5 py-0.5 text-[10px]",
                              missing
                                ? "border-rust/50 text-rust"
                                : "border-edge text-ash",
                            )}
                          >
                            {edge.label} → {edge.to}
                            {missing && " (missing)"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>

        {/* --- inspector --------------------------------------------- */}
        <Inspector
          doc={doc}
          selected={selected}
          spec={selected ? specs.get(doc.nodes[selected]?.type ?? "") : undefined}
          readOnly={readOnly}
          onChange={update}
        />
      </div>

      {/* --- issues ------------------------------------------------- */}
      <Panel>
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <span className="eyebrow">Checks</span>
          {validate.isPending && (
            <span className="text-[11px] text-ash">checking…</span>
          )}
        </div>

        {!graphChecksRan && (
          <p className="border-b border-amber/30 bg-amber/[0.07] px-4 py-2 text-xs text-amber">
            Fix the {structural.length} field error
            {structural.length > 1 ? "s" : ""} below to see reachability and
            dangling-transition checks — they do not run until the document
            parses cleanly.
          </p>
        )}

        <ul className="max-h-56 divide-y divide-edge overflow-y-auto">
          {(report?.errors ?? []).map((issue, i) => (
            <IssueRow key={`e${i}`} issue={issue} onSelect={setSelected} />
          ))}
          {(report?.warnings ?? []).map((issue, i) => (
            <IssueRow key={`w${i}`} issue={issue} onSelect={setSelected} />
          ))}
          {report?.ok && report.warnings.length === 0 && (
            <li className="px-4 py-3 text-sm text-live-bright">
              This flow is ready to publish.
            </li>
          )}
        </ul>
      </Panel>
    </div>
  );
}

function IssueRow({
  issue,
  onSelect,
}: {
  issue: ValidationIssue;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        onClick={() => issue.node && onSelect(issue.node)}
        className="flex w-full items-start gap-3 px-4 py-2 text-left hover:bg-raised/50"
      >
        <span
          className={cx(
            "mt-1.5 size-1.5 shrink-0 rounded-full",
            issue.level === "error" ? "bg-rust" : "bg-amber",
          )}
        />
        <span className="min-w-0">
          <span className="text-sm text-chalk">{issue.message}</span>
          <span className="num ml-2 text-[10px] text-ash-dim">
            {issue.code}
            {issue.node && ` · ${issue.node}`}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The inspector is a closed form, never a JSON editor.
 *
 * Any key outside a node type's declared set is a hard `unknown_field` error,
 * so free-form editing would let an author produce a document that cannot be
 * saved at all.
 */
function Inspector({
  doc,
  selected,
  spec,
  readOnly,
  onChange,
}: {
  doc: FlowDefinition;
  selected: string | null;
  spec: NodeSpec | undefined;
  readOnly: boolean;
  onChange: (id: string, patch: Partial<FlowNode>) => void;
}) {
  if (!selected || !doc.nodes[selected]) {
    return (
      <Panel className="h-fit p-4">
        <p className="text-sm text-ash">Pick a node to edit it.</p>
      </Panel>
    );
  }

  const node = doc.nodes[selected]!;
  const targets = Object.keys(doc.nodes);

  return (
    <Panel className="h-fit">
      <div className="border-b border-edge px-4 py-2.5">
        <span className="num text-sm text-chalk">{selected}</span>
        <span className="num ml-2 text-[11px] text-ash">{node.type}</span>
      </div>

      <div className="space-y-4 p-4">
        {spec?.description && (
          <p className="text-xs text-ash">{spec.description}</p>
        )}

        {/* Prompt — audio is picked, never typed. A `url` key is a hard
            error; it is the SSRF guard. */}
        {node.prompt !== undefined && (
          <div>
            <div className="eyebrow mb-1.5">Prompt</div>
            <Select
              value={node.prompt.kind}
              disabled={readOnly}
              onChange={(e) =>
                onChange(selected, {
                  prompt: { ...node.prompt!, kind: e.target.value as "tts" },
                })
              }
              className="mb-1.5"
            >
              <option value="tts">Speak (pre-rendered)</option>
              <option value="say">Speak (live)</option>
              <option value="audio">Play a recording</option>
            </Select>

            {node.prompt.kind === "audio" ? (
              <input
                value={node.prompt.asset ?? ""}
                disabled={readOnly}
                placeholder="Recording reference"
                onChange={(e) =>
                  onChange(selected, {
                    prompt: { ...node.prompt!, asset: e.target.value },
                  })
                }
                className="num w-full rounded border border-edge bg-void px-3 py-2 text-xs text-chalk"
              />
            ) : (
              <textarea
                value={node.prompt.text ?? ""}
                disabled={readOnly}
                rows={3}
                maxLength={4000}
                onChange={(e) =>
                  onChange(selected, {
                    prompt: { ...node.prompt!, text: e.target.value },
                  })
                }
                className="w-full rounded border border-edge bg-void px-3 py-2 text-sm text-chalk"
              />
            )}
            {node.prompt.kind === "audio" && (
              <p className="mt-1 text-[11px] text-amber">
                Pick from your recordings, or enter a reference.
              </p>
            )}
          </div>
        )}

        {/* Transitions, named exactly as the validator names them. */}
        {(spec?.transitions ?? []).map((field) => (
          <div key={field}>
            <div className="eyebrow mb-1.5">{field}</div>
            <Select
              value={(node[field] as string) ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange(selected, { [field]: e.target.value })}
            >
              <option value="">— none —</option>
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
        ))}

        {node.type === "menu" && (
          <div>
            <div className="eyebrow mb-1.5">Keypresses</div>
            <div className="space-y-1.5">
              {Object.entries(node.options ?? {}).map(([digit, target]) => (
                <div key={digit} className="flex items-center gap-2">
                  <span className="num flex size-7 items-center justify-center rounded border border-edge text-xs text-signal">
                    {digit}
                  </span>
                  <Select
                    value={target}
                    disabled={readOnly}
                    onChange={(e) =>
                      onChange(selected, {
                        options: { ...node.options, [digit]: e.target.value },
                      })
                    }
                  >
                    {targets.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                  <button
                    disabled={readOnly}
                    onClick={() => {
                      const next = { ...node.options };
                      delete next[digit];
                      onChange(selected, { options: next });
                    }}
                    className="text-xs text-ash hover:text-rust"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {!readOnly && Object.keys(node.options ?? {}).length < 12 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {"123456789*0#"
                  .split("")
                  .filter((d) => !(node.options ?? {})[d])
                  .map((digit) => (
                    <button
                      key={digit}
                      onClick={() =>
                        onChange(selected, {
                          options: {
                            ...node.options,
                            [digit]: targets[0] ?? "",
                          },
                        })
                      }
                      className="num rounded border border-edge px-2 py-1 text-xs text-ash hover:border-signal hover:text-signal"
                    >
                      +{digit}
                    </button>
                  ))}
              </div>
            )}
            {!Object.keys(node.options ?? {}).some((d) => d === "9" || d === "0") && (
              <p className="mt-2 text-[11px] text-amber">
                No opt-out key. Prerecorded marketing calls need an automated
                way out — usually 9.
              </p>
            )}
          </div>
        )}

        {node.type === "transfer" && (
          <div>
            <div className="eyebrow mb-1.5">Transfer to</div>
            <input
              value={node.endpoint ?? ""}
              disabled={readOnly}
              placeholder="Approved destination"
              onChange={(e) => onChange(selected, { endpoint: e.target.value })}
              className="num w-full rounded border border-edge bg-void px-3 py-2 text-xs text-chalk"
            />
            <p className="mt-1.5 text-[11px] text-ash">
              Destinations must be pre-approved. A raw number or SIP URI here is
              rejected — that restriction is what stops a flow being used to
              dial premium-rate numbers on your carrier account.
            </p>
          </div>
        )}

        <div>
          <div className="eyebrow mb-1.5">Records outcome as</div>
          <Select
            value={node.disposition ?? ""}
            disabled={readOnly}
            onChange={(e) => onChange(selected, { disposition: e.target.value })}
          >
            <option value="">— nothing —</option>
            {["confirmed", "transferred", "opted_out", "voicemail", "no_input", "abandoned"].map(
              (d) => (
                <option key={d} value={d}>
                  {d.replace(/_/g, " ")}
                </option>
              ),
            )}
          </Select>
        </div>
      </div>
    </Panel>
  );
}

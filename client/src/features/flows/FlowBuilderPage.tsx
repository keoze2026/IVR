/**
 * The IVR Visual Drag-and-Drop Flow Builder.
 *
 * Architecture & Constraints:
 * 1. The palette is built dynamically from `GET flows/node-types/` to match NODE_SPECS.
 * 2. Visual coordinates live in `definition.metadata.positions[nodeId]`.
 * 3. Validation short-circuits: field errors suppress graph-level reachability checks.
 * 4. Draft writes reject dangling transitions and loops without terminal paths.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";

import { ClipButton } from "@/components/styled/ClipButton";
import { PulseLoader } from "@/components/styled/PulseLoader";
import { BackLink, Button, ErrorState } from "@/components/ui";
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
  ValidationReport,
} from "@/types/domain";

import { FlowCanvas } from "./components/FlowCanvas";
import { FlowPalette } from "./components/FlowPalette";
import { FlowInspector } from "./components/FlowInspector";
import { FlowToolbar } from "./components/FlowToolbar";
import { FlowValidationDrawer } from "./components/FlowValidationDrawer";

import {
  getGraphEdges,
  connectPort,
  removeNodeSafely,
} from "./utils/graph";
import {
  computeAutoLayout,
  ensureNodePositions,
} from "./utils/layout";
import {
  snapToGrid,
  NODE_WIDTH,
  NODE_MIN_HEIGHT,
  type Point,
} from "./utils/geometry";

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(null);

  // Viewport and Canvas State
  const [viewMode, setViewMode] = useState<"canvas" | "outline">("canvas");
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState<Point>({ x: 40, y: 40 });

  const specs = useMemo(() => {
    const map = new Map<string, NodeSpec>();
    catalogue.data?.nodes.forEach((s) => map.set(s.type, s));
    return map;
  }, [catalogue.data]);

  // Initialize document and compute layout if needed
  useEffect(() => {
    if (version.data && !doc) {
      let initialDoc = version.data.definition;
      const positions = ensureNodePositions(initialDoc, specs);

      initialDoc = {
        ...initialDoc,
        metadata: {
          ...initialDoc.metadata,
          positions,
        },
      };

      setDoc(initialDoc);
      setReport(version.data.validation_report);
      const initialEntry = initialDoc.entry || Object.keys(initialDoc.nodes)[0];
      setSelectedIds(initialEntry ? [initialEntry] : []);
    }
  }, [version.data, doc, specs]);

  // Real-time debounced dry-run validation
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

  // Actions
  const updateNode = useCallback(
    (id: string, patch: Partial<FlowNode>) => {
      setDoc((prev) => {
        if (!prev || !prev.nodes[id]) return prev;
        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [id]: { ...prev.nodes[id]!, ...patch },
          },
        };
      });
    },
    [],
  );

  const updatePositions = useCallback(
    (newPositions: Record<string, Point>) => {
      setDoc((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          metadata: {
            ...prev.metadata,
            positions: newPositions,
          },
        };
      });
    },
    [],
  );

  const addNode = useCallback(
    (type: string, dropPos?: Point) => {
      if (!doc) return;
      const base = type.slice(0, 6);
      let newId = base;
      let counter = 1;
      while (doc.nodes[newId]) {
        newId = `${base}_${++counter}`;
      }

      const spec = specs.get(type);
      const newNode: FlowNode = { type: type as any };

      if (spec?.required.includes("prompt")) {
        newNode.prompt = { kind: "tts", text: "" };
      }
      if (type === "menu") newNode.options = {};
      if (type === "branch") newNode.conditions = [];

      // Calculate position
      const positions = { ...(doc.metadata?.positions ?? {}) };
      if (dropPos) {
        positions[newId] = dropPos;
      } else {
        const existingCount = Object.keys(doc.nodes).length;
        positions[newId] = {
          x: snapToGrid(80 + (existingCount % 4) * (NODE_WIDTH + 60)),
          y: snapToGrid(80 + Math.floor(existingCount / 4) * (NODE_MIN_HEIGHT + 80)),
        };
      }

      setDoc({
        ...doc,
        metadata: {
          ...doc.metadata,
          positions,
        },
        nodes: {
          ...doc.nodes,
          [newId]: newNode,
        },
      });
      setSelectedIds([newId]);
    },
    [doc, specs],
  );

  const deleteNode = useCallback(
    (idsToDelete: string | string[]) => {
      if (!doc) return;
      const ids = Array.isArray(idsToDelete) ? idsToDelete : [idsToDelete];
      let nextDoc = doc;
      for (const id of ids) {
        nextDoc = removeNodeSafely(nextDoc, id);
      }
      setDoc(nextDoc);
      setSelectedIds((prev) => {
        const remaining = prev.filter((id) => !ids.includes(id));
        if (remaining.length === 0) {
          const fallback = nextDoc.entry || Object.keys(nextDoc.nodes)[0];
          return fallback ? [fallback] : [];
        }
        return remaining;
      });
    },
    [doc],
  );

  const duplicateNode = useCallback(
    (idsToDup: string | string[]) => {
      if (!doc) return;
      const ids = Array.isArray(idsToDup) ? idsToDup : [idsToDup];
      let currentDoc = doc;
      const newIds: string[] = [];

      for (const idToDup of ids) {
        if (!currentDoc.nodes[idToDup]) continue;
        const source = currentDoc.nodes[idToDup]!;
        let newId = `${idToDup}_copy`;
        let counter = 1;
        while (currentDoc.nodes[newId]) {
          newId = `${idToDup}_copy${++counter}`;
        }

        const sourcePos = currentDoc.metadata?.positions?.[idToDup] ?? { x: 80, y: 80 };
        const newPos = {
          x: snapToGrid(sourcePos.x + 40),
          y: snapToGrid(sourcePos.y + 40),
        };

        currentDoc = {
          ...currentDoc,
          metadata: {
            ...currentDoc.metadata,
            positions: {
              ...(currentDoc.metadata?.positions ?? {}),
              [newId]: newPos,
            },
          },
          nodes: {
            ...currentDoc.nodes,
            [newId]: JSON.parse(JSON.stringify(source)),
          },
        };
        newIds.push(newId);
      }

      setDoc(currentDoc);
      setSelectedIds(newIds);
    },
    [doc],
  );

  const setEntryNode = useCallback(
    (id: string) => {
      if (!doc || !doc.nodes[id]) return;
      setDoc({
        ...doc,
        entry: id,
      });
    },
    [doc],
  );

  const renameNode = useCallback(
    (oldId: string, newId: string) => {
      if (!doc || !doc.nodes[oldId] || doc.nodes[newId]) return;

      const nextNodes: Record<string, FlowNode> = {};
      for (const [id, node] of Object.entries(doc.nodes)) {
        if (id === oldId) {
          nextNodes[newId] = node;
          continue;
        }

        // Remap references
        let patched = { ...node };
        if (patched.next === oldId) patched.next = newId;
        if (patched.on_timeout === oldId) patched.on_timeout = newId;
        if (patched.on_invalid === oldId) patched.on_invalid = newId;
        if ((patched as any).on_fail === oldId) (patched as any).on_fail = newId;
        if ((patched as any).default === oldId) (patched as any).default = newId;

        if (patched.options) {
          const opts: Record<string, string> = {};
          for (const [k, v] of Object.entries(patched.options)) {
            opts[k] = v === oldId ? newId : v;
          }
          patched.options = opts;
        }

        if (patched.conditions) {
          patched.conditions = patched.conditions.map((c) =>
            c.then === oldId ? { ...c, then: newId } : c,
          );
        }

        nextNodes[id] = patched;
      }

      // Update positions metadata
      const nextPositions = { ...(doc.metadata?.positions ?? {}) };
      if (nextPositions[oldId]) {
        nextPositions[newId] = nextPositions[oldId]!;
        delete nextPositions[oldId];
      }

      setDoc({
        ...doc,
        entry: doc.entry === oldId ? newId : doc.entry,
        metadata: {
          ...doc.metadata,
          positions: nextPositions,
        },
        nodes: nextNodes,
      });
      setSelectedIds((prev) =>
        prev.includes(oldId) ? [...prev.filter((i) => i !== oldId), newId] : prev
      );
    },
    [doc],
  );

  const connectWire = useCallback(
    (sourceNodeId: string, portId: string, targetNodeId: string | null) => {
      setDoc((prev) => {
        if (!prev || !prev.nodes[sourceNodeId]) return prev;
        const sourceNode = prev.nodes[sourceNodeId]!;
        const updatedSourceNode = connectPort(sourceNode, portId, targetNodeId);
        return {
          ...prev,
          nodes: {
            ...prev.nodes,
            [sourceNodeId]: updatedSourceNode,
          },
        };
      });
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length > 0) {
        deleteNode(selectedIds);
      } else if (e.key === "d" && (e.ctrlKey || e.metaKey) && selectedIds.length > 0) {
        e.preventDefault();
        duplicateNode(selectedIds);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, deleteNode, duplicateNode]);

  const handleAutoLayout = useCallback(() => {
    if (!doc) return;
    const computedPositions = computeAutoLayout(doc, specs);
    setDoc({
      ...doc,
      metadata: {
        ...doc.metadata,
        positions: computedPositions,
      },
    });
  }, [doc, specs]);

  const handleFitView = useCallback(() => {
    if (!doc) return;
    const positions = Object.values(doc.metadata?.positions ?? {}) as Point[];
    if (positions.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    positions.forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_WIDTH);
      maxY = Math.max(maxY, p.y + NODE_MIN_HEIGHT);
    });

    const graphWidth = maxX - minX + 160;
    const graphHeight = maxY - minY + 160;

    const scaleX = 900 / Math.max(graphWidth, 300);
    const scaleY = 500 / Math.max(graphHeight, 300);
    const newZoom = Math.min(Math.max(Math.min(scaleX, scaleY), 0.5), 1.2);

    setZoom(newZoom);
    setPan({
      x: 40 - minX * newZoom,
      y: 40 - minY * newZoom,
    });
  }, [doc]);

  if (version.isLoading || catalogue.isLoading)
    return <PulseLoader label="Loading the flow" />;
  if (version.error) return <ErrorState error={version.error} />;
  if (!version.data || !doc) return null;

  const published = version.data.is_published;
  const readOnly = published || !canEdit;
  const nodeIds = Object.keys(doc.nodes);
  const edges = getGraphEdges(doc, specs);

  // Blocks save if structural graph or schema errors exist
  const blocksSave = (report?.errors ?? []).filter(
    (i) => !["unknown_asset", "unknown_endpoint"].includes(i.code),
  );

  const selectedNodeIssues = (report?.errors ?? [])
    .concat(report?.warnings ?? [])
    .filter((i) => i.node && selectedIds.includes(i.node));

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col space-y-3">
      {/* --- Top Header ---------------------------------------------- */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div>
          <BackLink to={`/flows/${version.data.flow}`}>Versions</BackLink>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="display text-xl font-semibold text-chalk">
              Version {version.data.version}
            </h1>
            {published ? (
              <span className="rounded border border-live-bright/40 bg-live px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-live-bright">
                published · immutable
              </span>
            ) : (
              <span className="rounded border border-signal/40 bg-panel px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-signal">
                draft
              </span>
            )}
          </div>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-3">
            {blocksSave.length > 0 && (
              <span className="text-xs text-amber font-medium">
                {blocksSave.length} error{blocksSave.length > 1 ? "s" : ""} — cannot be saved yet
              </span>
            )}
            <Button
              variant="secondary"
              loading={save.isPending}
              disabled={blocksSave.length > 0}
              onClick={() => save.mutate({ definition: doc })}
            >
              Save Draft
            </Button>
            {canPublish && (
              <ClipButton
                disabled={(report?.errors.length ?? 0) > 0 || publish.isPending}
                onClick={() => publish.mutate()}
              >
                Publish Flow
              </ClipButton>
            )}
          </div>
        )}
      </header>

      {/* --- Publish Error Alert ------------------------------------- */}
      {publish.error instanceof ApiError && publish.error.isInvalidFlow && (
        <div className="shrink-0 rounded border border-rust/40 bg-panel px-4 py-3">
          <p className="text-sm font-medium text-rust">
            Publish refused. These must be fixed first:
          </p>
          <ul className="mt-1.5 space-y-1">
            {((publish.error.detail as ValidationReport)?.errors ?? []).map(
              (issue, i) => (
                <li key={i} className="text-xs text-chalk">
                  <span className="num text-ash">{issue.node || "flow"}</span> — {issue.message}
                </li>
              ),
            )}
          </ul>
        </div>
      )}

      {/* --- Main Workspace Canvas Area ----------------------------- */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
        {/* Left: Node Palette */}
        <FlowPalette
          specs={catalogue.data?.nodes ?? []}
          readOnly={readOnly}
          onAddNode={addNode}
        />

        {/* Center: Canvas / Outline View Container */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[--radius-card] border border-edge bg-void">
          {/* Top Canvas Toolbar */}
          <div className="absolute left-4 right-4 top-3 z-10">
            <FlowToolbar
              zoom={zoom}
              nodeCount={nodeIds.length}
              edgeCount={edges.length}
              viewMode={viewMode}
              onZoomIn={() => setZoom((z) => Math.min(z + 0.15, 2.0))}
              onZoomOut={() => setZoom((z) => Math.max(z - 0.15, 0.3))}
              onResetZoom={() => setZoom(1.0)}
              onFitView={handleFitView}
              onAutoLayout={handleAutoLayout}
              onToggleViewMode={() =>
                setViewMode((m) => (m === "canvas" ? "outline" : "canvas"))
              }
            />
          </div>

          {/* Interactive Visual Graph Canvas */}
          {viewMode === "canvas" ? (
            <FlowCanvas
              doc={doc}
              specs={specs}
              selectedNodeIds={selectedIds}
              report={report}
              readOnly={readOnly}
              zoom={zoom}
              pan={pan}
              onPanChange={setPan}
              onZoomChange={setZoom}
              onSelectNodes={setSelectedIds}
              onUpdatePositions={updatePositions}
              onAddNode={addNode}
              onConnect={connectWire}
              onSetEntry={setEntryNode}
              onDeleteNode={deleteNode}
              onDuplicateNode={duplicateNode}
            />
          ) : (
            /* Outline / Tabular View */
            <div className="flex-1 overflow-y-auto p-4 pt-16">
              <div className="space-y-2">
                {nodeIds.map((id) => {
                  const node = doc.nodes[id]!;
                  const isSelected = selectedIds.includes(id);

                  return (
                    <div
                      key={id}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey || e.shiftKey) {
                          setSelectedIds((prev) =>
                            prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
                          );
                        } else {
                          setSelectedIds([id]);
                        }
                      }}
                      className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                        isSelected
                          ? "border-signal bg-panel"
                          : "border-edge bg-void hover:border-edge-bright"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {id === doc.entry && (
                            <span className="rounded bg-signal px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-void">
                              Entry
                            </span>
                          )}
                          <span className="num text-sm font-semibold text-chalk">{id}</span>
                          <span className="num text-xs text-ash">({node.type})</span>
                        </div>
                        {node.disposition && (
                          <span className="rounded border border-edge px-1.5 py-0.5 text-[10px] text-ash">
                            disposition: {node.disposition}
                          </span>
                        )}
                      </div>
                      {node.prompt?.text && (
                        <p className="mt-1 text-xs italic text-ash">“{node.prompt.text}”</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: Property Inspector Panel */}
        <FlowInspector
          doc={doc}
          selectedIds={selectedIds}
          spec={selectedIds.length === 1 ? specs.get(doc.nodes[selectedIds[0]!]?.type ?? "") : undefined}
          issues={selectedNodeIssues}
          readOnly={readOnly}
          onChange={updateNode}
          onRenameNode={renameNode}
          onClose={() => setSelectedIds([])}
        />
      </div>

      {/* --- Bottom: Live Validation Drawer -------------------------- */}
      <FlowValidationDrawer
        report={report}
        isValidating={validate.isPending}
        onSelectNode={(nodeId) => {
          setSelectedIds([nodeId]);
          // Auto-center pan on the node if in canvas mode
          if (doc.metadata?.positions?.[nodeId]) {
            const pos = doc.metadata.positions[nodeId]!;
            setPan({
              x: 300 - pos.x * zoom,
              y: 200 - pos.y * zoom,
            });
          }
        }}
      />
    </div>
  );
}

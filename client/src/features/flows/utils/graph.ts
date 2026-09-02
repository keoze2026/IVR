/**
 * Graph data transformations, port mappings, and edge extraction for IVR flows.
 */

import type {
  FlowDefinition,
  FlowNode,
  NodeSpec,
  ValidationIssue,
  ValidationReport,
} from "@/types/domain";

export type EdgeKind =
  | "next"
  | "dtmf"
  | "optout"
  | "timeout"
  | "invalid"
  | "fail"
  | "condition"
  | "default";

export interface OutputPort {
  id: string; // e.g. "next", "options.1", "on_timeout", "on_invalid", "on_fail", "conditions[0]", "default"
  field: string; // e.g. "next", "options", "on_timeout", "conditions"
  subKey?: string | number; // e.g. "1" or 0
  label: string;
  target: string | null;
  kind: EdgeKind;
}

export interface GraphEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  label: string;
  kind: EdgeKind;
  isDangling: boolean;
}

/**
 * Returns all declared output transition ports for a given node.
 */
export function getOutputPorts(
  _id: string,
  node: FlowNode,
  spec?: NodeSpec,
): OutputPort[] {
  const ports: OutputPort[] = [];

  // Terminal nodes have no output transitions (except opt_out may have next)
  if (spec?.terminal && node.type !== "opt_out") {
    return ports;
  }

  // 1. Menu node DTMF options
  if (node.type === "menu") {
    const options = node.options ?? {};
    for (const [digit, target] of Object.entries(options)) {
      const isOptOut = digit === "9" || digit === "0";
      ports.push({
        id: `options.${digit}`,
        field: "options",
        subKey: digit,
        label: isOptOut ? `Key [${digit}] · Opt-out` : `Key [${digit}]`,
        target: target || null,
        kind: isOptOut ? "optout" : "dtmf",
      });
    }

    if (node.on_timeout !== undefined || (spec?.transitions.includes("on_timeout") ?? false)) {
      ports.push({
        id: "on_timeout",
        field: "on_timeout",
        label: "On Timeout",
        target: node.on_timeout || null,
        kind: "timeout",
      });
    }

    if (node.on_invalid !== undefined || (spec?.transitions.includes("on_invalid") ?? false)) {
      ports.push({
        id: "on_invalid",
        field: "on_invalid",
        label: "On Invalid",
        target: node.on_invalid || null,
        kind: "invalid",
      });
    }

    return ports;
  }

  // 2. Branch node conditions
  if (node.type === "branch") {
    const conditions = node.conditions ?? [];
    conditions.forEach((c, idx) => {
      const valDesc = c.value !== undefined ? ` ${c.value}` : "";
      ports.push({
        id: `conditions[${idx}]`,
        field: "conditions",
        subKey: idx,
        label: `If {{${c.variable || "var"}}} ${c.op || "eq"}${valDesc}`,
        target: c.then || null,
        kind: "condition",
      });
    });

    ports.push({
      id: "default",
      field: "default",
      label: "Default / Else",
      target: (node as any).default || null,
      kind: "default",
    });

    return ports;
  }

  // 3. Transfer node failure transition
  if (node.type === "transfer") {
    ports.push({
      id: "on_fail",
      field: "on_fail",
      label: "On Fail / Busy",
      target: node.on_fail || null,
      kind: "fail",
    });
    return ports;
  }

  // 4. Collect node
  if (node.type === "collect") {
    ports.push({
      id: "next",
      field: "next",
      label: "Next",
      target: node.next || null,
      kind: "next",
    });
    if (node.on_timeout !== undefined) {
      ports.push({
        id: "on_timeout",
        field: "on_timeout",
        label: "On Timeout",
        target: node.on_timeout || null,
        kind: "timeout",
      });
    }
    if (node.on_invalid !== undefined) {
      ports.push({
        id: "on_invalid",
        field: "on_invalid",
        label: "On Invalid",
        target: node.on_invalid || null,
        kind: "invalid",
      });
    }
    return ports;
  }

  // 5. Standard fall-through transitions (play, record, opt_out)
  if (node.next !== undefined || spec?.transitions.includes("next")) {
    ports.push({
      id: "next",
      field: "next",
      label: "Next",
      target: node.next || null,
      kind: "next",
    });
  }

  // Any other declared transitions on the spec
  for (const field of spec?.transitions ?? []) {
    if (field !== "next" && !ports.some((p) => p.field === field)) {
      ports.push({
        id: field,
        field: field,
        label: field.replace(/_/g, " "),
        target: (node[field] as string) || null,
        kind: field.includes("timeout") ? "timeout" : field.includes("invalid") ? "invalid" : "next",
      });
    }
  }

  return ports;
}

/**
 * Extracts all active and dangling edges across the entire flow definition.
 */
export function getGraphEdges(
  doc: FlowDefinition,
  specs: Map<string, NodeSpec>,
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const nodeIds = new Set(Object.keys(doc.nodes));

  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    const spec = specs.get(node.type);
    const ports = getOutputPorts(nodeId, node, spec);

    for (const port of ports) {
      if (port.target) {
        const isDangling = !nodeIds.has(port.target);
        edges.push({
          id: `${nodeId}-${port.id}->${port.target}`,
          sourceNodeId: nodeId,
          sourcePortId: port.id,
          targetNodeId: port.target,
          label: port.label,
          kind: port.kind,
          isDangling,
        });
      }
    }
  }

  return edges;
}

/**
 * Applies a transition connection patch onto a node.
 */
export function connectPort(
  node: FlowNode,
  portId: string,
  targetNodeId: string | null,
): FlowNode {
  const next = { ...node };

  if (portId.startsWith("options.")) {
    const digit = portId.replace("options.", "");
    const options = { ...(next.options ?? {}) };
    if (targetNodeId) {
      options[digit] = targetNodeId;
    } else {
      delete options[digit];
    }
    next.options = options;
    return next;
  }

  if (portId.startsWith("conditions[")) {
    const match = portId.match(/conditions\[(\d+)\]/);
    if (match) {
      const idx = parseInt(match[1]!, 10);
      const conditions = [...(next.conditions ?? [])];
      if (conditions[idx]) {
        conditions[idx] = { ...conditions[idx]!, then: targetNodeId || "" };
      }
      next.conditions = conditions;
      return next;
    }
  }

  if (targetNodeId) {
    (next as any)[portId] = targetNodeId;
  } else {
    delete (next as any)[portId];
  }

  return next;
}

/**
 * Safely removes a node from the flow definition and clears transitions pointing to it.
 */
export function removeNodeSafely(
  doc: FlowDefinition,
  nodeIdToRemove: string,
): FlowDefinition {
  const nextNodes: Record<string, FlowNode> = {};

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (id === nodeIdToRemove) continue;

    let patched = { ...node };

    if (patched.next === nodeIdToRemove) {
      delete patched.next;
    }
    if (patched.on_timeout === nodeIdToRemove) {
      delete patched.on_timeout;
    }
    if (patched.on_invalid === nodeIdToRemove) {
      delete patched.on_invalid;
    }
    if (patched.on_fail === nodeIdToRemove) {
      delete patched.on_fail;
    }
    if ((patched as any).default === nodeIdToRemove) {
      delete (patched as any).default;
    }

    if (patched.options) {
      const opts: Record<string, string> = {};
      for (const [k, v] of Object.entries(patched.options)) {
        if (v !== nodeIdToRemove) {
          opts[k] = v;
        }
      }
      patched.options = opts;
    }

    if (patched.conditions) {
      patched.conditions = patched.conditions.map((c) =>
        c.then === nodeIdToRemove ? { ...c, then: "" } : c,
      );
    }

    nextNodes[id] = patched;
  }

  // Update positions metadata
  const nextPositions = { ...(doc.metadata?.positions ?? {}) };
  delete nextPositions[nodeIdToRemove];

  // Update entry node if necessary
  let nextEntry = doc.entry;
  if (nextEntry === nodeIdToRemove) {
    const remaining = Object.keys(nextNodes);
    nextEntry = remaining[0] || "entry";
  }

  return {
    ...doc,
    entry: nextEntry,
    metadata: {
      ...doc.metadata,
      positions: nextPositions,
    },
    nodes: nextNodes,
  };
}

/**
 * Maps validation issues to a map keyed by node ID for fast lookup.
 */
export function indexValidationIssues(
  report: ValidationReport | null,
): {
  byNode: Map<string, ValidationIssue[]>;
  unreachableNodes: Set<string>;
  danglingTransitions: Set<string>;
} {
  const byNode = new Map<string, ValidationIssue[]>();
  const unreachableNodes = new Set<string>();
  const danglingTransitions = new Set<string>();

  if (!report) {
    return { byNode, unreachableNodes, danglingTransitions };
  }

  const allIssues = [...(report.errors ?? []), ...(report.warnings ?? [])];

  for (const issue of allIssues) {
    if (issue.node) {
      const list = byNode.get(issue.node) ?? [];
      list.push(issue);
      byNode.set(issue.node, list);
    }

    if (issue.code === "unreachable" && issue.node) {
      unreachableNodes.add(issue.node);
    }

    if (issue.code === "dangling_transition" && issue.node) {
      danglingTransitions.add(issue.node);
    }
  }

  return { byNode, unreachableNodes, danglingTransitions };
}

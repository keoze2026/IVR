import { describe, it, expect } from "vitest";
import type { FlowDefinition, FlowNode, NodeSpec } from "@/types/domain";
import { snapToGrid, computeBezierPath, computeBezierMidpoint } from "./geometry";
import {
  getOutputPorts,
  getGraphEdges,
  connectPort,
  removeNodeSafely,
  indexValidationIssues,
} from "./graph";
import { computeAutoLayout } from "./layout";

describe("IVR Flow Geometry Utilities", () => {
  it("snaps coordinates to grid intervals", () => {
    expect(snapToGrid(0, 20)).toBe(0);
    expect(snapToGrid(12, 20)).toBe(20);
    expect(snapToGrid(28, 20)).toBe(20);
    expect(snapToGrid(35, 20)).toBe(40);
  });

  it("computes cubic bezier path string for connections", () => {
    const forwardPath = computeBezierPath({ x: 0, y: 0 }, { x: 300, y: 100 });
    expect(forwardPath).toContain("M 0 0 C");
    expect(forwardPath).toContain("300 100");

    const loopPath = computeBezierPath({ x: 300, y: 100 }, { x: 50, y: 50 });
    expect(loopPath).toContain("M 300 100 C");
  });

  it("computes bezier midpoint for edge label positioning", () => {
    const mid = computeBezierMidpoint({ x: 0, y: 0 }, { x: 200, y: 100 });
    expect(mid.x).toBe(100);
    expect(mid.y).toBe(50);
  });
});

describe("IVR Flow Graph Utilities", () => {
  const sampleSpecs = new Map<string, NodeSpec>([
    [
      "play",
      {
        type: "play",
        required: ["prompt"],
        optional: ["next"],
        transitions: ["next"],
        terminal: false,
        gathers_input: false,
        description: "Play prompt",
      },
    ],
    [
      "menu",
      {
        type: "menu",
        required: ["prompt", "options"],
        optional: ["on_timeout", "on_invalid"],
        transitions: ["on_timeout", "on_invalid"],
        terminal: false,
        gathers_input: true,
        description: "DTMF menu",
      },
    ],
    [
      "hangup",
      {
        type: "hangup",
        required: [],
        optional: ["prompt"],
        transitions: [],
        terminal: true,
        gathers_input: false,
        description: "End call",
      },
    ],
    [
      "opt_out",
      {
        type: "opt_out",
        required: ["prompt"],
        optional: ["next", "scope"],
        transitions: ["next"],
        terminal: true,
        gathers_input: false,
        description: "Suppression opt out",
      },
    ],
  ]);

  it("extracts output ports for a menu node with opt-out classification", () => {
    const menuNode: FlowNode = {
      type: "menu",
      options: { "1": "sales", "9": "dnc" },
      on_timeout: "goodbye",
    };

    const ports = getOutputPorts("main_menu", menuNode, sampleSpecs.get("menu"));
    expect(ports).toHaveLength(4);

    const digit1 = ports.find((p) => p.id === "options.1");
    expect(digit1?.kind).toBe("dtmf");
    expect(digit1?.target).toBe("sales");

    const digit9 = ports.find((p) => p.id === "options.9");
    expect(digit9?.kind).toBe("optout");
    expect(digit9?.target).toBe("dnc");

    const timeout = ports.find((p) => p.id === "on_timeout");
    expect(timeout?.kind).toBe("timeout");
    expect(timeout?.target).toBe("goodbye");

    const invalid = ports.find((p) => p.id === "on_invalid");
    expect(invalid?.kind).toBe("invalid");
  });

  it("does not generate output ports for terminal hangup nodes", () => {
    const hangupNode: FlowNode = { type: "hangup" };
    const ports = getOutputPorts("end", hangupNode, sampleSpecs.get("hangup"));
    expect(ports).toHaveLength(0);
  });

  it("extracts graph edges across entire flow and detects dangling edges", () => {
    const doc: FlowDefinition = {
      schema_version: "1.0",
      entry: "greeting",
      nodes: {
        greeting: { type: "play", next: "menu" },
        menu: { type: "menu", options: { "1": "non_existent_node" } },
      },
    };

    const edges = getGraphEdges(doc, sampleSpecs);
    expect(edges).toHaveLength(2);

    const greetingEdge = edges.find((e) => e.sourceNodeId === "greeting");
    expect(greetingEdge?.isDangling).toBe(false);

    const menuEdge = edges.find((e) => e.sourceNodeId === "menu");
    expect(menuEdge?.isDangling).toBe(true);
  });

  it("connects and disconnects ports properly", () => {
    const node: FlowNode = {
      type: "menu",
      options: { "1": "target_a" },
    };

    const updated = connectPort(node, "options.2", "target_b");
    expect(updated.options?.["2"]).toBe("target_b");

    const disconnected = connectPort(updated, "options.1", null);
    expect(disconnected.options?.["1"]).toBeUndefined();
  });

  it("safely removes a node and cleans up transition references pointing to it", () => {
    const doc: FlowDefinition = {
      schema_version: "1.0",
      entry: "intro",
      nodes: {
        intro: { type: "play", next: "to_delete" },
        to_delete: { type: "play", next: "outro" },
        outro: { type: "hangup" },
      },
      metadata: {
        positions: {
          intro: { x: 0, y: 0 },
          to_delete: { x: 100, y: 0 },
          outro: { x: 200, y: 0 },
        },
      },
    };

    const cleaned = removeNodeSafely(doc, "to_delete");
    expect(cleaned.nodes["to_delete"]).toBeUndefined();
    expect(cleaned.nodes["intro"]?.next).toBeUndefined();
    expect(cleaned.metadata?.positions?.["to_delete"]).toBeUndefined();
    expect(cleaned.nodes["outro"]).toBeDefined();
  });

  it("indexes validation errors and warnings by node", () => {
    const report = {
      ok: false,
      errors: [
        { level: "error" as const, code: "dangling_transition", message: "Missing node", node: "menu" },
        { level: "error" as const, code: "unreachable", message: "Unreachable", node: "orphan" },
      ],
      warnings: [],
    };

    const { byNode, unreachableNodes, danglingTransitions } = indexValidationIssues(report);
    expect(byNode.get("menu")).toHaveLength(1);
    expect(unreachableNodes.has("orphan")).toBe(true);
    expect(danglingTransitions.has("menu")).toBe(true);
  });
});

describe("IVR Flow Layout Utilities", () => {
  const sampleSpecs = new Map<string, NodeSpec>([
    ["play", { type: "play" as any, description: "", required: [], optional: [], transitions: ["next"], terminal: false, gathers_input: false }],
    ["hangup", { type: "hangup" as any, description: "", required: [], optional: [], transitions: [], terminal: true, gathers_input: false }],
  ]);

  it("computes DAG rank coordinates hierarchically", () => {
    const doc: FlowDefinition = {
      schema_version: "1.0",
      entry: "node_1",
      nodes: {
        node_1: { type: "play", next: "node_2" },
        node_2: { type: "play", next: "node_3" },
        node_3: { type: "hangup" },
      },
    };

    const layout = computeAutoLayout(doc, sampleSpecs);
    expect(layout["node_1"]).toBeDefined();
    expect(layout["node_2"]).toBeDefined();
    expect(layout["node_3"]).toBeDefined();

    // Node 2 should be placed to the right of Node 1, and Node 3 to the right of Node 2
    expect(layout["node_2"]!.x).toBeGreaterThan(layout["node_1"]!.x);
    expect(layout["node_3"]!.x).toBeGreaterThan(layout["node_2"]!.x);
  });
});

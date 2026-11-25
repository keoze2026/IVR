/**
 * Automatic hierarchical DAG layout algorithm for IVR flows.
 */

import type { FlowDefinition, NodeSpec } from "@/types/domain";
import {
  NODE_WIDTH,
  GRID_SIZE,
  snapToGrid,
  type Point,
} from "./geometry";
import { getOutputPorts } from "./graph";

export const HORIZONTAL_SPACING = 140;
export const VERTICAL_SPACING = 60;
export const ESTIMATED_NODE_HEIGHT = 160;

/**
 * Computes optimal (x, y) canvas coordinates for all nodes in the flow using
 * topological rank layering starting from the entry node.
 */
export function computeAutoLayout(
  doc: FlowDefinition,
  specs: Map<string, NodeSpec>,
): Record<string, Point> {
  const nodeIds = Object.keys(doc.nodes);
  if (nodeIds.length === 0) return {};

  const entryId = doc.entry && doc.nodes[doc.entry] ? doc.entry : nodeIds[0]!;

  // 1. Build adjacency list
  const adj = new Map<string, string[]>();
  for (const [id, node] of Object.entries(doc.nodes)) {
    const spec = specs.get(node.type);
    const ports = getOutputPorts(id, node, spec);
    const targets = ports
      .map((p) => p.target)
      .filter((t): t is string => Boolean(t && doc.nodes[t]));
    adj.set(id, targets);
  }

  // 2. Compute depth / rank for each node using BFS from entry
  const ranks = new Map<string, number>();
  const visited = new Set<string>();
  const queue: { id: string; rank: number }[] = [{ id: entryId, rank: 0 }];
  ranks.set(entryId, 0);
  visited.add(entryId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current.id) ?? [];

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        const neighborRank = current.rank + 1;
        ranks.set(neighborRank ? neighbor : neighbor, neighborRank);
        queue.push({ id: neighbor, rank: neighborRank });
      }
    }
  }

  // 3. Handle orphan / unreachable nodes
  let orphanRank = 0;
  for (const id of nodeIds) {
    if (!ranks.has(id)) {
      ranks.set(id, orphanRank);
      orphanRank++;
    }
  }

  // 4. Group nodes by rank
  const rankColumns = new Map<number, string[]>();
  for (const [id, rank] of ranks.entries()) {
    const list = rankColumns.get(rank) ?? [];
    list.push(id);
    rankColumns.set(rank, list);
  }

  // 5. Position nodes with grid snapping
  const positions: Record<string, Point> = {};
  const startX = 80;
  const startY = 80;

  const sortedRanks = Array.from(rankColumns.keys()).sort((a, b) => a - b);

  for (const rank of sortedRanks) {
    const nodesInColumn = rankColumns.get(rank) ?? [];
    const x = startX + rank * (NODE_WIDTH + HORIZONTAL_SPACING);

    nodesInColumn.forEach((nodeId, idx) => {
      const y = startY + idx * (ESTIMATED_NODE_HEIGHT + VERTICAL_SPACING);
      positions[nodeId] = {
        x: snapToGrid(x, GRID_SIZE),
        y: snapToGrid(y, GRID_SIZE),
      };
    });
  }

  return positions;
}

/**
 * Ensures all nodes have coordinates, filling in missing ones with auto-layout or offset placement.
 */
export function ensureNodePositions(
  doc: FlowDefinition,
  specs: Map<string, NodeSpec>,
): Record<string, Point> {
  const existing = doc.metadata?.positions ?? {};
  const nodeIds = Object.keys(doc.nodes);

  const missing = nodeIds.some((id) => !existing[id]);

  if (missing || Object.keys(existing).length === 0) {
    const computed = computeAutoLayout(doc, specs);
    return { ...computed, ...existing };
  }

  return existing as Record<string, Point>;
}

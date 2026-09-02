/**
 * Geometry and vector math utilities for IVR Flow canvas and bezier edge rendering.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

export const NODE_WIDTH = 260;
export const NODE_MIN_HEIGHT = 120;
export const GRID_SIZE = 20;

/** Snaps a coordinate value to the nearest grid step. */
export function snapToGrid(value: number, grid = GRID_SIZE): number {
  return Math.round(value / grid) * grid;
}

/**
 * Computes a smooth SVG cubic bezier path connecting an output port to an input port.
 * Handles forward, backward (loops), and self-referencing transitions gracefully.
 */
export function computeBezierPath(
  source: Point,
  target: Point,
): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  // Self-loop (transition back to the same node)
  if (Math.abs(dx) < 40 && Math.abs(dy) < 60) {
    const loopOffset = 70;
    return `M ${source.x} ${source.y} C ${source.x + loopOffset} ${source.y - loopOffset}, ${target.x - loopOffset} ${target.y - loopOffset}, ${target.x} ${target.y}`;
  }

  // Backward loop (target is to the left of source)
  if (dx < 30) {
    const horizontalDistance = Math.max(Math.abs(dx) * 0.5, 80);
    const verticalOffset = dy >= 0 ? 50 : -50;
    const cp1x = source.x + horizontalDistance;
    const cp1y = source.y + verticalOffset;
    const cp2x = target.x - horizontalDistance;
    const cp2y = target.y - verticalOffset;
    return `M ${source.x} ${source.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${target.x} ${target.y}`;
  }

  // Standard forward curve
  const curvature = Math.min(Math.max(dx * 0.45, 40), 180);
  const cp1x = source.x + curvature;
  const cp1y = source.y;
  const cp2x = target.x - curvature;
  const cp2y = target.y;

  return `M ${source.x} ${source.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${target.x} ${target.y}`;
}

/** Computes the midpoint along a cubic bezier curve for positioning edge labels. */
export function computeBezierMidpoint(source: Point, target: Point): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (dx < 30) {
    // Backward loop midpoint
    return {
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2 + (dy >= 0 ? 40 : -40),
    };
  }

  return {
    x: (source.x + target.x) / 2,
    y: (source.y + target.y) / 2,
  };
}

import type { DiagramDocument, DiagramNode } from '@draw/renderer';

export type SnapAxis = 'x' | 'y';

interface SnapTarget {
  value: number;
  node: DiagramNode;
}

export interface SnapTargets {
  x: Map<number, SnapTarget>;
  y: Map<number, SnapTarget>;
}

export interface SnapTargetCache {
  document: DiagramDocument;
  movingIds: ReadonlySet<string>;
  targets: SnapTargets;
}

export interface SnappedMovement {
  dx: number;
  dy: number;
  x?: SnapTarget & { delta: number };
  y?: SnapTarget & { delta: number };
}

const anchors = (node: DiagramNode, axis: SnapAxis, delta = 0) => axis === 'x'
  ? [node.x + delta, node.x + delta + (node.width - 1) / 2, node.x + delta + node.width - 1]
  : [node.y + delta, node.y + delta + (node.height - 1) / 2, node.y + delta + node.height - 1];

/** Builds the stationary anchors once at pointer-down for reuse during a move. */
export function buildSnapTargets(nodes: readonly DiagramNode[], movingIds: ReadonlySet<string>): SnapTargets {
  const targets: SnapTargets = { x: new Map(), y: new Map() };
  for (const node of nodes) {
    if (movingIds.has(node.id)) continue;
    for (const axis of ['x', 'y'] as const) {
      for (const value of anchors(node, axis)) targets[axis].set(value * 2, { value, node });
    }
  }
  return targets;
}

export function createSnapTargetCache(document: DiagramDocument, movingIds: ReadonlySet<string>): SnapTargetCache {
  return { document, movingIds, targets: buildSnapTargets(document.nodes, movingIds) };
}

/** Keeps pointer-move work cached while refreshing after an accepted document replacement. */
export function refreshSnapTargetCache(cache: SnapTargetCache, document: DiagramDocument): SnapTargets {
  if (cache.document !== document) {
    cache.document = document;
    cache.targets = buildSnapTargets(document.nodes, cache.movingIds);
  }
  return cache.targets;
}

export function snapMovement(
  nodes: readonly DiagramNode[],
  targets: SnapTargets,
  dx: number,
  dy: number,
  constrainedAxis?: SnapAxis,
): SnappedMovement {
  const match = (axis: SnapAxis) => {
    for (const offset of [0, -2, 2]) {
      for (const node of nodes) {
        for (const value of anchors(node, axis, axis === 'x' ? dx : dy)) {
          const target = targets[axis].get(value * 2 + offset);
          if (target) return { delta: offset / 2, ...target };
        }
      }
    }
  };
  const x = constrainedAxis === 'y' ? undefined : match('x');
  const y = constrainedAxis === 'x' ? undefined : match('y');
  return { dx: dx + (x?.delta ?? 0), dy: dy + (y?.delta ?? 0), x, y };
}

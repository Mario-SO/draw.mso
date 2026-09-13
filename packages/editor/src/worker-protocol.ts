import type { DiagramDocument, DocumentPatch } from '@draw/diagram-core/contract';
import type { Scene } from '@draw/renderer';

export type EngineOperation = 'init' | 'replace' | 'patch' | 'preview' | 'previewPatch' | 'undo' | 'redo' | 'resync' | 'export';
export type EnginePayload = DiagramDocument | DocumentPatch | 'unicode' | 'ascii' | 'svg' | undefined;
export interface EngineResult { document: DiagramDocument; scene: Scene; canUndo: boolean; canRedo: boolean }
export interface WorkerError { message: string; code?: string; details?: string }
export interface WorkerPerformanceSample {
  name: string; value: number; unit: 'ms' | 'bytes'; detail?: Record<string, string>;
}
export interface EngineWorkerRequest {
  id: number;
  type: EngineOperation;
  payload?: EnginePayload;
  benchmark: boolean;
  /** Defaults to enabled for benchmark requests that predate this toggle. */
  responseByteAccounting?: boolean;
  /** Last projection decoded, including previews that were not displayed. */
  sceneGeneration?: number;
}
/** Keep large scenes serialized across the worker boundary: parsing once on the
 * receiving thread avoids cloning tens of thousands of tiny cell objects. */
export interface EngineWireResult {
  documentJson?: string;
  sceneJson?: string;
  sceneUpdateJson?: string;
  sceneGeneration?: number;
  sceneBaseGeneration?: number;
  canUndo?: boolean;
  canRedo?: boolean;
}
export function decodeEngineResult(result: EngineWireResult) {
  if (result.sceneJson === undefined) throw new Error('Missing full scene response');
  return {
    ...(result.documentJson === undefined ? {} : { document: JSON.parse(result.documentJson) as DiagramDocument }),
    scene: JSON.parse(result.sceneJson) as Scene,
    canUndo: result.canUndo ?? false,
    canRedo: result.canRedo ?? false,
  };
}
export interface EngineWorkerResponse {
  id: number;
  result?: EngineWireResult | string;
  error?: WorkerError;
  performance?: WorkerPerformanceSample[];
}


type Cell = NonNullable<Scene['displayCells']>[number];
type Route = Scene['routes'][number];
type SceneUpdate = {
  kind: 'full' | 'delta';
  rows: Array<{ y: number; cells: Cell[] }>;
  routes: Route[];
  removedRouteIds?: string[];
  routeOrder?: string[];
  bounds: Scene['bounds'];
};

/** Transport follows every response, even when the UI rejects a stale preview.
 * Maps and row arrays are never mutated after publication: accepted snapshots
 * remain usable when a preview is cancelled or a document is switched. */
export class SceneStreamDecoder {
  generation: number | undefined;
  private rows: ReadonlyMap<number, readonly Cell[]> = new Map();
  private routes = new Map<string, Route>();
  private order: string[] = [];
  lastUpdate: { kind: 'full' | 'delta'; rows: number; routes: number } | undefined;

  reset(): void {
    this.generation = undefined;
    this.rows = new Map();
    this.routes = new Map();
    this.order = [];
    this.lastUpdate = undefined;
  }

  decode(result: EngineWireResult) {
    this.lastUpdate = undefined;
    // Standalone import validation must not enter the editor's projection stream.
    if (result.sceneUpdateJson === undefined) return decodeEngineResult(result);
    try {
      const update = JSON.parse(result.sceneUpdateJson) as SceneUpdate;
      if (!Number.isSafeInteger(result.sceneGeneration) || result.sceneGeneration! < 1) throw new Error('Invalid scene generation');
      if (update.kind !== 'full' && update.kind !== 'delta') throw new Error('Invalid scene update kind');
      if (update.kind === 'delta' && (this.generation === undefined || result.sceneBaseGeneration !== this.generation || result.sceneGeneration! <= this.generation)) throw new Error('Scene delta base mismatch');
      if (!Array.isArray(update.rows) || !Array.isArray(update.routes) || !update.bounds || ![update.bounds.x, update.bounds.y, update.bounds.width, update.bounds.height].every(Number.isSafeInteger) || update.bounds.width < 0 || update.bounds.height < 0) throw new Error('Invalid scene update');
      const rows = new Map(update.kind === 'full' ? [] : this.rows);
      const seenRows = new Set<number>();
      for (const row of update.rows) {
        if (!Number.isSafeInteger(row.y) || seenRows.has(row.y) || !Array.isArray(row.cells)) throw new Error('Invalid scene row');
        seenRows.add(row.y);
        let previous = -Infinity;
        for (const cell of row.cells) {
          if (!Number.isSafeInteger(cell.x) || cell.y !== row.y || cell.x <= previous || typeof cell.ch !== 'string') throw new Error('Invalid scene cell');
          previous = cell.x;
        }
        if (row.cells.length) rows.set(row.y, row.cells); else rows.delete(row.y);
      }
      const routes = new Map(update.kind === 'full' ? [] : this.routes);
      if (update.removedRouteIds !== undefined && !Array.isArray(update.removedRouteIds)) throw new Error('Invalid removed routes');
      for (const id of update.removedRouteIds ?? []) routes.delete(id);
      const seenRoutes = new Set<string>();
      for (const route of update.routes) {
        if (typeof route.id !== 'string' || seenRoutes.has(route.id) || !Array.isArray(route.points) || !route.points.every(p => Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y))) throw new Error('Invalid scene route');
        seenRoutes.add(route.id);
        routes.set(route.id, route);
      }
      const order = update.kind === 'full' ? update.routes.map(route => route.id) : update.routeOrder ?? this.order;
      if (!Array.isArray(order) || order.length !== routes.size || new Set(order).size !== order.length || order.some(id => !routes.has(id))) throw new Error('Invalid scene route order');
      const document = result.documentJson === undefined ? undefined : JSON.parse(result.documentJson) as DiagramDocument;
      const scene: Scene = { displayRows: rows, routes: order.map(id => routes.get(id)!), bounds: update.bounds };
      // Publish only after every part of the response has passed validation.
      this.rows = rows;
      this.routes = routes;
      this.order = order;
      this.generation = result.sceneGeneration;
      this.lastUpdate = { kind: update.kind, rows: update.rows.length, routes: update.routes.length };
      return { ...(document === undefined ? {} : { document }), scene, canUndo: result.canUndo ?? false, canRedo: result.canRedo ?? false };
    } catch (error) {
      this.reset();
      throw error;
    }
  }
}

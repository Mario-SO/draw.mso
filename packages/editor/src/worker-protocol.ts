import type { DiagramDocument, DocumentPatch } from '@draw/diagram-core/contract';
import type { Scene } from '@draw/renderer';

export type EngineOperation = 'init' | 'replace' | 'patch' | 'preview' | 'previewPatch' | 'undo' | 'redo' | 'export';
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
}
/** Keep large scenes serialized across the worker boundary: parsing once on the
 * receiving thread avoids cloning tens of thousands of tiny cell objects. */
export interface EngineWireResult {
  documentJson?: string;
  sceneJson: string;
  canUndo?: boolean;
  canRedo?: boolean;
}
export function decodeEngineResult(result: EngineWireResult) {
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

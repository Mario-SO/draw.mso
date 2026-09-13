/// <reference lib="webworker" />
import init, { Engine } from '@draw/engine-wasm';
import wasmUrl from '@draw/engine-wasm/wasm?url';
import type { EngineWorkerRequest, EngineWireResult, WorkerPerformanceSample } from './worker-protocol';
let engine: Engine | undefined;
const initialized = init({ module_or_path: wasmUrl });
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<EngineWorkerRequest>) => {
  const { id, type, payload, benchmark } = event.data;
  const receivedAt = benchmark ? performance.now() : 0;
  queue = queue.then(async () => {
    const samples: WorkerPerformanceSample[] = [];
    const now = () => benchmark ? performance.now() : 0;
    const sample = (name: string, value: number, unit: 'ms' | 'bytes' = 'ms') => {
      if (benchmark) samples.push({ name, value, unit, detail: { command: type } });
    };
    const encode = () => {
      const start = now();
      const json = JSON.stringify(payload);
      sample('worker.inputJsonEncode', now() - start);
      return json;
    };
    const respond = (result: EngineWireResult | string, operationAt: number) => {
      sample('worker.operation', now() - operationAt);
      if (benchmark) sample('worker.responseJsonBytes', new TextEncoder().encode(JSON.stringify(result)).byteLength, 'bytes');
      self.postMessage({ id, result, ...(benchmark ? { performance: samples } : {}) });
    };
    try {
      sample('worker.queueWait', now() - receivedAt);
      const waitAt = now();
      await initialized;
      sample('worker.wasmReadyWait', now() - waitAt);
      const operationAt = now();
      if (type === 'preview') {
        const preview = new Engine(encode());
        try {
          const outputAt = now();
          const result = { sceneJson: preview.displayScene(), documentJson: preview.document() };
          sample('worker.engineOutput', now() - outputAt);
          respond(result, operationAt);
        } finally { preview.free(); }
        return;
      }
      if (type === 'init') {
        const candidate = new Engine(encode());
        engine?.free(); engine = candidate;
      }
      if (!engine) throw new Error('Diagram engine is not initialized.');
      if (type === 'previewPatch') {
        const input = encode();
        const outputAt = now();
        const sceneJson = engine.previewPatch(input);
        sample('worker.engineOutput', now() - outputAt);
        respond({ sceneJson }, operationAt);
        return;
      }
      if (type === 'replace') engine.replace(encode());
      if (type === 'patch') engine.applyPatch(encode());
      if (type === 'undo') engine.undo();
      if (type === 'redo') engine.redo();
      if (type === 'export') {
        respond(payload === 'svg' ? engine.export_svg() : engine.export_text(payload === 'ascii'), operationAt);
      } else {
        const outputAt = now();
        const result = { documentJson: engine.document(), sceneJson: engine.displayScene(), canUndo: engine.can_undo(), canRedo: engine.can_redo() };
        sample('worker.engineOutput', now() - outputAt);
        respond(result, operationAt);
      }
    } catch (error) {
      const value = error as Error & { code?: string; details?: string };
      self.postMessage({ id, error: { message: value instanceof Error ? value.message : String(error), code: value?.code, details: value?.details }, ...(benchmark ? { performance: samples } : {}) });
    }
  });
};

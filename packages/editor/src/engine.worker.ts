/// <reference lib="webworker" />
import init, { Engine } from '@draw/engine-wasm';
import wasmUrl from '@draw/engine-wasm/wasm?url';
let engine: Engine | undefined;
const initialized = init({ module_or_path: wasmUrl });
// Serialize commands: undo, edits, and export observe the same document order.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent) => {
  const { id, type, payload } = event.data;
  queue = queue.then(async () => {
    try {
      await initialized;
      if (type === 'preview') {
        const preview = new Engine(JSON.stringify(payload));
        try { self.postMessage({ id, result: { scene: JSON.parse(preview.scene()), document: payload } }); }
        finally { preview.free(); }
        return;
      }
      if (type === 'init') {
        const candidate = new Engine(JSON.stringify(payload));
        engine?.free(); engine = candidate;
      }
      if (!engine) throw new Error('Diagram engine is not initialized.');
      if (type === 'replace') engine.replace(JSON.stringify(payload));
      if (type === 'patch') engine.applyPatch(JSON.stringify(payload));
      if (type === 'undo') engine.undo();
      if (type === 'redo') engine.redo();
      if (type === 'export') {
        const text = payload === 'svg' ? engine.export_svg() : engine.export_text(payload === 'ascii');
        self.postMessage({ id, result: text });
      } else {
        self.postMessage({ id, result: { document: JSON.parse(engine.document()), scene: JSON.parse(engine.scene()), canUndo: engine.can_undo(), canRedo: engine.can_redo() } });
      }
    } catch (error) {
      self.postMessage({ id, error: String(error instanceof Error ? error.message : error) });
    }
  });
};

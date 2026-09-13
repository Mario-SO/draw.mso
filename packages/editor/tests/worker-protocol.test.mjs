import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEngineResult } from '../src/worker-protocol.ts';
const scene = { displayCells: [{ x: 2, y: 3, ch: '╔' }], bounds: { x: 2, y: 3, width: 1, height: 1 }, routes: [] };
test('serialized display snapshots decode once without terminal cells', () => {
  const document = { version: 1, title: 'Snapshot', nodes: [], edges: [] };
  assert.deepEqual(decodeEngineResult({ sceneJson: JSON.stringify(scene), documentJson: JSON.stringify(document), canUndo: true, canRedo: false }), { document, scene, canUndo: true, canRedo: false });
});
test('temporary preview response carries no replacement accepted document', () => {
  const result = decodeEngineResult({ sceneJson: JSON.stringify(scene) });
  assert.equal(Object.hasOwn(result, 'document'), false);
  assert.deepEqual(result.scene, scene);
  assert.throws(() => decodeEngineResult({ sceneJson: '{' }));
});

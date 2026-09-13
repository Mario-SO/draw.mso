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

const { SceneStreamDecoder } = await import('../src/worker-protocol.ts');
const cell = (x, y, ch) => ({ x, y, ch });
const route = id => ({ id, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }] });
const bounds = { x: 0, y: 0, width: 5, height: 5 };
const wire = (generation, update, extra = {}) => ({ sceneGeneration: generation, sceneBaseGeneration: generation - 1, sceneUpdateJson: JSON.stringify({ bounds, ...update }), ...extra });
const full = () => ({ kind: 'full', rows: [{ y: 0, cells: [cell(0, 0, 'A')] }, { y: 1, cells: [cell(0, 1, '😀')] }], routes: [route('a'), route('b')] });

test('deltas share unchanged rows/routes without mutating accepted snapshots', () => {
  const decoder = new SceneStreamDecoder();
  const accepted = decoder.decode(wire(1, full())).scene;
  const preview = decoder.decode(wire(2, { kind: 'delta', rows: [{ y: 0, cells: [cell(1, 0, 'B')] }], routes: [] })).scene;
  assert.deepEqual(accepted.displayRows.get(0), [cell(0, 0, 'A')]);
  assert.deepEqual(preview.displayRows.get(0), [cell(1, 0, 'B')]);
  assert.equal(accepted.displayRows.get(1), preview.displayRows.get(1));
  assert.equal(accepted.routes[0], preview.routes[0]);
});

test('a stale UI preview is still consumed before a later preview or commit', () => {
  const decoder = new SceneStreamDecoder();
  decoder.decode(wire(1, full()));
  // Caller discards this result because the pointer moved again.
  decoder.decode(wire(2, { kind: 'delta', rows: [{ y: 2, cells: [cell(4, 2, 'C')] }], routes: [] }));
  const latest = decoder.decode(wire(3, { kind: 'delta', rows: [{ y: 0, cells: [] }], routes: [] })).scene;
  assert.deepEqual(latest.displayRows.get(2), [cell(4, 2, 'C')]);
  assert.equal(latest.displayRows.has(0), false);
  assert.equal(decoder.generation, 3);
});

test('route removal, insertion and reordering preserve the emitted order', () => {
  const decoder = new SceneStreamDecoder();
  decoder.decode(wire(1, full()));
  const changed = decoder.decode(wire(2, { kind: 'delta', rows: [], routes: [route('c')], removedRouteIds: ['a'], routeOrder: ['c', 'b'] })).scene;
  assert.deepEqual(changed.routes.map(r => r.id), ['c', 'b']);
  const empty = decoder.decode(wire(3, { kind: 'full', rows: [], routes: [], bounds: { x: 0, y: 0, width: 0, height: 0 } })).scene;
  assert.equal(empty.displayRows.size, 0);
  assert.deepEqual(empty.routes, []);
});

test('standalone import validation leaves the projection stream untouched', () => {
  const decoder = new SceneStreamDecoder();
  decoder.decode(wire(1, full()));
  assert.deepEqual(decoder.decode({ sceneJson: JSON.stringify(scene) }).scene, scene);
  assert.equal(decoder.generation, 1);
  const next = decoder.decode(wire(2, { kind: 'delta', rows: [], routes: [] })).scene;
  assert.equal(next.displayRows.get(1)[0].ch, '😀');
});

test('a missing or mismatched base rejects the delta and a full response resynchronizes', () => {
  const decoder = new SceneStreamDecoder();
  assert.throws(() => decoder.decode(wire(2, { kind: 'delta', rows: [], routes: [] })), /base mismatch/);
  decoder.decode(wire(3, full()));
  assert.throws(() => decoder.decode(wire(5, { kind: 'delta', rows: [], routes: [] })), /base mismatch/);
  assert.equal(decoder.generation, undefined);
  decoder.decode(wire(6, full()));
  assert.equal(decoder.generation, 6);
});

test('malformed deltas cannot partially publish state or mutate retained scenes', () => {
  for (const update of [
    { rows: [{ y: 0, cells: [cell(1, 1, 'x')] }] },
    { rows: [{ y: 0, cells: [cell(2, 0, 'x'), cell(1, 0, 'y')] }] },
    { rows: [{ y: 0, cells: [] }, { y: 0, cells: [] }] },
    { routes: [route('a'), route('a')] },
    { routeOrder: ['a', 'a'] },
    { removedRouteIds: ['a'] },
  ]) {
    const decoder = new SceneStreamDecoder();
    const accepted = decoder.decode(wire(1, full())).scene;
    assert.throws(() => decoder.decode(wire(2, { kind: 'delta', rows: [], routes: [], ...update })));
    assert.equal(decoder.generation, undefined);
    assert.deepEqual(accepted.displayRows.get(0), [cell(0, 0, 'A')]);
  }
});

test('invalid accepted document JSON does not advance the scene stream', () => {
  const decoder = new SceneStreamDecoder();
  decoder.decode(wire(1, full()));
  assert.throws(() => decoder.decode(wire(2, { kind: 'delta', rows: [], routes: [] }, { documentJson: '{' })));
  assert.equal(decoder.generation, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffDocument } from '../src/document-patch.ts';
const before = { version: 1, title: 'A', nodes: [{ id: 'a', label: 'A', kind: 'service', x: 0, y: 0, width: 8, height: 3 }, { id: 'b', label: 'B', kind: 'database', x: 20, y: 0, width: 8, height: 3 }], edges: [{ id: 'e', from: 'a', to: 'b', label: '' }] };

test('one move sends only its changed node and grouping survives the patch', () => {
  const after = structuredClone(before); after.nodes[0].x = 4; after.nodes[0].groupId = 'group';
  const patch = diffDocument(before, after);
  assert.deepEqual(patch.updatedNodes, [after.nodes[0]]);
  assert.deepEqual(patch.updatedEdges, []);
  assert.deepEqual(patch.addedNodes, []);
  assert.equal(patch.title, undefined);
  assert.equal(before.nodes[0].x, 0);
});

test('deletion includes incident edge removals and a no-op contains no changes', () => {
  const after = structuredClone(before); after.nodes.pop(); after.edges = []; after.title = 'B';
  const patch = diffDocument(before, after);
  assert.deepEqual(patch.removedNodeIds, ['b']); assert.deepEqual(patch.removedEdgeIds, ['e']); assert.equal(patch.title, 'B');
  assert.ok(Object.values(diffDocument(before, structuredClone(before))).every(value => Array.isArray(value) && value.length === 0));
});

test('reordering emits one exact final permutation without marking nodes updated', () => {
  const after = structuredClone(before); after.nodes.reverse();
  const patch = diffDocument(before, after);
  assert.deepEqual(patch.nodeOrder, ['b', 'a']);
  assert.deepEqual(patch.updatedNodes, []);

  const appended = structuredClone(before); appended.nodes.push({ id: 'c', label: '', kind: 'rectangle', x: 0, y: 5, width: 8, height: 3 });
  assert.equal(diffDocument(before, appended).nodeOrder, undefined);
});

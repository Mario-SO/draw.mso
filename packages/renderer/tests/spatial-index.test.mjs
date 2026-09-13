import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpatialIndex } from '../src/spatial-index.ts';
const node = (id, x, y, width = 10, height = 5) => ({ id, x, y, width, height, kind: 'service', label: id });

test('hit candidates match brute force across updates, negative coordinates and large bounds', () => {
  const index = new SpatialIndex();
  let nodes = Array.from({ length: 600 }, (_, i) => node(String(i), (i * 37 % 400) - 200, (i * 19 % 180) - 90));
  nodes.push(node('container', -1000, -1000, 2000, 2000));
  for (let pass = 0; pass < 3; pass++) {
    index.update(nodes);
    for (let x = -205; x < 210; x += 13) for (let y = -95; y < 100; y += 11) {
      const expected = [...nodes].reverse().filter(n => x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height).map(n => n.id);
      assert.deepEqual(index.at(x, y).map(n => n.id), expected);
    }
    nodes = nodes.filter((_, i) => i % 4).reverse().map(n => ({ ...n, x: n.x - 9, width: n.width + 3 }));
  }
  index.update([]); assert.deepEqual(index.at(0, 0), []);
});

test('non-geometric updates retain fresh labels and reorder hits', () => {
  const index = new SpatialIndex();
  const a = node('a', 0, 0), b = node('b', 0, 0);
  index.update([a, b]);
  index.update([b, { ...a, label: 'updated' }]);
  assert.deepEqual(index.at(1, 1).map(n => [n.id, n.label]), [['a', 'updated'], ['b', 'b']]);
});

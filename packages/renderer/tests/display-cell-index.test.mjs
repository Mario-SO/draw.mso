import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DisplayCellIndex } from '../src/display-cell-index.ts';

test('visits only cells inside the requested viewport', () => {
  const index = new DisplayCellIndex();
  const cells = [
    { x: 8, y: 2, ch: 'c' },
    { x: -3, y: 1, ch: 'a' },
    { x: 2, y: 1, ch: 'b' },
    { x: 4, y: 4, ch: 'd' },
  ];
  index.update(cells);
  const visible = [];
  index.forEach(-1, 0, 8, 2, cell => visible.push(cell));
  assert.deepEqual(visible.map(cell => cell.ch), ['b', 'c']);
});

test('replaces previous rows and handles empty and negative viewports', () => {
  const index = new DisplayCellIndex();
  index.update([{ x: 1, y: 1, ch: 'old' }]);
  index.update([{ x: -5, y: -4, ch: 'new' }]);
  const visible = [];
  index.forEach(-10, -10, -1, -1, cell => visible.push(cell));
  assert.deepEqual(visible.map(cell => cell.ch), ['new']);
});

test('immutable incremental row snapshots can be swapped and restored', () => {
  const index = new DisplayCellIndex();
  const firstRow = [{ x: 2, y: 1, ch: 'A' }];
  const accepted = new Map([[1, firstRow], [4, [{ x: 0, y: 4, ch: '😀' }]]]);
  const preview = new Map(accepted);
  preview.set(1, [{ x: 3, y: 1, ch: 'B' }]);
  preview.delete(4);
  const collect = () => { const cells = []; index.forEach(-5, -5, 10, 10, cell => cells.push(cell)); return cells; };
  index.updateRows(accepted);
  assert.deepEqual(collect(), [...firstRow, { x: 0, y: 4, ch: '😀' }]);
  index.updateRows(preview);
  assert.deepEqual(collect(), [{ x: 3, y: 1, ch: 'B' }]);
  index.updateRows(accepted);
  assert.deepEqual(collect(), [...firstRow, { x: 0, y: 4, ch: '😀' }]);
});

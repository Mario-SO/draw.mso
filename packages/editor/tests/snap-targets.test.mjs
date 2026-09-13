import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapTargets, createSnapTargetCache, refreshSnapTargetCache, snapMovement } from '../src/snap-targets.ts';

const node = (id, x, y, width = 3, height = 3) => ({ id, x, y, width, height, kind: 'rectangle', label: id });

test('moving selections are excluded from stationary snap targets', () => {
  const moving = node('moving', 0, 0);
  const groupedMoving = node('grouped-moving', 10, 10);
  const stationary = node('stationary', 30, 30);
  const targets = buildSnapTargets([moving, groupedMoving, stationary], new Set([moving.id, groupedMoving.id]));

  assert.deepEqual([...targets.x.values()].map(target => target.node.id), ['stationary', 'stationary', 'stationary']);
  assert.deepEqual([...targets.y.values()].map(target => target.node.id), ['stationary', 'stationary', 'stationary']);
});

test('shared anchors retain the last stationary node in document order', () => {
  const moving = node('moving', 0, 0);
  const earlier = node('earlier', 10, 4);
  const later = node('later', 10, 20);
  const targets = buildSnapTargets([moving, earlier, later], new Set([moving.id]));
  const snapped = snapMovement([moving], targets, 8, 0);

  assert.equal(snapped.x?.node.id, 'later');
  assert.equal(snapped.x?.value, 10);
  assert.equal(snapped.dx, 8);
});

test('axis constraints snap only along the permitted movement axis', () => {
  const moving = node('moving', 0, 0);
  const stationary = node('stationary', 10, 10);
  const targets = buildSnapTargets([moving, stationary], new Set([moving.id]));

  const horizontal = snapMovement([moving], targets, 7, 0, 'x');
  assert.deepEqual({ dx: horizontal.dx, dy: horizontal.dy, x: horizontal.x?.value, y: horizontal.y }, { dx: 8, dy: 0, x: 10, y: undefined });

  const vertical = snapMovement([moving], targets, 0, 7, 'y');
  assert.deepEqual({ dx: vertical.dx, dy: vertical.dy, x: vertical.x, y: vertical.y?.value }, { dx: 0, dy: 8, x: undefined, y: 10 });
});

test('target cache is reused until an accepted document replaces its source', () => {
  const moving = node('moving', 0, 0);
  const firstDocument = { version: 1, title: 'first', nodes: [moving, node('old-target', 10, 10)], edges: [] };
  const cache = createSnapTargetCache(firstDocument, new Set([moving.id]));
  const initialTargets = cache.targets;

  assert.equal(refreshSnapTargetCache(cache, firstDocument), initialTargets);

  const nextDocument = { ...firstDocument, title: 'next', nodes: [moving, node('new-target', 20, 20)] };
  const refreshed = refreshSnapTargetCache(cache, nextDocument);
  assert.notEqual(refreshed, initialTargets);
  assert.equal(snapMovement([moving], refreshed, 18, 18).x?.node.id, 'new-target');
  assert.equal(snapMovement([moving], refreshed, 8, 8).x, undefined);
});

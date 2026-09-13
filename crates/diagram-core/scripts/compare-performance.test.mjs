import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from './compare-performance.mjs';
const report = (median, extra = {}) => ({ schemaVersion: 1, suite: 'diagram-browser', metrics: { 'paint|ms': { median, p95: median * 2 } }, ...extra });
test('compares browser values without treating zero baseline as infinite regression', () => {
  const diff = compareReports(report(10), report(8));
  assert.ok(Math.abs(diff.comparisons[0].changePercent + 20) < 1e-10);
  assert.equal(compareReports(report(0), report(8)).comparisons[0].changePercent, null);
});
test('reports missing metrics and environment changes', () => {
  const before = report(1, { metadata: { browser: 'A' } });
  const after = report(1, { metadata: { browser: 'B' }, metrics: { ...before.metrics, 'extra|ms': { median: 1, p95: 2 } } });
  const diff = compareReports(before, after);
  assert.equal(diff.warnings.length, 2);
});
test('refuses mixed suites and malformed numeric results', () => {
  assert.throws(() => compareReports(report(1), { schemaVersion: 1, suite: 'diagram-core-native', results: [] }));
  assert.throws(() => compareReports(report(1), report(null)), /Invalid/);
});

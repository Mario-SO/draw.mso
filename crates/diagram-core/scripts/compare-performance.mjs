import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export function compareReports(baseline, candidate) {
  const native = baseline.suite === 'diagram-core-native';
  if (baseline.suite !== candidate.suite ||
      (!native && (baseline.suite !== 'diagram-browser' || !baseline.metrics || !candidate.metrics)) ||
      baseline.schemaVersion !== 1 || candidate.schemaVersion !== 1) {
    throw new Error('Expected two reports from the same suite with schemaVersion 1');
  }
  const flatten = report => native
    ? Object.fromEntries(report.results.map(row => [`${row.fixture}/${row.operation}`, { median: row.medianNs, p95: row.p95Ns }]))
    : report.metrics;
  const before = flatten(baseline), after = flatten(candidate);
  const warnings = [];
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const compareMetadata = (label, a, b) => {
    if (JSON.stringify(canonical(a)) !== JSON.stringify(canonical(b))) warnings.push(`${label} differs; these measurements may not be comparable`);
  };
  if (native) {
    compareMetadata('Machine', baseline.machine, candidate.machine);
    compareMetadata('Configuration', baseline.configuration, candidate.configuration);
    compareMetadata('Rust compiler', baseline.source?.rustc, candidate.source?.rustc);
  } else {
    compareMetadata('Browser', baseline.metadata?.browser, candidate.metadata?.browser);
    compareMetadata('Runtime', baseline.metadata?.runtime, candidate.metadata?.runtime);
    compareMetadata('Hardware', baseline.metadata?.hardware, candidate.metadata?.hardware);
    compareMetadata('Operating system', baseline.metadata?.os, candidate.metadata?.os);
    compareMetadata('Fixtures', baseline.fixtures ?? baseline.fixture, candidate.fixtures ?? candidate.fixture);
    compareMetadata('Methodology', baseline.methodology, candidate.methodology);
  }
  const rows = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!before[key] || !after[key]) {
      warnings.push(`${key} is missing from ${before[key] ? 'candidate' : 'baseline'}`);
      continue;
    }
    for (const statistic of ['median', 'p95']) {
      const a = before[key][statistic], b = after[key][statistic];
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) throw new Error(`Invalid ${statistic} for ${key}`);
      rows.push({ metric: key, statistic, baseline: a, candidate: b, changePercent: a === 0 ? null : (b / a - 1) * 100 });
    }
  }
  if (!rows.length) throw new Error('Reports have no comparable metrics');
  return { schemaVersion: 1, suite: native ? 'diagram-core-native' : 'browser', note: 'Positive change means a larger value, not necessarily a regression. No automatic pass/fail budget is applied.', warnings, comparisons: rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2).filter(arg => arg !== '--');
    if (args.length !== 2) throw new Error('usage: pnpm bench:compare -- BASELINE_JSON CANDIDATE_JSON (paths relative to repository root)');
    const [baseline, candidate] = args.map(path => JSON.parse(readFileSync(resolve(root, path), 'utf8')));
    process.stdout.write(JSON.stringify(compareReports(baseline, candidate), null, 2) + '\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

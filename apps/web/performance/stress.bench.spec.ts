import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, platform, release, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

type PerformanceSample = { name: string; value: number; unit: 'ms' | 'bytes' | 'count'; detail?: Record<string, string | number | boolean> };
type BenchmarkApi = { firstNodeCenter(): { x: number; y: number } | null; setCamera(camera: { x: number; y: number; zoom: number }): void };
type BenchWindow = Window & { __DRAW_BENCHMARK_ENABLED__?: boolean; __DRAW_BENCHMARK_API__?: BenchmarkApi; __DRAW_BENCHMARK_SAMPLES__?: PerformanceSample[]; __DRAW_STOP_FRAME_PROBE__?: () => void };
type FixtureNode = { id: string; x: number; y: number; groupId?: string } & Record<string, unknown>;
type FixtureDocument = { nodes: FixtureNode[]; edges: unknown[] } & Record<string, unknown>;
type Scenario = {
  kind: 'sustained' | 'culling'; name: string; fixture: string; path: string;
  offscreen: number; nodes: number; edges: number; sha256: string; input: string;
};
const root = resolve(import.meta.dirname, '../../..');
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
const fixtureMetadata = ({ kind, name, fixture, path, offscreen, nodes, edges, sha256: contentSha256 }: Scenario) =>
  ({ kind, name, fixture, path, offscreen, nodes, edges, sha256: contentSha256 });
function setting(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}
const repetitions = setting('DRAW_BENCH_SAMPLES', 7, 1);
const warmups = setting('DRAW_BENCH_WARMUPS', 2, 0);
const gestures = setting('DRAW_BENCH_GESTURES', 10, 2);
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]!;

async function resetSamples(page: Page) {
  // Let queued worker results and coalesced drawing settle before the next scenario.
  await page.waitForTimeout(100);
  await page.evaluate(() => { (window as BenchWindow).__DRAW_BENCHMARK_SAMPLES__ = []; });
}
async function startFrameProbe(page: Page) {
  await page.evaluate(() => {
    const target = window as BenchWindow;
    let previous: number | undefined;
    let frame: number;
    const tick = (at: number) => {
      if (previous !== undefined) (target.__DRAW_BENCHMARK_SAMPLES__ ??= []).push({ name: 'browser.activeFrameInterval', value: at - previous, unit: 'ms' });
      previous = at;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    target.__DRAW_STOP_FRAME_PROBE__ = () => { cancelAnimationFrame(frame); delete target.__DRAW_STOP_FRAME_PROBE__; };
  });
}
async function stopFrameProbe(page: Page) {
  await page.evaluate(() => (window as BenchWindow).__DRAW_STOP_FRAME_PROBE__?.());
}
async function countCommands(page: Page, command: string) {
  return page.evaluate(command => (window as BenchWindow).__DRAW_BENCHMARK_SAMPLES__?.filter(s => s.name === 'editor.workerRoundTrip' && s.detail?.command === command).length ?? 0, command);
}
async function waitForCommand(page: Page, command: string, before: number) {
  await page.waitForFunction(({ command, before }) => ((window as BenchWindow).__DRAW_BENCHMARK_SAMPLES__?.filter(s => s.name === 'editor.workerRoundTrip' && s.detail?.command === command).length ?? 0) > before, { command, before });
}

// Separate report: the original representative-gesture baseline remains comparable.
test('sustained editing and fixed-camera culling', async ({ browser }) => {
  test.setTimeout(900_000);
  const rawRuns: PerformanceSample[][] = [];
  const fixtures = ['medium', 'large'] as const;
  const fileScenarios = await Promise.all(fixtures.map(async fixture => {
    const path = `fixtures/benchmarks/${fixture}.mso`, input = await readFile(resolve(root, path), 'utf8');
    const document = JSON.parse(input) as FixtureDocument;
    return { kind: 'sustained' as const, name: `sustained-${fixture}`, fixture, path, offscreen: 0,
      nodes: document.nodes.length, edges: document.edges.length, sha256: sha256(input), input };
  }));
  const basePath = 'fixtures/benchmarks/small.mso';
  const base = JSON.parse(await readFile(resolve(root, basePath), 'utf8')) as FixtureDocument;
  const cullingScenarios = [0, 300, 1200].map(offscreen => {
    // Preserve the same visible nodes AND routes; disconnected additions stay
    // far outside the viewport for every camera position in the pan sequence.
    const nodes = [...base.nodes, ...Array.from({ length: offscreen }, (_, index) => ({
      ...base.nodes[index % base.nodes.length]!, id: `offscreen-${index}`, groupId: undefined,
      x: 500 + (index % 40) * 18, y: 500 + Math.floor(index / 40) * 9,
    }))];
    const input = JSON.stringify({ ...base, nodes });
    return { kind: 'culling' as const, name: `culling-${offscreen}`, fixture: 'small', path: basePath, offscreen,
      nodes: nodes.length, edges: base.edges.length, sha256: sha256(input), input };
  });
  const scenarios: Scenario[] = [...fileScenarios, ...cullingScenarios];
  for (const scenario of scenarios) {
    for (let run = 0; run < warmups + repetitions; run++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        await page.addInitScript(() => { (window as BenchWindow).__DRAW_BENCHMARK_ENABLED__ = true; });
        await page.goto('/');
        await page.getByText('Ready · local workspace', { exact: false }).waitFor();
        await page.locator('input[type=file]').setInputFiles({ name: `${scenario.name}.mso`, mimeType: 'application/json', buffer: Buffer.from(scenario.input) });
        await page.getByText(`${scenario.nodes} nodes`, { exact: false }).waitFor();
        const sidebar = page.getByRole('button', { name: 'Toggle documents', exact: true });
        if (await sidebar.getAttribute('aria-expanded') === 'true') await sidebar.click();
        await page.evaluate(() => (window as BenchWindow).__DRAW_BENCHMARK_API__!.setCamera({ x: 100, y: 100, zoom: 1 }));
        await resetSamples(page);
        if (scenario.kind === 'sustained') {
          for (let gesture = 0; gesture < gestures; gesture++) {
            const target = await page.evaluate(() => (window as BenchWindow).__DRAW_BENCHMARK_API__!.firstNodeCenter());
            expect(target).not.toBeNull();
            const before = await countCommands(page, 'patch');
            const previews = await countCommands(page, 'previewPatch');
            await page.mouse.move(target!.x, target!.y);
            await page.mouse.down();
            await startFrameProbe(page);
            const direction = gesture % 2 === 0 ? 1 : -1;
            for (let step = 1; step <= 24; step++) {
              await page.mouse.move(target!.x + direction * step * 2, target!.y + direction * step);
              await page.waitForTimeout(16);
            }
            await waitForCommand(page, 'previewPatch', previews);
            await stopFrameProbe(page);
            await page.mouse.up();
            await waitForCommand(page, 'patch', before);
          }
        } else {
          await page.getByRole('button', { name: 'Pan', exact: true }).click();
          await page.mouse.move(700, 450); await page.mouse.down();
          await startFrameProbe(page);
          for (let step = 0; step < 120; step++) {
            await page.mouse.move(700 + Math.sin(step / 12) * 40, 450 + Math.cos(step / 12) * 20);
            await page.waitForTimeout(16);
          }
          await stopFrameProbe(page);
          await page.mouse.up();
        }
        await page.waitForTimeout(100);
        const samples = await page.evaluate(() => (window as BenchWindow).__DRAW_BENCHMARK_SAMPLES__ ?? []);
        expect(samples.some(sample => sample.name === 'renderer.paint')).toBe(true);
        expect(samples.some(sample => sample.name === 'browser.activeFrameInterval')).toBe(true);
        expect(samples.some(sample => sample.name === 'editor.workerError')).toBe(false);
        const roundTrips = samples.filter(sample => sample.name === 'editor.workerRoundTrip');
        if (scenario.kind === 'sustained') {
          expect(roundTrips.filter(sample => sample.detail?.command === 'patch')).toHaveLength(gestures);
          expect(roundTrips.filter(sample => sample.detail?.command === 'previewPatch').length).toBeGreaterThanOrEqual(gestures);
          for (const command of ['previewPatch', 'patch']) {
            for (const name of ['worker.queueWait', 'worker.engineOutput', 'worker.operation', 'editor.engineOutputParse']) {
              expect(samples.some(sample => sample.name === name && sample.detail?.command === command), `Missing ${name} for ${command}`).toBe(true);
            }
          }
        } else {
          expect(roundTrips).toHaveLength(0);
        }
        for (const sample of samples) sample.detail = { ...sample.detail, scenario: scenario.name };
        if (run >= warmups) rawRuns.push(samples);
      } finally { await context.close(); }
    }
  }
  expect(rawRuns).toHaveLength(scenarios.length * repetitions);
  const series = new Map<string, number[]>();
  for (const samples of rawRuns) {
    const groups = new Map<string, number[]>();
    for (const sample of samples) {
      const key = [sample.name, sample.unit, Object.entries(sample.detail ?? {}).sort().map(([k, v]) => `${k}=${v}`).join(',')].join('|');
      const values = groups.get(key) ?? []; values.push(sample.value); groups.set(key, values);
    }
    for (const [key, values] of groups) {
      // Each statistic is computed within a run before aggregating independent runs.
      for (const [statistic, value] of Object.entries({ eventMedian: percentile(values, .5), eventP95: percentile(values, .95), eventMax: Math.max(...values), eventCount: values.length })) {
        const metric = statistic === 'eventCount' ? `${key.replace('|ms|', '|count|').replace('|bytes|', '|count|')},statistic=${statistic}` : `${key},statistic=${statistic}`;
        const collected = series.get(metric) ?? []; collected.push(value); series.set(metric, collected);
      }
    }
  }
  for (const [key, values] of series) expect(values, `Incomplete metric series: ${key}`).toHaveLength(repetitions);
  const metrics = Object.fromEntries([...series].sort().map(([key, values]) => [key, { median: percentile(values, .5), p95: percentile(values, .95), samples: values.length }]));
  const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const report = {
    schemaVersion: 1, suite: 'diagram-browser-stress', createdAt: new Date().toISOString(),
    fixtures: scenarios.map(fixtureMetadata),
    methodology: { warmups, repetitions, gestures, pointerSteps: 24, pointerDelayMs: 16, cullingSteps: 120, aggregation: 'event median/p95/max/count per run, then median and p95 across runs' },
    metadata: { browser: { name: 'chromium', version: browser.version() }, hardware: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() }, os: { platform: platform(), release: release() }, git: { commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) }, runtime: { viewport: { width: 1440, height: 900 }, devicePixelRatio: 1, build: 'production', profileEnabled: false } },
    metrics, rawRuns,
  };
  await mkdir(resolve(root, 'benchmark-results'), { recursive: true });
  await writeFile(resolve(root, 'benchmark-results/browser-stress-latest.json'), JSON.stringify(report, null, 2) + '\n');
});

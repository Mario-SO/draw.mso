import { test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

type Sample = { name: string; value: number; unit: 'ms' | 'bytes' | 'count'; detail?: Record<string, string | number | boolean> };
const root = resolve(import.meta.dirname, '../../..');
const fixturePaths = (process.env.DRAW_BENCH_FIXTURE ?? 'fixtures/benchmarks/medium.mso,fixtures/benchmarks/large.mso').split(',').map(path => resolve(root, path.trim()));
function integerSetting(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  return value;
}
const warmups = integerSetting('DRAW_BENCH_WARMUPS', 2, 0);
const repetitions = integerSetting('DRAW_BENCH_SAMPLES', 7, 1);
const tracing = process.env.DRAW_BENCH_TRACE === '1';
function booleanSetting(name: string, fallback: boolean) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (value === '1') return true;
  if (value === '0') return false;
  throw new Error(`${name} must be 0 or 1`);
}
const responseByteAccounting = booleanSetting('DRAW_BENCH_RESPONSE_BYTES', true);

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

test('production browser baseline', async ({ browser, browserName }) => {
  const fixtures: Array<{ path: string; nodes: number; edges: number }> = [];
  const runs: Sample[][] = [];
  let browserVersion = '';
  let runtime: { viewport: { width: number; height: number }; devicePixelRatio: number } | undefined;
  for (const fixturePath of fixturePaths) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as { nodes: unknown[]; edges: unknown[] };
  const fixtureName = basename(fixturePath, '.mso');
  if (fixtureName === 'offscreen') throw new Error('The offscreen fixture is unsupported by this harness because document import auto-fits the camera.');
  fixtures.push({ path: fixturePath.slice(root.length + 1), nodes: fixture.nodes.length, edges: fixture.edges.length });
  for (let index = 0; index < warmups + repetitions; index++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    browserVersion ||= browser.version();
    const page = await context.newPage();
    const cdp = tracing && browserName === 'chromium' && fixturePath === fixturePaths[0] && index === warmups ? await context.newCDPSession(page) : undefined;
    if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
    await page.addInitScript(enabled => {
      const target = window as Window & { __DRAW_BENCHMARK_ENABLED__?: boolean; __DRAW_BENCHMARK_RESPONSE_BYTES__?: boolean; __DRAW_BENCHMARK_SAMPLES__?: unknown[] };
      target.__DRAW_BENCHMARK_ENABLED__ = true;
      target.__DRAW_BENCHMARK_RESPONSE_BYTES__ = enabled;
      target.__DRAW_BENCHMARK_SAMPLES__ = [];
    }, responseByteAccounting);
    const navigationAt = performance.now();
    await page.goto('/');
    await page.getByText('Ready · local workspace', { exact: false }).waitFor();
    runtime ??= await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio }));
    const navigationMs = performance.now() - navigationAt;
    await page.locator('input[type=file]').setInputFiles(fixturePath);
    await page.getByText(`${fixture.nodes.length} nodes`, { exact: false }).waitFor();
    const canvas = page.locator('canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Diagram canvas did not have a visible bounding box');
    const sidebarToggle = page.getByRole('button', { name: 'Toggle documents', exact: true });
    if (await sidebarToggle.getAttribute('aria-expanded') === 'true') await sidebarToggle.click();
    const beforeDrag = await page.evaluate(() => {
      const samples = (window as Window & { __DRAW_BENCHMARK_SAMPLES__?: Array<{ name: string; detail?: { command?: string } }> }).__DRAW_BENCHMARK_SAMPLES__ ?? [];
      const count = (command: string) => samples.filter(sample => sample.name === 'editor.workerRoundTrip' && sample.detail?.command === command).length;
      return { preview: count('previewPatch'), patch: count('patch') };
    });
    const target = await page.evaluate(() => (window as Window & { __DRAW_BENCHMARK_API__?: { firstNodeCenter(): { x: number; y: number } | null } }).__DRAW_BENCHMARK_API__?.firstNodeCenter() ?? null);
    if (!target) throw new Error('Benchmark API did not find a node to drag');
    await page.mouse.move(target.x, target.y); await page.mouse.down();
    await page.mouse.move(target.x + 45, target.y + 18, { steps: 8 }); await page.waitForTimeout(70); await page.mouse.up();
    await page.waitForFunction(({ preview, patch }) => {
      const samples = (window as Window & { __DRAW_BENCHMARK_SAMPLES__?: Array<{ name: string; detail?: { command?: string } }> }).__DRAW_BENCHMARK_SAMPLES__ ?? [];
      const count = (command: string) => samples.filter(sample => sample.name === 'editor.workerRoundTrip' && sample.detail?.command === command).length;
      return count('previewPatch') > preview && count('patch') > patch;
    }, beforeDrag);
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Pan' }).click();
    await page.mouse.move(box.x + box.width * .35, box.y + box.height * .5);
    await page.mouse.down();
    for (let step = 1; step <= 30; step++) await page.mouse.move(box.x + box.width * (.35 + step / 100), box.y + box.height * .5, { steps: 1 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    const pageSamples = await page.evaluate(() => {
      const target = window as Window & { __DRAW_BENCHMARK_SAMPLES__?: Sample[] };
      const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      return { samples: target.__DRAW_BENCHMARK_SAMPLES__ ?? [], heap: memory?.usedJSHeapSize };
    });
    pageSamples.samples.push({ name: 'runner.navigationToReady', value: navigationMs, unit: 'ms' });
    if (pageSamples.heap !== undefined) pageSamples.samples.push({ name: 'browser.usedJSHeap', value: pageSamples.heap, unit: 'bytes' });
    for (const sample of pageSamples.samples) sample.detail = { fixture: fixtureName, ...sample.detail };
    if (index >= warmups) runs.push(pageSamples.samples);
    if (cdp) {
      await mkdir(resolve(root, 'benchmark-results'), { recursive: true });
      const profile = await cdp.send('Profiler.stop');
      await writeFile(resolve(root, 'benchmark-results/browser.cpuprofile'), JSON.stringify(profile.profile));
      await cdp.send('Profiler.disable');
    }
    await context.close();
  }
  }

  const perRun = new Map<string, number[]>();
  for (const samples of runs) {
    const groups = new Map<string, number[]>();
    for (const sample of samples) {
      const dimensions = sample.detail ? Object.entries(sample.detail).sort().map(([key, value]) => `${key}=${value}`).join(',') : '';
      const key = [sample.name, sample.unit, dimensions].filter(Boolean).join('|');
      const values = groups.get(key) ?? []; values.push(sample.value); groups.set(key, values);
    }
    for (const [key, values] of groups) {
      const valuesByRun = perRun.get(key) ?? []; valuesByRun.push(percentile(values, .5)); perRun.set(key, valuesByRun);
    }
  }
  const metrics = Object.fromEntries([...perRun].sort().map(([key, values]) => [key, {
    median: percentile(values, .5), p95: percentile(values, .95), samples: values.length,
  }]));
  const git = (args: string[]) => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
  const result = {
    schemaVersion: 1,
    suite: 'diagram-browser',
    createdAt: new Date().toISOString(),
    fixtures,
    methodology: {
      warmups,
      repetitions,
      aggregation: 'median per run, then median and p95 across runs',
      responseByteAccounting: {
        enabled: responseByteAccounting,
        byteMetric: 'worker.responseJsonBytes',
        timingMetric: 'worker.responseByteAccounting',
        includedInWorkerRoundTrip: true,
        includedInWorkerOperation: false,
      },
    },
    metadata: {
      browser: { name: browserName, version: browserVersion },
      hardware: { cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
      os: { platform: platform(), release: release() },
      git: { commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])) },
      runtime: { ...runtime, build: 'production', profileEnabled: tracing },
    },
    metrics,
    rawRuns: runs,
  };
  const outputDirectory = resolve(root, 'benchmark-results');
  await mkdir(outputDirectory, { recursive: true });
  const output = resolve(outputDirectory, tracing ? 'browser-profiled.json' : 'browser-latest.json');
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(`Browser benchmark written to ${output}`);
});

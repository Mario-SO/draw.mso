import { expect, test } from '@playwright/test';

test('worker scene stream recovers stale bases without changing accepted state or history', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        Object.assign(window, { __DRAW_TEST_WORKER_URL__: String(url) });
      }
    };
  });
  await page.goto('/');
  await page.getByText('Ready · local workspace', { exact: false }).waitFor();
  const result = await page.evaluate(async () => {
    type Reply = { id: number; result?: { documentJson?: string; sceneJson?: string; sceneUpdateJson?: string; sceneGeneration?: number; canUndo?: boolean; canRedo?: boolean }; error?: unknown };
    const url = (window as Window & { __DRAW_TEST_WORKER_URL__?: string }).__DRAW_TEST_WORKER_URL__!;
    const worker = new Worker(url, { type: 'module' });
    let id = 0;
    const pending = new Map<number, (reply: Reply) => void>();
    worker.onmessage = ({ data }: MessageEvent<Reply>) => { pending.get(data.id)?.(data); pending.delete(data.id); };
    const send = (type: string, payload?: unknown, sceneGeneration?: number) => new Promise<Reply>(resolve => {
      pending.set(++id, resolve);
      worker.postMessage({ id, type, payload, sceneGeneration, benchmark: false });
    });
    const node = { id: 'box', kind: 'rectangle', label: 'stream', x: 0, y: 0, width: 16, height: 6 };
    try {
      const initial = await send('init', { version: 3, title: 'stream', nodes: [node], edges: [] });
      // Both are posted against generation 1; the commit must recover with a full
      // response because the worker emits a preview before processing the commit.
      const inFlightPreview = send('previewPatch', { updatedNodes: [{ ...node, x: 2 }] }, initial.result!.sceneGeneration);
      const inFlightCommit = send('patch', { updatedNodes: [{ ...node, x: 3 }] }, initial.result!.sceneGeneration);
      const [preview, commit] = await Promise.all([inFlightPreview, inFlightCommit]);
      const resync = await send('resync', undefined, commit.result!.sceneGeneration);
      const imported = await send('preview', JSON.parse(commit.result!.documentJson!));
      const invalid = await send('previewPatch', { removedNodeIds: ['missing'] }, resync.result!.sceneGeneration);
      const next = await send('previewPatch', { updatedNodes: [{ ...node, x: 4 }] }, resync.result!.sceneGeneration);
      const undo = await send('undo', undefined, next.result!.sceneGeneration);
      const original = await send('preview', JSON.parse(undo.result!.documentJson!));
      const summarize = (reply: Reply) => ({ ...reply.result, update: reply.result?.sceneUpdateJson ? JSON.parse(reply.result.sceneUpdateJson) : undefined });
      return { initial: summarize(initial), preview: summarize(preview), commit: summarize(commit), resync: summarize(resync), imported: summarize(imported), invalid: Boolean(invalid.error), next: summarize(next), undo: summarize(undo), original: summarize(original) };
    } finally { worker.terminate(); }
  });
  expect(result.preview.update.kind).toBe('delta');
  expect(result.commit.update.kind).toBe('full');
  expect(result.resync.update.kind).toBe('full');
  expect(result.resync.documentJson).toBe(result.commit.documentJson);
  expect(result.resync.canUndo).toBe(true);
  expect(result.resync.canRedo).toBe(false);
  const fullScene = (update: typeof result.commit.update) => ({ displayCells: update.rows.flatMap((row: { cells: unknown[] }) => row.cells), routes: update.routes, bounds: update.bounds });
  expect(fullScene(result.commit.update)).toEqual(JSON.parse(result.imported.sceneJson!));
  expect(result.invalid).toBe(true);
  expect(result.next.sceneGeneration).toBe(result.resync.sceneGeneration! + 1);
  expect(result.next.update.kind).toBe('delta');
  expect(JSON.parse(result.undo.documentJson!).nodes[0].x).toBe(0);
  expect(result.undo.canUndo).toBe(false);
  expect(result.undo.canRedo).toBe(true);
  // Undo may be a delta; a forced full resync already proved the same composer
  // against the independent standalone full-scene oracle above.
  expect(JSON.parse(result.original.sceneJson!).displayCells.length).toBeGreaterThan(0);
});

test('editor recovers a rejected preview delta and still commits and undoes the gesture', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { corrupted: false, resyncs: 0, acceptedAtResync: '' };
    Object.assign(window, { __DRAW_BENCHMARK_ENABLED__: true, __DRAW_TEST_STREAM__: state });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        const commands = new Map<number, string>();
        const nativePost = this.postMessage.bind(this);
        this.postMessage = (message: { id: number; type: string }) => {
          commands.set(message.id, message.type);
          nativePost(message);
        };
        this.addEventListener('message', ({ data }) => {
          const command = commands.get(data.id);
          commands.delete(data.id);
          if (!state.corrupted && command === 'previewPatch' && data.result?.sceneUpdateJson) {
            const update = JSON.parse(data.result.sceneUpdateJson);
            if (update.kind === 'delta') {
              state.corrupted = true;
              data.result.sceneBaseGeneration = -1;
            }
          }
          if (command === 'resync' && data.result?.documentJson) {
            state.resyncs++;
            state.acceptedAtResync = data.result.documentJson;
          }
        });
      }
    };
  });
  await page.goto('/');
  await page.getByText('Ready · local workspace', { exact: false }).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: 'recovery.mso', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 3, title: 'Recovery', nodes: [{ id: 'box', kind: 'rectangle', label: 'box', x: 0, y: 0, width: 16, height: 6 }], edges: [] })) });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recovery');
  const sidebar = page.getByRole('button', { name: 'Toggle documents', exact: true });
  if (await sidebar.getAttribute('aria-expanded') === 'true') await sidebar.click();
  const start = await page.evaluate(() => {
    const api = (window as Window & { __DRAW_BENCHMARK_API__?: { setCamera(camera: { x: number; y: number; zoom: number }): void; firstNodeCenter(): { x: number; y: number } } }).__DRAW_BENCHMARK_API__!;
    api.setCamera({ x: 100, y: 100, zoom: 1 });
    return api.firstNodeCenter();
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 36, start.y + 36);
  await expect.poll(() => page.evaluate(() => (window as Window & { __DRAW_TEST_STREAM__?: { resyncs: number } }).__DRAW_TEST_STREAM__!.resyncs)).toBe(1);
  const recovered = await page.evaluate(() => JSON.parse((window as Window & { __DRAW_TEST_STREAM__?: { acceptedAtResync: string } }).__DRAW_TEST_STREAM__!.acceptedAtResync));
  expect(recovered.nodes[0].x).toBe(0);
  await page.mouse.move(start.x + 54, start.y + 54);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const state = window as Window & { __DRAW_BENCHMARK_SAMPLES__?: Array<{ name: string; detail?: { command?: string } }> };
    return state.__DRAW_BENCHMARK_SAMPLES__?.some(s => s.name === 'editor.workerRoundTrip' && s.detail?.command === 'patch') ?? false;
  })).toBe(true);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => {
    const api = (window as Window & { __DRAW_BENCHMARK_API__?: { firstNodeCenter(): { x: number; y: number } } }).__DRAW_BENCHMARK_API__!;
    return api.firstNodeCenter();
  })).toEqual(start);
});

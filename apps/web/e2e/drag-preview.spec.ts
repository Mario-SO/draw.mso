import { expect, test } from '@playwright/test'

for (const gesture of ['move', 'resize'] as const) {
  test(`${gesture} keeps the box fill stable across worker preview replies`, async ({ page }) => {
    await page.addInitScript(() => { Object.assign(window, { __DRAW_BENCHMARK_ENABLED__: true }) })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('A place to think')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'drag.mso', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
        version: 2, title: 'Drag preview',
        nodes: [{ id: 'box', kind: 'rectangle', label: '', x: 0, y: 0, width: 24, height: 10 }], edges: [],
      })),
    })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Drag preview')
    const toggle = page.getByRole('button', { name: 'Toggle documents', exact: true })
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
    await page.locator('.zoom-value').click()
    const canvas = page.getByRole('application', { name: /diagram canvas/i })
    const rect = (await canvas.boundingBox())!
    const zoom = Math.min(1.25, Math.max(.15, Math.min((rect.width - 150) / (24 * 9), (rect.height - 180) / (10 * 18))))
    const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    await page.mouse.click(center.x, center.y)
    const start = gesture === 'move' ? center : {
      x: center.x + 11.5 * 9 * zoom, y: center.y + 4.5 * 18 * zoom,
    }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 3; step++) {
      await page.mouse.move(start.x + step * 9 * zoom, start.y + step * 18 * zoom)
      // The empty interior remains under this point for both gestures. Sample
      // every frame while the 50 ms worker preview request completes.
      const colors = await canvas.evaluate(async (element, point) => {
        const canvas = element as HTMLCanvasElement
        const rect = canvas.getBoundingClientRect()
        const ctx = canvas.getContext('2d')!
        const x = Math.round((point.x - rect.left) * canvas.width / rect.width)
        const y = Math.round((point.y - rect.top) * canvas.height / rect.height)
        const colors: string[] = []
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        const end = performance.now() + 200
        do {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
          colors.push([...ctx.getImageData(x, y, 1, 1).data].join(','))
        } while (performance.now() < end)
        return [...new Set(colors)]
      }, center)
      expect(colors).toEqual(['255,255,255,255'])
    }
    const replies = await page.evaluate(() => {
      const state = window as Window & { __DRAW_BENCHMARK_SAMPLES__?: Array<{ name: string; detail?: { command?: string } }> }
      return state.__DRAW_BENCHMARK_SAMPLES__?.filter(sample => sample.name === 'editor.workerRoundTrip' && sample.detail?.command === 'previewPatch').length ?? 0
    })
    expect(replies).toBeGreaterThanOrEqual(3)
    await page.mouse.up()
    // The normal selection tint returns once the gesture is committed.
    await expect.poll(() => canvas.evaluate((element, point) => {
      const canvas = element as HTMLCanvasElement, rect = canvas.getBoundingClientRect()
      return [...canvas.getContext('2d')!.getImageData(
        Math.round((point.x - rect.left) * canvas.width / rect.width),
        Math.round((point.y - rect.top) * canvas.height / rect.height), 1, 1,
      ).data].join(',')
    }, center)).not.toBe('255,255,255,255')
  })
}

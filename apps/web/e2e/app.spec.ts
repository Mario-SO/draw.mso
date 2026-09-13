import { expect, test, type Download, type Page } from "@playwright/test"
import { mkdir, readFile } from "node:fs/promises"

const canvas = (page: Page) => page.getByRole("application", { name: /diagram canvas/i })
const documentHeading = (page: Page) => page.getByRole("heading", { level: 1 })
const screenshotDirectory = "/Users/mario/Documents/Codex/2026-09-13/i-wo/work"

async function setDocumentsOpen(page: Page, open: boolean) {
  const toggle = page.getByRole("button", { name: "Toggle documents", exact: true })
  if ((await toggle.getAttribute("aria-expanded")) !== String(open)) await toggle.click()
}

async function renameDocument(page: Page, title: string) {
  await setDocumentsOpen(page, true)
  const sidebar = page.getByRole("complementary", { name: "Documents", exact: true })
  const activeRow = sidebar.locator('.document-row[aria-current="page"]')
  await expect(activeRow).toBeEnabled()
  await activeRow.dblclick()
  const dialog = page.getByRole("dialog", { name: "Rename document" })
  await dialog.getByLabel("Document title", { exact: true }).fill(title)
  await dialog.getByRole("button", { name: "Rename", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect(documentHeading(page)).toHaveText(title)
  await setDocumentsOpen(page, false)
}

async function waitForSample(page: Page) {
  await page.goto("/")
  await expect(documentHeading(page)).toHaveText("Event-driven architecture")
  await expect(canvas(page)).toBeVisible()
  await setDocumentsOpen(page, false)
  await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible()
}

async function downloadFrom(page: Page, action: () => Promise<void>): Promise<Download> {
  const pending = page.waitForEvent("download")
  await action()
  return pending
}

async function saveDocument(page: Page) {
  const download = await downloadFrom(page, () => page.getByRole("button", { name: /^save$/i }).click())
  const path = await download.path()
  expect(path).not.toBeNull()
  return { download, document: JSON.parse(await readFile(path!, "utf8")) }
}

async function exportDiagram(page: Page, itemName: string) {
  return downloadFrom(page, async () => {
    await page.getByRole("button", { name: "Export and share" }).click()
    await page.getByRole("menuitem", { name: new RegExp(itemName + "$") }).click()
  })
}

async function addBlock(page: Page, kind: string) {
  await page.getByRole("button", { name: kind, exact: true }).click()
  const box = await canvas(page).boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible()
}

async function setGeometry(page: Page, values: Record<"X" | "Y" | "W" | "H", number>) {
  for (const [label, value] of Object.entries(values)) {
    const input = page.getByLabel(label, { exact: true })
    await input.fill(String(value))
    await input.press("Enter")
    await expect(input).toHaveValue(String(value))
    // Let the worker snapshot return before editing the next controlled field.
    await page.waitForTimeout(300)
  }
}

async function fittedPoint(page: Page, bounds: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  await page.locator(".zoom-value").click()
  const box = await canvas(page).boundingBox()
  expect(box).not.toBeNull()
  const zoom = Math.min(1.25, Math.max(0.15, Math.min((box!.width - 150) / (bounds.width * 9), (box!.height - 180) / (bounds.height * 18))))
  return {
    x: box!.x + (box!.width - bounds.width * 9 * zoom) / 2 + (x - bounds.x) * 9 * zoom,
    y: box!.y + (box!.height - bounds.height * 18 * zoom) / 2 + (y - bounds.y) * 18 * zoom,
  }
}

test("keeps the resting canvas minimal and reveals properties only for a selection", async ({ page }) => {
  await waitForSample(page)
  await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(0)
  await expect(page.locator(".empty-inspector, .library-panel")).toHaveCount(0)
  await expect(page.getByText("Workflow", { exact: true })).toHaveCount(0)
  await expect(page.locator(".canvas-meta")).toHaveClass(/sr-only/)
  await expect(page.getByRole("button", { name: "Insert", exact: true })).toHaveCount(0)

  await addBlock(page, "Service")
  await expect(page.locator("#node-label")).toHaveValue("New service")
  await canvas(page).press("Escape")
  await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(0)
})

test("edits geometry, undoes, saves, and restores a document", async ({ page }) => {
  await waitForSample(page)
  await renameDocument(page, "Checkout architecture")
  await addBlock(page, "Service")
  await setGeometry(page, { X: 12, Y: 9, W: 28, H: 8 })
  await page.locator("#node-label").fill("Payments API")
  await page.locator("#node-label").press("Tab")

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.locator("#node-label")).toHaveValue("New service")
  await page.getByRole("button", { name: "Redo" }).click()
  await expect(page.locator("#node-label")).toHaveValue("Payments API")
  await expect(page.locator(".canvas-meta")).toContainText("Saved on this device")

  const saved = await saveDocument(page)
  expect(saved.download.suggestedFilename()).toBe("checkout-architecture.mso")
  expect(saved.document).toMatchObject({ version: 1, title: "Checkout architecture" })
  expect(saved.document.nodes.find((node: { label: string }) => node.label === "Payments API")).toMatchObject({ x: 12, y: 9, width: 28, height: 8 })

  await page.reload()
  await expect(documentHeading(page)).toHaveText("Checkout architecture")
  expect((await saveDocument(page)).document).toEqual(saved.document)

  await page.getByRole("button", { name: "Toggle documents" }).click()
  await page.getByRole("button", { name: "New document", exact: true }).click()
  await page.getByRole("button", { name: "Toggle documents" }).click()
  expect((await saveDocument(page)).document.nodes).toEqual([])
  await page.locator('input[type="file"]').setInputFiles((await saved.download.path())!)
  await expect(documentHeading(page)).toHaveText("Checkout architecture")
})

test("keeps a new connection attached after moving and resizing an offset block", async ({ page }) => {
  await waitForSample(page)
  await page.getByRole("button", { name: "Toggle documents" }).click()
  await page.getByRole("button", { name: "New document", exact: true }).click()
  await page.getByRole("button", { name: "Toggle documents" }).click()
  await addBlock(page, "Service")
  await setGeometry(page, { X: 0, Y: 2, W: 16, H: 5 })
  await page.locator("#node-label").fill("Producer")
  await page.locator("#node-label").press("Tab")
  await addBlock(page, "Database")
  await setGeometry(page, { X: 36, Y: 14, W: 18, H: 6 })
  await page.locator("#node-label").fill("Store")
  await page.locator("#node-label").press("Tab")

  await page.locator(".zoom-value").click()
  const box = await canvas(page).boundingBox()
  expect(box).not.toBeNull()
  const zoom = Math.min(1.25, (box!.width - 90) / (54 * 9), (box!.height - 100) / (18 * 18))
  const originX = box!.x + (box!.width - 54 * 9 * zoom) / 2
  const originY = box!.y + (box!.height - 18 * 18 * zoom) / 2 - 2 * 18 * zoom
  const point = (x: number, y: number) => ({ x: originX + x * 9 * zoom, y: originY + y * 18 * zoom })

  await page.getByRole("button", { name: "Connect" }).click()
  const source = point(8, 4.5)
  const destination = point(45, 17)
  await page.mouse.click(source.x, source.y)
  await page.mouse.click(destination.x, destination.y)

  await page.mouse.move(source.x, source.y)
  await page.mouse.down()
  await page.mouse.move(source.x + 3 * 9 * zoom, source.y + 2 * 18 * zoom, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("3")
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue("4")

  const resize = point(19, 9)
  await page.mouse.move(resize.x, resize.y)
  await page.mouse.down()
  await page.mouse.move(resize.x + 2 * 9 * zoom, resize.y + 18 * zoom, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByLabel("W", { exact: true })).toHaveValue("18")
  await expect(page.getByLabel("H", { exact: true })).toHaveValue("6")

  const saved = await saveDocument(page)
  expect(saved.document.edges).toHaveLength(1)
  const producer = saved.document.nodes.find((node: { label: string }) => node.label === "Producer")
  const store = saved.document.nodes.find((node: { label: string }) => node.label === "Store")
  expect(producer).toMatchObject({ x: 3, y: 4, width: 18, height: 6 })
  expect(saved.document.edges[0]).toMatchObject({ from: producer.id, to: store.id })
})

test("preserves explicit connection sides through geometry changes, undo, and reload", async ({ page }) => {
  await waitForSample(page)
  await page.getByRole("button", { name: "Toggle documents" }).click()
  await page.getByRole("button", { name: "New document", exact: true }).click()
  await page.getByRole("button", { name: "Toggle documents" }).click()
  await addBlock(page, "Service")
  await setGeometry(page, { X: 0, Y: 2, W: 16, H: 5 })
  await page.locator("#node-label").fill("Producer")
  await page.locator("#node-label").press("Tab")
  await addBlock(page, "Database")
  await setGeometry(page, { X: 36, Y: 14, W: 18, H: 6 })
  await page.locator("#node-label").fill("Store")
  await page.locator("#node-label").press("Tab")

  const bounds = { x: 0, y: 2, width: 54, height: 18 }
  const sourceRight = await fittedPoint(page, bounds, 15.5, 4.5)
  const destinationLeft = await fittedPoint(page, bounds, 36.5, 17)
  await page.getByRole("button", { name: "Connect" }).click()
  await page.mouse.click(sourceRight.x, sourceRight.y)
  await page.mouse.click(destinationLeft.x, destinationLeft.y)

  let saved = await saveDocument(page)
  expect(saved.document.edges).toHaveLength(1)
  expect(saved.document.edges[0]).toMatchObject({ fromSide: "right", toSide: "left" })

  // The destination remains selected after connecting. Move and resize it through
  // the inspector so every edit travels through the same document/history path.
  await setGeometry(page, { X: 40, Y: 12, W: 20, H: 7 })
  expect((await saveDocument(page)).document.edges[0]).toMatchObject({ fromSide: "right", toSide: "left" })

  await page.getByRole("button", { name: "Undo" }).click()
  await expect(page.getByLabel("H", { exact: true })).toHaveValue("6")
  saved = await saveDocument(page)
  expect(saved.document.edges[0]).toMatchObject({ fromSide: "right", toSide: "left" })

  await expect(page.locator(".canvas-meta")).toContainText("Saved on this device")
  await page.reload()
  saved = await saveDocument(page)
  expect(saved.document.edges[0]).toMatchObject({ fromSide: "right", toSide: "left" })
})

test("exports Unicode, strict ASCII, and SVG", async ({ page }) => {
  await waitForSample(page)
  const unicodeDownload = await exportDiagram(page, "Unicode text")
  const unicodeText = await readFile((await unicodeDownload.path())!, "utf8")
  expect(unicodeDownload.suggestedFilename()).toBe("event-driven-architecture.txt")
  expect(unicodeText).toMatch(/[┌┐└┘─│]/)
  expect(unicodeText).toMatch(/[╔╗╚╝═║]/)
  expect(unicodeText).toMatch(/[┄┆]/)
  expect(unicodeText).toContain("API gateway")

  const asciiDownload = await exportDiagram(page, "ASCII text")
  const asciiText = await readFile((await asciiDownload.path())!, "utf8")
  expect(asciiText).toContain("API gateway")
  expect([...new Set([...asciiText].filter(character => character.codePointAt(0)! > 0x7f))]).toEqual([])

  const svgDownload = await exportDiagram(page, "Vector image")
  const svgText = await readFile((await svgDownload.path())!, "utf8")
  expect(svgDownload.suggestedFilename()).toBe("event-driven-architecture.svg")
  expect(svgText).toMatch(/^<svg[\s>]/)
  expect(svgText).toContain("<text")
  expect(svgText).toContain(">A</text>")
  expect(svgText).toContain("</svg>")
})

test("reports an invalid imported document without replacing the sample", async ({ page }) => {
  await waitForSample(page)
  const before = await saveDocument(page)
  await page.locator('input[type="file"]').setInputFiles({
    name: "invalid.mso", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: 1, title: "Broken", nodes: "invalid", edges: [] })),
  })
  await expect(page.getByRole("alert")).toContainText("invalid document JSON")
  expect((await saveDocument(page)).document).toEqual(before.document)
})

test("captures the floating workspace on desktop and narrow layouts", async ({ page }) => {
  await mkdir(screenshotDirectory, { recursive: true })
  await waitForSample(page)
  await expect(page.locator("header, .topbar")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Toggle documents", exact: true })).toBeVisible()
  await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Export and share" })).toBeVisible()
  await setDocumentsOpen(page, true)
  await expect(page.getByRole("complementary", { name: "Documents", exact: true })).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${screenshotDirectory}/floating-workspace.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(canvas(page)).toBeVisible()
  await expect(page.getByRole("toolbar", { name: "Drawing tools" })).not.toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${screenshotDirectory}/floating-workspace-mobile.png`, fullPage: true })
  const toggle = page.getByRole("button", { name: "Toggle documents", exact: true })
  const openPosition = await toggle.boundingBox()
  await toggle.click()
  await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible()
  expect(await toggle.boundingBox()).toEqual(openPosition)
})

test("captures routed arrows across offset, reversed, close, and crossing layouts", async ({ page }) => {
  await mkdir(screenshotDirectory, { recursive: true })
  await waitForSample(page)
  await page.locator('input[type="file"]').setInputFiles({
    name: "arrow-review.mso",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      version: 1,
      title: "Arrow routing review",
      nodes: [
        { id: "producer", kind: "service", label: "Producer", x: 0, y: 2, width: 15, height: 5 },
        { id: "events", kind: "database", label: "Events DB", x: 29, y: 10, width: 16, height: 6 },
        { id: "reverse-source", kind: "queue", label: "Retry queue", x: 34, y: -1, width: 16, height: 5 },
        { id: "reverse-target", kind: "service", label: "Worker", x: 5, y: 15, width: 14, height: 5 },
        { id: "close-source", kind: "service", label: "API", x: 55, y: 1, width: 11, height: 5 },
        { id: "close-target", kind: "database", label: "DB", x: 69, y: 1, width: 11, height: 5 },
        { id: "cross-a", kind: "queue", label: "Orders", x: 54, y: 13, width: 13, height: 5 },
        { id: "cross-b", kind: "database", label: "Ledger", x: 77, y: 8, width: 13, height: 6 },
        { id: "cross-c", kind: "service", label: "Billing", x: 78, y: 17, width: 13, height: 5 },
        { id: "cross-d", kind: "queue", label: "Jobs", x: 55, y: 7, width: 12, height: 5 },
      ],
      edges: [
        { id: "offset", from: "producer", to: "events", fromSide: "right", toSide: "left", label: "" },
        { id: "reversed", from: "reverse-source", to: "reverse-target", fromSide: "left", toSide: "right", label: "" },
        { id: "close", from: "close-source", to: "close-target", fromSide: "right", toSide: "left", label: "" },
        { id: "cross-one", from: "cross-a", to: "cross-b", fromSide: "right", toSide: "left", label: "" },
        { id: "cross-two", from: "cross-c", to: "cross-d", fromSide: "left", toSide: "right", label: "" },
      ],
    })),
  })
  await expect(documentHeading(page)).toHaveText("Arrow routing review")
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator(".zoom-value").click()
  await page.screenshot({ path: `${screenshotDirectory}/arrows-review.png`, fullPage: true })
})

async function openSelectionFixture(page: Page) {
  await waitForSample(page)
  await page.locator('input[type="file"]').setInputFiles({ name: 'selection.mso', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    version: 1, title: 'Subsystem editing',
    nodes: [
      { id: 'api', kind: 'service', label: 'Orders API', x: 0, y: 0, width: 16, height: 5 },
      { id: 'queue', kind: 'queue', label: 'Events', x: 24, y: 0, width: 16, height: 5 },
      { id: 'db', kind: 'database', label: 'Database', x: 48, y: 0, width: 16, height: 5 },
    ], edges: [{ id: 'a', from: 'api', to: 'queue', label: '' }, { id: 'b', from: 'queue', to: 'db', label: '' }]
  })) })
  await expect(documentHeading(page)).toHaveText('Subsystem editing')
}

test('groups, moves, duplicates connected subsystems, and preserves groups on reload', async ({ page }) => {
  await openSelectionFixture(page)
  await canvas(page).press('ControlOrMeta+a')
  const actions = page.getByRole('complementary', { name: 'Selection actions' })
  await expect(actions).toContainText('3 selected')
  await page.getByRole('button', { name: 'Group selection', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ungroup selection', exact: true })).toBeEnabled()
  const grouped = (await saveDocument(page)).document
  expect(new Set(grouped.nodes.map((n: any) => n.groupId)).size).toBe(1)
  expect(grouped.nodes[0].groupId).toBeTruthy()
  await canvas(page).press('Shift+ArrowRight')
  const moved = (await saveDocument(page)).document
  expect(moved.nodes.map((n: any) => n.x)).toEqual([5, 29, 53])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await saveDocument(page)).document.nodes.map((n: any) => n.x)).toEqual([0, 24, 48])
  await page.getByRole('button', { name: 'Duplicate selection', exact: true }).click()
  const copied = (await saveDocument(page)).document
  expect(copied.nodes).toHaveLength(6)
  expect(copied.edges).toHaveLength(4)
  const added = copied.nodes.filter((n: any) => !['api', 'queue', 'db'].includes(n.id))
  const ids = new Set(added.map((n: any) => n.id))
  expect(added[0].groupId).not.toBe(grouped.nodes[0].groupId)
  expect(new Set(added.map((n: any) => n.groupId)).size).toBe(1)
  expect(copied.edges.filter((e: any) => ids.has(e.from) && ids.has(e.to))).toHaveLength(2)
  await expect(page.locator('.canvas-meta')).toContainText('Saved on this device')
  await page.reload()
  await expect(documentHeading(page)).toHaveText('Subsystem editing')
  expect((await saveDocument(page)).document).toEqual(copied)
  const member = await fittedPoint(page, { x: 0, y: 0, width: 68, height: 8 }, 56, 2)
  await page.mouse.click(member.x, member.y)
  await expect(actions).toContainText('3 selected')
  await canvas(page).press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Ungroup selection', exact: true }).click()
  expect((await saveDocument(page)).document.nodes.every((n: any) => !n.groupId)).toBe(true)
})

test('marquee and shift selection support cancellation and alignment', async ({ page }) => {
  await openSelectionFixture(page)
  const bounds = { x: 0, y: 0, width: 64, height: 5 }
  const start = await fittedPoint(page, bounds, -2, -2)
  const end = await fittedPoint(page, bounds, 42, 7)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('complementary', { name: 'Selection actions' })).toContainText('2 selected')
  const third = await fittedPoint(page, bounds, 56, 2)
  await page.keyboard.down('Shift')
  await page.mouse.click(third.x, third.y)
  await expect(page.getByRole('complementary', { name: 'Selection actions' })).toContainText('3 selected')
  await page.mouse.click(third.x, third.y)
  await page.keyboard.up('Shift')
  await expect(page.getByRole('complementary', { name: 'Selection actions' })).toContainText('2 selected')
  const before = (await saveDocument(page)).document
  const point = await fittedPoint(page, bounds, 8, 2)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 72, point.y + 54, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect((await saveDocument(page)).document).toEqual(before)
  await canvas(page).press('ControlOrMeta+a')
  await page.getByRole('button', { name: 'Align selection', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Align left', exact: true }).click()
  const aligned = (await saveDocument(page)).document
  expect(aligned.nodes.map((n: any) => n.x)).toEqual([0, 0, 0])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await saveDocument(page)).document).toEqual(before)
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: `${screenshotDirectory}/selection-review.png` })
})

test('drag snapping can be bypassed and axis constraints remain intact', async ({ page }) => {
  await openSelectionFixture(page)
  const bounds = { x: 0, y: 0, width: 64, height: 5 }
  const start = await fittedPoint(page, bounds, 8, 2)
  const end = await fittedPoint(page, bounds, 13, 3)
  const drag = async (modifier?: string) => {
    if (modifier && modifier !== 'Shift') await page.keyboard.down(modifier)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    if (modifier === 'Shift') await page.keyboard.down(modifier)
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    if (modifier) await page.keyboard.up(modifier)
    return (await saveDocument(page)).document.nodes.find((n: any) => n.id === 'api')
  }
  expect(await drag('Alt')).toMatchObject({ x: 5, y: 1 })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await drag()).toMatchObject({ x: 5, y: 0 })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await drag('Shift')).toMatchObject({ x: 5, y: 0 })
})

test('floating document sidebar keeps separate documents, edits, imports and active state', async ({ page }) => {
  await waitForSample(page)
  await expect(page.getByRole('button', { name: 'Document menu' })).toHaveCount(0)
  const toggle = page.getByRole('button', { name: 'Toggle documents' })
  await renameDocument(page, 'My first system')
  await setDocumentsOpen(page, true)
  const sidebar = page.getByRole('complementary', { name: 'Documents', exact: true })
  const list = page.getByRole('navigation', { name: 'Saved documents' })
  await expect(sidebar).toBeVisible()
  await expect(list.getByRole('button', { name: 'My first system', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Untitled diagram')
  expect((await saveDocument(page)).document.nodes).toHaveLength(0)
  await renameDocument(page, 'Another system')
  await setDocumentsOpen(page, true)
  await list.getByRole('button', { name: 'My first system', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('My first system')
  expect((await saveDocument(page)).document.nodes.length).toBeGreaterThan(0)
  await list.getByRole('button', { name: 'Another system', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Another system')
  expect((await saveDocument(page)).document.nodes).toHaveLength(0)
  await page.reload()
  await expect(documentHeading(page)).toHaveText('Another system')
  await expect(list.getByRole('button', { name: 'My first system', exact: true })).toBeVisible()
  const fileChooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file…', exact: true }).click()
  await (await fileChooser).setFiles({ name: 'imported.mso', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 1, title: 'Imported system', nodes: [], edges: [] })) })
  await expect(documentHeading(page)).toHaveText('Imported system')
  await expect(list.getByRole('button', { name: 'Another system', exact: true })).toBeVisible()
  await expect(list.getByRole('button', { name: 'Imported system', exact: true })).toHaveAttribute('aria-current', 'page')
  await mkdir(screenshotDirectory, { recursive: true })
  await page.screenshot({ path: `${screenshotDirectory}/document-sidebar.png` })
  await page.getByRole('button', { name: 'Toggle documents' }).click()
  await expect(sidebar).not.toBeVisible()
  await expect(toggle).toBeFocused()
  await toggle.click()
  await expect(sidebar).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: `${screenshotDirectory}/document-sidebar-mobile.png` })
})

test('migrates the previous single-document autosave without losing it', async ({ page }) => {
  await page.route('**/legacy-seed', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto('/legacy-seed')
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('draw-mso', 10) // Dexie version(1) uses native version 10.
      request.onupgradeneeded = () => request.result.createObjectStore('documents', { keyPath: 'id' })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('documents', 'readwrite')
        tx.objectStore('documents').put({ id: 'current', document: { version: 1, title: 'Existing user work', nodes: [{ id: 'original', kind: 'service', label: 'Keep me', x: 2, y: 3, width: 16, height: 5 }], edges: [] } })
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    })
  })
  await page.goto('/')
  await expect(documentHeading(page)).toHaveText('Existing user work')
  await expect(page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button', { name: 'Existing user work', exact: true })).toBeVisible()
  expect((await saveDocument(page)).document.nodes[0]).toMatchObject({ id: 'original', label: 'Keep me', x: 2, y: 3 })
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button', { name: 'Existing user work', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Existing user work')
  expect((await saveDocument(page)).document.nodes).toHaveLength(1)
})

test('keeps document order stable while editing, switching, reloading, and appending', async ({ page }) => {
  await waitForSample(page)
  await setDocumentsOpen(page, true)
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Untitled diagram')
  await renameDocument(page, 'First workspace')
  await addBlock(page, 'Service')

  await setDocumentsOpen(page, true)
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await renameDocument(page, 'Second workspace')
  await setDocumentsOpen(page, true)
  const list = page.getByRole('navigation', { name: 'Saved documents' })
  await expect(list.getByRole('button', { name: 'Second workspace', exact: true })).toBeVisible()
  const rows = list.locator('.document-row')
  const order = await rows.allTextContents()
  expect(order).toEqual(['Event-driven architecture', 'First workspace', 'Second workspace'])

  await list.getByRole('button', { name: 'First workspace', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('First workspace')
  expect((await saveDocument(page)).document.nodes).toHaveLength(1)
  await page.reload()
  await expect(documentHeading(page)).toHaveText('First workspace')
  await expect(rows).toHaveText(order)

  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(rows).toHaveText([...order, 'Untitled diagram'])
})

test('document trash appears on hover, preserves inactive edits, and handles the last document', async ({ page }) => {
  await waitForSample(page)
  await renameDocument(page, 'Old document')
  await setDocumentsOpen(page, true)
  await expect(page.getByRole('button', { name: 'Delete Old document', exact: true })).toHaveCSS('opacity', '0')
  await page.getByRole('navigation', { name: 'Saved documents' }).getByRole('button', { name: 'Old document', exact: true }).hover()
  await expect(page.getByRole('button', { name: 'Delete Old document', exact: true })).toHaveCSS('opacity', '1')
  await page.screenshot({ path: `${screenshotDirectory}/document-trash.png` })
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Untitled diagram')
  await renameDocument(page, 'Working document')
  await addBlock(page, 'Service'); await setDocumentsOpen(page, true)
  await page.getByRole('button', { name: 'Delete Old document', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Delete Old document', exact: true })).toHaveCount(0)
  await expect(documentHeading(page)).toHaveText('Working document')
  expect((await saveDocument(page)).document.nodes).toHaveLength(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await saveDocument(page)).document.nodes).toHaveLength(0)
  await page.getByRole('button', { name: 'Delete Working document', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Untitled diagram')
  const list = page.getByRole('navigation', { name: 'Saved documents' })
  await expect(list.locator('.document-row')).toHaveCount(1)
  expect((await saveDocument(page)).document.nodes).toHaveLength(0)
  await page.reload()
  await expect(documentHeading(page)).toHaveText('Untitled diagram')
  await expect(list.locator('.document-row')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Delete Working document', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await renameDocument(page, 'Temporary')
  await setDocumentsOpen(page, true)
  await page.getByRole('button', { name: 'Delete Temporary', exact: true }).click()
  await expect(documentHeading(page)).toHaveText('Untitled diagram')
  await expect(list.locator('.document-row')).toHaveCount(1)
})

test('empty documents reset tools and stay stable through clicks, drags, fit and first placement', async ({ page }) => {
  await waitForSample(page)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.getByRole('button', { name: 'Toggle documents' }).click()
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Toggle documents' }).click()
  await expect(page.locator('.zoom-value')).toHaveText('100%')
  const rect = (await canvas(page).boundingBox())!
  for (const offset of [0, 40, -40]) await page.mouse.click(rect.x + rect.width / 2 + offset, rect.y + rect.height / 2)
  await page.mouse.move(rect.x + 320, rect.y + 190); await page.mouse.down()
  await page.mouse.move(rect.x + 322, rect.y + 191); await page.mouse.up()
  await page.mouse.move(rect.x + 350, rect.y + 230); await page.mouse.down()
  await page.mouse.move(rect.x + 510, rect.y + 340, { steps: 6 }); await page.keyboard.press('Escape'); await page.mouse.up()
  await page.locator('.zoom-value').click()
  expect((await saveDocument(page)).document.nodes).toHaveLength(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0)
  await addBlock(page, 'Service')
  expect((await saveDocument(page)).document.nodes).toHaveLength(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await saveDocument(page)).document.nodes).toHaveLength(0)
  await page.locator('.zoom-value').click()
  await expect(page.locator('.zoom-value')).toHaveText('100%')
})


test('sidebar content waits for expansion and rapid toggles cancel pending reveals', async ({ page }) => {
  await waitForSample(page)
  await setDocumentsOpen(page, false)
  await page.waitForTimeout(350)
  const toggle = page.getByRole('button', { name: 'Toggle documents', exact: true })
  const sidebar = page.locator('#document-sidebar')
  await toggle.evaluate(async button => {
    for (let i = 0; i < 10; i++) {
      (button as HTMLButtonElement).click()
      await new Promise(resolve => setTimeout(resolve, 30))
    }
  })
  await page.waitForTimeout(350)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(sidebar).toHaveCSS('opacity', '0')
  await expect(sidebar).toHaveCSS('visibility', 'hidden')
  await toggle.evaluate(async button => {
    (button as HTMLButtonElement).click()
    await new Promise(resolve => setTimeout(resolve, 100))
  })
  await expect(sidebar).toHaveCSS('opacity', '0')
  await expect(sidebar).toHaveCSS('opacity', '1')
  await expect(sidebar).toHaveCSS('visibility', 'visible')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await toggle.click()
  await expect(sidebar).toHaveCSS('visibility', 'hidden')
  await toggle.click()
  await expect(sidebar).toHaveCSS('opacity', '1')
})

import { expect, test, type Download, type Page } from "@playwright/test"
import { readFile } from "node:fs/promises"

const canvas = (page: Page) => page.getByRole("application", { name: /diagram canvas/i })

async function waitForEditor(page: Page) {
  await page.goto("/")
  await expect(canvas(page)).toBeVisible()
  await expect(page.getByRole("toolbar", { name: "Drawing tools" })).toBeVisible()
  await expect(page.locator(".canvas-meta")).toContainText("Ready")
}

async function newDocument(page: Page) {
  const toggle = page.getByRole("button", { name: "Toggle documents", exact: true })
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click()
  await page.getByRole("button", { name: "New document", exact: true }).click()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Untitled diagram")
  if ((await toggle.getAttribute("aria-expanded")) !== "false") await toggle.click()
  await expect(page.locator(".canvas-meta")).toContainText("0 nodes")
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

async function exportUnicode(page: Page) {
  return downloadFrom(page, async () => {
    await page.getByRole("button", { name: "Export and share" }).click()
    await page.getByRole("menuitem", { name: /Unicode text$/ }).click()
  })
}

async function canvasBox(page: Page) {
  const box = await canvas(page).boundingBox()
  expect(box).not.toBeNull()
  return box!
}

test("draws a sized rectangle and persists its text layout and appearance", async ({ page }) => {
  await waitForEditor(page)
  await newDocument(page)
  const box = await canvasBox(page)
  const start = { x: box.x + box.width / 2 - 90, y: box.y + box.height / 2 - 54 }
  const end = { x: start.x + 12 * 9, y: start.y + 7 * 18 }

  await page.getByRole("button", { name: "Rectangle", exact: true }).click()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 6 })
  await page.mouse.up()

  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible()
  await expect(page.getByLabel("W", { exact: true })).toHaveValue("13")
  await expect(page.getByLabel("H", { exact: true })).toHaveValue("8")
  await page.getByLabel("Label", { exact: true }).fill("alpha beta gamma")
  await page.getByLabel("Label", { exact: true }).press("Tab")
  await page.getByLabel("Alignment", { exact: true }).selectOption("right")
  await page.getByLabel("Position", { exact: true }).selectOption("bottom")
  await page.getByLabel("Border", { exact: true }).selectOption("double")
  await page.getByLabel("Fill character", { exact: true }).fill(".")
  await page.getByLabel("Fill character", { exact: true }).press("Tab")
  const wrap = page.getByRole("checkbox", { name: "Wrap text to frame" })
  if (!(await wrap.isChecked())) await wrap.check()

  const saved = await saveDocument(page)
  expect(saved.document.version).toBe(2)
  expect(saved.document.nodes).toHaveLength(1)
  expect(saved.document.nodes[0]).toMatchObject({
    kind: "rectangle", width: 13, height: 8, label: "alpha beta gamma",
    textAlign: "right", verticalAlign: "bottom", wrap: true, border: "double", fill: ".",
  })

  const exported = await exportUnicode(page)
  const text = await readFile((await exported.path())!, "utf8")
  expect(text).toContain("alpha")
  expect(text).toContain("gamma")
  expect(text).toMatch(/[╔╗╚╝═║]/)
})

test("creates text with the Text tool and upgrades a legacy document durably", async ({ page }) => {
  await waitForEditor(page)
  await newDocument(page)
  const box = await canvasBox(page)

  await page.getByRole("button", { name: "Text", exact: true }).click()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const editor = page.getByRole("textbox", { name: "Edit diagram label" })
  await expect(editor).toBeVisible()
  await editor.fill("free text")
  await editor.press("ControlOrMeta+Enter")
  expect((await saveDocument(page)).document.nodes[0]).toMatchObject({ kind: "text", label: "free text" })

  const legacy = {
    version: 1,
    title: "Legacy service",
    nodes: [{ id: "legacy", kind: "service", label: "API", x: 3, y: 4, width: 12, height: 4 }],
    edges: [],
  }
  await page.locator('input[type="file"]').setInputFiles({
    name: "legacy.mso",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(legacy)),
  })
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Legacy service")
  const upgraded = await saveDocument(page)
  expect(upgraded.document).toMatchObject({ version: 2, title: "Legacy service" })
  expect(upgraded.document.nodes[0]).toMatchObject({ id: "legacy", kind: "service", label: "API" })

  await page.reload()
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Legacy service")
  expect((await saveDocument(page)).document).toEqual(upgraded.document)
})

test("creates and styles a free line", async ({ page }) => {
  await waitForEditor(page)
  await newDocument(page)
  const box = await canvasBox(page)
  await page.getByRole("button", { name: "Zoom in", exact: true }).click()
  const start = { x: box.x + box.width / 2 - 126, y: box.y + box.height / 2 - 36 }
  const end = { x: start.x + 28 * 9, y: start.y + 8 * 18 }

  await page.getByRole("button", { name: "Line", exact: true }).click()
  await page.mouse.click(start.x, start.y)
  await expect(page.locator(".canvas-meta")).toContainText("Now click the end point")
  await page.mouse.click(end.x, end.y)

  const inspector = page.getByRole("complementary", { name: "Line inspector" })
  await expect(inspector).toBeVisible()
  await page.getByLabel("Routing", { exact: true }).selectOption("staircase")
  await page.getByLabel("Line style", { exact: true }).selectOption("dashed")
  await page.getByLabel("Start marker", { exact: true }).selectOption("diamond")
  await page.getByLabel("End marker", { exact: true }).selectOption("circle")

  const saved = await saveDocument(page)
  expect(saved.document.nodes).toEqual([])
  expect(saved.document.edges).toHaveLength(1)
  expect(saved.document.edges[0]).toMatchObject({
    from: "", to: "", startArrow: "diamond", endArrow: "circle",
    lineStyle: "dashed", routing: "staircase",
  })
  expect(saved.document.edges[0].fromPoint).toBeTruthy()
  expect(saved.document.edges[0].toPoint).toBeTruthy()
  expect(saved.document.edges[0].fromPoint).not.toEqual(saved.document.edges[0].toPoint)

  const originalEnd = saved.document.edges[0].toPoint
  const zoom = Number.parseInt((await page.getByRole("button", { name: "Fit diagram", exact: true }).first().textContent()) ?? "125", 10) / 100
  // Endpoint hit-testing uses route grid coordinates (the visible stroke extends
  // around that coordinate by half a cell).
  const renderedEnd = {
    x: box.x + box.width / 2 + originalEnd.x * 9 * zoom,
    y: box.y + box.height / 2 + originalEnd.y * 18 * zoom,
  }
  await page.mouse.move(renderedEnd.x, renderedEnd.y)
  await page.mouse.down()
  await page.mouse.move(renderedEnd.x + 4 * 9 * zoom, renderedEnd.y + 2 * 18 * zoom, { steps: 5 })
  await page.mouse.up()

  const moved = await saveDocument(page)
  expect(moved.document.edges[0].fromPoint).toEqual(saved.document.edges[0].fromPoint)
  expect(moved.document.edges[0].toPoint).toEqual({ x: originalEnd.x + 4, y: originalEnd.y + 2 })
})

test("imports plain text and exports a valid PNG", async ({ page }) => {
  await waitForEditor(page)
  await page.locator('input[type="file"]').setInputFiles({
    name: "terminal.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("one\ntwo"),
  })
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("terminal")
  const saved = await saveDocument(page)
  expect(saved.document.nodes).toHaveLength(1)
  expect(saved.document.nodes[0]).toMatchObject({ kind: "text", label: "one\ntwo", width: 3, height: 2 })

  const png = await downloadFrom(page, async () => {
    await page.getByRole("button", { name: "Export and share" }).click()
    await page.getByRole("menuitem", { name: /PNG Raster image/ }).click()
  })
  const bytes = await readFile((await png.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
})

test("object controls persist visibility, locking, and layer order", async ({ page }) => {
  await waitForEditor(page)
  const document = {
    version: 2,
    title: "Layers",
    nodes: [
      { id: "alpha", kind: "rectangle", label: "Alpha", x: -8, y: -2, width: 10, height: 4 },
      { id: "beta", kind: "rectangle", label: "Beta", x: 5, y: -2, width: 10, height: 4 },
    ],
    edges: [],
  }
  await page.locator('input[type="file"]').setInputFiles({ name: "layers.mso", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) })
  await page.getByRole("button", { name: "Toggle objects" }).click()
  const objects = page.getByRole("complementary", { name: "Objects" })
  await expect(objects).toBeVisible()

  await page.getByRole("button", { name: "Hide Alpha" }).click()
  await expect(page.getByRole("button", { name: "Show Alpha" })).toBeVisible()
  await page.getByRole("button", { name: "Lock Beta" }).click()
  await expect(page.getByRole("button", { name: "Unlock Beta" })).toBeVisible()
  await page.getByRole("button", { name: "Select Alpha" }).click()
  await objects.getByRole("button", { name: "To front" }).click()

  const saved = await saveDocument(page)
  expect(saved.document.nodes.map((node: { id: string }) => node.id)).toEqual(["beta", "alpha"])
  expect(saved.document.nodes.find((node: { id: string }) => node.id === "alpha")).toMatchObject({ hidden: true })
  expect(saved.document.nodes.find((node: { id: string }) => node.id === "beta")).toMatchObject({ locked: true })
  const exported = await exportUnicode(page)
  const text = await readFile((await exported.path())!, "utf8")
  expect(text).toContain("Beta")
  expect(text).not.toContain("Alpha")
})

test("Fill updates the box background without creating editable text", async ({ page }) => {
  await waitForEditor(page)
  await newDocument(page)
  const bounds = await canvasBox(page)
  const start = { x: bounds.x + bounds.width / 2 - 90, y: bounds.y + bounds.height / 2 - 72 }
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 18 * 9, start.y + 8 * 18, { steps: 5 })
  await page.mouse.up()
  await page.getByLabel('Label', { exact: true }).fill('Keep this text')
  await page.getByLabel('Label', { exact: true }).press('Tab')
  const before = (await saveDocument(page)).document
  await page.getByRole('button', { name: 'Fill', exact: true }).click()
  await page.getByLabel('Character', { exact: true }).fill('-')
  await page.mouse.click(start.x + 6 * 9, start.y + 4 * 18)
  await expect(page.getByLabel('Fill character', { exact: true })).toHaveValue('-')
  const filled = (await saveDocument(page)).document
  expect(filled.nodes).toEqual([{ ...before.nodes[0], fill: '-' }])
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await saveDocument(page)).document.nodes).toEqual(before.nodes)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByLabel('Fill character', { exact: true })).toHaveValue('-')
  // Filling an already filled area replaces the background rather than adding text.
  await page.getByLabel('Character', { exact: true }).fill('.')
  await page.mouse.click(start.x + 6 * 9, start.y + 4 * 18)
  await expect(page.getByLabel('Fill character', { exact: true })).toHaveValue('.')
  expect((await saveDocument(page)).document.nodes).toEqual([{ ...before.nodes[0], fill: '.' }])
  await page.mouse.click(start.x - 100, start.y - 80)
  expect((await saveDocument(page)).document.nodes).toEqual([{ ...before.nodes[0], fill: '.' }])
})

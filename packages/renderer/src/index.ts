export const CELL_WIDTH = 9;
export const CELL_HEIGHT = 18;

import type { DiagramNode, DiagramEdge, DiagramDocument, ConnectionSide } from '@draw/diagram-core/contract';
import { DisplayCellIndex, type DisplayCell } from './display-cell-index';
export type { DiagramNode, DiagramEdge, DiagramDocument, ConnectionSide } from '@draw/diagram-core/contract';

export interface GridPoint {
  x: number;
  y: number;
}

export interface Scene {
  displayCells?: DisplayCell[];
  /** Incremental snapshots share unchanged, sorted rows. */
  displayRows?: ReadonlyMap<number, readonly DisplayCell[]>;
  /** Full terminal composition is optional because Canvas only uses displayCells. */
  cells?: Array<{ x: number; y: number; ch: string }>;
  bounds: { x: number; y: number; width: number; height: number };
  routes: Array<{ id: string; points: GridPoint[]; startArrow?: string; endArrow?: string; lineStyle?: string; routing?: string }>;
}

export interface Camera {
  /** Horizontal CSS-pixel offset of grid origin. */
  x: number;
  /** Vertical CSS-pixel offset of grid origin. */
  y: number;
  zoom: number;
}

export interface DragPreview {
  node: DiagramNode;
  dx: number;
  dy: number;
}

const BACKGROUND = "#f5f5f7";
const GRID = "rgba(88, 94, 106, 0.12)";
const TEXT = "#30333b";
const STROKE = "#9298a3";
const BLUE = "#007aff";
// NESW masks render box-drawing cells as continuous paths, independent of font metrics.
const LINE_MASK: Record<string, number> = {
  "│": 5, "─": 10, "┌": 6, "┐": 12, "└": 3, "┘": 9,
  "├": 7, "┤": 13, "┬": 14, "┴": 11, "┼": 15,
  "╭": 6, "╮": 12, "╰": 3, "╯": 9,
  "║": 5, "═": 10, "╔": 6, "╗": 12, "╚": 3, "╝": 9,
  "┃": 5, "━": 10, "┏": 6, "┓": 12, "┗": 3, "┛": 9,
  "┄": 10, "┆": 5, "┈": 10, "┊": 5,
};

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;
  private scene: Scene | null = null;
  private document: DiagramDocument | null = null;
  private _camera: Camera = { x: 0, y: 0, zoom: 1 };
  private selected = new Set<string>();
  private previews: DragPreview[] = [];
  private marquee: { x: number; y: number; width: number; height: number } | null = null;
  private guides: Array<{ axis: 'x' | 'y'; value: number; from: number; to: number }> = [];
  private connectSource: string | null = null;
  private connectHover: string | null = null;
  private hoverSide: ConnectionSide | undefined;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private frame: number | null = null;
  private destroyed = false;
  private pendingInput: { kind: string; at: number } | null = null;
  private readonly displayCellIndex = new DisplayCellIndex();
  private nodeBorders = new Map<string, string>();
  private selectedEdge: string | null = null;
  private linePreview: { from: GridPoint; to: GridPoint } | null = null;
  private drawingCursor: { point: GridPoint; character: string } | null = null;
  setLinePreview(preview: { from: GridPoint; to: GridPoint } | null): void { this.linePreview = preview; this.scheduleRender(); }
  setDrawingCursor(point: GridPoint | null, character: string): void { this.drawingCursor = point ? { point, character } : null; this.scheduleRender(); }


  setSelectedEdge(id: string | null): void { this.selectedEdge = id; this.scheduleRender(); }
  private edgesById = new Map<string, DiagramEdge>();
  private routeBounds: Array<{ left: number; top: number; right: number; bottom: number }> = [];
  private previewIds = new Set<string>();
  private routeBoundsCache = new WeakMap<Scene['routes'][number], { left: number; top: number; right: number; bottom: number }>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas2D is not available");
    this.context = context;
  }

  get camera(): Camera {
    return { ...this._camera };
  }

  resize(width: number, height: number, dpr = globalThis.devicePixelRatio || 1): void {
    this.cssWidth = Math.max(0, width);
    this.cssHeight = Math.max(0, height);
    this.dpr = Math.max(0.1, dpr);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    this.scheduleRender();
  }

  setScene(scene: Scene, doc: DiagramDocument): void {
    const benchmarking = Boolean((globalThis as typeof globalThis & { __DRAW_BENCHMARK_ENABLED__?: boolean }).__DRAW_BENCHMARK_ENABLED__);
    const startedAt = benchmarking ? performance.now() : 0;
    if (this.scene === scene && this.document === doc) { this.scheduleRender(); return; }
    this.scene = scene;
    this.document = doc;
    if (scene.displayRows) this.displayCellIndex.updateRows(scene.displayRows);
    else this.displayCellIndex.update(scene.displayCells ?? []);
    this.nodeBorders = new Map(doc.nodes.map(node => [node.id, node.border ?? (node.kind === 'database' ? 'double' : 'single')]));
    this.edgesById = new Map(doc.edges.map(edge => [edge.id, edge]));
    this.routeBounds = scene.routes.map(route => {
      const cached = this.routeBoundsCache.get(route);
      if (cached) return cached;
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const point of route.points) {
        left = Math.min(left, point.x); top = Math.min(top, point.y);
        right = Math.max(right, point.x); bottom = Math.max(bottom, point.y);
      }
      const bounds = { left, top, right, bottom };
      this.routeBoundsCache.set(route, bounds);
      return bounds;
    });
    if (benchmarking) this.recordPerformance('renderer.sceneUpdate', performance.now() - startedAt, 'ms');
    this.scheduleRender();
  }

  setCamera(camera: Camera): void {
    this._camera = {
      x: camera.x,
      y: camera.y,
      zoom: Math.max(0.05, Math.min(16, camera.zoom)),
    };
    this.scheduleRender();
  }

  setSelection(ids: string[]): void {
    this.selected = new Set(ids);
    this.scheduleRender();
  }

  setPreview(preview: DragPreview | null): void {
    this.previews = preview ? [preview] : [];
    this.previewIds = new Set(preview ? [preview.node.id] : []);
    this.scheduleRender();
  }

  setPreviews(previews: DragPreview[]): void {
    this.previews = previews;
    this.previewIds = new Set(previews.map(preview => preview.node.id));
    this.scheduleRender();
  }
  setMarquee(rect: { x: number; y: number; width: number; height: number } | null): void {
    this.marquee = rect; this.scheduleRender();
  }
  setGuides(guides: Array<{ axis: 'x' | 'y'; value: number; from: number; to: number }>): void {
    this.guides = guides; this.scheduleRender();
  }

  setConnectSource(id: string | null): void {
    this.connectSource = id;
    this.scheduleRender();
  }

  setConnectHover(id: string | null, side?: ConnectionSide): void {
    if (id === this.connectHover && side === this.hoverSide) return;
    this.connectHover = id; this.hoverSide = side; this.scheduleRender();
  }

  screenToGrid(x: number, y: number): GridPoint {
    return {
      x: (x - this._camera.x) / (CELL_WIDTH * this._camera.zoom),
      y: (y - this._camera.y) / (CELL_HEIGHT * this._camera.zoom),
    };
  }

  gridToScreen(x: number, y: number): GridPoint {
    return {
      x: this._camera.x + x * CELL_WIDTH * this._camera.zoom,
      y: this._camera.y + y * CELL_HEIGHT * this._camera.zoom,
    };
  }

  render(): void {
    this.scheduleRender();
  }

  /** Associates the next coalesced frame with a browser input for opt-in benchmarks. */
  markInput(kind: string): void {
    if ((globalThis as typeof globalThis & { __DRAW_BENCHMARK_ENABLED__?: boolean }).__DRAW_BENCHMARK_ENABLED__) {
      this.pendingInput ??= { kind, at: performance.now() };
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.scene = null;
    this.document = null;
  }

  private scheduleRender(): void {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const benchmarking = Boolean((globalThis as typeof globalThis & { __DRAW_BENCHMARK_ENABLED__?: boolean }).__DRAW_BENCHMARK_ENABLED__);
      const startedAt = benchmarking ? performance.now() : 0;
      this.paint();
      if (benchmarking) {
        const finishedAt = performance.now();
        this.recordPerformance('renderer.paint', finishedAt - startedAt, 'ms');
        if (this.pendingInput) {
          this.recordPerformance('renderer.inputToFrame', finishedAt - this.pendingInput.at, 'ms', { input: this.pendingInput.kind });
          this.pendingInput = null;
        }
      }
    });
  }

  private recordPerformance(name: string, value: number, unit: 'ms', detail?: Record<string, string>): void {
    const target = globalThis as typeof globalThis & { __DRAW_BENCHMARK_ENABLED__?: boolean; __DRAW_BENCHMARK_SAMPLES__?: unknown[] };
    if (!target.__DRAW_BENCHMARK_ENABLED__) return;
    const sample = { name, value, unit, detail };
    (target.__DRAW_BENCHMARK_SAMPLES__ ??= []).push(sample);
    globalThis.dispatchEvent(new CustomEvent('draw:performance', { detail: sample }));
  }

  private paint(): void {
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.paintGrid(ctx);
    if (!this.scene || !this.document) return;

    this.paintArrows(ctx);
    this.paintNodeSurfaces(ctx);
    this.paintCells(ctx);
    this.paintNodeOverlays(ctx);
    this.paintPreview(ctx);
    this.paintInteractionOverlays(ctx);
  }

  private visibleGridBounds(padding = 1) {
    const a = this.screenToGrid(0, 0);
    const b = this.screenToGrid(this.cssWidth, this.cssHeight);
    return {
      left: Math.floor(Math.min(a.x, b.x)) - padding,
      top: Math.floor(Math.min(a.y, b.y)) - padding,
      right: Math.ceil(Math.max(a.x, b.x)) + padding,
      bottom: Math.ceil(Math.max(a.y, b.y)) + padding,
    };
  }

  private paintGrid(ctx: CanvasRenderingContext2D): void {
    const z = this._camera.zoom;
    const step = z < 0.35 ? 8 : z < 0.65 ? 4 : z < 1 ? 2 : 1;
    const bounds = this.visibleGridBounds();
    const radius = Math.max(0.45, Math.min(1.1, z * 0.65));
    ctx.fillStyle = GRID;
    ctx.beginPath();
    for (let y = Math.floor(bounds.top / step) * step; y <= bounds.bottom; y += step) {
      for (let x = Math.floor(bounds.left / step) * step; x <= bounds.right; x += step) {
        const p = this.gridToScreen(x, y);
        ctx.moveTo(p.x + radius, p.y);
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  private paintNodeSurfaces(ctx: CanvasRenderingContext2D): void {
    if (!this.document) return;
    const visible = this.visibleGridBounds();
    for (const node of this.document.nodes) {
      if (node.hidden || !this.isNodeVisible(node, visible) || node.kind === "text" || node.kind === "boundary" || node.border === "none" || this.previewIds.has(node.id)) continue;
      const p = this.gridToScreen(node.x + 0.5, node.y + 0.5);
      const width = (node.width - 1) * CELL_WIDTH * this._camera.zoom;
      const height = (node.height - 1) * CELL_HEIGHT * this._camera.zoom;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(p.x, p.y, width, height);
    }
  }

  private paintCells(ctx: CanvasRenderingContext2D): void {
    if (!this.scene) return;
    const visible = this.visibleGridBounds(2);
    const z = this._camera.zoom;
    ctx.font = `${14 * z}px "Geist Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(0.8, 1.15 * z);
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    // The displayed scene may already contain an earlier worker preview. Hide
    // those scene positions, not the original positions from pointer-down.
    const oldNodes = this.previewIds.size ? (this.document?.nodes.filter(node => this.previewIds.has(node.id)) ?? []) : [];
    let activeStroke = '';
    const flushLines = () => {
      if (!activeStroke) return;
      ctx.stroke();
      activeStroke = '';
    };
    this.displayCellIndex.forEach(visible.left, visible.top, visible.right, visible.bottom, cell => {
      if (oldNodes.some(n => cell.x >= n.x && cell.x < n.x + n.width && cell.y >= n.y && cell.y < n.y + n.height)) return;
      const p = this.gridToScreen(cell.x + 0.5, cell.y + 0.5);
      const mask = LINE_MASK[cell.ch];
      if (mask) {
        const hx = CELL_WIDTH * z / 2, hy = CELL_HEIGHT * z / 2;
        const boundary = cell.ch === "┈" || cell.ch === "┊";
        const dashed = boundary || cell.ch === "┄" || cell.ch === "┆";
        const doubled = "║═╔╗╚╝".includes(cell.ch);
        const heavy = "┃━┏┓┗┛".includes(cell.ch);
        const stroke = heavy ? 'heavy' : boundary ? 'boundary' : dashed ? 'dashed' : 'solid';
        if (stroke !== activeStroke) {
          flushLines();
          activeStroke = stroke;
          ctx.lineWidth = Math.max(0.8, (heavy ? 2.4 : 1.15) * z);
          ctx.strokeStyle = boundary ? "#b7bdc6" : STROKE;
          ctx.setLineDash(boundary ? [2 * z, 4 * z] : dashed ? [3 * z, 3 * z] : []);
          ctx.beginPath();
        }
        if ("╭╮╰╯".includes(cell.ch)) {
          const horizontal = mask & 2 ? hx : -hx, vertical = mask & 4 ? hy : -hy;
          ctx.moveTo(p.x + horizontal, p.y);
          ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + vertical);
          return;
        }
        for (const offset of doubled ? [-1.6 * z, 1.6 * z] : [0]) {
          const cx = p.x + (mask === 10 ? 0 : mask & 2 ? offset : -offset);
          const cy = p.y + (mask === 5 ? 0 : mask & 4 ? offset : -offset);
          if (mask & 1) { ctx.moveTo(cx, cy); ctx.lineTo(cx, p.y - hy); }
          if (mask & 2) { ctx.moveTo(cx, cy); ctx.lineTo(p.x + hx, cy); }
          if (mask & 4) { ctx.moveTo(cx, cy); ctx.lineTo(cx, p.y + hy); }
          if (mask & 8) { ctx.moveTo(cx, cy); ctx.lineTo(p.x - hx, cy); }
        }
      } else {
        flushLines();
        ctx.setLineDash([]);
        ctx.fillStyle = TEXT;
        ctx.fillText(cell.ch, p.x, p.y);
      }
    });
    flushLines();
    ctx.setLineDash([]);
  }

  private paintArrows(ctx: CanvasRenderingContext2D): void {
    if (!this.scene || !this.document) return;
    const z = this._camera.zoom;
    const visible = this.visibleGridBounds(2);
    ctx.strokeStyle = STROKE; ctx.fillStyle = STROKE;
    ctx.lineWidth = Math.max(0.8, 1.35 * z);
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.setLineDash([]);
    for (let routeIndex = 0; routeIndex < this.scene.routes.length; routeIndex++) {
      const route = this.scene.routes[routeIndex]!;
      if (route.points.length < 2) continue;
      const bounds = this.routeBounds[routeIndex]!;
      if (bounds.right < visible.left || bounds.left > visible.right || bounds.bottom < visible.top || bounds.top > visible.bottom) continue;
      const points = route.points.map(p => this.gridToScreen(p.x + .5, p.y + .5));
      const first = points[0], second = points[1];
      const tip = points[points.length - 1], before = points[points.length - 2];
      const dx = Math.sign(tip.x - before.x), dy = Math.sign(tip.y - before.y);
      if (!dx && !dy) continue;
      // Database strokes straddle the logical border; stop at the visible outside edge.
      const edge = this.edgesById.get(route.id);
      if (edge && this.nodeBorders.get(edge.from) === "double") {
        first.x += Math.sign(second.x - first.x) * 1.6 * z;
        first.y += Math.sign(second.y - first.y) * 1.6 * z;
      }
      if (edge && this.nodeBorders.get(edge.to) === "double") {
        tip.x -= dx * 1.6 * z; tip.y -= dy * 1.6 * z;
      }
      ctx.beginPath(); ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1], corner = points[i], next = points[i + 1];
        const incoming = Math.hypot(corner.x - prev.x, corner.y - prev.y);
        const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
        const radius = route.routing === 'staircase' ? 0 : Math.min(5 * z, incoming / 2, outgoing / 2);
        if (!incoming || !outgoing) continue;
        ctx.lineTo(corner.x - (corner.x - prev.x) / incoming * radius, corner.y - (corner.y - prev.y) / incoming * radius);
        ctx.quadraticCurveTo(corner.x, corner.y, corner.x + (next.x - corner.x) / outgoing * radius, corner.y + (next.y - corner.y) / outgoing * radius);
      }
      ctx.lineTo(tip.x, tip.y);
      // A narrow halo breaks earlier paths at crossings, without inventing a junction.
      ctx.strokeStyle = BACKGROUND; ctx.lineWidth = Math.max(.8, 1.35 * z) + 4 * z; ctx.stroke();
      ctx.strokeStyle = this.selectedEdge === route.id ? BLUE : STROKE; ctx.lineWidth = Math.max(.8, 1.35 * z); ctx.setLineDash((route.lineStyle ?? edge?.lineStyle) === 'dashed' ? [5 * z, 4 * z] : []); ctx.stroke(); ctx.setLineDash([]);
      const paintMarker = (at: GridPoint, neighbor: GridPoint, marker: string) => {
        if (marker === 'none') return;
        const angle = Math.atan2(at.y - neighbor.y, at.x - neighbor.x);
        const length = Math.min(8 * z, Math.hypot(at.x - neighbor.x, at.y - neighbor.y));
        ctx.save(); ctx.translate(at.x, at.y); ctx.rotate(angle); ctx.setLineDash([]);
        ctx.beginPath();
        if (marker === 'circle') ctx.arc(-length / 2, 0, length / 2, 0, Math.PI * 2);
        else if (marker === 'diamond') { ctx.moveTo(0, 0); ctx.lineTo(-length / 2, length / 2); ctx.lineTo(-length, 0); ctx.lineTo(-length / 2, -length / 2); ctx.closePath(); }
        else { ctx.moveTo(0, 0); ctx.lineTo(-length, length * .45); ctx.lineTo(-length, -length * .45); ctx.closePath(); }
        ctx.fillStyle = this.selectedEdge === route.id ? BLUE : STROKE; ctx.fill(); ctx.restore();
      };
      paintMarker(first, second, route.startArrow ?? edge?.startArrow ?? 'none');
      paintMarker(tip, before, route.endArrow ?? edge?.endArrow ?? 'arrow');
      if (this.selectedEdge === route.id) {
        for (const point of [first, tip]) { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = BLUE; ctx.stroke(); }
      }
      ctx.setLineDash([]);

    }
  }

  private paintNodeOverlays(ctx: CanvasRenderingContext2D): void {
    if (!this.document) return;
    const visible = this.visibleGridBounds();
    for (const node of this.document.nodes) {
      if (node.hidden) continue;
      const selected = this.selected.has(node.id);
      const source = this.connectSource === node.id;
      if (this.previewIds.has(node.id)) continue;
      const hover = this.connectHover === node.id;
      if ((!selected && !source && !hover) || !this.isNodeVisible(node, visible)) continue;
      this.strokeNode(ctx, node, BLUE, selected);
      if (selected && !node.locked && this.selected.size === 1 && (node.kind !== "text" || node.wrap)) this.paintResizeHandles(ctx, node);
      if (source || hover) this.paintPorts(ctx, node);
    }
  }

  private strokeNode(ctx: CanvasRenderingContext2D, node: DiagramNode, color: string, fill: boolean): void {
    const inset = node.kind === "text" ? 0 : 0.5;
    const p = this.gridToScreen(node.x + inset, node.y + inset);
    const w = (node.width - inset * 2) * CELL_WIDTH * this._camera.zoom;
    const h = (node.height - inset * 2) * CELL_HEIGHT * this._camera.zoom;
    if (fill) {
      ctx.fillStyle = "rgba(0, 122, 255, 0.035)";
      ctx.fillRect(p.x, p.y, w, h);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.5 * this._camera.zoom);
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  }

  private paintHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const p = this.gridToScreen(x, y);
    const size = Math.max(5, 6 * this._camera.zoom);
    ctx.fillStyle = BLUE;
    ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  }

  private paintPorts(ctx: CanvasRenderingContext2D, node: DiagramNode): void {
    const points = [
      [node.x + Math.floor(node.width / 2) + 0.5, node.y + 0.5],
      [node.x + node.width - 0.5, node.y + Math.floor(node.height / 2) + 0.5],
      [node.x + Math.floor(node.width / 2) + 0.5, node.y + node.height - 0.5],
      [node.x + 0.5, node.y + Math.floor(node.height / 2) + 0.5],
    ] as const;
    ctx.fillStyle = BLUE;
    for (const [index, [x, y]] of points.entries()) {
      const active = this.connectHover === node.id && this.hoverSide === (["top", "right", "bottom", "left"] as const)[index];
      ctx.fillStyle = active ? BLUE : "#ffffff"; ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5;
      const p = this.gridToScreen(x, y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }

  private paintResizeHandles(ctx: CanvasRenderingContext2D, node: DiagramNode): void {
    const left = node.x + .5, right = node.x + node.width - .5, top = node.y + .5, bottom = node.y + node.height - .5;
    const middleX = (left + right) / 2, middleY = (top + bottom) / 2;
    for (const [x, y] of [[left, top], [middleX, top], [right, top], [right, middleY], [right, bottom], [middleX, bottom], [left, bottom], [left, middleY]]) this.paintHandle(ctx, x!, y!);
  }

  private paintPreview(ctx: CanvasRenderingContext2D): void {
    for (const preview of this.previews) this.paintOnePreview(ctx, preview);
  }

  private paintOnePreview(ctx: CanvasRenderingContext2D, preview: DragPreview): void {
    const node = { ...preview.node, x: preview.node.x + preview.dx, y: preview.node.y + preview.dy };
    const p = this.gridToScreen(node.x + 0.5, node.y + 0.5);
    const z = this._camera.zoom;
    const width = (node.width - 1) * CELL_WIDTH * z;
    const height = (node.height - 1) * CELL_HEIGHT * z;
    ctx.fillStyle = "#fff";
    if (node.kind !== "boundary" && node.kind !== "text") ctx.fillRect(p.x, p.y, width, height);
    ctx.strokeStyle = BLUE; ctx.lineWidth = 1.2;
    if (node.kind !== "text") ctx.strokeRect(p.x, p.y, width, height);
    ctx.fillStyle = TEXT;
    ctx.font = `${14 * z}px "Geist Mono", ui-monospace, monospace`;
    ctx.textBaseline = "middle"; ctx.textAlign = "center";
    if (node.kind === "text") {
      // Match Rust's top-left, one-scalar-per-cell composition during movement.
      node.label.split("\n").slice(0, node.height).forEach((line, row) => {
        Array.from(line).slice(0, node.width).forEach((character, column) => {
          const cell = this.gridToScreen(node.x + column + 0.5, node.y + row + 0.5);
          ctx.fillText(character, cell.x, cell.y);
        });
      });
      this.strokeNode(ctx, node, BLUE, false);
      return;
    }
    const lines = node.label.split("\n").slice(0, Math.max(1, node.height - 2));
    lines.forEach((line, i) => ctx.fillText(line.slice(0, node.width - 2), p.x + width / 2, p.y + height / 2 + (i - (lines.length - 1) / 2) * CELL_HEIGHT * z));
    if (this.previews.length === 1) this.paintHandle(ctx, node.x + node.width - 0.5, node.y + node.height - 0.5);
  }

  private paintInteractionOverlays(ctx: CanvasRenderingContext2D): void {
    const z = this._camera.zoom;
    ctx.save();
    ctx.lineWidth = 1; ctx.strokeStyle = BLUE;
    if (this.linePreview) {
      const from = this.gridToScreen(this.linePreview.from.x + .5, this.linePreview.from.y + .5);
      const to = this.gridToScreen(this.linePreview.to.x + .5, this.linePreview.to.y + .5);
      ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(from.x, from.y);
      ctx.lineTo((from.x + to.x) / 2, from.y); ctx.lineTo((from.x + to.x) / 2, to.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.setLineDash([]);
      for (const point of [from, to]) { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
    }
    if (this.drawingCursor) {
      const point = this.gridToScreen(this.drawingCursor.point.x, this.drawingCursor.point.y);
      ctx.fillStyle = '#007aff12'; ctx.fillRect(point.x, point.y, CELL_WIDTH * z, CELL_HEIGHT * z);
      ctx.strokeRect(point.x, point.y, CELL_WIDTH * z, CELL_HEIGHT * z);
      ctx.font = `${14 * z}px "Geist Mono", monospace`; ctx.fillStyle = BLUE; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(this.drawingCursor.character, point.x + CELL_WIDTH * z + 5, point.y);
    }

    if (this.selected.size > 1 && this.document && !this.previews.length) {
      const nodes = this.document.nodes.filter(n => this.selected.has(n.id));
      if (nodes.length) {
        const x = Math.min(...nodes.map(n => n.x)), y = Math.min(...nodes.map(n => n.y));
        const right = Math.max(...nodes.map(n => n.x + n.width)), bottom = Math.max(...nodes.map(n => n.y + n.height));
        const p = this.gridToScreen(x, y);
        ctx.setLineDash([4, 4]); ctx.strokeRect(p.x - 3, p.y - 3, (right - x) * CELL_WIDTH * z + 6, (bottom - y) * CELL_HEIGHT * z + 6);
      }
    }
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#d65fba';
    for (const guide of this.guides) {
      const a = this.gridToScreen(guide.axis === 'x' ? guide.value + .5 : guide.from, guide.axis === 'y' ? guide.value + .5 : guide.from);
      const b = this.gridToScreen(guide.axis === 'x' ? guide.value + .5 : guide.to, guide.axis === 'y' ? guide.value + .5 : guide.to);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    if (this.marquee) {
      const p = this.gridToScreen(this.marquee.x, this.marquee.y);
      ctx.setLineDash([]); ctx.strokeStyle = BLUE; ctx.fillStyle = 'rgba(0,122,255,.07)';
      const w = this.marquee.width * CELL_WIDTH * z, h = this.marquee.height * CELL_HEIGHT * z;
      ctx.fillRect(p.x, p.y, w, h); ctx.strokeRect(p.x, p.y, w, h);
    }
    ctx.restore();
  }

  private isNodeVisible(node: DiagramNode, visible = this.visibleGridBounds()): boolean {
    return node.x + node.width >= visible.left && node.x <= visible.right && node.y + node.height >= visible.top && node.y <= visible.bottom;
  }
}

export { SpatialIndex } from "./spatial-index";
export { DisplayCellIndex, type DisplayCell } from './display-cell-index';

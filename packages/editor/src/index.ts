import { decodeEngineResult } from './worker-protocol';
import { CanvasRenderer, SpatialIndex, CELL_WIDTH, CELL_HEIGHT, type DiagramNode, type DiagramDocument, type DiagramEdge, type Scene, type ConnectionSide } from '@draw/renderer';
import { sampleDocument } from './sample';
import { diffDocument } from './document-patch';
import { LocalDocuments, type DocumentSummary } from './local-documents';
import { benchmarkEnabled, recordPerformance, type BenchmarkApi } from './performance';
import { svgToPng } from './png-export';
import type { EngineOperation, EnginePayload, EngineResult, EngineWorkerResponse } from './worker-protocol';
export type { DiagramNode, DiagramEdge } from '@draw/renderer';
export type { DocumentSummary } from './local-documents';
export type Tool = 'select' | 'pan' | 'rectangle' | 'text' | 'line' | 'pencil' | 'eraser' | 'fill' | 'picker';
export interface EditorSnapshot {
  title: string; tool: Tool; selected: DiagramNode | null; selectedEdge: DiagramEdge | null; connections: DiagramEdge[]; nodeCount: number; edgeCount: number;
  objects: DiagramNode[];
  selectedCount: number; canGroup: boolean; canUngroup: boolean;
  documents: DocumentSummary[]; activeDocumentId: string; documentBusy: boolean;
  drawingCharacter: string; zoom: number; canUndo: boolean; canRedo: boolean; status: string; error: string | null;
}
const clone = <T>(value: T): T => structuredClone(value);
const uid = () => crypto.randomUUID();
const fitText = (node: DiagramNode) => {
  if (node.kind !== 'text' || node.wrap) return;
  const lines = node.label.split('\n');
  const primary = Math.max(1, ...lines.map(line => Array.from(line).length)), secondary = Math.max(1, lines.length);
  const vertical = node.textDirection === 'down' || node.textDirection === 'up';
  const border = node.border ?? 'none', inset = (border === 'none' ? 0 : 1) + Math.max(0, node.padding ?? 0);
  node.width = (vertical ? secondary : primary) + inset * 2;
  node.height = (vertical ? primary : secondary) + inset * 2;
};
const affectsTextFit = (patch: Partial<DiagramNode>) => ['label', 'border', 'padding', 'wrap', 'textDirection', 'lineDirection'].some(field => field in patch);
const lockSafePatch = (patch: Partial<DiagramNode>) => ({ ...('hidden' in patch ? { hidden: patch.hidden } : {}), ...('locked' in patch ? { locked: patch.locked } : {}) });
const canResize = (node: DiagramNode) => node.kind !== 'text' || Boolean(node.wrap);
const minimumSize = (node: DiagramNode) => ({ width: node.kind === 'text' ? 1 : 3, height: node.kind === 'text' ? 1 : 3 });
type GroupNode = DiagramNode;
type MoveOrigin = { id: string; x: number; y: number };
type GridPoint = { x: number; y: number };
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
type Drag =
  | { mode: 'pan'; startX: number; startY: number; initialX: number; initialY: number }
  | { mode: 'marquee'; startX: number; startY: number; currentX: number; currentY: number; additive: boolean; initialSelection: Set<string> }
  | { mode: 'move'; startX: number; startY: number; nodes: DiagramNode[]; origins: MoveOrigin[]; dx: number; dy: number }
  | { mode: 'resize'; startX: number; startY: number; node: DiagramNode; handle: ResizeHandle; dx: number; dy: number }
  | { mode: 'create'; tool: 'rectangle' | 'text'; startX: number; startY: number; currentX: number; currentY: number }
  | { mode: 'draw'; tool: 'pencil' | 'eraser'; points: GridPoint[]; last: GridPoint }
  | { mode: 'create-line'; startScreenX: number; startScreenY: number; from: GridPoint; current: GridPoint }
  | { mode: 'edge-endpoint'; edge: DiagramEdge; endpoint: 'from' | 'to'; fixed: GridPoint; current: GridPoint }
  | { mode: 'move-edge'; edge: DiagramEdge; startX: number; startY: number; dx: number; dy: number };

export class Editor {
  readonly ready: Promise<void>;
  private canvas = document.createElement('canvas');
  private textarea = document.createElement('textarea');
  private renderer: CanvasRenderer;
  private spatialIndex = new SpatialIndex();
  private worker: Worker;
  private localDocuments = new LocalDocuments();
  private documents: DocumentSummary[] = [];
  private activeDocumentId = '';
  private documentBusy = false;
  private documentOperations = 0;
  private requests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; startedAt: number; type: EngineOperation }>();
  private requestId = 0;
  private document: DiagramDocument = clone(sampleDocument);
  private scene: Scene | null = null;
  private tool: Tool = 'select';
  private selectedIds = new Set<string>();
  private selectedEdgeId: string | null = null;
  private drawingCharacter = '#';
  private sourceId: string | null = null;
  private sourceSide: ConnectionSide | undefined;
  private sourcePoint: GridPoint | undefined;
  private sourcePreviewPoint: GridPoint | undefined;
  private drag: Drag | null = null;
  private width = 1;
  private height = 1;
  private canUndo = false;
  private canRedo = false;
  private status = 'Starting Rust engine…';
  private error: string | null = null;
  private observer: ResizeObserver;
  private disposed = false;
  private initialized = false;
  private autoFit = true;
  private spaceDown = false;
  private textId: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private abort = new AbortController();
  private pendingCommands = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private saveQueue: Promise<void> = Promise.resolve();
  private previewTimer: ReturnType<typeof setTimeout> | undefined;
  private previewBusy = false;
  private previewRevision = 0;
  private benchmarkApi?: BenchmarkApi;

  constructor(private host: HTMLElement, private options: { onChange: (snapshot: EditorSnapshot) => void }) {
    const loadStartedAt = performance.now();
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.overflow = 'hidden';
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('role', 'application');
    this.canvas.setAttribute('aria-label', 'Diagram canvas. Use toolbar to add objects. Arrow keys move selection; Delete removes it.');
    this.textarea.setAttribute('aria-label', 'Edit diagram label');
    this.textarea.style.cssText = 'display:none;position:absolute;z-index:5;resize:none;background:#ffffff;color:#25272d;border:1px solid #007aff;border-radius:8px;padding:10px;outline:none;box-shadow:0 4px 24px #00000012;font-family:"Geist Mono",monospace;box-sizing:border-box;';
    host.append(this.canvas, this.textarea);
    this.renderer = new CanvasRenderer(this.canvas);
    if (benchmarkEnabled()) {
      this.benchmarkApi = { firstNodeCenter: () => {
        const node = this.document.nodes.find(candidate => candidate.kind !== 'boundary') ?? this.document.nodes[0];
        if (!node) return null;
        const point = this.renderer.gridToScreen(node.x + node.width / 2, node.y + node.height / 2);
        const rect = this.canvas.getBoundingClientRect();
        return { x: rect.left + point.x, y: rect.top + point.y };
      } };
      (window as Window & { __DRAW_BENCHMARK_API__?: BenchmarkApi }).__DRAW_BENCHMARK_API__ = this.benchmarkApi;
    }
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }: MessageEvent<EngineWorkerResponse>) => {
      const pending = this.requests.get(data.id);
      if (!pending) return;
      this.requests.delete(data.id);
      if (data.performance) for (const sample of data.performance) recordPerformance(sample);
      if (data.error) {
        if (data.error.code) recordPerformance({ name: 'editor.workerError', value: 1, unit: 'count', detail: { command: pending.type, code: data.error.code } });
        const error = new Error(data.error.message ?? String(data.error));
        if (data.error.code) Object.assign(error, { code: data.error.code });
        if (data.error.details) Object.assign(error, { details: data.error.details });
        pending.reject(error);
      } else {
        try {
          const parseAt = benchmarkEnabled() ? performance.now() : 0;
          const result = typeof data.result === 'object' && data.result !== null ? decodeEngineResult(data.result) : data.result;
          recordPerformance({ name: 'editor.engineOutputParse', value: performance.now() - parseAt, unit: 'ms', detail: { command: pending.type } });
          // Include decoding in the round trip so results stay comparable to the
          // previous worker-parsed transport rather than hiding work on main.
          recordPerformance({ name: 'editor.workerRoundTrip', value: performance.now() - pending.startedAt, unit: 'ms', detail: { command: pending.type } });
          pending.resolve(result);
        } catch (error) { pending.reject(error instanceof Error ? error : new Error(String(error))); }
      }
    };
    this.worker.onerror = () => {
      const error = new Error('Could not load the Rust engine. Reload the page and try again.');
      for (const pending of this.requests.values()) pending.reject(error);
      this.requests.clear(); this.fail(error);
    };
    const signal = this.abort.signal;
    this.canvas.addEventListener('pointerdown', this.pointerDown, { signal });
    this.canvas.addEventListener('pointermove', this.pointerMove, { signal });
    this.canvas.addEventListener('pointerup', this.pointerUp, { signal });
    this.canvas.addEventListener('pointercancel', this.pointerCancel, { signal });
    this.canvas.addEventListener('dblclick', this.doubleClick, { signal });
    this.canvas.addEventListener('wheel', this.wheel, { signal, passive: false });
    this.canvas.addEventListener('contextmenu', event => event.preventDefault(), { signal });
    this.canvas.addEventListener('paste', this.paste, { signal });
    window.addEventListener('keydown', this.keyDown, { signal });
    window.addEventListener('keyup', event => { if (event.code === 'Space') this.spaceDown = false; }, { signal });
    window.addEventListener('blur', () => { this.spaceDown = false; this.pointerCancel(); }, { signal });
    this.textarea.addEventListener('input', () => this.layoutTextEditor(), { signal });
    this.textarea.addEventListener('blur', () => this.finishText(), { signal });
    this.textarea.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { this.textId = null; this.textarea.style.display = 'none'; this.canvas.focus(); }
      else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) this.textarea.blur();
    }, { signal });
    this.observer = new ResizeObserver(entries => {
      this.width = entries[0].contentRect.width;
      this.height = entries[0].contentRect.height;
      this.renderer.resize(this.width, this.height);
      if (this.scene && this.autoFit) this.fit();
    });
    this.observer.observe(host);
    this.ready = this.initialize().then(() => {
      recordPerformance({ name: 'editor.ready', value: performance.now() - loadStartedAt, unit: 'ms' });
    });
  }

  private async initialize() {
    try {
      await document.fonts.ready;
      let saved: Awaited<ReturnType<LocalDocuments['initialize']>> | undefined;
      try { saved = await this.localDocuments.initialize(sampleDocument); } catch { this.status = 'Local storage unavailable'; }
      if (saved) { this.activeDocumentId = saved.activeId; this.documents = saved.documents; }
      if (this.disposed) return;
      let result: EngineResult;
      try { result = await this.request('init', saved?.document ?? sampleDocument); }
      catch (error) {
        if (!saved) throw error;
        result = await this.request('init', sampleDocument);
        this.activeDocumentId = '';
        try {
          const recoveryId = await this.localDocuments.create(sampleDocument);
          await this.localDocuments.setActive(recoveryId);
          this.activeDocumentId = recoveryId; this.documents = await this.localDocuments.list();
        } catch { /* Keep the invalid record untouched and continue without autosave. */ }
        this.error = 'The saved document could not be loaded. A sample is open; your saved data has not been overwritten.';
      }
      if (this.disposed) return;
      this.initialized = true;
      this.accept(result);
      this.status = 'Ready · local workspace';
      this.fit(); this.emit();
    } catch (error) { this.fail(error); }
  }
  private request<T = EngineResult>(type: EngineOperation, payload?: EnginePayload): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Editor closed'));
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      if (benchmarkEnabled() && payload !== undefined) {
        const encoded = new TextEncoder().encode(JSON.stringify(payload));
        recordPerformance({ name: 'editor.requestJsonBytes', value: encoded.byteLength, unit: 'bytes', detail: { command: type } });
      }
      this.requests.set(id, { resolve: resolve as (value: unknown) => void, reject, startedAt: performance.now(), type });
      this.worker.postMessage({ id, type, payload, benchmark: benchmarkEnabled() });
    });
  }
  private accept(result: EngineResult) {
    this.document = result.document; this.scene = result.scene;
    this.spatialIndex.update(this.document.nodes);
    this.canUndo = result.canUndo; this.canRedo = result.canRedo;
    const ids = new Set(this.document.nodes.map(node => node.id));
    this.selectedIds = new Set([...this.selectedIds].filter(id => ids.has(id)));
    if (!this.document.edges.some(edge => edge.id === this.selectedEdgeId)) this.selectedEdgeId = null;
    if (!this.document.nodes.some(node => node.id === this.sourceId)) { this.sourceId = null; this.renderer.setConnectSource(null); }
    this.renderer.setScene(this.scene, this.document);
    this.renderer.setSelection([...this.selectedIds]);
    this.renderer.setSelectedEdge(this.selectedEdgeId);
    this.renderer.setPreviews([]); this.renderer.setGuides([]); this.renderer.setMarquee(null);
    this.renderer.setPreview(null);
    this.emit();
  }
  private emit() {
    if (this.disposed) return;
    const selectedIds = this.selectedIds;
    this.options.onChange({ title: this.document.title, tool: this.tool, selected: this.selected, selectedEdge: this.selectedEdge, objects: this.document.nodes,
      connections: this.document.edges.filter(edge => selectedIds.has(edge.from) || selectedIds.has(edge.to)),
      nodeCount: this.document.nodes.length, edgeCount: this.document.edges.length,
      selectedCount: selectedIds.size, canGroup: selectedIds.size > 1 && !this.document.nodes.some(node => selectedIds.has(node.id) && node.locked) && new Set((this.document.nodes as GroupNode[]).filter(n => selectedIds.has(n.id)).map(n => n.groupId ?? n.id)).size > 1, canUngroup: [...selectedIds].some(id => { const node = this.document.nodes.find(n => n.id === id) as GroupNode | undefined; return Boolean(node?.groupId && !node.locked); }),
      documents: this.documents, activeDocumentId: this.activeDocumentId, documentBusy: this.documentBusy,
      drawingCharacter: this.drawingCharacter, zoom: this.renderer.camera.zoom, canUndo: this.canUndo, canRedo: this.canRedo, status: this.status, error: this.error });
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.status = 'Action could not be completed'; this.emit();
  }
  private get selected() { return this.selectedIds.size === 1 ? this.document.nodes.find(node => this.selectedIds.has(node.id)) ?? null : null; }
  private get selectedEdge() { return this.selectedEdgeId ? this.document.edges.find(edge => edge.id === this.selectedEdgeId) ?? null : null; }
  private setSelection(ids: Iterable<string>) { this.selectedEdgeId = null; this.selectedIds = new Set(ids); this.renderer.setSelection([...this.selectedIds]); this.renderer.setSelectedEdge(null); this.emit(); }
  private transact(change: (doc: DiagramDocument) => void) {
    if (!this.initialized || this.disposed || this.documentBusy) return;
    this.pendingCommands++;
    this.operationQueue = this.operationQueue.then(async () => {
      const next = clone(this.document); change(next);
      const patch = diffDocument(this.document, next);
      if (!Object.values(patch).some(value => Array.isArray(value) ? value.length > 0 : value !== undefined)) return;
      this.error = null; this.status = 'Saving…';
      const result = await this.request('patch', patch);
      this.accept(result); this.scheduleSave();
    }).catch(error => { this.renderer.setPreview(null); if (this.scene) this.renderer.setScene(this.scene, this.document); this.fail(error); }).finally(() => { this.pendingCommands--; });
  }
  private scheduleSave() {
    clearTimeout(this.saveTimer);
    const snapshot = clone(this.document), documentId = this.activeDocumentId;
    if (!documentId) return;
    this.saveTimer = setTimeout(() => { this.persist(documentId, snapshot); }, 250);
  }
  private persist(documentId: string, snapshot: DiagramDocument) {
    this.saveQueue = this.saveQueue.then(() => this.localDocuments.save(documentId, snapshot)).then(async () => {
      this.documents = await this.localDocuments.list(); this.status = 'Saved on this device'; this.emit();
    }).catch(() => { this.error = 'Autosave is unavailable. Use Save file to keep your diagram.'; this.emit(); });
    return this.saveQueue;
  }
  setTool(tool: Tool) {
    if (this.drag) this.pointerCancel();
    this.finishText(); this.tool = tool; this.sourceId = null; this.sourceSide = undefined; this.sourcePoint = undefined; this.sourcePreviewPoint = undefined; this.renderer.setConnectSource(null); this.renderer.setConnectHover(null); this.renderer.setLinePreview(null);
    this.canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    this.status = tool === 'line' ? 'Click or drag from a start point to an end point' : tool === 'select' ? 'Select and arrange objects' : tool === 'pan' ? 'Drag to pan the canvas' : tool === 'picker' ? 'Click a character to pick it' : tool === 'fill' ? 'Click a box to set its background fill' : `Drag to use the ${tool} tool`;
    this.emit();
  }
  setDrawingCharacter(value: string) {
    const character = Array.from(value)[0];
    if (!character || /[\n\r\t]/.test(character)) return;
    this.drawingCharacter = character; this.emit();
  }
  selectObject(id: string) { if (this.document.nodes.some(node => node.id === id)) this.setSelection([id]); }
  updateObject(id: string, patch: Partial<DiagramNode>) {
    this.transact(doc => { const node = doc.nodes.find(candidate => candidate.id === id); if (node) { const allowed = node.locked ? lockSafePatch(patch) : patch; Object.assign(node, allowed, { id: node.id }); if (!node.locked && affectsTextFit(allowed)) fitText(node); } });
  }
  reorderSelection(direction: 'front' | 'back' | 'forward' | 'backward') {
    const selected = new Set(this.selectedIds); if (!selected.size || this.document.nodes.some(node => selected.has(node.id) && node.locked)) return;
    this.transact(doc => {
      if (direction === 'front' || direction === 'back') {
        const moving = doc.nodes.filter(node => selected.has(node.id)), rest = doc.nodes.filter(node => !selected.has(node.id));
        doc.nodes = direction === 'front' ? [...rest, ...moving] : [...moving, ...rest]; return;
      }
      const start = direction === 'forward' ? doc.nodes.length - 2 : 1, end = direction === 'forward' ? -1 : doc.nodes.length, step = direction === 'forward' ? -1 : 1;
      for (let index = start; index !== end; index += step) {
        const next = index + (direction === 'forward' ? 1 : -1);
        if (selected.has(doc.nodes[index]!.id) && !selected.has(doc.nodes[next]!.id)) [doc.nodes[index], doc.nodes[next]] = [doc.nodes[next]!, doc.nodes[index]!];
      }
    });
  }
  showAllObjects() { this.transact(doc => { for (const node of doc.nodes) node.hidden = false; }); }
  addNode(kind: DiagramNode['kind']) {
    const center = this.renderer.screenToGrid(this.width / 2, this.height / 2);
    this.placeNode(kind, Math.round(center.x - 12), Math.round(center.y - 3));
  }
  private placeNode(kind: DiagramNode['kind'], x: number, y: number) {
    const id = uid();
    const label = { service: 'New service', database: 'Database', queue: 'Message queue', boundary: 'System boundary', rectangle: '', text: 'Add a note' }[kind] ?? '';
    const node: DiagramNode = { id, kind, label, x, y, width: kind === 'boundary' ? 42 : 24, height: kind === 'text' ? 2 : kind === 'boundary' ? 18 : 6 };
    fitText(node);
    this.selectedIds = new Set([id]);
    this.transact(doc => doc.nodes.push(node));
    this.setTool('select');
    if (kind === 'text') void this.operationQueue.then(() => {
      const accepted = this.document.nodes.find(n => n.id === id);
      if (accepted && this.selectedIds.has(id) && this.tool === 'select' && !this.disposed) this.editText(accepted);
    });
  }
  deleteSelection() {
    if (this.selectedEdgeId) { const id = this.selectedEdgeId; this.selectedEdgeId = null; this.transact(doc => { doc.edges = doc.edges.filter(edge => edge.id !== id); }); return; }
    const ids = new Set(this.document.nodes.filter(node => this.selectedIds.has(node.id) && !node.locked).map(node => node.id)); if (!ids.size) return;
    this.transact(doc => { doc.nodes = doc.nodes.filter(n => !ids.has(n.id)); doc.edges = doc.edges.filter(e => !ids.has(e.from) && !ids.has(e.to)); });
  }
  duplicateSelection() {
    if (this.selectedEdge) {
      const source = clone(this.selectedEdge), copy = { ...source, id: uid() };
      if (copy.fromPoint) copy.fromPoint = { x: copy.fromPoint.x + 2, y: copy.fromPoint.y + 1 };
      if (copy.toPoint) copy.toPoint = { x: copy.toPoint.x + 2, y: copy.toPoint.y + 1 };
      this.selectedEdgeId = copy.id; this.transact(doc => doc.edges.push(copy)); return;
    }
    if (!this.selectedIds.size || this.document.nodes.some(node => this.selectedIds.has(node.id) && node.locked)) return;
    const ids = new Set(this.selectedIds), idMap = new Map<string, string>(), groupMap = new Map<string, string>();
    for (const id of ids) idMap.set(id, uid());
    const copies = this.document.nodes.filter(n => ids.has(n.id)).map(node => {
      const copy: GroupNode = { ...node, id: idMap.get(node.id)!, x: node.x + 4, y: node.y + 3 };
      const groupId = (node as GroupNode).groupId;
      if (groupId) { if (!groupMap.has(groupId)) groupMap.set(groupId, uid()); copy.groupId = groupMap.get(groupId); }
      return copy;
    });
    const edges = this.document.edges.filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({ ...e, id: uid(), from: idMap.get(e.from)!, to: idMap.get(e.to)! }));
    this.selectedIds = new Set(copies.map(n => n.id)); this.transact(doc => { doc.nodes.push(...copies); doc.edges.push(...edges); });
  }
  updateSelected(patch: Partial<DiagramNode>) {
    const id = this.selected?.id;
    this.transact(doc => { const node = doc.nodes.find(n => n.id === id); if (node) { const allowed = node.locked ? lockSafePatch(patch) : patch; Object.assign(node, allowed, { id: node.id }); if (!node.locked && affectsTextFit(allowed)) fitText(node); } });
  }
  updateSelectedEdge(patch: Partial<DiagramEdge>) {
    const id = this.selectedEdgeId; if (!id) return;
    this.transact(doc => { const edge = doc.edges.find(candidate => candidate.id === id); if (edge) Object.assign(edge, patch, { id: edge.id }); });
  }
  groupSelection() {
    if (this.selectedIds.size < 2 || this.document.nodes.some(node => this.selectedIds.has(node.id) && node.locked)) return;
    const currentGroups = new Set((this.document.nodes as GroupNode[]).filter(n => this.selectedIds.has(n.id)).map(n => n.groupId ?? n.id));
    if (currentGroups.size < 2) return;
    const ids = new Set(this.selectedIds), groupId = uid();
    this.transact(doc => { for (const node of doc.nodes as GroupNode[]) if (ids.has(node.id) && !node.locked) node.groupId = groupId; });
  }
  ungroupSelection() {
    if (!this.selectedIds.size) return;
    const selected = new Set(this.selectedIds);
    const groupIds = new Set((this.document.nodes as GroupNode[]).filter(n => selected.has(n.id) && n.groupId).map(n => n.groupId!));
    if (!groupIds.size) return;
    this.transact(doc => { for (const node of doc.nodes as GroupNode[]) if (!node.locked && node.groupId && groupIds.has(node.groupId)) delete node.groupId; });
  }
  alignSelection(alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const nodes = this.document.nodes.filter(n => this.selectedIds.has(n.id) && !n.locked && !n.hidden); if (nodes.length < 2) return;
    const grouped = new Map<string, DiagramNode[]>();
    for (const node of nodes) { const key = (node as GroupNode).groupId ?? `node:${node.id}`; grouped.set(key, [...(grouped.get(key) ?? []), node]); }
    const units = [...grouped.values()]; if (units.length < 2) return;
    const bounds = units.map(members => ({ members, left: Math.min(...members.map(n => n.x)), right: Math.max(...members.map(n => n.x + n.width)), top: Math.min(...members.map(n => n.y)), bottom: Math.max(...members.map(n => n.y + n.height)) }));
    const left = Math.min(...bounds.map(b => b.left)), right = Math.max(...bounds.map(b => b.right));
    const top = Math.min(...bounds.map(b => b.top)), bottom = Math.max(...bounds.map(b => b.bottom));
    const offsets = new Map<string, { x: number; y: number }>();
    for (const unit of bounds) {
      let x = 0, y = 0;
      if (alignment === 'left') x = left - unit.left;
      else if (alignment === 'center') x = Math.round((left + right - unit.left - unit.right) / 2);
      else if (alignment === 'right') x = right - unit.right;
      else if (alignment === 'top') y = top - unit.top;
      else if (alignment === 'middle') y = Math.round((top + bottom - unit.top - unit.bottom) / 2);
      else y = bottom - unit.bottom;
      for (const node of unit.members) offsets.set(node.id, { x, y });
    }
    this.transact(doc => { for (const node of doc.nodes) { const offset = offsets.get(node.id); if (offset) { node.x += offset.x; node.y += offset.y; } } });
  }
  updateEdge(id: string, label: string) { this.transact(doc => { const edge = doc.edges.find(e => e.id === id); if (edge) edge.label = label; }); }
  deleteEdge(id: string) { this.transact(doc => { doc.edges = doc.edges.filter(e => e.id !== id); }); }
  setTitle(title: string) { this.transact(doc => { doc.title = title.trim() || 'Untitled diagram'; }); }
  undo() { this.history('undo'); }
  redo() { this.history('redo'); }
  private history(type: 'undo' | 'redo') {
    if (this.drag) this.pointerCancel();
    if (!this.initialized) return;
    this.pendingCommands++;
    this.operationQueue = this.operationQueue.then(async () => {
      this.accept(await this.request(type)); this.scheduleSave();
    }).catch(error => this.fail(error)).finally(() => { this.pendingCommands--; });
  }
  fit() {
    this.autoFit = true;
    if (!this.scene) return;
    if (!this.document.nodes.length) {
      this.renderer.setCamera({ x: this.width / 2, y: this.height / 2, zoom: 1 }); this.emit(); return;
    }
    const b = this.scene.bounds;
    const zoom = Math.min(1.25, Math.max(0.15, Math.min((this.width - 150) / (Math.max(b.width, 1) * CELL_WIDTH), (this.height - 180) / (Math.max(b.height, 1) * CELL_HEIGHT))));
    this.renderer.setCamera({ x: (this.width - b.width * CELL_WIDTH * zoom) / 2 - b.x * CELL_WIDTH * zoom, y: (this.height - b.height * CELL_HEIGHT * zoom) / 2 - b.y * CELL_HEIGHT * zoom, zoom }); this.emit();
  }
  zoomBy(factor: number) { this.zoomAt(factor, this.width / 2, this.height / 2); }
  private zoomAt(factor: number, x: number, y: number) {
    this.autoFit = false;
    this.renderer.markInput('zoom');
    const c = this.renderer.camera; const zoom = Math.max(0.15, Math.min(3, c.zoom * factor));
    this.renderer.setCamera({ x: x - (x - c.x) * zoom / c.zoom, y: y - (y - c.y) * zoom / c.zoom, zoom }); this.emit();
  }
  newDocument() {
    const blank: DiagramDocument = { version: 1, title: 'Untitled diagram', nodes: [], edges: [] };
    return this.createAndOpen(blank);
  }
  openDocument(id: string) {
    if (!id || id === this.activeDocumentId) return;
    this.finishText();
    return this.enqueueDocumentOperation(async () => {
      const candidate = await this.localDocuments.get(id);
      if (!candidate) throw new Error('That local document is no longer available.');
      await this.flushCurrentDocument();
      await this.request('preview', candidate);
      const previousId = this.activeDocumentId;
      await this.localDocuments.setActive(id);
      try { this.activateDocument(id, await this.request('init', candidate)); }
      catch (error) { await this.localDocuments.setActive(previousId); throw error; }
    });
  }
  deleteDocument(id: string) {
    if (!id) return;
    this.pointerCancel(); this.finishText();
    return this.enqueueDocumentOperation(async () => {
      clearTimeout(this.saveTimer); this.saveTimer = undefined;
      await this.saveQueue;
      if (id !== this.activeDocumentId) await this.flushCurrentDocument();
      const blank: DiagramDocument = { version: 1, title: 'Untitled diagram', nodes: [], edges: [] };
      const removed = await this.localDocuments.remove(id, blank);
      this.documents = removed.documents;
      if (!removed.activeChanged) { this.emit(); return; }
      let activeId = removed.activeId, document = removed.document;
      try { await this.request('preview', document); }
      catch {
        activeId = await this.localDocuments.create(blank); document = blank;
        await this.localDocuments.setActive(activeId); this.documents = await this.localDocuments.list();
      }
      this.activateDocument(activeId, await this.request('init', document));
    });
  }
  async loadFile(file: File) {
    try {
      if (file.size > 5_000_000) throw new Error('Please choose a diagram smaller than 5 MB.');
      const contents = await file.text();
      const lowerName = file.name.toLowerCase(), plainText = lowerName.endsWith('.txt') || (file.type === 'text/plain' && !lowerName.endsWith('.mso') && !lowerName.endsWith('.json'));
      const parsed = plainText ? this.textDocument(contents, file.name.replace(/\.txt$/i, '') || 'Imported text') : JSON.parse(contents) as DiagramDocument;
      if (!this.initialized) throw new Error('The engine is still loading.');
      await this.createAndOpen(parsed);
    } catch (error) { this.fail(error); }
  }
  private textDocument(label: string, title: string): DiagramDocument {
    const node: DiagramNode = { id: uid(), kind: 'text', label, x: 0, y: 0, width: 1, height: 1, textAlign: 'left', verticalAlign: 'top', padding: 0, wrap: false };
    fitText(node); return { version: 2, title, nodes: [node], edges: [] };
  }
  private createAndOpen(document: DiagramDocument) {
    this.finishText();
    return this.enqueueDocumentOperation(async () => {
      const validated = await this.request('preview', document) as Pick<EngineResult, 'document'>;
      await this.flushCurrentDocument();
      const id = await this.localDocuments.create(validated.document);
      const previousId = this.activeDocumentId;
      try {
        await this.localDocuments.setActive(id);
        this.activateDocument(id, await this.request('init', validated.document));
      } catch (error) {
        if (previousId) await this.localDocuments.setActive(previousId);
        throw error;
      }
    });
  }
  private enqueueDocumentOperation(action: () => Promise<void>) {
    this.documentOperations++; this.documentBusy = true; this.emit();
    const result = this.operationQueue.then(action);
    this.operationQueue = result.catch(error => this.fail(error)).finally(() => {
      this.documentOperations--; this.documentBusy = this.documentOperations > 0; this.emit();
    });
    return result;
  }
  private async flushCurrentDocument() {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    await this.saveQueue;
    if (this.activeDocumentId) await this.localDocuments.save(this.activeDocumentId, clone(this.document));
  }
  private activateDocument(id: string, result: EngineResult) {
    this.pointerCancel(); this.textId = null; this.textarea.style.display = 'none';
    this.tool = 'select'; this.spaceDown = false; this.sourceId = null; this.sourceSide = undefined;
    this.renderer.setConnectSource(null); this.renderer.setConnectHover(null); this.canvas.style.cursor = 'default';
    this.activeDocumentId = id; this.selectedIds.clear(); this.error = null; this.accept(result);
    void this.localDocuments.list().then(documents => { this.documents = documents; this.emit(); }).catch(() => {
      this.error = 'The document opened, but the local document list could not be refreshed.'; this.emit();
    });
    this.status = 'Ready · local workspace'; this.fit();
  }
  async saveFile() {
    this.finishText();
    await this.operationQueue;
    this.download(JSON.stringify(this.document, null, 2) + '\n', 'mso', 'application/json');
  }
  async exportFile(format: 'unicode' | 'ascii' | 'svg' | 'png') {
    try { this.finishText(); await this.operationQueue; const sourceFormat = format === 'png' ? 'svg' : format; const text = await this.request<string>('export', sourceFormat); const output = format === 'png' ? await svgToPng(text) : text; this.download(output, format === 'unicode' || format === 'ascii' ? 'txt' : format, format === 'png' ? 'image/png' : format === 'svg' ? 'image/svg+xml' : 'text/plain'); }
    catch (error) { this.fail(error); }
  }
  async copyText() {
    try { this.finishText(); await this.operationQueue; const text = await this.request<string>('export', 'unicode'); await navigator.clipboard.writeText(text); this.status = 'Diagram copied as Unicode text'; this.emit(); }
    catch (error) { this.fail(error); }
  }
  private download(content: string | Blob, extension: string, mime: string) {
    const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type: mime }) : content);
    const link = document.createElement('a'); link.href = url; link.download = (this.document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'diagram') + '.' + extension;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status = 'Exported ' + link.download; this.emit();
  }
  private local(event: MouseEvent) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private hit(x: number, y: number) {
    // Foreground objects take precedence over larger boundary containers.
    const matches = this.spatialIndex.at(x, y).filter(node => !node.hidden);
    return matches.find(n => n.kind !== 'boundary') ?? matches.find(n => n.kind === 'boundary');
  }
  private hitEdge(x: number, y: number) {
    if (!this.scene) return undefined;
    const tolerance = 6 / Math.max(.1, this.renderer.camera.zoom);
    let best: { edge: DiagramEdge; distance: number } | undefined;
    for (const route of this.scene.routes) {
      const edge = this.document.edges.find(candidate => candidate.id === route.id); if (!edge) continue;
      for (let index = 1; index < route.points.length; index++) {
        const a = route.points[index - 1]!, b = route.points[index]!;
        const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
        const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
        const distance = Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
        if (distance <= tolerance / Math.min(CELL_WIDTH, CELL_HEIGHT) && (!best || distance < best.distance)) best = { edge, distance };
      }
    }
    return best?.edge;
  }
  private connectionSide(node: DiagramNode, x: number, y: number): ConnectionSide | undefined {
    const z = this.renderer.camera.zoom;
    const distances: Array<[ConnectionSide, number]> = [
      ['left', Math.abs(x - node.x - .5) * CELL_WIDTH * z],
      ['right', Math.abs(x - node.x - node.width + .5) * CELL_WIDTH * z],
      ['top', Math.abs(y - node.y - .5) * CELL_HEIGHT * z],
      ['bottom', Math.abs(y - node.y - node.height + .5) * CELL_HEIGHT * z],
    ];
    distances.sort((a, b) => a[1] - b[1]);
    // Center clicks retain automatic routing, even at small zoom levels.
    const threshold = Math.min(10, (node.width - 1) * CELL_WIDTH * z / 4, (node.height - 1) * CELL_HEIGHT * z / 4);
    return distances[0][1] <= threshold ? distances[0][0] : undefined;
  }
  private resizeHandle(node: DiagramNode, x: number, y: number): ResizeHandle | undefined {
    if (!canResize(node) || node.locked || node.hidden) return undefined;
    const left = node.x + .5, right = node.x + node.width - .5, top = node.y + .5, bottom = node.y + node.height - .5;
    const centerX = (left + right) / 2, centerY = (top + bottom) / 2, zoom = this.renderer.camera.zoom;
    const candidates: Array<[ResizeHandle, number, number]> = [['nw', left, top], ['n', centerX, top], ['ne', right, top], ['e', right, centerY], ['se', right, bottom], ['s', centerX, bottom], ['sw', left, bottom], ['w', left, centerY]];
    return candidates.map(([handle, hx, hy]) => [handle, Math.hypot((x - hx) * CELL_WIDTH * zoom, (y - hy) * CELL_HEIGHT * zoom)] as const).sort((a, b) => a[1] - b[1]).find(candidate => candidate[1] <= 8)?.[0];
  }
  private resizedNode(drag: Extract<Drag, { mode: 'resize' }>) {
    const node = { ...drag.node }, minimum = minimumSize(node), west = drag.handle.includes('w'), east = drag.handle.includes('e'), north = drag.handle.includes('n'), south = drag.handle.includes('s');
    if (west) { const dx = Math.min(drag.dx, node.width - minimum.width); node.x += dx; node.width -= dx; }
    if (east) node.width = Math.max(minimum.width, node.width + drag.dx);
    if (north) { const dy = Math.min(drag.dy, node.height - minimum.height); node.y += dy; node.height -= dy; }
    if (south) node.height = Math.max(minimum.height, node.height + drag.dy);
    return node;
  }
  private pointerDown = (event: PointerEvent) => {
    if (!this.initialized || this.documentBusy || (event.button !== 0 && event.button !== 1)) return;
    this.finishText(); this.canvas.focus();
    const p = this.local(event); const g = this.renderer.screenToGrid(p.x, p.y); const c = this.renderer.camera;
    this.canvas.setPointerCapture(event.pointerId);
    if (this.tool === 'pan' || this.spaceDown || event.button === 1) {
      event.preventDefault(); this.drag = { mode: 'pan', startX: p.x, startY: p.y, initialX: c.x, initialY: c.y }; return;
    }
    if (this.pendingCommands) return;
    const cell = { x: Math.round(g.x), y: Math.round(g.y) };
    if (this.tool === 'rectangle' || this.tool === 'text') {
      this.drag = { mode: 'create', tool: this.tool, startX: cell.x, startY: cell.y, currentX: cell.x, currentY: cell.y }; return;
    }
    if (this.tool === 'pencil' || this.tool === 'eraser') {
      this.drag = { mode: 'draw', tool: this.tool, points: [cell], last: cell }; return;
    }
    if (this.tool === 'picker') { this.pickCharacter(cell); return; }
    if (this.tool === 'fill') { this.fillArea(cell); return; }
    if (this.tool === 'select' && this.selectedEdgeId) {
      const selectedRoute = this.scene?.routes.find(route => route.id === this.selectedEdgeId), first = selectedRoute?.points[0], last = selectedRoute?.points.at(-1), selectedEdge = this.selectedEdge;
      const endpoint = first && Math.hypot(g.x - first.x, g.y - first.y) <= 1 ? 'from' : last && Math.hypot(g.x - last.x, g.y - last.y) <= 1 ? 'to' : undefined;
      if (endpoint && first && last && selectedEdge) { this.drag = { mode: 'edge-endpoint', edge: clone(selectedEdge), endpoint, fixed: endpoint === 'from' ? last : first, current: cell }; return; }
    }
    const node = this.hit(g.x, g.y);
    if (this.tool === 'line') {
      if (this.sourceId === null && !this.sourcePoint) {
        this.sourceId = node?.id ?? '';
        this.sourceSide = node ? this.connectionSide(node, g.x, g.y) : undefined;
        this.sourcePoint = node ? undefined : cell;
        this.sourcePreviewPoint = cell;
        this.drag = { mode: 'create-line', startScreenX: p.x, startScreenY: p.y, from: cell, current: cell };
        this.renderer.setConnectSource(node?.id ?? null); this.status = 'Now click the end point'; this.emit();
      } else {
        const from = this.sourceId ?? '', to = node?.id ?? '';
        const edge: DiagramEdge = { id: uid(), from, to, label: '', fromSide: this.sourceSide, toSide: node ? this.connectionSide(node, g.x, g.y) : undefined,
          fromPoint: from ? undefined : this.sourcePoint, toPoint: to ? undefined : cell, startArrow: 'none', endArrow: 'arrow', lineStyle: 'solid', routing: 'orthogonal' };
        this.selectedEdgeId = edge.id; this.selectedIds.clear(); this.transact(doc => { doc.edges.push(edge); });
        this.setTool('select');
      }
      return;
    }
    if (this.tool !== 'select') return;
    if (!node) {
      const edge = this.hitEdge(g.x, g.y);
      if (edge) {
        this.selectedIds.clear(); this.selectedEdgeId = edge.id; this.renderer.setSelection([]); this.renderer.setSelectedEdge(edge.id); this.emit();
        const route = this.scene?.routes.find(candidate => candidate.id === edge.id), first = route?.points[0], last = route?.points.at(-1);
        const endpoint = first && Math.hypot(g.x - first.x, g.y - first.y) <= 1 ? 'from' : last && Math.hypot(g.x - last.x, g.y - last.y) <= 1 ? 'to' : undefined;
        if (endpoint && first && last) this.drag = { mode: 'edge-endpoint', edge: clone(edge), endpoint, fixed: endpoint === 'from' ? last : first, current: cell };
        else if (edge.fromPoint && edge.toPoint) this.drag = { mode: 'move-edge', edge: clone(edge), startX: p.x, startY: p.y, dx: 0, dy: 0 };
        return;
      }
      this.drag = { mode: 'marquee', startX: g.x, startY: g.y, currentX: g.x, currentY: g.y, additive: event.shiftKey, initialSelection: new Set(this.selectedIds) };
      if (!event.shiftKey) this.setSelection([]);
      return;
    }
    const groupId = (node as GroupNode).groupId;
    const targetIds = groupId && !(event.metaKey || event.ctrlKey) ? (this.document.nodes as GroupNode[]).filter(n => n.groupId === groupId).map(n => n.id) : [node.id];
    if (event.shiftKey) {
      const next = new Set(this.selectedIds), remove = targetIds.every(id => next.has(id));
      for (const id of targetIds) remove ? next.delete(id) : next.add(id);
      this.setSelection(next);
      if (remove && !this.selectedIds.size) return;
    } else if (!this.selectedIds.has(node.id) || (event.metaKey || event.ctrlKey)) this.setSelection(targetIds);
    else if (targetIds.some(id => !this.selectedIds.has(id))) this.setSelection([...this.selectedIds, ...targetIds]);
    const resize = this.selectedIds.size === 1 ? this.resizeHandle(node, g.x, g.y) : undefined;
    if (resize) this.drag = { mode: 'resize', startX: p.x, startY: p.y, node: clone(node), handle: resize, dx: 0, dy: 0 };
    else {
      const nodes = this.document.nodes.filter(n => this.selectedIds.has(n.id) && !n.locked && !n.hidden).map(clone);
      if (!nodes.length) return;
      this.drag = { mode: 'move', startX: p.x, startY: p.y, nodes, origins: nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), dx: 0, dy: 0 };
    }
  };
  private pointerMove = (event: PointerEvent) => {
    const d = this.drag;
    if (!d) {
      if (this.tool === 'line') {
        const p = this.local(event), g = this.renderer.screenToGrid(p.x, p.y), node = this.hit(g.x, g.y);
        this.renderer.setConnectHover(node?.id ?? null, node ? this.connectionSide(node, g.x, g.y) : undefined);
        if ((this.sourceId !== null || this.sourcePoint) && this.sourcePreviewPoint) this.renderer.setLinePreview({ from: this.sourcePreviewPoint, to: { x: Math.round(g.x), y: Math.round(g.y) } });
      }
      if (this.tool === 'select') {
        const p = this.local(event), g = this.renderer.screenToGrid(p.x, p.y), node = this.hit(g.x, g.y);
        const resize = node && this.selectedIds.size === 1 && this.selectedIds.has(node.id) ? this.resizeHandle(node, g.x, g.y) : undefined;
        const cursors: Record<ResizeHandle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
        this.canvas.style.cursor = resize ? cursors[resize] : node && !node.locked ? 'move' : 'default';
      }
      return;
    }
    const p = this.local(event); const c = this.renderer.camera;
    if (d.mode === 'pan') {
      this.autoFit = false;
      this.renderer.markInput('pan');
      this.renderer.setCamera({ ...c, x: d.initialX + p.x - d.startX, y: d.initialY + p.y - d.startY }); return;
    }
    if (d.mode === 'marquee') {
      const g = this.renderer.screenToGrid(p.x, p.y); d.currentX = g.x; d.currentY = g.y;
      const distance = Math.hypot((g.x - d.startX) * CELL_WIDTH * c.zoom, (g.y - d.startY) * CELL_HEIGHT * c.zoom);
      if (distance < 4) {
        const next = d.additive ? new Set(d.initialSelection) : new Set<string>();
        if (next.size !== this.selectedIds.size || [...next].some(id => !this.selectedIds.has(id))) { this.selectedIds = next; this.renderer.setSelection([...next]); this.emit(); }
        this.renderer.setMarquee(null); return;
      }
      const left = Math.min(d.startX, g.x), top = Math.min(d.startY, g.y), right = Math.max(d.startX, g.x), bottom = Math.max(d.startY, g.y);
      const raw = this.document.nodes.filter(n => !n.hidden && n.x < right && n.x + n.width > left && n.y < bottom && n.y + n.height > top);
      const groups = new Set(raw.map(n => (n as GroupNode).groupId).filter((id): id is string => Boolean(id)));
      const hit = this.document.nodes.filter(n => raw.includes(n) || Boolean((n as GroupNode).groupId && groups.has((n as GroupNode).groupId!))).map(n => n.id);
      const next = new Set(d.additive ? [...d.initialSelection, ...hit] : hit);
      if (next.size !== this.selectedIds.size || [...next].some(id => !this.selectedIds.has(id))) { this.selectedIds = next; this.renderer.setSelection([...next]); this.emit(); }
      this.renderer.setMarquee({ x: left, y: top, width: right - left, height: bottom - top }); return;
    }
    if (d.mode === 'create') {
      const g = this.renderer.screenToGrid(p.x, p.y); d.currentX = Math.round(g.x); d.currentY = Math.round(g.y);
      const node = this.createdNode(d, false); this.renderer.setPreview({ node, dx: 0, dy: 0 }); return;
    }
    if (d.mode === 'draw') {
      const g = this.renderer.screenToGrid(p.x, p.y), next = { x: Math.round(g.x), y: Math.round(g.y) };
      if (next.x !== d.last.x || next.y !== d.last.y) {
        for (const point of this.gridLine(d.last, next).slice(1)) { if (d.points.length >= 10_000) break; d.points.push(point); }
        d.last = next;
      }
      if (d.tool === 'pencil') this.renderer.setPreviews(this.drawingNodes(d.points, '__drawing_preview__').map(node => ({ node, dx: 0, dy: 0 })));
      return;
    }
    if (d.mode === 'create-line') {
      const g = this.renderer.screenToGrid(p.x, p.y); d.current = { x: Math.round(g.x), y: Math.round(g.y) };
      this.renderer.setLinePreview({ from: d.from, to: d.current }); return;
    }
    if (d.mode === 'edge-endpoint') {
      const g = this.renderer.screenToGrid(p.x, p.y); d.current = { x: Math.round(g.x), y: Math.round(g.y) };
      this.renderer.setLinePreview(d.endpoint === 'from' ? { from: d.current, to: d.fixed } : { from: d.fixed, to: d.current });
      const node = this.hit(g.x, g.y); this.renderer.setConnectHover(node?.id ?? null, node ? this.connectionSide(node, g.x, g.y) : undefined); return;
    }
    if (d.mode === 'move-edge') {
      d.dx = Math.round((p.x - d.startX) / (CELL_WIDTH * c.zoom)); d.dy = Math.round((p.y - d.startY) / (CELL_HEIGHT * c.zoom)); return;
    }
    d.dx = Math.round((p.x - d.startX) / (CELL_WIDTH * c.zoom));
    d.dy = Math.round((p.y - d.startY) / (CELL_HEIGHT * c.zoom));
    let constrainedAxis: 'x' | 'y' | undefined;
    if (event.shiftKey && d.mode === 'move') { constrainedAxis = Math.abs(d.dx) > Math.abs(d.dy) ? 'x' : 'y'; if (constrainedAxis === 'x') d.dy = 0; else d.dx = 0; }
    this.renderer.setGuides([]); if (d.mode === 'move' && !event.altKey) this.snapMove(d, constrainedAxis);
    if (d.mode === 'move') this.renderer.setPreviews(d.nodes.map(node => ({ node, dx: d.dx, dy: d.dy })));
    else this.renderer.setPreview({ node: this.resizedNode(d), dx: 0, dy: 0 });
    this.previewRevision++; this.schedulePreview();
  };
  private snapMove(d: Extract<Drag, { mode: 'move' }>, constrainedAxis?: 'x' | 'y') {
    const moving = new Set(d.nodes.map(n => n.id));
    const others = this.document.nodes.filter(n => !moving.has(n.id));
    const anchors = (node: DiagramNode, axis: 'x' | 'y', delta = 0) => axis === 'x'
      ? [node.x + delta, node.x + delta + (node.width - 1) / 2, node.x + delta + node.width - 1]
      : [node.y + delta, node.y + delta + (node.height - 1) / 2, node.y + delta + node.height - 1];
    const match = (axis: 'x' | 'y') => {
      const targets = new Map<number, { value: number; node: DiagramNode }>();
      for (const node of others) for (const value of anchors(node, axis)) targets.set(value * 2, { value, node });
      for (const offset of [0, -2, 2]) for (const node of d.nodes) for (const value of anchors(node, axis, axis === 'x' ? d.dx : d.dy)) {
        { const target = targets.get(value * 2 + offset); if (target) return { delta: offset / 2, ...target }; }
      }
    };
    const sx = constrainedAxis === 'y' ? undefined : match('x'), sy = constrainedAxis === 'x' ? undefined : match('y'); if (sx) d.dx += sx.delta; if (sy) d.dy += sy.delta;
    const movedLeft = Math.min(...d.nodes.map(n => n.x + d.dx)), movedRight = Math.max(...d.nodes.map(n => n.x + d.dx + n.width));
    const movedTop = Math.min(...d.nodes.map(n => n.y + d.dy)), movedBottom = Math.max(...d.nodes.map(n => n.y + d.dy + n.height));
    this.renderer.setGuides([...(sx ? [{ axis: 'x' as const, value: sx.value, from: Math.min(movedTop, sx.node.y), to: Math.max(movedBottom, sx.node.y + sx.node.height) }] : []), ...(sy ? [{ axis: 'y' as const, value: sy.value, from: Math.min(movedLeft, sy.node.x), to: Math.max(movedRight, sy.node.x + sy.node.width) }] : [])]);
  }
  // Coalesce temporary routing requests to at most 20 Hz with one in flight.
  // Accepted document/history never change until the pointer is released.
  private schedulePreview() {
    if (this.previewTimer || this.previewBusy || !this.drag || !['move', 'resize'].includes(this.drag.mode)) return;
    this.previewTimer = setTimeout(async () => {
      this.previewTimer = undefined;
      const drag = this.drag; if (!drag || (drag.mode !== 'move' && drag.mode !== 'resize') || this.previewBusy) return;
      const revision = this.previewRevision;
      const changed = new Map<string, DiagramNode>();
      if (drag.mode === 'move') {
        for (const node of drag.nodes) changed.set(node.id, { ...node, x: node.x + drag.dx, y: node.y + drag.dy });
      } else {
        const node = this.resizedNode(drag); changed.set(node.id, node);
      }
      // Share untouched entities locally; only the changed nodes cross the worker
      // boundary. Rust validates this temporary patch without touching history.
      const doc = { ...this.document, nodes: this.document.nodes.map(node => changed.get(node.id) ?? node) };
      this.previewBusy = true;
      try {
        const result = await this.request<Pick<EngineResult, 'scene'>>('previewPatch', { updatedNodes: [...changed.values()] });
        if (this.drag === drag && this.previewRevision === revision) {
          // Keep the pointer preview for the whole gesture. Clearing it here
          // alternates the plain preview and selected scene on every worker reply.
          this.renderer.setScene(result.scene, doc);
        }
      } catch { /* Invalid out-of-bounds previews are rejected at commit as well. */ }
      finally { this.previewBusy = false; if (this.drag === drag && this.previewRevision !== revision) this.schedulePreview(); }
    }, 50);
  }
  private pointerUp = (event: PointerEvent) => {
    const d = this.drag; this.drag = null; clearTimeout(this.previewTimer); this.previewTimer = undefined;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.renderer.setMarquee(null); this.renderer.setGuides([]); this.renderer.setPreviews([]); this.renderer.setLinePreview(null);
    if (!d || d.mode === 'pan' || d.mode === 'marquee') { this.renderer.setPreview(null); if (this.scene) this.renderer.setScene(this.scene, this.document); return; }
    if (d.mode === 'create') {
      const node = this.createdNode(d, true); this.selectedIds = new Set([node.id]); this.selectedEdgeId = null;
      this.transact(doc => doc.nodes.push(node)); this.setTool('select');
      if (node.kind === 'text') void this.operationQueue.then(() => { const accepted = this.document.nodes.find(n => n.id === node.id); if (accepted) this.editText(accepted); });
      return;
    }
    if (d.mode === 'draw') { this.commitDrawing(d.tool, d.points); return; }
    if (d.mode === 'create-line') {
      if (Math.hypot(event.offsetX - d.startScreenX, event.offsetY - d.startScreenY) < 4) return;
      const node = this.hit(d.current.x, d.current.y), from = this.sourceId ?? '', to = node?.id ?? '';
      const edge: DiagramEdge = { id: uid(), from, to, label: '', fromSide: this.sourceSide, toSide: node ? this.connectionSide(node, d.current.x, d.current.y) : undefined,
        fromPoint: from ? undefined : this.sourcePoint, toPoint: to ? undefined : d.current, startArrow: 'none', endArrow: 'arrow', lineStyle: 'solid', routing: 'orthogonal' };
      this.selectedEdgeId = edge.id; this.selectedIds.clear(); this.transact(doc => doc.edges.push(edge)); this.setTool('select'); return;
    }
    if (d.mode === 'edge-endpoint') {
      const node = this.hit(d.current.x, d.current.y), side = node ? this.connectionSide(node, d.current.x, d.current.y) : null;
      this.updateSelectedEdge(d.endpoint === 'from' ? { from: node?.id ?? '', fromSide: side, fromPoint: node ? null : d.current } : { to: node?.id ?? '', toSide: side, toPoint: node ? null : d.current });
      this.renderer.setConnectHover(null); return;
    }
    if (d.mode === 'move-edge') {
      if (d.dx || d.dy) this.updateSelectedEdge({ fromPoint: { x: d.edge.fromPoint!.x + d.dx, y: d.edge.fromPoint!.y + d.dy }, toPoint: { x: d.edge.toPoint!.x + d.dx, y: d.edge.toPoint!.y + d.dy } });
      return;
    }
    if (!d.dx && !d.dy) { this.renderer.setPreview(null); if (this.scene) this.renderer.setScene(this.scene, this.document); return; }
    this.transact(doc => {
      if (d.mode === 'move') for (const origin of d.origins) { const node = doc.nodes.find(n => n.id === origin.id); if (node) { node.x = origin.x + d.dx; node.y = origin.y + d.dy; } }
      else { const index = doc.nodes.findIndex(node => node.id === d.node.id); if (index >= 0) doc.nodes[index] = this.resizedNode(d); }
    });
  };
  private createdNode(drag: Extract<Drag, { mode: 'create' }>, committed: boolean): DiagramNode {
    const moved = drag.currentX !== drag.startX || drag.currentY !== drag.startY;
    const x = moved ? Math.min(drag.startX, drag.currentX) : drag.startX;
    const y = moved ? Math.min(drag.startY, drag.currentY) : drag.startY;
    const shape = drag.tool !== 'text', defaultWidth = shape ? 24 : 1;
    const defaultHeight = shape ? 6 : 1;
    const width = moved ? Math.max(shape ? 3 : 1, Math.abs(drag.currentX - drag.startX) + 1) : defaultWidth;
    const height = moved ? Math.max(shape ? 3 : 1, Math.abs(drag.currentY - drag.startY) + 1) : defaultHeight;
    return { id: committed ? uid() : '__create_preview__', kind: drag.tool, label: '', x, y, width, height,
      ...(shape ? { border: 'single' as const, textAlign: 'center' as const, verticalAlign: 'middle' as const, padding: 1, wrap: true, shadow: false } : { textAlign: 'left' as const, verticalAlign: 'top' as const, padding: 0, wrap: moved }) };
  }
  private gridLine(from: GridPoint, to: GridPoint) {
    const points: GridPoint[] = [], dx = Math.abs(to.x - from.x), dy = Math.abs(to.y - from.y);
    const sx = from.x < to.x ? 1 : -1, sy = from.y < to.y ? 1 : -1; let error = dx - dy, x = from.x, y = from.y;
    while (true) { points.push({ x, y }); if (x === to.x && y === to.y) break; const twice = error * 2; if (twice > -dy) { error -= dy; x += sx; } if (twice < dx) { error += dx; y += sy; } }
    return points;
  }
  private commitDrawing(tool: 'pencil' | 'eraser', input: GridPoint[]) {
    const unique = new Map(input.map(point => [`${point.x},${point.y}`, point])); if (!unique.size) return;
    this.transact(doc => {
      if (tool === 'eraser') {
        for (const node of doc.nodes.filter(node => node.kind === 'text' && !node.locked && !node.hidden && node.padding === 0 && node.textAlign === 'left' && node.verticalAlign === 'top' && node.wrap === false)) {
          const sourceRows = node.label.split('\n');
          const rows = Array.from({ length: node.height }, (_, row) => { const characters = Array.from(sourceRows[row] ?? ''); return characters.concat(Array(Math.max(0, node.width - characters.length)).fill(' ')); });
          let changed = false;
          for (const point of unique.values()) if (point.x >= node.x && point.x < node.x + node.width && point.y >= node.y && point.y < node.y + node.height) { rows[point.y - node.y]![point.x - node.x] = ' '; changed = true; }
          if (changed) node.label = rows.map(row => row.join('').replace(/ +$/u, '')).join('\n').replace(/\n+$/u, '');
        }
        doc.nodes = doc.nodes.filter(node => node.kind !== 'text' || node.label.length > 0);
        return;
      }
      doc.nodes.push(...this.drawingNodes([...unique.values()]));
    });
  }
  /** Compress painted cells into vertical stacks of equal horizontal runs.
   * This avoids both one node per cell and transparent-looking space glyphs
   * overwriting shapes that happen to sit beneath a sparse stroke. */
  private drawingNodes(points: GridPoint[], requestedGroupId?: string): DiagramNode[] {
    const byRow = new Map<number, number[]>();
    for (const point of points) byRow.set(point.y, [...(byRow.get(point.y) ?? []), point.x]);
    const runs: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (const [y, values] of [...byRow].sort((a, b) => a[0] - b[0])) {
      const xs = [...new Set(values)].sort((a, b) => a - b); let start = xs[0], previous = xs[0];
      for (const x of [...xs.slice(1), Number.POSITIVE_INFINITY]) {
        if (x === previous! + 1) { previous = x; continue; }
        const width = previous! - start! + 1;
        let prior: (typeof runs)[number] | undefined;
        for (let index = runs.length - 1; index >= 0; index--) { const run = runs[index]!; if (run.x === start && run.width === width && run.y + run.height === y) { prior = run; break; } }
        if (prior) prior.height++; else runs.push({ x: start!, y, width, height: 1 });
        start = x; previous = x;
      }
    }
    const groupId = requestedGroupId ?? uid();
    return runs.map(run => ({ id: uid(), groupId, kind: 'text', label: Array.from({ length: run.height }, () => this.drawingCharacter.repeat(run.width)).join('\n'), ...run, textAlign: 'left', verticalAlign: 'top', padding: 0, wrap: false }));
  }
  private pickCharacter(point: GridPoint) {
    const cell = this.scene?.displayCells.find(candidate => candidate.x === point.x && candidate.y === point.y);
    if (cell?.ch) this.setDrawingCharacter(cell.ch);
  }
  private fillArea(point: GridPoint) {
    // Fill belongs to the box, independently of labels and painted text above it.
    const node = this.spatialIndex.at(point.x, point.y).find(candidate => !candidate.hidden && candidate.kind !== 'text');
    if (!node || node.locked) {
      this.status = node?.locked ? 'Unlock this box before changing its fill' : 'Click a box to set its background fill';
      this.emit(); return;
    }
    this.setSelection([node.id]);
    const id = node.id, fill = this.drawingCharacter;
    if (node.fill === fill) return;
    this.transact(doc => {
      const box = doc.nodes.find(candidate => candidate.id === id);
      if (box && !box.locked && !box.hidden) box.fill = fill;
    });
  }
  private pointerCancel = () => { const drag = this.drag; this.drag = null; if (drag?.mode === 'marquee') { this.selectedIds = drag.initialSelection; this.renderer.setSelection([...this.selectedIds]); this.emit(); } clearTimeout(this.previewTimer); this.previewTimer = undefined; this.renderer.setPreview(null); this.renderer.setPreviews([]); this.renderer.setLinePreview(null); this.renderer.setMarquee(null); this.renderer.setGuides([]); if (this.scene) this.renderer.setScene(this.scene, this.document); };
  private doubleClick = (event: MouseEvent) => {
    if (this.tool !== 'select') return;
    const p = this.local(event); const g = this.renderer.screenToGrid(p.x, p.y); const node = this.hit(g.x, g.y);
    if (node) this.editText(node);
  };
  private editText(node: DiagramNode) {
    if (node.locked || node.hidden) return;
    this.selectedIds = new Set([node.id]); this.renderer.setSelection([node.id]); this.textId = node.id;
    this.textarea.value = node.label; this.layoutTextEditor();
    this.textarea.focus(); this.textarea.select(); this.emit();
  }
  private layoutTextEditor() {
    const node = this.document.nodes.find(n => n.id === this.textId);
    if (!node) return;
    const point = this.renderer.gridToScreen(node.x, node.y), zoom = this.renderer.camera.zoom;
    const note = node.kind === 'text';
    const draft = { ...node, label: this.textarea.value }; fitText(draft);
    const basePadding = (node.padding ?? (note ? 0 : 1)) * Math.min(CELL_WIDTH, CELL_HEIGHT) * zoom;
    const contentRows = Math.max(1, this.textarea.value.split('\n').length), contentHeight = contentRows * CELL_HEIGHT * zoom;
    const frameHeight = node.height * CELL_HEIGHT * zoom, remaining = Math.max(0, frameHeight - contentHeight - basePadding * 2);
    const verticalOffset = node.verticalAlign === 'bottom' ? remaining : node.verticalAlign === 'middle' ? remaining / 2 : 0;
    const padding = note ? basePadding : Math.max(6, basePadding);
    Object.assign(this.textarea.style, {
      display: 'block', left: point.x - (note ? 1 : 0) + 'px', top: point.y - (note ? 1 : 0) + 'px',
      width: Math.max(note ? 40 : 120, (note ? draft.width : node.width) * CELL_WIDTH * zoom + (note ? 2 : 0)) + 'px',
      height: Math.max(note ? CELL_HEIGHT * zoom + 2 : 60, (note ? draft.height : node.height) * CELL_HEIGHT * zoom + (note ? 2 : 0)) + 'px',
      fontSize: (note ? 14 * zoom : Math.max(11, 13 * zoom)) + 'px',
      lineHeight: CELL_HEIGHT * zoom + 'px', letterSpacing: note ? 0.6 * zoom + 'px' : 'normal',
      padding: `${padding + verticalOffset}px ${padding}px ${padding}px`, textAlign: node.textAlign ?? (note ? 'left' : 'center'), borderRadius: note ? '4px' : '8px', overflow: note && !node.wrap ? 'hidden' : 'auto',
    });
    this.textarea.wrap = node.wrap ? 'soft' : 'off';
  }
  private finishText() {
    if (!this.textId) return;
    const id = this.textId; const label = this.textarea.value;
    this.textId = null; this.textarea.style.display = 'none';
    this.transact(doc => { const node = doc.nodes.find(n => n.id === id); if (node) { node.label = label; fitText(node); } });
  }
  private paste = (event: ClipboardEvent) => {
    const label = event.clipboardData?.getData('text/plain'); if (!label) return;
    event.preventDefault(); const center = this.renderer.screenToGrid(this.width / 2, this.height / 2);
    const node: DiagramNode = { id: uid(), kind: 'text', label, x: Math.round(center.x), y: Math.round(center.y), width: 1, height: 1, textAlign: 'left', verticalAlign: 'top', padding: 0, wrap: false };
    fitText(node); node.x -= Math.floor(node.width / 2); node.y -= Math.floor(node.height / 2);
    this.selectedIds = new Set([node.id]); this.selectedEdgeId = null; this.transact(doc => doc.nodes.push(node));
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault(); const p = this.local(event);
    if (event.ctrlKey || event.metaKey) this.zoomAt(Math.exp(-event.deltaY * 0.008), p.x, p.y);
    else { this.autoFit = false; const c = this.renderer.camera; this.renderer.markInput('wheelPan'); this.renderer.setCamera({ ...c, x: c.x - event.deltaX, y: c.y - event.deltaY }); }
  };
  private keyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable || target.closest('[role="dialog"],[role="menu"],[role="combobox"]')) return;
    if (!this.initialized || this.documentBusy) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); void this.saveFile(); return; }
    if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); this.duplicateSelection(); return; }
    if (mod && event.key.toLowerCase() === 'c') { event.preventDefault(); void this.copyText(); return; }
    if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); this.setSelection(this.document.nodes.map(n => n.id)); return; }
    if (mod && event.key.toLowerCase() === 'g') { event.preventDefault(); event.shiftKey ? this.ungroupSelection() : this.groupSelection(); return; }
    if (mod) return;
    if (event.code === 'Space') { event.preventDefault(); this.spaceDown = true; return; }
    if (event.key === 'Escape') { this.pointerCancel(); this.selectedIds.clear(); this.selectedEdgeId = null; this.renderer.setSelection([]); this.setTool('select'); this.canvas.blur(); return; }
    if (event.key === 'Tab' && target === this.canvas && this.document.nodes.length) {
      event.preventDefault(); const current = this.selected?.id; const index = this.document.nodes.findIndex(n => n.id === current);
      this.setSelection([this.document.nodes[(index + (event.shiftKey ? -1 : 1) + this.document.nodes.length) % this.document.nodes.length].id]); return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.deleteSelection(); return; }
    if (event.key === 'Enter' && this.selected) { event.preventDefault(); this.editText(this.selected); return; }
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const selectedEdge = this.selectedEdge;
    if (moves[event.key] && selectedEdge?.fromPoint && selectedEdge.toPoint) {
      event.preventDefault(); const [dx, dy] = moves[event.key], step = event.shiftKey ? 5 : 1;
      this.updateSelectedEdge({ fromPoint: { x: selectedEdge.fromPoint.x + dx * step, y: selectedEdge.fromPoint.y + dy * step }, toPoint: { x: selectedEdge.toPoint.x + dx * step, y: selectedEdge.toPoint.y + dy * step } }); return;
    }
    if (moves[event.key] && this.selectedIds.size) {
      event.preventDefault(); const [dx, dy] = moves[event.key]; const ids = new Set(this.selectedIds), step = event.shiftKey ? 5 : 1;
      this.transact(doc => { for (const node of doc.nodes) if (ids.has(node.id) && !node.locked && !node.hidden) { node.x += dx * step; node.y += dy * step; } }); return;
    }
    const shortcuts: Record<string, Tool> = { v: 'select', h: 'pan', r: 'rectangle', t: 'text', l: 'line', p: 'pencil', e: 'eraser', b: 'fill', i: 'picker' };
    if (shortcuts[event.key.toLowerCase()]) this.setTool(shortcuts[event.key.toLowerCase()]);
    if (event.key === '1' || event.key.toLowerCase() === 'f') this.fit();
    if (event.key === '+' || event.key === '=') this.zoomBy(1.2);
    if (event.key === '-') this.zoomBy(1 / 1.2);
  };
  destroy() {
    if (this.initialized) { clearTimeout(this.saveTimer); if (this.status === 'Saving…' && this.activeDocumentId) this.persist(this.activeDocumentId, clone(this.document)); }
    void this.saveQueue.finally(() => this.localDocuments.close());
    this.disposed = true; clearTimeout(this.previewTimer); this.abort.abort(); this.observer.disconnect(); this.renderer.destroy(); this.worker.terminate();
    const target = window as Window & { __DRAW_BENCHMARK_API__?: BenchmarkApi };
    if (target.__DRAW_BENCHMARK_API__ === this.benchmarkApi) delete target.__DRAW_BENCHMARK_API__;
    for (const pending of this.requests.values()) pending.reject(new Error('Editor closed'));
    this.requests.clear(); this.canvas.remove(); this.textarea.remove();
  }
}

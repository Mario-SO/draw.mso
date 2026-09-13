import { CanvasRenderer, SpatialIndex, CELL_WIDTH, CELL_HEIGHT, type DiagramNode, type DiagramDocument, type DiagramEdge, type Scene, type ConnectionSide } from '@draw/renderer';
import { sampleDocument } from './sample';
import { diffDocument } from './document-patch';
import { LocalDocuments, type DocumentSummary } from './local-documents';
export type { DiagramNode } from '@draw/renderer';
export type { DocumentSummary } from './local-documents';
export type Tool = 'select' | 'pan' | 'connect' | DiagramNode['kind'];
export interface EditorSnapshot {
  title: string; tool: Tool; selected: DiagramNode | null; connections: DiagramEdge[]; nodeCount: number; edgeCount: number;
  selectedCount: number; canGroup: boolean; canUngroup: boolean;
  documents: DocumentSummary[]; activeDocumentId: string; documentBusy: boolean;
  zoom: number; canUndo: boolean; canRedo: boolean; status: string; error: string | null;
}
interface EngineResult { document: DiagramDocument; scene: Scene; canUndo: boolean; canRedo: boolean }
const clone = <T>(value: T): T => structuredClone(value);
const uid = () => crypto.randomUUID();
type GroupNode = DiagramNode & { groupId?: string };
type MoveOrigin = { id: string; x: number; y: number };
type Drag =
  | { mode: 'pan'; startX: number; startY: number; initialX: number; initialY: number }
  | { mode: 'marquee'; startX: number; startY: number; currentX: number; currentY: number; additive: boolean; initialSelection: Set<string> }
  | { mode: 'move'; startX: number; startY: number; nodes: DiagramNode[]; origins: MoveOrigin[]; dx: number; dy: number }
  | { mode: 'resize'; startX: number; startY: number; node: DiagramNode; initialX: number; initialY: number; dx: number; dy: number };

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
  private requests = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private requestId = 0;
  private document: DiagramDocument = clone(sampleDocument);
  private scene: Scene | null = null;
  private tool: Tool = 'select';
  private selectedIds = new Set<string>();
  private sourceId: string | null = null;
  private sourceSide: ConnectionSide | undefined;
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

  constructor(private host: HTMLElement, private options: { onChange: (snapshot: EditorSnapshot) => void }) {
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
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const pending = this.requests.get(data.id);
      if (!pending) return;
      this.requests.delete(data.id);
      data.error ? pending.reject(new Error(data.error)) : pending.resolve(data.result);
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
    window.addEventListener('keydown', this.keyDown, { signal });
    window.addEventListener('keyup', event => { if (event.code === 'Space') this.spaceDown = false; }, { signal });
    window.addEventListener('blur', () => { this.spaceDown = false; this.pointerCancel(); }, { signal });
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
    this.ready = this.initialize();
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
  private request(type: string, payload?: unknown): Promise<any> {
    if (this.disposed) return Promise.reject(new Error('Editor closed'));
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
  private accept(result: EngineResult) {
    this.document = result.document; this.scene = result.scene;
    this.spatialIndex.update(this.document.nodes);
    this.canUndo = result.canUndo; this.canRedo = result.canRedo;
    const ids = new Set(this.document.nodes.map(node => node.id));
    this.selectedIds = new Set([...this.selectedIds].filter(id => ids.has(id)));
    if (!this.document.nodes.some(node => node.id === this.sourceId)) { this.sourceId = null; this.renderer.setConnectSource(null); }
    this.renderer.setScene(this.scene, this.document);
    this.renderer.setSelection([...this.selectedIds]);
    this.renderer.setPreviews([]); this.renderer.setGuides([]); this.renderer.setMarquee(null);
    this.renderer.setPreview(null);
    this.emit();
  }
  private emit() {
    if (this.disposed) return;
    const selectedIds = this.selectedIds;
    this.options.onChange({ title: this.document.title, tool: this.tool, selected: this.selected,
      connections: this.document.edges.filter(edge => selectedIds.has(edge.from) || selectedIds.has(edge.to)),
      nodeCount: this.document.nodes.length, edgeCount: this.document.edges.length,
      selectedCount: selectedIds.size, canGroup: selectedIds.size > 1 && new Set((this.document.nodes as GroupNode[]).filter(n => selectedIds.has(n.id)).map(n => n.groupId ?? n.id)).size > 1, canUngroup: [...selectedIds].some(id => Boolean((this.document.nodes.find(n => n.id === id) as GroupNode | undefined)?.groupId)),
      documents: this.documents, activeDocumentId: this.activeDocumentId, documentBusy: this.documentBusy,
      zoom: this.renderer.camera.zoom, canUndo: this.canUndo, canRedo: this.canRedo, status: this.status, error: this.error });
  }
  private fail(error: unknown) {
    if (this.disposed) return;
    this.error = error instanceof Error ? error.message : String(error);
    this.status = 'Action could not be completed'; this.emit();
  }
  private get selected() { return this.selectedIds.size === 1 ? this.document.nodes.find(node => this.selectedIds.has(node.id)) ?? null : null; }
  private setSelection(ids: Iterable<string>) { this.selectedIds = new Set(ids); this.renderer.setSelection([...this.selectedIds]); this.emit(); }
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
    this.finishText(); this.tool = tool; this.sourceId = null; this.sourceSide = undefined; this.renderer.setConnectSource(null); this.renderer.setConnectHover(null);
    this.canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
    this.status = tool === 'connect' ? 'Click a source, then a destination' : tool === 'select' ? 'Select and arrange objects' : tool === 'pan' ? 'Drag to pan the canvas' : 'Click the canvas to place a ' + tool;
    this.emit();
  }
  addNode(kind: DiagramNode['kind']) {
    const center = this.renderer.screenToGrid(this.width / 2, this.height / 2);
    this.placeNode(kind, Math.round(center.x - 12), Math.round(center.y - 3));
  }
  private placeNode(kind: DiagramNode['kind'], x: number, y: number) {
    const id = uid();
    const label = { service: 'New service', database: 'Database', queue: 'Message queue', boundary: 'System boundary', text: 'Add a note' }[kind];
    const node: DiagramNode = { id, kind, label, x, y, width: kind === 'boundary' ? 42 : 24, height: kind === 'text' ? 2 : kind === 'boundary' ? 18 : 6 };
    this.selectedIds = new Set([id]);
    this.transact(doc => doc.nodes.push(node));
    this.setTool('select');
  }
  deleteSelection() {
    const ids = new Set(this.selectedIds); if (!ids.size) return;
    this.transact(doc => { doc.nodes = doc.nodes.filter(n => !ids.has(n.id)); doc.edges = doc.edges.filter(e => !ids.has(e.from) && !ids.has(e.to)); });
  }
  duplicateSelection() {
    if (!this.selectedIds.size) return;
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
    this.transact(doc => { const node = doc.nodes.find(n => n.id === id); if (node) Object.assign(node, patch, { id: node.id }); });
  }
  groupSelection() {
    if (this.selectedIds.size < 2) return;
    const currentGroups = new Set((this.document.nodes as GroupNode[]).filter(n => this.selectedIds.has(n.id)).map(n => n.groupId ?? n.id));
    if (currentGroups.size < 2) return;
    const ids = new Set(this.selectedIds), groupId = uid();
    this.transact(doc => { for (const node of doc.nodes as GroupNode[]) if (ids.has(node.id)) node.groupId = groupId; });
  }
  ungroupSelection() {
    if (!this.selectedIds.size) return;
    const selected = new Set(this.selectedIds);
    const groupIds = new Set((this.document.nodes as GroupNode[]).filter(n => selected.has(n.id) && n.groupId).map(n => n.groupId!));
    if (!groupIds.size) return;
    this.transact(doc => { for (const node of doc.nodes as GroupNode[]) if (node.groupId && groupIds.has(node.groupId)) delete node.groupId; });
  }
  alignSelection(alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    const nodes = this.document.nodes.filter(n => this.selectedIds.has(n.id)); if (nodes.length < 2) return;
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
      const parsed = JSON.parse(await file.text()) as DiagramDocument;
      if (!this.initialized) throw new Error('The engine is still loading.');
      await this.createAndOpen(parsed);
    } catch (error) { this.fail(error); }
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
    await this.operationQueue;
    this.download(JSON.stringify(this.document, null, 2) + '\n', 'mso', 'application/json');
  }
  async exportFile(format: 'unicode' | 'ascii' | 'svg') {
    try { await this.operationQueue; const text = await this.request('export', format); this.download(text, format === 'svg' ? 'svg' : 'txt', format === 'svg' ? 'image/svg+xml' : 'text/plain'); }
    catch (error) { this.fail(error); }
  }
  async copyText() {
    try { await this.operationQueue; const text = await this.request('export', 'unicode'); await navigator.clipboard.writeText(text); this.status = 'Diagram copied as Unicode text'; this.emit(); }
    catch (error) { this.fail(error); }
  }
  private download(text: string, extension: string, mime: string) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement('a'); link.href = url; link.download = (this.document.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'diagram') + '.' + extension;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status = 'Exported ' + link.download; this.emit();
  }
  private local(event: MouseEvent) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  private hit(x: number, y: number) {
    // Foreground objects take precedence over larger boundary containers.
    const matches = this.spatialIndex.at(x, y);
    return matches.find(n => n.kind !== 'boundary') ?? matches.find(n => n.kind === 'boundary');
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
  private pointerDown = (event: PointerEvent) => {
    if (!this.initialized || this.documentBusy || (event.button !== 0 && event.button !== 1)) return;
    this.finishText(); this.canvas.focus();
    const p = this.local(event); const g = this.renderer.screenToGrid(p.x, p.y); const c = this.renderer.camera;
    this.canvas.setPointerCapture(event.pointerId);
    if (this.tool === 'pan' || this.spaceDown || event.button === 1) {
      event.preventDefault(); this.drag = { mode: 'pan', startX: p.x, startY: p.y, initialX: c.x, initialY: c.y }; return;
    }
    if (this.pendingCommands) return;
    if (!['select', 'connect'].includes(this.tool)) { this.placeNode(this.tool as DiagramNode['kind'], Math.round(g.x), Math.round(g.y)); return; }
    const node = this.hit(g.x, g.y);
    if (this.tool === 'connect') {
      if (!node) return;
      if (!this.sourceId) { this.sourceId = node.id; this.sourceSide = this.connectionSide(node, g.x, g.y); this.renderer.setConnectSource(node.id); this.status = 'Now click the destination'; this.emit(); }
      else if (this.sourceId !== node.id) {
        const from = this.sourceId; const to = node.id;
        const fromSide = this.sourceSide, toSide = this.connectionSide(node, g.x, g.y);
        this.transact(doc => { if (!doc.edges.some(e => e.from === from && e.to === to)) doc.edges.push({ id: uid(), from, to, fromSide, toSide, label: '' }); });
        this.setTool('select');
      }
      return;
    }
    if (!node) {
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
    const resize = this.selectedIds.size === 1 && Math.abs(g.x - (node.x + node.width - 0.5)) < 1.3 && Math.abs(g.y - (node.y + node.height - 0.5)) < 0.8;
    if (resize) this.drag = { mode: 'resize', startX: p.x, startY: p.y, initialX: node.x, initialY: node.y, node: clone(node), dx: 0, dy: 0 };
    else {
      const nodes = this.document.nodes.filter(n => this.selectedIds.has(n.id)).map(clone);
      this.drag = { mode: 'move', startX: p.x, startY: p.y, nodes, origins: nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), dx: 0, dy: 0 };
    }
  };
  private pointerMove = (event: PointerEvent) => {
    const d = this.drag;
    if (!d) {
      if (this.tool === 'connect') {
        const p = this.local(event), g = this.renderer.screenToGrid(p.x, p.y), node = this.hit(g.x, g.y);
        this.renderer.setConnectHover(node?.id ?? null, node ? this.connectionSide(node, g.x, g.y) : undefined);
      }
      if (this.tool === 'select') {
        const p = this.local(event), g = this.renderer.screenToGrid(p.x, p.y), node = this.hit(g.x, g.y);
        const resize = node && this.selectedIds.size === 1 && this.selectedIds.has(node.id) && Math.abs(g.x - node.x - node.width + 0.5) < 1.3 && Math.abs(g.y - node.y - node.height + 0.5) < 0.8;
        this.canvas.style.cursor = resize ? 'nwse-resize' : node ? 'move' : 'default';
      }
      return;
    }
    const p = this.local(event); const c = this.renderer.camera;
    if (d.mode === 'pan') {
      this.autoFit = false;
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
      const raw = this.document.nodes.filter(n => n.x < right && n.x + n.width > left && n.y < bottom && n.y + n.height > top);
      const groups = new Set(raw.map(n => (n as GroupNode).groupId).filter((id): id is string => Boolean(id)));
      const hit = this.document.nodes.filter(n => raw.includes(n) || Boolean((n as GroupNode).groupId && groups.has((n as GroupNode).groupId!))).map(n => n.id);
      const next = new Set(d.additive ? [...d.initialSelection, ...hit] : hit);
      if (next.size !== this.selectedIds.size || [...next].some(id => !this.selectedIds.has(id))) { this.selectedIds = next; this.renderer.setSelection([...next]); this.emit(); }
      this.renderer.setMarquee({ x: left, y: top, width: right - left, height: bottom - top }); return;
    }
    d.dx = Math.round((p.x - d.startX) / (CELL_WIDTH * c.zoom));
    d.dy = Math.round((p.y - d.startY) / (CELL_HEIGHT * c.zoom));
    let constrainedAxis: 'x' | 'y' | undefined;
    if (event.shiftKey && d.mode === 'move') { constrainedAxis = Math.abs(d.dx) > Math.abs(d.dy) ? 'x' : 'y'; if (constrainedAxis === 'x') d.dy = 0; else d.dx = 0; }
    this.renderer.setGuides([]); if (d.mode === 'move' && !event.altKey) this.snapMove(d, constrainedAxis);
    if (d.mode === 'move') this.renderer.setPreviews(d.nodes.map(node => ({ node, dx: d.dx, dy: d.dy })));
    else this.renderer.setPreview({ node: { ...d.node, width: Math.max(8, d.node.width + d.dx), height: Math.max(d.node.kind === 'text' ? 1 : 3, d.node.height + d.dy) }, dx: 0, dy: 0 });
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
      const doc = clone(this.document);
      if (drag.mode === 'move') for (const origin of drag.origins) { const node = doc.nodes.find(n => n.id === origin.id)!; node.x = origin.x + drag.dx; node.y = origin.y + drag.dy; }
      else { const node = doc.nodes.find(n => n.id === drag.node.id)!; node.width = Math.max(8, drag.node.width + drag.dx); node.height = Math.max(node.kind === 'text' ? 1 : 3, drag.node.height + drag.dy); }
      this.previewBusy = true;
      try {
        const result = await this.request('preview', doc);
        if (this.drag === drag && this.previewRevision === revision) {
          this.renderer.setScene(result.scene, result.document); this.renderer.setPreview(null); this.renderer.setPreviews([]);
        }
      } catch { /* Invalid out-of-bounds previews are rejected at commit as well. */ }
      finally { this.previewBusy = false; if (this.drag === drag && this.previewRevision !== revision) this.schedulePreview(); }
    }, 50);
  }
  private pointerUp = (event: PointerEvent) => {
    const d = this.drag; this.drag = null; clearTimeout(this.previewTimer); this.previewTimer = undefined;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.renderer.setMarquee(null); this.renderer.setGuides([]); this.renderer.setPreviews([]);
    if (!d || d.mode === 'pan' || d.mode === 'marquee' || (!d.dx && !d.dy)) { this.renderer.setPreview(null); if (this.scene) this.renderer.setScene(this.scene, this.document); return; }
    this.transact(doc => {
      if (d.mode === 'move') for (const origin of d.origins) { const node = doc.nodes.find(n => n.id === origin.id); if (node) { node.x = origin.x + d.dx; node.y = origin.y + d.dy; } }
      else { const node = doc.nodes.find(n => n.id === d.node.id); if (node) { node.width = Math.max(8, d.node.width + d.dx); node.height = Math.max(node.kind === 'text' ? 1 : 3, d.node.height + d.dy); } }
    });
  };
  private pointerCancel = () => { const drag = this.drag; this.drag = null; if (drag?.mode === 'marquee') { this.selectedIds = drag.initialSelection; this.renderer.setSelection([...this.selectedIds]); this.emit(); } clearTimeout(this.previewTimer); this.previewTimer = undefined; this.renderer.setPreview(null); this.renderer.setPreviews([]); this.renderer.setMarquee(null); this.renderer.setGuides([]); if (this.scene) this.renderer.setScene(this.scene, this.document); };
  private doubleClick = (event: MouseEvent) => {
    if (this.tool !== 'select') return;
    const p = this.local(event); const g = this.renderer.screenToGrid(p.x, p.y); const node = this.hit(g.x, g.y);
    if (node) this.editText(node);
  };
  private editText(node: DiagramNode) {
    this.selectedIds = new Set([node.id]); this.renderer.setSelection([node.id]); this.textId = node.id;
    const point = this.renderer.gridToScreen(node.x, node.y); const zoom = this.renderer.camera.zoom;
    Object.assign(this.textarea.style, { display: 'block', left: point.x + 'px', top: point.y + 'px', width: Math.max(120, node.width * CELL_WIDTH * zoom) + 'px', height: Math.max(60, node.height * CELL_HEIGHT * zoom) + 'px', fontSize: Math.max(11, 13 * zoom) + 'px' });
    this.textarea.value = node.label; this.textarea.focus(); this.textarea.select(); this.emit();
  }
  private finishText() {
    if (!this.textId) return;
    const id = this.textId; const label = this.textarea.value;
    this.textId = null; this.textarea.style.display = 'none';
    this.transact(doc => { const node = doc.nodes.find(n => n.id === id); if (node) node.label = label; });
  }
  private wheel = (event: WheelEvent) => {
    event.preventDefault(); const p = this.local(event);
    if (event.ctrlKey || event.metaKey) this.zoomAt(Math.exp(-event.deltaY * 0.008), p.x, p.y);
    else { this.autoFit = false; const c = this.renderer.camera; this.renderer.setCamera({ ...c, x: c.x - event.deltaX, y: c.y - event.deltaY }); }
  };
  private keyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable || target.closest('[role="dialog"],[role="menu"],[role="combobox"]')) return;
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
    if (event.key === 'Escape') { this.pointerCancel(); this.selectedIds.clear(); this.renderer.setSelection([]); this.setTool('select'); this.canvas.blur(); return; }
    if (event.key === 'Tab' && target === this.canvas && this.document.nodes.length) {
      event.preventDefault(); const current = this.selected?.id; const index = this.document.nodes.findIndex(n => n.id === current);
      this.setSelection([this.document.nodes[(index + (event.shiftKey ? -1 : 1) + this.document.nodes.length) % this.document.nodes.length].id]); return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.deleteSelection(); return; }
    if (event.key === 'Enter' && this.selected) { event.preventDefault(); this.editText(this.selected); return; }
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[event.key] && this.selectedIds.size) {
      event.preventDefault(); const [dx, dy] = moves[event.key]; const ids = new Set(this.selectedIds), step = event.shiftKey ? 5 : 1;
      this.transact(doc => { for (const node of doc.nodes) if (ids.has(node.id)) { node.x += dx * step; node.y += dy * step; } }); return;
    }
    const shortcuts: Record<string, Tool> = { v: 'select', h: 'pan', c: 'connect', s: 'service', d: 'database', q: 'queue', b: 'boundary', t: 'text' };
    if (shortcuts[event.key.toLowerCase()]) this.setTool(shortcuts[event.key.toLowerCase()]);
    if (event.key === '1' || event.key.toLowerCase() === 'f') this.fit();
    if (event.key === '+' || event.key === '=') this.zoomBy(1.2);
    if (event.key === '-') this.zoomBy(1 / 1.2);
  };
  destroy() {
    if (this.initialized) { clearTimeout(this.saveTimer); if (this.status === 'Saving…' && this.activeDocumentId) this.persist(this.activeDocumentId, clone(this.document)); }
    void this.saveQueue.finally(() => this.localDocuments.close());
    this.disposed = true; clearTimeout(this.previewTimer); this.abort.abort(); this.observer.disconnect(); this.renderer.destroy(); this.worker.terminate();
    for (const pending of this.requests.values()) pending.reject(new Error('Editor closed'));
    this.requests.clear(); this.canvas.remove(); this.textarea.remove();
  }
}

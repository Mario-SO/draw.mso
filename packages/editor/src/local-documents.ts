import Dexie, { type Table } from 'dexie';
import type { DiagramDocument } from '@draw/renderer';

interface LegacyRecord { id: string; document: DiagramDocument }
interface LibraryRecord { id: string; document: DiagramDocument; title: string; updatedAt: number }
interface SettingRecord { key: string; value: string }
export interface DocumentSummary { id: string; title: string; updatedAt: number }
export interface RemoveDocumentResult { activeId: string; document: DiagramDocument; documents: DocumentSummary[]; activeChanged: boolean }

export class LocalDocuments extends Dexie {
  private library: Table<LibraryRecord, string>;
  private settings: Table<SettingRecord, string>;

  constructor() {
    super('draw-mso');
    this.version(1).stores({ documents: 'id' });
    this.version(2).stores({ documents: 'id', library: 'id,updatedAt', settings: 'key' }).upgrade(async transaction => {
      const library = transaction.table('library') as Table<LibraryRecord, string>;
      const settings = transaction.table('settings') as Table<SettingRecord, string>;
      if (await library.count()) return;
      const legacy = await (transaction.table('documents') as Table<LegacyRecord, string>).get('current');
      if (!legacy) return;
      const id = crypto.randomUUID(), updatedAt = Date.now();
      await library.put({ id, document: structuredClone(legacy.document), title: legacy.document.title, updatedAt });
      await settings.put({ key: 'activeDocumentId', value: id });
      await settings.put({ key: 'documentOrder', value: JSON.stringify([id]) });
      // Keep documents.current untouched as a recovery copy of pre-library data.
    });
    this.library = this.table('library');
    this.settings = this.table('settings');
  }

  async initialize(fallback: DiagramDocument) {
    return this.transaction('rw', this.library, this.settings, async () => {
      let records = await this.library.orderBy('updatedAt').reverse().toArray();
      let order = await this.ensureOrder(records);
      let activeId = (await this.settings.get('activeDocumentId'))?.value;
      let active = activeId ? records.find(record => record.id === activeId) : undefined;
      if (!active) {
        active = records[0];
        if (!active) {
          active = { id: crypto.randomUUID(), document: structuredClone(fallback), title: fallback.title, updatedAt: Date.now() };
          await this.library.put(active); records = [active]; order = [active.id]; await this.writeOrder(order);
        }
        activeId = active.id; await this.settings.put({ key: 'activeDocumentId', value: activeId });
      }
      return { activeId: active.id, document: structuredClone(active.document), documents: this.summaries(records, order) };
    });
  }

  async list(): Promise<DocumentSummary[]> {
    return this.transaction('rw', this.library, this.settings, async () => {
      const records = await this.library.orderBy('updatedAt').reverse().toArray();
      return this.summaries(records, await this.ensureOrder(records));
    });
  }
  async get(id: string): Promise<DiagramDocument | undefined> { const record = await this.library.get(id); return record && structuredClone(record.document); }
  async save(id: string, document: DiagramDocument): Promise<void> {
    await this.transaction('rw', this.library, this.settings, async () => {
      const recordIds = await this.library.orderBy('updatedAt').reverse().primaryKeys() as string[];
      const existed = recordIds.includes(id), order = await this.ensureOrder(recordIds.map(recordId => ({ id: recordId })));
      await this.library.put({ id, document: structuredClone(document), title: document.title, updatedAt: Date.now() });
      if (!existed) { order.push(id); await this.writeOrder(order); }
    });
  }
  async create(document: DiagramDocument): Promise<string> {
    const id = crypto.randomUUID(); await this.save(id, document); return id;
  }
  async setActive(id: string): Promise<void> { await this.settings.put({ key: 'activeDocumentId', value: id }); }
  async remove(id: string, blank: DiagramDocument): Promise<RemoveDocumentResult> {
    return this.transaction('rw', this.library, this.settings, async () => {
      const target = await this.library.get(id);
      if (!target) throw new Error('That local document is no longer available.');
      const before = await this.library.orderBy('updatedAt').reverse().toArray();
      let order = (await this.ensureOrder(before)).filter(documentId => documentId !== id);
      const activeId = (await this.settings.get('activeDocumentId'))?.value;
      if (activeId !== id) {
        await this.library.delete(id);
        const records = await this.library.orderBy('updatedAt').reverse().toArray();
        const active = activeId && records.find(record => record.id === activeId);
        if (!active) throw new Error('The active local document could not be found.');
        await this.writeOrder(order);
        return { activeId: active.id, document: structuredClone(active.document), documents: this.summaries(records, order), activeChanged: false };
      }
      await this.library.delete(id);
      let records = await this.library.orderBy('updatedAt').reverse().toArray();
      let active = records[0];
      if (!active) {
        active = { id: crypto.randomUUID(), document: structuredClone(blank), title: blank.title, updatedAt: Date.now() };
        await this.library.put(active); records = [active]; order.push(active.id);
      }
      await this.settings.put({ key: 'activeDocumentId', value: active.id });
      await this.writeOrder(order);
      return { activeId: active.id, document: structuredClone(active.document), documents: this.summaries(records, order), activeChanged: true };
    });
  }

  private async ensureOrder(records: Array<{ id: string }>): Promise<string[]> {
    const ids = new Set(records.map(record => record.id));
    let stored: unknown;
    try { stored = JSON.parse((await this.settings.get('documentOrder'))?.value ?? '[]'); } catch { stored = []; }
    const order = Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [];
    const unique = [...new Set(order)], seen = new Set(unique);
    for (const record of records) if (!seen.has(record.id)) { unique.push(record.id); seen.add(record.id); }
    const encoded = JSON.stringify(unique);
    if (encoded !== JSON.stringify(stored)) await this.settings.put({ key: 'documentOrder', value: encoded });
    return unique;
  }
  private writeOrder(order: string[]) { return this.settings.put({ key: 'documentOrder', value: JSON.stringify(order) }); }
  private summaries(records: LibraryRecord[], order: string[]): DocumentSummary[] {
    const byId = new Map(records.map(record => [record.id, record]));
    return order.flatMap(id => { const record = byId.get(id); return record ? [{ id: record.id, title: record.title, updatedAt: record.updatedAt }] : []; });
  }
}

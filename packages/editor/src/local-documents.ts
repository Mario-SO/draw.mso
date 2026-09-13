import Dexie, { type Table } from 'dexie';
import type { DiagramDocument } from '@draw/renderer';

interface LegacyRecord { id: string; document: DiagramDocument }
interface LibraryRecord { id: string; document: DiagramDocument; title: string; updatedAt: number }
interface SettingRecord { key: string; value: string }
export interface DocumentSummary { id: string; title: string; updatedAt: number }

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
      // Keep documents.current untouched as a recovery copy of pre-library data.
    });
    this.library = this.table('library');
    this.settings = this.table('settings');
  }

  async initialize(fallback: DiagramDocument) {
    return this.transaction('rw', this.library, this.settings, async () => {
      let records = await this.library.orderBy('updatedAt').reverse().toArray();
      let activeId = (await this.settings.get('activeDocumentId'))?.value;
      let active = activeId ? records.find(record => record.id === activeId) : undefined;
      if (!active) {
        active = records[0];
        if (!active) {
          active = { id: crypto.randomUUID(), document: structuredClone(fallback), title: fallback.title, updatedAt: Date.now() };
          await this.library.put(active); records = [active];
        }
        activeId = active.id; await this.settings.put({ key: 'activeDocumentId', value: activeId });
      }
      return { activeId: active.id, document: structuredClone(active.document), documents: this.summaries(records) };
    });
  }

  async list(): Promise<DocumentSummary[]> { return this.summaries(await this.library.orderBy('updatedAt').reverse().toArray()); }
  async get(id: string): Promise<DiagramDocument | undefined> { const record = await this.library.get(id); return record && structuredClone(record.document); }
  async save(id: string, document: DiagramDocument): Promise<void> {
    await this.library.put({ id, document: structuredClone(document), title: document.title, updatedAt: Date.now() });
  }
  async create(document: DiagramDocument): Promise<string> {
    const id = crypto.randomUUID(); await this.save(id, document); return id;
  }
  async setActive(id: string): Promise<void> { await this.settings.put({ key: 'activeDocumentId', value: id }); }

  private summaries(records: LibraryRecord[]): DocumentSummary[] { return records.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })); }
}

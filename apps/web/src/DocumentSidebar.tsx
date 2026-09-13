import { useEffect, useRef } from 'react'
import { File, Trash2 } from 'lucide-react'
import type { EditorSnapshot } from '@draw/editor'

export function DocumentSidebar({ open, snapshot, onClose, onSelect, onDelete, onRename }: {
  open: boolean
  snapshot: EditorSnapshot
  onClose: () => void
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename: () => void
}) {
  const listRef = useRef<HTMLElement>(null)
  const deletedId = useRef<string | null>(null)
  useEffect(() => {
    if (deletedId.current && !snapshot.documents.some(doc => doc.id === deletedId.current)) {
      deletedId.current = null
      listRef.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
    }
  }, [snapshot.documents])
  return <aside id="document-sidebar" className="document-sidebar" data-open={open} inert={!open} aria-hidden={!open} aria-label="Documents" onKeyDown={event => {
    event.stopPropagation()
    if (event.key === 'Escape') onClose()
  }}>
    <div className="document-sidebar-heading"><h2>Documents</h2></div>
    <nav ref={listRef} className="document-list" aria-label="Saved documents" aria-busy={snapshot.documentBusy}>
      {snapshot.documents.map(doc => <div key={doc.id} className="document-row-container"><button key={doc.id} type="button" className="document-row" aria-current={doc.id === snapshot.activeDocumentId ? 'page' : undefined} disabled={snapshot.documentBusy} onClick={() => onSelect(doc.id)} onDoubleClick={() => { if (doc.id === snapshot.activeDocumentId) onRename() }} onKeyDown={event => { if (event.key === 'F2' && doc.id === snapshot.activeDocumentId) { event.preventDefault(); onRename() } }} title={doc.id === snapshot.activeDocumentId ? `${doc.title} — Double-click to rename` : doc.title}>
        <File /><span>{doc.title}</span>{doc.id === snapshot.activeDocumentId && <i aria-hidden="true" />}
      </button><button type="button" className="document-delete" aria-label={`Delete ${doc.title}`} title="Delete document" disabled={snapshot.documentBusy} onClick={() => { deletedId.current = doc.id; onDelete(doc.id) }}><Trash2 /></button></div>)}
      {!snapshot.documents.length && <p className="document-list-empty">Your documents will appear here.</p>}
    </nav>
  </aside>
}

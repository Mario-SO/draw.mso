import { File, FilePlus2, FolderOpen, PanelLeftClose } from 'lucide-react'
import { Button } from '@draw/ui/components/ui/button'
import type { EditorSnapshot } from '@draw/editor'

export function DocumentSidebar({ open, snapshot, onClose, onNew, onOpenFile, onSelect }: {
  open: boolean
  snapshot: EditorSnapshot
  onClose: () => void
  onNew: () => void
  onOpenFile: () => void
  onSelect: (id: string) => void
}) {
  return <aside id="document-sidebar" className="document-sidebar" data-open={open} inert={!open} aria-hidden={!open} aria-label="Documents" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose() }
  }}>
    <div className="document-sidebar-heading"><h2>Documents</h2><Button variant="ghost" size="icon-sm" aria-label="Hide documents" onClick={onClose}><PanelLeftClose /></Button></div>
    <div className="document-sidebar-actions">
      <Button variant="outline" onClick={onNew} disabled={snapshot.documentBusy}><FilePlus2 />New document</Button>
      <Button variant="ghost" onClick={onOpenFile} disabled={snapshot.documentBusy}><FolderOpen />Open file…</Button>
    </div>
    <nav className="document-list" aria-label="Saved documents" aria-busy={snapshot.documentBusy}>
      {snapshot.documents.map(doc => <button key={doc.id} type="button" className="document-row" aria-current={doc.id === snapshot.activeDocumentId ? 'page' : undefined} disabled={snapshot.documentBusy} onClick={() => onSelect(doc.id)} title={doc.title}>
        <File /><span>{doc.title}</span>{doc.id === snapshot.activeDocumentId && <i aria-hidden="true" />}
      </button>)}
      {!snapshot.documents.length && <p className="document-list-empty">Your documents will appear here.</p>}
    </nav>
    <div className="document-sidebar-footer">On this device</div>
  </aside>
}

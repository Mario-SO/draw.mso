import { Eye, EyeOff, Lock, Unlock, ArrowUpToLine, ArrowDownToLine } from 'lucide-react'
import type { DiagramNode } from '@draw/editor'
import { Button } from '@draw/ui/components/ui/button'

export function ObjectsPanel({ open, nodes, selectedId, select, update, order, close }: { open: boolean; nodes: DiagramNode[]; selectedId?: string; select: (id: string) => void; update: (id: string, patch: Partial<DiagramNode>) => void; order: (direction: 'front' | 'back' | 'forward' | 'backward') => void; close: () => void }) {
  return <aside id="objects-sidebar" className="document-sidebar objects-sidebar" data-open={open} inert={!open} aria-hidden={!open} aria-label="Objects" onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') close() }}><div className="document-sidebar-heading objects-heading"><h2>Objects</h2></div>
    <div className="objects-list">{[...nodes].reverse().map(node => <div key={node.id} className="object-row" data-selected={node.id === selectedId}>
      <button className="object-name" onClick={() => select(node.id)} aria-label={`Select ${node.label || node.kind}`}><span>{node.kind === 'text' ? 'T' : '□'}</span>{node.label.split('\n')[0] || node.kind}</button>
      <Button variant="ghost" size="icon-xs" aria-label={`${node.hidden ? 'Show' : 'Hide'} ${node.label || node.kind}`} onClick={() => update(node.id, { hidden: !node.hidden })}>{node.hidden ? <EyeOff /> : <Eye />}</Button>
      <Button variant="ghost" size="icon-xs" aria-label={`${node.locked ? 'Unlock' : 'Lock'} ${node.label || node.kind}`} onClick={() => update(node.id, { locked: !node.locked })}>{node.locked ? <Lock /> : <Unlock />}</Button>
    </div>)}{!nodes.length && <p className="objects-empty">Draw a shape or add text to get started.</p>}</div>
    <div className="objects-actions"><Button variant="ghost" size="sm" disabled={!selectedId} onClick={() => order('front')}><ArrowUpToLine />To front</Button><Button variant="ghost" size="sm" disabled={!selectedId} onClick={() => order('back')}><ArrowDownToLine />To back</Button></div>
  </aside>
}

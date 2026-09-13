import { useEffect, useState } from 'react'
import { Copy, Trash2 } from 'lucide-react'
import type { DiagramNode, DiagramEdge } from '@draw/editor'
import { Button } from '@draw/ui/components/ui/button'
import { Input } from '@draw/ui/components/ui/input'
import { Textarea } from '@draw/ui/components/ui/textarea'

function Choice<T extends string>({ label, value, values, onChange }: { label: string; value: T; values: readonly T[]; onChange: (value: T) => void }) {
  return <label className="property-choice"><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value as T)}>{values.map(item => <option key={item} value={item}>{item.charAt(0).toUpperCase() + item.slice(1)}</option>)}</select></label>
}

export function NodeInspector({ node, connections, update, updateEdge, deleteEdge, duplicate, remove }: { node: DiagramNode; connections: DiagramEdge[]; update: (patch: Partial<DiagramNode>) => void; updateEdge: (id: string, label: string) => void; deleteEdge: (id: string) => void; duplicate: () => void; remove: () => void }) {
  const [draft, setDraft] = useState(node)
  useEffect(() => setDraft(node), [node])
  const commit = (field: keyof DiagramNode) => { if (draft[field] !== node[field]) update({ [field]: draft[field] }) }
  const border = node.border ?? (node.kind === 'text' ? 'none' : node.kind === 'database' ? 'double' : node.kind === 'queue' || node.kind === 'boundary' ? 'dashed' : 'single')
  return <aside className="inspector-panel" aria-label="Inspector">
    <div className="inspector-heading"><i />{node.kind === 'text' ? 'Text' : 'Rectangle'}<span>{node.width} × {node.height}</span></div>
    <fieldset disabled={node.locked} className="inspector-content">
      {node.kind !== 'text' && <NodeTitle node={node} borderless={border === 'none'} update={update} />}
      <label htmlFor="node-label">Text</label><Textarea id="node-label" aria-label="Label" rows={3} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} onBlur={() => commit('label')} />
      <details open><summary>Text layout</summary><div className="property-stack">
        <Choice label="Alignment" value={node.textAlign ?? (node.kind === 'text' ? 'left' : 'center')} values={['left', 'center', 'right']} onChange={textAlign => update({ textAlign })} />
        <Choice label="Position" value={node.verticalAlign ?? (node.kind === 'text' ? 'top' : 'middle')} values={['top', 'middle', 'bottom']} onChange={verticalAlign => update({ verticalAlign })} />
        <Choice label="Text direction" value={node.textDirection ?? 'right'} values={['right', 'left', 'down', 'up']} onChange={textDirection => update({ textDirection, lineDirection: textDirection === 'right' || textDirection === 'left' ? 'down' : 'right' })} />
        <Choice label="Line movement" value={node.lineDirection ?? (node.textDirection === 'down' || node.textDirection === 'up' ? 'right' : 'down')} values={node.textDirection === 'down' || node.textDirection === 'up' ? ['right', 'left'] : ['down', 'up']} onChange={lineDirection => update({ lineDirection })} />
        <label className="property-choice"><span>Padding</span><Input aria-label="Text padding" type="number" min={0} max={100} value={draft.padding ?? 0} onChange={e => setDraft({ ...draft, padding: Number(e.target.value) })} onBlur={() => commit('padding')} /></label>
        <label className="property-toggle"><input type="checkbox" checked={node.wrap ?? false} onChange={e => update({ wrap: e.target.checked })} />Wrap text to frame</label>
      </div></details>
      <details open><summary>Appearance</summary><div className="property-stack">
        <Choice label="Border" value={border} values={['none', 'single', 'double', 'rounded', 'heavy', 'dashed']} onChange={border => update({ border })} />
        <label className="property-choice"><span>Fill character</span><Input aria-label="Fill character" placeholder="None" value={draft.fill ?? ''} onChange={e => setDraft({ ...draft, fill: Array.from(e.target.value)[0] || undefined })} onBlur={() => commit('fill')} /></label>
        <label className="property-toggle"><input type="checkbox" checked={node.shadow ?? false} onChange={e => update({ shadow: e.target.checked })} />Shadow</label>
      </div></details>
      <details><summary>Geometry</summary><div className="field-grid">{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}><span>{field === 'width' ? 'W' : field === 'height' ? 'H' : field.toUpperCase()}</span><Input aria-label={field === 'width' ? 'W' : field === 'height' ? 'H' : field.toUpperCase()} type="number" value={draft[field]} onChange={e => setDraft({ ...draft, [field]: Number(e.target.value) })} onBlur={() => commit(field)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /></label>)}</div></details>
      <details open={connections.length > 0}><summary>Connections <span>{connections.length}</span></summary><div className="connection-list">{connections.map(edge => <ConnectionLabel key={edge.id} edge={edge} update={label => updateEdge(edge.id, label)} remove={() => deleteEdge(edge.id)} />)}</div></details>
    </fieldset>
    <div className="inspector-actions"><Button variant="ghost" size="icon-sm" aria-label="Duplicate" onClick={duplicate}><Copy /></Button><Button variant="ghost" size="icon-sm" aria-label="Delete" onClick={remove}><Trash2 /></Button></div>
  </aside>
}
function ConnectionLabel({ edge, update, remove }: { edge: DiagramEdge; update: (label: string) => void; remove: () => void }) {
  const [label, setLabel] = useState(edge.label)
  useEffect(() => setLabel(edge.label), [edge.label])
  return <div className="connection-edit"><Input aria-label={`Connection label ${edge.id}`} placeholder="Line label" value={label} onChange={e => setLabel(e.target.value)} onBlur={() => { if (label !== edge.label) update(label) }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} /><Button variant="ghost" size="icon-sm" aria-label={`Delete connection ${edge.id}`} onClick={remove}><Trash2 /></Button></div>
}
export function LineInspector({ edge, update, duplicate, remove }: { edge: DiagramEdge; update: (patch: Partial<DiagramEdge>) => void; duplicate: () => void; remove: () => void }) {
  const [label, setLabel] = useState(edge.label)
  useEffect(() => setLabel(edge.label), [edge.label])
  return <aside className="inspector-panel" aria-label="Line inspector"><div className="inspector-heading"><i />Line<span>{edge.from && edge.to ? 'Attached' : 'Free endpoint'}</span></div><div className="inspector-content">
    <label htmlFor="line-label">Label</label><Input id="line-label" value={label} onChange={e => setLabel(e.target.value)} onBlur={() => { if (label !== edge.label) update({ label }) }} />
    <div className="property-stack">
      <Choice label="Routing" value={edge.routing ?? 'orthogonal'} values={['orthogonal', 'staircase']} onChange={routing => update({ routing })} />
      <Choice label="Line style" value={edge.lineStyle ?? 'solid'} values={['solid', 'dashed']} onChange={lineStyle => update({ lineStyle })} />
      <Choice label="Start marker" value={edge.startArrow ?? 'none'} values={['none', 'arrow', 'diamond', 'circle']} onChange={startArrow => update({ startArrow })} />
      <Choice label="End marker" value={edge.endArrow ?? 'arrow'} values={['none', 'arrow', 'diamond', 'circle']} onChange={endArrow => update({ endArrow })} />
    </div>
  </div><div className="inspector-actions"><Button variant="ghost" size="icon-sm" aria-label="Duplicate line" onClick={duplicate}><Copy /></Button><Button variant="ghost" size="icon-sm" aria-label="Delete line" onClick={remove}><Trash2 /></Button></div></aside>
}

function NodeTitle({ node, borderless, update }: { node: DiagramNode; borderless: boolean; update: (patch: Partial<DiagramNode>) => void }) {
  const [title, setTitle] = useState(node.title ?? '')
  useEffect(() => setTitle(node.title ?? ''), [node.id, node.title])
  return <><label htmlFor="node-title">Title</label><Input id="node-title" placeholder="Add a title" value={title} onChange={event => setTitle(event.target.value)} onBlur={() => { if (title !== (node.title ?? '')) update({ title }) }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /><label className="property-choice"><span>Title position</span><select aria-label="Title position" value={node.titlePosition ?? 'top-middle'} onChange={event => update({ titlePosition: event.target.value as DiagramNode['titlePosition'] })}>{(['top-left', 'top-middle', 'top-right', 'bottom-left', 'bottom-middle', 'bottom-right'] as const).map(position => <option key={position} value={position}>{position.charAt(0).toUpperCase() + position.slice(1).replace('-', ' ')}</option>)}</select></label>{borderless && <small>Choose a border to display the title.</small>}</>
}

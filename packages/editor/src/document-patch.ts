import type { DiagramDocument, DocumentPatch } from '@draw/diagram-core/contract';
export type { DocumentPatch } from '@draw/diagram-core/contract';

export function diffDocument(before: DiagramDocument, after: DiagramDocument): DocumentPatch {
    const oldNodes = new Map(before.nodes.map(node => [node.id, node])), newNodes = new Map(after.nodes.map(node => [node.id, node]));
    const oldEdges = new Map(before.edges.map(edge => [edge.id, edge])), newEdges = new Map(after.edges.map(edge => [edge.id, edge]));
    const patch: DocumentPatch = {
      removedNodeIds: before.nodes.filter(n => !newNodes.has(n.id)).map(n => n.id),
      addedNodes: after.nodes.filter(n => !oldNodes.has(n.id)),
      updatedNodes: after.nodes.filter(n => oldNodes.has(n.id) && JSON.stringify(oldNodes.get(n.id)) !== JSON.stringify(n)),
      removedEdgeIds: before.edges.filter(e => !newEdges.has(e.id)).map(e => e.id),
      addedEdges: after.edges.filter(e => !oldEdges.has(e.id)),
      updatedEdges: after.edges.filter(e => oldEdges.has(e.id) && JSON.stringify(oldEdges.get(e.id)) !== JSON.stringify(e)),
    };
    const implicitOrder = [
      ...before.nodes.filter(node => newNodes.has(node.id)).map(node => node.id),
      ...after.nodes.filter(node => !oldNodes.has(node.id)).map(node => node.id),
    ];
    const finalOrder = after.nodes.map(node => node.id);
    if (implicitOrder.some((id, index) => finalOrder[index] !== id)) patch.nodeOrder = finalOrder;
    if (before.title !== after.title) patch.title = after.title;
    return patch;
  }

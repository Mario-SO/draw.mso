import type { DiagramDocument, DiagramNode, DiagramEdge } from '@draw/renderer';

export interface DocumentPatch {
  removedNodeIds?: string[]; updatedNodes?: DiagramNode[]; addedNodes?: DiagramNode[];
  removedEdgeIds?: string[]; updatedEdges?: DiagramEdge[]; addedEdges?: DiagramEdge[]; title?: string;
}

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
    if (before.title !== after.title) patch.title = after.title;
    return patch;
  }

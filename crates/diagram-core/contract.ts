/** Portable v1 wire types. Rust validation remains authoritative.
 * See schemas/ and docs/document-contract.md for constraints and compatibility.
 * No browser or renderer dependencies belong in this module.
 */
export const DOCUMENT_VERSION = 1 as const;

export interface DiagramNode {
  groupId?: string | null;
  id: string;
  kind: "service" | "database" | "queue" | "boundary" | "text";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ConnectionSide = "left" | "right" | "top" | "bottom";

export interface DiagramEdge {
  fromSide?: ConnectionSide | null;
  toSide?: ConnectionSide | null;
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface DiagramDocument {
  version: 1;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DocumentPatch {
  removedNodeIds?: string[];
  updatedNodes?: DiagramNode[];
  addedNodes?: DiagramNode[];
  removedEdgeIds?: string[];
  updatedEdges?: DiagramEdge[];
  addedEdges?: DiagramEdge[];
  title?: string | null;
}

/** Stable core failures; adapters may add transport or invocation errors. */
export type DiagramErrorCode =
  | 'invalid_document_json'
  | 'invalid_patch_json'
  | 'unsupported_version'
  | 'invalid_document'
  | 'invalid_patch'
  | 'export_too_large';

export interface DiagramErrorPayload {
  code: DiagramErrorCode;
  message: string;
}

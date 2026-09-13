/** Portable wire types. Rust validation remains authoritative.
 * See schemas/ for document and patch structure; Rust validates document-wide constraints.
 * No browser or renderer dependencies belong in this module.
 */
export const DOCUMENT_VERSION = 3 as const;

export interface DiagramNode {
  groupId?: string | null;
  id: string;
  kind: "service" | "database" | "queue" | "boundary" | "text" | "rectangle";
  /** Single-line border title; omitted or empty hides it. */
  title?: string;
  /** Defaults to top-middle. */
  titlePosition?: "top-left" | "top-middle" | "top-right" | "bottom-left" | "bottom-middle" | "bottom-right";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  border?: "none" | "single" | "double" | "rounded" | "heavy" | "dashed";
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  padding?: number;
  wrap?: boolean;
  /** Exactly one Unicode scalar. */
  fill?: string;
  shadow?: boolean;
  hidden?: boolean;
  locked?: boolean;
  textDirection?: "right" | "left" | "down" | "up";
  lineDirection?: "down" | "up" | "right" | "left";
}

export type ConnectionSide = "left" | "right" | "top" | "bottom";

export interface DiagramEdge {
  fromSide?: ConnectionSide | null;
  toSide?: ConnectionSide | null;
  id: string;
  from: string;
  to: string;
  label: string;
  fromPoint?: DiagramPoint | null;
  toPoint?: DiagramPoint | null;
  startArrow?: ArrowStyle;
  endArrow?: ArrowStyle;
  lineStyle?: "solid" | "dashed";
  routing?: "orthogonal" | "staircase";
}

export interface DiagramPoint { x: number; y: number }
export type ArrowStyle = "none" | "arrow" | "diamond" | "circle";

export interface DiagramDocument {
  version: 1 | 2 | 3;
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
  /** Complete permutation of final node IDs, from back to front. */
  nodeOrder?: string[];
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

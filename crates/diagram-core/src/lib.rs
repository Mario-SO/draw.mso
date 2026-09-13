//! Character-grid diagram engine.
//!
//! Every non-control Unicode scalar is one logical cell. Terminal glyphs whose
//! visual width is not one column may look wider than the logical grid; callers
//! that require terminal-perfect alignment should use single-column labels.

use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::error::Error;
use std::fmt::{Display, Formatter};

const MAX_NODES: usize = 2_000;
const MAX_EDGES: usize = 4_000;
const MAX_TEXT: usize = 4_096;
const MAX_DIMENSION: i32 = 10_000;
const MAX_COORDINATE: i32 = 1_000_000;
const MAX_EXPORT_AREA: i64 = 4_000_000;
const MAX_HISTORY: usize = 100;
const MAX_ROUTING_OBSTACLES: usize = 64;
const MAX_ROUTING_LANES: usize = 16;

pub const DOCUMENT_VERSION: u32 = 1;
pub const DOCUMENT_SCHEMA_JSON: &str = include_str!("../../../schemas/document-v1.schema.json");
pub const PATCH_SCHEMA_JSON: &str = include_str!("../../../schemas/document-patch-v1.schema.json");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Document {
    pub version: u32,
    pub title: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "groupId")]
    pub group_id: Option<String>,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Service,
    Database,
    Queue,
    Boundary,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "fromSide")]
    pub from_side: Option<Side>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "toSide")]
    pub to_side: Option<Side>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentPatch {
    #[serde(default)]
    pub removed_node_ids: Vec<String>,
    #[serde(default)]
    pub updated_nodes: Vec<Node>,
    #[serde(default)]
    pub added_nodes: Vec<Node>,
    #[serde(default)]
    pub removed_edge_ids: Vec<String>,
    #[serde(default)]
    pub updated_edges: Vec<Edge>,
    #[serde(default)]
    pub added_edges: Vec<Edge>,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Scene {
    pub cells: Vec<Cell>,
    #[serde(rename = "displayCells")]
    pub display_cells: Vec<Cell>,
    pub bounds: Bounds,
    pub routes: Vec<Route>,
}

#[derive(Debug, Serialize)]
pub struct DisplayScene<'a> {
    #[serde(rename = "displayCells")]
    pub display_cells: &'a [Cell],
    pub bounds: &'a Bounds,
    pub routes: &'a [Route],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Cell {
    pub x: i32,
    pub y: i32,
    pub ch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Route {
    pub id: String,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidDocumentJson,
    InvalidPatchJson,
    UnsupportedVersion,
    InvalidDocument,
    InvalidPatch,
    ExportTooLarge,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidDocumentJson => "invalid_document_json",
            Self::InvalidPatchJson => "invalid_patch_json",
            Self::UnsupportedVersion => "unsupported_version",
            Self::InvalidDocument => "invalid_document",
            Self::InvalidPatch => "invalid_patch",
            Self::ExportTooLarge => "export_too_large",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorPayload {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagramError {
    code: ErrorCode,
    message: String,
}
impl DiagramError {
    fn new(message: impl Into<String>) -> Self {
        Self::with_code(ErrorCode::InvalidDocument, message)
    }
    fn with_code(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn code(&self) -> ErrorCode {
        self.code
    }
    pub fn payload(&self) -> ErrorPayload {
        ErrorPayload {
            code: self.code,
            message: self.message.clone(),
        }
    }
    pub fn json(&self) -> String {
        serde_json::to_string(&self.payload()).expect("serializable error")
    }
    fn with_replaced_code(mut self, code: ErrorCode) -> Self {
        self.code = code;
        self
    }
}
impl Display for DiagramError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl Error for DiagramError {}

pub fn parse_document(json: &str) -> Result<Document, DiagramError> {
    let document: Document = serde_json::from_str(json).map_err(|e| {
        DiagramError::with_code(
            ErrorCode::InvalidDocumentJson,
            format!("invalid document JSON: {e}"),
        )
    })?;
    validate_document(&document)?;
    Ok(document)
}

pub fn validate_document(doc: &Document) -> Result<(), DiagramError> {
    if doc.version != 1 {
        return Err(DiagramError::with_code(
            ErrorCode::UnsupportedVersion,
            format!("unsupported document version {}; expected 1", doc.version),
        ));
    }
    check_text("title", &doc.title)?;
    if doc.nodes.len() > MAX_NODES {
        return Err(DiagramError::new(format!(
            "too many nodes (maximum {MAX_NODES})"
        )));
    }
    if doc.edges.len() > MAX_EDGES {
        return Err(DiagramError::new(format!(
            "too many edges (maximum {MAX_EDGES})"
        )));
    }
    let mut node_ids = HashSet::new();
    for node in &doc.nodes {
        check_id("node", &node.id)?;
        if !node_ids.insert(node.id.as_str()) {
            return Err(DiagramError::new(format!(
                "duplicate node id {:?}",
                node.id
            )));
        }
        check_text("node label", &node.label)?;
        if let Some(group_id) = &node.group_id {
            check_id("node group", group_id)?;
        }
        if node.width < 1
            || node.height < 1
            || node.width > MAX_DIMENSION
            || node.height > MAX_DIMENSION
        {
            return Err(DiagramError::new(format!(
                "node {:?} dimensions must be between 1 and {MAX_DIMENSION}",
                node.id
            )));
        }
        for (name, value) in [("x", node.x), ("y", node.y)] {
            if !(-MAX_COORDINATE..=MAX_COORDINATE).contains(&value) {
                return Err(DiagramError::new(format!(
                    "node {:?} {name} is out of range",
                    node.id
                )));
            }
        }
        let _ = node
            .x
            .checked_add(node.width)
            .ok_or_else(|| DiagramError::new("node coordinate overflow"))?;
        let _ = node
            .y
            .checked_add(node.height)
            .ok_or_else(|| DiagramError::new("node coordinate overflow"))?;
    }
    let mut edge_ids = HashSet::new();
    for edge in &doc.edges {
        check_id("edge", &edge.id)?;
        if !edge_ids.insert(edge.id.as_str()) {
            return Err(DiagramError::new(format!(
                "duplicate edge id {:?}",
                edge.id
            )));
        }
        check_text("edge label", &edge.label)?;
        if !node_ids.contains(edge.from.as_str()) {
            return Err(DiagramError::new(format!(
                "edge {:?} references missing source {:?}",
                edge.id, edge.from
            )));
        }
        if !node_ids.contains(edge.to.as_str()) {
            return Err(DiagramError::new(format!(
                "edge {:?} references missing target {:?}",
                edge.id, edge.to
            )));
        }
    }
    if !doc.nodes.is_empty() {
        let min_x = doc.nodes.iter().map(|n| n.x).min().unwrap();
        let min_y = doc.nodes.iter().map(|n| n.y).min().unwrap();
        let max_x = doc.nodes.iter().map(|n| n.x + n.width).max().unwrap();
        let max_y = doc.nodes.iter().map(|n| n.y + n.height).max().unwrap();
        let area = i64::from(max_x - min_x) * i64::from(max_y - min_y);
        if area > MAX_EXPORT_AREA {
            return Err(DiagramError::new(format!(
                "document bounds area {area} exceeds limit {MAX_EXPORT_AREA}"
            )));
        }
    }
    Ok(())
}

fn apply_document_patch(doc: &mut Document, patch: DocumentPatch) -> Result<(), DiagramError> {
    apply_document_patch_inner(doc, patch)
        .map_err(|error| error.with_replaced_code(ErrorCode::InvalidPatch))
}

fn apply_document_patch_inner(
    doc: &mut Document,
    patch: DocumentPatch,
) -> Result<(), DiagramError> {
    let mut node_changes = HashSet::new();
    for id in &patch.removed_node_ids {
        check_id("node", id)?;
        if !node_changes.insert(id.as_str()) {
            return Err(DiagramError::new(format!(
                "node {id:?} appears more than once in patch"
            )));
        }
    }
    for node in patch.updated_nodes.iter().chain(&patch.added_nodes) {
        check_id("node", &node.id)?;
        if !node_changes.insert(node.id.as_str()) {
            return Err(DiagramError::new(format!(
                "node {:?} appears more than once in patch",
                node.id
            )));
        }
    }

    let mut edge_changes = HashSet::new();
    for id in &patch.removed_edge_ids {
        check_id("edge", id)?;
        if !edge_changes.insert(id.as_str()) {
            return Err(DiagramError::new(format!(
                "edge {id:?} appears more than once in patch"
            )));
        }
    }
    for edge in patch.updated_edges.iter().chain(&patch.added_edges) {
        check_id("edge", &edge.id)?;
        if !edge_changes.insert(edge.id.as_str()) {
            return Err(DiagramError::new(format!(
                "edge {:?} appears more than once in patch",
                edge.id
            )));
        }
    }

    for id in &patch.removed_edge_ids {
        let Some(index) = doc.edges.iter().position(|edge| edge.id == *id) else {
            return Err(DiagramError::new(format!(
                "cannot remove missing edge {id:?}"
            )));
        };
        doc.edges.remove(index);
    }
    for id in &patch.removed_node_ids {
        let Some(index) = doc.nodes.iter().position(|node| node.id == *id) else {
            return Err(DiagramError::new(format!(
                "cannot remove missing node {id:?}"
            )));
        };
        doc.nodes.remove(index);
    }
    for node in patch.updated_nodes {
        let Some(index) = doc.nodes.iter().position(|old| old.id == node.id) else {
            return Err(DiagramError::new(format!(
                "cannot update missing node {:?}",
                node.id
            )));
        };
        doc.nodes[index] = node;
    }
    for node in patch.added_nodes {
        if doc.nodes.iter().any(|old| old.id == node.id) {
            return Err(DiagramError::new(format!(
                "cannot add existing node {:?}",
                node.id
            )));
        }
        doc.nodes.push(node);
    }
    for edge in patch.updated_edges {
        let Some(index) = doc.edges.iter().position(|old| old.id == edge.id) else {
            return Err(DiagramError::new(format!(
                "cannot update missing edge {:?}",
                edge.id
            )));
        };
        doc.edges[index] = edge;
    }
    for edge in patch.added_edges {
        if doc.edges.iter().any(|old| old.id == edge.id) {
            return Err(DiagramError::new(format!(
                "cannot add existing edge {:?}",
                edge.id
            )));
        }
        doc.edges.push(edge);
    }
    if let Some(title) = patch.title {
        doc.title = title;
    }
    Ok(())
}

fn check_id(kind: &str, value: &str) -> Result<(), DiagramError> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(DiagramError::new(format!(
            "{kind} id must contain 1..=256 non-control characters"
        )));
    }
    Ok(())
}
fn check_text(kind: &str, value: &str) -> Result<(), DiagramError> {
    if value.len() > MAX_TEXT {
        return Err(DiagramError::new(format!(
            "{kind} exceeds {MAX_TEXT} bytes"
        )));
    }
    if value
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\r')
    {
        return Err(DiagramError::new(format!(
            "{kind} contains an unsupported control character"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Engine {
    document: Document,
    undo: Vec<Document>,
    redo: Vec<Document>,
    route_cache: RefCell<HashMap<String, RouteCacheEntry>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RouteNodeKey {
    id: String,
    kind: NodeKind,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl From<&Node> for RouteNodeKey {
    fn from(node: &Node) -> Self {
        Self {
            id: node.id.clone(),
            kind: node.kind,
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
        }
    }
}

impl RouteNodeKey {
    fn matches(&self, node: &Node) -> bool {
        self.id == node.id
            && self.kind == node.kind
            && self.x == node.x
            && self.y == node.y
            && self.width == node.width
            && self.height == node.height
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RouteCacheKey {
    from: RouteNodeKey,
    to: RouteNodeKey,
    from_side: Option<Side>,
    to_side: Option<Side>,
    bounds: RoutingBounds,
    routing_nodes: Vec<RouteNodeKey>,
}

#[derive(Debug, Clone)]
struct RouteCacheEntry {
    key: RouteCacheKey,
    points: Vec<Point>,
}

impl RouteCacheKey {
    fn matches(
        &self,
        edge: &Edge,
        from: &Node,
        to: &Node,
        bounds: RoutingBounds,
        routing_nodes: &[&Node],
    ) -> bool {
        self.from.matches(from)
            && self.to.matches(to)
            && self.from_side == edge.from_side
            && self.to_side == edge.to_side
            && self.bounds == bounds
            && self.routing_nodes.len() == routing_nodes.len()
            && self
                .routing_nodes
                .iter()
                .zip(routing_nodes)
                .all(|(key, node)| key.matches(node))
    }
}

impl Engine {
    pub fn new(json: &str) -> Result<Self, DiagramError> {
        Ok(Self {
            document: parse_document(json)?,
            undo: vec![],
            redo: vec![],
            route_cache: RefCell::new(HashMap::new()),
        })
    }
    pub fn from_document(document: Document) -> Result<Self, DiagramError> {
        validate_document(&document)?;
        Ok(Self {
            document,
            undo: vec![],
            redo: vec![],
            route_cache: RefCell::new(HashMap::new()),
        })
    }
    pub fn document(&self) -> &Document {
        &self.document
    }
    pub fn document_json(&self) -> String {
        serde_json::to_string(&self.document).expect("serializable document")
    }
    pub fn replace(&mut self, json: &str) -> Result<(), DiagramError> {
        let next = parse_document(json)?;
        self.commit(next);
        Ok(())
    }
    pub fn apply_patch_json(&mut self, json: &str) -> Result<(), DiagramError> {
        let patch: DocumentPatch = serde_json::from_str(json).map_err(|e| {
            DiagramError::with_code(
                ErrorCode::InvalidPatchJson,
                format!("invalid document patch JSON: {e}"),
            )
        })?;
        self.apply_patch(patch)
    }
    pub fn apply_patch(&mut self, patch: DocumentPatch) -> Result<(), DiagramError> {
        let mut next = self.document.clone();
        apply_document_patch(&mut next, patch)?;
        validate_document(&next)
            .map_err(|error| error.with_replaced_code(ErrorCode::InvalidPatch))?;
        self.commit(next);
        Ok(())
    }
    fn commit(&mut self, next: Document) {
        if self.undo.len() == MAX_HISTORY {
            self.undo.remove(0);
        }
        self.undo.push(std::mem::replace(&mut self.document, next));
        self.redo.clear();
    }
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }
    pub fn undo(&mut self) -> bool {
        let Some(previous) = self.undo.pop() else {
            return false;
        };
        self.redo
            .push(std::mem::replace(&mut self.document, previous));
        true
    }
    pub fn redo(&mut self) -> bool {
        let Some(next) = self.redo.pop() else {
            return false;
        };
        self.undo.push(std::mem::replace(&mut self.document, next));
        true
    }
    pub fn scene(&self) -> Scene {
        compose_cached(&self.document, false, Some(&self.route_cache))
    }
    pub fn scene_json(&self) -> String {
        serde_json::to_string(&self.scene()).expect("serializable scene")
    }
    pub fn display_scene_json(&self) -> String {
        let scene = self.scene();
        serialize_display_scene(&scene)
    }
    pub fn preview_patch_json(&self, json: &str) -> Result<String, DiagramError> {
        let patch: DocumentPatch = serde_json::from_str(json).map_err(|e| {
            DiagramError::with_code(
                ErrorCode::InvalidPatchJson,
                format!("invalid document patch JSON: {e}"),
            )
        })?;
        let mut document = self.document.clone();
        apply_document_patch(&mut document, patch)?;
        validate_document(&document)
            .map_err(|error| error.with_replaced_code(ErrorCode::InvalidPatch))?;
        Ok(serialize_display_scene(&compose_cached(
            &document,
            false,
            Some(&self.route_cache),
        )))
    }
    pub fn export_text(&self, ascii: bool) -> Result<String, DiagramError> {
        render_text(&compose_cached(
            &self.document,
            ascii,
            Some(&self.route_cache),
        ))
    }
    pub fn export_svg(&self) -> Result<String, DiagramError> {
        render_svg(&self.scene())
    }
}

fn serialize_display_scene(scene: &Scene) -> String {
    serde_json::to_string(&DisplayScene {
        display_cells: &scene.display_cells,
        bounds: &scene.bounds,
        routes: &scene.routes,
    })
    .expect("serializable display scene")
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

impl Side {
    const ALL: [Self; 4] = [Self::Left, Self::Right, Self::Top, Self::Bottom];
    fn delta(self) -> (i32, i32) {
        match self {
            Self::Left => (-1, 0),
            Self::Right => (1, 0),
            Self::Top => (0, -1),
            Self::Bottom => (0, 1),
        }
    }
}

fn port(node: &Node, side: Side) -> Point {
    match side {
        Side::Left => Point {
            x: node.x,
            y: node.y + node.height / 2,
        },
        Side::Right => Point {
            x: node.x + node.width - 1,
            y: node.y + node.height / 2,
        },
        Side::Top => Point {
            x: node.x + node.width / 2,
            y: node.y,
        },
        Side::Bottom => Point {
            x: node.x + node.width / 2,
            y: node.y + node.height - 1,
        },
    }
}

fn offset(point: Point, side: Side) -> Point {
    let (dx, dy) = side.delta();
    Point {
        x: point.x + dx,
        y: point.y + dy,
    }
}

fn compact_points(points: Vec<Point>) -> Vec<Point> {
    let final_index = points.len().saturating_sub(1);
    let mut out: Vec<(Point, usize)> = Vec::with_capacity(points.len());
    for (index, point) in points.into_iter().enumerate() {
        if out.last().map(|item| item.0) == Some(point) {
            let last = out.last_mut().expect("matched last point");
            if last.1 != 1 && index + 1 == final_index {
                last.1 = index;
            }
            continue;
        }
        while out.len() >= 2 {
            let (a, _) = out[out.len() - 2];
            let (b, b_index) = out[out.len() - 1];
            let ab = (
                i64::from(b.x) - i64::from(a.x),
                i64::from(b.y) - i64::from(a.y),
            );
            let bp = (
                i64::from(point.x) - i64::from(b.x),
                i64::from(point.y) - i64::from(b.y),
            );
            if ((a.x == b.x && b.x == point.x) || (a.y == b.y && b.y == point.y))
                && ab.0 * bp.0 + ab.1 * bp.1 > 0
                && b_index != 1
                && b_index + 1 != final_index
            {
                out.pop();
            } else {
                break;
            }
        }
        out.push((point, index));
    }
    out.into_iter().map(|item| item.0).collect()
}

fn compact_candidate(input: &[Point], output: &mut [Point; 7]) -> usize {
    let final_index = input.len().saturating_sub(1);
    let mut source_indices = [0_usize; 7];
    let mut len = 0;
    for (index, &point) in input.iter().enumerate() {
        if len > 0 && output[len - 1] == point {
            if source_indices[len - 1] != 1 && index + 1 == final_index {
                source_indices[len - 1] = index;
            }
            continue;
        }
        while len >= 2 {
            let a = output[len - 2];
            let b = output[len - 1];
            let ab = (
                i64::from(b.x) - i64::from(a.x),
                i64::from(b.y) - i64::from(a.y),
            );
            let bp = (
                i64::from(point.x) - i64::from(b.x),
                i64::from(point.y) - i64::from(b.y),
            );
            if ((a.x == b.x && b.x == point.x) || (a.y == b.y && b.y == point.y))
                && ab.0 * bp.0 + ab.1 * bp.1 > 0
                && source_indices[len - 1] != 1
                && source_indices[len - 1] + 1 != final_index
            {
                len -= 1;
            } else {
                break;
            }
        }
        output[len] = point;
        source_indices[len] = index;
        len += 1;
    }
    len
}

struct CandidateContext<'a> {
    from: &'a Node,
    to: &'a Node,
    obstacles: &'a [Rect],
    source_side: Side,
    target_side: Side,
}

fn consider_candidate(
    input: &[Point],
    scratch: &mut [Point; 7],
    context: &CandidateContext<'_>,
    best: &mut Option<(i64, Vec<Point>)>,
) {
    let len = compact_candidate(input, scratch);
    let candidate = &scratch[..len];
    if len < 2 || candidate[0] == candidate[1] || candidate[len - 2] == candidate[len - 1] {
        return;
    }
    if let Some(score) = route_score(
        candidate,
        context.from,
        context.to,
        context.obstacles,
        context.source_side,
        context.target_side,
    ) {
        // Stable iteration order is the tie breaker.
        if best.as_ref().is_none_or(|(old, _)| score < *old) {
            *best = Some((score, candidate.to_vec()));
        }
    }
}

#[derive(Clone, Copy)]
struct Rect {
    x: i32,
    y: i32,
    right: i32,
    bottom: i32,
}

impl From<&Node> for Rect {
    fn from(node: &Node) -> Self {
        Self {
            x: node.x,
            y: node.y,
            right: node.x + node.width - 1,
            bottom: node.y + node.height - 1,
        }
    }
}

#[inline]
fn segment_rect_cells_rect(a: Point, b: Point, rect: Rect) -> i64 {
    if a.x == b.x {
        if a.x < rect.x || a.x > rect.right {
            return 0;
        }
        let lo = a.y.min(b.y).max(rect.y);
        let hi = a.y.max(b.y).min(rect.bottom);
        i64::from((hi - lo + 1).max(0))
    } else {
        if a.y < rect.y || a.y > rect.bottom {
            return 0;
        }
        let lo = a.x.min(b.x).max(rect.x);
        let hi = a.x.max(b.x).min(rect.right);
        i64::from((hi - lo + 1).max(0))
    }
}

#[cfg(test)]
fn segment_rect_cells(a: Point, b: Point, node: &Node) -> i64 {
    segment_rect_cells_rect(a, b, node.into())
}

fn route_score(
    points: &[Point],
    from: &Node,
    to: &Node,
    obstacles: &[Rect],
    source_side: Side,
    target_side: Side,
) -> Option<i64> {
    for turns in points.windows(3) {
        let a = (turns[1].x - turns[0].x, turns[1].y - turns[0].y);
        let b = (turns[2].x - turns[1].x, turns[2].y - turns[1].y);
        if i64::from(a.0) * i64::from(b.0) + i64::from(a.1) * i64::from(b.1) < 0 {
            return None;
        }
    }
    // The attachment is the only cell a route may share with either endpoint node.
    for (node, first_attachment) in [(from, true), (to, false)] {
        let rect = Rect::from(node);
        for (index, pair) in points.windows(2).enumerate() {
            let is_attachment = if first_attachment {
                index == 0
            } else {
                index + 1 == points.len() - 1
            };
            let allowed = i64::from(is_attachment);
            if segment_rect_cells_rect(pair[0], pair[1], rect) > allowed {
                return None;
            }
        }
    }
    // Score in display pixels: a row is twice as tall as a column is wide.
    let length: i64 = points
        .windows(2)
        .map(|p| i64::from((p[1].x - p[0].x).abs()) * 9 + i64::from((p[1].y - p[0].y).abs()) * 18)
        .sum();
    let mut collisions = 0_i64;
    for rect in obstacles {
        for pair in points.windows(2) {
            collisions += segment_rect_cells_rect(pair[0], pair[1], *rect);
        }
    }
    let from_center = (from.x + from.width / 2, from.y + from.height / 2);
    let to_center = (to.x + to.width / 2, to.y + to.height / 2);
    let toward = (to_center.0 - from_center.0, to_center.1 - from_center.1);
    let source_delta = source_side.delta();
    let target_delta = target_side.delta();
    let facing_penalty =
        i64::from((source_delta.0 * toward.0 + source_delta.1 * toward.1 < 0) as i32)
            + i64::from((target_delta.0 * toward.0 + target_delta.1 * toward.1 > 0) as i32);
    let center_penalty = if source_delta.0 == -target_delta.0 && source_delta.1 == -target_delta.1 {
        let source_stub = points[1];
        let target_stub = points[points.len() - 2];
        if source_delta.0 != 0 {
            let middle = source_stub.x + target_stub.x;
            points
                .windows(2)
                .filter(|pair| pair[0].x == pair[1].x)
                .map(|pair| i64::from((pair[0].x * 2 - middle).abs()) * 9)
                .min()
                .unwrap_or(0)
        } else {
            let middle = source_stub.y + target_stub.y;
            points
                .windows(2)
                .filter(|pair| pair[0].y == pair[1].y)
                .map(|pair| i64::from((pair[0].y * 2 - middle).abs()) * 18)
                .min()
                .unwrap_or(0)
        }
    } else {
        0
    };
    Some(
        collisions * 1_000_000
            + facing_penalty * 10_000
            + length * 10
            + center_penalty
            + points.len() as i64,
    )
}

#[cfg(test)]
fn route(
    from: &Node,
    to: &Node,
    nodes: &[Node],
    from_side: Option<Side>,
    to_side: Option<Side>,
) -> Vec<Point> {
    route_with_bounds(
        from,
        to,
        nodes,
        from_side,
        to_side,
        routing_bounds(nodes, from),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RoutingBounds {
    min_x: i32,
    max_x: i32,
    min_y: i32,
    max_y: i32,
}

fn selected_routing_nodes<'a>(nodes: &'a [Node], from: &Node, to: &Node) -> Vec<&'a Node> {
    let midpoint = Point {
        x: (from.x + from.width / 2 + to.x + to.width / 2) / 2,
        y: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
    };
    let mut selected: Vec<&Node> = nodes.iter().collect();
    selected.sort_by_key(|node| {
        (node.x + node.width / 2 - midpoint.x).abs() + (node.y + node.height / 2 - midpoint.y).abs()
    });
    selected.truncate(MAX_ROUTING_OBSTACLES);
    selected
}

fn cached_route(
    edge: &Edge,
    from: &Node,
    to: &Node,
    nodes: &[Node],
    bounds: RoutingBounds,
    cache: &RefCell<HashMap<String, RouteCacheEntry>>,
) -> Vec<Point> {
    let routing_nodes = selected_routing_nodes(nodes, from, to);
    if let Some(points) = cache
        .borrow()
        .get(&edge.id)
        .filter(|entry| entry.key.matches(edge, from, to, bounds, &routing_nodes))
        .map(|entry| entry.points.clone())
    {
        return points;
    }
    let points = if from.id == to.id && edge.from_side.is_none() && edge.to_side.is_none() {
        route_with_bounds(from, to, nodes, edge.from_side, edge.to_side, bounds)
    } else {
        route_with_selected(
            from,
            to,
            edge.from_side,
            edge.to_side,
            bounds,
            &routing_nodes,
        )
    };
    let key = RouteCacheKey {
        from: from.into(),
        to: to.into(),
        from_side: edge.from_side,
        to_side: edge.to_side,
        bounds,
        routing_nodes: routing_nodes.into_iter().map(RouteNodeKey::from).collect(),
    };
    cache.borrow_mut().insert(
        edge.id.clone(),
        RouteCacheEntry {
            key,
            points: points.clone(),
        },
    );
    points
}

fn routing_bounds(nodes: &[Node], fallback: &Node) -> RoutingBounds {
    let mut bounds = RoutingBounds {
        min_x: fallback.x,
        max_x: fallback.x,
        min_y: fallback.y,
        max_y: fallback.y,
    };
    for node in nodes {
        bounds.min_x = bounds.min_x.min(node.x);
        bounds.max_x = bounds.max_x.max(node.x + node.width - 1);
        bounds.min_y = bounds.min_y.min(node.y);
        bounds.max_y = bounds.max_y.max(node.y + node.height - 1);
    }
    bounds.min_x -= 2;
    bounds.max_x += 2;
    bounds.min_y -= 2;
    bounds.max_y += 2;
    bounds
}

fn route_with_bounds(
    from: &Node,
    to: &Node,
    nodes: &[Node],
    from_side: Option<Side>,
    to_side: Option<Side>,
    bounds: RoutingBounds,
) -> Vec<Point> {
    if from.id == to.id && from_side.is_none() && to_side.is_none() {
        let start = port(from, Side::Right);
        let top = from.y - 2;
        let right = from.x + from.width + 1;
        return compact_points(vec![
            start,
            Point {
                x: right,
                y: start.y,
            },
            Point { x: right, y: top },
            Point {
                x: from.x + from.width / 2,
                y: top,
            },
            port(from, Side::Top),
        ]);
    }
    let routing_nodes = selected_routing_nodes(nodes, from, to);
    route_with_selected(from, to, from_side, to_side, bounds, &routing_nodes)
}

fn route_with_selected(
    from: &Node,
    to: &Node,
    from_side: Option<Side>,
    to_side: Option<Side>,
    bounds: RoutingBounds,
    routing_nodes: &[&Node],
) -> Vec<Point> {
    let RoutingBounds {
        min_x,
        max_x,
        min_y,
        max_y,
    } = bounds;
    let midpoint = Point {
        x: (from.x + from.width / 2 + to.x + to.width / 2) / 2,
        y: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
    };
    let collision_rects: Vec<Rect> = routing_nodes
        .iter()
        .filter(|node| node.kind != NodeKind::Boundary && node.id != from.id && node.id != to.id)
        .map(|node| Rect::from(*node))
        .collect();
    let mut x_lanes = Vec::new();
    let mut y_lanes = Vec::new();
    for node in routing_nodes {
        x_lanes.extend([node.x - 1, node.x + node.width]);
        y_lanes.extend([node.y - 1, node.y + node.height]);
    }
    x_lanes.sort_by_key(|x| (x - midpoint.x).abs());
    y_lanes.sort_by_key(|y| (y - midpoint.y).abs());
    x_lanes.truncate(MAX_ROUTING_LANES);
    y_lanes.truncate(MAX_ROUTING_LANES);
    x_lanes.extend([min_x, max_x]);
    y_lanes.extend([min_y, max_y]);
    x_lanes.sort_unstable();
    x_lanes.dedup();
    y_lanes.sort_unstable();
    y_lanes.dedup();
    let mut best: Option<(i64, Vec<Point>)> = None;
    let source_sides: &[Side] = from_side
        .as_ref()
        .map(std::slice::from_ref)
        .unwrap_or(&Side::ALL);
    let target_sides: &[Side] = to_side
        .as_ref()
        .map(std::slice::from_ref)
        .unwrap_or(&Side::ALL);
    for &source_side in source_sides {
        for &target_side in target_sides {
            let start = port(from, source_side);
            let end = port(to, target_side);
            let source_stub = offset(offset(start, source_side), source_side);
            let target_stub = offset(offset(end, target_side), target_side);
            let middle_x = (source_stub.x + target_stub.x) / 2;
            let middle_y = (source_stub.y + target_stub.y) / 2;
            let mut scratch = [start; 7];
            let context = CandidateContext {
                from,
                to,
                obstacles: &collision_rects,
                source_side,
                target_side,
            };
            for candidate in [
                &[
                    start,
                    source_stub,
                    Point {
                        x: target_stub.x,
                        y: source_stub.y,
                    },
                    target_stub,
                    end,
                ][..],
                &[
                    start,
                    source_stub,
                    Point {
                        x: source_stub.x,
                        y: target_stub.y,
                    },
                    target_stub,
                    end,
                ][..],
                &[
                    start,
                    source_stub,
                    Point {
                        x: middle_x,
                        y: source_stub.y,
                    },
                    Point {
                        x: middle_x,
                        y: target_stub.y,
                    },
                    target_stub,
                    end,
                ][..],
                &[
                    start,
                    source_stub,
                    Point {
                        x: source_stub.x,
                        y: middle_y,
                    },
                    Point {
                        x: target_stub.x,
                        y: middle_y,
                    },
                    target_stub,
                    end,
                ][..],
            ] {
                consider_candidate(candidate, &mut scratch, &context, &mut best);
            }
            if source_stub.x == target_stub.x || source_stub.y == target_stub.y {
                consider_candidate(
                    &[start, source_stub, target_stub, end],
                    &mut scratch,
                    &context,
                    &mut best,
                );
            }
            for &x in &x_lanes {
                let candidate = [
                    start,
                    source_stub,
                    Point {
                        x,
                        y: source_stub.y,
                    },
                    Point {
                        x,
                        y: target_stub.y,
                    },
                    target_stub,
                    end,
                ];
                consider_candidate(&candidate, &mut scratch, &context, &mut best);
            }
            for &y in &y_lanes {
                let candidate = [
                    start,
                    source_stub,
                    Point {
                        x: source_stub.x,
                        y,
                    },
                    Point {
                        x: target_stub.x,
                        y,
                    },
                    target_stub,
                    end,
                ];
                consider_candidate(&candidate, &mut scratch, &context, &mut best);
            }
        }
    }
    best.map(|(_, points)| points).unwrap_or_else(|| {
        let source_side = from_side.unwrap_or(Side::Right);
        let target_side = to_side.unwrap_or(Side::Top);
        let start = port(from, source_side);
        let end = port(to, target_side);
        let source_stub = offset(offset(start, source_side), source_side);
        let target_stub = offset(offset(end, target_side), target_side);
        compact_points(vec![
            start,
            source_stub,
            Point {
                x: max_x,
                y: source_stub.y,
            },
            Point { x: max_x, y: min_y },
            Point {
                x: target_stub.x,
                y: min_y,
            },
            target_stub,
            end,
        ])
    })
}

fn compose_cached(
    doc: &Document,
    ascii: bool,
    cache: Option<&RefCell<HashMap<String, RouteCacheEntry>>>,
) -> Scene {
    let nodes: HashMap<&str, &Node> = doc.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let route_bounds = doc
        .nodes
        .first()
        .map(|fallback| routing_bounds(&doc.nodes, fallback));
    let routes: Vec<Route> = doc
        .edges
        .iter()
        .map(|e| {
            let from = nodes[&e.from.as_str()];
            let to = nodes[&e.to.as_str()];
            let bounds = route_bounds.unwrap_or_else(|| routing_bounds(&doc.nodes, from));
            Route {
                id: e.id.clone(),
                points: cache.map_or_else(
                    || route_with_bounds(from, to, &doc.nodes, e.from_side, e.to_side, bounds),
                    |cache| cached_route(e, from, to, &doc.nodes, bounds, cache),
                ),
            }
        })
        .collect();
    if let Some(cache) = cache {
        let live_edges: HashSet<&str> = doc.edges.iter().map(|edge| edge.id.as_str()).collect();
        cache
            .borrow_mut()
            .retain(|edge_id, _| live_edges.contains(edge_id.as_str()));
    }
    let mut map = BTreeMap::<(i32, i32), char>::new();
    for r in &routes {
        draw_route(&mut map, &r.points, ascii);
    }
    for (edge, route) in doc.edges.iter().zip(&routes) {
        draw_edge_label(&mut map, edge, route, &doc.nodes, ascii);
    }
    for node in &doc.nodes {
        draw_node(&mut map, node, ascii);
    }
    let mut display_map = BTreeMap::<(i32, i32), char>::new();
    for (edge, route) in doc.edges.iter().zip(&routes) {
        draw_edge_label(&mut display_map, edge, route, &doc.nodes, ascii);
    }
    for node in &doc.nodes {
        draw_node(&mut display_map, node, ascii);
    }
    // Keep the node border intact and put the arrowhead on the final outside cell.
    for r in &routes {
        if r.points.len() >= 2 {
            let a = r.points[r.points.len() - 2];
            let b = r.points[r.points.len() - 1];
            let arrow_cell = Point {
                x: b.x - (b.x - a.x).signum(),
                y: b.y - (b.y - a.y).signum(),
            };
            map.insert((arrow_cell.y, arrow_cell.x), arrow(a, b, ascii));
        }
    }
    let cells = map
        .iter()
        .map(|(&(y, x), &ch)| Cell {
            x,
            y,
            ch: ch.to_string(),
        })
        .collect::<Vec<_>>();
    let display_cells = display_map
        .iter()
        .map(|(&(y, x), &ch)| Cell {
            x,
            y,
            ch: ch.to_string(),
        })
        .collect::<Vec<_>>();
    let bounds = bounds_for(&cells);
    Scene {
        cells,
        display_cells,
        bounds,
        routes,
    }
}

fn draw_node(map: &mut BTreeMap<(i32, i32), char>, n: &Node, ascii: bool) {
    if n.kind == NodeKind::Text {
        for y in n.y..n.y + n.height {
            for x in n.x..n.x + n.width {
                map.remove(&(y, x));
            }
        }
        for (dy, line) in n.label.lines().take(n.height as usize).enumerate() {
            for (dx, ch) in line.chars().take(n.width as usize).enumerate() {
                map.insert((n.y + dy as i32, n.x + dx as i32), output_char(ch, ascii));
            }
        }
        return;
    }
    let (tl, tr, bl, br, h, v) = if ascii {
        ('+', '+', '+', '+', '-', '|')
    } else {
        match n.kind {
            NodeKind::Database => ('╔', '╗', '╚', '╝', '═', '║'),
            NodeKind::Queue => ('┌', '┐', '└', '┘', '┄', '┆'),
            NodeKind::Boundary => ('┌', '┐', '└', '┘', '┈', '┊'),
            _ => ('┌', '┐', '└', '┘', '─', '│'),
        }
    };
    let right = n.x + n.width - 1;
    let bottom = n.y + n.height - 1;
    if n.kind != NodeKind::Boundary {
        for y in n.y + 1..bottom {
            for x in n.x + 1..right {
                map.remove(&(y, x));
            }
        }
    }
    for x in n.x..=right {
        map.insert((n.y, x), h);
        map.insert((bottom, x), h);
    }
    for y in n.y..=bottom {
        map.insert((y, n.x), v);
        map.insert((y, right), v);
    }
    map.insert((n.y, n.x), tl);
    map.insert((n.y, right), tr);
    map.insert((bottom, n.x), bl);
    map.insert((bottom, right), br);
    if n.width > 2 && n.height > 2 {
        let mut lines: Vec<String> = n
            .label
            .replace('\r', "")
            .lines()
            .map(str::to_owned)
            .collect();
        lines.truncate((n.height - 2) as usize);
        let start_y = n.y + 1 + ((n.height - 2 - lines.len() as i32) / 2);
        for (line_index, line) in lines.iter().enumerate() {
            let chars: Vec<char> = line.chars().take((n.width - 2) as usize).collect();
            let start_x = n.x + 1 + ((n.width - 2 - chars.len() as i32) / 2);
            for (offset, ch) in chars.into_iter().enumerate() {
                map.insert(
                    (start_y + line_index as i32, start_x + offset as i32),
                    output_char(ch, ascii),
                );
            }
        }
    }
}

fn output_char(ch: char, ascii: bool) -> char {
    if ascii && !ch.is_ascii() { '?' } else { ch }
}

fn draw_edge_label(
    map: &mut BTreeMap<(i32, i32), char>,
    edge: &Edge,
    route: &Route,
    nodes: &[Node],
    ascii: bool,
) {
    let label: Vec<char> = edge
        .label
        .replace(['\n', '\r'], " ")
        .chars()
        .map(|ch| output_char(ch, ascii))
        .collect();
    if label.is_empty() {
        return;
    }
    let internal = route.points.get(1..route.points.len().saturating_sub(1));
    let Some(segment) = internal
        .filter(|points| points.len() >= 2)
        .unwrap_or(&route.points)
        .windows(2)
        .max_by_key(|pair| (pair[1].x - pair[0].x).abs() + (pair[1].y - pair[0].y).abs())
    else {
        return;
    };
    let midpoint = Point {
        x: (segment[0].x + segment[1].x) / 2,
        y: (segment[0].y + segment[1].y) / 2,
    };
    let half = label.len() as i32 / 2;
    let candidates = if segment[0].y == segment[1].y {
        [
            (midpoint.x - half, midpoint.y - 1),
            (midpoint.x - half, midpoint.y + 1),
        ]
    } else {
        [
            (midpoint.x + 1, midpoint.y),
            (midpoint.x - label.len() as i32, midpoint.y),
        ]
    };
    let (x, y) = candidates
        .iter()
        .copied()
        .find(|&(x, y)| {
            (0..label.len() as i32).all(|offset| {
                !nodes.iter().any(|node| {
                    x + offset >= node.x
                        && x + offset < node.x + node.width
                        && y >= node.y
                        && y < node.y + node.height
                })
            })
        })
        .unwrap_or(candidates[0]);
    for (offset, ch) in label.into_iter().enumerate() {
        map.insert((y, x + offset as i32), ch);
    }
}

fn segment_points(a: Point, b: Point) -> Vec<Point> {
    let mut out = vec![];
    if a.x == b.x {
        for y in a.y.min(b.y)..=a.y.max(b.y) {
            out.push(Point { x: a.x, y });
        }
    } else {
        for x in a.x.min(b.x)..=a.x.max(b.x) {
            out.push(Point { x, y: a.y });
        }
    }
    out
}
fn draw_route(map: &mut BTreeMap<(i32, i32), char>, points: &[Point], ascii: bool) {
    let mut route_masks = BTreeMap::<(i32, i32), u8>::new();
    for pair in points.windows(2) {
        let segment = segment_points(pair[0], pair[1]);
        for (index, p) in segment.iter().enumerate() {
            let mut mask = 0;
            if index > 0 {
                mask |= direction(*p, segment[index - 1]);
            }
            if index + 1 < segment.len() {
                mask |= direction(*p, segment[index + 1]);
            }
            route_masks
                .entry((p.y, p.x))
                .and_modify(|old| *old |= mask)
                .or_insert(mask);
        }
    }
    for (position, mask) in route_masks {
        map.entry(position)
            .and_modify(|old| *old = line_glyph(line_mask(*old) | mask, ascii))
            .or_insert_with(|| line_glyph(mask, ascii));
    }
}

const UP: u8 = 1;
const RIGHT: u8 = 2;
const DOWN: u8 = 4;
const LEFT: u8 = 8;

fn direction(from: Point, to: Point) -> u8 {
    if to.x > from.x {
        RIGHT
    } else if to.x < from.x {
        LEFT
    } else if to.y > from.y {
        DOWN
    } else {
        UP
    }
}

fn line_mask(ch: char) -> u8 {
    match ch {
        '─' | '═' | '┄' | '┈' | '-' => LEFT | RIGHT,
        '│' | '║' | '┆' | '┊' | '|' => UP | DOWN,
        '┌' | '╔' => RIGHT | DOWN,
        '┐' | '╗' => LEFT | DOWN,
        '└' | '╚' => RIGHT | UP,
        '┘' | '╝' => LEFT | UP,
        '├' => UP | RIGHT | DOWN,
        '┤' => UP | LEFT | DOWN,
        '┬' => LEFT | RIGHT | DOWN,
        '┴' => LEFT | RIGHT | UP,
        '┼' | '+' => UP | RIGHT | DOWN | LEFT,
        _ => 0,
    }
}

fn line_glyph(mask: u8, ascii: bool) -> char {
    if ascii {
        return if mask & (UP | DOWN) != 0 && mask & (LEFT | RIGHT) != 0 {
            '+'
        } else if mask & (UP | DOWN) != 0 {
            '|'
        } else {
            '-'
        };
    }
    match mask {
        0 | 1 | 4 | 5 => '│',
        2 | 8 | 10 => '─',
        6 => '┌',
        12 => '┐',
        3 => '└',
        9 => '┘',
        7 => '├',
        13 => '┤',
        14 => '┬',
        11 => '┴',
        15 => '┼',
        _ => '─',
    }
}
fn arrow(a: Point, b: Point, ascii: bool) -> char {
    if b.x > a.x {
        if ascii { '>' } else { '▶' }
    } else if b.x < a.x {
        if ascii { '<' } else { '◀' }
    } else if b.y > a.y {
        if ascii { 'v' } else { '▼' }
    } else if ascii {
        '^'
    } else {
        '▲'
    }
}
fn bounds_for(cells: &[Cell]) -> Bounds {
    if cells.is_empty() {
        return Bounds {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        };
    }
    let min_x = cells.iter().map(|c| c.x).min().unwrap();
    let max_x = cells.iter().map(|c| c.x).max().unwrap();
    let min_y = cells.iter().map(|c| c.y).min().unwrap();
    let max_y = cells.iter().map(|c| c.y).max().unwrap();
    Bounds {
        x: min_x,
        y: min_y,
        width: max_x - min_x + 1,
        height: max_y - min_y + 1,
    }
}
fn check_area(b: &Bounds) -> Result<(), DiagramError> {
    let area = i64::from(b.width) * i64::from(b.height);
    if area > MAX_EXPORT_AREA {
        Err(DiagramError::with_code(
            ErrorCode::ExportTooLarge,
            format!("export area {area} exceeds limit {MAX_EXPORT_AREA}"),
        ))
    } else {
        Ok(())
    }
}

pub fn render_text(scene: &Scene) -> Result<String, DiagramError> {
    check_area(&scene.bounds)?;
    if scene.bounds.width == 0 {
        return Ok(String::new());
    }
    let lookup: HashMap<(i32, i32), &str> = scene
        .cells
        .iter()
        .map(|c| ((c.x, c.y), c.ch.as_str()))
        .collect();
    let mut out = String::new();
    for y in scene.bounds.y..scene.bounds.y + scene.bounds.height {
        let mut line = String::new();
        for x in scene.bounds.x..scene.bounds.x + scene.bounds.width {
            line.push_str(lookup.get(&(x, y)).copied().unwrap_or(" "));
        }
        out.push_str(line.trim_end());
        out.push('\n');
    }
    Ok(out)
}

pub fn render_svg(scene: &Scene) -> Result<String, DiagramError> {
    check_area(&scene.bounds)?;
    let cw = 9;
    let ch = 18;
    let width = scene.bounds.width.max(1) * cw;
    let height = scene.bounds.height.max(1) * ch;
    let mut strokes = String::new();
    let mut dashed_strokes = String::new();
    let mut boundary_strokes = String::new();
    let mut double_strokes = String::new();
    let mut text = String::new();
    for c in &scene.display_cells {
        let Some(glyph) = c.ch.chars().next() else {
            continue;
        };
        let mask = line_mask(glyph);
        let cx = f64::from((c.x - scene.bounds.x) * cw) + f64::from(cw) / 2.0;
        let cy = f64::from((c.y - scene.bounds.y) * ch) + f64::from(ch) / 2.0;
        if mask != 0 {
            let target = if matches!(glyph, '═' | '║' | '╔' | '╗' | '╚' | '╝') {
                &mut double_strokes
            } else if matches!(glyph, '┄' | '┆') {
                &mut dashed_strokes
            } else if matches!(glyph, '┈' | '┊') {
                &mut boundary_strokes
            } else {
                &mut strokes
            };
            if mask & UP != 0 {
                target.push_str(&format!("M{cx},{cy}V{}", cy - f64::from(ch) / 2.0));
            }
            if mask & RIGHT != 0 {
                target.push_str(&format!("M{cx},{cy}H{}", cx + f64::from(cw) / 2.0));
            }
            if mask & DOWN != 0 {
                target.push_str(&format!("M{cx},{cy}V{}", cy + f64::from(ch) / 2.0));
            }
            if mask & LEFT != 0 {
                target.push_str(&format!("M{cx},{cy}H{}", cx - f64::from(cw) / 2.0));
            }
        } else {
            text.push_str(&format!(
                "<text x=\"{cx}\" y=\"{cy}\">{}</text>",
                escape_xml(&c.ch)
            ));
        }
    }
    let mut arrows = String::new();
    for route in &scene.routes {
        if route.points.len() < 2 {
            continue;
        }
        let mut path = String::new();
        for (index, point) in route.points.iter().enumerate() {
            let x = f64::from((point.x - scene.bounds.x) * cw) + f64::from(cw) / 2.0;
            let y = f64::from((point.y - scene.bounds.y) * ch) + f64::from(ch) / 2.0;
            path.push_str(&format!("{}{x},{y}", if index == 0 { 'M' } else { 'L' }));
        }
        arrows.push_str(&format!("<path d=\"{path}\" stroke-linejoin=\"round\"/>"));
        let Some(pair) = route.points.windows(2).last() else {
            continue;
        };
        let dx = (pair[1].x - pair[0].x).signum();
        let dy = (pair[1].y - pair[0].y).signum();
        if dx == 0 && dy == 0 {
            continue;
        }
        let tip_x = f64::from((pair[1].x - scene.bounds.x) * cw) + f64::from(cw) / 2.0;
        let tip_y = f64::from((pair[1].y - scene.bounds.y) * ch) + f64::from(ch) / 2.0;
        let dir_x = f64::from(dx);
        let dir_y = f64::from(dy);
        let base_x = tip_x - dir_x * 7.0;
        let base_y = tip_y - dir_y * 7.0;
        let perp_x = -dir_y * 3.5;
        let perp_y = dir_x * 3.5;
        arrows.push_str(&format!(
            "<path fill=\"#9298a3\" stroke=\"none\" d=\"M{tip_x},{tip_y}L{},{}L{},{}Z\"/>",
            base_x + perp_x,
            base_y + perp_y,
            base_x - perp_x,
            base_y - perp_y
        ));
    }
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" viewBox=\"0 0 {width} {height}\"><rect width=\"100%\" height=\"100%\" fill=\"white\"/><g fill=\"none\" stroke=\"#9298a3\" stroke-width=\"1\" stroke-linecap=\"square\"><path d=\"{strokes}\"/><path d=\"{dashed_strokes}\" stroke-dasharray=\"3 3\"/><path d=\"{boundary_strokes}\" stroke=\"#b7bdc6\" stroke-dasharray=\"2 4\"/><path d=\"{double_strokes}\" stroke-width=\"4.35\"/><path d=\"{double_strokes}\" stroke=\"white\" stroke-width=\"2.05\"/>{arrows}</g><g font-family=\"ui-monospace,monospace\" font-size=\"14\" fill=\"#30333b\" text-anchor=\"middle\" dominant-baseline=\"central\">{text}</g></svg>\n"
    ))
}
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn json(label: &str) -> String {
        format!(
            r#"{{"version":1,"title":"t","nodes":[{{"id":"a","kind":"service","label":"{label}","x":0,"y":0,"width":8,"height":3}},{{"id":"b","kind":"database","label":"db","x":12,"y":0,"width":9,"height":3}}],"edges":[{{"id":"e","from":"a","to":"b","label":""}}]}}"#
        )
    }
    #[test]
    fn validates_references_and_duplicates() {
        assert!(Engine::new(r#"{"version":1,"title":"","nodes":[],"edges":[{"id":"e","from":"x","to":"y","label":""}]}"#).unwrap_err().to_string().contains("missing source"));
        assert!(Engine::new(r#"{"version":1,"title":"","nodes":[{"id":"x","kind":"text","label":"","x":0,"y":0,"width":1,"height":1},{"id":"x","kind":"text","label":"","x":0,"y":0,"width":1,"height":1}],"edges":[]}"#).is_err());
    }
    #[test]
    fn contract_errors_have_stable_codes_and_json() {
        let malformed = Engine::new("{").unwrap_err();
        assert_eq!(malformed.code(), ErrorCode::InvalidDocumentJson);
        assert_eq!(malformed.payload().code, ErrorCode::InvalidDocumentJson);
        assert!(
            malformed
                .json()
                .contains("\"code\":\"invalid_document_json\"")
        );
        let unsupported =
            Engine::new(r#"{"version":2,"title":"","nodes":[],"edges":[]}"#).unwrap_err();
        assert_eq!(unsupported.code(), ErrorCode::UnsupportedVersion);
        let unknown =
            Engine::new(r#"{"version":1,"title":"","nodes":[],"edges":[],"extra":true}"#).unwrap();
        assert!(!unknown.document_json().contains("extra"));
        let mut engine = Engine::new(r#"{"version":1,"title":"","nodes":[],"edges":[]}"#).unwrap();
        assert_eq!(
            engine.apply_patch_json("{").unwrap_err().code(),
            ErrorCode::InvalidPatchJson
        );
        assert_eq!(
            engine
                .apply_patch_json(r#"{"removedNodeIds":["missing"]}"#)
                .unwrap_err()
                .code(),
            ErrorCode::InvalidPatch
        );
    }

    #[test]
    fn embedded_contract_schemas_are_json() {
        let document: serde_json::Value = serde_json::from_str(DOCUMENT_SCHEMA_JSON).unwrap();
        let patch: serde_json::Value = serde_json::from_str(PATCH_SCHEMA_JSON).unwrap();
        assert_eq!(document["properties"]["version"]["const"], DOCUMENT_VERSION);
        assert_eq!(document["properties"]["nodes"]["maxItems"], MAX_NODES);
        assert_eq!(document["properties"]["edges"]["maxItems"], MAX_EDGES);
        assert_eq!(
            document["$defs"]["node"]["properties"]["width"]["maximum"],
            MAX_DIMENSION
        );
        assert_eq!(patch["additionalProperties"], false);
        assert!(patch["properties"]["title"]["oneOf"].is_array());
    }
    #[test]
    fn optional_wire_fields_accept_null_and_normalize_to_omitted() {
        let document = r#"{"version":1,"title":"","nodes":[{"id":"a","kind":"service","label":"","groupId":null,"x":0,"y":0,"width":1,"height":1},{"id":"b","kind":"service","label":"","x":2,"y":0,"width":1,"height":1}],"edges":[{"id":"e","from":"a","to":"b","label":"","fromSide":null,"toSide":null}]}"#;
        let mut engine = Engine::new(document).unwrap();
        assert!(!engine.document_json().contains("null"));
        engine.apply_patch_json(r#"{"title":null}"#).unwrap();
        assert_eq!(engine.document().title, "");
    }
    #[test]
    fn connector_and_exports_are_deterministic() {
        let document = json("api").replace("\"label\":\"\"", "\"label\":\"SQL\"");
        let e = Engine::new(&document).unwrap();
        let s = e.scene();
        assert_eq!(s.routes[0].points.first(), Some(&Point { x: 7, y: 1 }));
        assert!(e.export_text(false).unwrap().contains("api"));
        assert!(e.export_text(false).unwrap().contains("SQL"));
        assert!(e.export_text(true).unwrap().contains("-->"));
        assert!(e.export_svg().unwrap().contains("<svg"));
    }
    #[test]
    fn extreme_coordinates_and_controls_return_errors() {
        let minimum = r#"{"version":1,"title":"","nodes":[{"id":"x","kind":"text","label":"x","x":-2147483648,"y":0,"width":1,"height":1}],"edges":[]}"#;
        assert!(
            Engine::new(minimum)
                .unwrap_err()
                .to_string()
                .contains("out of range")
        );
        assert!(
            Engine::new(&json("api\\tkey"))
                .unwrap_err()
                .to_string()
                .contains("control character")
        );
    }
    #[test]
    fn multiline_and_ascii_rendering_follow_grid_policy() {
        let document = json("API ·\\nworker").replace("\"height\":3", "\"height\":5");
        let engine = Engine::new(&document).unwrap();
        let unicode = engine.export_text(false).unwrap();
        assert!(unicode.contains("API"));
        assert!(unicode.contains("worker"));
        let ascii = engine.export_text(true).unwrap();
        assert!(ascii.is_ascii());
        assert!(ascii.contains('?'));
    }
    #[test]
    fn xml_is_escaped() {
        let e = Engine::new(&json("<api>")).unwrap();
        let svg = e.export_svg().unwrap();
        assert!(svg.contains("&lt;"));
        assert!(svg.contains("&gt;"));
    }
    #[test]
    fn undo_redo_and_failed_replace() {
        let mut e = Engine::new(&json("one")).unwrap();
        let before = e.document_json();
        assert!(e.replace("{}").is_err());
        assert_eq!(e.document_json(), before);
        e.replace(&json("two")).unwrap();
        assert!(e.undo());
        assert_eq!(e.document_json(), before);
        assert!(e.redo());
        assert!(e.document_json().contains("two"));
    }
    #[test]
    fn group_ids_are_optional_validated_and_persisted() {
        let mut legacy = Engine::new(&json("api")).unwrap();
        assert_eq!(legacy.document().nodes[0].group_id, None);
        let grouped = json("api").replace(
            "\"label\":\"api\"",
            "\"label\":\"api\",\"groupId\":\"platform\"",
        );
        legacy.replace(&grouped).unwrap();
        assert_eq!(
            legacy.document().nodes[0].group_id.as_deref(),
            Some("platform")
        );
        assert!(legacy.document_json().contains("\"groupId\":\"platform\""));

        let empty = grouped.replace("\"platform\"", "\"\"");
        assert!(
            Engine::new(&empty)
                .unwrap_err()
                .to_string()
                .contains("node group id")
        );
        let oversized = grouped.replace("\"platform\"", &format!("\"{}\"", "g".repeat(257)));
        assert!(Engine::new(&oversized).is_err());
    }

    #[test]
    fn patch_is_atomic_and_records_one_undo_entry() {
        let mut engine = Engine::new(&json("one")).unwrap();
        let before = engine.document_json();
        let invalid = r#"{
            "removedEdgeIds":["e"],
            "updatedNodes":[{"id":"a","kind":"service","label":"changed","x":0,"y":0,"width":0,"height":3}],
            "title":"invalid"
        }"#;
        assert!(engine.apply_patch_json(invalid).is_err());
        assert_eq!(engine.document_json(), before);
        assert!(!engine.can_undo());

        let valid = r#"{
            "updatedNodes":[{"id":"a","kind":"service","label":"two","groupId":"backend","x":1,"y":2,"width":8,"height":3}],
            "addedNodes":[{"id":"c","kind":"queue","label":"jobs","x":24,"y":0,"width":8,"height":3}],
            "addedEdges":[{"id":"ec","from":"b","to":"c","label":"work"}],
            "title":"patched"
        }"#;
        engine.apply_patch_json(valid).unwrap();
        assert_eq!(engine.document().title, "patched");
        assert_eq!(engine.document().nodes.len(), 3);
        assert_eq!(engine.document().edges.len(), 2);
        assert_eq!(
            engine.document().nodes[0].group_id.as_deref(),
            Some("backend")
        );
        assert!(engine.undo());
        assert_eq!(engine.document_json(), before);
        assert!(!engine.undo());
        assert!(engine.redo());
        assert_eq!(engine.document().title, "patched");
    }

    #[test]
    fn patch_rejects_ambiguous_or_missing_operations_atomically() {
        let mut engine = Engine::new(&json("one")).unwrap();
        let before = engine.document_json();
        let ambiguous = r#"{"removedNodeIds":["a"],"addedNodes":[{"id":"a","kind":"text","label":"replacement","x":0,"y":0,"width":4,"height":1}]}"#;
        assert!(engine.apply_patch_json(ambiguous).is_err());
        assert_eq!(engine.document_json(), before);
        assert!(
            engine
                .apply_patch_json(r#"{"removedEdgeIds":["missing"]}"#)
                .is_err()
        );
        assert_eq!(engine.document_json(), before);
        assert!(
            engine
                .apply_patch_json(r#"{"removedNodeIds":["a"]}"#)
                .unwrap_err()
                .to_string()
                .contains("missing source")
        );
        assert_eq!(engine.document_json(), before);
        assert!(!engine.can_undo());
    }
    #[test]
    fn undo_history_is_bounded() {
        let mut engine = Engine::new(&json("initial")).unwrap();
        for revision in 0..=MAX_HISTORY {
            engine.replace(&json(&revision.to_string())).unwrap();
        }
        for _ in 0..MAX_HISTORY {
            assert!(engine.undo());
        }
        assert!(!engine.undo());
    }

    fn node(id: &str, x: i32, y: i32, width: i32, height: i32) -> Node {
        Node {
            id: id.into(),
            kind: NodeKind::Service,
            label: id.into(),
            group_id: None,
            x,
            y,
            width,
            height,
        }
    }

    fn is_border(node: &Node, point: Point) -> bool {
        point.x >= node.x
            && point.x < node.x + node.width
            && point.y >= node.y
            && point.y < node.y + node.height
            && (point.x == node.x
                || point.x == node.x + node.width - 1
                || point.y == node.y
                || point.y == node.y + node.height - 1)
    }

    fn is_interior(node: &Node, point: Point) -> bool {
        point.x > node.x
            && point.x < node.x + node.width - 1
            && point.y > node.y
            && point.y < node.y + node.height - 1
    }

    #[test]
    fn routes_attach_to_borders_with_normal_stubs() {
        for (to_x, to_y) in [(20, 1), (-20, 1), (2, 15), (2, -15), (18, 11), (-18, -11)] {
            let a = node("a", 0, 0, 7, 5);
            let b = node("b", to_x, to_y, 9, 7);
            let points = route(&a, &b, &[a.clone(), b.clone()], None, None);
            let (start, end) = (points[0], *points.last().unwrap());
            let (source_stub, target_stub) = (points[1], points[points.len() - 2]);
            assert!(is_border(&a, start));
            assert!(is_border(&b, end));
            let source_step = Point {
                x: (source_stub.x - start.x).signum(),
                y: (source_stub.y - start.y).signum(),
            };
            let target_step = Point {
                x: (target_stub.x - end.x).signum(),
                y: (target_stub.y - end.y).signum(),
            };
            assert_eq!(source_step.x.abs() + source_step.y.abs(), 1);
            assert_eq!(target_step.x.abs() + target_step.y.abs(), 1);
            assert!(!is_interior(
                &a,
                Point {
                    x: start.x + source_step.x,
                    y: start.y + source_step.y
                }
            ));
            assert!(!is_interior(
                &b,
                Point {
                    x: end.x + target_step.x,
                    y: end.y + target_step.y
                }
            ));
            for pair in points.windows(2) {
                for point in segment_points(pair[0], pair[1]) {
                    if point != start && point != end {
                        assert!(!is_interior(&a, point), "{points:?}");
                        assert!(!is_interior(&b, point), "{points:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn routes_detour_around_ordinary_obstacles() {
        let a = node("a", 0, 2, 5, 3);
        let blocker = node("blocker", 8, 0, 7, 7);
        let b = node("b", 20, 2, 5, 3);
        let points = route(&a, &b, &[a.clone(), blocker.clone(), b.clone()], None, None);
        for pair in points.windows(2) {
            assert_eq!(
                segment_rect_cells(pair[0], pair[1], &blocker),
                0,
                "{points:?}"
            );
        }
    }

    #[test]
    fn bends_use_directional_corners_and_merge_as_junctions() {
        let mut map = BTreeMap::new();
        draw_route(
            &mut map,
            &[
                Point { x: 0, y: 0 },
                Point { x: 3, y: 0 },
                Point { x: 3, y: 2 },
            ],
            false,
        );
        assert_eq!(map[&(0, 3)], '┐');
        draw_route(
            &mut map,
            &[Point { x: 1, y: -1 }, Point { x: 1, y: 1 }],
            false,
        );
        assert_eq!(map[&(0, 1)], '┼');
    }

    #[test]
    fn labels_are_unprefixed_and_arrow_stops_outside_preserved_border() {
        let engine = Engine::new(&json("api")).unwrap();
        let scene = engine.scene();
        let cells: HashMap<_, _> = scene
            .cells
            .iter()
            .map(|c| ((c.x, c.y), c.ch.as_str()))
            .collect();
        assert_eq!(cells[&(12, 1)], "║");
        assert_eq!(cells[&(11, 1)], "▶");
        let text = engine.export_text(false).unwrap();
        assert!(!text.contains("[DB]"));
        assert!(text.contains("db"));
    }

    #[test]
    fn node_kinds_have_distinct_neutral_border_styles() {
        let mut unicode = BTreeMap::new();
        let mut database = node("db", 0, 0, 5, 3);
        database.kind = NodeKind::Database;
        let mut queue = node("q", 10, 0, 5, 3);
        queue.kind = NodeKind::Queue;
        let mut boundary = node("b", 20, 0, 5, 3);
        boundary.kind = NodeKind::Boundary;
        draw_node(&mut unicode, &database, false);
        draw_node(&mut unicode, &queue, false);
        draw_node(&mut unicode, &boundary, false);
        assert_eq!(unicode[&(0, 0)], '╔');
        assert_eq!(unicode[&(0, 2)], '═');
        assert_eq!(unicode[&(1, 10)], '┆');
        assert_eq!(unicode[&(0, 12)], '┄');
        assert_eq!(unicode[&(1, 20)], '┊');
        assert_eq!(unicode[&(0, 22)], '┈');

        let mut ascii = BTreeMap::new();
        for item in [&database, &queue, &boundary] {
            draw_node(&mut ascii, item, true);
        }
        assert_eq!(ascii[&(0, 0)], '+');
        assert_eq!(ascii[&(1, 10)], '|');
        assert_eq!(ascii[&(0, 22)], '-');
    }

    #[test]
    fn self_edge_uses_an_explicit_outside_loop() {
        let a = node("a", 5, 5, 7, 5);
        let points = route(&a, &a, std::slice::from_ref(&a), None, None);
        assert!(points.len() >= 5);
        assert!(is_border(&a, points[0]));
        assert!(is_border(&a, *points.last().unwrap()));
        for pair in points.windows(2) {
            for point in segment_points(pair[0], pair[1]) {
                if point != points[0] && point != *points.last().unwrap() {
                    assert!(!is_interior(&a, point));
                }
            }
        }
    }

    #[test]
    fn overlapping_nodes_still_get_normal_nonzero_terminal_segments() {
        let a = node("a", 0, 0, 7, 5);
        let b = node("b", 0, 0, 7, 5);
        let points = route(&a, &b, &[a.clone(), b.clone()], None, None);
        assert!(is_border(&a, points[0]));
        assert!(is_border(&b, *points.last().unwrap()));
        let first = points[1];
        let before_end = points[points.len() - 2];
        assert_ne!(points[0], first);
        assert_ne!(*points.last().unwrap(), before_end);
        assert!(!is_interior(&a, first));
        assert!(!is_interior(&b, before_end));
    }

    #[test]
    fn compact_points_preserves_a_reversal_vertex() {
        let points = compact_points(vec![
            Point { x: 0, y: 0 },
            Point { x: 4, y: 0 },
            Point { x: 2, y: 0 },
        ]);
        assert_eq!(points.len(), 3);
        assert_eq!(points[1], Point { x: 4, y: 0 });
    }

    #[test]
    fn compact_points_handles_long_valid_segments_without_overflow() {
        let points = vec![
            Point {
                x: -1_000_000,
                y: 0,
            },
            Point { x: 1_000_000, y: 0 },
            Point { x: 999_999, y: 0 },
        ];
        assert_eq!(compact_points(points.clone()), points);
        let mut output = [Point { x: 0, y: 0 }; 7];
        let len = compact_candidate(&points, &mut output);
        assert_eq!(&output[..len], points);
    }

    #[test]
    fn stack_candidate_compaction_matches_allocating_reference() {
        let mut state = 0x6d73_6f31_u32;
        for len in 2..=7 {
            for _ in 0..2_000 {
                let mut points = Vec::with_capacity(len);
                let mut point = Point { x: 0, y: 0 };
                points.push(point);
                for _ in 1..len {
                    state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    let distance = ((state >> 8) % 7) as i32 - 3;
                    if state & 1 == 0 {
                        point.x += distance;
                    } else {
                        point.y += distance;
                    }
                    points.push(point);
                }
                let expected = compact_points(points.clone());
                let mut output = [Point { x: 0, y: 0 }; 7];
                let output_len = compact_candidate(&points, &mut output);
                assert_eq!(&output[..output_len], expected, "input: {points:?}");
            }
        }
    }

    #[test]
    fn rectangle_intersection_matches_cell_enumeration() {
        let mut state = 0x726f_7574_u32;
        for _ in 0..10_000 {
            let mut next = || {
                state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
                ((state >> 16) % 31) as i32 - 15
            };
            let node = node(
                "obstacle",
                next(),
                next(),
                next().unsigned_abs() as i32 % 8 + 1,
                next().unsigned_abs() as i32 % 8 + 1,
            );
            let a = Point {
                x: next(),
                y: next(),
            };
            let vertical = next() & 1 == 0;
            let b = if vertical {
                Point { x: a.x, y: next() }
            } else {
                Point { x: next(), y: a.y }
            };
            let expected = segment_points(a, b)
                .into_iter()
                .filter(|point| {
                    point.x >= node.x
                        && point.x < node.x + node.width
                        && point.y >= node.y
                        && point.y < node.y + node.height
                })
                .count() as i64;
            assert_eq!(segment_rect_cells(a, b, &node), expected);
        }
    }

    #[test]
    fn display_scene_and_preview_json_preserve_scene_contract_without_committing() {
        let engine = Engine::new(&json("api")).unwrap();
        let display: serde_json::Value =
            serde_json::from_str(&engine.display_scene_json()).unwrap();
        let full: serde_json::Value = serde_json::from_str(&engine.scene_json()).unwrap();
        assert!(display.get("cells").is_none());
        assert_eq!(display["displayCells"], full["displayCells"]);
        assert_eq!(display["bounds"], full["bounds"]);
        assert_eq!(display["routes"], full["routes"]);

        let before = engine.document_json();
        let preview = engine
            .preview_patch_json(r#"{"updatedNodes":[{"id":"a","kind":"service","label":"api","x":4,"y":2,"width":8,"height":3}]}"#)
            .unwrap();
        let preview: serde_json::Value = serde_json::from_str(&preview).unwrap();
        assert_ne!(preview["displayCells"], display["displayCells"]);
        assert_eq!(engine.document_json(), before);
        assert!(!engine.can_undo());
    }

    #[test]
    fn route_cache_matches_uncached_composition_across_document_changes() {
        let mut engine = Engine::new(&json("api")).unwrap();
        assert_eq!(
            engine.scene(),
            compose_cached(engine.document(), false, None)
        );
        assert_eq!(engine.route_cache.borrow().len(), 1);

        engine
            .apply_patch_json(r#"{"addedNodes":[{"id":"blocker","kind":"queue","label":"q","x":9,"y":-1,"width":3,"height":5}]}"#)
            .unwrap();
        assert_eq!(
            engine.scene(),
            compose_cached(engine.document(), false, None)
        );
        engine
            .apply_patch_json(r#"{"updatedNodes":[{"id":"a","kind":"service","label":"api","x":2,"y":4,"width":8,"height":3}],"updatedEdges":[{"id":"e","from":"a","to":"b","label":"","fromSide":"bottom","toSide":"top"}]}"#)
            .unwrap();
        assert_eq!(
            engine.scene(),
            compose_cached(engine.document(), false, None)
        );

        let document_before_preview = engine.document_json();
        let preview = engine
            .preview_patch_json(r#"{"updatedNodes":[{"id":"blocker","kind":"queue","label":"q","x":30,"y":8,"width":3,"height":5}]}"#)
            .unwrap();
        let preview_document = {
            let mut document = engine.document().clone();
            apply_document_patch(
                &mut document,
                serde_json::from_str(r#"{"updatedNodes":[{"id":"blocker","kind":"queue","label":"q","x":30,"y":8,"width":3,"height":5}]}"#).unwrap(),
            )
            .unwrap();
            document
        };
        let expected = compose_cached(&preview_document, false, None);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&preview).unwrap(),
            serde_json::from_str::<serde_json::Value>(&serialize_display_scene(&expected)).unwrap()
        );
        assert_eq!(engine.document_json(), document_before_preview);
        assert!(
            engine
                .preview_patch_json(r#"{"removedNodeIds":["missing"]}"#)
                .is_err()
        );
        assert_eq!(engine.document_json(), document_before_preview);

        assert!(engine.undo());
        assert_eq!(
            engine.scene(),
            compose_cached(engine.document(), false, None)
        );
        engine
            .apply_patch_json(r#"{"removedEdgeIds":["e"]}"#)
            .unwrap();
        assert_eq!(
            engine.scene(),
            compose_cached(engine.document(), false, None)
        );
        assert!(engine.route_cache.borrow().is_empty());
    }

    #[test]
    fn automatic_routes_use_facing_sides_and_two_cell_terminal_legs() {
        let a = node("a", 0, 0, 7, 5);
        let b = node("b", 20, 0, 7, 5);
        let points = route(&a, &b, &[a.clone(), b.clone()], None, None);
        assert_eq!(points[0], port(&a, Side::Right));
        assert_eq!(*points.last().unwrap(), port(&b, Side::Left));
        assert_eq!(points[1].x - points[0].x, 2);
        assert_eq!(points[points.len() - 2].x - points[points.len() - 1].x, -2);
    }

    #[test]
    fn separated_diagonal_nodes_use_a_centered_dogleg() {
        let a = node("a", 0, 0, 7, 5);
        let b = node("b", 20, 12, 7, 5);
        let points = route(
            &a,
            &b,
            &[a.clone(), b.clone()],
            Some(Side::Right),
            Some(Side::Left),
        );
        let source_stub = points[1];
        let target_stub = points[points.len() - 2];
        let centered_x = (source_stub.x + target_stub.x) / 2;
        assert!(
            points
                .windows(2)
                .any(|pair| pair[0].x == centered_x && pair[1].x == centered_x),
            "{points:?}"
        );
    }

    #[test]
    fn explicit_edge_sides_round_trip_and_constrain_routes() {
        let document = json("api").replace(
            "\"label\":\"\"}",
            "\"label\":\"\",\"fromSide\":\"bottom\",\"toSide\":\"top\"}",
        );
        let engine = Engine::new(&document).unwrap();
        let edge = &engine.document().edges[0];
        assert_eq!(edge.from_side, Some(Side::Bottom));
        assert_eq!(edge.to_side, Some(Side::Top));
        assert!(engine.document_json().contains("\"fromSide\":\"bottom\""));
        let route = &engine.scene().routes[0].points;
        let nodes = &engine.document().nodes;
        assert_eq!(route[0], port(&nodes[0], Side::Bottom));
        assert_eq!(*route.last().unwrap(), port(&nodes[1], Side::Top));
    }

    #[test]
    fn display_cells_exclude_connector_glyphs_but_keep_edge_labels() {
        let document = json("api").replace("\"label\":\"\"", "\"label\":\"SQL\"");
        let engine = Engine::new(&document).unwrap();
        let scene = engine.scene();
        assert!(scene.cells.iter().any(|cell| cell.x == 8 && cell.y == 1));
        assert!(
            !scene
                .display_cells
                .iter()
                .any(|cell| cell.x == 8 && cell.y == 1)
        );
        assert!(scene.display_cells.iter().any(|cell| cell.ch == "S"));
        let json = engine.scene_json();
        assert!(json.contains("\"displayCells\""));
        assert!(
            engine
                .export_svg()
                .unwrap()
                .contains("stroke-linejoin=\"round\"")
        );
    }
}

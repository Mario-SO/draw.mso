# Document and command contract

The portable `.mso` format is versioned JSON. The current version is described by
[`schemas/document-v3.schema.json`](../schemas/document-v3.schema.json). Atomic
edits use [`schemas/document-patch-v3.schema.json`](../schemas/document-patch-v3.schema.json).
The Rust core is the authoritative validator; JSON Schema describes the portable
shape, while the core additionally checks unique IDs, edge references, control
characters, byte limits, and total bounds.

Document, node, and edge objects tolerate unknown fields when reading, and
normalized output drops them. This preserves forward-compatible reads. Patch
objects reject unknown fields so a misspelled operation cannot silently do
nothing. Optional fields may be omitted; nullable endpoint and grouping fields
also accept `null`. Normalized output omits optional fields when unset.

## Versioning and migration

`version` identifies the document contract, not the application release. The
current version is `3`; there is no implied version for a JSON
object that omits it. Readers reject unsupported versions with
`unsupported_version` and never partially load them.

Additive application behavior does not require a new document version when its
files remain valid v1 documents with the same meaning. A change that adds a
persisted field, changes an existing field's meaning, or removes a valid v1 value
requires a new schema and an explicit, deterministic migration in the Rust core.
Migrations must preserve stable node, edge, and group IDs. Writers emit the
current version only after a complete migration validates; failed migrations
leave the source document untouched.

Version 1 input migrates deterministically to version 2. The version changes and
borderless text receives a space fill when it has no explicit fill, preserving
v1's opaque blank cells. Other omitted styles preserve v1 rendering: service uses a single
border, database a double border, queue and boundary dashed borders, and text no
border. Text defaults to left/top alignment; bordered nodes default to
center/middle. Edges default to no start marker, an arrow end marker, a solid
line, and orthogonal routing. Writers emit version 3.

Version 3 adds optional node `title`, a single-line string without control characters.
Version 2 migrates by updating the version; existing nodes render unchanged.
Optional `titlePosition` selects `top-left`, `top-middle` (default), `top-right`,
`bottom-left`, `bottom-middle`, or `bottom-right`. Titles render with a space on
either side in the selected border, independently of body text layout. They clip to the available width without changing stored text.
Empty titles, borderless nodes, boxes narrower than five cells, and one-row boxes
show no title. Removing a border preserves the title for later restoration.

Version 2 adds the `rectangle` node kind. Nodes may specify `border` (`none`,
`single`, `double`, `rounded`, `heavy`, or `dashed`), `textAlign`,
`verticalAlign`, nonnegative integer `padding`, boolean `wrap`, a one-scalar
`fill`, and boolean `shadow`, `hidden`, and `locked`. Hidden nodes and their
incident edges are omitted from composition; `locked` is persisted interaction
metadata. Edges may specify `startArrow` and `endArrow`
(`none`, `arrow`, `diamond`, or `circle`), `lineStyle` (`solid` or `dashed`),
and `routing` (`orthogonal` or `staircase`).

`textDirection` controls character sweep (`right`, `left`, `down`, or `up`) and
`lineDirection` controls the perpendicular progression of lines. They default to
right/down; vertical text defaults its line direction to right. Parallel
character and line directions are invalid. Wrapping uses the available capacity
along the character direction, then alignment positions the resulting physical
text block within the node.

`from` and `to` remain required strings. A nonempty endpoint names an existing
node and must not have the corresponding point. An empty endpoint is free and
requires `fromPoint` or `toPoint` with integer `x` and `y`; it must not specify
the corresponding side.

## Atomic patches

A patch may set `title` and add, update, or remove nodes and edges. Each ID may
appear in only one operation of its entity type. Updates and removals must name
existing entities; additions must use unused IDs. The core applies a patch to a
copy, validates the complete resulting document, and commits one undo entry only
when every operation succeeds. Removing a node therefore requires the same patch
to remove or redirect its incident edges.

`nodeOrder`, when present, is the complete permutation of final node IDs after
the patch's adds, updates, and removals. Its order is back-to-front composition
order. Omitting it preserves the current ordering.

An omitted `title` or an explicit `"title": null` leaves the title unchanged.
Optional arrays must be omitted or contain arrays; `null` is not accepted for
them.

## Stable errors

Core errors contain `code` and `message`. Callers should branch on `code` and
show `message` to people. Codes in v1 are:

- `invalid_document_json`
- `invalid_patch_json`
- `unsupported_version`
- `invalid_document`
- `invalid_patch`
- `export_too_large`

The WASM adapter throws an `Error` whose `message` remains human-readable and
whose `code` contains the stable code. Its `details` property is the serialized
`{code,message}` payload. This preserves normal JavaScript error handling while
allowing agents and applications to respond programmatically.

## CLI

Existing `validate` and `export` commands remain compatible. Input defaults to
stdin when `FILE` is omitted or `-`.

```sh
draw-mso inspect diagram.mso
draw-mso apply-patch --patch change.json diagram.mso > updated.mso
draw-mso schema document
draw-mso schema patch
draw-mso --json-errors validate diagram.mso
```

`inspect` validates and prints normalized, pretty JSON. `apply-patch` prints the
new document and never overwrites its input. `schema` prints the exact schema
embedded in that CLI build. With `--json-errors`, failures are one JSON object on
stderr containing `code` and `message`; without it, the existing `draw-mso:`
human-readable error format is retained.

In addition to the core codes above, the CLI adapter reports `usage`,
`input_read_failed`, `unknown_schema`, `unknown_export_format`, and
`ambiguous_stdin`. These identify invocation and input transport failures before
the core processes a document or patch.

The retired prototype ellipse and diamond node names are accepted only as read aliases for `rectangle`. Normalized files contain boxes; their geometry, text, IDs, and connections are preserved.

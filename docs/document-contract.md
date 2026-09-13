# Document and command contract

The portable `.mso` format is versioned JSON. Version 1 is described by
[`schemas/document-v1.schema.json`](../schemas/document-v1.schema.json). Atomic
edits use [`schemas/document-patch-v1.schema.json`](../schemas/document-patch-v1.schema.json).
The Rust core is the authoritative validator; JSON Schema describes the portable
shape, while the core additionally checks unique IDs, edge references, control
characters, byte limits, and total bounds.

Document, node, and edge objects tolerate unknown fields when reading, and
normalized output drops them. This preserves forward-compatible reads. Patch
objects reject unknown fields so a misspelled operation cannot silently do
nothing. Optional `groupId`, `fromSide`, and `toSide` values may be omitted or
`null`; normalized output omits them when unset.

## Versioning and migration

`version` identifies the document contract, not the application release. The
current and only defined version is `1`; there is no implied version for a JSON
object that omits it. Readers reject unsupported versions with
`unsupported_version` and never partially load them.

Additive application behavior does not require a new document version when its
files remain valid v1 documents with the same meaning. A change that adds a
persisted field, changes an existing field's meaning, or removes a valid v1 value
requires a new schema and an explicit, deterministic migration in the Rust core.
Migrations must preserve stable node, edge, and group IDs. Writers emit the
current version only after a complete migration validates; failed migrations
leave the source document untouched. No legacy migrations are defined yet.

## Atomic patches

A patch may set `title` and add, update, or remove nodes and edges. Each ID may
appear in only one operation of its entity type. Updates and removals must name
existing entities; additions must use unused IDs. The core applies a patch to a
copy, validates the complete resulting document, and commits one undo entry only
when every operation succeeds. Removing a node therefore requires the same patch
to remove or redirect its incident edges.

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

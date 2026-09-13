# Architecture

## Ownership

The Rust `Engine` in a dedicated Web Worker owns the accepted document and undo/redo history. The browser editor holds a read-only mirror for hit testing and interaction previews. A completed gesture creates one atomic patch transaction; pointer movement only changes a transient preview. Rejected documents never replace the current one.

The worker serializes commands. Request IDs pair responses with requests. The browser also serializes transactions, so each change starts from the last accepted document rather than racing with stale state. Exports wait for outstanding edits. Committed changes send added/updated/removed entity patches; Rust validates the resulting document atomically and records one undo entry. Committed changes return the accepted document and a display-only scene. Throttled drag previews (at most 20 requests per second, one in flight) send only changed nodes and return only the display scene, without mutating accepted state or history. The worker sends serialized JSON strings, decoded once by the editor, avoiding structured cloning of large cell object graphs. Terminal-only cells stay in Rust. Import validation uses a temporary engine.

## Rendering

Rust composes sparse character cells and attached connector paths. Terminal exports use the full character composition; browser and SVG rendering use separate node/label cells and continuous connector paths. The TypeScript Canvas renderer performs device-pixel-ratio scaling, visible-cell culling, and one coalesced animation-frame draw after changes; there is no idle animation loop. Camera and drag updates do not update React state every frame. A bundled monospace font provides predictable browser metrics.

A browser spatial index incrementally updates node bounds and narrows pointer hit tests to nearby candidates. Large containers use a bounded overflow path. A sparse row index with binary searches limits cell traversal to the viewport, routes are culled by bounds, and consecutive compatible border strokes are batched. The Rust engine composes at transaction boundaries and for throttled previews, reusing routes when every routing input is unchanged. Each edge has at most one cached route; keys include endpoint geometry and sides, the stable selected obstacle set, and global fallback bounds. Obstacle intersections use analytical rectangle arithmetic, and candidate compaction uses a small stack buffer. Canvas draws bounded rounded elbows and arrowheads directly from routes; node border cells render geometrically. Text exports retain character glyphs. These deliberate v1 limits should be benchmarked before changing the renderer to WebGL.

## Build graph

`web → editor → engine-wasm → diagram-core` and `web → ui`, `editor → renderer`. The native CLI also depends on diagram-core. Portable TypeScript document and patch types live in `diagram-core/contract.ts`; editor and renderer declare dependencies on that package, and renderer re-exports its previous document types. These are type-only imports and do not load the native engine or WASM into the renderer. Rust crates have small package.json wrappers so Turbo can schedule tasks through the pnpm workspace graph. Cargo still resolves and compiles Rust dependencies itself.

The WASM build emits `dist/index.js`, `dist/index.d.ts`, and `dist/index_bg.wasm`. Turbo restores final dist outputs and hashes Rust sources, Cargo.lock, workspace Cargo.toml, and rust-toolchain.toml. Cargo's target directory is not a Turbo artifact. WASM builds use `--no-pack`: the workspace package owns its exports and metadata, and wasm-pack 0.15 otherwise tries to parse a restored generated `dist/package.json` as a dependency map on some rebuilds. Native Cargo verification tasks are uncached and use Cargo's incremental build machinery.

## Files

A `.mso` file is UTF-8 JSON with `version`, `title`, `nodes`, and `edges`. Node coordinates and dimensions are integer character cells. IDs are stable; edges reference node IDs. Version 1 supports service, database, queue, boundary, and text nodes. Optional `groupId` records flat membership without changing existing files; duplication remaps group IDs and internal edge endpoints. Import validates duplicate IDs, references, dimensions, controls, counts, coordinates, and allocation bounds before accepting the document.

Autosave is a convenience copy in IndexedDB, separate from exported user-owned files. The local library stores each document under a stable browser-only ID, with separate active-document and document-order settings. The persisted list order is independent of save timestamps, so opening or editing documents never moves their rows; new documents append and deletion preserves the remaining order. New document, import, and switching flush the outgoing document and reset undo history for the incoming document. The library migration preserves the legacy `documents.current` record as a recovery copy. File validation happens before import or switching replaces the active engine. There is no network document synchronization.

## First-version limits

- Orthogonal routing scores bounded candidates around nearby obstacles. Dense scenes may still have crossings; explicit side bindings attach to side centers; arbitrary points and draggable bend handles are not supported.
- Whole-document undo snapshots and full scene responses increase memory cost on large documents; history is bounded in Rust.
- The core caps node/edge counts and bounding area to avoid excessive allocations. This is an effectively large working canvas, not mathematically unbounded storage.
- Unicode terminal display width differs by font and terminal. One scalar is one logical cell in this version.
- Boundaries are visual outlines; moving one does not move its enclosed nodes.
- No multiplayer, cloud storage, auto-layout, freehand drawing, or PNG export yet.

Tests cover accepted/rejected documents, connector geometry, exports, history, and real browser editing/file workflows. Performance targets from planning remain targets until measured on specified hardware.

## Public contract and measurements

See [the document contract](document-contract.md) for version compatibility, schema discovery, structured error codes, and CLI patch semantics. Rust remains the authoritative validator; schemas describe wire structure while reference integrity and document-wide limits require core validation. Browser and native callers apply the same atomic patches.

See [performance baselines](performance/README.md) for the repeatable measurement workflow. Native and browser benchmarks run as separate, uncached package tasks. Browser instrumentation is opt-in and records local samples only; it is not telemetry. Measure on an otherwise idle machine after compilation has finished. Timing budgets remain provisional until repeated measurements on specified hardware justify them.

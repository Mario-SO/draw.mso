# Architecture

## Ownership

The Rust `Engine` in a dedicated Web Worker owns the accepted document and undo/redo history. The browser editor holds a read-only mirror for hit testing and interaction previews. A completed gesture creates one atomic patch transaction; pointer movement only changes a transient preview. Rejected documents never replace the current one.

The worker serializes commands. Request IDs pair responses with requests. The browser also serializes transactions, so each change starts from the last accepted document rather than racing with stale state. Exports wait for outstanding edits. Committed changes send added/updated/removed entity patches; Rust validates the resulting document atomically and records one undo entry. This v1 still returns a full document/scene snapshot and uses whole-document JSON for throttled drag previews (at most 20 requests per second, one in flight). Preview engines are temporary and do not add undo history. Large-scene optimization should introduce granular commands and compact scene patches, preserving the public package boundaries.

## Rendering

Rust composes sparse character cells and attached connector paths. Terminal exports use the full character composition; browser and SVG rendering use separate node/label cells and continuous connector paths. The TypeScript Canvas renderer performs device-pixel-ratio scaling, visible-cell culling, and one coalesced animation-frame draw after changes; there is no idle animation loop. Camera and drag updates do not update React state every frame. A bundled monospace font provides predictable browser metrics.

A browser spatial index incrementally updates node bounds and narrows pointer hit tests to nearby candidates. Large containers use a bounded overflow path. The renderer still scans cells to cull them. It does not yet use spatial indexing or cached tiles. The Rust engine recomposes the scene at transaction boundaries and for throttled drag previews. Canvas draws bounded rounded elbows and arrowheads directly from routes; node border cells render geometrically. Text exports retain character glyphs. These deliberate v1 limits should be benchmarked before changing the renderer to WebGL.

## Build graph

`web → editor → engine-wasm → diagram-core` and `web → ui`, `editor → renderer`. The native CLI also depends on diagram-core. Rust crates have small package.json wrappers so Turbo can schedule tasks through the pnpm workspace graph. Cargo still resolves and compiles Rust dependencies itself.

The WASM build emits `dist/index.js`, `dist/index.d.ts`, and `dist/index_bg.wasm`. Turbo restores final dist outputs and hashes Rust sources, Cargo.lock, workspace Cargo.toml, and rust-toolchain.toml. Cargo's target directory is not a Turbo artifact. Native Cargo verification tasks are uncached and use Cargo's incremental build machinery.

## Files

A `.mso` file is UTF-8 JSON with `version`, `title`, `nodes`, and `edges`. Node coordinates and dimensions are integer character cells. IDs are stable; edges reference node IDs. Version 1 supports service, database, queue, boundary, and text nodes. Optional `groupId` records flat membership without changing existing files; duplication remaps group IDs and internal edge endpoints. Import validates duplicate IDs, references, dimensions, controls, counts, coordinates, and allocation bounds before accepting the document.

Autosave is a convenience copy in IndexedDB, separate from exported user-owned files. The local library stores each document under a stable browser-only ID, with a separate active-document setting. New document, import, and switching flush the outgoing document and reset undo history for the incoming document. The library migration preserves the legacy `documents.current` record as a recovery copy. File validation happens before import or switching replaces the active engine. There is no network document synchronization.

## First-version limits

- Orthogonal routing scores bounded candidates around nearby obstacles. Dense scenes may still have crossings; explicit side bindings attach to side centers; arbitrary points and draggable bend handles are not supported.
- Whole-document undo snapshots and full scene responses increase memory cost on large documents; history is bounded in Rust.
- The core caps node/edge counts and bounding area to avoid excessive allocations. This is an effectively large working canvas, not mathematically unbounded storage.
- Unicode terminal display width differs by font and terminal. One scalar is one logical cell in this version.
- Boundaries are visual outlines; moving one does not move its enclosed nodes.
- No multiplayer, cloud storage, auto-layout, freehand drawing, or PNG export yet.

Tests cover accepted/rejected documents, connector geometry, exports, history, and real browser editing/file workflows. Performance targets from planning remain targets until measured on specified hardware.

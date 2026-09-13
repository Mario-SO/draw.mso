# draw.mso

A local-first diagram editor for developers. Draw system diagrams on a character grid, then copy them into documentation or export SVG. React handles the interface; a Rust engine owns validated documents, undo history, connector geometry, and text composition. The same engine powers the CLI.

## Start

Requirements: Node.js 22.12+ (tested with 26.8.2), pnpm 11.19.0, Rust 1.96.0, and wasm-pack 0.15.0.

```sh
cargo install wasm-pack --version 0.15.0 --locked
pnpm install
pnpm dev
```

Open http://127.0.0.1:5173. Rust's WASM target is declared in `rust-toolchain.toml`. The first build downloads Rust dependencies. All document processing runs locally; there is no account or application server.

On this development machine, the installed stable toolchain is already Rust 1.96.0. A directory-local rustup override selects it because rustup's download transport could not retrieve a second installation. The repository still pins 1.96.0 for fresh checkouts.

## Editor

The top-left panel button shows or hides a floating document sidebar. New documents and imported files get separate entries, and the active document is restored on reload. Documents stay on this device in IndexedDB; Save downloads a portable `.mso` file. The previous single-document autosave is migrated automatically and retained as a recovery copy.

- Choose a shape in the floating toolbar and click the canvas. Controls for a selected block appear in a contextual inspector.
- Services use single borders, databases double borders, queues dashed borders, and boundaries lighter dashed outlines. Unicode and SVG exports preserve these distinctions.
- Shift-click to add or remove objects from a selection, or drag an empty area to select several. Cmd/Ctrl+A selects all.
- Group a selection with Cmd/Ctrl+G; click any member to select the group. Cmd/Ctrl+Shift+G ungroups. Groups are flat and preserve internal connections when duplicated.
- Use the selection panel to align objects or groups. Moving objects snaps to nearby edges and centers; hold Alt to bypass, or Escape to cancel the gesture.
- Drag to move; drag the lower-right selection handle to resize. Shift constrains a drag to one axis.
- Double-click a block (or press Enter with it selected) to edit multiple lines. Cmd/Ctrl+Enter commits; Escape cancels.
- Select Connect, click a source, then a destination. Hover to reveal ports; click near a border to keep that side attached, or click the center for automatic routing. Select an endpoint to edit or remove its connections in the inspector.
- Scroll to pan, pinch/Ctrl+wheel to zoom, or hold Space and drag.
- Save an editable `.mso` JSON file, export Unicode/ASCII/SVG, or copy Unicode text.
- Autosave uses IndexedDB. Files are the portable backup; browser storage can be cleared by the browser or user.

| Shortcut | Action |
| --- | --- |
| V / H / C | Select / pan / connect |
| S / D / Q / B / T | Service / database / queue / boundary / text |
| F or 1 | Fit diagram |
| Tab on canvas | Cycle through nodes |
| Arrow keys / Shift+arrows | Move selection by 1 / 5 cells |
| Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z | Undo / redo |
| Cmd/Ctrl+D | Duplicate selection and its internal connections |
| Cmd/Ctrl+A | Select all |
| Cmd/Ctrl+G / Shift+Cmd/Ctrl+G | Group / ungroup |
| Delete / Backspace | Delete selection and incident edges |
| Cmd/Ctrl+S | Save file |
| Cmd/Ctrl+C | Copy diagram as Unicode |

## Workspace

| Package | Responsibility |
| --- | --- |
| `apps/web` | React/Vite app, panels and document actions |
| `apps/cli` | Rust stdin/stdout command-line adapter |
| `crates/diagram-core` | Browser-independent Rust engine and exports |
| `packages/engine-wasm` | wasm-bindgen adapter; generated JS/WASM in `dist` |
| `packages/renderer` | Canvas 2D drawing and camera transforms; no React |
| `packages/editor` | Browser input, worker protocol, transient previews, local persistence |
| `packages/ui` | Genuine shadcn Base UI components and theme |
| `packages/typescript-config` | Shared strict TypeScript configuration |

pnpm manages JavaScript packages. Cargo manages Rust crates. Turborepo orchestrates package tasks through explicit workspace dependencies; it does not infer Cargo dependencies in this configuration. Root scripts delegate to Turbo. Generated outputs stay out of Git.

## Check and build

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm --filter @draw/web exec playwright install chromium
pnpm test:e2e
```

The web production output is `apps/web/dist`. Serve it as a static site. Browser tests use Chromium and the actual WASM worker, not a JavaScript engine substitute.

## CLI

```sh
cargo run -p draw-cli -- validate fixtures/event-driven.mso
cargo run -p draw-cli -- export --format unicode fixtures/event-driven.mso
cargo run -p draw-cli -- export --format svg fixtures/event-driven.mso > diagram.svg
cat fixtures/event-driven.mso | cargo run -p draw-cli -- export --format ascii
```

Successful validation is silent. Exports go to stdout; errors go to stderr with a nonzero exit code.

## Version 0.1 scope

This is a working foundation, not a finished replacement for Monodraw. Connectors evaluate bounded orthogonal route candidates to avoid nearby blocks; crowded diagrams can still produce crossings. Boundaries are visual containers, not hierarchical groups. Multi-selection and flat groups are supported; nested groups and scaling multiple objects are not yet supported. Labels use one Unicode scalar per logical cell; wide emoji and combining sequences are not guaranteed to align. ASCII export substitutes unsupported characters. See `docs/architecture.md` for performance choices and current limits.

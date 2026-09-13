# draw.mso

A local-first text drawing and diagram editor. Draw on a character grid, then copy them into documentation or export SVG. React handles the interface; a Rust engine owns validated documents, undo history, connector geometry, and text composition. The same engine powers the CLI.

<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/d30d02d1-b607-4468-a2ee-d1ded6251981" />
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/0ea524d7-f39a-417d-b155-dbd7880390f9" />
<img width="3482" height="2160" alt="CleanShot 2026-09-13 at 17 44 35@2x" src="https://github.com/user-attachments/assets/e149e41f-aa42-432d-907a-6e4144b82420" />
<img width="3482" height="2160" alt="CleanShot 2026-09-13 at 17 45 05@2x" src="https://github.com/user-attachments/assets/bf82d424-fbab-4b5c-948d-442d5603d9b9" />


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

The top-left panel button shows or hides a floating document sidebar. New documents and imported files get separate entries, and the active document is restored on reload. Opening, editing, and saving keep documents in their existing order; new documents append to the list. Double-click the active document (or press F2 while its row is focused) to rename it. Hover over a document to reveal its delete button. Documents stay on this device in IndexedDB; Save downloads a portable `.mso` file. The previous single-document autosave is migrated automatically and retained as a recovery copy.

- Give boxes a separate Title in the inspector. Choose top or bottom and left, middle, or right placement, with body text inside; long titles clip to fit and reappear when widened.
- Draw boxes by dragging; click for a default size. Shapes are general primitives, with border, fill, shadow, and text controls in the contextual inspector.
- Click Text to start an auto-fitting text object, or drag to create a wrapping text frame. Double-click or press Enter to edit; Cmd/Ctrl+Enter commits and Escape cancels. Text supports horizontal/vertical placement, padding, wrapping, and directional layout.
- The Line tool connects shapes or arbitrary grid points. Click two endpoints or drag between them. Side attachments follow shapes as they move. Select a line to configure orthogonal/staircase routing, dashes, markers, and its label; drag an endpoint to reconnect it.
- Fill sets a box’s background character without changing its text. Drawing remains on this device.
- The Objects panel selects, hides, locks, and reorders shapes. Hidden shapes and their connections are excluded from exports; locking prevents canvas movement. This is a flat object list, with the existing flat groups.
- Shift-click to add or remove objects from a selection, or drag an empty area to select several. Cmd/Ctrl+A selects all available objects.
- Group with Cmd/Ctrl+G; click a member to select its group. Cmd/Ctrl+Shift+G ungroups. Duplicate preserves internal connections.
- Align a selection through the selection panel. Movement snaps to nearby edges and centers; Alt bypasses snapping, Shift constrains an axis, and Escape cancels.
- Scroll to pan, pinch/Ctrl+wheel to zoom, or hold Space and drag.
- Save editable `.mso` files, open `.txt` drawings, paste plain text onto the canvas, or export Unicode, ASCII, SVG, and PNG.
- Autosave uses IndexedDB. Files are the portable backup; browser storage can be cleared by the browser or user.

| Shortcut | Action |
| --- | --- |
| V / H | Select / pan |
| R / T / L | Rectangle / text / line |
| B | Fill |
| F or 1 | Fit diagram |
| Tab on canvas | Cycle through nodes |
| Arrow keys / Shift+arrows | Move selection by 1 / 5 cells |
| Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z | Undo / redo |
| Cmd/Ctrl+D | Duplicate selection and internal connections |
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

The web production output is `apps/web/dist`. Serve it as a static site. Browser tests start an isolated production preview on port 4174 and use Chromium with the actual WASM worker. They do not reuse the development server.

## CLI

```sh
cargo run -p draw-cli -- validate fixtures/event-driven.mso
cargo run -p draw-cli -- export --format unicode fixtures/event-driven.mso
cargo run -p draw-cli -- export --format svg fixtures/event-driven.mso > diagram.svg
cat fixtures/event-driven.mso | cargo run -p draw-cli -- export --format ascii
```

Successful validation is silent. Exports go to stdout; errors go to stderr with a nonzero exit code.

## Performance and the document contract

Run `pnpm bench:native` and `pnpm bench:browser` separately for repeatable native-core and production-browser measurements. See [performance baselines](docs/performance/README.md) for methodology and interpretation.

The versioned document and patch schemas, compatibility policy, structured errors, and shared CLI/browser editing semantics are documented in [the document contract](docs/document-contract.md). Portable TypeScript types are exported by `@draw/diagram-core/contract`; the renderer re-exports its existing document types for compatibility.

## Monodraw research and parity

The tooling follows the general-purpose approach studied in [the Monodraw research inventory](docs/monodraw-research.md). It is not yet complete Monodraw parity: FIGlet/fonts, image tracing, custom anchor chains and waypoints, nested groups, snippets, and per-shape character overrides that survive resizing remain future work. Drawing currently uses grouped text surfaces rather than Monodraw's fully editable generated shapes. The inventory distinguishes verified Monodraw behavior from implementation recommendations.

Orthogonal connectors evaluate bounded route candidates; crowded diagrams can still produce crossings. Staircase lines follow grid steps directly. Text uses one Unicode scalar per logical cell; wide emoji and combining sequences are not guaranteed to align. ASCII export substitutes unsupported characters. See [architecture](docs/architecture.md) for performance choices and limits.

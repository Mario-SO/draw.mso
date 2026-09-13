# Working on draw.mso

- Read README.md and docs/architecture.md before changing package boundaries.
- Rust core owns accepted documents, validation, history, composition, and exports. Keep browser APIs out of crates/diagram-core.
- Keep the WASM adapter thin. Keep React out of packages/editor and packages/renderer.
- UI primitives and theme belong to packages/ui; app-specific panels belong to apps/web.
- Root scripts delegate to Turborepo. Define real work in package scripts. Declare workspace dependencies and exact Rust inputs in package Turbo configurations.
- Use Cargo for Rust builds. Cache WASM dist artifacts, not target/. Preserve Cargo.lock and pnpm-lock.yaml.
- Keep transient pointer events outside React state and avoid full-document transactions on each frame.
- Commands: pnpm check; pnpm test; pnpm lint; pnpm build; pnpm test:e2e. Playwright uses isolated browser contexts.
- There is no cloud backend. Do not add document uploads, telemetry, or accounts as a side effect of editor work.

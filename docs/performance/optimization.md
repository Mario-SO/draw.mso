# Measured optimization — 13 September 2026

Measured on the same M4 Pro, Chromium version, viewport, fixtures and sampling settings as the [initial baseline](findings.md). Reports: [native](optimized-native.json), [browser](optimized-browser.json). Values are medians; browser values are medians of seven per-run medians.

| Operation | Medium before → after | Large before → after |
| --- | ---: | ---: |
| Native cold scene composition | 6.873 → 2.262 ms | 30.594 → 12.190 ms |
| Native Unicode export | 6.722 → 2.420 ms | 31.629 → 12.808 ms |
| Browser committed patch round trip, including decode | 13.1 → 10.7 ms | 61.2 → 12.4 ms |
| Worker patch composition and serialization | 9.8 → 1.6 ms | 36.9 → 9.1 ms |
| Canvas paint | 1.2 → 1.0 ms | 3.4 → 2.9 ms |

A [second full browser run](optimized-browser-repeat.json) reproduced patch round trips of 10.7 ms medium and 12.5 ms large.

The large fixture has 300 nodes and 450 edges. Its cold native composition is 60% faster, and its measured browser patch round trip is 80% shorter. Native cold composition deliberately constructs a new engine before every sample; it does not measure a warm route cache. Browser editing benefits from cached unchanged routes.

## Changes

- Replace routing's per-cell obstacle scans with analytical segment/rectangle intersection. Compact candidate paths on the stack, prefilter obstacle rectangles, and compute global bounds once.
- Cache one route per edge against exact routing inputs, including selected obstacles and fallback bounds. Prune deleted edges. Temporary previews share this cache without accepting document edits.
- Send only changed nodes for drag previews. Return display cells and routes without terminal-only cells or an unnecessary accepted-document copy.
- Send serialized JSON through the worker boundary and decode once, avoiding structured cloning of thousands of small objects. Decoding remains included in end-to-end worker timing.
- Index display cells by row and column, cull route bounds, batch compatible border strokes, and avoid rebuilding an unchanged renderer scene.
- Compile production Rust with `opt-level=3` instead of size optimization. Together with the added cache/protocol code, WASM grew from 195.71 to 241.37 kB raw, or 82.49 to 100.27 kB gzip. This is an explicit startup-size/runtime-speed tradeoff; measured gains combine algorithm and compiler changes.

Drag previews now have their own `previewPatch` metric: 4.9 ms medium and 12.4 ms large. The old `preview` metric mixed import validation and gestures, so it is not a like-for-like comparison with the new import-only `preview` metric. Benchmark byte accounting is still opt-in overhead. The reports preserve raw events; these numbers do not promise a frame rate or describe worst-case latency.

## Correctness and limits

All 21 ASCII, Unicode and SVG exports across the seven fixtures matched the saved pre-optimization output byte for byte. Core tests cover route cache invalidation, temporary previews, history, obstacles and extreme coordinates. Type checks, lint, unit tests, production build and all 18 isolated browser tests passed.

Whole-scene composition and bounded whole-document history still cost memory and time. The browser fixture imports auto-fit, so the paint results do not isolate offscreen culling. No GPU renderer or persistent tile cache was introduced. More optimization should follow measurements of sustained editing and fixed-camera offscreen workloads rather than extrapolating from this representative gesture suite.

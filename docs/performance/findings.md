# Initial baseline — 13 September 2026

These measurements were collected on an Apple M4 Pro (12 logical CPUs, 48 GiB RAM). Native measurements use Cargo's optimized bench profile (`opt-level=s`, LTO). Browser measurements use production assets in Chromium 153.0.8010.12, 1440×900, DPR 1. The reports record the base commit and a dirty working tree: this is the initial implementation baseline, not a comparison against the previous commit.

Raw reports: [native](baseline-native.json) and [browser](baseline-browser.json). Native uses five warmups and 30 samples per operation; browser uses two warmups and seven fresh-context repetitions per fixture. Browser values below are medians of per-run medians. They are not worst-case latency or display-presentation measurements.

| Metric | Medium: 64 nodes / 96 edges | Large: 300 nodes / 450 edges |
| --- | ---: | ---: |
| Native document load | 0.029 ms | 0.136 ms |
| Native patch application | 0.012 ms | 0.057 ms |
| Native scene composition | 6.87 ms | 30.59 ms |
| Browser worker patch round trip | 13.10 ms | 61.20 ms |
| Browser worker preview round trip | 11.30 ms | 53.20 ms |
| Browser worker composition + output serialization, patch | 9.80 ms | 36.90 ms |
| Browser Canvas paint | 1.20 ms | 3.40 ms |

For native large-scene composition, p95 was 31.41 ms. Browser patch round-trip p95 across the per-run medians was 62.00 ms for the large fixture. Raw browser event samples are retained for examining actual event tails. The browser's `init` metrics describe the default startup sample before importing a fixture; the fixture dimension identifies the run, not the startup document size.

## Interpretation

Scene production is a stronger first optimization target than Canvas painting for these workloads. Applying a native document patch is cheap compared with recomposing the scene. Browser composition/output and whole-scene transport add substantial work before the renderer paints. The benchmark performs additional JSON byte accounting, so its round trips include measurement overhead; do not attribute the entire native/browser difference to WASM or messaging.

A separate five-second macOS CPU sample of the large native scene workload showed `segment_rect_cells` prominently (1,418 of 4,249 thread samples on that stack), followed by route-point processing, comparisons, sorting, and allocation work inside composition. This is sampling evidence for investigating connector obstacle scoring and composition; it is not a precise exclusive-time breakdown. The profiler loop also includes setup and destruction outside the benchmark's timed operation.

The local diagnostic artifacts are `benchmark-results/native-scene.sample.txt` and `benchmark-results/browser.cpuprofile`. They are ignored working artifacts, regenerated using the documented profiling commands. The Chromium CPU profile covers the main thread; it does not profile the worker's WASM execution. Profiled timing output is kept separate from the unprofiled baseline.

## Next experiment

Profile and reduce repeated routing/composition work for an individual-node move, while preserving route correctness. Then consider compact scene responses to reduce serialization and cloning. Re-run the same fixtures and compare both native composition and browser patch/preview timings. These results do not currently motivate switching Canvas to WebGL.

No automatic regression threshold is imposed from a single machine's initial baseline. The translated offscreen fixture is only exercised natively; a future controlled-camera browser scenario is needed to isolate culling performance. The current browser run measures one representative drag, pan, and zoom sequence per repetition, not a long editing session or peak memory usage.

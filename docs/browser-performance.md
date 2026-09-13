# Browser performance benchmark

The browser benchmark runs the production Vite build in Chromium and imports a deterministic diagram fixture. It records real editor/worker round trips, worker queue and WASM stages, JSON encoding and parsing work, UTF-8 JSON payload sizes, Canvas 2D paint duration, pan input-to-painted-frame latency, navigation-to-ready time, and Chromium's used JavaScript heap size when the browser exposes it.

Build first, then run the package benchmark from the repository root:

```sh
pnpm build
pnpm --filter @draw/web bench:browser
```

The default run performs two warmups and seven recorded repetitions against both `fixtures/benchmarks/medium.mso` and `fixtures/benchmarks/large.mso`, which makes scaling visible. Each repetition uses a fresh isolated browser context. Events within one repetition are reduced to a median, then the report gives the median and p95 across repetitions. Override the defaults with `DRAW_BENCH_WARMUPS`, `DRAW_BENCH_SAMPLES`, or `DRAW_BENCH_FIXTURE` (one path or comma-separated paths, absolute or relative to the repository root).

Response byte accounting remains enabled by default to preserve the existing benchmark behavior. Set `DRAW_BENCH_RESPONSE_BYTES=0` to omit it when measuring transport latency without the extra JSON encoding and UTF-8 counting pass; use `1` to enable it explicitly. Enabled runs record `worker.responseJsonBytes` and the time spent measuring it as `worker.responseByteAccounting`. This time is included in `editor.workerRoundTrip` and excluded from `worker.operation`. Reports record the mode and metric relationship in `methodology.responseByteAccounting`, and the comparison command warns when runs use different methodology. Do not compare on/off timing results directly.

Results are written to the ignored `benchmark-results/browser-latest.json`. The report includes the browser version, operating system, CPU, logical CPU count, installed memory, Git commit, dirty-worktree flag, fixture size, and methodology. Keep the machine idle, use the same power mode, and compare results from the same browser and hardware.

Set `DRAW_BENCH_TRACE=1` to also save a Chromium CPU profile for the first measured repetition. Open DevTools, choose the Performance panel's load-profile action, and select `benchmark-results/browser.cpuprofile`.

Profiled runs write their measurements to `benchmark-results/browser-profiled.json`, leaving the unprofiled baseline untouched. The `offscreen` fixture is intentionally rejected by this harness because import auto-fit changes its camera scenario; it belongs in a future fixed-camera benchmark.

Instrumentation is enabled only by the benchmark's page bootstrap flag. Normal editor sessions do not collect samples or retain a global metrics array. Payload byte metrics are the UTF-8 size of equivalent JSON, not the browser's internal structured-clone transfer size. `worker.wasmReadyWait` measures time awaiting module readiness; it is not WASM execution time. `worker.operation` covers the complete worker command, while the narrower encoding, engine-output, and output-parse metrics make its known stages visible. The JSON report retains raw event samples as well as per-run median aggregation so frame-tail behavior can be analyzed directly.

The harness closes the document sidebar and reads the actual renderer transform through an opt-in benchmark API to target a node. It requires both a new drag preview and a committed patch before continuing. Camera timing covers toolbar zoom and pointer panning. The translated `offscreen` fixture is explicitly unsupported in this browser harness because imports auto-fit the camera; the native fixture remains useful for coordinate coverage, but does not measure culling.

The report records viewport, device pixel ratio, production mode, and whether profiling was enabled. Profiled runs write `browser-profiled.json` instead of replacing `browser-latest.json`. The CPU profile covers the main browser thread; worker execution is represented by worker timing stages and the separate native profile, not that main-thread CPU profile.

When enabled, byte accounting performs extra JSON encoding during instrumented runs, so worker round-trip measurements include that measured benchmark overhead. Use `worker.responseByteAccounting` to quantify it, and compare runs only when their recorded accounting mode matches. Native operation timings and narrower worker stages help separate actual engine work from reporting costs.

After optimization, drag requests are named `previewPatch`; `preview` now measures import validation only. Do not directly compare the old mixed `preview` aggregate with the new import-only metric. Main-thread JSON decoding is recorded as `editor.engineOutputParse` and remains included in `editor.workerRoundTrip`. Responses contain serialized display JSON, excluding terminal cells; their byte metric describes the new wire format.

## Sustained editing and fixed-camera culling

The browser suite also runs `stress.bench.spec.ts`, writing a separate
`benchmark-results/browser-stress-latest.json`. To run it alone after building:

```sh
pnpm --filter @draw/web bench:browser stress.bench.spec.ts
```

It uses the same discarded-run/repetition settings as the representative benchmark.
Each repetition gets a fresh context; discarded runs warm browser/OS caches,
not the measured page’s JavaScript or WASM instance.
`DRAW_BENCH_GESTURES` controls the number of committed drags per editing run
(default 10, minimum 2). Each drag sends 24 pointer moves with a requested 16 ms
pause between them, alternates direction, and must produce a new preview and
accepted patch. Playwright and browser scheduling add overhead to this cadence;
it is not a hardware input sampling rate. Medium and large fixtures use a fixed
camera at zoom 1. The first node has a singleton group ID, so these gestures exercise a single
node and its connected routing. Multi-node group movement needs its own scenario.

Set `DRAW_BENCH_SCENARIOS` to a comma-separated subset of `sustained-medium`,
`sustained-large`, `culling-0`, `culling-300`, and `culling-1200` for a focused
diagnostic run. For example, `DRAW_BENCH_SCENARIOS=sustained-large` isolates the
large editing workload for paired response-byte-accounting runs. Names must be
exact and unique; empty or unknown entries fail before browser contexts are
created. Selected scenarios retain the suite's canonical order. When the variable
is unset, the suite runs all five workloads as before. Fixture metadata contains
only the scenarios selected for that report, so focused reports must be compared
with reports using the same selection.

The culling scenarios retain the small fixture's eight visible nodes and nine
edges, then add 0, 300, or 1,200 disconnected nodes far outside the viewport.
They use the same camera and 120-step pan path. This isolates increasing
**offscreen node** load with unchanged visible content; it does not measure
increasing offscreen edge counts or import speed. The benchmark-only camera
control is installed only when instrumentation is enabled.

Each metric has separate `eventMedian`, `eventP95`, `eventMax`, and `eventCount`
series. Each statistic is computed within a repetition, then summarized across
repetitions. For example, the median of `eventP95` describes a typical run's
slow-event latency, while the p95 of `eventMax` summarizes run maxima. Raw events
remain available. Counts make sparse tail measurements apparent; small sample
counts are exploratory. Stress reports use the distinct `diagram-browser-stress` suite. Compare them
only with other stress reports using matching methodology. Fixture counts and
content hashes identify the workload. Required samples and complete repetition
counts are checked before a report is written.

`browser.activeFrameInterval` samples animation-frame callbacks only while a
pointer gesture is active. It measures browser frame scheduling, including the
benchmark's input pacing, rather than physical presentation or GPU completion.
The probe exists only in the Playwright harness. Idle gaps between gestures are
excluded. Renderer paint and input-to-frame timings retain their existing
Canvas-command-completion semantics. These benchmarks add no normal-session
collection or telemetry, and do not enforce timing-based correctness assertions.

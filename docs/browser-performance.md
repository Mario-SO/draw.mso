# Browser performance benchmark

The browser benchmark runs the production Vite build in Chromium and imports a deterministic diagram fixture. It records real editor/worker round trips, worker queue and WASM stages, JSON encoding and parsing work, UTF-8 JSON payload sizes, Canvas 2D paint duration, pan input-to-painted-frame latency, navigation-to-ready time, and Chromium's used JavaScript heap size when the browser exposes it.

Build first, then run the package benchmark from the repository root:

```sh
pnpm build
pnpm --filter @draw/web bench:browser
```

The default run performs two warmups and seven recorded repetitions against both `fixtures/benchmarks/medium.mso` and `fixtures/benchmarks/large.mso`, which makes scaling visible. Each repetition uses a fresh isolated browser context. Events within one repetition are reduced to a median, then the report gives the median and p95 across repetitions. Override the defaults with `DRAW_BENCH_WARMUPS`, `DRAW_BENCH_SAMPLES`, or `DRAW_BENCH_FIXTURE` (one path or comma-separated paths, absolute or relative to the repository root).

Results are written to the ignored `benchmark-results/browser-latest.json`. The report includes the browser version, operating system, CPU, logical CPU count, installed memory, Git commit, dirty-worktree flag, fixture size, and methodology. Keep the machine idle, use the same power mode, and compare results from the same browser and hardware.

Set `DRAW_BENCH_TRACE=1` to also save a Chromium CPU profile for the first measured repetition. Open DevTools, choose the Performance panel's load-profile action, and select `benchmark-results/browser.cpuprofile`.

Profiled runs write their measurements to `benchmark-results/browser-profiled.json`, leaving the unprofiled baseline untouched. The `offscreen` fixture is intentionally rejected by this harness because import auto-fit changes its camera scenario; it belongs in a future fixed-camera benchmark.

Instrumentation is enabled only by the benchmark's page bootstrap flag. Normal editor sessions do not collect samples or retain a global metrics array. Payload byte metrics are the UTF-8 size of equivalent JSON, not the browser's internal structured-clone transfer size. `worker.wasmReadyWait` measures time awaiting module readiness; it is not WASM execution time. `worker.operation` covers the complete worker command, while the narrower encoding, engine-output, and output-parse metrics make its known stages visible. The JSON report retains raw event samples as well as per-run median aggregation so frame-tail behavior can be analyzed directly.

The harness closes the document sidebar and reads the actual renderer transform through an opt-in, read-only benchmark API to target a node. It requires both a new drag preview and a committed patch before continuing. Camera timing covers toolbar zoom and pointer panning. The translated `offscreen` fixture is explicitly unsupported in this browser harness because imports auto-fit the camera; the native fixture remains useful for coordinate coverage, but does not measure culling.

The report records viewport, device pixel ratio, production mode, and whether profiling was enabled. Profiled runs write `browser-profiled.json` instead of replacing `browser-latest.json`. The CPU profile covers the main browser thread; worker execution is represented by worker timing stages and the separate native profile, not that main-thread CPU profile.

Byte accounting performs extra JSON encoding during instrumented runs, so worker round-trip measurements include that benchmark overhead. Compare like-for-like instrumented runs. Native operation timings and narrower worker stages help separate actual engine work from reporting costs.

After optimization, drag requests are named `previewPatch`; `preview` now measures import validation only. Do not directly compare the old mixed `preview` aggregate with the new import-only metric. Main-thread JSON decoding is recorded as `editor.engineOutputParse` and remains included in `editor.workerRoundTrip`. Responses contain serialized display JSON, excluding terminal cells; their byte metric describes the new wire format.

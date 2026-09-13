# Native performance measurements

The native benchmark measures the Rust engine in Cargo's optimized `bench` profile, which inherits the repository release settings (`opt-level = 3`, LTO, and one codegen unit). It covers JSON load and validation, an atomic node patch, scene composition, undo, and Unicode, ASCII, and SVG export. Setup that is not part of the operation, such as constructing an engine before scene composition, stays outside the timed interval. Each result stays alive until after the clock is read, so result destruction is also excluded.

Run the complete suite on an otherwise idle machine:

```sh
pnpm bench:native -- --output docs/performance/baseline-native.json
```

The defaults are five unrecorded warmups followed by 30 samples for every fixture and operation. The JSON report contains the median, p95, range, fixture sizes, benchmark configuration, Rust versions, Git commit and dirty state, and machine metadata. Nanoseconds are the canonical unit. Compare results from the same machine and toolchain; this is a wall-clock latency benchmark and does not claim portable allocation or peak-memory measurements.

For a quick compile and execution check, select one case and reduce the sample count:

```sh
pnpm --filter @draw/diagram-core bench:native -- --fixture small --operation validate --warmups 0 --samples 2
```

Fixture generation uses fixed formulas rather than randomness. The checked-in standard fixture set can be regenerated for native, WASM, browser, and renderer measurements with:

```sh
pnpm --filter @draw/diagram-core bench:native -- --write-fixtures fixtures/benchmarks
```

The set includes `small`, `medium`, `large`, `dense`, `long-labels`, `boundaries`, and `offscreen`. Generated `manifest.json` records the exact node, edge, and byte counts. `--fixture NAME` and `--operation NAME` restrict benchmark execution; `--list-fixtures` prints the available fixture names.

For CPU profiling, the harness can repeat one case long enough to attach a profiler without storing per-iteration timings:

```sh
pnpm --filter @draw/diagram-core bench:native -- --fixture large --operation scene --profile-seconds 30
```

On macOS, start that command and attach Instruments' Time Profiler to the printed PID, or run `sample PID 10 -file /tmp/draw-native.sample`. On Linux, wrap the command with `perf record --call-graph dwarf -- pnpm --filter @draw/diagram-core bench:native -- --fixture large --operation scene --profile-seconds 30`, then inspect it with `perf report`. Profiling output is diagnostic and is separate from the latency baseline.

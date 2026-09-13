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

## Warm browser-path stages

Three native cases isolate the browser display path without browser timers or
worker transport:

- `display-warm`: create an engine, compose once to prime its derived caches,
  apply the representative one-node patch outside the timer, then time display
  composition alone.
- `display-serialize`: perform that same setup and composition outside the timer,
  then time serialization of the borrowed display projection only.
- `preview-warm`: prime the caches, then time the actual temporary patch API,
  including document cloning, validation, display composition and serialization.

For example:

```sh
pnpm --filter @draw/diagram-core bench:native -- --fixture large --operation display-warm
pnpm --filter @draw/diagram-core bench:native -- --fixture large --operation display-serialize
pnpm --filter @draw/diagram-core bench:native -- --fixture large --operation preview-warm
```

Every sample starts from a fresh engine whose caches are explicitly primed; the
cases measure one changed node, not a growing editing history. Results remain
alive until after the timer is read. Native timings cannot be substituted for
WASM or browser round-trip timings.

Portable fixture output stays version 1. The harness now migrates a copy through
`Engine::from_document` before direct validation/editing measurements, matching
the current engine's accepted-document contract. Load measurements still receive
the original version-1 JSON and include migration. This also fixes the old
harness failure caused by directly validating version-1 fixture objects against
the current document version. Fixture byte counts describe the portable input.

For a warm preview CPU profile, use `--operation preview-warm --profile-seconds 30`.
That profiling mode creates and primes one engine, then alternates two nearby
one-node preview patches against it. This retains derived caches as the live
editor does and avoids spending most samples on repeated cold-engine setup.
The report's `profileMode` identifies this behavior. The profiler includes output
destruction and runs as fast as possible; it is diagnostic and separate from the
latency samples above. Other profile operations retain the existing setup loop.

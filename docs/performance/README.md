# Performance baselines

The benchmark suite measures the current implementation. Checked-in reports preserve both the initial baseline and the optimized build. Run native and browser measurements separately, on an otherwise idle machine, after builds and verification finish. Turbo does not cache benchmark results.

```sh
pnpm bench:native
pnpm bench:browser
```

See [native measurements](../native-performance.md) and [browser measurements](../browser-performance.md) for options, fixtures, output locations, and profiling instructions.

To compare two saved reports from the same suite:

```sh
pnpm bench:compare -- docs/performance/baseline-native.json benchmark-results/native-latest.json
```

The comparison prints JSON with absolute values, percentage changes, and warnings for mismatched environments or missing metrics. A zero baseline produces a null percentage. It does not enforce a regression budget.

Read the [initial measured findings](findings.md) and [optimization results](optimization.md) for the before/after evidence.

## Interpreting results

- Compare the same fixture, metric, build profile, hardware, browser, viewport, and device pixel ratio. Record the commit and whether the working tree was dirty.
- Native core timings do not include browser worker transport or Canvas drawing. Browser round trips include several stages; do not sum overlapping metrics.
- Median describes a typical sample; p95 describes the slow tail of the collected samples. Small sample counts are exploratory, especially for p95.
- Frame paint duration measures JavaScript drawing work. Input-to-frame measurements end when Canvas commands have been issued; they do not measure physical display presentation or GPU completion.
- Heap and WASM memory readings, when available, are snapshots of particular memory domains, not total application RAM or peak allocations.
- Profiling adds overhead. Use a separate profiling run to explain a baseline result, not as a direct replacement for an unprofiled timing run.
- A single machine's baseline is evidence about that environment, not a universal performance guarantee. Repeat suspicious changes before calling them regressions.

## What to optimize next

Use the stage breakdown to choose the next change. Current hypotheses include whole-document preview construction, scene serialization and copying, full-scene composition, visible-cell scanning, and undo snapshots. Preserve the accepted-document/history boundary in Rust and keep transient gestures outside React state.

Do not add timing-based correctness assertions to ordinary tests. Once measurements are stable across repeated runs on controlled hardware, establish explicit budgets for representative workloads and compare against a recorded baseline.

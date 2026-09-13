# Routing obstacle selection — 13 September 2026

This experiment targets the bounded obstacle-selection step used by orthogonal
routing. The engine considers at most 64 nearby nodes for each route. Previously,
it stably sorted every node by Manhattan distance from the edge midpoint and then
truncated the list. The accepted change keeps the same selected nodes and order,
but avoids fully sorting candidates that will be discarded.

## Why this was the next target

New native cases separated the warm browser display path into composition,
serialization, and the complete temporary-preview operation. On the 300-node,
450-edge large fixture, the baseline medians were 4.166 ms for warm display
composition, 0.361 ms for display serialization, and 4.724 ms for the full warm
preview. These stages overlap and must not be added, but their relative sizes
showed that composition remained the main native cost.

A macOS sampling profile reinforced that result. `selected_routing_nodes` was on
812 of 2,546 sampled main-thread stacks, about 32%. Most of those samples were in
the stable full sort. Sampling counts identify where to investigate; they are not
exclusive timing percentages.

The native measurement harness preserves the checked-in version-1 fixture bytes
for load measurements and fixture byte counts. It migrates a separate copy through
`Engine::from_document` for direct validation, composition, and editing work, so
the measured document matches the current accepted-document contract. Fixture
generation and the checked-in benchmark inputs are unchanged.

## Candidates and decision

An earlier node-fragment cache did not improve the relevant stage: large warm
display composition changed from 4.166 to 4.148 ms, about 0.4%. It added state
without a measurable benefit and was reverted.

The first routing-selection candidate maintained a fixed 64-entry maximum heap.
It was also rejected. Against the repeated baseline, large preview median improved
only from 5.003 to 4.728 ms, while dense regressed from 1.937 to 2.111 ms,
boundaries from 1.608 to 1.724 ms, and offscreen from 2.251 to 2.304 ms. The file
named `routing-preview-after.json` contains this rejected heap result; it is not
the final candidate.

The accepted implementation builds `(distance, document_index)` tuples, uses
partial selection to partition at the 64-node cap, truncates the discarded tail,
then sorts only the retained tuples. The tuple defines a total order: distance is
primary and document index breaks ties. This exactly reproduces the previous
stable sort's document-order behavior, including when many nodes have the same
distance. Tests compare the implementation with the stable full-sort reference
for varied distances, more than 64 tied nodes, a small input, and an empty input.

## Native result

Both compared runs used the M4 Pro, Rust 1.96.0, the optimized bench profile,
five discarded warmups, and 30 measured samples per fixture. The baseline was
repeated immediately before the final partial-selection run. Values are warm
preview medians and p95s in milliseconds.

| Fixture | Baseline median | Partial median | Change | Baseline p95 | Partial p95 | Change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| small | 0.127 | 0.218 | +72% | 0.134 | 0.285 | +113% |
| medium | 2.243 | 2.121 | −5% | 2.533 | 2.553 | +1% |
| large | 5.003 | 3.832 | −23% | 5.213 | 3.922 | −25% |
| dense | 1.937 | 1.832 | −5% | 2.016 | 1.968 | −2% |
| long labels | 1.329 | 1.297 | −2% | 1.349 | 1.431 | +6% |
| boundaries | 1.608 | 1.569 | −2% | 1.660 | 1.696 | +2% |
| offscreen | 2.251 | 2.129 | −5% | 2.452 | 2.186 | −11% |

The large workload is the clear result. Other non-small median changes are modest,
and their tails are mixed. The 30-sample small result was unstable across nearby
baseline runs, so it was repeated with 100 warmups and 100 samples. In that focused
run, median changed from 0.101875 to 0.098417 ms while p95 changed from 0.107000
to 0.121958 ms. This experiment therefore makes no small-fixture speed claim.

The saved local evidence (also collected in the native experiment report below) is `routing-preview-baseline-repeat.json` for the
baseline, `routing-preview-partial.json` for the accepted implementation,
`routing-preview-after.json` for the rejected heap candidate, and
`routing-small-before.json` / `routing-small-after.json` for the focused small
check. All reports record a dirty working tree because benchmark and documentation
work was present; the compared native runs otherwise record matching machine,
toolchain, fixture, operation, and sampling configuration.

## Separating benchmark overhead

The browser harness previously computed an equivalent JSON response size on every
instrumented worker reply. That required an extra JSON encoding and UTF-8 counting
pass inside the measured round trip. Response byte accounting is now an explicit
recorded mode, remains enabled by default for continuity, and can be disabled for
a focused diagnostic. When enabled, its own `worker.responseByteAccounting`
duration remains outside `worker.operation` and inside `editor.workerRoundTrip`.
Reports record this relationship and the comparison tool warns when modes differ.

On the large sustained-editing diagnostic, the median of seven per-run event
medians was 1.7 ms for response byte accounting. Turning it off changed preview
round trip from 9.0 to 7.2 ms while `worker.engineOutput` remained 6.2 ms. This
measures instrumentation overhead; normal editor sessions never enable benchmark
instrumentation. The result also supports keeping native engine
work separate from response-accounting and transport conclusions.

## Browser end-to-end result

Both production-browser runs used all five stress scenarios, two discarded runs,
seven measured isolated contexts, ten drags per editing run, and response byte
accounting **enabled**. Hardware, Chromium, viewport, fixtures, and methodology
match. The baseline used the original full sort; the final build uses partial
selection. No builds or tests ran alongside the timed workloads.

Values below are medians across seven per-run event statistics, in milliseconds.
The p95 column describes a typical run's slow events, not physical presentation.

| Metric | Baseline event median | Final event median | Baseline event p95 | Final event p95 |
| --- | ---: | ---: | ---: | ---: |
| Large preview round trip | 9.0 | 7.1 | 15.8 | 8.9 |
| Large preview engine output | 6.2 | 4.2 | 7.9 | 5.9 |
| Large committed-patch round trip | 12.9 | 12.5 | 15.9 | 16.6 |
| Large committed-patch engine output | 5.6 | 3.8 | 5.9 | 4.0 |
| Medium preview round trip | 1.7 | 1.7 | 4.9 | 5.0 |
| Medium committed-patch round trip | 13.7 | 13.2 | 15.0 | 14.2 |
| Large Canvas paint | 1.8 | 1.9 | 2.1 | 2.1 |
| Paint with 1,200 extra offscreen nodes | 1.3 | 1.3 | 1.4 | 1.4 |

Large preview round trip improved 21% at the event median and 44% at event p95;
its engine output median improved 32%. Commit round trips did not improve nearly
as much, despite cheaper engine output, and their tail increased slightly. Medium
previews and fixed-camera paint were essentially unchanged. The clear browser
benefit is sustained large-diagram preview latency.

## Saved evidence

[Native experiments](routing-native-experiments.json) preserve every native report
under a descriptive candidate name, including rejected candidates and the focused
small-fixture check. The browser [baseline](routing-browser-before.json),
[final candidate](routing-browser-after.json), and separate
[accounting-off diagnostic](routing-accounting-off.json) retain aggregates and
metadata. Each browser report links its compressed raw events with the SHA-256
of the uncompressed array. The accounting-off report uses only the large scenario
and a different measurement mode; compare it only as the diagnostic described
above. The before/final comparison reports no compatibility warnings.

```sh
pnpm bench:compare -- docs/performance/routing-browser-before.json docs/performance/routing-browser-after.json
```

Full uncompressed reports and the native sampling profile remain in local
`benchmark-results/`. Next, investigate committed-patch work outside engine output
and add genuine multi-node drag/history-memory workloads before a broader cache
or transport redesign.

## Correctness and validation

The partial-selection change preserves the exact ordered obstacle set used by
routing and its route-cache key. The full repository checks passed: `pnpm check`,
`pnpm test`, `pnpm lint`, `pnpm build`, and all 29 isolated Playwright end-to-end
tests. Independent reviews covered both the selection-equivalence logic and the
measurement design. No benchmark result establishes a universal latency or frame
rate guarantee; these are local measurements on the recorded machine.

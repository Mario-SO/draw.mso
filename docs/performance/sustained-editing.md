# Sustained editing and culling — 13 September 2026

The stress suite adds ten successive drags on medium/large diagrams and a
controlled-camera pan with 0, 300, or 1,200 additional offscreen nodes. It records
individual-event tails instead of hiding them inside each run's median.
See [methodology](../browser-performance.md#sustained-editing-and-fixed-camera-culling).

The first run used the production assets from commit `82829c4`, before the
snapping cache and renderer scan guard. An intermediate run uses those two
changes; the final candidate also skips unused terminal composition for browser
responses.
All three use two discarded runs and seven measured isolated contexts per scenario,
1440×900 at DPR 1, on the same machine and Chromium version. Builds and tests
completed before collecting each run. Reports record dirty working trees because
other workspace work and benchmark documentation were present. This is a local
experiment, not a controlled-hardware performance guarantee.

The baseline's suite identifier and fixture metadata were normalized after
capture to match the finalized stress report format. Its timings and raw samples
are unchanged; the report records the migration explicitly. The workload inputs,
pointer sequence, pauses, and aggregation are the same in all three runs. The finalized
harness adds sample-completeness assertions and hashes the exact imported bytes.

## Measured results

Values below are the median of seven **per-run event p95** values, in milliseconds.
They describe a typical run's slow events, not physical display presentation.
Each editing run includes ten commits; commit p95 therefore equals that run's
slowest sampled commit. Preview runs contain more events and retain their raw tails.

| Metric | Before | Final | Change |
| --- | ---: | ---: | ---: |
| Large preview round trip | 23.1 | 15.4 | −33% |
| Large committed-patch round trip | 21.6 | 15.7 | −27% |
| Large preview composition + serialization | 11.1 | 8.1 | −27% |
| Large patch composition + serialization | 9.1 | 6.0 | −34% |
| Medium preview round trip | 5.7 | 5.1 | −11% |
| Medium committed-patch round trip | 14.8 | 15.4 | +4% |
| Large Canvas paint | 2.0 | 2.1 | +0.1 ms |
| Paint with 1,200 extra offscreen nodes | 1.4 | 1.4 | unchanged |

The comparison reported no fixture, methodology, or environment mismatches.
Large-document engine output and round trips improved together. Medium commit
tails did not improve, and paint differences are small; this is not a blanket
speedup claim. Active-frame p95 stayed around 16.7–16.8 ms in these paced,
headless runs. No performance budget or universal frame-rate guarantee follows
from this one machine's measurements.

## Changes and correctness

Stationary snapping anchors are indexed once when a move starts and reused across
pointer events. A replacement accepted document refreshes the cache, including
keyboard edits or undo during a held gesture. Moving nodes remain excluded;
shared anchors retain document-order precedence; Alt bypass and Shift constraints
keep their existing behavior. The renderer also skips an unnecessary full-node
filter when no drag preview exists.

Type checks, lint, unit tests, production build and all 29 isolated browser tests
passed. New regression tests cover selection exclusion, target ordering, axis
constraints and cache refresh. All 48 Rust tests pass; new parity tests compare
exact display JSON against full composition across all seven fixtures and sparse
edge cases. Independent review checked the dashed-path bounds semantics.
Document/history ownership stays in Rust; normal sessions collect no benchmark
samples.

## Interpretation

The intermediate main-thread changes alone produced no meaningful end-to-end
speedup: large preview event p95 was 23.1 → 23.5 ms, and paint stayed at 2.0 ms.
This led to the display-only Rust path, which removes terminal glyph-map/cell
construction and duplicate node/label drawing from browser responses. Full scene,
text and SVG exports retain their existing path. Response contents are unchanged.
The baseline's large-preview response
was about 591 KB versus a 148-byte request (median of per-run event p95 values).
Encoding and byte accounting add benchmark overhead, so the round-trip difference
from the narrower worker stage must not be attributed entirely to transport.

Fixed-camera paint changed little as offscreen node count increased. The present
measurements do not justify a renderer rewrite. Next, isolate remaining
serialization and byte-accounting overhead for warm preview responses before
choosing a compact response or incremental scene experiment. Multi-node movement,
long-session memory/history, and offscreen-edge scaling remain separate workloads
to add; the current first-node group contains only one node.

## Saved evidence

The readable JSON reports retain every aggregate and fixture/environment metadata:
[before](stress-before.json), [main-thread changes](stress-main-thread.json), and
[final candidate](stress-after.json). Each report links its losslessly compressed
raw event array through `rawRunsAttachment`, with the uncompressed SHA-256 and
run count. Full uncompressed reports also remain in local `benchmark-results/`.
The comparison command reads the metric summaries directly; raw arrays are only
needed for event-level analysis.

```sh
pnpm bench:compare -- docs/performance/stress-before.json docs/performance/stress-after.json
```

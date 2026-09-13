# Arrow implementation study

Reviewed tldraw commit `ffd1e744a5b49a15d1db9f546ca97c8422eae0ac` on 2026-09-13. This is an architectural reference, not a vendored dependency or copied implementation.

## Relevant source

- [Binding schema](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tlschema/src/bindings/TLArrowBinding.ts): separates terminals and normalized anchors, with explicit snapping modes.
- [Elbow geometry](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tldraw/src/lib/shapes/arrow/elbow/getElbowArrowInfo.tsx): accounts for minimum leg lengths, uses the gap midpoint, intersects terminal geometry, and repairs tiny end nubs.
- [Automatic side selection](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tldraw/src/lib/shapes/arrow/elbow/routes/routeArrowWithAutoEdgePicking.tsx): prefers meaningful side pairs and has a deterministic axis bias to avoid flicker.
- [Arrow drawing](https://github.com/tldraw/tldraw/blob/ffd1e744a5b49a15d1db9f546ca97c8422eae0ac/packages/tldraw/src/lib/shapes/arrow/ArrowShapeUtil.tsx): renders body paths, arrowheads, labels, and clipping as separate geometry.

## Changes in draw.mso

The previous canvas reconstructed arrow bodies from merged text-export glyphs, then patched the endpoints. That made independent arrows visually merge at crossings and coupled browser drawing to text layout. The scene now supplies display cells separately from terminal-text composition; Canvas draws each route as one continuous path with bounded corner radii and an independently sized arrowhead.

Near-border clicks record a side binding; center clicks retain automatic side selection. Bindings remain relative to the node, so movement and resizing resolve against its current geometry. This first version binds to side centers, not arbitrary normalized positions. Hover ports expose the available sides. The right-side port marker also had an incorrect vertical coordinate; it now matches the actual engine port.

Routing remains a Rust responsibility. Scoring must use physical cell dimensions (9 by 18 pixels), not square-grid distances. Short legs need space for arrowheads and bends, while explicit bindings must survive document serialization and history.

The upstream repository currently has a custom license. No tldraw runtime package or source implementation was added to this app.

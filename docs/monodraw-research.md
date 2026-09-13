# Monodraw Tooling and Interaction Research

This inventory is based primarily on Monodraw's current official website, the official Helftone development blog, the current App Store listing, and the help book bundled with the official Monodraw 1.7.1 trial. The help book still labels itself “1.0 documentation,” so behavior confirmed only there is marked accordingly. Recommendations are implementation judgments for draw.mso rather than claims about Monodraw.

## Product model

Monodraw is a character-grid drawing application built around a small set of composable shapes. Boxes, text fields, and free surfaces are variants of one rectangular shape; line labels are ordinary rectangular text shapes attached to lines. This composition model is central to its UX: users learn a few primitives, then combine them instead of choosing from a catalog of domain-specific blocks.[^1][^2]

The canvas is infinite from a top-left origin. Shapes form a tree which establishes z-order. Standard shape content, such as a generated border, can blend with standard content beneath it, so crossing horizontal and vertical lines produce the expected intersection glyph. Custom content sits above generated content and overwrites it. Blending can be disabled per shape.[^3][^4]

**Implication for draw.mso:** replace the developer-specific service/database/queue/boundary palette with general-purpose primitives. The chosen object model uses boxes, text, lines, and groups, with rectangular presets for Box, Text, and Surface. Domain diagrams should be snippets or saved styles, not schema-level node kinds.

## Toolbar and workspace

The current official screenshots show a conventional three-pane editor: a shape tree on the left, an infinite gridded canvas with row/column rulers in the center, and an inspector/character/snippet assistant on the right. The top toolbar contains Select, Pan, Rect, Text, Ellipse, Diamond, Line, Image, Pencil, Bucket Fill, Picker, and Eraser. Separate toolbar controls expose character palettes, export, and pane visibility.[^5]

Most tools have single-letter shortcuts without modifiers. Hover tooltips disclose each shortcut. Escape always returns to Select. Holding Shift while activating a tool keeps it active for repeated creation. Space supports both a momentary Pan tool (hold, drag, release to restore the previous tool) and a latched Pan mode (tap Space, then tap again to restore).[^6]

While creating rectangular shapes, Shift and Option constrain sizing; Option-resize expands or contracts both sides. Shape dimensions remain visible during creation. Holding Shift while moving constrains the movement horizontally or vertically relative to the original position. Option-drag duplicates; Command-D is the keyboard equivalent.[^7]

The left sidebar is not just a layer list. Hovering a row highlights that shape on the canvas. Double-click renames it. Rows directly expose lock and visibility controls. A utility strip groups/ungroups and moves the selection one z-step forward/back; holding Option sends it to the absolute front/back. Shapes can be reordered and nested by dragging in the sidebar, and “Locate” scrolls the canvas to a sidebar shape.[^8][^9]

Alignment guides eliminate manual character counting during move and resize. Grid lines and row/column rulers can be toggled independently, and a configurable page guide can appear at a chosen column. The sidebar and inspector can be collapsed by dragging their dividers or using shortcuts. Monodraw also supports a focus workflow in which unrelated shapes can be locked or hidden while the user zooms into the remaining work.[^5][^10]

**Implication for draw.mso:** the primary toolbar should be a compact row of neutral drawing tools. Put document structure, ordering, lock, and visibility in a real object tree. Keep style and content editing in the contextual inspector. Preserve one-key tool access, Space-to-pan, Escape-to-select/cancel, Shift repeat creation, and Option duplicate/symmetric resize.

## Selection, grouping, and ordering

The Select tool changes selection by clicking canvas shapes. Groups are first-class tree nodes used for movement and duplication. Double-click descends into the deepest currently selected group; Command-click selects the deepest shape directly while ignoring group boundaries. Version 1.6 added simultaneous editing of multiple shapes of the same type.[^6][^11][^12]

Monodraw distinguishes Delete from Backspace during direct character editing: Delete removes shapes, while Backspace moves the character-edit cursor backward. This prevents a text-like editing gesture from unexpectedly deleting an object.[^9]

Selection supports standard grouping, duplication, forward/backward ordering, alignment, distribution, copy/paste, and copy/paste style. A copied style can only be applied to shapes of the same type. Flatten converts the current rendered result of any selection into a rectangular Surface containing verbatim custom characters.[^13]

**Implication for draw.mso:** retain familiar Shift multi-select and marquee selection, but add group entry/deep-select behavior and a left-side hierarchy. Multi-selection inspectors should expose only properties common to every selected shape. Add copy/paste style early; add flatten once arbitrary character content is represented in the core.

## Rectangular shapes: Box, Text, and Surface

Rect, Text, and Surface tools create the same rectangular primitive with different defaults. The primitive independently toggles three layers:

- **Text:** ordinary or FIGlet-rendered text with layout controls.
- **Border:** selectable border preset or individually editable glyphs for all four corners and four sides.
- **Fill:** selectable fill preset or a custom repeating character.

Custom character edits sit on top of these generated layers. Border and fill each have optional export color. Border blending is independently switchable. Rectangles also support a shadow with configurable character, offset, intensity/preset, and export color.[^3][^9][^14]

The public screenshot demonstrates several shadow modes: solid block, custom repeated glyphs, negative/top-left offsets, and independently assigned characters for individual border sides and corners. Fill can be an arbitrary glyph. A rectangle can include embedded text rather than requiring a separate text node.[^15]

Every rectangular shape has an anchor, a size, an anchor-to-box corner/edge position, and an arbitrary box offset. This allows a shape to say, for example, “my top-right is attached to this point.” Rectangles initially shipped with 17 predefined attachment positions, while custom points can be placed anywhere. Border points remain relative to the border through resize and may sit outside the bounds when a border is enabled.[^1][^9]

Creating a new shape can inherit the style of a selected shape of the same type, controlled by a preference. Rectangular content stays visually fixed while a user resizes from another side, reducing the feeling that text “jumps” merely because the bounds changed.[^7][^9]

**Implication for draw.mso:** implement one general rectangular node with presets:

| Preset | Text | Border | Fill |
| --- | --- | --- | --- |
| Box | optional/empty | on | off |
| Text | on and immediately editing | off | off |
| Surface | off/optional | off | transparent |

Persist style as generated-layer parameters plus sparse character overrides. This is what makes “edit one border character, then resize” meaningful: an override belongs semantically to `bottom-edge` or `top-left-corner`, not only to an absolute canvas cell.

## Text behavior

Text creation immediately enters text editing unless the user suppresses it by holding Option when activating the Text tool. Editing is deliberately text-first: activating or double-clicking a text shape edits its content, while a separate popover exposes raw shape/content editing. Command-Enter closes/commits the text popover.[^6][^7][^16]

The text engine exposes four independent layout dimensions:

1. **Alignment:** horizontal left, center, or right.
2. **Position:** vertical top, center, or bottom inside the box.
3. **Line sweep:** the direction characters progress along a line, including horizontal and vertical arrangements.
4. **Line movement:** the direction successive lines advance.

The official text screenshot confirms top/center/bottom placement, left/center/right alignment, text that overlaps or sits on a border (“heading” positions), and vertical character flow at left, center, and right positions.[^17] The website explicitly names alignment, position, line sweep, and line movement as separate controls.[^5]

Version 1.2 added configurable text padding in the inspector. Current inspector resources confirm independent font selection, text enablement, text color, alignment, position, sweep, and movement controls. Ellipse shapes also support embedded text.[^14][^18]

FIGlet is integrated as a text rendering mode, with 148 bundled fonts and custom fonts. Editing the text, changing its font, or resizing its container updates the banner interactively; a preview popover supports choosing fonts.[^5][^19]

Pasting normal clipboard text creates editable text. “Paste Raw” preserves the older behavior of placing clipboard characters verbatim as a Surface. Opening a text file creates a document containing one Surface, and text can also be imported into the current document.[^7][^16]

**Implication for draw.mso:** text should be content inside the general rectangle, not a special auto-sizing annotation with fewer styling capabilities. The first implementation can expose familiar horizontal/vertical alignment, padding, wrap, and auto-size/fixed-size. The schema should reserve orthogonal `characterDirection` and `lineDirection` axes so vertical and reversed layouts do not require a future model migration. Treat FIGlet as a text renderer/style which recalculates on edit and resize.

## Full character editing

Every shape can be edited at the character level using Shape → Edit or Command-E. Pencil, Eraser, and other direct tools write sparse custom content into the selected shape; custom content overrides generated content. Monodraw attempts to preserve the semantic intent of edits during later geometry changes. A custom character drawn along a bottom border remains a bottom-border override after resize rather than staying at an obsolete absolute coordinate.[^1][^3]

Pencil paints the current character with the left mouse button and erases with the right. It can draw into any shape or empty canvas. The crosshair shows the current character beside the cursor. A document remembers its current pencil character; it can be set by pressing Enter then typing, choosing a character palette, pasting the first clipboard character, or using Picker on a canvas cell.[^6][^16]

When Pencil is active, the selected editing target remains clear while other shapes fade. Eraser removes custom content across shapes. Bucket Fill floods a connected region within a particular shape. Character palettes can be customized; built-in palettes cover ASCII, geometric shapes, and block elements. Reset Content removes custom edits without deleting the shape.[^9][^13][^16]

**Implication for draw.mso:** freehand tools need an explicit edit target and must create sparse per-shape overrides rather than destructive edits to the final composed canvas. Empty-canvas drawing should create or extend a Surface. Bucket Fill operates on the selected shape’s composed local-cell region and writes overrides as one undo transaction.

## Lines, routing, arrows, and labels

Monodraw exposes five line modes:[^6]

| Mode | Routing contract |
| --- | --- |
| Diagram (orthogonal) | Fully automatic obstacle-aware pathfinding between two endpoints; no manual segment controls. |
| Automatic (orthogonal) | User controls midpoint count/positions; segment orientation is inferred. |
| Manual (orthogonal) | User controls midpoints and each segment direction; right-click a segment to change it. |
| Step | Alternating horizontal and vertical staircase steps between points. |
| Staggered | Diagonal plus horizontal/vertical steps, limited to start and end with no midpoints. |

The line inspector supports a dash pattern and a one-click swap of start/end heads. Monodraw includes standard arrowheads plus three Crow’s Foot entity-relationship terminal variants. The current inspector resources and release notes also indicate custom line characters/color and configurable line heads.[^5][^9][^20]

Diagram mode infers endpoint direction. Built-in rectangle attachment points prefer a direction perpendicular to their side. Custom attachment points can declare one or more equally preferred directions. The router adds invisible bends as necessary to honor those endpoint directions and account for rectangle areas.[^16][^21]

All line endpoints and midpoints can participate in attachment. Orthogonal segments expose additional attachment positions; custom line attachment points are stable and user-controlled rather than being derived from a particular segment, so changing route geometry does not detach labels. Lines are not attachable by default, which keeps their control surface quiet until the user needs line-to-line or label attachment.[^1][^2][^9]

Double-clicking a line creates a label. A label is an ordinary rectangular text shape attached to a stable point on the line, with an arbitrary offset so it can sit beside the stroke. Because it is a normal rectangle, it retains the complete text layout, border, fill, and custom-character feature set. Any shape can technically be attached as a line label.[^1][^2]

Generated line and rectangle strokes blend at overlaps to select suitable box-drawing junction glyphs. Final endpoints receive special overlap handling so connected-looking diagrams remain visually continuous.[^4][^9]

**Implication for draw.mso:** keep the existing orthogonal and staircase modes, but separate routing policy from geometry ownership. Add explicit Auto, Semi-auto, Manual, Step, and Staggered modes. Store user waypoints separately from router-created bends. Model endpoints and labels with stable attachment IDs and side-direction preferences. Make labels ordinary rectangular nodes attached to an edge rather than strings stored inside the edge.

## Ellipse, diamond, image, snippets, and reusable style

Diamond creates symmetric diamond shapes. Its border is configurable by top/right/bottom/left tip glyphs and four diagonal edge glyphs. Ellipse supports anchors, shadow, embedded text, a custom border character, blending, and color.[^6][^14][^18]

Image overlays accept PNG and JPEG for tracing. They are reference layers on the canvas rather than text output. Snippets are reusable user-defined shapes/groups presented in a dedicated assistant tab; the app ships with reusable window and phone snippets.[^5][^19]

**Implication for draw.mso:** draw.mso intentionally uses boxes only; ellipse and diamond tools are excluded. Image can be a later tracing feature that never leaks into Unicode/ASCII exports. Snippets are the replacement for predefined developer blocks: users should be able to save a styled shape or group, name it, and insert it without creating new document-schema node kinds.

## Keyboard workflow to preserve

The official help book gives behavioral shortcuts but intentionally tells users to discover individual tool letters through hover tooltips. The exact letters are therefore not reliably documented in public sources. Confirmed shortcuts and modifiers are:

| Shortcut | Behavior |
| --- | --- |
| Escape | Return to Select. |
| Space hold / tap | Momentary Pan / toggle Pan. |
| Shift while activating a tool | Keep it active after creating an object. |
| Command-E | Enter full character/content editing. |
| Command-Enter | Commit/close text editing popover. |
| Command-D | Duplicate selection. |
| Option-drag | Duplicate by mouse. |
| Shift-move | Constrain to horizontal/vertical from original position. |
| Option-resize | Resize symmetrically from both sides. |
| Shift/Option during rectangle creation | Constrain creation geometry. |
| Command-click | Deep-select through groups. |
| Double-click selected group | Descend into group. |
| Delete | Delete selected shapes. |
| Backspace while editing | Move edit cursor backward. |
| Command-1/2/3 | Switch assistant tabs. |
| Option + Move Up/Down | Send to absolute front/back. |

Context menus are essential for discoverable, geometry-specific operations: add a line midpoint, set a manual segment direction, create a line label, reset content, copy/paste style, locate, rename, and define custom attachment direction.[^7][^9][^13][^16]

## Recommended delivery order for draw.mso

1. **Neutral primitives and presets:** replace the domain toolbar with Select, Pan, Rect, Text, Line, and Fill. Migrate old node kinds to rectangular style presets on import.
2. **Unified rectangle content:** independent text/border/fill/shadow, embedded text, text padding/alignment, border/fill glyph presets, and a Surface preset.
3. **Character overrides:** sparse per-shape custom content, Edit mode, document-local active character, Fill, content reset, and one-gesture undo.
4. **Connection parity:** line modes, editable stable waypoints, start/end markers, dash patterns, attachment points with preferred directions, and edge labels implemented as attached text rectangles.
5. **Structure and efficiency:** shape tree, nested groups, hide/lock, z-order, copy/paste style, styles inherited on create, snippets, deep selection, and focus workflow.
6. **Advanced text and output:** vertical/reversed sweep and line movement, FIGlet fonts, tracing images, flatten, blended Unicode junctions, and output color for SVG/PNG.

The key architectural risk is modeling rendered characters as the document itself. Monodraw’s behavior depends on keeping semantic generated layers, sparse overrides, attachments, and final composition separate. That split also matches draw.mso’s existing architecture: Rust should own accepted shape semantics, attachment validity, composition, history, and export; the browser editor should own transient pointer previews; the renderer should display the accepted scene.

## Verified gaps and uncertainties

- The bundled help book is authoritative first-party material but carries a 2015/1.0 heading. Current 1.7.1 resources and App Store release notes confirm the main primitives still exist, but some individual behaviors could have changed.
- Exact one-key letters for every tool are not exposed by the help book or official website. Do not copy a guessed mapping; choose memorable keys for draw.mso and expose them in tooltips.
- The official sources name text sweep and movement controls and visually demonstrate vertical flow, but do not publish a full enumeration of every direction value. The data model should support both axes independently while the first UI can ship only verified/common options.
- The official sources mention three Crow’s Foot variants without naming the exact combinations. Current draw.mso marker choices should be retained until the actual terminal set is visually inventoried in a running copy.
- Screenshots show border/fill/shadow presets but do not label every preset. Implement semantic choices (single, double, dashed, custom; transparent or character fill; shadow offset/character) rather than matching an uncertain menu order.
- Public evidence for selection marquee modifiers, snapping thresholds, and exact resize handles is incomplete. Preserve draw.mso’s established gestures where Monodraw evidence is silent.

## Sources

[^1]: Milen Dzhumerov, Helftone, [“Monodraw: Beta Progress Update #1”](https://blog.helftone.com/monodraw-beta-update-one/), 2014.
[^2]: Milen Dzhumerov, Helftone, [“Monodraw: Line Labels”](https://blog.helftone.com/monodraw-line-labels/), 2015.
[^3]: Helftone, Monodraw 1.7.1 bundled help, “Concepts” (`concepts.html`), accessed from the [official trial](https://updates.helftone.com/monodraw/downloads/monodraw-latest.dmg), 2026-09-13.
[^4]: Milen Dzhumerov, Helftone, [“Monodraw: Final Progress Update”](https://blog.helftone.com/monodraw-final-progress-update/), 2015.
[^5]: Helftone, [“Monodraw for macOS”](https://monodraw.helftone.com/), accessed 2026-09-13.
[^6]: Helftone, Monodraw 1.7.1 bundled help, “Tools” (`tools.html`), accessed from the [official trial](https://updates.helftone.com/monodraw/downloads/monodraw-latest.dmg), 2026-09-13.
[^7]: Milen Dzhumerov, Helftone, [“Monodraw: Beta Progress Update #3”](https://blog.helftone.com/monodraw-beta-update-three/), 2015.
[^8]: Helftone, Monodraw 1.7.1 bundled help, “Sidebar” (`sidebar.html`), accessed from the [official trial](https://updates.helftone.com/monodraw/downloads/monodraw-latest.dmg), 2026-09-13.
[^9]: Milen Dzhumerov, Helftone, [“Monodraw: Final Progress Update”](https://blog.helftone.com/monodraw-final-progress-update/), 2015.
[^10]: Milen Dzhumerov, Helftone, [“Monodraw: Collapsible Panes”](https://blog.helftone.com/monodraw-collapsible-split-panes-update-released/), 2017.
[^11]: Milen Dzhumerov, Helftone, [“Monodraw: Beta Progress Update #2”](https://blog.helftone.com/monodraw-beta-update-two/), 2014.
[^12]: Apple App Store, [“Monodraw” version history](https://apps.apple.com/us/app/monodraw/id920404675?mt=12), accessed 2026-09-13.
[^13]: Helftone, Monodraw 1.7.1 bundled help, “Operations” (`operations.html`), accessed from the [official trial](https://updates.helftone.com/monodraw/downloads/monodraw-latest.dmg), 2026-09-13.
[^14]: Milen Dzhumerov, Helftone, [“Monodraw v1.2: Sneak Peek”](https://blog.helftone.com/monodraw-colors-ellipse-update-sneak-peek/), 2017.
[^15]: Helftone, [official Rect Tool screenshot](https://monodraw.helftone.com/static/images/screenshots/shot-rect-tool@2x.png), accessed 2026-09-13.
[^16]: Milen Dzhumerov, Helftone, [“Monodraw: Beta Progress Update #2”](https://blog.helftone.com/monodraw-beta-update-two/), 2014.
[^17]: Helftone, [official Text Tool screenshot](https://monodraw.helftone.com/static/images/screenshots/shot-text-tool@2x.png), accessed 2026-09-13.
[^18]: Helftone, Monodraw 1.7.1 bundled inspector resources, accessed from the [official trial](https://updates.helftone.com/monodraw/downloads/monodraw-latest.dmg), 2026-09-13.
[^19]: Milen Dzhumerov, Helftone, [“Monodraw v1: Almost Here”](https://blog.helftone.com/monodraw-v1-almost-here/), 2015.
[^20]: Helftone, [official Line Tool screenshot](https://monodraw.helftone.com/static/images/screenshots/shot-line-tool@2x.png), accessed 2026-09-13.
[^21]: Helftone, [“Monodraw: Alpha Shipped”](https://blog.helftone.com/monodraw-alpha-shipped/), 2014.

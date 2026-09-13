# Visual direction for the next design discussion

## Agreed constraints

- Preserve the floating toolbars and overall interaction model.
- Aim for a polished, expressive feel: subtle color, crisp shapes, satisfying interactions.
- Keep the canvas visually close to the ASCII/Unicode export. Rich cards that lose their appearance in text are not the chosen direction.
- Optimize for developers and workflows shared with AI agents.

## Proposed direction to explore

Make the character grid feel intentional through consistent node proportions, generous label padding, clearer hierarchy, and carefully tuned single/double/dashed borders. Use restrained color as an enhancement; component identity and selection must remain understandable without it.

Keep service/database/queue semantics, but compare whether their current border differences communicate enough. Prototype alternate treatments of the same small architecture diagram rather than introducing a large new shape library. Compare the live canvas, Unicode export, and ASCII fallback side by side.

Interaction candidates include label-aware sizing, connect-and-create, a clearer preview before placing a node, subtle snap feedback, and contextual controls with useful names instead of truncated IDs. Motion should be brief, respect reduced-motion preferences, and stay outside the document/history model.

## Decisions still open

- Which border and label treatments distinguish component kinds most clearly?
- How much color should remain in an exported SVG while preserving text parity?
- Which interaction removes the most friction: creation, connections, labeling, or arrangement?

No visual redesign is included in the performance/contract implementation. The next design step is a small comparison of node treatments and their exported text, followed by an interaction prototype.

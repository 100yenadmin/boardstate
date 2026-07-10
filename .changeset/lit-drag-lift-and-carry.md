---
"@boardstate/lit": patch
"@boardstate/core": patch
---

Mac-style lift-and-carry drag: the dragged card now follows the pointer 1:1
(raw pixel deltas from `DashboardDragState.pointerDx/Dy`), lifted with a shadow
and a grabbing cursor, while the landing cell shows as a QUIET neutral
placeholder — red stays reserved for an invalid (colliding) drop. Previously
the card never moved and the snapped accent/red ghost rectangles were the only
drag feedback, which read as "colored bars" instead of direct manipulation.
Resize keeps the ghost preview. Also hardened: a pointer that vanishes between
pointerdown and capture can no longer kill the drag wiring.

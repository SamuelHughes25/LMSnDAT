// Fixed "milestone" snap positions — 0/25/50/75/100% of the slide (edges,
// quarters, and dead center), the PowerPoint/Figma-style smart-guide
// convention the request asked for. Deliberately NOT object-to-object
// snapping (aligning to some OTHER box's own edges) — that needs a
// dynamically-computed candidate set from every other visible object on the
// slide, a materially bigger feature than "snap to the page's own
// milestones." Documented scope trim, not an oversight — easy to extend
// later if wanted.
export const SNAP_POSITIONS = [0, 25, 50, 75, 100];

// How close (in real screen pixels) an edge/center has to get before it
// snaps — converted to a percentage via whichever canvas dimension is
// relevant at each call site (CANVAS_W for x, CANVAS_H for y). This app's
// canvas is a fixed, non-zoomed 960x540 box (see slide-canvas.tsx), so this
// px value means the same thing on screen regardless of which axis/object
// it's applied to.
const SNAP_THRESHOLD_PX = 6;

function thresholdPct(canvasDim: number): number {
  return (SNAP_THRESHOLD_PX / canvasDim) * 100;
}

// Snaps a single absolute position (a center point, or one specific edge
// being dragged) to the nearest milestone within threshold. Returns the
// original value unchanged (guide: null) if nothing is close enough.
export function snapEdge(valuePct: number, canvasDim: number): { value: number; guide: number | null } {
  const threshold = thresholdPct(canvasDim);
  let best: { snap: number; dist: number } | null = null;
  for (const snap of SNAP_POSITIONS) {
    const dist = Math.abs(valuePct - snap);
    if (dist <= threshold && (!best || dist < best.dist)) best = { snap, dist };
  }
  return best ? { value: best.snap, guide: best.snap } : { value: valuePct, guide: null };
}

// Snaps a TOP-LEFT-anchored box's position (text boxes — see
// positionable-box.tsx's topLeftBoxStyle) during a MOVE, where the whole
// box (left edge, right edge, AND center) are all candidates a design tool
// would snap by — whichever of the three lands closest to a milestone wins,
// and the box's `xPct`/`yPct` (its left-edge anchor) is adjusted by
// whatever offset makes THAT reference point land exactly on the milestone.
// Center-anchored objects (images) don't need this — their own anchor
// point already IS the thing to snap (see snapEdge above, called directly
// on xPct/yPct in background-image-field.tsx's move handler).
export function snapBoxPosition(
  pos: number,
  size: number,
  canvasDim: number,
): { pos: number; guide: number | null } {
  const threshold = thresholdPct(canvasDim);
  const references = [
    { point: pos, offset: 0 }, // leading edge
    { point: pos + size, offset: size }, // trailing edge
    { point: pos + size / 2, offset: size / 2 }, // center
  ];
  let best: { pos: number; guide: number; dist: number } | null = null;
  for (const ref of references) {
    for (const snap of SNAP_POSITIONS) {
      const dist = Math.abs(ref.point - snap);
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { pos: snap - ref.offset, guide: snap, dist };
      }
    }
  }
  return best ? { pos: best.pos, guide: best.guide } : { pos, guide: null };
}

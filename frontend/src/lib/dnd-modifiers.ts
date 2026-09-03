import type { Modifier } from "@dnd-kit/core";

// Small, self-contained equivalents of @dnd-kit/modifiers' restrictToVerticalAxis
// and restrictToParentElement — that's a real, official companion package for
// exactly this ("keep a sortable drag from wandering outside its own list"),
// but not one worth adding as a dependency for two ~10-line functions when
// @dnd-kit/core already hands every modifier everything they need
// (`transform`, `draggingNodeRect`, `containerNodeRect`) with no extra ref
// threading required. `containerNodeRect` is the dragged item's own DOM
// parent element's rect, computed by dnd-kit itself at drag start — for
// slide-rail.tsx's slide list, that's the lesson's own slide-list wrapper
// div, so passing these modifiers to that DndContext needs no other wiring.

// Zeroes out horizontal movement — a vertical list only ever needs to move
// up/down.
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

// Clamps the drag transform so the dragged item's own bounding box can
// never move outside its container's bounding box — this is what actually
// stops a slide from visually floating anywhere on the screen while
// dragging, confining it to the lesson's own slide-list element instead.
export const restrictToParentElement: Modifier = ({ transform, draggingNodeRect, containerNodeRect }) => {
  if (!draggingNodeRect || !containerNodeRect) {
    return transform;
  }

  const value = { ...transform };

  if (draggingNodeRect.top + transform.y <= containerNodeRect.top) {
    value.y = containerNodeRect.top - draggingNodeRect.top;
  } else if (draggingNodeRect.bottom + transform.y >= containerNodeRect.top + containerNodeRect.height) {
    value.y = containerNodeRect.top + containerNodeRect.height - draggingNodeRect.bottom;
  }

  if (draggingNodeRect.left + transform.x <= containerNodeRect.left) {
    value.x = containerNodeRect.left - draggingNodeRect.left;
  } else if (draggingNodeRect.right + transform.x >= containerNodeRect.left + containerNodeRect.width) {
    value.x = containerNodeRect.left + containerNodeRect.width - draggingNodeRect.right;
  }

  return value;
};

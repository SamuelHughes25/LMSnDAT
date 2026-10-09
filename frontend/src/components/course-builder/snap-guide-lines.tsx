"use client";

import { useSnapGuides } from "./snap-guide-context";

// Thin pink lines spanning the whole canvas at whichever milestone
// percentage(s) a drag/resize is currently snapped to (see snap-guides.ts) —
// rendered once here, lit up by whichever drag handler is currently active
// (positionable-box.tsx, image-shared.tsx's ResizeHandles,
// background-image-field.tsx). Pink/magenta is the common convention these
// smart-guide lines use in design tools (Figma, PowerPoint, Keynote) —
// picked specifically so it never gets mistaken for this app's own primary/
// accent color or the selection outline's border-primary dashed rectangle.
export function SnapGuideLines() {
  const { guides } = useSnapGuides();
  if (guides.vertical.length === 0 && guides.horizontal.length === 0) return null;

  return (
    <>
      {guides.vertical.map((pct) => (
        <div
          key={`v-${pct}`}
          className="pointer-events-none absolute inset-y-0 w-px bg-pink-500"
          style={{ left: `${pct}%` }}
        />
      ))}
      {guides.horizontal.map((pct) => (
        <div
          key={`h-${pct}`}
          className="pointer-events-none absolute inset-x-0 h-px bg-pink-500"
          style={{ top: `${pct}%` }}
        />
      ))}
    </>
  );
}

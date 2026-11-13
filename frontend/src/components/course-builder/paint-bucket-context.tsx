"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

// Shares "the paint-bucket tool is armed with this color" between the
// properties panel's Tools row (where it's armed/disarmed and its color
// picked — properties-panel.tsx) and the freeform canvas (where a click
// on a shape/icon/background actually applies it —
// slide-faces/freeform-content-slide.tsx, slide-faces/shape-field.tsx)
// — same sibling-under-course-builder.tsx reasoning as every other
// canvas-related context here (SnapGuideContext, ObjectPlacementContext).
//
// Stays armed until explicitly disarmed, rather than firing once per
// click — consistent with every other toggle-style tool button in this
// app, and lets several objects get painted the same color in a row
// without re-opening the color picker each time.
//
// Deliberately carries ONLY a color, nothing about WHAT it can be
// applied to — the restriction that it can recolor shapes/icons/
// background but never an imported image is enforced structurally, by
// which components actually read `armedColor` at all (ShapeEditLayer and
// freeform-content-slide.tsx's own background click, never
// BackgroundImageEditLayer), not by a runtime type-check anywhere that
// reads this context.
type PaintBucketContextValue = {
  armedColor: string | null;
  armBucket: (color: string) => void;
  disarmBucket: () => void;
};

const PaintBucketContext = createContext<PaintBucketContextValue | null>(null);

export function PaintBucketProvider({ children }: { children: ReactNode }) {
  const [armedColor, setArmedColor] = useState<string | null>(null);

  const value = useMemo<PaintBucketContextValue>(
    () => ({
      armedColor,
      armBucket: (color) => setArmedColor(color),
      disarmBucket: () => setArmedColor(null),
    }),
    [armedColor],
  );

  return <PaintBucketContext.Provider value={value}>{children}</PaintBucketContext.Provider>;
}

export function usePaintBucket() {
  const ctx = useContext(PaintBucketContext);
  if (!ctx) {
    throw new Error("usePaintBucket must be used within a PaintBucketProvider");
  }
  return ctx;
}

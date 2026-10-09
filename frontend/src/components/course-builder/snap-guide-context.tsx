"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

// The lines a drag/resize gesture is currently snapped to, shared between
// whichever drag handler is active (positionable-box.tsx's move/resize,
// image-shared.tsx's ResizeHandles, background-image-field.tsx's move) and
// the one place they're actually drawn (slide-canvas.tsx's SnapGuideLines,
// via useSnapGuides below). A shared context rather than local state in
// slide-canvas.tsx itself: the drag handlers live several components away
// from the canvas (inside whichever slide-face is currently mounted), so
// they need a way to reach up and light up a guide line without prop-drilling
// a setter through every layer in between — same shape/reasoning as
// slide-selection-context.tsx and active-editor-context.tsx.
type Guides = { vertical: number[]; horizontal: number[] };

const NO_GUIDES: Guides = { vertical: [], horizontal: [] };

type SnapGuideContextValue = {
  guides: Guides;
  setGuides: (guides: Guides) => void;
  clearGuides: () => void;
};

const SnapGuideContext = createContext<SnapGuideContextValue | null>(null);

export function SnapGuideProvider({ children }: { children: ReactNode }) {
  const [guides, setGuidesState] = useState<Guides>(NO_GUIDES);

  const value = useMemo<SnapGuideContextValue>(
    () => ({
      guides,
      setGuides: setGuidesState,
      clearGuides: () => setGuidesState(NO_GUIDES),
    }),
    [guides],
  );

  return <SnapGuideContext.Provider value={value}>{children}</SnapGuideContext.Provider>;
}

export function useSnapGuides() {
  const ctx = useContext(SnapGuideContext);
  if (!ctx) {
    throw new Error("useSnapGuides must be used within a SnapGuideProvider");
  }
  return ctx;
}

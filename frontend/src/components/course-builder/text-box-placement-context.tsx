"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

// Shares "the user just clicked 'Add text box' and the next drag on the
// canvas should create one" between free-text-box-properties.tsx's sibling
// button (in the properties panel — see slide-layers-panel.tsx/
// properties-panel.tsx) and the freeform content slide's own canvas (see
// slide-faces/add-text-box-layer.tsx), which are siblings under
// course-builder.tsx, not parent/child — same reason SnapGuideContext
// exists as a context rather than a prop threaded through slide-canvas.tsx:
// this is cross-cutting, drag-related state that only some slide types
// (freeform content slides) ever read, so plumbing it through every layer
// in between would mean every other Face/SlideCanvas caller carrying a prop
// it never uses.
type TextBoxPlacementContextValue = {
  isPlacing: boolean;
  startPlacing: () => void;
  cancelPlacing: () => void;
};

const TextBoxPlacementContext = createContext<TextBoxPlacementContextValue | null>(null);

export function TextBoxPlacementProvider({ children }: { children: ReactNode }) {
  const [isPlacing, setIsPlacing] = useState(false);

  const value = useMemo<TextBoxPlacementContextValue>(
    () => ({
      isPlacing,
      startPlacing: () => setIsPlacing(true),
      cancelPlacing: () => setIsPlacing(false),
    }),
    [isPlacing],
  );

  return <TextBoxPlacementContext.Provider value={value}>{children}</TextBoxPlacementContext.Provider>;
}

export function useTextBoxPlacement() {
  const ctx = useContext(TextBoxPlacementContext);
  if (!ctx) {
    throw new Error("useTextBoxPlacement must be used within a TextBoxPlacementProvider");
  }
  return ctx;
}

"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { ShapeKind } from "@/lib/course-types";

// Shares "the user just clicked an Add-object tool and the next
// click/drag on the canvas should create one" between the properties
// panel's Tools row (properties-panel.tsx) and the freeform content
// slide's own canvas (slide-faces/freeform-content-slide.tsx), which are
// siblings under course-builder.tsx, not parent/child — same reason
// SnapGuideContext exists as a context rather than a prop threaded
// through slide-canvas.tsx: this is cross-cutting, drag-related state
// that only freeform content slides ever read.
//
// Generalized from what used to be a text-box-only
// TextBoxPlacementContext (isPlacing: boolean) into a payload-carrying
// one, now that "Add text box" has siblings ("Add shape," "Add icon") —
// a SECOND, near-identical context per object kind would mean
// freeform-content-slide.tsx's one canvas pointerdown handler wiring
// itself into N contexts instead of reading one `placement` value and
// branching on its own `kind`.
export type PlacementPayload = { kind: "text" } | { kind: "shape"; shapeKind: ShapeKind };

type ObjectPlacementContextValue = {
  placement: PlacementPayload | null;
  startPlacing: (payload: PlacementPayload) => void;
  cancelPlacing: () => void;
};

const ObjectPlacementContext = createContext<ObjectPlacementContextValue | null>(null);

export function ObjectPlacementProvider({ children }: { children: ReactNode }) {
  const [placement, setPlacement] = useState<PlacementPayload | null>(null);

  const value = useMemo<ObjectPlacementContextValue>(
    () => ({
      placement,
      startPlacing: (payload) => setPlacement(payload),
      cancelPlacing: () => setPlacement(null),
    }),
    [placement],
  );

  return <ObjectPlacementContext.Provider value={value}>{children}</ObjectPlacementContext.Provider>;
}

export function useObjectPlacement() {
  const ctx = useContext(ObjectPlacementContext);
  if (!ctx) {
    throw new Error("useObjectPlacement must be used within an ObjectPlacementProvider");
  }
  return ctx;
}

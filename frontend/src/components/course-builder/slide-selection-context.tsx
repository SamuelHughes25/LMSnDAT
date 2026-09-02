"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

// Every independently-selectable thing on the slide canvas — each text box
// in positionable-box.tsx, plus the universal background image in
// background-image-field.tsx — shares this one slot instead of tracking
// "am I selected" as its own local state. That's what actually guarantees
// only one thing's controls (resize dots, move grip/band, border) show at a
// time: starting a move or resize drag has to call preventDefault() on
// pointerdown, to suppress the browser's native click/text-selection
// behavior while dragging — but that, as a side effect, also suppresses the
// *native* blur that would otherwise fire on whatever text box was
// previously focused. A box tracking its own local "am I selected" state
// has no way to find out about that; a shared "one slot, whoever selects
// last wins" value does — selecting a new box overwrites the slot, and
// every OTHER box's own `isSelected` (selectedId === myId) goes false on
// the very next render, regardless of whether its own native focus/blur
// ever actually fired. Confirmed via a real browser that without this,
// dragging one box's move band (or the background image's) while a
// different box was still focused left that other box's resize dots
// visibly stuck on screen indefinitely — exactly the "dots stay on the text
// box even when I've clicked off" report this was built to fix.
//
// Ids are namespaced per-slide (`${slideId}:${field}` /
// `${slideId}:background-image` — see the callers) rather than this
// context resetting itself on slide change: a bare field name like "title"
// isn't unique across slides, so without namespacing, switching from a
// slide with "title" selected to a different slide would make that new
// slide's OWN title box see a stale selectedId match and render itself
// pre-selected with no interaction at all. Namespacing means a stale id
// from a previous slide simply never matches anything on the new one —
// no extra reset effect required, and one less thing to keep in sync with
// slide-canvas.tsx's own key={slide.id} remount boundary.
type SlideSelectionContextValue = {
  selectedId: string | null;
  select: (id: string) => void;
  // Functional-updater under the hood (see the comment on `deselect` in the
  // provider) — only clears the slot if `id` is still the one currently
  // selected, so a stale/late deselect from a box that's already lost the
  // slot to something else can never clobber the new selection. Same race
  // this codebase already solved once for active-editor-context.tsx's blur
  // handler (`setActiveEditor((current) => current === thisEditor ? null :
  // current)`); same fix shape here.
  deselect: (id: string) => void;
};

const SlideSelectionContext = createContext<SlideSelectionContextValue | null>(null);

export function SlideSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const value = useMemo<SlideSelectionContextValue>(
    () => ({
      selectedId,
      select: (id) => setSelectedId(id),
      deselect: (id) => setSelectedId((current) => (current === id ? null : current)),
    }),
    [selectedId],
  );

  return <SlideSelectionContext.Provider value={value}>{children}</SlideSelectionContext.Provider>;
}

export function useSlideSelection() {
  const ctx = useContext(SlideSelectionContext);
  if (!ctx) {
    throw new Error("useSlideSelection must be used within a SlideSelectionProvider");
  }
  return ctx;
}

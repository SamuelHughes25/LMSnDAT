"use client";

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import type { ReactNode } from "react";

import type { BoxTransform } from "@/lib/course-types";
import { clampPositionPct } from "./image-shared";

// Minimum pointer travel (px) before a group drag counts as an actual drag
// rather than a plain click — same value, same reasoning, as
// positionable-box.tsx's own DRAG_THRESHOLD_PX (a plain click on an
// already-selected object's move band must still be able to toggle/
// collapse the selection via `onClick` below, not silently commit a
// same-as-start transform to every selected object).
const DRAG_THRESHOLD_PX = 3;

// What one draggable object (a PositionableBox text field, the background
// image, or an extra image — see background-image-field.tsx) exposes so a
// GROUP drag can move it without knowing anything about where its
// transform actually lives (box_transforms[field] / the flat
// background_image_*_pct fields / extra_images[] — three different
// shapes, see course-types.ts). `getBaseline` is read once, right when
// the drag starts; `setLiveOverride` is called on every pointermove with
// the object's own live in-progress position (or null when the drag ends,
// to hand rendering back to the object's own `live`/`transform` state);
// `commit` is the object's own normal single-drag commit function —
// reused as-is, so a group move persists through the exact same path
// (and the exact same slideConfigRef eager-merge safety) a single-object
// move already does.
type DragTarget = {
  getBaseline: () => BoxTransform | null;
  setLiveOverride: (t: BoxTransform | null) => void;
  commit: (t: BoxTransform) => void;
};

type GroupDragContextValue = {
  // Called once on mount by every draggable object, keyed by its own
  // selection id — returns the unregister function, meant to be returned
  // directly from the registering effect's cleanup. Registering through a
  // plain ref (not state) means a drag starting mid-render-cycle always
  // sees every currently-mounted object, with no extra re-render triggered
  // by registration itself — the same "descendant registers into a shared
  // ref" shape this codebase already uses (active-editor-context.tsx's
  // panelRef, slide-layers-panel.tsx's rowElsRef).
  registerDragTarget: (id: string, target: DragTarget) => () => void;
  // `onClick` fires instead of a group move when the gesture never
  // actually moved past DRAG_THRESHOLD_PX — the caller uses it to apply
  // whichever selection change it deferred (see positionable-box.tsx's
  // handleMovePointerDown): a plain click on a multi-selected object
  // should still be able to collapse the selection to just that one, and
  // a shift-click on an already-selected object should still be able to
  // toggle it OUT — neither of those is a "move," so neither should touch
  // any object's transform at all.
  startGroupDrag: (
    e: React.PointerEvent,
    rect: DOMRect,
    ids: ReadonlySet<string>,
    onClick: () => void,
  ) => void;
};

const GroupDragContext = createContext<GroupDragContextValue | null>(null);

// Mounted once per SlideCanvas (course-builder.tsx), wrapping it — NOT
// inside SlideSelectionProvider's own file, deliberately: this context
// knows nothing about selection itself (no selectedIds, no select/
// deselect) and only ever receives the ids to move as a plain argument
// from whichever object's pointerdown started the drag, keeping it
// decoupled from slide-selection-context.tsx entirely.
export function GroupDragProvider({
  beginBatch,
  endBatch,
  children,
}: {
  // use-undo-redo.ts's batching primitives — collapses every object's own
  // commit() during one group move into a SINGLE undo step, rather than
  // one step per object (which would make one Ctrl+Z only undo 1 of the
  // N moved objects).
  beginBatch: () => void;
  endBatch: () => void;
  children: ReactNode;
}) {
  const registryRef = useRef(new Map<string, DragTarget>());

  const registerDragTarget = useCallback((id: string, target: DragTarget) => {
    registryRef.current.set(id, target);
    return () => {
      // Only delete if this registration is still the current one — a
      // stale unregister (e.g. React re-running an effect in a different
      // order than it cleaned up) must never remove a NEWER registration
      // for the same id. Same race-safety shape as slide-selection-
      // context's own deselect.
      if (registryRef.current.get(id) === target) registryRef.current.delete(id);
    };
  }, []);

  const startGroupDrag = useCallback(
    (e: React.PointerEvent, rect: DOMRect, ids: ReadonlySet<string>, onClick: () => void) => {
      const targets = [...ids]
        .map((id) => ({ id, target: registryRef.current.get(id) }))
        .filter((entry): entry is { id: string; target: DragTarget } => !!entry.target);
      const baselines = new Map<string, BoxTransform>();
      for (const { id, target } of targets) {
        const baseline = target.getBaseline();
        if (baseline) baselines.set(id, baseline);
      }
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;

      function onMove(moveEvent: PointerEvent) {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        moved = true;
        const dxPct = ((moveEvent.clientX - startX) / rect.width) * 100;
        const dyPct = ((moveEvent.clientY - startY) / rect.height) * 100;
        for (const { id, target } of targets) {
          const baseline = baselines.get(id);
          if (!baseline) continue;
          target.setLiveOverride({
            ...baseline,
            xPct: clampPositionPct(baseline.xPct + dxPct),
            yPct: clampPositionPct(baseline.yPct + dyPct),
          });
        }
      }

      function onUp(upEvent: PointerEvent) {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        if (!moved) {
          onClick();
          return;
        }
        const dxPct = ((upEvent.clientX - startX) / rect.width) * 100;
        const dyPct = ((upEvent.clientY - startY) / rect.height) * 100;
        beginBatch();
        for (const { id, target } of targets) {
          const baseline = baselines.get(id);
          target.setLiveOverride(null);
          if (!baseline) continue;
          target.commit({
            ...baseline,
            xPct: clampPositionPct(baseline.xPct + dxPct),
            yPct: clampPositionPct(baseline.yPct + dyPct),
          });
        }
        endBatch();
      }

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [beginBatch, endBatch],
  );

  const value = useMemo<GroupDragContextValue>(
    () => ({ registerDragTarget, startGroupDrag }),
    [registerDragTarget, startGroupDrag],
  );

  return <GroupDragContext.Provider value={value}>{children}</GroupDragContext.Provider>;
}

// A harmless no-op stand-in for every caller OUTSIDE the builder's actual
// edit canvas — PositionableBox/BackgroundImageEditLayer render through
// these exact same components in `mode="static"` wherever a slide is just
// being DISPLAYED, not edited: slide-thumbnail.tsx's rail thumbnails (used
// by every slide the moment a course with existing content is opened),
// the Preview tab, and the portal course player. None of those render
// inside a <GroupDragProvider> (there is nothing to drag there), but
// PositionableBox still has to call this hook unconditionally on every
// render, mode or no mode (hooks can't be called conditionally — see its
// own comment on why the registration effect sits above the `mode !==
// "edit"` early return). Reported directly as a real, confirmed crash:
// throwing here instead of falling back made the ENTIRE builder
// unreachable for any course with existing slides (every one of its
// thumbnails threw on mount), and broke placing a brand new text box too
// (the rail re-renders that slide's own thumbnail the moment it's added).
const NOOP_GROUP_DRAG: GroupDragContextValue = {
  registerDragTarget: () => () => {},
  startGroupDrag: () => {},
};

export function useGroupDrag() {
  return useContext(GroupDragContext) ?? NOOP_GROUP_DRAG;
}

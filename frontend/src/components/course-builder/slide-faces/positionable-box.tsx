"use client";

import { useLayoutEffect, useRef, useState } from "react";

import type { BoxTransform } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import { ResizeHandles, clampPositionPct, clampSizePct, imageBoxStyle } from "./image-shared";
import type { SlideFaceProps } from "./index";

// Width of the invisible "grab to move" band just inside the box's own
// edges — see the perimeter strips below.
const MOVE_BAND_PX = 10;

// Makes a single text box (title/subtitle/body/body2) freely draggable and
// resizable, independent of the background-image system in
// background-image-field.tsx — separate config (config.box_transforms, not
// anything image-related), separate refs, separate drag state. The two
// only share the low-level positioning primitives in image-shared.tsx
// (percent-based centered-box math, clamp helpers, the resize-handle
// component), which hold no state of their own, so there's no runtime
// coupling between the two features to get wrong.
//
// A box with no saved transform yet renders exactly as it always has — a
// normal flex child, sized by whichever layout is active, via
// `flexClassName` (the same className that used to sit directly on the
// wrapping <div> in each content-slide-face.tsx layout branch) — with a
// perimeter move band and (once selected) resize handles overlaid on top
// of its current rendered position (edit mode only). The FIRST drag or
// resize measures that current position (via getBoundingClientRect,
// converted to a percentage of the slide) and uses it as the starting
// point, then commits a real transform on release — from then on the box
// renders absolutely positioned at its saved (x, y, width, height) instead
// of participating in flex layout at all. This is what "layout sets the
// starting position, then drag it anywhere" means in code: the layout's
// flex math is the *fallback* for an untouched box, not something this
// component duplicates.
//
// Percentages are relative to the slide's own top-level box in
// content-slide-face.tsx (the outer `w-full h-full` div each layout
// branch returns), not a ref threaded down from slide-canvas.tsx — that
// div is already exactly the full slide's size (padding doesn't shrink a
// CSS percentage's containing block), so measuring against it directly
// gives identical numbers without content-slide-face.tsx needing to know
// anything about how its parent mounts it.
export function PositionableBox({
  fieldKey,
  transform,
  onTransform,
  mode,
  slideRef,
  flexClassName,
  children,
}: {
  fieldKey: string;
  transform: BoxTransform | undefined;
  onTransform: (t: BoxTransform) => void;
  mode: SlideFaceProps["mode"];
  slideRef: React.RefObject<HTMLElement | null> | undefined;
  flexClassName?: string;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<BoxTransform | null>(null);
  // Only populated for an untransformed box in edit mode — see the
  // layout effect below. Static/present renders never need it: a
  // transform is resolved purely by CSS percentages, and an untransformed
  // box there is just plain flex-flow content, same as always.
  const [measuredBaseline, setMeasuredBaseline] = useState<BoxTransform | null>(null);
  // Gates the resize handles: they only show once this box is "selected"
  // (focus has entered its own text editor, or the perimeter move band has
  // been grabbed at least once), not for every box on the slide all the
  // time. Set on focus-within and on the first move-drag; cleared on
  // blur-out, guarded against the formatting toolbar the same way
  // RichTextBody's own onBlur is (see content-slide-face.tsx) — otherwise
  // clicking a Bold/Italic button in the toolbar would look like focus
  // left the box and hide its handles mid-format.
  const [isSelected, setIsSelected] = useState(false);
  const { toolbarRef, toolbarInteractingRef } = useActiveEditorContext();

  // Runs after the DOM commits, before paint — the one-time measurement
  // that lets an untouched box's grip/handles appear at its actual current
  // position without content-slide-face.tsx having to pre-compute what
  // every layout's flex math would produce.
  //
  // `slideRef` (an ancestor several components up, attached in
  // slide-canvas.tsx's Face wrapper) is confirmed — by instrumenting this
  // exact effect and comparing it against a requestAnimationFrame retry —
  // to sometimes still read `.current === null` on this component's very
  // first layout effect pass, becoming available only a frame later, even
  // though `wrapperRef` (owned by this component itself) is always ready
  // in time. This is a real ordering quirk of this specific nesting depth,
  // not a logic bug: React doesn't guarantee a distant ancestor's ref is
  // attached before a descendant's layout effect runs, only that a ref and
  // ITS OWN component's effects are consistent. The retry loop below
  // (bounded to a few frames, not unbounded) is the fix — it's cheap,
  // self-limiting, and only ever runs for the small handful of frames
  // until the ancestor ref catches up, typically just one.
  useLayoutEffect(() => {
    if (mode !== "edit" || transform) return;
    let rafId: number | null = null;
    let attempts = 0;

    function attemptMeasure() {
      const wrapper = wrapperRef.current;
      const slide = slideRef?.current;
      if (!wrapper || !slide) {
        attempts += 1;
        if (attempts < 10) {
          rafId = requestAnimationFrame(attemptMeasure);
        }
        return;
      }
      const wrapperRect = wrapper.getBoundingClientRect();
      const slideRect = slide.getBoundingClientRect();
      setMeasuredBaseline({
        xPct: ((wrapperRect.x + wrapperRect.width / 2 - slideRect.x) / slideRect.width) * 100,
        yPct: ((wrapperRect.y + wrapperRect.height / 2 - slideRect.y) / slideRect.height) * 100,
        widthPct: (wrapperRect.width / slideRect.width) * 100,
        heightPct: (wrapperRect.height / slideRect.height) * 100,
      });
    }
    attemptMeasure();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
    // Deliberately no dependency on wrapper/slide size or content — the
    // canvas is a fixed-pixel-size element (CANVAS_W/CANVAS_H in
    // slide-canvas.tsx), not responsive to window size, so an
    // untransformed box's flex position/size can't change after mount
    // without `layout` itself changing (which remounts this component via
    // key={`${field}-${layout}`} — see content-slide-face.tsx).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, transform]);

  if (mode !== "edit") {
    if (!transform) return <>{children}</>;
    // z-10 for the same reason as the edit-mode return below: a
    // transformed box can visually overlap an untransformed sibling still
    // in normal flex flow, and without an explicit stacking order they'd
    // fall back to DOM order, which isn't necessarily what was intended.
    return (
      <div
        className="absolute z-10 overflow-hidden"
        style={imageBoxStyle(transform.xPct, transform.yPct, transform.widthPct, transform.heightPct)}
      >
        {children}
      </div>
    );
  }

  const baseline = transform ?? measuredBaseline;

  function commit(next: BoxTransform) {
    setLive(null);
    onTransform(next);
  }

  function handleMovePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setIsSelected(true);
    const slide = slideRef?.current;
    const startMaybe = transform ?? measuredBaseline;
    if (!slide || !startMaybe) return;
    // Captured into its own definitely-non-null const: TypeScript's
    // narrowing from the guard above doesn't carry into the nested
    // closures below (onMove/onUp), which still see the wider
    // `BoxTransform | null` type of `startMaybe` otherwise.
    const start: BoxTransform = startMaybe;
    const rect = slide.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let current = start;

    function onMove(moveEvent: PointerEvent) {
      current = {
        ...start,
        xPct: clampPositionPct(start.xPct + ((moveEvent.clientX - startX) / rect.width) * 100),
        yPct: clampPositionPct(start.yPct + ((moveEvent.clientY - startY) / rect.height) * 100),
      };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      commit(current);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function handleFocus() {
    setIsSelected(true);
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    const nextFocus = e.relatedTarget;
    const toolbarEl = toolbarRef.current;
    const focusMovedIntoToolbar = !!(toolbarEl && nextFocus instanceof Node && toolbarEl.contains(nextFocus));
    const focusStayedInBox = !!(nextFocus && e.currentTarget.contains(nextFocus as Node));
    if (focusMovedIntoToolbar || toolbarInteractingRef.current || focusStayedInBox) {
      return;
    }
    setIsSelected(false);
  }

  const effective = live ?? baseline;

  return (
    <div
      ref={wrapperRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // z-10 once transformed: a dragged box escapes flex flow and can end
      // up visually overlapping an untransformed sibling that's still in
      // its normal flex position (e.g. drag the title down into the space
      // body normally occupies). Neither had an explicit z-index before
      // this, so they stacked by DOM order — title renders before body in
      // the JSX, so body (painted later) silently covered the just-moved
      // title, making it unclickable. Confirmed via a real browser: after
      // this fix, dragging a box always brings it above any untouched
      // sibling, matching the general expectation that the thing you just
      // moved should be reachable, not buried by something you didn't
      // touch.
      className={cn("relative", !transform && flexClassName, transform && "absolute z-10 overflow-hidden")}
      style={transform && effective ? imageBoxStyle(effective.xPct, effective.yPct, effective.widthPct, effective.heightPct) : undefined}
    >
      <div className="h-full w-full">{children}</div>

      {baseline && slideRef && (
        <>
          {/* Perimeter move band: four thin strips hugging the INSIDE of
              the box's edges, each a plain "cursor: move" + drag-to-move
              target — not a single center-positioned grip button (the
              earlier design). A center grip sat exactly where a click to
              place the text cursor would land, and `opacity-0` (needed so
              an always-visible grip wasn't cluttering the slide) doesn't
              remove an element from hit-testing, so it silently swallowed
              every click aimed at the middle of the box's own text. These
              strips stay out of the box's actual content area entirely —
              hovering near an edge shows the move cursor, hovering
              anywhere else behaves like plain text. Available regardless
              of selection state (same as any editor's "hover the edge to
              move" affordance); only the resize handles below are gated on
              isSelected. */}
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute inset-x-0 top-0 z-20 cursor-move"
            style={{ height: MOVE_BAND_PX }}
          />
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute inset-x-0 bottom-0 z-20 cursor-move"
            style={{ height: MOVE_BAND_PX }}
          />
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute left-0 z-20 cursor-move"
            style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
          />
          <div
            onPointerDown={handleMovePointerDown}
            title={`Drag to move ${fieldKey}`}
            className="absolute right-0 z-20 cursor-move"
            style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
          />

          {isSelected && (
            <ResizeHandles
              containerRef={slideRef}
              widthPct={baseline.widthPct}
              heightPct={baseline.heightPct}
              onLiveResize={(w, h) => setLive({ ...(transform ?? baseline), widthPct: clampSizePct(w), heightPct: clampSizePct(h) })}
              onCommitResize={(w, h) => commit({ ...(transform ?? baseline), widthPct: clampSizePct(w), heightPct: clampSizePct(h) })}
            />
          )}
        </>
      )}
    </div>
  );
}

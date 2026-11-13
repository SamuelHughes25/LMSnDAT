"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Move } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import { CANVAS_H, CANVAS_W } from "../slide-canvas";
import { useSlideSelection } from "../slide-selection-context";
import { useSnapGuides } from "../snap-guide-context";
import { useGroupDrag } from "./group-drag-context";
import { ResizeHandles, clampPositionPct, imageBoxStyle } from "./image-shared";
import { snapEdge } from "./snap-guides";

// Extracted from what used to be background-image-field.tsx's own
// BackgroundImageEditLayer/BackgroundImagePixels — confirmed, by reading
// that component in full, that the ONLY image-specific parts of it were
// the `value: string` prop and the `<img>` it rendered; everything else
// (center-anchored BoxTransform math, the move band + grip + resize
// handles, select/deselect via slide-selection-context, multi-select +
// group-drag registration, outside-click deselect, snap guides, the
// overlay portal) is equally what a drawn shape or icon needs. Pulling
// that generic part out here — used by BOTH the background/extra-image
// layer and the new shape/icon layer (shape-field.tsx) — means a fix or
// change to any of it is made once, not twice.

// Minimum pointer travel (px) before a move counts as an actual drag —
// same value/reasoning as positionable-box.tsx's identical constant.
const DRAG_THRESHOLD_PX = 3;

// Width of the invisible "click/drag to select and move" band hugging the
// inside of the box's own edges — same idea/width as positionable-box.tsx's
// MOVE_BAND_PX for text boxes.
const MOVE_BAND_PX = 10;

export type FrameEffective = { x: number; y: number; w: number; h: number };

// The non-interactive half: a plain, center-anchored, absolutely
// positioned box (see imageBoxStyle) with nothing else going on — static/
// present-mode rendering for images, and now shapes too, is built on just
// this. `overflowHidden` defaults to true (what an image needs, to crop
// an oversized upload to its own box) but a shape with a CSS
// `drop-shadow` filter needs it OFF — that filter paints outside the
// element's own box by design, and overflow-hidden would clip it right
// back off.
export function StaticPositionedBox({
  xPct,
  yPct,
  widthPct,
  heightPct,
  zIndex,
  className,
  overflowHidden = true,
  children,
}: {
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  zIndex?: number;
  className?: string;
  overflowHidden?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn("absolute", overflowHidden && "overflow-hidden", zIndex == null && "z-0", className)}
      style={{ ...imageBoxStyle(xPct, yPct, widthPct, heightPct), ...(zIndex != null ? { zIndex } : {}) }}
    >
      {children}
    </div>
  );
}

// The interactive half: drag-to-move / drag-corner-to-resize / select /
// multi-select-group-drag, portaled controls, the whole thing — minus any
// opinion about what's actually being dragged. `renderContent` is handed
// the live-while-dragging effective box and returns whatever should be
// drawn inside it (BackgroundImagePixels' `<img>`, or a shape's SVG).
export function DraggableResizableFrame({
  selectionId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
  overlayRef,
  moveLabel = "Click to select, drag to move",
  moveAriaLabel = "Move",
  renderContent,
  // Called first, right after preventDefault, on every move-band/grip
  // pointerdown — returning true CONSUMES the gesture (no select, no
  // drag) without this component needing to know why. This is the one
  // hook a paint-bucket tool needs: "if armed, apply my color to this
  // object and stop" — added here, used by shape-field.tsx's
  // ShapeEditLayer, with nothing about buckets living in this file.
  onBandPointerDownIntercept,
  // Forwarded straight to ResizeHandles — see its own comment on why
  // these need to be overridable per caller rather than every object
  // sharing images' own 20%-of-canvas floor.
  minSizePct,
  maxSizePct,
}: {
  selectionId: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  overlayRef: React.RefObject<HTMLElement | null>;
  moveLabel?: string;
  moveAriaLabel?: string;
  minSizePct?: number;
  maxSizePct?: number;
  renderContent: (effective: FrameEffective) => React.ReactNode;
  onBandPointerDownIntercept?: (e: React.PointerEvent) => boolean;
}) {
  // The controls (band/border/grip/handles) portal into overlayRef's DOM
  // node — an unclipped sibling of the slide's own clipped content
  // wrapper (see slide-canvas.tsx) — instead of rendering inline next to
  // the content, which used to put them INSIDE that clipped wrapper and
  // got 6 of 8 resize handles clipped off a freshly-uploaded, full-slide
  // image. The pixels stay inside the clipped wrapper (cropping IS wanted
  // there); only the controls layer moves outside it.
  //
  // overlayRef.current is only settled once slide-canvas.tsx's own render
  // has committed, so this needs an effect rather than reading .current
  // straight in render, but no retry loop the way slideRef elsewhere in
  // this app needed.
  const [overlayEl, setOverlayEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setOverlayEl(overlayRef.current);
  }, [overlayRef]);

  // Live transform while dragging (move or resize) — purely local, same
  // "commit once on release, not per frame" idea used everywhere else in
  // this app that has a raw pointer drag.
  const [live, setLive] = useState<FrameEffective | null>(null);
  const effective = live ?? { x: xPct, y: yPct, w: widthPct, h: heightPct };

  // Gates the move grip, resize handles, and dashed outline. Lives in the
  // SHARED slide-selection-context rather than local state — see
  // positionable-box.tsx's comment on selectionId for why a move/resize
  // drag's preventDefault() (which suppresses the native blur of whatever
  // text box was previously focused) means a shared slot, not independent
  // local state, is what actually lets every OTHER object find out it
  // should deselect.
  const { selectedIds, select, deselect } = useSlideSelection();
  const isSelected = selectedIds.has(selectionId);
  // See positionable-box.tsx's identical isMultiSelected — gates
  // group-move here too (group-drag-context.tsx), same condition.
  const isMultiSelected = isSelected && selectedIds.size > 1;
  const { startGroupDrag, registerDragTarget } = useGroupDrag();
  const frameRef = useRef<HTMLDivElement>(null);
  // So clicking into the properties panel's own position/style inputs for
  // THIS object doesn't immediately deselect it — those inputs live well
  // outside frameRef, which the outside-pointerdown check below would
  // otherwise treat as "clicked away." Same panelRef every other
  // selection/blur guard in this app already uses.
  const { panelRef, panelInteractingRef, activeEditor, activeEditorId } = useActiveEditorContext();
  const { setGuides, clearGuides } = useSnapGuides();

  useEffect(() => {
    if (!isSelected) return;
    function handlePointerDownOutside(e: PointerEvent) {
      // Missing here originally — confirmed as a real, reported bug: a
      // shape's own properties-panel controls (the border/fill
      // ColorPicker, specifically) open into a Base UI Menu that portals
      // its content OUTSIDE panelRef's own DOM subtree (see
      // positionable-box.tsx's identical check/comment for the fuller
      // story — that component already had this guard, this one didn't).
      // Without it, clicking an actual color swatch registered as
      // "clicked away from the shape" and deselected it before the
      // swatch's own onClick could even run — reported directly as
      // "pick a colour, it just deselects the object and does nothing."
      // Every color-picker trigger already sets this ref via
      // onMouseDown/onOpenChange (see color-picker.tsx); this is the
      // other half that was never reading it back.
      if (panelInteractingRef.current) return;
      const frame = frameRef.current;
      const panel = panelRef.current;
      if (!(e.target instanceof Node)) return;
      if (panel && panel.contains(e.target)) return;
      if (frame && !frame.contains(e.target)) {
        deselect(selectionId);
      }
    }
    // Capture phase: a click that lands on, say, a title box still needs
    // to be seen here even though that title box's own onFocus/
    // onPointerDown handlers might otherwise stop the event from bubbling
    // by the time it would reach a bubble-phase document listener.
    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside, true);
  }, [isSelected, deselect, selectionId, panelRef, panelInteractingRef]);

  function commitTransform(next: FrameEffective) {
    setLive(null);
    onTransform({ xPct: next.x, yPct: next.y, widthPct: next.w, heightPct: next.h });
  }

  // Registers this object into the shared group-drag registry — see
  // positionable-box.tsx's identical registration for the full reasoning
  // (`latestRef` keeps it pointing at this render's current props/
  // commitTransform instead of a stale closure). `live` doubles as the
  // group-drag override target (no separate baseline/measured-position
  // distinction to keep separate from it, unlike positionable-box.tsx).
  const latestRef = useRef({ xPct, yPct, widthPct, heightPct, commitTransform });
  useEffect(() => {
    latestRef.current = { xPct, yPct, widthPct, heightPct, commitTransform };
  });
  useEffect(() => {
    return registerDragTarget(selectionId, {
      getBaseline: () => ({
        xPct: latestRef.current.xPct,
        yPct: latestRef.current.yPct,
        widthPct: latestRef.current.widthPct,
        heightPct: latestRef.current.heightPct,
      }),
      setLiveOverride: (t) => setLive(t ? { x: t.xPct, y: t.yPct, w: t.widthPct, h: t.heightPct } : null),
      commit: (t) => latestRef.current.commitTransform({ x: t.xPct, y: t.yPct, w: t.widthPct, h: t.heightPct }),
    });
  }, [selectionId, registerDragTarget]);

  // Dragging the move grip, or the perimeter band, repositions the box's
  // center. Measured against `containerRef` — the full slide root — so
  // percentages stay consistent with imageBoxStyle's own frame of
  // reference.
  function handleMovePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    if (onBandPointerDownIntercept?.(e)) return;
    const additive = e.shiftKey;
    // See positionable-box.tsx's identical deferSelection — the same two
    // genuinely ambiguous "click or drag?" cases apply here too.
    const deferSelection = (additive && isSelected) || (!additive && isMultiSelected);
    if (!deferSelection) select(selectionId, additive);
    // See positionable-box.tsx's identical blurStaleEditor for the bug
    // this fixes — preventDefault() above suppresses the native blur a
    // text box's editor would otherwise get when this object's band is
    // clicked, so without this, dragging/selecting it while some text box
    // was focused left the text cursor behind in that box. Neither an
    // image nor a shape ever legitimately owns the active editor, so any
    // currently-active one is always stale the moment one is selected.
    if (activeEditor && activeEditorId) {
      activeEditor.commands.blur();
    }

    if (isMultiSelected) {
      const container = containerRef.current;
      if (container) {
        startGroupDrag(e, container.getBoundingClientRect(), selectedIds, () => {
          if (deferSelection) select(selectionId, additive);
        });
        return;
      }
    }

    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startXPct = xPct;
    const startYPct = yPct;
    let current = { x: startXPct, y: startYPct, w: effective.w, h: effective.h };
    // See positionable-box.tsx's own DRAG_THRESHOLD_PX comment — needed
    // so a plain click (no real movement) can still defer to
    // `deferSelection` below instead of always re-committing the same,
    // unchanged position.
    let moved = false;

    function onMove(moveEvent: PointerEvent) {
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
      const rawX = clampPositionPct(startXPct + ((moveEvent.clientX - startX) / rect.width) * 100);
      const rawY = clampPositionPct(startYPct + ((moveEvent.clientY - startY) / rect.height) * 100);
      // A center-anchored box's own anchor point IS the thing to snap
      // (unlike a text box, whose left/right/center all matter) — its
      // center is what the author is actually positioning.
      const snappedX = snapEdge(rawX, CANVAS_W);
      const snappedY = snapEdge(rawY, CANVAS_H);
      setGuides({
        vertical: snappedX.guide !== null ? [snappedX.guide] : [],
        horizontal: snappedY.guide !== null ? [snappedY.guide] : [],
      });
      current = {
        x: snappedX.value,
        y: snappedY.value,
        w: effective.w,
        h: effective.h,
      };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      clearGuides();
      if (moved) commitTransform(current);
      else if (deferSelection) select(selectionId, additive);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <>
      {renderContent(effective)}

      {/* Control frame: same bounds as the content above, but portaled
          into overlayRef's unclipped node instead of rendering here
          inline. Still z-20 relative to its portaled parent, same as the
          content layer's z-10 below it, so the band stays grabbable
          regardless of what's rendered on top of it. Pointer-events-none
          on the frame div itself (a full-slide box's frame would
          otherwise cover the entire slide and block every click meant
          for the content underneath); only the band, grip, and resize
          handles (each via their own pointer-events-auto) opt back in. */}
      {overlayEl &&
        createPortal(
          <div
            ref={frameRef}
            className="pointer-events-none absolute z-20 rounded-md"
            style={imageBoxStyle(effective.x, effective.y, effective.w, effective.h)}
          >
            {/* Perimeter band: four thin strips hugging the inside of the
                box's own edges, always present (not gated on isSelected —
                this is what LETS the object become selected in the first
                place). A plain click (no drag distance) selects; dragging
                selects and moves in the same gesture, exactly like
                positionable-box.tsx's identical band for text boxes.
                Deliberately a thin band rather than the whole frame
                interior: content commonly extends behind this box, and
                needs every click inside its own bounds to keep reaching
                it uninterrupted — only the outer edge opts back into
                hit-testing. */}
            <div
              onPointerDown={handleMovePointerDown}
              title={moveLabel}
              className="pointer-events-auto absolute inset-x-0 top-0 cursor-move"
              style={{ height: MOVE_BAND_PX }}
            />
            <div
              onPointerDown={handleMovePointerDown}
              title={moveLabel}
              className="pointer-events-auto absolute inset-x-0 bottom-0 cursor-move"
              style={{ height: MOVE_BAND_PX }}
            />
            <div
              onPointerDown={handleMovePointerDown}
              title={moveLabel}
              className="pointer-events-auto absolute left-0 cursor-move"
              style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
            />
            <div
              onPointerDown={handleMovePointerDown}
              title={moveLabel}
              className="pointer-events-auto absolute right-0 cursor-move"
              style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
            />

            {isSelected && (
              <>
                {/* The dashed outline, move grip, and resize handles only
                    render once selected — before that, the object looks
                    exactly like it will to a learner. */}
                <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-dashed border-primary/70" />

                {/* Floats just above the box's own top edge, not centered
                    inside it — see positionable-box.tsx's move grip for
                    the identical fix (and the real bug it fixed). */}
                <button
                  type="button"
                  onPointerDown={handleMovePointerDown}
                  aria-label={moveAriaLabel}
                  title="Drag to move"
                  className="pointer-events-auto absolute top-0 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-[130%] cursor-move items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-md"
                >
                  <Move className="h-4 w-4" />
                </button>

                <ResizeHandles
                  containerRef={containerRef}
                  xPct={effective.x}
                  yPct={effective.y}
                  widthPct={widthPct}
                  heightPct={heightPct}
                  onLiveResize={(w, h) => setLive({ x: effective.x, y: effective.y, w, h })}
                  onCommitResize={(w, h) => commitTransform({ x: effective.x, y: effective.y, w, h })}
                  onGuidesChange={setGuides}
                  minSizePct={minSizePct}
                  maxSizePct={maxSizePct}
                />
              </>
            )}
          </div>,
          overlayEl,
        )}
    </>
  );
}

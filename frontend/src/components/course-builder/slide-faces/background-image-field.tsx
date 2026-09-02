"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Move } from "lucide-react";

import { useSlideSelection } from "../slide-selection-context";
import {
  DEFAULT_POSITION_PCT,
  DEFAULT_SIZE_PCT,
  ResizeHandles,
  clampPositionPct,
  imageBoxStyle,
} from "./image-shared";

// This slide's own background image never shares its selection id with any
// text box (those are namespaced `${slideId}:title` etc. — see
// positionable-box.tsx) — a plain fixed suffix is enough since there's only
// ever one background image per slide.
const BACKGROUND_IMAGE_SELECTION_SUFFIX = "background-image";

// Width of the invisible "click/drag to select and move" band hugging the
// inside of the image's own edges — same idea, and same width, as
// positionable-box.tsx's MOVE_BAND_PX for text boxes. Kept as its own local
// constant rather than importing that one: the two are separate features
// that just happen to agree on a pixel value, not something that needs to
// stay in lock-step.
const MOVE_BAND_PX = 10;

// The on-canvas half of the universal per-slide background image — the
// other half (upload/paste, replace, remove) lives in the properties
// panel's "Edit" section (slide-background-panel.tsx), not here. This
// component's only job is to render the image where it currently is
// (every mode) and, in edit mode, let the author drag it to a new position
// or resize it. There is deliberately no "add an image" affordance here at
// all: with no image set, this renders nothing, so the panel is the one
// and only place an image gets added — see the panel's own comment for why
// that split (rather than duplicating add/replace/remove here too).
//
// Rendered as a flat sibling of the slide's own content, not a wrapper
// around it — see slide-canvas.tsx/slide-thumbnail.tsx/
// course-preview-viewer.tsx, which mount this and the slide's Face
// side-by-side inside one shared positioned container. That's what lets
// the two layer correctly by z-index (pixels at z-0, the content at z-10,
// edit-mode drag/resize controls at z-20) without this component needing
// to know anything about what the slide's content looks like, and without
// any slide-type's face component needing to know a background image
// exists at all.
export function SlideBackgroundLayer({
  value,
  mode,
  slideId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
  overlayRef,
}: {
  value: string | null | undefined;
  mode: "edit" | "static" | "present";
  // Only needed alongside onTransform/containerRef/overlayRef below — see
  // their own comment for why static/present callers are spared this too.
  // Namespaces this image's shared-selection id (see
  // BACKGROUND_IMAGE_SELECTION_SUFFIX) so a stale selection from a
  // previously-viewed slide can never make a different slide's background
  // image render itself pre-selected.
  slideId?: string;
  xPct: number | undefined;
  yPct: number | undefined;
  widthPct: number | undefined;
  heightPct: number | undefined;
  // Optional: only "edit" mode (slide-canvas.tsx) ever needs these —
  // static/present callers (slide-thumbnail.tsx, course-preview-viewer.tsx)
  // render pixels only and never move/resize anything, so they're spared
  // from having to pass a no-op handler and a dummy ref just to satisfy
  // a type that doesn't apply to them.
  onTransform?: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef?: React.RefObject<HTMLElement | null>;
  // Where the edit controls (grip, resize handles, border, perimeter band)
  // get portaled to — see BackgroundImageEditLayer's comment on why they
  // can't just render inline next to the pixels like they used to.
  overlayRef?: React.RefObject<HTMLElement | null>;
}) {
  if (!value) return null;
  const x = xPct ?? DEFAULT_POSITION_PCT;
  const y = yPct ?? DEFAULT_POSITION_PCT;
  const w = widthPct ?? DEFAULT_SIZE_PCT;
  const h = heightPct ?? DEFAULT_SIZE_PCT;

  if (mode !== "edit" || !onTransform || !containerRef || !overlayRef || !slideId) {
    return <BackgroundImagePixels value={value} xPct={x} yPct={y} widthPct={w} heightPct={h} />;
  }
  return (
    <BackgroundImageEditLayer
      value={value}
      slideId={slideId}
      xPct={x}
      yPct={y}
      widthPct={w}
      heightPct={h}
      onTransform={onTransform}
      containerRef={containerRef}
      overlayRef={overlayRef}
    />
  );
}

function BackgroundImagePixels({
  value,
  xPct,
  yPct,
  widthPct,
  heightPct,
}: {
  value: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
}) {
  return (
    <div className="absolute z-0 overflow-hidden rounded-md" style={imageBoxStyle(xPct, yPct, widthPct, heightPct)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- see the note
          in image-field.tsx's ImageUploadField for why a plain <img> is
          used instead of next/image. */}
      <img src={value} alt="" className="h-full w-full object-fill" />
    </div>
  );
}

function BackgroundImageEditLayer({
  value,
  slideId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
  overlayRef,
}: {
  value: string;
  slideId: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  overlayRef: React.RefObject<HTMLElement | null>;
}) {
  // The controls (band/border/grip/handles) portal into overlayRef's DOM
  // node — an unclipped sibling of the slide's own clipped content
  // wrapper (see slide-canvas.tsx) — instead of rendering inline next to
  // the pixels below, which used to put them INSIDE that clipped wrapper.
  // A freshly-uploaded image defaults to 100% size, centered — exactly
  // filling the slide — so its resize handles (deliberately positioned a
  // few pixels outside the image's own box, e.g. `top: -5`, same as every
  // other resize-handle set in this app) landed exactly on or past the
  // clipped wrapper's own edge and got clipped there too: confirmed via a
  // real browser that 6 of the 8 handles were simply not clickable at
  // their rendered position the moment an image was uploaded, before ever
  // being resized down. The clipping itself can't just be removed — it's
  // what correctly crops an image bigger than the slide (widthPct up to
  // 300) to the slide's own visible bounds, a real and intended part of
  // this feature — so the fix is to keep the PIXELS inside the clipped
  // wrapper (where cropping is wanted) while moving only the CONTROLS
  // layer outside it (where clipping was never wanted, just an accident of
  // both layers sharing one ancestor).
  //
  // overlayRef.current is only settled once slide-canvas.tsx's own render
  // has committed (it's a plain sibling ref set by that component, not
  // several levels up like positionable-box.tsx's slideRef was), so this
  // needs an effect rather than reading .current straight in render, but
  // no retry loop the way that one needed either.
  const [overlayEl, setOverlayEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setOverlayEl(overlayRef.current);
  }, [overlayRef]);

  // Live transform while dragging (move or resize) — purely local, same
  // "commit once on release, not per frame" idea used everywhere else in
  // this app that has a raw pointer drag. A single {x,y,w,h} bundle rather
  // than four separate pieces of state since move and resize never happen
  // at the same time (one drag gesture at a time), so there's only ever
  // one "live" value in flight.
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const effective = live ?? { x: xPct, y: yPct, w: widthPct, h: heightPct };

  // Gates the move grip, resize handles, and dashed outline — an image with
  // no text/table/etc. to focus has no native "selected" concept the way a
  // text box does (focus-within), so this component's own selection is
  // toggled by the perimeter band below, but the actual "am I selected"
  // state now lives in the SHARED slide-selection-context rather than
  // local state — see positionable-box.tsx's comment on selectionId for
  // why: a move/resize drag has to preventDefault() on pointerdown, which
  // as a side effect suppresses the native blur of whatever text box was
  // previously focused, so that box never finds out it should deselect on
  // its own. Sharing one slot means selecting the image here automatically
  // clears any other box's own isSelected, and vice versa, without either
  // side needing to know the other exists.
  const selectionId = `${slideId}:${BACKGROUND_IMAGE_SELECTION_SUFFIX}`;
  const { selectedId, select, deselect } = useSlideSelection();
  const isSelected = selectedId === selectionId;
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSelected) return;
    function handlePointerDownOutside(e: PointerEvent) {
      const frame = frameRef.current;
      if (frame && e.target instanceof Node && !frame.contains(e.target)) {
        deselect(selectionId);
      }
    }
    // Capture phase: a click that lands on, say, a title box still needs to
    // be seen here even though that title box's own onFocus/onPointerDown
    // handlers might otherwise stop the event from bubbling by the time it
    // would reach a bubble-phase document listener.
    document.addEventListener("pointerdown", handlePointerDownOutside, true);
    return () => document.removeEventListener("pointerdown", handlePointerDownOutside, true);
  }, [isSelected, deselect, selectionId]);

  function commitTransform(next: { x: number; y: number; w: number; h: number }) {
    setLive(null);
    onTransform({ xPct: next.x, yPct: next.y, widthPct: next.w, heightPct: next.h });
  }

  // Dragging the move grip, or the perimeter band, repositions the image's
  // center. Measured against `containerRef` — the full slide root, passed
  // down from slide-canvas.tsx — so percentages stay consistent with
  // imageBoxStyle's own frame of reference.
  function handleMovePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    select(selectionId);
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startXPct = xPct;
    const startYPct = yPct;
    let current = { x: startXPct, y: startYPct, w: effective.w, h: effective.h };

    function onMove(moveEvent: PointerEvent) {
      current = {
        x: clampPositionPct(startXPct + ((moveEvent.clientX - startX) / rect.width) * 100),
        y: clampPositionPct(startYPct + ((moveEvent.clientY - startY) / rect.height) * 100),
        w: effective.w,
        h: effective.h,
      };
      setLive(current);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      commitTransform(current);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <>
      <BackgroundImagePixels value={value} xPct={effective.x} yPct={effective.y} widthPct={effective.w} heightPct={effective.h} />

      {/* Control frame: same bounds as the pixels above, but portaled into
          overlayRef's unclipped node (see this component's opening
          comment) instead of rendering here inline — the clipped wrapper
          this component itself is mounted inside (alongside the pixels
          above) is exactly what used to clip these controls off. Still
          z-20 relative to its portaled parent, same as the content
          layer's z-10 below it, so the band stays grabbable regardless of
          what's rendered on top of it. Pointer-events-none on the frame
          div itself (a full-slide image's frame would otherwise cover the
          entire slide and block every click meant for the content
          underneath); only the band, grip, and resize handles (each via
          their own pointer-events-auto) opt back in. */}
      {overlayEl &&
        createPortal(
          <div
            ref={frameRef}
            className="pointer-events-none absolute z-20 rounded-md"
            style={imageBoxStyle(effective.x, effective.y, effective.w, effective.h)}
          >
            {/* Perimeter band: four thin strips hugging the inside of the
                image's own edges, always present (not gated on isSelected
                — this is what LETS the image become selected in the first
                place). A plain click (no drag distance) selects; dragging
                selects and moves in the same gesture, exactly like
                positionable-box.tsx's identical band for text boxes.
                Deliberately a thin band rather than the whole frame
                interior: a background image commonly extends behind
                title/body text, and those boxes need every click inside
                their own bounds to keep reaching them uninterrupted —
                only the outer edge, where a background image is least
                likely to have text directly over it, opts back into
                hit-testing. */}
            <div
              onPointerDown={handleMovePointerDown}
              title="Click to select, drag to move"
              className="pointer-events-auto absolute inset-x-0 top-0 cursor-move"
              style={{ height: MOVE_BAND_PX }}
            />
            <div
              onPointerDown={handleMovePointerDown}
              title="Click to select, drag to move"
              className="pointer-events-auto absolute inset-x-0 bottom-0 cursor-move"
              style={{ height: MOVE_BAND_PX }}
            />
            <div
              onPointerDown={handleMovePointerDown}
              title="Click to select, drag to move"
              className="pointer-events-auto absolute left-0 cursor-move"
              style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
            />
            <div
              onPointerDown={handleMovePointerDown}
              title="Click to select, drag to move"
              className="pointer-events-auto absolute right-0 cursor-move"
              style={{ top: MOVE_BAND_PX, bottom: MOVE_BAND_PX, width: MOVE_BAND_PX }}
            />

            {isSelected && (
              <>
                {/* The dashed outline, move grip, and resize handles now
                    only render once selected — before that, the image
                    looks exactly like it will to a learner (just the
                    picture, no controls), matching "click off deselects,
                    select to see the controls again." */}
                <div className="pointer-events-none absolute inset-0 rounded-md border-2 border-dashed border-primary/70" />

                {/* Floats just above the box's own top edge, not centered
                    inside it — see the identical fix (and the real bug it
                    fixed) on positionable-box.tsx's move grip. */}
                <button
                  type="button"
                  onPointerDown={handleMovePointerDown}
                  aria-label="Move background image"
                  title="Drag to move"
                  className="pointer-events-auto absolute top-0 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-[130%] cursor-move items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-md"
                >
                  <Move className="h-4 w-4" />
                </button>

                <ResizeHandles
                  containerRef={containerRef}
                  widthPct={widthPct}
                  heightPct={heightPct}
                  onLiveResize={(w, h) => setLive({ x: effective.x, y: effective.y, w, h })}
                  onCommitResize={(w, h) => commitTransform({ x: effective.x, y: effective.y, w, h })}
                />
              </>
            )}
          </div>,
          overlayEl,
        )}
    </>
  );
}

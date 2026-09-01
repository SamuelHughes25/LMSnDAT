"use client";

import { useState } from "react";
import { Move } from "lucide-react";

import {
  DEFAULT_POSITION_PCT,
  DEFAULT_SIZE_PCT,
  ResizeHandles,
  clampPositionPct,
  imageBoxStyle,
} from "./image-shared";

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
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
}: {
  value: string | null | undefined;
  mode: "edit" | "static" | "present";
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
}) {
  if (!value) return null;
  const x = xPct ?? DEFAULT_POSITION_PCT;
  const y = yPct ?? DEFAULT_POSITION_PCT;
  const w = widthPct ?? DEFAULT_SIZE_PCT;
  const h = heightPct ?? DEFAULT_SIZE_PCT;

  if (mode !== "edit" || !onTransform || !containerRef) {
    return <BackgroundImagePixels value={value} xPct={x} yPct={y} widthPct={w} heightPct={h} />;
  }
  return (
    <BackgroundImageEditLayer
      value={value}
      xPct={x}
      yPct={y}
      widthPct={w}
      heightPct={h}
      onTransform={onTransform}
      containerRef={containerRef}
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
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
}: {
  value: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  // Live transform while dragging (move or resize) — purely local, same
  // "commit once on release, not per frame" idea used everywhere else in
  // this app that has a raw pointer drag. A single {x,y,w,h} bundle rather
  // than four separate pieces of state since move and resize never happen
  // at the same time (one drag gesture at a time), so there's only ever
  // one "live" value in flight.
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const effective = live ?? { x: xPct, y: yPct, w: widthPct, h: heightPct };

  function commitTransform(next: { x: number; y: number; w: number; h: number }) {
    setLive(null);
    onTransform({ xPct: next.x, yPct: next.y, widthPct: next.w, heightPct: next.h });
  }

  // Dragging the move grip repositions the image's center. Measured
  // against `containerRef` — the full slide root, passed down from
  // slide-canvas.tsx — so percentages stay consistent with imageBoxStyle's
  // own frame of reference.
  function handleMovePointerDown(e: React.PointerEvent) {
    e.preventDefault();
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

      {/* Control frame: same bounds as the pixels above, but z-20 — above
          the content layer's z-10, so it's always grabbable regardless of
          what's rendered on top of it. Pointer-events-none on the frame
          itself (a full-slide image's frame would otherwise cover the
          entire slide and block every click meant for the content
          underneath); only the move grip and the resize handles (via
          their own pointer-events-auto — see image-shared.tsx) opt back
          in. */}
      <div
        className="pointer-events-none absolute z-20 rounded-md border-2 border-dashed border-primary/70"
        style={imageBoxStyle(effective.x, effective.y, effective.w, effective.h)}
      >
        {/* Floats just above the box's own top edge, not centered inside
            it — see the identical fix (and the real bug it fixed) on
            positionable-box.tsx's move grip. This one is always visible
            (not opacity-0/hover-revealed like that one), so the failure
            mode here is milder — a visible handle blocking a click is
            discoverable, an invisible one isn't — but it's the same
            underlying issue (a background image's center can still land
            under a title/body box), so it gets the same fix. */}
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
      </div>
    </>
  );
}

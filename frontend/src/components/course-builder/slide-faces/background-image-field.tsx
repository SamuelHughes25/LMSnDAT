"use client";

import { useState } from "react";
import { ImagePlus, Loader2, Move, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_POSITION_PCT,
  DEFAULT_SIZE_PCT,
  ResizeHandles,
  clampPositionPct,
  imageBoxStyle,
  useImageUpload,
} from "./image-shared";
import type { SlideFaceProps } from "./index";

// The "image-background" layout: unlike image-field.tsx's side-by-side
// image-left/image-right (a fixed box in its own half of the row), this
// image is freely draggable anywhere on the slide and always renders
// BEHIND the title/body text — a backdrop, never something the text has to
// share space with or reflow around. Two things make that combination work
// without the text and image ever having to coordinate:
//
//  1. Layering is a flat z-index stack of siblings, not nested boxes: the
//     image's pixels render at z-0, the text layer (built by
//     content-slide-face.tsx) at z-10, and — only in edit mode — this
//     component's drag/resize controls at z-20. Because none of the
//     intermediate wrapper divs set their own z-index (only position:
//     relative, which does NOT start a new stacking context on its own),
//     all three compete directly in one shared stacking order. So the
//     controls are always reachable by the author even where the image
//     sits directly under visible text, while the *pixels* stay correctly
//     behind the text, matching exactly what a learner will see.
//  2. The empty "add an image" state is a small centered chip, not a
//     full-slide overlay — a giant invisible click target here would have
//     blocked clicks meant for the title/body fields underneath. The chip
//     lives inside a full-slide `pointer-events-none` wrapper (so
//     everywhere outside the chip passes clicks straight through to the
//     text layer below), with `pointer-events-auto` on just the chip
//     itself.
export function BackgroundImageLayer({
  value,
  mode,
  courseVersionId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onCommit,
  onTransform,
  containerRef,
}: {
  value: string | null | undefined;
  mode: SlideFaceProps["mode"];
  courseVersionId: string | undefined;
  xPct: number | undefined;
  yPct: number | undefined;
  widthPct: number | undefined;
  heightPct: number | undefined;
  onCommit: (value: string | null) => void;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const x = xPct ?? DEFAULT_POSITION_PCT;
  const y = yPct ?? DEFAULT_POSITION_PCT;
  const w = widthPct ?? DEFAULT_SIZE_PCT;
  const h = heightPct ?? DEFAULT_SIZE_PCT;

  if (mode === "edit") {
    return (
      <BackgroundImageEditor
        value={value}
        courseVersionId={courseVersionId}
        xPct={x}
        yPct={y}
        widthPct={w}
        heightPct={h}
        onCommit={onCommit}
        onTransform={onTransform}
        containerRef={containerRef}
      />
    );
  }
  // Static/present: just the pixels, at z-0 behind the text layer — no
  // upload or drag machinery mounted at all, same rule as every other
  // slide type's non-edit render.
  if (!value) return null;
  return <BackgroundImagePixels value={value} xPct={x} yPct={y} widthPct={w} heightPct={h} />;
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

function BackgroundImageEditor({
  value,
  courseVersionId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onCommit,
  onTransform,
  containerRef,
}: {
  value: string | null | undefined;
  courseVersionId: string | undefined;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onCommit: (value: string | null) => void;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  const { uploading, error, inputRef, handleFileChange, handlePaste } = useImageUpload(courseVersionId, onCommit);
  // Live transform while dragging (move or resize) — purely local, same
  // "commit once on release, not per frame" idea as image-field.tsx's
  // resize. A single {x,y,w,h} bundle rather than four separate pieces of
  // state since move and resize never happen at the same time (one drag
  // gesture at a time), so there's only ever one "live" value in flight.
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const effective = live ?? { x: xPct, y: yPct, w: widthPct, h: heightPct };

  function commitTransform(next: { x: number; y: number; w: number; h: number }) {
    setLive(null);
    onTransform({ xPct: next.x, yPct: next.y, widthPct: next.w, heightPct: next.h });
  }

  // Dragging anywhere on the control frame's background (not a resize
  // handle — those stop propagation before this ever fires) repositions
  // the image's center. Measured against `containerRef` — the full slide
  // root, passed down from content-slide-face.tsx — so percentages stay
  // consistent with imageBoxStyle's own frame of reference.
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

  if (!value) {
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div
          tabIndex={0}
          onPaste={handlePaste}
          className="pointer-events-auto flex w-72 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/30 bg-white/90 px-4 py-6 text-center text-muted-foreground/60 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
          <div className="text-sm">
            {uploading ? (
              "Uploading…"
            ) : (
              <>
                Paste a background image (Ctrl+V), or{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  disabled={!courseVersionId}
                  className="underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed"
                >
                  browse files
                </button>
              </>
            )}
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      <BackgroundImagePixels value={value} xPct={effective.x} yPct={effective.y} widthPct={effective.w} heightPct={effective.h} />

      {/* Control frame: same bounds as the pixels above, at z-20 (above the
          text layer's z-10) — but the frame itself is pointer-events-none.
          A full-slide image (the default size) would otherwise make its
          own drag-to-move surface cover the entire slide, permanently
          blocking every click meant for the title/body text underneath.
          Only three small children opt back into pointer-events: the move
          grip, the resize handles (via their own pointer-events-auto — see
          image-shared.tsx), and the Replace/Remove buttons — everywhere
          else inside the frame's bounds passes clicks straight through. */}
      <div
        className="pointer-events-none absolute z-20 rounded-md border-2 border-dashed border-primary/70"
        style={imageBoxStyle(effective.x, effective.y, effective.w, effective.h)}
      >
        <button
          type="button"
          onPointerDown={handleMovePointerDown}
          aria-label="Move image"
          title="Drag to move"
          className="pointer-events-auto absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full border-2 border-white bg-primary text-primary-foreground shadow-md"
        >
          <Move className="h-4 w-4" />
        </button>

        <div className="pointer-events-auto absolute -top-9 right-0 flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            Replace
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => onCommit(null)}
            disabled={uploading}
            aria-label="Remove image"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ResizeHandles
          containerRef={containerRef}
          widthPct={widthPct}
          heightPct={heightPct}
          onLiveResize={(w, h) => setLive({ x: effective.x, y: effective.y, w, h })}
          onCommitResize={(w, h) => commitTransform({ x: effective.x, y: effective.y, w, h })}
        />
      </div>

      {error && (
        <div className="absolute right-4 bottom-4 left-4 z-30 rounded bg-destructive/90 px-2 py-1 text-center text-xs text-white">
          {error}
        </div>
      )}
    </>
  );
}

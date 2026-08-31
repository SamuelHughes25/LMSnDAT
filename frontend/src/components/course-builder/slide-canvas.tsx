"use client";

import type { Slide, SlideConfig } from "@/lib/course-types";
import { SLIDE_TYPE_FACES } from "./slide-faces";

// Fixed 16:9 canvas size in pixels. Exported so slide-thumbnail.tsx can
// compute its scale factor (thumbWidth / CANVAS_W) — the whole "true
// miniature" thumbnail pattern depends on both places agreeing on this.
export const CANVAS_W = 960;
export const CANVAS_H = 540;

export function SlideCanvas({
  slide,
  onTitleChange,
  onConfigChange,
}: {
  slide: Slide | null;
  onTitleChange: (title: string) => void;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  // SLIDE_TYPE_FACES is a module-level constant, so this lookup always
  // yields the same component function reference for a given slide_type —
  // it must NOT be a locally-declared function component, which React would
  // treat as a new type every render and force an unwanted remount.
  const Face = slide ? SLIDE_TYPE_FACES[slide.slide_type] : null;

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted p-8">
      {slide && Face ? (
        <div
          className="shrink-0 overflow-hidden rounded-sm bg-white shadow-lg"
          style={{ width: CANVAS_W, height: CANVAS_H }}
        >
          <Face
            // Remount on slide change: resets the face's local title/body
            // state and — critically — cancels any pending debounced PATCH
            // from the previously selected slide via the debounce hook's
            // unmount cleanup, so switching slides quickly never fires a
            // stale request against the wrong slide.
            key={slide.id}
            slide={slide}
            mode="edit"
            onTitleChange={onTitleChange}
            onConfigChange={onConfigChange}
          />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Select a slide to edit it</div>
      )}
    </div>
  );
}

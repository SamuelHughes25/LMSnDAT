"use client";

import { useRef } from "react";

import type { Slide, SlideConfig } from "@/lib/course-types";
import { SlideBackgroundLayer } from "./slide-faces/background-image-field";
import { SLIDE_TYPE_FACES } from "./slide-faces";

// Fixed 16:9 canvas size in pixels. Exported so slide-thumbnail.tsx can
// compute its scale factor (thumbWidth / CANVAS_W) — the whole "true
// miniature" thumbnail pattern depends on both places agreeing on this.
export const CANVAS_W = 960;
export const CANVAS_H = 540;

export function SlideCanvas({
  slide,
  courseVersionId,
  onTitleChange,
  onConfigChange,
}: {
  slide: Slide | null;
  courseVersionId: string;
  onTitleChange: (title: string) => void;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  // SLIDE_TYPE_FACES is a module-level constant, so this lookup always
  // yields the same component function reference for a given slide_type —
  // it must NOT be a locally-declared function component, which React would
  // treat as a new type every render and force an unwanted remount.
  const Face = slide ? SLIDE_TYPE_FACES[slide.slide_type] : null;
  // The universal background image's drag/resize math measures against
  // this — the slide's own outer box, not anything inside the Face — so it
  // works the same regardless of slide_type. See background-image-field.tsx.
  const slideRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted p-8">
      {slide && Face ? (
        <div
          ref={slideRef}
          className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-lg"
          style={{ width: CANVAS_W, height: CANVAS_H }}
        >
          {/* Renders nothing at all if no background image is set — see
              background-image-field.tsx. z-0 pixels + (edit mode) z-20
              drag/resize controls; the Face below sits at z-10, in
              between, via its own wrapper. */}
          <SlideBackgroundLayer
            value={slide.config.background_image_url}
            mode="edit"
            xPct={slide.config.background_image_x_pct}
            yPct={slide.config.background_image_y_pct}
            widthPct={slide.config.background_image_width_pct}
            heightPct={slide.config.background_image_height_pct}
            onTransform={({ xPct, yPct, widthPct, heightPct }) =>
              onConfigChange({
                background_image_x_pct: xPct,
                background_image_y_pct: yPct,
                background_image_width_pct: widthPct,
                background_image_height_pct: heightPct,
              })
            }
            containerRef={slideRef}
          />
          <div className="relative z-10 h-full w-full">
            <Face
              // Remount on slide change: resets the face's local title/body
              // state and — critically — cancels any pending debounced PATCH
              // from the previously selected slide via the debounce hook's
              // unmount cleanup, so switching slides quickly never fires a
              // stale request against the wrong slide.
              key={slide.id}
              slide={slide}
              mode="edit"
              courseVersionId={courseVersionId}
              onTitleChange={onTitleChange}
              onConfigChange={onConfigChange}
            />
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Select a slide to edit it</div>
      )}
    </div>
  );
}

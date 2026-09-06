"use client";

import { useRef } from "react";

import type { Slide, SlideConfig } from "@/lib/course-types";
import { ExtraImagesLayer, SlideBackgroundLayer } from "./slide-faces/background-image-field";
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
  // Where the background image's edit controls (grip, resize handles,
  // border, perimeter band) actually render — a plain sibling of the
  // clipped content wrapper below, NOT inside it. Those controls used to
  // render inline next to the image's own pixels, sharing the same
  // overflow-hidden ancestor; that's harmless for a small/resized image but
  // clips a freshly-uploaded one, which defaults to 100% size (exactly
  // filling the slide) — its handles, positioned a few pixels outside its
  // own box the same way every resize-handle set in this app is, landed
  // exactly on the clipped wrapper's edge and were confirmed in a real
  // browser to be unclickable there. See background-image-field.tsx's
  // BackgroundImageEditLayer for the portal that targets this ref.
  const overlayRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-muted p-8">
      {slide && Face ? (
        <div className="relative shrink-0" style={{ width: CANVAS_W, height: CANVAS_H }}>
          {/* The clipped layer: everything that should actually be cropped
              to the slide's own (rounded) bounds — the background image's
              pixels (which SHOULD crop when the image is bigger than the
              slide) and the slide's own content. slideRef stays the
              percentage-math basis for both this and the overlay below,
              since this div is sized/positioned identically to its parent
              (absolute inset-0 inside a div with no padding/border of its
              own) — measuring against either gives the same numbers. */}
          <div ref={slideRef} className="absolute inset-0 overflow-hidden rounded-sm bg-white shadow-lg">
            {/* Renders nothing at all if no background image is set — see
                background-image-field.tsx. z-0 pixels; the Face below sits
                at z-10, above them. */}
            <SlideBackgroundLayer
              value={slide.config.background_image_url}
              mode="edit"
              slideId={slide.id}
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
              overlayRef={overlayRef}
            />
            <ExtraImagesLayer
              images={slide.config.extra_images ?? []}
              mode="edit"
              slideId={slide.id}
              onTransform={(id, t) =>
                onConfigChange({
                  extra_images: (slide.config.extra_images ?? []).map((img) =>
                    img.id === id ? { ...img, ...t } : img,
                  ),
                })
              }
              containerRef={slideRef}
              overlayRef={overlayRef}
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

          {/* The unclipped layer: the background image's edit controls
              portal into this div (see the comment on overlayRef above),
              so they're never cropped no matter how large or small the
              image's own box is. pointer-events-none on this wrapper
              itself — only the portaled band/grip/handles (each carrying
              their own pointer-events-auto) should ever intercept a
              click. */}
          <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Select a slide to edit it</div>
      )}
    </div>
  );
}

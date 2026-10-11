"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2 } from "lucide-react";

import type { Slide } from "@/lib/course-types";
import { cn } from "@/lib/utils";
import { CANVAS_H, CANVAS_W } from "./slide-canvas";
import { SLIDE_TYPE_FACES } from "./slide-faces";
import { ExtraImagesLayer, SlideBackgroundLayer } from "./slide-faces/background-image-field";

// Fixed pixel size, exactly 16:9 (matches CANVAS_W/CANVAS_H's ratio).
const THUMB_W = 160;
const THUMB_H = 90;
const SCALE = THUMB_W / CANVAS_W;

export function SlideThumbnail({
  slide,
  index,
  isSelected,
  onSelect,
  onDelete,
}: {
  slide: Slide;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id });
  const Face = SLIDE_TYPE_FACES[slide.slide_type];
  const isFreeformContent = slide.slide_type === "content" && slide.config.layout == null;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group relative flex shrink-0 cursor-grab touch-none items-center gap-1.5"
    >
      {/* Slide number lives in a gutter beside the thumbnail (matching a
          real slide panel), not stamped on top of the slide content — a
          badge overlaid on the thumbnail collided with title text that
          starts near the top-left corner of most layouts. */}
      <span className="w-4 shrink-0 text-right text-xs text-muted-foreground select-none">
        {index + 1}
      </span>

      <div
        className={cn(
          "relative rounded-md border-2",
          isSelected ? "border-primary" : "border-transparent hover:border-muted-foreground/30",
        )}
      >
        {/* Fixed-size, overflow-hidden viewport. The face renders at full
            canvas pixel size inside and is scaled down via CSS transform —
            a true miniature, not a separate simplified thumbnail renderer. */}
        <div
          style={{ width: THUMB_W, height: THUMB_H, overflow: "hidden", position: "relative" }}
          className="slide-surface rounded bg-white"
        >
          <div
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `scale(${SCALE})`,
              transformOrigin: "top left",
              pointerEvents: "none",
              position: "relative",
            }}
          >
            {/* Rendered at the same full canvas pixel size as the Face
                below, inside the same scaled wrapper, so the "true
                miniature" property holds for the background image too —
                it scales down along with everything else, not separately.
                Skipped for a freeform content slide — see slide-canvas.tsx's
                own isFreeformContent comment: its Face renders these itself,
                interleaved with text per object_order. */}
            {!isFreeformContent && (
              <>
                <SlideBackgroundLayer
                  value={slide.config.background_image_url}
                  mode="static"
                  xPct={slide.config.background_image_x_pct}
                  yPct={slide.config.background_image_y_pct}
                  widthPct={slide.config.background_image_width_pct}
                  heightPct={slide.config.background_image_height_pct}
                />
                <ExtraImagesLayer images={slide.config.extra_images ?? []} mode="static" />
              </>
            )}
            <div className="relative z-10 h-full w-full">
              <Face slide={slide} mode="static" />
            </div>
          </div>

          {/* Transparent overlay handles the click — the scaled content above
              has pointer-events:none so clicks would otherwise fall through
              to nothing (or, worse, to a real input inside the face). */}
          <button
            type="button"
            onClick={onSelect}
            className="absolute inset-0"
            aria-label={`Select slide ${index + 1}`}
          />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Delete slide"
          className="absolute right-1 top-1 hidden rounded bg-black/60 p-0.5 text-white hover:bg-black/80 group-hover:block"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

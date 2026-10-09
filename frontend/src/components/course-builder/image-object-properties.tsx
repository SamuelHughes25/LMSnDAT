"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Slide, SlideConfig } from "@/lib/course-types";
import { ObjectPositionFields } from "./object-position-fields";
import { CANVAS_H, CANVAS_W } from "./slide-canvas";
import {
  DEFAULT_POSITION_PCT,
  DEFAULT_SIZE_PCT,
  computeContainedSizePct,
  loadNaturalSize,
  useImageUpload,
} from "./slide-faces/image-shared";

type BaseProps = {
  slide: Slide;
  courseVersionId: string;
  onConfigChange: (config: Partial<SlideConfig>) => void;
};

export type ImageObjectPropertiesProps =
  | ({ kind: "background" } & BaseProps)
  | ({ kind: "extra"; imageId: string } & BaseProps);

// Shown in the properties panel whenever the universal background image or
// one of a slide's "extra" free-floating images is SELECTED (see
// course-builder.tsx, which reads slide-selection-context.tsx's selectedId
// to decide this) — the on-canvas counterpart (background-image-field.tsx)
// only ever handles drag-to-move/resize; add/replace/remove has always
// lived in the panel (see slide-background-panel.tsx's own "Edit > Images"
// list), so this reuses that same upload plumbing for whichever one image
// is currently selected, rather than leaving Replace/Remove unreachable
// while this view is showing.
//
// Both image kinds are CENTER-anchored (xPct/yPct is the image's center,
// not its top-left corner — see image-shared.tsx's imageBoxStyle) — labeled
// "Center X"/"Center Y" below so the numbers match what the on-canvas
// resize handles actually do (growing width/height symmetrically around
// that point), unlike a text box's top-left-anchored position fields.
export function ImageObjectProperties(props: ImageObjectPropertiesProps) {
  const { slide, courseVersionId, onConfigChange } = props;

  if (props.kind === "background") {
    const imageUrl = slide.config.background_image_url;
    if (!imageUrl) return null;
    const xPct = slide.config.background_image_x_pct ?? DEFAULT_POSITION_PCT;
    const yPct = slide.config.background_image_y_pct ?? DEFAULT_POSITION_PCT;
    const widthPct = slide.config.background_image_width_pct ?? DEFAULT_SIZE_PCT;
    const heightPct = slide.config.background_image_height_pct ?? DEFAULT_SIZE_PCT;

    return (
      <ImagePropertiesBody
        label="Background image"
        imageUrl={imageUrl}
        xPct={xPct}
        yPct={yPct}
        widthPct={widthPct}
        heightPct={heightPct}
        courseVersionId={courseVersionId}
        onTransformChange={(next) =>
          onConfigChange({
            background_image_x_pct: next.xPct,
            background_image_y_pct: next.yPct,
            background_image_width_pct: next.widthPct,
            background_image_height_pct: next.heightPct,
          })
        }
        onReplace={(url, sized) =>
          onConfigChange({
            background_image_url: url,
            ...(sized ? { background_image_width_pct: sized.widthPct, background_image_height_pct: sized.heightPct } : {}),
          })
        }
        onRemove={() => onConfigChange({ background_image_url: null })}
        removeLabel="Remove background image"
      />
    );
  }

  const image = (slide.config.extra_images ?? []).find((img) => img.id === props.imageId);
  if (!image) return null;

  return (
    <ImagePropertiesBody
      label="Image"
      imageUrl={image.url}
      xPct={image.xPct}
      yPct={image.yPct}
      widthPct={image.widthPct}
      heightPct={image.heightPct}
      courseVersionId={courseVersionId}
      onTransformChange={(next) =>
        onConfigChange({
          extra_images: (slide.config.extra_images ?? []).map((img) =>
            img.id === props.imageId ? { ...img, ...next } : img,
          ),
        })
      }
      onReplace={(url, sized) =>
        onConfigChange({
          extra_images: (slide.config.extra_images ?? []).map((img) =>
            img.id === props.imageId ? { ...img, url, ...(sized ?? {}) } : img,
          ),
        })
      }
      onRemove={() =>
        onConfigChange({ extra_images: (slide.config.extra_images ?? []).filter((img) => img.id !== props.imageId) })
      }
      removeLabel="Remove image"
    />
  );
}

function ImagePropertiesBody({
  label,
  imageUrl,
  xPct,
  yPct,
  widthPct,
  heightPct,
  courseVersionId,
  onTransformChange,
  onReplace,
  onRemove,
  removeLabel,
}: {
  label: string;
  imageUrl: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  courseVersionId: string;
  onTransformChange: (next: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  onReplace: (url: string, sized: { widthPct: number; heightPct: number } | null) => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  // Same "refit size to the new image's own aspect ratio, keep whatever
  // position it's already at" behavior as slide-background-panel.tsx's own
  // ImageRow — a replacement swaps the picture, not where/how big the
  // author had it.
  async function handleUploadedUrl(url: string | null) {
    if (!url) return;
    const naturalSize = await loadNaturalSize(url);
    const sized = naturalSize ? computeContainedSizePct(naturalSize.width, naturalSize.height, CANVAS_W, CANVAS_H) : null;
    onReplace(url, sized);
  }

  const { uploading, error, inputRef, handleFileChange } = useImageUpload(courseVersionId, handleUploadedUrl);

  return (
    <div className="space-y-4 p-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>

      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element -- an admin-uploaded asset URL, not a static/known-domain import next/image can optimize. */}
        <img src={imageUrl} alt="" className="h-10 w-16 rounded border border-border object-cover" />
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Replace"}
        </Button>
        <Button type="button" variant="outline" size="icon-sm" onClick={onRemove} disabled={uploading} aria-label={removeLabel}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-muted-foreground/70">Position &amp; size</div>
        <ObjectPositionFields
          xLabel="Center X"
          yLabel="Center Y"
          xPct={xPct}
          yPct={yPct}
          widthPct={widthPct}
          heightPct={heightPct}
          onChange={onTransformChange}
        />
      </div>
    </div>
  );
}

"use client";

import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ExtraImage, SlideConfig } from "@/lib/course-types";
import { CANVAS_H, CANVAS_W } from "./slide-canvas";
import {
  clampPositionPct,
  computeContainedSizePct,
  loadNaturalSize,
  useImageUpload,
} from "./slide-faces/image-shared";

// Total images allowed per slide (the background image, if set, plus every
// extra_images entry) — one combined cap, not "1 background + 8 extra",
// since the panel now presents them as a single undifferentiated list (see
// SlideBackgroundPanel below).
const MAX_IMAGES = 8;

function makeExtraImageId(n: number) {
  return `extra_image_${n}_${Date.now().toString(36)}`;
}

// Shared by every row in the unified images list below: an empty dashed
// paste/browse box when there's nothing set yet (only ever the persistent
// "add" row uses this state), or a small thumbnail + Replace/Remove once
// there is. Pulled out once three call sites needed the identical markup
// rather than drifting into three near-copies.
function ImageSlotControl({
  imageUrl,
  courseVersionId,
  uploading,
  error,
  inputRef,
  handleFileChange,
  handlePaste,
  onReplace,
  onRemove,
  removeLabel,
}: {
  imageUrl: string | null | undefined;
  courseVersionId: string | undefined;
  uploading: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  onReplace: () => void;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      {imageUrl ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- see the
              note in image-field.tsx's ImageUploadField for why a plain
              <img> is used instead of next/image. */}
          <img src={imageUrl} alt="" className="h-10 w-16 rounded border border-border object-cover" />
          <Button type="button" variant="outline" size="sm" onClick={onReplace} disabled={uploading}>
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onRemove}
            disabled={uploading}
            aria-label={removeLabel}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <div
          tabIndex={0}
          onPaste={handlePaste}
          className="flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-border px-3 py-4 text-center text-muted-foreground/60 outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          <div className="text-xs">
            {uploading ? (
              "Uploading…"
            ) : (
              <>
                Paste (Ctrl+V) or{" "}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  disabled={!courseVersionId}
                  className="underline underline-offset-2 hover:text-foreground disabled:cursor-not-allowed"
                >
                  browse
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <div className="text-xs text-destructive">{error}</div>}
    </div>
  );
}

// The "Edit" section of the properties panel — settings that apply to
// *any* slide, regardless of slide_type or (for content slides) layout.
// Images are the first of these; a background color is the planned next
// one, and would get its own small control added here alongside this —
// this section is meant to be the one place cross-cutting slide styling
// lives, deliberately separate from the content-type-specific "Layout"
// section above it.
//
// Presented as ONE unified list (the background image, if set, followed
// by every extra_images entry) with ONE persistent "add" row at the
// bottom — not two separately-labeled sections. Originally built as two
// sections ("Background image" + "Extra images") since background_image_*
// and extra_images are genuinely separate config fields (kept that way
// below, purely to avoid migrating already-authored slides' data for a
// purely additive feature — see extra_images' own comment in
// course-types.ts), but that split was reported back as confusing UI: the
// author just wants "a list of images on this slide," not two boxes that
// behave slightly differently depending on which one happens to be empty.
// The add row here writes to whichever field is actually next: the
// background field if unset, otherwise a new extra_images entry — the
// author never has to know or care which.
//
// This owns add/replace/remove exclusively (not duplicated as on-canvas
// hover buttons — see background-image-field.tsx, which only handles
// drag-to-move and resize once an image exists). Repositioning/resizing
// stays a direct-manipulation, on-canvas interaction; add/replace/remove
// are simple discrete actions that fit a properties-panel control better,
// and a single owner for those three actions is one less place for the
// two surfaces to drift out of sync.
export function SlideBackgroundPanel({
  imageUrl,
  extraImages,
  courseVersionId,
  onConfigChange,
}: {
  imageUrl: string | null | undefined;
  extraImages: ExtraImage[];
  courseVersionId: string | undefined;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  function updateExtraImage(id: string, patch: Partial<ExtraImage>) {
    onConfigChange({ extra_images: extraImages.map((img) => (img.id === id ? { ...img, ...patch } : img)) });
  }

  function removeExtraImage(id: string) {
    onConfigChange({ extra_images: extraImages.filter((img) => img.id !== id) });
  }

  const totalImages = (imageUrl ? 1 : 0) + extraImages.length;

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Edit</div>
      <div className="text-[11px] font-medium text-muted-foreground/70">Images</div>
      {/* Confirmed via a real browser to be a genuine point of confusion:
          these free-floating images and the "Image left"/"Image right"
          layout's own on-canvas picture box both look like "the place to
          paste an image" (near-identical "Paste (Ctrl+V) or browse"
          wording), but they're independent fields — these sit behind the
          whole slide, that one is the layout's own dedicated content
          image. This caption exists to head that off before it happens. */}
      <p className="text-[10px] text-muted-foreground/60">
        Behind the whole slide — separate from the picture in an Image left/right layout.
      </p>

      {/* The background image, if set, always renders first — it's still
          the same background_image_url field underneath (see the comment
          above), just presented as the first row of one list rather than
          its own section. */}
      {imageUrl && (
        <ImageRow
          imageUrl={imageUrl}
          courseVersionId={courseVersionId}
          onReplaceUrl={(url, sized) =>
            onConfigChange({
              background_image_url: url,
              ...(sized ? { background_image_width_pct: sized.widthPct, background_image_height_pct: sized.heightPct } : {}),
            })
          }
          onRemove={() => onConfigChange({ background_image_url: null })}
        />
      )}

      {extraImages.map((image) => (
        <ImageRow
          key={image.id}
          imageUrl={image.url}
          courseVersionId={courseVersionId}
          onReplaceUrl={(url, sized) => updateExtraImage(image.id, { url, ...(sized ?? {}) })}
          onRemove={() => removeExtraImage(image.id)}
        />
      ))}

      {/* The persistent "add one more" row — reported directly as a real
          gap when this was split into two sections: once the single
          Background image slot was filled, there was no way to add a
          second image at all — "the ctrl+v dropbox disappears on the
          side... I can't ctrl+v another in." This row never holds a value
          itself (imageUrl is always null for it), so it never "fills up"
          and disappears — pasting into it commits a new image (to
          whichever field is next, see handleAdd below) and the row resets,
          ready for the next one. */}
      {totalImages < MAX_IMAGES && courseVersionId && (
        <AddImageRow
          courseVersionId={courseVersionId}
          hasBackground={!!imageUrl}
          nextExtraIndex={extraImages.length}
          onAddBackground={(url, sized) =>
            onConfigChange({
              background_image_url: url,
              ...(sized ?? {}),
            })
          }
          onAddExtra={(image) => onConfigChange({ extra_images: [...extraImages, image] })}
        />
      )}
    </div>
  );
}

// One already-added image, whether it's the background or an extra_images
// entry — the caller decides where a replacement URL gets written (see
// onReplaceUrl above); this component doesn't know or care which. Its own
// useImageUpload instance means Replace can swap this specific row's
// picture without touching any other row. Keeps whatever position the
// image is already at (a plain URL swap, not a repositioning) — only
// widthPct/heightPct get recomputed, refit to the new image's own aspect
// ratio, same "keep position, refit size" behavior this always had.
function ImageRow({
  imageUrl,
  courseVersionId,
  onReplaceUrl,
  onRemove,
}: {
  imageUrl: string;
  courseVersionId: string | undefined;
  onReplaceUrl: (url: string, sized: { widthPct: number; heightPct: number } | null) => void;
  onRemove: () => void;
}) {
  async function handleUploadedUrl(url: string | null) {
    if (!url) return; // this row has no empty state to fall back to — see ImageSlotControl usage below
    const naturalSize = await loadNaturalSize(url);
    const sized = naturalSize ? computeContainedSizePct(naturalSize.width, naturalSize.height, CANVAS_W, CANVAS_H) : null;
    onReplaceUrl(url, sized);
  }

  const { uploading, error, inputRef, handleFileChange } = useImageUpload(courseVersionId, handleUploadedUrl);

  return (
    <ImageSlotControl
      imageUrl={imageUrl}
      courseVersionId={courseVersionId}
      uploading={uploading}
      error={error}
      inputRef={inputRef}
      handleFileChange={handleFileChange}
      handlePaste={() => {}}
      onReplace={() => inputRef.current?.click()}
      onRemove={onRemove}
      removeLabel="Remove image"
    />
  );
}

// The persistent "add one more" row from the panel's own comment above —
// deliberately never shows a filled state itself (imageUrl is always
// null). Writes the FIRST image on a slide to the background field
// (unresized-position, fills the slide by default, matching this field's
// original behavior) and every image after that to a new, staggered
// extra_images entry — staggered diagonally off-center (rather than every
// one defaulting to dead-center, on top of the last) purely so a second
// paste is visibly a NEW image and not "did that just do nothing." The
// author never picks which field a new image goes to; this is purely an
// implementation detail of "the next slot."
function AddImageRow({
  courseVersionId,
  hasBackground,
  nextExtraIndex,
  onAddBackground,
  onAddExtra,
}: {
  courseVersionId: string;
  hasBackground: boolean;
  nextExtraIndex: number;
  onAddBackground: (url: string, sized: { background_image_width_pct: number; background_image_height_pct: number } | null) => void;
  onAddExtra: (image: ExtraImage) => void;
}) {
  async function handleUploadedUrl(url: string | null) {
    if (!url) return;
    const naturalSize = await loadNaturalSize(url);
    const sized = naturalSize ? computeContainedSizePct(naturalSize.width, naturalSize.height, CANVAS_W, CANVAS_H) : null;

    if (!hasBackground) {
      onAddBackground(
        url,
        sized ? { background_image_width_pct: sized.widthPct, background_image_height_pct: sized.heightPct } : null,
      );
      return;
    }

    const offset = (nextExtraIndex % 4) * 6;
    const xPct = clampPositionPct(50 + offset);
    const yPct = clampPositionPct(50 + offset);
    onAddExtra({
      id: makeExtraImageId(nextExtraIndex + 1),
      url,
      xPct,
      yPct,
      ...(sized ?? { widthPct: 100, heightPct: 100 }),
    });
  }

  const { uploading, error, inputRef, handleFileChange, handlePaste } = useImageUpload(
    courseVersionId,
    handleUploadedUrl,
  );

  return (
    <ImageSlotControl
      imageUrl={null}
      courseVersionId={courseVersionId}
      uploading={uploading}
      error={error}
      inputRef={inputRef}
      handleFileChange={handleFileChange}
      handlePaste={handlePaste}
      onReplace={() => {}}
      onRemove={() => {}}
      removeLabel=""
    />
  );
}

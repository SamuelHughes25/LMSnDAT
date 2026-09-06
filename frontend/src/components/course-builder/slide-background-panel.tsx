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

const MAX_EXTRA_IMAGES = 8;

function makeExtraImageId(n: number) {
  return `extra_image_${n}_${Date.now().toString(36)}`;
}

// Shared by the single background image below and each row in the "Extra
// images" list: an empty dashed paste/browse box when there's nothing set
// yet, or a small thumbnail + Replace/Remove once there is. Pulled out
// once three call sites needed the identical markup (it used to be
// written out just for the background image, before "Extra images"
// existed) rather than drifting into three near-copies.
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
// Background image is the first of these; a background color is the
// planned next one, and would get its own small control added here
// alongside this — this section is meant to be the one place cross-cutting
// slide styling lives, deliberately separate from the content-type-
// specific "Layout" section above it.
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
  // Sizes a fresh background upload to its own aspect ratio (fit within
  // the fixed 960x540 canvas, same "contain" math image-field.tsx's own
  // upload path uses) instead of leaving it at the default 100%x100% —
  // full-canvas — box every background starts at until resized, which
  // object-fit: fill then stretches to match, distorting anything that
  // isn't already a 16:9 photo. No DOM measurement needed here (unlike
  // image-field.tsx): the background's container is always the whole
  // canvas, a known constant, not a flex-allocated box that varies by
  // layout.
  async function handleUploadedUrl(url: string | null) {
    if (!url) {
      onConfigChange({ background_image_url: null });
      return;
    }
    const naturalSize = await loadNaturalSize(url);
    if (naturalSize) {
      const sized = computeContainedSizePct(naturalSize.width, naturalSize.height, CANVAS_W, CANVAS_H);
      onConfigChange({
        background_image_url: url,
        background_image_width_pct: sized.widthPct,
        background_image_height_pct: sized.heightPct,
      });
      return;
    }
    onConfigChange({ background_image_url: url });
  }

  const { uploading, error, inputRef, handleFileChange, handlePaste } = useImageUpload(
    courseVersionId,
    handleUploadedUrl,
  );

  function updateExtraImage(id: string, patch: Partial<ExtraImage>) {
    onConfigChange({ extra_images: extraImages.map((img) => (img.id === id ? { ...img, ...patch } : img)) });
  }

  function removeExtraImage(id: string) {
    onConfigChange({ extra_images: extraImages.filter((img) => img.id !== id) });
  }

  function addExtraImage(image: ExtraImage) {
    onConfigChange({ extra_images: [...extraImages, image] });
  }

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Edit</div>
      <div className="text-[11px] font-medium text-muted-foreground/70">Background image</div>
      {/* Confirmed via a real browser to be a genuine point of confusion:
          this field and the "Image left"/"Image right" layout's own
          on-canvas picture box both look like "the place to paste an
          image" (near-identical "Paste (Ctrl+V) or browse" wording), but
          they're two independent fields — this one sits behind the whole
          slide, that one is the layout's own dedicated content image.
          Reported as "I pasted via the side nav and the box on the page
          didn't disappear" — the paste itself worked (it set THIS field,
          confirmed in a real browser), the on-canvas box the user was
          actually watching just isn't what this field controls. This
          caption exists to head that off before it happens rather than to
          fix a broken paste. */}
      <p className="text-[10px] text-muted-foreground/60">
        Behind the whole slide — separate from the picture in an Image left/right layout.
      </p>

      <ImageSlotControl
        imageUrl={imageUrl}
        courseVersionId={courseVersionId}
        uploading={uploading}
        error={error}
        inputRef={inputRef}
        handleFileChange={handleFileChange}
        handlePaste={handlePaste}
        onReplace={() => inputRef.current?.click()}
        onRemove={() => onConfigChange({ background_image_url: null })}
        removeLabel="Remove background image"
      />

      {/* "Extra images" — any number of additional free-floating images
          beyond the one above, each independently draggable/resizable on
          the canvas (see background-image-field.tsx's ExtraImagesLayer).
          Reported directly as a real gap: once the single Background
          image slot above was filled, there was no way to add a second
          image to the same slide at all — "the ctrl+v dropbox disappears
          on the side... I can't ctrl+v another in." The "Add image" row
          below is the fix: it never holds a value itself (imageUrl is
          always null for it), so it never "fills up" and disappear —
          pasting into it creates a new entry in the list below and the
          row resets, ready for the next one. */}
      {(extraImages.length > 0 || courseVersionId) && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[11px] font-medium text-muted-foreground/70">Extra images</div>
          {extraImages.map((image) => (
            <ExtraImageRow
              key={image.id}
              image={image}
              courseVersionId={courseVersionId}
              onUpdate={(patch) => updateExtraImage(image.id, patch)}
              onRemove={() => removeExtraImage(image.id)}
            />
          ))}
          {extraImages.length < MAX_EXTRA_IMAGES && (
            <AddExtraImageRow
              courseVersionId={courseVersionId}
              nextIndex={extraImages.length}
              onAdd={addExtraImage}
            />
          )}
        </div>
      )}
    </div>
  );
}

// One already-added extra image — its own useImageUpload instance so
// Replace can swap this specific entry's picture without touching any of
// the others. Keeps this entry's xPct/yPct (wherever it was last dragged
// to) on replace, only recomputing widthPct/heightPct for the new image's
// own aspect ratio — same "keep position, refit size" behavior the main
// background image's own Replace already has.
function ExtraImageRow({
  image,
  courseVersionId,
  onUpdate,
  onRemove,
}: {
  image: ExtraImage;
  courseVersionId: string | undefined;
  onUpdate: (patch: Partial<ExtraImage>) => void;
  onRemove: () => void;
}) {
  async function handleUploadedUrl(url: string | null) {
    if (!url) return; // this row has no empty state to fall back to — see ImageSlotControl usage below
    const naturalSize = await loadNaturalSize(url);
    if (naturalSize) {
      const sized = computeContainedSizePct(naturalSize.width, naturalSize.height, CANVAS_W, CANVAS_H);
      onUpdate({ url, widthPct: sized.widthPct, heightPct: sized.heightPct });
      return;
    }
    onUpdate({ url });
  }

  const { uploading, error, inputRef, handleFileChange } = useImageUpload(courseVersionId, handleUploadedUrl);

  return (
    <ImageSlotControl
      imageUrl={image.url}
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

// The persistent "add one more" row — deliberately never shows a filled
// state itself (imageUrl is always null): once an image lands here, it's
// handed off to the parent as a brand-new extra_images entry and this row
// goes right back to its own empty paste box, ready for the next one.
// Each new image is staggered diagonally off-center (rather than every
// one defaulting to dead-center, on top of the last) purely so a second
// paste is visibly a NEW image and not "did that just do nothing" — the
// author can drag it wherever they actually want from there.
function AddExtraImageRow({
  courseVersionId,
  nextIndex,
  onAdd,
}: {
  courseVersionId: string | undefined;
  nextIndex: number;
  onAdd: (image: ExtraImage) => void;
}) {
  async function handleUploadedUrl(url: string | null) {
    if (!url) return;
    const naturalSize = await loadNaturalSize(url);
    const offset = (nextIndex % 4) * 6;
    const xPct = clampPositionPct(50 + offset);
    const yPct = clampPositionPct(50 + offset);
    const sized = naturalSize
      ? computeContainedSizePct(naturalSize.width, naturalSize.height, CANVAS_W, CANVAS_H)
      : { widthPct: 100, heightPct: 100 };
    onAdd({ id: makeExtraImageId(nextIndex + 1), url, xPct, yPct, ...sized });
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

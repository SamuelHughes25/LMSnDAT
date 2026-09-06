"use client";

import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SlideConfig } from "@/lib/course-types";
import { CANVAS_H, CANVAS_W } from "./slide-canvas";
import { computeContainedSizePct, loadNaturalSize, useImageUpload } from "./slide-faces/image-shared";

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
  courseVersionId,
  onConfigChange,
}: {
  imageUrl: string | null | undefined;
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

      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      {imageUrl ? (
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- see the
              note in image-field.tsx's ImageUploadField for why a plain
              <img> is used instead of next/image. */}
          <img src={imageUrl} alt="" className="h-10 w-16 rounded border border-border object-cover" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            Replace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onConfigChange({ background_image_url: null })}
            disabled={uploading}
            aria-label="Remove background image"
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

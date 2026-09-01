"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SIZE_PCT,
  ResizeHandles,
  imageBoxStyle,
  useImageUpload,
} from "./image-shared";
import type { SlideFaceProps } from "./index";

// The side-by-side image-left/image-right layouts: a fixed-position box
// (always centered at 50/50 in its flex-1 slot) that can be resized but not
// repositioned. For a freely draggable image that floats behind the slide's
// text instead of sitting in its own column, see background-image-field.tsx
// — a deliberately separate component rather than a mode flag on this one,
// since the two differ in more than configuration (different DOM shape,
// different z-index relationship with sibling text, an extra move-drag
// interaction) and forcing them through one component would mean more
// internal branching than just having two focused ones.
export function EditableImage({
  value,
  mode,
  courseVersionId,
  widthPct,
  heightPct,
  onCommit,
  onResize,
  className,
}: {
  value: string | null | undefined;
  mode: SlideFaceProps["mode"];
  courseVersionId: string | undefined;
  widthPct: number | undefined;
  heightPct: number | undefined;
  onCommit: (value: string | null) => void;
  onResize: (widthPct: number, heightPct: number) => void;
  className?: string;
}) {
  if (mode === "edit") {
    return (
      <ImageUploadField
        value={value}
        courseVersionId={courseVersionId}
        widthPct={widthPct ?? DEFAULT_SIZE_PCT}
        heightPct={heightPct ?? DEFAULT_SIZE_PCT}
        onCommit={onCommit}
        onResize={onResize}
        className={className}
      />
    );
  }
  return (
    <ImageStatic
      value={value}
      widthPct={widthPct ?? DEFAULT_SIZE_PCT}
      heightPct={heightPct ?? DEFAULT_SIZE_PCT}
      className={className}
    />
  );
}

function ImageUploadField({
  value,
  courseVersionId,
  widthPct,
  heightPct,
  onCommit,
  onResize,
  className,
}: {
  value: string | null | undefined;
  courseVersionId: string | undefined;
  widthPct: number;
  heightPct: number;
  onCommit: (value: string | null) => void;
  onResize: (widthPct: number, heightPct: number) => void;
  className?: string;
}) {
  const { uploading, error, inputRef, handleFileChange, handlePaste } = useImageUpload(courseVersionId, onCommit);
  const containerRef = useRef<HTMLDivElement>(null);
  // Live size while a resize handle is being dragged — kept purely local so
  // dragging is smooth and fires zero network requests; only the final
  // value (on pointerup) reaches onResize -> onConfigChange -> the real
  // PATCH. Same "commit once, not per intermediate frame" idea as
  // dnd-kit's reorder-on-drop elsewhere in this app, just for a raw pointer
  // drag instead of a drag-and-drop library.
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);
  const effectiveWidthPct = liveSize?.width ?? widthPct;
  const effectiveHeightPct = liveSize?.height ?? heightPct;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onPaste={handlePaste}
      className={cn(
        "group relative z-10 flex h-full w-full items-center justify-center rounded-md bg-muted outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        className,
      )}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />

      {value ? (
        // This positioning box deliberately has NO overflow-hidden of its
        // own — the resize handles below are positioned just outside its
        // edges (e.g. top: -5px), and an overflow-hidden ancestor would
        // clip them off. Only the inner wrapper around the <img> clips (for
        // the rounded corners), leaving the handles unaffected.
        <div style={imageBoxStyle(50, 50, effectiveWidthPct, effectiveHeightPct)}>
          <div className="h-full w-full overflow-hidden rounded-md">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded
                asset URL isn't a static/known-domain import next/image can
                optimize, and these are admin-authored training images, not a
                case that needs automatic optimization. */}
            <img src={value} alt="" className="h-full w-full object-fill" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
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
            onLiveResize={(width, height) => setLiveSize({ width, height })}
            onCommitResize={(width, height) => {
              setLiveSize(null);
              onResize(width, height);
            }}
          />
        </div>
      ) : (
        // Deliberately NOT one big button — clicking anywhere to focus the
        // box (so Ctrl+V would have something to paste into) used to also
        // fire the file picker, which steals OS-level focus the instant it
        // opens, so the keyboard shortcut never had anywhere to land. Only
        // the small "browse files" link opens the picker; clicking
        // anywhere else in the box just focuses the wrapper div above
        // (native behavior for any tabIndex'd element), leaving Ctrl+V
        // free to work immediately.
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground/60">
          {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
          <div className="text-center text-sm">
            {uploading ? (
              "Uploading…"
            ) : (
              <>
                Paste an image (Ctrl+V), or{" "}
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
        </div>
      )}

      {error && (
        <div className="absolute right-1 bottom-1 left-1 rounded bg-destructive/90 px-2 py-1 text-center text-xs text-white">
          {error}
        </div>
      )}
    </div>
  );
}

// Thumbnails/preview never mount upload or resize machinery at all — a
// plain <img> sized/centered the same way the editor's box is (so a resize
// actually shows up for learners, not just in the builder), or an empty
// muted box if no image has been set yet. Same "must never mount anything
// interactive/expensive" rule already applied to every other slide type's
// static render.
function ImageStatic({
  value,
  widthPct,
  heightPct,
  className,
}: {
  value: string | null | undefined;
  widthPct: number;
  heightPct: number;
  className?: string;
}) {
  if (!value) {
    return <div className={cn("h-full w-full rounded-md bg-muted", className)} />;
  }
  return (
    <div className={cn("relative h-full w-full overflow-visible rounded-md bg-muted", className)}>
      <div className="overflow-hidden rounded-md" style={imageBoxStyle(50, 50, widthPct, heightPct)}>
        {/* See the note on ImageUploadField above for why a plain <img> is used. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="" className="h-full w-full object-fill" />
      </div>
    </div>
  );
}

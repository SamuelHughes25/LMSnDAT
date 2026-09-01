"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

import { uploadCourseAsset } from "@/app/actions/courses";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SlideFaceProps } from "./index";

const DEFAULT_SIZE_PCT = 100;
const MIN_SIZE_PCT = 20;
const MAX_SIZE_PCT = 300;

function clampPct(v: number): number {
  return Math.min(MAX_SIZE_PCT, Math.max(MIN_SIZE_PCT, v));
}

// The picture's box is always centered in its container via `top/left: 50%`
// + `translate(-50%, -50%)` — a CSS anchor, not something computed in JS —
// so changing width/height here can never move the center point: the box
// grows or shrinks equally on every side around that fixed anchor "for
// free," with no mirrored-offset math needed anywhere else (ResizeHandles
// below only ever adjusts widthPct/heightPct, never top/left).
function imageBoxStyle(widthPct: number, heightPct: number): React.CSSProperties {
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    transform: "translate(-50%, -50%)",
  };
}

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

// Uploads through uploadCourseAsset (a Server Action, called imperatively —
// no <form> needed) directly to Django's existing /course-assets/ endpoint,
// which was built alongside the courses backend but never had a frontend
// caller until now. On success, config.image_url is set to the returned
// asset's file URL — see the comment on SlideConfig.image_url in
// course-types.ts for why this stores the URL directly rather than an
// asset id. `uploadFile` is shared by both the file-picker input and the
// clipboard-paste handler below — they differ only in where the File comes
// from.
//
// Known limitation, not solved here: in this dev setup Django's file URL is
// directly reachable by the browser (both run on localhost), but the app's
// documented BFF architecture (see docs/PROJECT_LOG.md) makes Django
// internal-only in production — an image URL built from an internal-only
// request wouldn't resolve for a real learner's browser. Serving uploaded
// images through a public path (a Next.js proxy route, or switching
// production storage to a public/presigned S3-compatible URL — the
// STORAGE_BACKEND=s3 config already exists for exactly this) is a real but
// separate piece of work, flagged here rather than silently assumed solved.
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  async function uploadFile(file: File) {
    if (!courseVersionId) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("course_version", courseVersionId);
      formData.append("kind", "image");
      formData.append("file", file);
      const asset = await uploadCourseAsset(formData);
      onCommit(asset.file);
    } catch {
      setError("Upload failed — try a different image.");
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset the input's value so selecting the same file again (e.g. after
    // Replace) still fires a change event.
    e.target.value = "";
    if (file) uploadFile(file);
  }

  // Fires whenever this box (or a focused descendant, e.g. the "click to
  // add image" button — paste events bubble) has focus and the user presses
  // Ctrl/Cmd+V. Only handled when the clipboard actually carries an image;
  // anything else (e.g. copied text) is left alone so it doesn't swallow a
  // paste the user meant for some other field.
  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) uploadFile(file);
  }

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
        <div style={imageBoxStyle(effectiveWidthPct, effectiveHeightPct)}>
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
        // Deliberately NOT one big button anymore — that made the box
        // unpasteable: clicking anywhere to focus it (so Ctrl+V would have
        // something to paste into) also fired the file picker, which steals
        // OS-level focus the instant it opens, so the keyboard shortcut
        // never had anywhere to land. Now only the small "browse files"
        // link opens the picker; clicking anywhere else in the box just
        // focuses the wrapper div above (native behavior for any
        // tabIndex'd element), leaving Ctrl+V free to work immediately.
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

type HandleDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Position each handle relative to the image box's own edges/corners — the
// box itself is already centered via imageBoxStyle, so these never need to
// know anything about the container's size or position, only the box's.
const HANDLES: { dir: HandleDir; style: React.CSSProperties; cursor: string }[] = [
  { dir: "nw", style: { top: -5, left: -5 }, cursor: "nwse-resize" },
  { dir: "n", style: { top: -5, left: "50%", transform: "translateX(-50%)" }, cursor: "ns-resize" },
  { dir: "ne", style: { top: -5, right: -5 }, cursor: "nesw-resize" },
  { dir: "e", style: { top: "50%", right: -5, transform: "translateY(-50%)" }, cursor: "ew-resize" },
  { dir: "se", style: { bottom: -5, right: -5 }, cursor: "nwse-resize" },
  { dir: "s", style: { bottom: -5, left: "50%", transform: "translateX(-50%)" }, cursor: "ns-resize" },
  { dir: "sw", style: { bottom: -5, left: -5 }, cursor: "nesw-resize" },
  { dir: "w", style: { top: "50%", left: -5, transform: "translateY(-50%)" }, cursor: "ew-resize" },
];

// Eight PowerPoint/Keynote-style handles — corners stretch both axes at
// once (independently, not locked to the original aspect ratio: "stretched
// and change shape" was the ask, so this deliberately allows distortion),
// edge midpoints stretch one axis only. Every handle only ever changes
// widthPct/heightPct; the box's centering (imageBoxStyle) is what keeps the
// middle fixed, so there's nothing else for this component to get right.
function ResizeHandles({
  containerRef,
  widthPct,
  heightPct,
  onLiveResize,
  onCommitResize,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  widthPct: number;
  heightPct: number;
  onLiveResize: (widthPct: number, heightPct: number) => void;
  onCommitResize: (widthPct: number, heightPct: number) => void;
}) {
  function handlePointerDown(dir: HandleDir, e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;

    // Measured once, at drag start — the container (the flex-1 "half of the
    // slide" slot) doesn't change size mid-drag, only the image box inside
    // it does, so this stays a valid percentage basis for the whole drag.
    const rect = container.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = widthPct;
    const startH = heightPct;
    let currentW = startW;
    let currentH = startH;

    function onMove(moveEvent: PointerEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      // A handle moving away from the center by `d` grows that axis by
      // `2*d` — half on the side the handle is on, mirrored on the
      // opposite side by the centering transform — not `d`.
      let w = startW;
      let h = startH;
      if (dir.includes("e")) w = startW + ((2 * dx) / rect.width) * 100;
      if (dir.includes("w")) w = startW - ((2 * dx) / rect.width) * 100;
      if (dir.includes("s")) h = startH + ((2 * dy) / rect.height) * 100;
      if (dir.includes("n")) h = startH - ((2 * dy) / rect.height) * 100;
      currentW = clampPct(w);
      currentH = clampPct(h);
      onLiveResize(currentW, currentH);
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      onCommitResize(currentW, currentH);
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <>
      {HANDLES.map(({ dir, style, cursor }) => (
        <div
          key={dir}
          onPointerDown={(e) => handlePointerDown(dir, e)}
          className="absolute z-20 h-2.5 w-2.5 rounded-sm border border-white bg-primary shadow-sm"
          style={{ ...style, cursor }}
        />
      ))}
    </>
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
      <div className="overflow-hidden rounded-md" style={imageBoxStyle(widthPct, heightPct)}>
        {/* See the note on ImageUploadField above for why a plain <img> is used. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="" className="h-full w-full object-fill" />
      </div>
    </div>
  );
}

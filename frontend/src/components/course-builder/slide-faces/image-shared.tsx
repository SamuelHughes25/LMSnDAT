"use client";

import { useRef, useState } from "react";

import { uploadCourseAsset } from "@/app/actions/courses";

// Shared by every image-editing surface on the content slide type
// (image-field.tsx's side-by-side layouts, background-image-field.tsx's
// free-floating background layout) — upload/paste plumbing, size clamping,
// centered-box positioning math, and the resize-handle drag logic are all
// identical between them; only how the box is positioned (fixed at 50/50
// vs. anywhere the author drags it to) differs. Keeping this in one place
// means a fix or change to any of it (e.g. the upload error message, the
// resize math) never needs to be made twice and can't drift between the
// two call sites.

export const DEFAULT_SIZE_PCT = 100;
export const MIN_SIZE_PCT = 20;
export const MAX_SIZE_PCT = 300;
// Center point default for the free-floating background layout — the
// middle of the slide. image-field.tsx's side-by-side layouts don't use
// this; their center is always a hardcoded 50/50 (fixed, non-draggable).
export const DEFAULT_POSITION_PCT = 50;

export function clampSizePct(v: number): number {
  return Math.min(MAX_SIZE_PCT, Math.max(MIN_SIZE_PCT, v));
}

// Center point is clamped to stay within the container (0-100%) — the box
// can still extend beyond the container's edges once it's wider/taller than
// its container (via widthPct/heightPct > 100), but its middle can't be
// dragged out of the slide entirely.
export function clampPositionPct(v: number): number {
  return Math.min(100, Math.max(0, v));
}

// The picture's box is centered on (xPct, yPct) via `top/left: X%` +
// `translate(-50%, -50%)` — a CSS anchor, not something computed in JS — so
// changing width/height can never move the center point: the box grows or
// shrinks equally on every side around that anchor "for free," with no
// mirrored-offset math needed anywhere else (ResizeHandles below only ever
// adjusts widthPct/heightPct, never xPct/yPct). image-field.tsx's
// side-by-side layouts always pass 50/50 (fixed center); the free-floating
// background layout passes wherever the author last dragged it to.
export function imageBoxStyle(xPct: number, yPct: number, widthPct: number, heightPct: number): React.CSSProperties {
  return {
    position: "absolute",
    top: `${yPct}%`,
    left: `${xPct}%`,
    width: `${widthPct}%`,
    height: `${heightPct}%`,
    transform: "translate(-50%, -50%)",
  };
}

// Uploads through uploadCourseAsset (a Server Action, called imperatively —
// no <form> needed) directly to Django's existing /course-assets/ endpoint.
// `uploadFile` is shared by both the file-picker input and clipboard-paste
// — they differ only in where the File comes from.
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
export function useImageUpload(courseVersionId: string | undefined, onCommit: (value: string | null) => void) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Fires whenever this box (or a focused descendant — paste events bubble)
  // has focus and the user presses Ctrl/Cmd+V. Only handled when the
  // clipboard actually carries an image; anything else (e.g. copied text)
  // is left alone so it doesn't swallow a paste meant for some other field.
  function handlePaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (file) uploadFile(file);
  }

  return { uploading, error, inputRef, handleFileChange, handlePaste };
}

export type HandleDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// Position each handle relative to the image box's own edges/corners — the
// box itself is already centered via imageBoxStyle, so these never need to
// know anything about the container's size or position, only the box's.
// Exported so positionable-box.tsx can reuse this same visual layout for
// text boxes' resize handles — the eight dots sit in the same places
// either way, only the *math* a drag does with them differs (this file's
// ResizeHandles keeps the box's center fixed, matching the free-floating
// image's earlier confirmed behavior; positionable-box.tsx keeps the
// corner/edge *opposite* whichever handle is being dragged fixed instead,
// per the correction that center-anchoring was the wrong model for text
// boxes). Reusing the pure position/cursor data — not the drag math —
// avoids two independently-drifting copies of "where do the eight dots
// go" while keeping the two behaviors that actually needed to differ
// cleanly separate.
export const HANDLES: { dir: HandleDir; style: React.CSSProperties; cursor: string }[] = [
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
// middle fixed, so there's nothing else for this component to get right —
// true whether the center is a fixed 50/50 or wherever the author dragged
// it to.
export function ResizeHandles({
  containerRef,
  widthPct,
  heightPct,
  onLiveResize,
  onCommitResize,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
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

    // Measured once, at drag start — the container doesn't change size
    // mid-drag, only the image box inside it does, so this stays a valid
    // percentage basis for the whole drag.
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
      currentW = clampSizePct(w);
      currentH = clampSizePct(h);
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
          // pointer-events-auto: a no-op for image-field.tsx (whose control
          // box is already pointer-events-auto throughout), but required
          // for background-image-field.tsx, where the control frame these
          // handles sit inside is pointer-events-none so it doesn't block
          // clicks meant for the text underneath — without this, the
          // handles would inherit that "none" and stop being clickable.
          className="pointer-events-auto absolute z-20 h-2.5 w-2.5 rounded-sm border border-white bg-primary shadow-sm"
          style={{ ...style, cursor }}
        />
      ))}
    </>
  );
}

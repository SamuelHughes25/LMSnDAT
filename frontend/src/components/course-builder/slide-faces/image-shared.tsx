"use client";

import { useRef, useState } from "react";

import { uploadCourseAsset } from "@/app/actions/courses";
import { CANVAS_H, CANVAS_W } from "../slide-canvas";
import { snapEdge } from "./snap-guides";

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

// Computes a widthPct/heightPct pair that reproduces an image's own
// natural aspect ratio, scaled to fit entirely within a container of the
// given pixel dimensions without exceeding either axis — the same "fit
// without cropping" math CSS `object-fit: contain` does for an image
// inside an already-sized box, just applied to size the BOX itself.
// Used once, right when an image is uploaded/pasted, so a fresh image
// starts at its own natural shape instead of a stretched 100%x100%
// square (every image box here defaults to DEFAULT_SIZE_PCT on both axes
// until explicitly resized, and every <img> uses object-fit: fill, which
// stretches to whatever shape the box is — correct once a box has a
// deliberate shape, but wrong as the STARTING shape). Manual resizing via
// ResizeHandles can still distort the box afterward if the author drags
// it that way — that's an existing, separate, wanted feature (see this
// file's own HANDLES/ResizeHandles comment); this only fixes what a
// brand-new upload looks like before any resize has happened.
export function computeContainedSizePct(
  naturalWidth: number,
  naturalHeight: number,
  containerWidthPx: number,
  containerHeightPx: number,
): { widthPct: number; heightPct: number } {
  if (!naturalWidth || !naturalHeight || !containerWidthPx || !containerHeightPx) {
    return { widthPct: DEFAULT_SIZE_PCT, heightPct: DEFAULT_SIZE_PCT };
  }
  const containerRatio = containerWidthPx / containerHeightPx;
  const imageRatio = naturalWidth / naturalHeight;
  if (imageRatio > containerRatio) {
    // Relatively wider than the container: fill the width, shrink the height.
    return { widthPct: DEFAULT_SIZE_PCT, heightPct: clampSizePct((containerRatio / imageRatio) * DEFAULT_SIZE_PCT) };
  }
  // Relatively taller than (or equal to) the container: fill the height, shrink the width.
  return { widthPct: clampSizePct((imageRatio / containerRatio) * DEFAULT_SIZE_PCT), heightPct: DEFAULT_SIZE_PCT };
}

// Loads `url` just far enough to read its natural pixel dimensions —
// resolves null if the image fails to load (a corrupt file, or a
// network hiccup fetching the just-uploaded asset back) rather than
// rejecting, since callers treat "couldn't measure it" as "fall back to
// the default size," not a hard error worth surfacing to the author.
export function loadNaturalSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
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

// Eight PowerPoint/Keynote-style handles — corners scale both axes
// together, preserving whatever aspect ratio the box already had (so a
// photo dragged from a corner keeps its proportions instead of warping);
// edge midpoints still stretch one axis only, independent of the other,
// for whoever deliberately wants a distorted/cropped shape. Every handle
// only ever changes widthPct/heightPct; the box's centering (imageBoxStyle)
// is what keeps the middle fixed, so there's nothing else for this
// component to get right — true whether the center is a fixed 50/50 or
// wherever the author dragged it to.
export function ResizeHandles({
  containerRef,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onLiveResize,
  onCommitResize,
  onGuidesChange,
}: {
  containerRef: React.RefObject<HTMLElement | null>;
  // The box's fixed center point — needed (in addition to width/height) to
  // compute where its EDGES actually land on the canvas, which is what
  // snapping needs to check against the page's own milestone positions (see
  // snap-guides.ts).
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onLiveResize: (widthPct: number, heightPct: number) => void;
  onCommitResize: (widthPct: number, heightPct: number) => void;
  // Optional — only slide-canvas.tsx's own drag surfaces (background/extra
  // images, and the side-by-side image-left/right box) have a SnapGuideProvider
  // ancestor to report into; kept as a plain callback prop rather than this
  // component calling useSnapGuides() itself so a future non-canvas caller
  // (there isn't one today) wouldn't be forced to render inside that provider.
  onGuidesChange?: (guides: { vertical: number[]; horizontal: number[] }) => void;
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

    const isCorner = dir.length === 2;

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

      // Snap whichever edge this handle moves — straight edge handles only
      // (n/s/e/w). Corner handles keep their existing aspect-ratio-locked
      // uniform-scale behavior below completely unchanged: that branch
      // recomputes w/h together from a single scale factor derived from
      // startW/startH, which would just discard an edge snap applied here
      // first anyway, and reconciling "snap one edge, then preserve the
      // locked aspect ratio around it" is a meaningfully bigger problem than
      // this pass's scope. A straight-edge drag has no such conflict — it
      // only ever touches one axis, so snapping it is a plain, final answer.
      const vertical: number[] = [];
      const horizontal: number[] = [];
      if (!isCorner) {
        if (dir.includes("e")) {
          const snapped = snapEdge(xPct + w / 2, CANVAS_W);
          if (snapped.guide !== null) {
            w = (snapped.value - xPct) * 2;
            vertical.push(snapped.guide);
          }
        }
        if (dir.includes("w")) {
          const snapped = snapEdge(xPct - w / 2, CANVAS_W);
          if (snapped.guide !== null) {
            w = (xPct - snapped.value) * 2;
            vertical.push(snapped.guide);
          }
        }
        if (dir.includes("s")) {
          const snapped = snapEdge(yPct + h / 2, CANVAS_H);
          if (snapped.guide !== null) {
            h = (snapped.value - yPct) * 2;
            horizontal.push(snapped.guide);
          }
        }
        if (dir.includes("n")) {
          const snapped = snapEdge(yPct - h / 2, CANVAS_H);
          if (snapped.guide !== null) {
            h = (yPct - snapped.value) * 2;
            horizontal.push(snapped.guide);
          }
        }
        onGuidesChange?.({ vertical, horizontal });
      }

      if (isCorner) {
        // Uniform scale about the box's own current aspect ratio (not the
        // image's natural one — this stays correct even after a prior
        // distorting edge-handle resize) rather than growing width and
        // height independently: pick whichever axis moved further from its
        // own start, in relative terms, as the "driving" one and apply
        // that same scale factor to both, so a corner drag keeps the
        // box's shape instead of warping it. Edge handles above are
        // untouched — they still stretch a single axis on purpose.
        //
        // The scale itself — not w/h independently — is what gets clamped
        // to keep both axes inside [MIN_SIZE_PCT, MAX_SIZE_PCT]: clamping
        // each axis separately (as the non-corner path above does) would
        // let one axis hit its floor/ceiling first and distort the ratio
        // right at that boundary; a small drag near either limit could
        // even send the OTHER (still-far-from-any-limit) axis's raw value
        // negative before clamping, which independent per-axis clamping
        // would silently floor to MIN_SIZE_PCT instead of catching.
        const relW = (w - startW) / startW;
        const relH = (h - startH) / startH;
        const rawScale = 1 + (Math.abs(relW) > Math.abs(relH) ? relW : relH);
        const minScale = Math.max(MIN_SIZE_PCT / startW, MIN_SIZE_PCT / startH);
        const maxScale = Math.min(MAX_SIZE_PCT / startW, MAX_SIZE_PCT / startH);
        const scale = Math.min(maxScale, Math.max(minScale, rawScale));
        w = startW * scale;
        h = startH * scale;
      }

      currentW = clampSizePct(w);
      currentH = clampSizePct(h);
      onLiveResize(currentW, currentH);
    }

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      onGuidesChange?.({ vertical: [], horizontal: [] });
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

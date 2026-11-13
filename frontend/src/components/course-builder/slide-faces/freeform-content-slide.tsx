"use client";

import { useRef, useState } from "react";

import type { ExtraImage, FreeTextBox, ShapeKind, ShapeObject, SlideObjectRef } from "@/lib/course-types";
import { normalizeObjectOrder } from "@/lib/course-types";
import { useObjectPlacement } from "../object-placement-context";
import { usePaintBucket } from "../paint-bucket-context";
import { CANVAS_H, CANVAS_W } from "../slide-canvas";
import { useSlideSelection } from "../slide-selection-context";
import type { SlideFaceProps } from "./index";
import { BackgroundImageEditLayer, BackgroundImagePixels, SlideBackgroundLayer } from "./background-image-field";
import { EditableFreeTextBox } from "./free-text-box";
import { PositionableBox } from "./positionable-box";
import {
  DEFAULT_SHAPE_BORDER_COLOR,
  DEFAULT_SHAPE_BORDER_WIDTH,
  DEFAULT_SHAPE_FILL,
  ShapeEditLayer,
  ShapePixels,
} from "./shape-field";

// line/arrow have no fillable interior (their one color is the stroke);
// every other kind does — see ShapeObject's own comment in
// course-types.ts. Used both for this file's own default-style-on-create
// and to decide what the paint bucket actually recolors.
const STROKE_ONLY_KINDS: ReadonlySet<ShapeKind> = new Set(["line", "arrow"]);
const ICON_KIND_PREFIX = "icon-";

// The "layout unset" render path for a content slide — see
// content-slide-face.tsx's own top-of-file comment for the full legacy-vs-
// freeform split this is one half of. A genuinely blank canvas by default
// (brand-new content slides get `text_boxes: []` — app/actions/courses.ts),
// populated by the author adding text boxes (this file's own drag-to-create
// tool) or images (properties-panel.tsx's add-image control, at the bottom
// of the panel).
//
// Every text box AND extra_images entry renders here, in one single real
// DOM stack ordered by object_order (via normalizeObjectOrder — see its own
// comment in course-types.ts) — this used to be two separate, independently
// fixed-order layers (images always behind, via slide-canvas.tsx's own
// pre-Face SlideBackgroundLayer/ExtraImagesLayer), which meant reordering an
// image in slide-layers-panel.tsx had no visible effect on the canvas at
// all. Confirmed as a real, reported gap (an image's "layer" was purely
// cosmetic in the panel, never reflected on screen), fixed by having THIS
// component own every image's rendering instead — slide-canvas.tsx/
// slide-thumbnail.tsx/course-preview-viewer.tsx all skip their own
// SlideBackgroundLayer/ExtraImagesLayer call specifically for a freeform
// content slide now (see each file's own isFreeformContent check) to avoid
// double-rendering.
//
// The single background_image_url stays the one exception, still rendered
// first and never part of object_order — see SlideObjectRef's own comment
// in course-types.ts for why it stays a non-stackable backdrop rather than
// becoming a third object kind.
//
// In edit mode, an image's drag/resize controls portal into
// `imageOverlayRef` (threaded in via SlideFaceProps from slide-canvas.tsx)
// exactly the way the universal background image's controls already did —
// see background-image-field.tsx's own comment on why those can't render
// inline next to the clipped pixels. `containerRef` defaults to this
// component's own root (slideRef) when unset (static/present modes never
// pass one, and never need to — no dragging happens there).
const MIN_BOX_SIZE_PCT = 6;
const DEFAULT_BOX_WIDTH_PCT = 30;
const DEFAULT_BOX_HEIGHT_PCT = 15;
const CLICK_VS_DRAG_THRESHOLD_PX = 4;

type Rect = { xPct: number; yPct: number; widthPct: number; heightPct: number };

// A module-level function, not nested inside the component below —
// Date.now()/Math.random() are impure, and the linter's purity check
// flags an impure call anywhere a component's render body could reach it,
// even through a plain nested function only ever actually invoked from an
// event handler (createTextBox below is only ever called from onUp, a
// native pointerup listener, never during render) — it can't prove that
// boundary from a nested function alone. Pulling the id generation out to
// here, same convention properties-panel.tsx's own makeTextBoxId already
// uses, is what satisfies it.
function makeFreeTextBoxId(): string {
  return `text_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeShapeId(): string {
  return `shape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// A brand-new shape's starting style — geometric kinds get a visible
// fill and no border by default (adding a border is an explicit choice
// in shape-object-properties.tsx, same "null until chosen" convention as
// background_fill); line/arrow have no fill at all, so their stroke
// needs a real default color/width or they'd render as nothing.
function defaultShapeStyle(shapeKind: ShapeKind): Partial<ShapeObject> {
  if (STROKE_ONLY_KINDS.has(shapeKind)) {
    return { borderColor: DEFAULT_SHAPE_BORDER_COLOR, borderWidth: DEFAULT_SHAPE_BORDER_WIDTH };
  }
  if (shapeKind.startsWith(ICON_KIND_PREFIX)) {
    return { fillColor: DEFAULT_SHAPE_FILL };
  }
  return { fillColor: DEFAULT_SHAPE_FILL, borderColor: null, borderWidth: 0, cornerRadiusPct: 0 };
}

// A plain click (not a drag) needs its own sensible default box per
// shapeKind — DEFAULT_BOX_WIDTH_PCT/HEIGHT_PCT just below are tuned for
// TEXT, not shapes. Geometric shapes/icons get a modest square; line/
// arrow get a flatter, wider box so a plain click doesn't produce an
// ambiguous-looking 45°-diagonal square.
function defaultShapeSize(shapeKind: ShapeKind): { widthPct: number; heightPct: number } {
  if (STROKE_ONLY_KINDS.has(shapeKind)) return { widthPct: 30, heightPct: 4 };
  return { widthPct: 20, heightPct: 20 };
}

// What the paint bucket actually recolors on a shape — its fill for
// anything with an interior (geometric shapes and icon glyphs alike),
// its stroke (borderColor) for line/arrow, which have no fill at all.
function bucketPatchForShape(shapeKind: ShapeKind, color: string): Partial<ShapeObject> {
  if (STROKE_ONLY_KINDS.has(shapeKind)) return { borderColor: color };
  return { fillColor: color };
}

export function FreeformContentSlide({
  slide,
  mode,
  onConfigChange,
  containerRef: containerRefProp,
  imageOverlayRef,
}: SlideFaceProps) {
  const slideRef = useRef<HTMLDivElement>(null);
  const { select } = useSlideSelection();
  const { placement, cancelPlacing } = useObjectPlacement();
  const { armedColor } = usePaintBucket();
  const [previewRect, setPreviewRect] = useState<Rect | null>(null);
  // onUp (inside handlePointerDown below) is defined once per gesture and
  // never recreated as previewRect updates mid-drag, so its own closure
  // would otherwise only ever see the value previewRect held at drag-start
  // (null) — same stale-closure shape already documented/fixed elsewhere in
  // this app (course-builder.tsx's handleSlideConfigChange,
  // positionable-box.tsx's own drag handlers). Reading through this ref
  // instead gives onUp the true latest value.
  const previewRectRef = useRef<Rect | null>(null);

  const textBoxes = slide.config.text_boxes ?? [];
  const extraImages = slide.config.extra_images ?? [];
  const shapes = slide.config.shapes ?? [];
  const order = normalizeObjectOrder(slide.config);
  // A lookup, not a render order — see the big comment on the render below
  // for why object_order drives each object's zIndex STYLE only, never the
  // actual DOM/JSX iteration order those objects render in.
  const zIndexById = new Map(order.map((ref, index) => [`${ref.type}:${ref.id}`, index + 1]));

  function updateBox(id: string, patch: Partial<FreeTextBox>) {
    onConfigChange?.({ text_boxes: textBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  }

  function updateExtraImage(id: string, patch: Partial<ExtraImage>) {
    onConfigChange?.({ extra_images: extraImages.map((img) => (img.id === id ? { ...img, ...patch } : img)) });
  }

  function updateShape(id: string, patch: Partial<ShapeObject>) {
    onConfigChange?.({ shapes: shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  function createTextBox(rect: Rect) {
    const id = makeFreeTextBoxId();
    const box: FreeTextBox = { id, html: "", ...rect };
    const ref: SlideObjectRef = { type: "text", id };
    onConfigChange?.({ text_boxes: [...textBoxes, box], object_order: [...order, ref] });
    select(`${slide.id}:text:${id}`, false);
  }

  function createShape(rect: Rect, shapeKind: ShapeKind) {
    const id = makeShapeId();
    const shape: ShapeObject = { id, shapeKind, shadow: false, ...rect, ...defaultShapeStyle(shapeKind) };
    const ref: SlideObjectRef = { type: "shape", id };
    onConfigChange?.({ shapes: [...shapes, shape], object_order: [...order, ref] });
    select(`${slide.id}:shape:${id}`, false);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (mode !== "edit") return;
    // Only the empty canvas itself should start a placement drag (or take
    // a bucket click) — a click that landed on an existing box (its own
    // pointerdown already ran, and boxes sit above this layer) must never
    // also start drawing a new one, or recolor the background, underneath
    // it.
    if (e.target !== e.currentTarget) return;
    // Bucket takes priority over placement — both are armed via separate
    // toggle buttons in the Tools row, so nothing stops both being active
    // at once; a bucket click recoloring the background is the more
    // surprising of the two outcomes to accidentally suppress, so it wins.
    // Never disarms itself (see paint-bucket-context.tsx) — several
    // slides' backgrounds can be painted the same color in a row.
    if (armedColor) {
      e.preventDefault();
      onConfigChange?.({ background_fill: { kind: "color", color: armedColor } });
      return;
    }
    if (!placement) return;
    // Captured once, here — same reasoning as `start`/`slideEl` just below:
    // the nested onMove/onUp closures need a value TypeScript can still
    // see as non-null, and this also pins the gesture to whichever
    // placement was armed when it STARTED, immune to the (currently
    // impossible, since nothing else can change it mid-gesture, but cheap
    // to guard regardless) possibility of it changing underneath an
    // in-flight drag.
    const activePlacement = placement;
    e.preventDefault();
    const slideEl = slideRef.current;
    if (!slideEl) return;
    const pointerId = e.pointerId;
    // Pointer capture pins every subsequent event for this gesture to
    // slideEl specifically, rather than relying on normal hit-testing —
    // reported directly as "doesn't even allow dragging, creates a default
    // sized one instead" for a drag that visually, on the user's end,
    // looked completely normal. Hit-testing re-evaluates the target at
    // every single pointermove against whatever's currently in the DOM,
    // and this gesture inserts the dashed preview rect (see previewRect's
    // render below) as a new sibling the MOMENT it first appears — a
    // once-per-gesture change to the DOM mid-drag that a raw `document`
    // listener shouldn't care about (it fires regardless of hit-tested
    // target), but capture removes even the possibility, and is the
    // standard, more robust primitive for a drag gesture generally. Falls
    // back silently if unsupported (no browser this app targets lacks it,
    // but this must never be what throws if one somehow does).
    try {
      slideEl.setPointerCapture(pointerId);
    } catch {
      // no-op
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;

    function toPct(clientX: number, clientY: number) {
      const slideRectNow = slideEl!.getBoundingClientRect();
      const xPct = Math.min(100, Math.max(0, ((clientX - slideRectNow.left) / slideRectNow.width) * 100));
      const yPct = Math.min(100, Math.max(0, ((clientY - slideRectNow.top) / slideRectNow.height) * 100));
      return { xPct, yPct };
    }

    const start = toPct(startX, startY);

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return;
      // The click-vs-drag THRESHOLD (whether releasing now commits a
      // custom-sized box or falls back to a default-sized one) still
      // needs real travel, same as before — but the dashed preview box
      // itself now tracks the pointer from the very first pixel of
      // movement, not just once that threshold is crossed. Before this,
      // a drag that stayed under CLICK_VS_DRAG_THRESHOLD_PX for its first
      // few pixels rendered literally nothing at all until release —
      // indistinguishable, from the user's seat, from the drag just not
      // being recognized.
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) >= CLICK_VS_DRAG_THRESHOLD_PX) {
        moved = true;
      }
      const current = toPct(moveEvent.clientX, moveEvent.clientY);
      const rect: Rect = {
        xPct: Math.min(start.xPct, current.xPct),
        yPct: Math.min(start.yPct, current.yPct),
        widthPct: Math.max(MIN_BOX_SIZE_PCT, Math.abs(current.xPct - start.xPct)),
        heightPct: Math.max(MIN_BOX_SIZE_PCT, Math.abs(current.yPct - start.yPct)),
      };
      previewRectRef.current = rect;
      setPreviewRect(rect);
    }

    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      try {
        slideEl!.releasePointerCapture(pointerId);
      } catch {
        // no-op — already released (e.g. the pointer left the window)
      }
      if (moved && previewRectRef.current) {
        if (activePlacement.kind === "text") createTextBox(previewRectRef.current);
        else createShape(previewRectRef.current, activePlacement.shapeKind);
      } else {
        // A plain click, not a drag — a sensibly-sized default box anchored
        // at the click point, clamped so it never overflows the canvas.
        // DEFAULT_BOX_WIDTH_PCT/HEIGHT_PCT are tuned for text;
        // defaultShapeSize has its own per-shapeKind sizing.
        const { widthPct, heightPct } =
          activePlacement.kind === "text"
            ? { widthPct: DEFAULT_BOX_WIDTH_PCT, heightPct: DEFAULT_BOX_HEIGHT_PCT }
            : defaultShapeSize(activePlacement.shapeKind);
        const rect: Rect = {
          xPct: Math.min(start.xPct, 100 - widthPct),
          yPct: Math.min(start.yPct, 100 - heightPct),
          widthPct,
          heightPct,
        };
        if (activePlacement.kind === "text") createTextBox(rect);
        else createShape(rect, activePlacement.shapeKind);
      }
      previewRectRef.current = null;
      setPreviewRect(null);
      cancelPlacing();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  // Narrowed once, here, rather than re-checking `canEditImages` plus two
  // possibly-undefined refs at every call site below — null in any
  // non-edit mode (or if the caller somehow omitted the refs), so every
  // image render below can do one plain truthy check against this single
  // value instead of three.
  const editRefs =
    mode === "edit" && containerRefProp && imageOverlayRef
      ? { containerRef: containerRefProp, overlayRef: imageOverlayRef }
      : null;

  return (
    <div
      ref={slideRef}
      className="relative h-full w-full text-foreground"
      style={{ cursor: (placement || armedColor) && mode === "edit" ? "crosshair" : undefined }}
      onPointerDown={handlePointerDown}
    >
      {/* The universal background image — always first in paint order
          (behind everything else), never part of object_order. See
          SlideObjectRef's own comment for why it stays this one
          non-stackable exception. */}
      <SlideBackgroundLayer
        value={slide.config.background_image_url}
        mode={mode}
        slideId={slide.id}
        xPct={slide.config.background_image_x_pct}
        yPct={slide.config.background_image_y_pct}
        widthPct={slide.config.background_image_width_pct}
        heightPct={slide.config.background_image_height_pct}
        onTransform={
          editRefs
            ? ({ xPct, yPct, widthPct, heightPct }) =>
                onConfigChange?.({
                  background_image_x_pct: xPct,
                  background_image_y_pct: yPct,
                  background_image_width_pct: widthPct,
                  background_image_height_pct: heightPct,
                })
            : undefined
        }
        containerRef={editRefs?.containerRef}
        overlayRef={editRefs?.overlayRef}
      />

      {/* Every text box AND extra image, in one real DOM stack, VISUALLY
          stacked by object_order via the zIndex prop each one gets below —
          see this file's own top-of-file comment for why that's the fix
          for images' layer position never actually affecting the canvas.
          PositionableBox/BackgroundImagePixels each carry their OWN
          hardcoded z-index baseline for an unrelated reason (an
          untransformed-vs-dragged sibling conflict in the legacy system;
          never clipping an image's resize handles), and those two
          baselines disagree with each other (text boxes always above
          images, regardless of DOM order) — confirmed as the actual cause
          of a reported "layers panel reorder does nothing when an image is
          involved" bug: reordering two TEXT boxes worked (same baseline
          either way, so DOM order decided it), reordering an image past a
          text box never could. Looking each one's zIndex up from `order`
          (rather than literally rendering `order.map(...)`, which this
          used to do) makes stacking order equal to object_order position
          for every object on the slide, text and image alike — while
          keeping the actual DOM/render ITERATION ORDER fixed to each
          array's own stable order, never object_order's.

          That fixed order is deliberate, not incidental: a CSS position
          with z-index already fully determines visual stacking regardless
          of DOM sibling order, so object_order changing never NEEDED to
          reorder these elements in the DOM at all — and actually doing so
          (the old order.map(...) shape) had a real, confirmed side effect
          nothing about z-index would predict: reordering a box whose text
          editor had auto-scrolled (content taller than the box, cursor
          past the visible area) reset that scroll position back to the
          top. Moving an element to a new sibling position — even via
          React's own reconciliation, even though the component instance
          itself never remounts — is a real DOM mutation Chromium treats
          like a detach+reattach for scroll-offset purposes. Keeping
          render order pinned to `textBoxes`/`extraImages`' own array order
          (which object_order changes never touch) means a reorder is now
          a pure prop update for every box's existing DOM node — nothing
          ever needs to move — so there's nothing left to reset. */}
      {textBoxes.map((box) => {
        const zIndex = zIndexById.get(`text:${box.id}`) ?? 1;
        return (
          <PositionableBox
            key={`text:${box.id}`}
            fieldKey={`text:${box.id}`}
            slideId={slide.id}
            transform={box}
            onTransform={(t) => updateBox(box.id, t)}
            mode={mode}
            slideRef={slideRef}
            zIndex={zIndex}
          >
            <EditableFreeTextBox
              fieldId={`${slide.id}:text:${box.id}`}
              value={box.html}
              mode={mode}
              onCommit={(html) => updateBox(box.id, { html })}
            />
          </PositionableBox>
        );
      })}

      {extraImages.map((image) => {
        const zIndex = zIndexById.get(`image:${image.id}`) ?? 1;
        if (editRefs) {
          return (
            <BackgroundImageEditLayer
              key={`image:${image.id}`}
              value={image.url}
              selectionId={`${slide.id}:extra-image:${image.id}`}
              xPct={image.xPct}
              yPct={image.yPct}
              widthPct={image.widthPct}
              heightPct={image.heightPct}
              onTransform={(t) => updateExtraImage(image.id, t)}
              containerRef={editRefs.containerRef}
              overlayRef={editRefs.overlayRef}
              zIndex={zIndex}
            />
          );
        }
        return (
          <BackgroundImagePixels
            key={`image:${image.id}`}
            value={image.url}
            xPct={image.xPct}
            yPct={image.yPct}
            widthPct={image.widthPct}
            heightPct={image.heightPct}
            zIndex={zIndex}
          />
        );
      })}

      {shapes.map((shape) => {
        const zIndex = zIndexById.get(`shape:${shape.id}`) ?? 1;
        const pxW = (shape.widthPct / 100) * CANVAS_W;
        const pxH = (shape.heightPct / 100) * CANVAS_H;
        if (editRefs) {
          return (
            <ShapeEditLayer
              key={`shape:${shape.id}`}
              shape={shape}
              selectionId={`${slide.id}:shape:${shape.id}`}
              pxW={pxW}
              pxH={pxH}
              onTransform={(t) => updateShape(shape.id, t)}
              containerRef={editRefs.containerRef}
              overlayRef={editRefs.overlayRef}
              zIndex={zIndex}
              bucketArmedColor={armedColor}
              onBucketApply={(color) => updateShape(shape.id, bucketPatchForShape(shape.shapeKind, color))}
            />
          );
        }
        return <ShapePixels key={`shape:${shape.id}`} shape={shape} pxW={pxW} pxH={pxH} zIndex={zIndex} />;
      })}

      {previewRect && (
        <div
          className="pointer-events-none absolute z-20 rounded-sm border-2 border-dashed border-primary bg-primary/5"
          style={{
            left: `${previewRect.xPct}%`,
            top: `${previewRect.yPct}%`,
            width: `${previewRect.widthPct}%`,
            height: `${previewRect.heightPct}%`,
          }}
        />
      )}
    </div>
  );
}

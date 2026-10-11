"use client";

import { useRef, useState } from "react";

import type { ExtraImage, FreeTextBox, SlideObjectRef } from "@/lib/course-types";
import { normalizeObjectOrder } from "@/lib/course-types";
import { useSlideSelection } from "../slide-selection-context";
import { useTextBoxPlacement } from "../text-box-placement-context";
import type { SlideFaceProps } from "./index";
import { BackgroundImageEditLayer, BackgroundImagePixels, SlideBackgroundLayer } from "./background-image-field";
import { EditableFreeTextBox } from "./free-text-box";
import { PositionableBox } from "./positionable-box";

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

export function FreeformContentSlide({
  slide,
  mode,
  onConfigChange,
  containerRef: containerRefProp,
  imageOverlayRef,
}: SlideFaceProps) {
  const slideRef = useRef<HTMLDivElement>(null);
  const { select } = useSlideSelection();
  const { isPlacing, cancelPlacing } = useTextBoxPlacement();
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
  const order = normalizeObjectOrder(slide.config);

  function updateBox(id: string, patch: Partial<FreeTextBox>) {
    onConfigChange?.({ text_boxes: textBoxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  }

  function updateExtraImage(id: string, patch: Partial<ExtraImage>) {
    onConfigChange?.({ extra_images: extraImages.map((img) => (img.id === id ? { ...img, ...patch } : img)) });
  }

  function createTextBox(rect: Rect) {
    const id = makeFreeTextBoxId();
    const box: FreeTextBox = { id, html: "", ...rect };
    const ref: SlideObjectRef = { type: "text", id };
    onConfigChange?.({ text_boxes: [...textBoxes, box], object_order: [...order, ref] });
    select(`${slide.id}:text:${id}`);
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!isPlacing || mode !== "edit") return;
    // Only the empty canvas itself should start a placement drag — a click
    // that landed on an existing box (its own pointerdown already ran, and
    // boxes sit above this layer) must never also start drawing a new one
    // underneath it.
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const slideEl = slideRef.current;
    if (!slideEl) return;
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
      if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < CLICK_VS_DRAG_THRESHOLD_PX) {
        return;
      }
      moved = true;
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

    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (moved && previewRectRef.current) {
        createTextBox(previewRectRef.current);
      } else {
        // A plain click, not a drag — a sensibly-sized default box anchored
        // at the click point, clamped so it never overflows the canvas.
        createTextBox({
          xPct: Math.min(start.xPct, 100 - DEFAULT_BOX_WIDTH_PCT),
          yPct: Math.min(start.yPct, 100 - DEFAULT_BOX_HEIGHT_PCT),
          widthPct: DEFAULT_BOX_WIDTH_PCT,
          heightPct: DEFAULT_BOX_HEIGHT_PCT,
        });
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
      style={{ cursor: isPlacing && mode === "edit" ? "crosshair" : undefined }}
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

      {/* Every text box AND extra image, in one real DOM stack ordered by
          object_order — see this file's own top-of-file comment for why
          that's the fix for images' layer position never actually
          affecting the canvas. */}
      {order.map((ref) => {
        if (ref.type === "text") {
          const box = textBoxes.find((b) => b.id === ref.id);
          if (!box) return null;
          return (
            <PositionableBox
              key={`text:${box.id}`}
              fieldKey={`text:${box.id}`}
              slideId={slide.id}
              transform={box}
              onTransform={(t) => updateBox(box.id, t)}
              mode={mode}
              slideRef={slideRef}
            >
              <EditableFreeTextBox
                fieldId={`${slide.id}:text:${box.id}`}
                value={box.html}
                mode={mode}
                onCommit={(html) => updateBox(box.id, { html })}
              />
            </PositionableBox>
          );
        }

        const image = extraImages.find((i) => i.id === ref.id);
        if (!image) return null;
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
          />
        );
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

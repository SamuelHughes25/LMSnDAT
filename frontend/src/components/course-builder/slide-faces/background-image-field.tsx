"use client";

import type { ExtraImage } from "@/lib/course-types";
import { DraggableResizableFrame, StaticPositionedBox } from "./draggable-resizable-frame";
import { DEFAULT_POSITION_PCT, DEFAULT_SIZE_PCT } from "./image-shared";

// This slide's own background image never shares its selection id with any
// text box (those are namespaced `${slideId}:title` etc. — see
// positionable-box.tsx) — a plain fixed suffix is enough since there's only
// ever one background image per slide.
const BACKGROUND_IMAGE_SELECTION_SUFFIX = "background-image";

// The on-canvas half of the universal per-slide background image — the
// other half (upload/paste, replace, remove) lives in the properties
// panel's "Edit" section (slide-background-panel.tsx), not here. This
// component's only job is to render the image where it currently is
// (every mode) and, in edit mode, let the author drag it to a new position
// or resize it. There is deliberately no "add an image" affordance here at
// all: with no image set, this renders nothing, so the panel is the one
// and only place an image gets added — see the panel's own comment for why
// that split (rather than duplicating add/replace/remove here too).
//
// Rendered as a flat sibling of the slide's own content, not a wrapper
// around it — see slide-canvas.tsx/slide-thumbnail.tsx/
// course-preview-viewer.tsx, which mount this and the slide's Face
// side-by-side inside one shared positioned container. That's what lets
// the two layer correctly by z-index (pixels at z-0, the content at z-10,
// edit-mode drag/resize controls at z-20) without this component needing
// to know anything about what the slide's content looks like, and without
// any slide-type's face component needing to know a background image
// exists at all.
export function SlideBackgroundLayer({
  value,
  mode,
  slideId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
  overlayRef,
}: {
  value: string | null | undefined;
  mode: "edit" | "static" | "present";
  // Only needed alongside onTransform/containerRef/overlayRef below — see
  // their own comment for why static/present callers are spared this too.
  // Namespaces this image's shared-selection id (see
  // BACKGROUND_IMAGE_SELECTION_SUFFIX) so a stale selection from a
  // previously-viewed slide can never make a different slide's background
  // image render itself pre-selected.
  slideId?: string;
  xPct: number | undefined;
  yPct: number | undefined;
  widthPct: number | undefined;
  heightPct: number | undefined;
  // Optional: only "edit" mode (slide-canvas.tsx) ever needs these —
  // static/present callers (slide-thumbnail.tsx, course-preview-viewer.tsx)
  // render pixels only and never move/resize anything, so they're spared
  // from having to pass a no-op handler and a dummy ref just to satisfy
  // a type that doesn't apply to them.
  onTransform?: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef?: React.RefObject<HTMLElement | null>;
  // Where the edit controls (grip, resize handles, border, perimeter band)
  // get portaled to — see BackgroundImageEditLayer's comment on why they
  // can't just render inline next to the pixels like they used to.
  overlayRef?: React.RefObject<HTMLElement | null>;
}) {
  if (!value) return null;
  const x = xPct ?? DEFAULT_POSITION_PCT;
  const y = yPct ?? DEFAULT_POSITION_PCT;
  const w = widthPct ?? DEFAULT_SIZE_PCT;
  const h = heightPct ?? DEFAULT_SIZE_PCT;

  if (mode !== "edit" || !onTransform || !containerRef || !overlayRef || !slideId) {
    return <BackgroundImagePixels value={value} xPct={x} yPct={y} widthPct={w} heightPct={h} />;
  }
  return (
    <BackgroundImageEditLayer
      value={value}
      selectionId={`${slideId}:${BACKGROUND_IMAGE_SELECTION_SUFFIX}`}
      xPct={x}
      yPct={y}
      widthPct={w}
      heightPct={h}
      onTransform={onTransform}
      containerRef={containerRef}
      overlayRef={overlayRef}
    />
  );
}

// A slide's ADDITIONAL free-floating images (config.extra_images) beyond
// the one above — same rendering, same drag/resize behavior, just mapped
// over a list instead of a single value. A sibling export rather than a
// mode flag on SlideBackgroundLayer: that component's whole signature is
// built around exactly one image's flat props, and bolting a list onto it
// would mean every caller branching on "is this the single background or
// the list" internally — cleaner for each call site to invoke both
// layers side by side (see slide-canvas.tsx/slide-thumbnail.tsx/
// course-preview-viewer.tsx) than to merge them into one do-everything
// component.
export function ExtraImagesLayer({
  images,
  mode,
  slideId,
  onTransform,
  containerRef,
  overlayRef,
}: {
  images: ExtraImage[];
  mode: "edit" | "static" | "present";
  slideId?: string;
  // Which image changed is identified by its own `id`, not an index — see
  // ExtraImage's own comment in course-types.ts for why.
  onTransform?: (id: string, t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef?: React.RefObject<HTMLElement | null>;
  overlayRef?: React.RefObject<HTMLElement | null>;
}) {
  if (images.length === 0) return null;

  if (mode !== "edit" || !onTransform || !containerRef || !overlayRef || !slideId) {
    return (
      <>
        {images.map((image) => (
          <BackgroundImagePixels
            key={image.id}
            value={image.url}
            xPct={image.xPct}
            yPct={image.yPct}
            widthPct={image.widthPct}
            heightPct={image.heightPct}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {images.map((image) => (
        <BackgroundImageEditLayer
          key={image.id}
          value={image.url}
          selectionId={`${slideId}:extra-image:${image.id}`}
          xPct={image.xPct}
          yPct={image.yPct}
          widthPct={image.widthPct}
          heightPct={image.heightPct}
          onTransform={(t) => onTransform(image.id, t)}
          containerRef={containerRef}
          overlayRef={overlayRef}
        />
      ))}
    </>
  );
}

// Exported alongside BackgroundImageEditLayer below (both otherwise
// module-private) specifically for freeform-content-slide.tsx, which
// needs to render ONE image at a time, interleaved with text boxes per
// object_order — ExtraImagesLayer's own map-the-whole-list shape doesn't
// fit that; these two per-image primitives are what it's already built
// out of, so reusing them directly (rather than duplicating their
// contents) keeps both callers' rendering in exact lockstep.
export function BackgroundImagePixels({
  value,
  xPct,
  yPct,
  widthPct,
  heightPct,
  zIndex,
}: {
  value: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  // Explicit stacking order for a freeform content slide's object_order —
  // see freeform-content-slide.tsx's own comment for why a hardcoded z-0
  // here was the actual bug behind "reordering an image relative to a text
  // box in the Layers panel has no visible effect": every freeform text box
  // renders via PositionableBox, which always carries its own z-10 (or
  // z-30 once selected) regardless of DOM order, so a plain z-0 image could
  // never out-rank ANY text box no matter where object_order put it.
  // Undefined (every other caller — the single universal background image,
  // and any non-freeform slide type's extra_images) keeps the old z-0
  // default, which is still correct there: those callers have no
  // interleaved text boxes to out-rank in the first place.
  zIndex?: number;
}) {
  return (
    <StaticPositionedBox xPct={xPct} yPct={yPct} widthPct={widthPct} heightPct={heightPct} zIndex={zIndex} className="rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element -- see the note
          in image-field.tsx's ImageUploadField for why a plain <img> is
          used instead of next/image. */}
      <img src={value} alt="" className="h-full w-full object-fill" />
    </StaticPositionedBox>
  );
}

export function BackgroundImageEditLayer({
  value,
  selectionId,
  xPct,
  yPct,
  widthPct,
  heightPct,
  onTransform,
  containerRef,
  overlayRef,
  zIndex,
}: {
  value: string;
  // Identifies this specific image in the shared slide-selection-context —
  // the single background image and each extra image all pass their own
  // unique id here (see SlideBackgroundLayer/ExtraImagesLayer above), so
  // this component itself doesn't need to know or care which kind of
  // image it's rendering controls for.
  selectionId: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  overlayRef: React.RefObject<HTMLElement | null>;
  // Forwarded straight through to the pixels below — see
  // BackgroundImagePixels' own comment on this same prop.
  zIndex?: number;
}) {
  return (
    <DraggableResizableFrame
      selectionId={selectionId}
      xPct={xPct}
      yPct={yPct}
      widthPct={widthPct}
      heightPct={heightPct}
      onTransform={onTransform}
      containerRef={containerRef}
      overlayRef={overlayRef}
      moveAriaLabel="Move background image"
      renderContent={(effective) => (
        <BackgroundImagePixels
          value={value}
          xPct={effective.x}
          yPct={effective.y}
          widthPct={effective.w}
          heightPct={effective.h}
          zIndex={zIndex}
        />
      )}
    />
  );
}

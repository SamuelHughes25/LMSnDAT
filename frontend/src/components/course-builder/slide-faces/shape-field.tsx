"use client";

import { ArrowRight, Check, Star, TriangleAlert } from "lucide-react";

import type { ShapeObject } from "@/lib/course-types";
import { DraggableResizableFrame, StaticPositionedBox } from "./draggable-resizable-frame";

// A drawn basic shape (rectangle/ellipse/triangle/line/arrow) or a small
// fixed icon glyph, rendered and dragged/resized via the exact same
// primitives background-image-field.tsx's images use — see
// draggable-resizable-frame.tsx's own top-of-file comment for why that
// extraction happened. The shape analog of BackgroundImagePixels/
// BackgroundImageEditLayer.

export const DEFAULT_SHAPE_FILL = "#2563eb";
export const DEFAULT_SHAPE_BORDER_COLOR = "#1e3a8a";
export const DEFAULT_SHAPE_BORDER_WIDTH = 2;

// ResizeHandles' own default floor (image-shared.tsx's MIN_SIZE_PCT, 20)
// is tuned for images, which default to 100% size — reusing it here meant
// a line/arrow (default heightPct 4) or any shape shrunk smaller than 20%
// instantly snapped UP to 20% the moment a resize began, with no way back
// down: reported directly as "resizing a little jumps to a large fixed
// minimum size." Shapes/icons get their own, much smaller floor instead.
const SHAPE_MIN_SIZE_PCT = 2;

const ICON_COMPONENTS = {
  "icon-check": Check,
  "icon-star": Star,
  "icon-arrow-right": ArrowRight,
  "icon-warning-triangle": TriangleAlert,
} as const;

// One fixed drop-shadow preset, on/off — a configurable blur/offset/
// opacity editor is more than what was actually asked for ("drop shadow
// styling").
const SHADOW_FILTER = "drop-shadow(0 4px 6px rgba(0,0,0,0.35))";

// pxW/pxH (the box's actual on-screen size, from the fixed CANVAS_W/
// CANVAS_H — see shape-field.tsx's callers) size the icon glyphs, which
// render as a centered flex child rather than stretching to fill a
// percentage viewBox the way the geometric shapes below do. Every
// geometric shape uses one shared 0-100 viewBox with
// preserveAspectRatio="none" so it stretches exactly to the box's own
// (possibly non-square) widthPct/heightPct, same as every other
// percentage-of-container box in this app — `vector-effect:
// non-scaling-stroke` on every stroke is what keeps border/stroke
// thickness a true, undistorted screen-pixel width despite that
// non-uniform scaling (plain `strokeWidth` alone would otherwise be
// interpreted in the viewBox's own 0-100 units and stretch unevenly on
// a non-square box, same as the fill shape itself does — accepted for
// the shape's own outline, but a stroke reads as visibly "wrong" when
// its thickness visibly differs on two adjacent edges).
export function renderShapeSvg(shape: ShapeObject, pxW: number, pxH: number): React.ReactNode {
  const fill = shape.fillColor ?? "none";
  const hasBorder = !!shape.borderColor && (shape.borderWidth ?? 0) > 0;
  const borderProps = hasBorder
    ? { stroke: shape.borderColor as string, strokeWidth: shape.borderWidth, vectorEffect: "non-scaling-stroke" as const }
    : {};
  const style: React.CSSProperties = shape.shadow ? { filter: SHADOW_FILTER } : {};

  switch (shape.shapeKind) {
    case "rectangle": {
      const r = shape.cornerRadiusPct ?? 0;
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" style={style}>
          <rect x={1} y={1} width={98} height={98} rx={r} ry={r} fill={fill} {...borderProps} />
        </svg>
      );
    }
    case "ellipse":
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" style={style}>
          <ellipse cx={50} cy={50} rx={48} ry={48} fill={fill} {...borderProps} />
        </svg>
      );
    case "triangle":
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" style={style}>
          <polygon points="50,2 98,98 2,98" fill={fill} {...borderProps} />
        </svg>
      );
    case "line": {
      const strokeColor = shape.borderColor ?? "#000000";
      const strokeWidth = shape.borderWidth ?? DEFAULT_SHAPE_BORDER_WIDTH;
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" style={style}>
          <line
            x1={2}
            y1={98}
            x2={98}
            y2={2}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      );
    }
    case "arrow": {
      // Same diagonal as "line" above, plus a fixed arrowhead polygon
      // hand-placed at the endpoint, oriented along that same diagonal —
      // not an SVG <marker> (markers scale awkwardly inside a non-uniform
      // percentage viewBox, per this file's own top comment on why
      // preserveAspectRatio="none" is used at all here).
      const strokeColor = shape.borderColor ?? "#000000";
      const strokeWidth = shape.borderWidth ?? DEFAULT_SHAPE_BORDER_WIDTH;
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" style={style}>
          <line
            x1={2}
            y1={98}
            x2={90}
            y2={10}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <polygon points="90,10 87.2,18.5 81.5,12.8" fill={strokeColor} />
        </svg>
      );
    }
    case "icon-check":
    case "icon-star":
    case "icon-arrow-right":
    case "icon-warning-triangle": {
      const IconComponent = ICON_COMPONENTS[shape.shapeKind];
      const size = Math.max(8, Math.min(pxW, pxH));
      return (
        <div className="flex h-full w-full items-center justify-center" style={style}>
          <IconComponent size={size} color={shape.fillColor ?? "#000000"} strokeWidth={2} />
        </div>
      );
    }
  }
}

// The non-interactive half — static/present-mode rendering for a shape,
// same role as BackgroundImagePixels. overflowHidden is OFF here (unlike
// images, which crop to their own box on purpose): a shape's own drop
// shadow paints just outside its box by design, and overflow-hidden would
// clip it right back off.
export function ShapePixels({
  shape,
  pxW,
  pxH,
  zIndex,
}: {
  shape: ShapeObject;
  pxW: number;
  pxH: number;
  zIndex?: number;
}) {
  return (
    <StaticPositionedBox
      xPct={shape.xPct}
      yPct={shape.yPct}
      widthPct={shape.widthPct}
      heightPct={shape.heightPct}
      zIndex={zIndex}
      overflowHidden={false}
    >
      {renderShapeSvg(shape, pxW, pxH)}
    </StaticPositionedBox>
  );
}

// The interactive half — drag/resize/select, built on the same
// DraggableResizableFrame every image already uses.
export function ShapeEditLayer({
  shape,
  selectionId,
  pxW,
  pxH,
  onTransform,
  containerRef,
  overlayRef,
  zIndex,
  // Paint-bucket integration: when set (the bucket tool is armed), a
  // click on this shape's move band applies `bucketArmedColor` instead
  // of selecting/dragging — see draggable-resizable-frame.tsx's
  // onBandPointerDownIntercept for the extension point this uses, and
  // freeform-content-slide.tsx for where these two props actually come
  // from (paint-bucket-context.tsx). ShapeEditLayer is the only place
  // that knows buckets exist for shapes; DraggableResizableFrame itself
  // never does.
  bucketArmedColor,
  onBucketApply,
}: {
  shape: ShapeObject;
  selectionId: string;
  pxW: number;
  pxH: number;
  onTransform: (t: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  overlayRef: React.RefObject<HTMLElement | null>;
  zIndex?: number;
  bucketArmedColor?: string | null;
  onBucketApply?: (color: string) => void;
}) {
  return (
    <DraggableResizableFrame
      selectionId={selectionId}
      xPct={shape.xPct}
      yPct={shape.yPct}
      widthPct={shape.widthPct}
      heightPct={shape.heightPct}
      onTransform={onTransform}
      containerRef={containerRef}
      overlayRef={overlayRef}
      moveAriaLabel="Move shape"
      minSizePct={SHAPE_MIN_SIZE_PCT}
      onBandPointerDownIntercept={
        bucketArmedColor
          ? () => {
              onBucketApply?.(bucketArmedColor);
              return true;
            }
          : undefined
      }
      renderContent={(effective) => (
        <ShapePixels
          shape={{ ...shape, xPct: effective.x, yPct: effective.y, widthPct: effective.w, heightPct: effective.h }}
          pxW={pxW}
          pxH={pxH}
          zIndex={zIndex}
        />
      )}
    />
  );
}

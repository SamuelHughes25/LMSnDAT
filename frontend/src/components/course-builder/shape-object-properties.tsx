"use client";

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ShapeKind, ShapeObject, Slide, SlideConfig } from "@/lib/course-types";
import { useActiveEditorContext } from "./active-editor-context";
import { ColorPicker } from "./color-picker";
import { ObjectPositionFields } from "./object-position-fields";
import { useSlideSelection } from "./slide-selection-context";

// Which style controls apply to a given shapeKind — rect/ellipse/triangle
// have a fillable interior AND an optional border; line/arrow have no
// interior at all (their one color IS the stroke, shown as "Color" rather
// than "Border"); the icon-* kinds are a fixed glyph with only a color,
// no border/corner-radius concept. Corner radius is rectangle-only on top
// of that. See ShapeObject's own comment in course-types.ts for why
// borderColor/borderWidth double as line/arrow's stroke fields rather than
// this component needing a second pair of props for the same two values.
const GEOMETRIC_KINDS: ReadonlySet<ShapeKind> = new Set(["rectangle", "ellipse", "triangle"]);
const LINE_KINDS: ReadonlySet<ShapeKind> = new Set(["line", "arrow"]);

// Shown in the properties panel whenever a shape/icon object is selected
// — the shape analog of image-object-properties.tsx/
// free-text-box-properties.tsx. Position/size reuses ObjectPositionFields
// exactly as images do (shapes share ExtraImage's center-anchored
// BoxTransform convention, not a text box's top-left one).
export function ShapeObjectProperties({
  slide,
  shapeId,
  onConfigChange,
}: {
  slide: Slide;
  shapeId: string;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  const { deselect } = useSlideSelection();
  const { panelInteractingRef } = useActiveEditorContext();
  const shapes = slide.config.shapes ?? [];
  const shape = shapes.find((s) => s.id === shapeId);
  if (!shape) return null;

  function update(patch: Partial<ShapeObject>) {
    onConfigChange({ shapes: shapes.map((s) => (s.id === shapeId ? { ...s, ...patch } : s)) });
  }

  function handleDelete() {
    deselect(`${slide.id}:shape:${shapeId}`);
    // Same "prune object_order too, not just the array" fix as every
    // other object type's own delete (slide-layers-panel.tsx's deleteRef,
    // image-object-properties.tsx's onRemove) — normalizeObjectOrder
    // self-heals a dangling ref either way, but getting it right here
    // means the persisted object_order never goes stale in the first
        // place.
    const nextOrder = (slide.config.object_order ?? []).filter((ref) => !(ref.type === "shape" && ref.id === shapeId));
    onConfigChange({ shapes: shapes.filter((s) => s.id !== shapeId), object_order: nextOrder });
  }

  const isGeometric = GEOMETRIC_KINDS.has(shape.shapeKind);
  const isLine = LINE_KINDS.has(shape.shapeKind);
  const isIcon = !isGeometric && !isLine;

  const swatchTriggerClassName = "h-7 w-7 shrink-0 rounded-md border border-input p-0";
  const renderSwatch = (current: string | null) => (
    <span className="block h-full w-full rounded-md" style={{ backgroundColor: current ?? "transparent" }} />
  );

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {isIcon ? "Icon" : "Shape"}
        </div>
        <Button type="button" variant="outline" size="icon-sm" onClick={handleDelete} aria-label="Delete">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-muted-foreground/70">Style</div>

        {(isGeometric || isIcon) && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">{isIcon ? "Icon color" : "Fill"}</span>
            <ColorPicker
              value={shape.fillColor ?? null}
              onChange={(color) => update({ fillColor: color })}
              allowNone={isGeometric}
              noneLabel="No fill"
              panelInteractingRef={panelInteractingRef}
              ariaLabel={isIcon ? "Icon color" : "Fill color"}
              triggerClassName={swatchTriggerClassName}
              renderTrigger={renderSwatch}
            />
          </div>
        )}

        {(isGeometric || isLine) && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">{isLine ? "Color" : "Border"}</span>
              <ColorPicker
                value={shape.borderColor ?? null}
                onChange={(color) => update({ borderColor: color })}
                allowNone={isGeometric}
                noneLabel="No border"
                panelInteractingRef={panelInteractingRef}
                ariaLabel={isLine ? "Line color" : "Border color"}
                triggerClassName={swatchTriggerClassName}
                renderTrigger={renderSwatch}
              />
            </div>
            <label className="flex items-center justify-between gap-2 text-sm">
              {isLine ? "Thickness" : "Border width"}
              <input
                type="number"
                min={0}
                max={20}
                value={shape.borderWidth ?? 0}
                onChange={(e) => update({ borderWidth: Number(e.target.value) })}
                className="h-7 w-16 rounded-md border border-input px-2 text-right text-sm"
              />
            </label>
          </>
        )}

        {shape.shapeKind === "rectangle" && (
          <label className="flex items-center justify-between gap-2 text-sm">
            Corner radius
            <input
              type="range"
              min={0}
              max={50}
              value={shape.cornerRadiusPct ?? 0}
              onChange={(e) => update({ cornerRadiusPct: Number(e.target.value) })}
              className="w-24"
            />
          </label>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={!!shape.shadow}
            onChange={(e) => update({ shadow: e.target.checked })}
            className="h-4 w-4 rounded border-input"
          />
          Drop shadow
        </label>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-muted-foreground/70">Position &amp; size</div>
        <ObjectPositionFields
          xLabel="Center X"
          yLabel="Center Y"
          xPct={shape.xPct}
          yPct={shape.yPct}
          widthPct={shape.widthPct}
          heightPct={shape.heightPct}
          onChange={(next) => update(next)}
        />
      </div>
    </div>
  );
}

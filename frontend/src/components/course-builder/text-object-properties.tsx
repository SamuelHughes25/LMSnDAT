"use client";

import type { BoxTransform, PositionableField, Slide, SlideConfig } from "@/lib/course-types";
import { useActiveEditorContext, useForceRerenderOnEditorTransaction } from "./active-editor-context";
import { ObjectPositionFields } from "./object-position-fields";
import { TextFormattingControls } from "./text-formatting-controls";

const FIELD_LABELS: Record<PositionableField, string> = {
  title: "Title",
  subtitle: "Subtitle",
  body: "Body text",
  body2: "Body text",
};

// Shown in the properties panel whenever a LEGACY text box (title/subtitle/
// body/body2 — a slide with `config.layout` set, see content-slide-face
// .tsx's own comment on the legacy-vs-freeform split) is selected. For the
// new freeform system's text boxes, see free-text-box-properties.tsx's
// FreeTextBoxProperties — same shape, same shared TextFormattingControls,
// just addressing a `text_boxes[]` entry by id instead of a fixed field
// name. Two independent sections: position/size (always available, driven
// by config.box_transforms — the same field the canvas's own drag handles
// write) and text formatting (only available once this box's TipTap editor
// is actually focused — see the isEditorLive check below).
export function TextObjectProperties({
  slide,
  field,
  onConfigChange,
}: {
  slide: Slide;
  field: PositionableField;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  const fieldId = `${slide.id}:${field}`;
  const { activeEditor, activeEditorId, panelInteractingRef } = useActiveEditorContext();
  // Only trust `activeEditor` for formatting commands when it's confirmed to
  // be THIS box's own editor — a box can be selected (drag its move band)
  // without its editor ever taking focus, in which case activeEditor may be
  // null or may still belong to some other box entirely. See
  // active-editor-context.tsx's activeEditorId for the full reasoning.
  const editor = activeEditorId === fieldId ? activeEditor : null;
  useForceRerenderOnEditorTransaction(editor);

  const transform = slide.config.box_transforms?.[field];

  function updateTransform(next: BoxTransform) {
    onConfigChange({ box_transforms: { ...slide.config.box_transforms, [field]: next } });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {FIELD_LABELS[field]}
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-muted-foreground/70">Position &amp; size</div>
        {transform ? (
          <ObjectPositionFields
            xPct={transform.xPct}
            yPct={transform.yPct}
            widthPct={transform.widthPct}
            heightPct={transform.heightPct}
            onChange={updateTransform}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Drag this box once on the canvas to enable precise position/size editing.
          </p>
        )}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <div className="text-[11px] font-medium text-muted-foreground/70">Text</div>
        {editor ? (
          <TextFormattingControls editor={editor} panelInteractingRef={panelInteractingRef} />
        ) : (
          <p className="text-xs text-muted-foreground">Click into the text to format it.</p>
        )}
      </div>
    </div>
  );
}

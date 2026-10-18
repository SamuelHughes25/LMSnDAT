"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BoxTransform, FreeTextBox, Slide, SlideConfig, SlideObjectRef } from "@/lib/course-types";
import { useActiveEditorContext, useForceRerenderOnEditorTransaction } from "./active-editor-context";
import { ObjectPositionFields } from "./object-position-fields";
import { useSlideSelection } from "./slide-selection-context";
import { TextFormattingControls } from "./text-formatting-controls";

// The freeform-system twin of text-object-properties.tsx's
// TextObjectProperties — same shape (position/size always available, text
// formatting once this box's own editor is focused, both via the exact same
// shared TextFormattingControls), just addressing one `text_boxes[]` entry
// by its own stable id instead of a fixed field name. Shown whenever a
// `{slideId}:text:{boxId}` selection resolves (see course-builder.tsx's
// parseSelectedObject).
export function FreeTextBoxProperties({
  slide,
  boxId,
  onConfigChange,
}: {
  slide: Slide;
  boxId: string;
  onConfigChange: (config: Partial<SlideConfig>) => void;
}) {
  const fieldId = `${slide.id}:text:${boxId}`;
  const { activeEditor, activeEditorId, panelInteractingRef } = useActiveEditorContext();
  const editor = activeEditorId === fieldId ? activeEditor : null;
  const { deselect } = useSlideSelection();
  useForceRerenderOnEditorTransaction(editor);

  const textBoxes = slide.config.text_boxes ?? [];
  const index = textBoxes.findIndex((b) => b.id === boxId);
  const box = index >= 0 ? textBoxes[index] : null;
  if (!box) return null;

  function updateBox(patch: Partial<FreeTextBox>) {
    const next = textBoxes.map((b) => (b.id === boxId ? { ...b, ...patch } : b));
    onConfigChange({ text_boxes: next });
  }

  function updateTransform(next: BoxTransform) {
    updateBox(next);
  }

  function handleDelete() {
    // Same fix as slide-layers-panel.tsx's own deleteRef — this panel is
    // only ever showing because fieldId IS currently selected, so without
    // this the panel would go blank (the `if (!box) return null` guard
    // above) rather than falling back to the normal slide view.
    deselect(fieldId);
    const nextBoxes = textBoxes.filter((b) => b.id !== boxId);
    const nextOrder = (slide.config.object_order ?? []).filter(
      (ref: SlideObjectRef) => !(ref.type === "text" && ref.id === boxId),
    );
    onConfigChange({ text_boxes: nextBoxes, object_order: nextOrder });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {box.name || `Text ${index + 1}`}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDelete}
          aria-label="Delete text box"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-medium text-muted-foreground/70">Position &amp; size</div>
        <ObjectPositionFields
          xPct={box.xPct}
          yPct={box.yPct}
          widthPct={box.widthPct}
          heightPct={box.heightPct}
          onChange={updateTransform}
        />
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

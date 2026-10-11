"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";

import { FontFamily } from "@/lib/tiptap-font-family";
import { FontSize } from "@/lib/tiptap-font-size";
import { TextAlign } from "@/lib/tiptap-text-align";
import { Color } from "@/lib/tiptap-text-color";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import { BODY_TYPOGRAPHY, CHANGE_DEBOUNCE_MS, FIELD_CLASSES, FILL_BOX, StaticField } from "./content-slide-face";
import type { SlideFaceProps } from "./index";

// The generic, un-specialized text box every freeform content slide uses
// (see content-slide-face.tsx's own top-of-file comment on the legacy-vs-
// freeform split) — genuinely the same capability as the legacy body field
// (same extensions, same BODY_TYPOGRAPHY, same debounced-commit shape), just
// addressing a text_boxes[] entry by its own id instead of a fixed field
// name, and deliberately WITHOUT any of RichTextTitle's single-line/forced-
// bold special-casing. That lack of special-casing is the actual fix for
// the two bugs reported against the legacy title field (bold doing nothing,
// bullet lists breaking its width) — not a patch applied to the title field
// itself, which stays exactly as it was so no existing course content
// regresses (see course-types.ts's SlideConfig.layout comment for why).
export function EditableFreeTextBox({
  fieldId,
  value,
  mode,
  onCommit,
}: {
  fieldId: string;
  value: string;
  mode: SlideFaceProps["mode"];
  onCommit: (value: string) => void;
}) {
  if (mode === "edit") {
    return <RichTextFreeTextBox fieldId={fieldId} value={value} onCommit={onCommit} />;
  }
  return <StaticField value={value} placeholder="" className={cn(BODY_TYPOGRAPHY, FILL_BOX)} />;
}

// Same ProseMirror-owns-its-DOM shape as RichTextBody in content-slide-face
// .tsx (see that component's own comment for why — no parallel "React
// thinks X, DOM has Y" state to fight over). Normal Enter behavior (no
// handleKeyDown override), no forced font-weight class — a brand new box
// starts at plain body-equivalent weight/size, exactly like typing into the
// legacy body field always has; an author who wants it to look like a
// title types it, selects it, and applies Bold/a larger Size from the
// panel, same as they would to make any other text bold — there is no
// separate "is this a title" concept anywhere in this component.
function RichTextFreeTextBox({
  fieldId,
  value,
  onCommit,
}: {
  fieldId: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const { focusEditor, blurEditor, panelRef, panelInteractingRef } = useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);

  const editor = useEditor({
    immediatelyRender: false,
    editable: true,
    content: value ?? "",
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: false,
      }),
      TextStyle,
      FontSize,
      FontFamily,
      TextAlign,
      Color,
      Placeholder.configure({ placeholder: "Click to add text" }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          FIELD_CLASSES,
          BODY_TYPOGRAPHY,
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      debouncedCommit(editor.getHTML());
    },
    onFocus: ({ editor }) => {
      focusEditor(fieldId, editor);
    },
    // Same two-part blur guard as RichTextBody — see that component's own
    // comment in content-slide-face.tsx for the full reasoning (a plain
    // panel button vs. a portal-rendered Select listbox item need different
    // detection strategies).
    onBlur: ({ editor, event }) => {
      const panelEl = panelRef.current;
      const nextFocus = event.relatedTarget;
      const focusMovedIntoPanel = !!(panelEl && nextFocus instanceof Node && panelEl.contains(nextFocus));
      if (focusMovedIntoPanel || panelInteractingRef.current) {
        return;
      }
      blurEditor(fieldId, editor);
    },
  });

  return <EditorContent editor={editor} className={FILL_BOX} />;
}

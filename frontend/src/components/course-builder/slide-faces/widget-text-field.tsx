"use client";

import { useRef } from "react";
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
import { CHANGE_DEBOUNCE_MS, FIELD_CLASSES, preserveBlankLinesInPastedText } from "./content-slide-face";

// The visible box chrome components/ui/input.tsx's <Input> and a plain
// <textarea> both had before conversion — WidgetEditableText itself stays
// bare (FIELD_CLASSES is border-none/bg-transparent, matching every other
// TipTap field in this app), so any field that visually needs to look like
// a bordered input box wraps it in a div with this class instead of each
// widget hand-rolling the same border/padding/focus-ring chrome six times.
export const WIDGET_INPUT_CHROME =
  "w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50";

// A short rich-text field for interactive/assessment widgets (multiple
// choice questions/options, accordion titles/bodies, flashcard faces,
// match-pairs instructions/keywords/definitions, sequencing instructions/
// steps, hotspot labels/descriptions) — these previously used plain
// <input>/<textarea> elements with zero formatting capability, reported
// directly as a gap: an author couldn't bold a key term in a question or
// italicize part of an option the same way they could everywhere else on a
// slide. Deliberately the SAME TipTap extension set as RichTextFreeTextBox
// (free-text-box.tsx) — no special-casing, nothing suppressed beyond what
// that component already excludes (headings/blockquotes/code/links, never
// meaningful in a short widget field) — matches "edit everything I
// normally would apart from size" (Size is excluded in the PANEL via
// TextFormattingControls' hideSize prop, not here; this component has no
// opinion on which controls the panel shows for it).
//
// NOT used for missing-word-slide-face.tsx's blank-marked body text (blanks
// are selected by character OFFSET into plain text — rich-text HTML would
// shift every offset the instant any mark was applied) or table-field.tsx's
// cells (a plain data table, not a scored/interactive widget in this
// sense) — both stay plain text deliberately, not an oversight.
export function WidgetEditableText({
  fieldId,
  value,
  placeholder,
  className,
  onCommit,
  autoFocus,
}: {
  // Must be globally unique and start with `${slide.id}:` — properties-
  // panel.tsx's widget-text branch (see WIDGET_TEXT_SLIDE_TYPES) detects
  // "some field on THIS slide is focused" by checking activeEditorId
  // against that prefix, the same convention text-object-properties.tsx/
  // free-text-box-properties.tsx already use for their own field ids.
  fieldId: string;
  value: string;
  placeholder: string;
  className?: string;
  onCommit: (value: string) => void;
  // hotspot-image-slide-face.tsx's label field is the one widget field that
  // needs this — a freshly-placed hotspot pops open its edit panel with the
  // label pre-focused, same UX its old plain <Input autoFocus> had. TipTap's
  // own `autofocus` editor option (not a DOM attribute) is what actually
  // moves the cursor there on mount.
  autoFocus?: boolean;
}) {
  const { focusEditor, blurEditor, panelRef, panelInteractingRef, lastFontFamilyRef } = useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);
  // Guards the remembered-font application to exactly once per field — see
  // free-text-box.tsx's RichTextFreeTextBox for the full reasoning (same
  // onFocus-not-onCreate mechanism, copied verbatim here).
  const appliedRememberedFontRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    // @tiptap/react v3 defaults this to false — see content-slide-face.tsx's
    // own comment on this same option for the full reasoning (a selection-
    // only change otherwise never re-renders TextFormattingControls, so its
    // Font/Size/Color readouts go stale until something else forces a
    // re-render).
    shouldRerenderOnTransaction: true,
    editable: true,
    content: value ?? "",
    autofocus: autoFocus ? "end" : false,
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
      Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? placeholder : "") }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          FIELD_CLASSES,
          className,
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
      transformPastedText: (text) => preserveBlankLinesInPastedText(text),
    },
    onUpdate: ({ editor }) => {
      debouncedCommit(editor.getHTML());
    },
    onFocus: ({ editor }) => {
      focusEditor(fieldId, editor);
      if (!appliedRememberedFontRef.current && editor.isEmpty && lastFontFamilyRef.current) {
        appliedRememberedFontRef.current = true;
        editor.chain().setFontFamily(lastFontFamilyRef.current).run();
      }
    },
    // Deliberately does NOT also check panelPointerDownRef, unlike content-
    // slide-face.tsx/free-text-box.tsx's identical-looking guard — that ref
    // exists to protect a plain, unpaired <label> click (ObjectPositionFields'
    // X/Y/Width/Height fields) from wrongly deselecting mid-interaction, by
    // treating ANY pointerdown anywhere in the whole side panel as "an
    // interaction is underway, don't blur." This panel never shows that
    // control: every control TextFormattingControls renders (Bold/Italic/
    // etc., the Font/Color dropdown triggers) already preventDefault()s its
    // own mousedown and sets panelInteractingRef itself, which is real,
    // targeted protection — panelPointerDownRef adds nothing for this field
    // beyond falsely treating truly blank, non-interactive panel background
    // (the "SLIDE / Multiple Choice" header, empty padding, the image
    // drop-zone's dead space) as a reason to never blur. Confirmed as a real
    // bug: focusing a widget field then clicking ANYWHERE in the panel that
    // wasn't itself another text field left TextFormattingControls stuck
    // showing the no-longer-focused field's state indefinitely — clicking
    // the canvas afterward didn't fix it either, since nothing ever re-fires
    // the blur that was swallowed here the first time.
    onBlur: ({ editor, event }) => {
      // Unconditional, and first — see use-debounced-callback.ts's own
      // comment for why a pending debounced commit must flush on every
      // blur, not just the ones that go on to call blurEditor below.
      debouncedCommit.flush();
      const panelEl = panelRef.current;
      const nextFocus = event.relatedTarget;
      const focusMovedIntoPanel = !!(panelEl && nextFocus instanceof Node && panelEl.contains(nextFocus));
      if (focusMovedIntoPanel || panelInteractingRef.current) {
        return;
      }
      blurEditor(fieldId, editor);
    },
  });

  return <EditorContent editor={editor} />;
}

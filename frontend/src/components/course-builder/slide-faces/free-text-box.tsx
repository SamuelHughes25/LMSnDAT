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
import {
  BODY_TYPOGRAPHY,
  CHANGE_DEBOUNCE_MS,
  FIELD_CLASSES,
  FILL_BOX,
  StaticField,
  preserveBlankLinesInPastedText,
} from "./content-slide-face";
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
  const { focusEditor, blurEditor, panelRef, panelInteractingRef, panelPointerDownRef, lastFontFamilyRef } =
    useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);
  // Guards the remembered-font application below to exactly once per box
  // — see that handler's own comment for why it has to live in onFocus,
  // not onCreate.
  const appliedRememberedFontRef = useRef(false);

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
      // A plain string placeholder decorates whichever paragraph currently
      // holds the cursor, whenever THAT paragraph is empty — so pressing
      // Enter after typing a first line left "Click to add text" sitting on
      // the new, still-empty second line even though the box as a whole
      // plainly has content. Reported directly as a real bug. Checking
      // `editor.isEmpty` instead means the placeholder text itself becomes
      // "" the moment ANY paragraph in the document has content, regardless
      // of which one the cursor is currently in — it only ever shows on a
      // genuinely blank box.
      Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? "Click to add text" : "") }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          FIELD_CLASSES,
          BODY_TYPOGRAPHY,
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
      // See preserveBlankLinesInPastedText's own comment (content-slide-
      // face.tsx) for why this is needed — pasting multi-line content (not
      // typing it) is the other half of "blank lines don't survive" that
      // BODY_TYPOGRAPHY's :empty CSS rule alone can't fix.
      transformPastedText: (text) => preserveBlankLinesInPastedText(text),
    },
    onUpdate: ({ editor }) => {
      debouncedCommit(editor.getHTML());
    },
    onFocus: ({ editor }) => {
      focusEditor(fieldId, editor);
      // Applies the author's last-picked font (see lastFontFamilyRef's own
      // comment in active-editor-context.tsx) the first time a genuinely
      // fresh/empty box is focused — never to a box that already has real
      // saved content, which would mean silently re-styling something the
      // author already authored just because they happened to focus it
      // again later in the same session. Deliberately NOT in onCreate: a
      // TipTap "stored mark" set there only survives until the next
      // selection change, and focusing the box (the user clicking into
      // it to actually type) IS that selection change — confirmed via a
      // real browser that onCreate's own attempt silently never took
      // effect, since by the time any text was typed the mark had
      // already been cleared. onFocus fires AFTER the browser's own
      // focus/selection has settled, so setting it here is what actually
      // survives into the first keystroke. appliedRememberedFontRef
      // guards this to exactly once per box, so clicking in and out of
      // an already-typed-into box never re-applies or fights whatever
      // font the author deliberately chose for it since.
      if (!appliedRememberedFontRef.current && editor.isEmpty && lastFontFamilyRef.current) {
        appliedRememberedFontRef.current = true;
        editor.chain().setFontFamily(lastFontFamilyRef.current).run();
      }
    },
    // Same two-part blur guard as RichTextBody — see that component's own
    // comment in content-slide-face.tsx for the full reasoning (a plain
    // panel button vs. a portal-rendered Select listbox item need different
    // detection strategies).
    onBlur: ({ editor, event }) => {
      // Unconditional, and first: see use-debounced-callback.ts's own
      // comment for why a pending debounced commit has to flush on EVERY
      // blur, including (especially) the "focus moved into the panel"
      // case the guard below exists to otherwise ignore — clicking a
      // Layers panel reorder button IS exactly that case, and is exactly
      // the moment a just-applied format (bold/underline) still sitting
      // in this timer needs to actually land before anything else reads
      // "the current config" to merge its own change on top of.
      debouncedCommit.flush();
      const panelEl = panelRef.current;
      const nextFocus = event.relatedTarget;
      const focusMovedIntoPanel = !!(panelEl && nextFocus instanceof Node && panelEl.contains(nextFocus));
      if (focusMovedIntoPanel || panelInteractingRef.current || panelPointerDownRef.current) {
        return;
      }
      blurEditor(fieldId, editor);
    },
  });

  return <EditorContent editor={editor} className={FILL_BOX} />;
}

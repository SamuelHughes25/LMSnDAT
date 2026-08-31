"use client";

import { Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "./active-editor-context";

// "Normal" intentionally maps to *unsetting* the fontSize mark rather than
// to an explicit `18px` value — the field's default body text is Tailwind's
// `text-lg` (1.125rem = 18px at the default root size), so removing the
// override is what actually makes picking "Normal" a true no-op: it falls
// back to the same CSS the field always had, rather than baking a redundant
// (if numerically identical) inline style into the stored HTML.
const FONT_SIZE_PRESETS = [
  { key: "small", label: "Small", value: "14px" },
  { key: "normal", label: "Normal", value: null },
  { key: "large", label: "Large", value: "24px" },
  { key: "xl", label: "Extra Large", value: "32px" },
] as const;

// Every button here needs `onMouseDown={(e) => e.preventDefault()}` — a
// well-known necessary pattern for any text-formatting toolbar. Without it,
// mousedown moves focus to the button before its click handler runs, which
// collapses the text selection the command was supposed to apply to (and,
// for the TipTap editor specifically, would also fire its onBlur before the
// command ever reaches it).
function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}

// Renders only while some EditableBody is focused with a non-empty
// selection (see active-editor-context.tsx) — "pop up when text is
// highlighted", per the original request. Mounted unconditionally at a
// fixed spot in course-builder.tsx; this internal null-return is what makes
// it appear/disappear, so no wrapper component needs to reach into this
// context on the toolbar's behalf.
//
// Positioned `absolute` (anchored to the header's `relative` container via
// `top-full`), not a normal-flow block: mounting/unmounting this must never
// shift the layout of anything below it. It first shipped as a normal flow
// element, which caused a real click-miss bug — clicking a properties-panel
// button (e.g. the layout picker) blurs the editor, which clears
// `activeEditor`, which unmounts this toolbar; as a flow element that
// shift moved everything below it (including the button being clicked) up
// by this toolbar's height in the middle of the mousedown→click gesture, so
// the click's mouseup landed on empty space instead of the button. Confirmed
// by instrumenting the click handler (it silently never fired) before fixing
// this, not assumed.
export function SlideTextToolbar() {
  const { activeEditor, hasSelection, toolbarRef, toolbarInteractingRef } = useActiveEditorContext();

  if (!activeEditor || !hasSelection) return null;

  const currentFontSize = (activeEditor.getAttributes("textStyle").fontSize as string | undefined) ?? null;
  const currentPreset = FONT_SIZE_PRESETS.find((p) => p.value === currentFontSize) ?? FONT_SIZE_PRESETS[1];

  function applyFontSize(key: string | null) {
    const preset = FONT_SIZE_PRESETS.find((p) => p.key === key);
    if (!preset || !activeEditor) return;
    if (preset.value === null) {
      activeEditor.chain().focus().unsetFontSize().run();
    } else {
      activeEditor.chain().focus().setFontSize(preset.value).run();
    }
  }

  return (
    <div
      ref={toolbarRef}
      className="absolute left-0 top-full z-20 mt-2 flex items-center gap-1 rounded-lg border-2 border-border bg-card p-1.5 shadow-sm"
    >
      <ToolbarButton
        label="Bold"
        active={activeEditor.isActive("bold")}
        onClick={() => activeEditor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={activeEditor.isActive("italic")}
        onClick={() => activeEditor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={activeEditor.isActive("underline")}
        onClick={() => activeEditor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <ToolbarButton
        label="Bullet list"
        active={activeEditor.isActive("bulletList")}
        onClick={() => activeEditor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        active={activeEditor.isActive("orderedList")}
        onClick={() => activeEditor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-border" />

      <Select
        value={currentPreset.key}
        onValueChange={applyFontSize}
        // Base UI's Select doesn't just focus its trigger when it opens —
        // it opens straight to a listbox item and focuses that directly,
        // and that item renders in a portal outside this toolbar's own DOM
        // node. That blurs the active editor in a way a DOM-containment
        // check on the toolbar can't see (see the onBlur comment in
        // content-slide-face.tsx), so this flag tells that handler
        // explicitly "ignore this blur, the toolbar itself is doing this."
        onOpenChange={(open) => {
          toolbarInteractingRef.current = open;
        }}
      >
        <SelectTrigger
          className="h-7 w-32"
          // Same reasoning as ToolbarButton: mousedown on the trigger must
          // not be allowed to collapse the editor's selection before the
          // user has picked a size. Also flip the ref a tick earlier than
          // onOpenChange would (mousedown fires before Base UI's own
          // open/focus logic runs), so there's no gap where the blur this
          // click is about to cause could slip through unguarded.
          onMouseDown={(e) => {
            e.preventDefault();
            toolbarInteractingRef.current = true;
          }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FONT_SIZE_PRESETS.map((preset) => (
            <SelectItem key={preset.key} value={preset.key}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

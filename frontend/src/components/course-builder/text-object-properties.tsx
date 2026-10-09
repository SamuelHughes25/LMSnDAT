"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { BoxTransform, PositionableField, Slide, SlideConfig } from "@/lib/course-types";
import type { TextAlignValue } from "@/lib/tiptap-text-align";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "./active-editor-context";
import { ObjectPositionFields } from "./object-position-fields";

const FIELD_LABELS: Record<PositionableField, string> = {
  title: "Title",
  subtitle: "Subtitle",
  body: "Body text",
  body2: "Body text",
};

// Same options/reasoning as the old floating toolbar (slide-text-toolbar.tsx,
// since removed) — "Default" unsets the mark rather than baking in a
// redundant (and, for title/subtitle, actively wrong) inline size; the rest
// are every whole px from 1-34, generated once rather than hand-written.
const FONT_SIZE_OPTIONS: { key: string; label: string; value: string | null }[] = [
  { key: "default", label: "Default", value: null },
  ...Array.from({ length: 34 }, (_, i) => {
    const size = i + 1;
    return { key: String(size), label: String(size), value: `${size}px` };
  }),
];

const TEXT_COLOR_PRESETS: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Black", value: "#000000" },
  { label: "White", value: "#ffffff" },
  { label: "Red", value: "#dc2626" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
];

// A curated, web-safe list rather than every font installed on the author's
// own machine — TipTap just writes whatever string is picked straight into
// an inline `font-family` style (see tiptap-font-family.ts), so a font this
// list doesn't have installed would silently fall back to the browser
// default for both the author AND every learner viewing the published
// course. Sticking to fonts virtually guaranteed present on Windows/macOS/
// Linux (the classic "web-safe" set, plus the couple of sans/serif/mono
// defaults already used elsewhere in this app's own UI) avoids that gap
// entirely, at the cost of not supporting arbitrary custom fonts — a
// reasonable trade for an internal training tool.
const FONT_FAMILY_OPTIONS: { key: string; label: string; value: string | null }[] = [
  { key: "default", label: "Default", value: null },
  { key: "arial", label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { key: "georgia", label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { key: "times", label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { key: "courier", label: "Courier New", value: "'Courier New', Courier, monospace" },
  { key: "verdana", label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { key: "trebuchet", label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { key: "comic-sans", label: "Comic Sans MS", value: "'Comic Sans MS', 'Comic Sans', cursive" },
];

const TEXT_ALIGN_OPTIONS: { value: TextAlignValue; label: string; icon: typeof AlignLeft }[] = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify },
];

// Shown in the properties panel whenever a text box (title/subtitle/body/
// body2) is SELECTED (see course-builder.tsx, which reads
// slide-selection-context.tsx's selectedId to decide this) — replaces
// slide-text-toolbar.tsx's old floating popup entirely. Two independent
// sections: position/size (always available, driven by config.box_transforms
// — the same field the canvas's own drag handles write) and text formatting
// (only available once this box's TipTap editor is actually focused — see
// the isEditorLive check below).
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

  // Forces a re-render on every editor transaction (content change, cursor
  // move, mark toggle) — without this, the panel's own "current bold/
  // color/size" display would go stale the instant a mark is applied to an
  // already-selected range (that doesn't move the selection itself, the
  // only thing this app previously re-rendered on). Same fix the old
  // floating toolbar needed for the same reason.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!editor) return;
    function handleTransaction() {
      forceUpdate((v) => v + 1);
    }
    editor.on("transaction", handleTransaction);
    return () => {
      editor.off("transaction", handleTransaction);
    };
  }, [editor]);

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

// The actual formatting controls — lifted from the old floating toolbar,
// laid out for a vertical panel instead of a horizontal strip. Every
// command still runs through `editor.chain().focus()...run()`, same as
// before; `onMouseDown={(e) => e.preventDefault()}` on the plain buttons is
// still required for the same reason (mousedown would otherwise move focus
// to the button before its click fires, collapsing the selection the
// command was meant to apply to).
function TextFormattingControls({
  editor,
  panelInteractingRef,
}: {
  editor: Editor;
  panelInteractingRef: RefObject<boolean>;
}) {
  const currentFontSize = (editor.getAttributes("textStyle").fontSize as string | undefined) ?? null;
  const currentSizeOption = FONT_SIZE_OPTIONS.find((o) => o.value === currentFontSize) ?? FONT_SIZE_OPTIONS[0];

  const currentFontFamily = (editor.getAttributes("textStyle").fontFamily as string | undefined) ?? null;
  const currentFamilyOption =
    FONT_FAMILY_OPTIONS.find((o) => o.value === currentFontFamily) ?? FONT_FAMILY_OPTIONS[0];

  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? null;

  function applyFontSize(key: string | null) {
    const option = FONT_SIZE_OPTIONS.find((o) => o.key === key);
    if (!option) return;
    if (option.value === null) {
      editor.chain().focus().unsetFontSize().run();
    } else {
      editor.chain().focus().setFontSize(option.value).run();
    }
  }

  function applyFontFamily(key: string | null) {
    const option = FONT_FAMILY_OPTIONS.find((o) => o.key === key);
    if (!option) return;
    if (option.value === null) {
      editor.chain().focus().unsetFontFamily().run();
    } else {
      editor.chain().focus().setFontFamily(option.value).run();
    }
  }

  function applyColor(color: string | null) {
    if (color === null) {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().setColor(color).run();
    }
  }

  function applyAlign(align: TextAlignValue) {
    editor.chain().focus().setTextAlign(align).run();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <FormatButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </FormatButton>
        <FormatButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </FormatButton>
        <FormatButton
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" />
        </FormatButton>
        <FormatButton
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-4 w-4" />
        </FormatButton>
        <FormatButton
          label="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-4 w-4" />
        </FormatButton>
      </div>

      <div className="flex items-center gap-1">
        {TEXT_ALIGN_OPTIONS.map(({ value, label, icon: Icon }) => (
          <FormatButton
            key={value}
            label={label}
            active={editor.isActive({ textAlign: value })}
            onClick={() => applyAlign(value)}
          >
            <Icon className="h-4 w-4" />
          </FormatButton>
        ))}
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Font</div>
        <Select
          items={FONT_FAMILY_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
          value={currentFamilyOption.key}
          onValueChange={applyFontFamily}
          onOpenChange={(open) => {
            panelInteractingRef.current = open;
          }}
        >
          <SelectTrigger
            className="h-8 w-full"
            onMouseDown={(e) => {
              e.preventDefault();
              panelInteractingRef.current = true;
            }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILY_OPTIONS.map((option) => (
              <SelectItem key={option.key} value={option.key}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Size</div>
          <Select
            items={FONT_SIZE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
            value={currentSizeOption.key}
            onValueChange={applyFontSize}
            onOpenChange={(open) => {
              panelInteractingRef.current = open;
            }}
          >
            <SelectTrigger
              className="h-8 w-full"
              onMouseDown={(e) => {
                e.preventDefault();
                panelInteractingRef.current = true;
              }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FONT_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Color</div>
          <TextColorPicker currentColor={currentColor} onChange={applyColor} panelInteractingRef={panelInteractingRef} />
        </div>
      </div>
    </div>
  );
}

function FormatButton({
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

// Same preset-swatch-plus-native-picker shape as the old toolbar's version.
function TextColorPicker({
  currentColor,
  onChange,
  panelInteractingRef,
}: {
  currentColor: string | null;
  onChange: (color: string | null) => void;
  panelInteractingRef: RefObject<boolean>;
}) {
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        panelInteractingRef.current = open;
      }}
    >
      <DropdownMenuTrigger
        render={<button type="button" />}
        aria-label="Text color"
        title="Text color"
        onMouseDown={(e) => {
          e.preventDefault();
          panelInteractingRef.current = true;
        }}
        className="flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-md border border-input text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <span className="text-xs font-bold leading-none">A</span>
        <span
          className="h-1 w-4 rounded-sm border border-border/60"
          style={{ backgroundColor: currentColor ?? "transparent" }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TEXT_COLOR_PRESETS.map((preset) => (
          <DropdownMenuItem key={preset.label} onClick={() => onChange(preset.value)}>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: preset.value ?? "transparent" }}
            />
            {preset.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm">
          <input
            type="color"
            value={currentColor ?? "#000000"}
            onChange={(e) => onChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-5 w-5 shrink-0 cursor-pointer rounded border border-border p-0"
          />
          Custom…
        </label>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

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
import type { TextAlignValue } from "@/lib/tiptap-text-align";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "./active-editor-context";

// Extracted out of text-object-properties.tsx so free-text-box-properties.tsx
// (the generic freeform text box's panel) can share the exact same
// formatting UI/commands as the legacy title/subtitle/body/body2 fields,
// rather than a second near-duplicate copy — this IS the literal mechanism
// behind "title boxes and body boxes shouldn't be any different": both
// object types' panels now render the identical component, with identical
// commands, against whichever `Editor` instance is actually focused. Fully
// field-agnostic already — takes only an `Editor` and nothing else — so no
// changes were needed here to make it reusable, just a new home.

// 8-34 in single-px steps (fine control for ordinary body/title text),
// plus a handful of larger presets for display/headline-sized text —
// reported as a real gap, not just "a few more options": 34px was the
// hard ceiling before, with no way to go bigger at all. Sub-8 sizes
// (previously 1-7) are gone entirely — uselessly small on this app's
// fixed 960x540 canvas, never a legitimate choice.
const FONT_SIZE_OPTIONS: { key: string; label: string; value: string | null }[] = [
  { key: "default", label: "Default", value: null },
  ...Array.from({ length: 27 }, (_, i) => {
    const size = i + 8;
    return { key: String(size), label: String(size), value: `${size}px` };
  }),
  ...[40, 48, 60, 72, 96].map((size) => ({ key: String(size), label: String(size), value: `${size}px` })),
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
// own machine — see the original comment this was copied from in
// text-object-properties.tsx's git history for the full reasoning.
//
// No more "Default" entry — it used to carry `value: null` (meaning "no
// explicit override, just use the mark's own styling") under a vague,
// unhelpful label. That vagueness is exactly what let a real bug — a
// self-referential CSS variable in globals.css that silently made the
// app's actual base font compute to the browser's serif fallback instead
// of Geist — hide in plain sight: "Default" never told anyone what it
// actually resolved to. "Geist" below is that same `value: null` behavior
// (still just unsets the mark), renamed to the real font it now correctly
// renders as — every option in this list is a genuine font name, per the
// request, nothing generic.
const FONT_FAMILY_OPTIONS: { key: string; label: string; value: string | null }[] = [
  { key: "geist", label: "Geist", value: null },
  { key: "arial", label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { key: "helvetica", label: "Helvetica", value: "Helvetica, Arial, sans-serif" },
  { key: "verdana", label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { key: "tahoma", label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { key: "trebuchet", label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { key: "calibri", label: "Calibri", value: "Calibri, Candara, sans-serif" },
  { key: "segoe", label: "Segoe UI", value: "'Segoe UI', sans-serif" },
  { key: "century-gothic", label: "Century Gothic", value: "'Century Gothic', sans-serif" },
  { key: "franklin-gothic", label: "Franklin Gothic Medium", value: "'Franklin Gothic Medium', 'Arial Narrow', sans-serif" },
  { key: "impact", label: "Impact", value: "Impact, sans-serif" },
  { key: "georgia", label: "Georgia", value: "Georgia, 'Times New Roman', serif" },
  { key: "times", label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { key: "garamond", label: "Garamond", value: "Garamond, serif" },
  { key: "cambria", label: "Cambria", value: "Cambria, serif" },
  { key: "palatino", label: "Palatino Linotype", value: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { key: "book-antiqua", label: "Book Antiqua", value: "'Book Antiqua', Palatino, serif" },
  { key: "courier", label: "Courier New", value: "'Courier New', Courier, monospace" },
  { key: "consolas", label: "Consolas", value: "Consolas, 'Courier New', monospace" },
  { key: "comic-sans", label: "Comic Sans MS", value: "'Comic Sans MS', 'Comic Sans', cursive" },
];

// What the Size trigger shows while no explicit size mark is set —
// reported directly as confusing: the word "Default" told the author
// nothing about what size the selected text actually IS, just that
// nobody had overridden it yet. Reads the real rendered size straight off
// the DOM at the selection's own position (not a fixed guess per field
// type) so it's correct regardless of which field this selection sits in
// (title/body/a freeform box all carry different base sizes via Tailwind
// classes, not an inline style this component could otherwise read off
// the mark). Falls back to an em dash if the selection can't resolve to a
// real DOM node — a window right after a slide switch, before React has
// re-rendered this box's own content, confirmed as the only time this
// can happen.
function currentComputedFontSizeLabel(editor: Editor): string {
  try {
    const { from } = editor.state.selection;
    const pos = editor.view.domAtPos(from);
    const el = pos.node.nodeType === Node.TEXT_NODE ? pos.node.parentElement : (pos.node as HTMLElement);
    if (!el) return "—";
    const px = Math.round(Number.parseFloat(window.getComputedStyle(el).fontSize));
    return Number.isFinite(px) ? String(px) : "—";
  } catch {
    return "—";
  }
}

// editor.getAttributes("textStyle") — what this panel used to read
// fontFamily/fontSize/color off of — is unreliable the instant the
// selection is a RANGE rather than a collapsed cursor. TipTap's own
// getMarkAttributes() (node_modules/@tiptap/core/src/helpers/
// getMarkAttributes.ts) walks every node in the selection, collects ALL
// their marks into one flat array, then does `marks.find(mark => mark
// .type.name === 'textStyle')` — the first TEXTSTYLE MARK it meets,
// regardless of which of ITS OWN attrs are actually set. fontFamily,
// fontSize, and color all live on that same one shared mark (see
// tiptap-font-family.ts/tiptap-font-size.ts/tiptap-text-color.ts's own
// comments on why), so a selection that happens to start in text that
// only ever had its COLOR or SIZE changed — a textStyle mark that exists
// but carries fontFamily: null — reports "no font" for the whole
// selection even when the rest of it genuinely has one, because `.find`
// stops at the first mark of the right TYPE, not the first one that
// actually carries this attribute. Confirmed as the actual mechanism
// behind a reported bug: the Font dropdown would intermittently claim
// "Default" for text that visibly wasn't rendering in the default font.
// This walks the full selection itself and only trusts a value when
// every character in it agrees — "mixed" means they don't (e.g. half the
// selection is Georgia, half is untouched), which the caller renders as
// an em dash rather than silently picking a side.
// Browsers rewrite an inline style's quote characters the moment it
// round-trips through saved HTML: setFontFamily("...'Times New Roman'...")
// is stored verbatim in the live ProseMirror document right after applying
// it — so it string-matches FONT_FAMILY_OPTIONS and the dropdown shows the
// right name immediately — but the NEXT time that HTML is parsed back into
// a document (a page reload, reopening the course, anything that reparses
// saved content fresh) the browser's own style-attribute serialization has
// turned the single quotes into double quotes. The exact same font no
// longer string-matches FONT_FAMILY_OPTIONS' (single-quoted) value at all,
// FONT_FAMILY_OPTIONS.find() falls through to its own ?? fallback — the
// very first entry, Geist — regardless of what font the text actually is.
// Confirmed directly: apply Georgia, reload the page, reselect the same
// text — the dropdown claims Geist even though the text still visibly
// renders in Georgia. Stripping quote characters before comparing makes
// the match immune to this, both when reading a mark's value here and when
// matching it against FONT_FAMILY_OPTIONS below.
function normalizeFontFamilyValue(value: string | null): string | null {
  return value === null ? null : value.replace(/['"]/g, "");
}

function getUniformTextStyleAttr(
  editor: Editor,
  attr: "fontFamily" | "fontSize" | "color",
): string | null | "mixed" {
  const normalize = attr === "fontFamily" ? normalizeFontFamilyValue : (v: string | null) => v;
  const { state } = editor;
  const { from, to, empty } = state.selection;
  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    const mark = marks.find((m) => m.type.name === "textStyle");
    return normalize((mark?.attrs[attr] as string | undefined) ?? null);
  }
  let seen = false;
  let value: string | null = null;
  let mixed = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (mixed || !node.isText) return;
    const mark = node.marks.find((m) => m.type.name === "textStyle");
    const nodeValue = normalize((mark?.attrs[attr] as string | undefined) ?? null);
    if (!seen) {
      seen = true;
      value = nodeValue;
    } else if (nodeValue !== value) {
      mixed = true;
    }
  });
  return mixed ? "mixed" : value;
}

// Same reasoning, and same approach, as currentComputedFontSizeLabel just
// above — "Default" told the author nothing about what font the selected
// text actually renders in. getComputedStyle's fontFamily is the full
// resolved stack (e.g. the base theme font plus its generic-family
// fallbacks); only the FIRST entry is the one actually being rendered, so
// that's the only part shown here — quoted entries (multi-word font
// names come back quoted) have their quotes stripped for a clean label.
function currentComputedFontFamilyLabel(editor: Editor): string {
  try {
    const { from } = editor.state.selection;
    const pos = editor.view.domAtPos(from);
    const el = pos.node.nodeType === Node.TEXT_NODE ? pos.node.parentElement : (pos.node as HTMLElement);
    if (!el) return "—";
    const stack = window.getComputedStyle(el).fontFamily;
    const first = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
    return first || "—";
  } catch {
    return "—";
  }
}

const TEXT_ALIGN_OPTIONS: { value: TextAlignValue; label: string; icon: typeof AlignLeft }[] = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
  { value: "justify", label: "Justify", icon: AlignJustify },
];

// A Select `value` that deliberately matches none of a dropdown's real
// option keys — used below whenever the selection's own attribute value
// isn't uniform (see getUniformTextStyleAttr), so Base UI correctly shows
// no checkmark on any item instead of falsely endorsing whichever one
// happens to share a key with "mixed".
const MIXED_KEY = "__mixed__";

export function TextFormattingControls({
  editor,
  panelInteractingRef,
  hideSize,
}: {
  editor: Editor;
  panelInteractingRef: RefObject<boolean>;
  // Omits the Size control — interactive/assessment widgets (multiple
  // choice, accordion, flashcards, match pairs, sequencing, hotspot image)
  // have fixed, structurally-sized layouts that a resized font could
  // overflow or clip (an option row's fixed height, a flashcard's centered
  // text, a hotspot marker's small popover) — explicitly requested as
  // "edit everything I normally would apart from size" when the same
  // formatting controls were extended to those widgets' text fields. Every
  // other control (bold/italic/underline/lists/align/font/color) still
  // applies there exactly as it does on an ordinary content slide.
  hideSize?: boolean;
}) {
  const currentFontSizeAttr = getUniformTextStyleAttr(editor, "fontSize");
  const isMixedSize = currentFontSizeAttr === "mixed";
  const currentSizeOption = isMixedSize
    ? null
    : (FONT_SIZE_OPTIONS.find((o) => o.value === currentFontSizeAttr) ?? FONT_SIZE_OPTIONS[0]);

  const { lastFontFamilyRef } = useActiveEditorContext();

  const currentFontFamilyAttr = getUniformTextStyleAttr(editor, "fontFamily");
  const isMixedFamily = currentFontFamilyAttr === "mixed";
  const currentFamilyOption = isMixedFamily
    ? null
    : (FONT_FAMILY_OPTIONS.find((o) => normalizeFontFamilyValue(o.value) === currentFontFamilyAttr) ??
      FONT_FAMILY_OPTIONS[0]);

  const currentColorAttr = getUniformTextStyleAttr(editor, "color");
  const currentColor = currentColorAttr === "mixed" ? null : currentColorAttr;

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
    // Remembered regardless of which option was picked, including
    // "Default" itself — whatever the author most recently chose,
    // deliberately, is what a brand-new text box should start with too.
    // See lastFontFamilyRef's own comment in active-editor-context.tsx.
    lastFontFamilyRef.current = option.value;
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
          value={isMixedFamily ? MIXED_KEY : currentFamilyOption!.key}
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
            <SelectValue>
              {() =>
                isMixedFamily
                  ? "—"
                  : currentFamilyOption!.key === "geist"
                    ? currentComputedFontFamilyLabel(editor)
                    : currentFamilyOption!.label
              }
            </SelectValue>
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

      <div className={cn("grid gap-2", hideSize ? "grid-cols-1" : "grid-cols-2")}>
        {!hideSize && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Size</div>
            <Select
              items={FONT_SIZE_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
              value={isMixedSize ? MIXED_KEY : currentSizeOption!.key}
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
                <SelectValue>
                  {() =>
                    isMixedSize
                      ? "—"
                      : currentSizeOption!.key === "default"
                        ? currentComputedFontSizeLabel(editor)
                        : currentSizeOption!.label
                  }
                </SelectValue>
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
        )}

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

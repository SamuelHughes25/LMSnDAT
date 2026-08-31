"use client";

import { useLayoutEffect, useState, type CSSProperties } from "react";
import { Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useActiveEditorContext } from "./active-editor-context";

// Gap (px) kept between the toolbar and the selection it's floating next
// to, on whichever side it ends up rendering.
const GAP = 8;

// Fallback box size used only for the very first synchronous render after
// the toolbar mounts, before the layout effect below has measured its real
// box. Because that measurement happens in a *layout* effect (not a plain
// effect), the correction lands before the browser paints — so this
// estimate is never actually visible, it only has to be in the right
// ballpark so the first computed position isn't wildly wrong for that one
// discarded pass. Height (~44px) matches the toolbar's actual h-7 buttons +
// p-1.5 padding + border-2; width is harder to eyeball precisely because of
// the variable-width font-size Select, so this is intentionally generous.
const ESTIMATED_SIZE = { width: 320, height: 44 };

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
// Positioned `fixed`, floating near the current text selection (Google
// Docs/Notion-style) rather than anchored to a fixed spot on the page — see
// the position math below. `fixed` is, like the `absolute` positioning this
// replaced, *always* taken out of normal document flow (confirmed, not
// assumed: no ancestor between this component and the document root sets
// `transform`/`filter`/`will-change: transform` or anything else that would
// give `fixed` a containing block other than the viewport), so
// mounting/unmounting this still can never shift the layout of anything
// else on the page. It first shipped as a normal flow element, which caused
// a real click-miss bug — clicking a properties-panel button (e.g. the
// layout picker) blurs the editor, which clears `activeEditor`, which
// unmounts this toolbar; as a flow element that shift moved everything
// below it (including the button being clicked) up by this toolbar's height
// in the middle of the mousedown→click gesture, so the click's mouseup
// landed on empty space instead of the button. Confirmed by instrumenting
// the click handler (it silently never fired) before fixing this, not
// assumed.
export function SlideTextToolbar() {
  const { activeEditor, hasSelection, selectionRect, toolbarRef, toolbarInteractingRef } = useActiveEditorContext();
  const [size, setSize] = useState(ESTIMATED_SIZE);

  // Hooks must run unconditionally before the early return below (Rules of
  // Hooks), so this measures on every render regardless of whether the
  // toolbar is currently visible — `toolbarRef.current` is simply null
  // while invisible (the early return below skips rendering the div, but
  // this component's own instance never unmounts just because it returned
  // null on some prior render — it's mounted once, unconditionally, in
  // course-builder.tsx), in which case this is a no-op and `size` just
  // keeps its last known value.
  //
  // Deliberately no dependency array — and specifically *not* `[toolbarRef]`
  // as eslint-plugin-react-hooks suggests, which would be actively wrong
  // here: `toolbarRef` is a ref *object* whose identity never changes, so
  // listing it would make this effect fire exactly once, on this
  // component's true first mount — while `hasSelection` is still false and
  // `toolbarRef.current` is still null (nothing has rendered into it yet).
  // It would never fire again afterward (same stable identity forever), so
  // `size` would permanently stick at the fallback ESTIMATED_SIZE and never
  // get corrected once real selections start happening. Running after every
  // render is what actually re-measures each time the toolbar transitions
  // from hidden to visible; it's cheap (one getBoundingClientRect call) and
  // self-limiting (the setSize call below bails out via Object.is-style
  // equality once the measured box stops changing, which it does
  // immediately since the toolbar's box is otherwise constant).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
  });

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

  // `window.innerWidth`/`window.getSelection()`-derived `selectionRect` are
  // safe to read unguarded here (unlike e.g. StaticBody's DOMPurify call,
  // which runs unconditionally on every render including SSR): this whole
  // branch only ever executes once `activeEditor && hasSelection` are both
  // true, which requires a live, client-mounted TipTap editor with a real
  // selection — never true during server rendering.
  //
  // Float above the selection by default (`top - GAP - height`); flip to
  // below (`bottom + GAP`) when there isn't enough room above, so `top`
  // never goes negative. Clamp `left` so the toolbar's right edge never
  // overflows `window.innerWidth` (and, for free, so its left edge never
  // goes negative either). If `selectionRect` is null (the guarded
  // edge-case in active-editor-context.tsx), fall back to no explicit
  // top/left at all — CSS resolves that to this element's "static
  // position," i.e. roughly where its DOM parent (the header) is, a
  // reasonable degrade rather than pinning to the viewport corner.
  let style: CSSProperties = { position: "fixed" };
  if (selectionRect) {
    const spaceAbove = selectionRect.top - GAP - size.height;
    const top = spaceAbove >= 0 ? spaceAbove : selectionRect.bottom + GAP;
    const maxLeft = window.innerWidth - size.width - GAP;
    const left = Math.min(Math.max(selectionRect.left, GAP), Math.max(GAP, maxLeft));
    style = { ...style, top, left };
  }

  return (
    <div ref={toolbarRef} style={style} className="z-20 flex items-center gap-1 rounded-lg border-2 border-border bg-card p-1.5 shadow-sm">
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

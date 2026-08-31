"use client";

import { useSyncExternalStore } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import DOMPurify from "dompurify";

import type { ContentSlideLayout } from "@/lib/course-types";
import { FontSize } from "@/lib/tiptap-font-size";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { cn, stripHtml } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import type { SlideFaceProps } from "./index";

// Every interactive TipTap instance below (title and body alike) commits to
// the parent via a debounced onUpdate — ProseMirror owns its own DOM and
// keystroke-level state, so this only governs how often the network PATCH
// (routed through onTitleChange/onConfigChange, which course-builder.tsx
// wires to the updateSlide Server Action) actually fires, not how the
// editor itself feels while typing. The canvas mounts this component with
// key={slide.id} (see slide-canvas.tsx), so switching slides fully remounts
// it — any pending debounced call from the previously selected slide is
// cancelled by the hook's unmount cleanup rather than firing stale.
const CHANGE_DEBOUNCE_MS = 500;

const FIELD_CLASSES =
  "w-full resize-none border-none bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:outline-none focus:ring-1 focus:ring-primary/40";

// Stable no-op subscribe for the `useIsClient` external store below — there
// is nothing to subscribe to (the client/server distinction never changes
// after mount), it only needs to exist so useSyncExternalStore has a
// subscribe function with a consistent identity across renders.
function subscribeNever() {
  return () => {};
}

// The React-documented way to gate a render to "client only, after
// hydration" without the extra setState-in-effect anti-pattern (and its
// associated lint warning) that the equivalent `useState(false) +
// useEffect(() => setMounted(true), [])` pattern produces. The server
// snapshot is always `false`; the client snapshot is always `true` — so the
// first client render (the one hydration reconciles against) still matches
// the server's `false`, and a real client render only happens after.
function useIsClient() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

export function ContentSlideFace({ slide, mode, onTitleChange, onConfigChange }: SlideFaceProps) {
  const layout: ContentSlideLayout = slide.config.layout ?? "title-body";

  const titleNode = (
    <EditableTitle
      value={slide.title}
      mode={mode}
      onCommit={(title) => onTitleChange?.(title)}
    />
  );

  // "two-column" renders two genuinely separate text boxes side by side
  // (config.body / config.body2), not one field CSS-split into columns —
  // CSS `columns` only wraps text into a second column once it overflows
  // the container's height, so a short body would look identical to
  // "title-body" and the layout picker would appear to do nothing.
  const bodyNodes =
    layout === "two-column" ? (
      <div className="flex h-full gap-8">
        <EditableBody
          value={slide.config.body}
          mode={mode}
          onCommit={(body) => onConfigChange?.({ body })}
          className="flex-1"
        />
        <EditableBody
          value={slide.config.body2}
          mode={mode}
          onCommit={(body2) => onConfigChange?.({ body2 })}
          className="flex-1"
        />
      </div>
    ) : (
      <EditableBody
        value={slide.config.body}
        mode={mode}
        onCommit={(body) => onConfigChange?.({ body })}
      />
    );

  if (layout === "title-only") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-white px-16 py-12 text-center text-foreground">
        {titleNode}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white px-16 py-12 text-foreground">
      {titleNode}
      <div className="mt-8 min-h-0 flex-1">{bodyNodes}</div>
    </div>
  );
}

// Dispatches to one of two genuinely different implementations depending on
// `mode`, rather than branching inside a single component body — a TipTap
// editor instance must never be created for a non-"edit" render (thumbnails
// render every slide in the rail on every keystroke elsewhere in the app;
// mounting a full ProseMirror editor per thumbnail would be both wasteful
// and pointless, since nothing there is ever edited). Splitting into two
// sibling components, each with its own unconditional hook calls, keeps
// this a plain component-selection decision rather than a conditional hook
// call. Both "static" and "present" take the StaticField path here — this
// slide type has nothing to interact with, so presentation mode behaves
// exactly like a static (thumbnail) render.
function EditableBody({
  value,
  mode,
  onCommit,
  className,
}: {
  value: string | undefined;
  mode: SlideFaceProps["mode"];
  onCommit: (value: string) => void;
  className?: string;
}) {
  if (mode === "edit") {
    return <RichTextBody value={value} onCommit={onCommit} className={className} />;
  }
  return <StaticField value={value} placeholder="Click to add text" className={cn(BODY_TYPOGRAPHY, className)} />;
}

// Same dispatch shape as EditableBody above, for the on-canvas slide title.
// Kept as a separate sibling (not folded into EditableBody with a "isTitle"
// flag) because the two fields genuinely differ in extensions, typography,
// and placeholder copy — a shared component would just be an if/else wearing
// a trenchcoat.
function EditableTitle({
  value,
  mode,
  onCommit,
}: {
  value: string;
  mode: SlideFaceProps["mode"];
  onCommit: (value: string) => void;
}) {
  if (mode === "edit") {
    return <RichTextTitle value={value} onCommit={onCommit} />;
  }
  return <StaticField value={value} placeholder="Click to add title" className="text-4xl font-bold" />;
}

// Shared between the interactive TipTap body editor and the sanitized static
// render (thumbnails, preview), so bullet/numbered lists look the same in
// both. Tailwind's base reset strips default <ul>/<ol> list-style and
// padding, so without this a bulletList/orderedList mark still produces
// valid <ul>/<ol> markup but renders with no visible marker at all. Not used
// by the title field at all — titles don't carry this typography, and (per
// the current, deliberately-unrestricted title extension set) a title could
// in principle contain a list, in which case it should look like whatever a
// bare, unstyled list looks like rather than adopting body copy's spacing.
const BODY_TYPOGRAPHY =
  "h-full overflow-y-auto text-lg leading-relaxed [&_p]:my-0 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-0.5";

// Non-interactive render path for any sanitized-HTML field on this face —
// title and body/body2 alike (thumbnails, the learner-facing preview in
// course-preview-viewer.tsx). This content is only ever authored by trusted
// admins today, but course-preview-viewer.tsx already renders this same face
// to arbitrary learners once a course is published, so stored HTML is
// sanitized with DOMPurify before it ever reaches dangerouslySetInnerHTML —
// never render it raw. `placeholder` and `className` let each caller supply
// its own empty-state copy and typography (EditableBody passes
// BODY_TYPOGRAPHY + "Click to add text", EditableTitle passes
// "text-4xl font-bold" + "Click to add title") rather than this component
// assuming either one.
function StaticField({
  value,
  className,
  placeholder,
}: {
  value: string | undefined;
  className?: string;
  placeholder: string;
}) {
  // DOMPurify needs a real `window`/DOM to sanitize against; it has neither
  // during server rendering (Next.js still SSRs "use client" components for
  // the initial HTML) and its documented fallback there is to hand back the
  // *unsanitized* input unchanged rather than throw. Evaluating `sanitize()`
  // straight in the render body would therefore ship raw, un-sanitized HTML
  // in the server-rendered payload — silently defeating the whole point.
  // Gating on `useIsClient()` means the very first client render (the one
  // that hydrates against the server's markup) still renders nothing, same
  // as the server did; only the *next* render, once `window` genuinely
  // exists, calls DOMPurify for real. That extra render is a one-frame,
  // effectively imperceptible flash — an acceptable cost for never letting
  // unsanitized HTML reach the DOM.
  const isClient = useIsClient();
  const sanitized = isClient ? DOMPurify.sanitize(value ?? "") : "";
  const classes = cn(FIELD_CLASSES, "pointer-events-none", className);

  // A field that was typed into and then fully cleared out doesn't
  // round-trip through TipTap as `""` — `editor.getHTML()` on an empty doc
  // returns `"<p></p>"` (an empty-but-valid paragraph), which
  // `DOMPurify.sanitize` passes through unchanged since it's perfectly
  // valid markup. A plain `!sanitized` check therefore misses this case and
  // would render a blank, tag-only `<p></p>` instead of the placeholder.
  // stripHtml (a real DOM-based tag strip, not a regex) gives the actual
  // rendered text content regardless of how many empty wrapper tags survive
  // sanitization, so "no visible text" is what's actually being checked
  // here, not "the string happens to be empty."
  const isEmpty = !sanitized || stripHtml(sanitized).trim().length === 0;

  if (isEmpty) {
    return (
      <div className={classes}>
        <span className="text-muted-foreground/50">{placeholder}</span>
      </div>
    );
  }

  // Sanitized above via DOMPurify.sanitize() — never render `value` raw.
  return <div className={classes} dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

// Interactive (canvas) render path — a real TipTap/ProseMirror editor per
// instance. ProseMirror owns its DOM from here on: unlike the old
// contentEditable version, this component never re-feeds `value` back into
// JSX children on re-render, so there is no parallel "React thinks the
// content is X" vs "the DOM actually contains Y" state for the two to
// fight over — the cursor-reset bug (Shift+Enter, paste) was exactly that
// fight, and it cannot recur here because React no longer has an opinion
// about this element's children after the initial mount.
function RichTextBody({
  value,
  onCommit,
  className,
}: {
  value: string | undefined;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const { setActiveEditor, toolbarRef, toolbarInteractingRef } = useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);

  const editor = useEditor({
    // SSR would otherwise print a "Tiptap Error: SSR has been detected"
    // warning and risk a hydration mismatch — this component only ever
    // needs to exist once mounted in the browser.
    immediatelyRender: false,
    editable: true,
    content: value ?? "",
    extensions: [
      // A deliberately small extension set for a slide body — headings,
      // blockquotes, code blocks and horizontal rules aren't part of this
      // slide type's design, so they're turned off rather than accepting
      // every StarterKit default blindly. `underline` stays on (it's
      // bundled by StarterKit v3 by default) rather than also importing
      // @tiptap/extension-underline separately — the two would register the
      // same mark twice, which TipTap warns about at runtime.
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
      Placeholder.configure({ placeholder: "Click to add text" }),
    ],
    editorProps: {
      attributes: {
        // Placeholder (@tiptap/extension-placeholder) stamps an `is-empty`
        // class + `data-placeholder` attribute onto the empty paragraph
        // node itself, not a `:empty` state on this wrapper div — so the
        // old field's `empty:before:content-[attr(data-placeholder)])`
        // pattern doesn't apply here; this targets the node the extension
        // actually decorates instead.
        class: cn(
          FIELD_CLASSES,
          BODY_TYPOGRAPHY,
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
          className,
        ),
      },
    },
    onUpdate: ({ editor }) => {
      debouncedCommit(editor.getHTML());
    },
    onFocus: ({ editor }) => {
      setActiveEditor(editor);
    },
    // Functional-updater form — see active-editor-context.tsx for why this
    // is the part that makes focus/blur races between the two-column
    // layout's two editors safe rather than a source of flaky bugs.
    //
    // Guarded two ways, because clicking a toolbar control blurs this editor
    // too, and without a guard that would clear `activeEditor` — which
    // unmounts `SlideTextToolbar`, including the control the user was
    // mid-click on:
    //  1. `relatedTarget` (the element about to receive focus) inside the
    //     toolbar's own DOM node — covers plain buttons (Bold/Italic/etc.),
    //     which stay focus-neutral thanks to their onMouseDown preventDefault,
    //     so relatedTarget here is really just a belt-and-suspenders check.
    //  2. `toolbarInteractingRef` — covers the font-size Select, which
    //     doesn't just focus its trigger: Base UI opens it straight to a
    //     listbox *item*, focusing that item directly, and that item is
    //     rendered in a portal outside the toolbar's DOM subtree entirely —
    //     confirmed by instrumenting this handler and inspecting the actual
    //     relatedTarget during a real open, not assumed. A DOM-containment
    //     check can't see into a portal it doesn't know the location of, so
    //     the Select instead sets this ref directly (see slide-text-toolbar.tsx)
    //     whenever it's opening/open, sidestepping the portal question
    //     entirely in favor of explicit "we're mid-interaction" state.
    onBlur: ({ editor, event }) => {
      const toolbarEl = toolbarRef.current;
      const nextFocus = event.relatedTarget;
      const focusMovedIntoToolbar = !!(toolbarEl && nextFocus instanceof Node && toolbarEl.contains(nextFocus));
      if (focusMovedIntoToolbar || toolbarInteractingRef.current) {
        return;
      }
      setActiveEditor((current) => (current === editor ? null : current));
    },
  });

  return <EditorContent editor={editor} />;
}

// Interactive (canvas) render path for the slide title — a single-line
// TipTap instance sharing SlideTextToolbar with RichTextBody above (that's
// the whole point: selecting part of a title pops up the same Bold/Italic/
// Underline/list/font-size toolbar as selecting part of the body does), so
// its focus/blur wiring is identical to RichTextBody's — see the comments
// there for why the toolbarRef/toolbarInteractingRef guards on onBlur exist.
//
// Differs from RichTextBody in exactly three ways: the placeholder copy,
// the typography class (`text-4xl font-bold` instead of BODY_TYPOGRAPHY —
// the title's default, unformatted look is unchanged from the old plain
// <input>), and `editorProps.handleKeyDown` below, which is what actually
// keeps this a single line.
//
// Judgment call: this does NOT also disable bulletList/orderedList in the
// StarterKit config below (they're left exactly as RichTextBody configures
// them). A title selection can still, in principle, be toggled into a
// bullet/numbered list via the shared toolbar — it won't create a second
// line (Enter is still suppressed), just wrap the single line in a list
// marker, which is a cosmetic edge case the brief didn't ask about, not a
// correctness violation of "single line." Deliberately not touching
// StarterKit's list config to avoid an orphaned-schema risk (disabling
// bulletList/orderedList while leaving listItem enabled, or vice versa) for
// a case that wasn't requested.
function RichTextTitle({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const { setActiveEditor, toolbarRef, toolbarInteractingRef } = useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);

  const editor = useEditor({
    immediatelyRender: false,
    editable: true,
    // Pre-existing rows may hold plain text with no wrapping tags (rows
    // written before this change) — ProseMirror's HTML parser auto-wraps
    // loose top-level text into a paragraph the same way it would
    // `<p>...</p>`, so this needs no special-casing (see the comment on
    // `Slide.title` in course-types.ts).
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
      Placeholder.configure({ placeholder: "Click to add title" }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          FIELD_CLASSES,
          "text-4xl font-bold",
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
      // A title is one line. Confirmed against prosemirror-view's actual
      // EditorProps type (node_modules/prosemirror-view/dist/index.d.ts):
      // `handleKeyDown?: (this: P, view: EditorView, event: KeyboardEvent)
      // => boolean | void` — returning `true` tells ProseMirror the key was
      // handled, suppressing its default paragraph-split/line-break
      // behavior. `event.key === "Enter"` alone covers both bare Enter and
      // Shift+Enter: Shift is only a modifier flag on the event, not a
      // different `key` value, so one check catches both.
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter") return true;
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      debouncedCommit(editor.getHTML());
    },
    onFocus: ({ editor }) => {
      setActiveEditor(editor);
    },
    onBlur: ({ editor, event }) => {
      const toolbarEl = toolbarRef.current;
      const nextFocus = event.relatedTarget;
      const focusMovedIntoToolbar = !!(toolbarEl && nextFocus instanceof Node && toolbarEl.contains(nextFocus));
      if (focusMovedIntoToolbar || toolbarInteractingRef.current) {
        return;
      }
      setActiveEditor((current) => (current === editor ? null : current));
    },
  });

  return <EditorContent editor={editor} />;
}

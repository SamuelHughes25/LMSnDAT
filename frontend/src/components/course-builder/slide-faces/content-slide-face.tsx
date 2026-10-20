"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";
import DOMPurify from "dompurify";

import type { BoxTransform, ContentSlideLayout, PositionableField } from "@/lib/course-types";
import { FontFamily } from "@/lib/tiptap-font-family";
import { FontSize } from "@/lib/tiptap-font-size";
import { TextAlign } from "@/lib/tiptap-text-align";
import { Color } from "@/lib/tiptap-text-color";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";
import { useIsClient } from "@/lib/use-is-client";
import { cn, stripHtml } from "@/lib/utils";
import { useActiveEditorContext } from "../active-editor-context";
import { EditableImage } from "./image-field";
import { FreeformContentSlide } from "./freeform-content-slide";
import type { SlideFaceProps } from "./index";
import { PositionableBox } from "./positionable-box";
import { EditableTable } from "./table-field";

// Every interactive TipTap instance below (title and body alike) commits to
// the parent via a debounced onUpdate — ProseMirror owns its own DOM and
// keystroke-level state, so this only governs how often the network PATCH
// (routed through onTitleChange/onConfigChange, which course-builder.tsx
// wires to the updateSlide Server Action) actually fires, not how the
// editor itself feels while typing. The canvas mounts this component with
// key={slide.id} (see slide-canvas.tsx), so switching slides fully remounts
// it — any pending debounced call from the previously selected slide is
// cancelled by the hook's unmount cleanup rather than firing stale.
export const CHANGE_DEBOUNCE_MS = 500;

export const FIELD_CLASSES =
  "w-full resize-none border-none bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground/50 focus:rounded focus:outline-none focus:ring-1 focus:ring-primary/40";

// Every field's edit/static render now always sits inside a definite-size
// box (PositionableBox — either flex-determined or, once dragged/resized,
// absolutely positioned), unlike the old plain-flex-flow days. Both render
// paths need an explicit h-full w-full so they actually fill that box
// rather than shrinking to their own content height — see the note on
// <EditorContent> inside RichTextBody for the fuller explanation of why an
// *outer* wrapper needing this isn't automatic just because the box has a
// real size.
export const FILL_BOX = "h-full w-full";

// Title/subtitle are meant to stay genuinely one visual line — that's the
// whole point of suppressing Enter in useSingleLineSlideEditor below — but
// suppressing Enter only ever stopped a *hard* line break; nothing
// previously stopped the browser's default *soft* wrap once the text was
// wider than its box. That was invisible as long as these boxes only ever
// auto-sized to their content, but once they became resizable
// (positionable-box.tsx) a narrower box could wrap the text onto a second
// line that the box's own (fixed, resize-driven) height was never sized
// for, clipping it — the "text behaving weirdly" a resize could produce.
// nowrap + ellipsis keeps a long title truthfully one line at any box
// width: it never reflows, it just visibly truncates.
//
// The `!` (Tailwind v4's !important modifier) on white-space specifically
// is required, not decorative — confirmed via a real browser that without
// it, the computed white-space stayed "break-spaces" despite the plain
// `whitespace-nowrap` utility being present in the class list. ProseMirror
// ships its own base `.ProseMirror { white-space: ... }` rule, which has
// the exact same selector specificity as a Tailwind utility class; with
// specificity tied, whichever rule's stylesheet loads later in the
// cascade wins, and ProseMirror's happens to. !important sidesteps that
// race instead of depending on stylesheet load order.
const SINGLE_LINE_TYPOGRAPHY = "overflow-hidden text-ellipsis !whitespace-nowrap";

// A content slide renders via exactly ONE of two systems, branched on
// whether `slide.config.layout` is set at all (see SlideConfig.layout's own
// comment in course-types.ts for the full rationale — short version: no
// migration, zero regression risk for every slide that already existed
// before the freeform system was introduced).
//
//  - `layout` set -> everything below this check, the ORIGINAL fixed-field
//    system (title/subtitle/body/body2, nine hardcoded ContentSlideLayout
//    presets, box_transforms keyed by field NAME). Untouched by the
//    freeform work — every pre-existing slide keeps rendering exactly as
//    it always has.
//  - `layout` unset -> FreeformContentSlide (freeform-content-slide.tsx):
//    author-placed text_boxes[], ordered/stacked via object_order, a
//    single generic text-box component with none of this file's title-
//    specific special-casing (forced bold, single-line/nowrap, suppressed
//    Enter). This is what a brand-new content slide gets by default
//    (app/actions/courses.ts's defaultSlideConfig) and what a "Templates"
//    preset seeds into (properties-panel.tsx) — picking a template does
//    NOT set `layout` (that would re-enter the legacy branch below); it
//    just pre-populates text_boxes/object_order with a starting
//    arrangement that's ordinary, freely-editable freeform content from
//    that point on.
// Thin dispatcher, no hooks of its own — a condition picking between two
// sibling components, each with its own unconditional hooks, same pattern
// this file already uses for EditableBody/EditableTitle's mode dispatch
// just below (see that pair's own comment on why a condition has to select
// a whole component rather than branch mid-component: a hook can never be
// called conditionally, and LegacyContentSlide's box_transforms-syncing
// ref/effect below has no meaning for — and must never run for — a
// freeform slide).
export function ContentSlideFace(props: SlideFaceProps) {
  if (props.slide.config.layout == null) {
    return <FreeformContentSlide {...props} />;
  }
  return <LegacyContentSlide {...props} />;
}

function LegacyContentSlide(props: SlideFaceProps) {
  const { slide, mode, courseVersionId, onTitleChange, onConfigChange } = props;
  const layout: ContentSlideLayout = slide.config.layout ?? "title-body";
  // The percentage basis for every PositionableBox on this slide — the
  // slide's own top-level box below (whichever layout branch is active),
  // not something threaded down from slide-canvas.tsx. That div is
  // already exactly the full slide's size (percentages resolve against the
  // padding box, so `px-16 py-12` doesn't shrink the basis), so measuring
  // against it directly is equivalent and keeps this component
  // self-contained. Declared unconditionally (Rules of Hooks); harmless
  // for "static"/"present" modes, which never attach or read it.
  const slideRef = useRef<HTMLDivElement>(null);

  // box_transforms is one JSON value at the top level of config, not
  // deep-merged by course-builder.tsx's onConfigChange (which only merges
  // top-level SlideConfig keys — see its comment on why even that needed a
  // ref-based fix). Two DIFFERENT boxes dragged close together would
  // otherwise race the same way body-text-vs-image-paste once did: each
  // commit would spread the OTHER box's now-stale `slide.config.
  // box_transforms` from this render's closure. Mirroring course-builder's
  // fix at this narrower scope — a ref, updated eagerly and synchronously,
  // not the `slide` prop — closes that gap. This component remounts per
  // slide (key={slide.id} in slide-canvas.tsx), so there's no cross-slide
  // staleness to worry about — but a LAYOUT switch on the SAME slide does
  // NOT remount it, and properties-panel.tsx's layout picker clears
  // box_transforms on every switch (see its comment), so this ref has to
  // be explicitly re-synced when `layout` changes too, or it would
  // resurrect the old layout's now-cleared entries on the next drag. That
  // re-sync happens in an effect below, not inline here — this project's
  // lint rules (aligned with the React Compiler's assumptions) disallow
  // touching a ref's `.current` during render at all, full stop, even for
  // the classic "compare to a ref'd previous value" pattern — an effect is
  // the only place that's actually sanctioned for a ref write triggered by
  // a prop change.
  const boxTransformsRef = useRef(slide.config.box_transforms);
  useEffect(() => {
    boxTransformsRef.current = slide.config.box_transforms;
    // Deliberately keyed on `layout` alone, not `slide.config.box_transforms`
    // itself — this effect exists purely to re-sync after the layout
    // picker's clear, not to shadow every ordinary drag/resize commit
    // (those already update the ref directly and synchronously in
    // handleBoxTransform below; re-running this effect for those too would
    // be redundant, not incorrect, but the narrower dependency makes the
    // intent — "only layout switches reset this" — explicit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  function handleBoxTransform(field: PositionableField, transform: BoxTransform) {
    const next = { ...boxTransformsRef.current, [field]: transform };
    boxTransformsRef.current = next;
    onConfigChange?.({ box_transforms: next });
  }

  // Wraps titleNode/subtitle/body/body2 uniformly — see positionable-box.tsx
  // for what happens before vs. after a box has ever been dragged/resized.
  // key={`${field}-${layout}`}: forces a fresh PositionableBox instance on
  // every layout switch, not just a re-render — without it, React can and
  // does reconcile the "same" box across two layouts with structurally
  // similar JSX (e.g. title-only -> title-top: both just
  // `<div>{titleNode}</div>`), which would preserve PositionableBox's
  // internal measuredBaseline state from the OLD layout's flex position
  // instead of remeasuring the new one. Same "remount to guarantee a clean
  // slate" idea as key={slide.id} on the Face components in
  // slide-canvas.tsx, just one level down. `field` has to be part of the
  // key too, not just `layout` — title and body render as siblings under
  // the same layout, so `key={layout}` alone collided (two children with
  // the same key, e.g. both "title-body"), which is what happened the
  // first time this was written this way.
  function positioned(field: PositionableField, flexClassName: string | undefined, children: React.ReactNode) {
    return (
      <PositionableBox
        key={`${field}-${layout}`}
        fieldKey={field}
        slideId={slide.id}
        transform={slide.config.box_transforms?.[field]}
        onTransform={(t) => handleBoxTransform(field, t)}
        mode={mode}
        slideRef={slideRef}
        flexClassName={flexClassName}
      >
        {children}
      </PositionableBox>
    );
  }

  // Freely positionable on every layout — title never shares row space
  // with anything (not even image-left/image-right's picture, which sits
  // in a row below it), so making it draggable/resizable never has a
  // knock-on effect on any other element's flex sizing.
  const titleNode = positioned(
    "title",
    undefined,
    <EditableTitle
      fieldId={`${slide.id}:title`}
      value={slide.title}
      mode={mode}
      onCommit={(title) => onTitleChange?.(title)}
    />,
  );

  // The four title-page layouts (cover/section-divider slides, no body
  // text) are each their own branch rather than folded into one generic
  // "positioned title" path — the four are genuinely different arrangements
  // (centered vs. pinned top/bottom, with or without a subtitle), and a
  // shared abstraction over "where do the flex alignment classes go" would
  // end up harder to read than just writing out each one.
  if (layout === "title-only") {
    return (
      <div
        ref={slideRef}
        className="relative flex h-full w-full flex-col items-center justify-center px-16 py-12 text-center text-foreground"
      >
        {titleNode}
      </div>
    );
  }

  if (layout === "title-subtitle") {
    return (
      <div
        ref={slideRef}
        className="relative flex h-full w-full flex-col items-center justify-center gap-4 px-16 py-12 text-center text-foreground"
      >
        {titleNode}
        {positioned(
          "subtitle",
          undefined,
          <EditableSubtitle
            fieldId={`${slide.id}:subtitle`}
            value={slide.config.subtitle}
            mode={mode}
            onCommit={(subtitle) => onConfigChange?.({ subtitle })}
          />,
        )}
      </div>
    );
  }

  if (layout === "title-top") {
    return (
      <div ref={slideRef} className="relative flex h-full w-full flex-col justify-start px-16 py-12 text-foreground">
        {titleNode}
      </div>
    );
  }

  if (layout === "title-bottom") {
    return (
      <div ref={slideRef} className="relative flex h-full w-full flex-col justify-end px-16 py-12 text-foreground">
        {titleNode}
      </div>
    );
  }

  // "title-table": a title plus a structured table filling the rest of the
  // slide, in place of the free-form rich-text body every other "Text
  // page"/"Image page" layout uses. Its own branch (not folded into
  // bodyNodes below) since EditableTable takes a differently-shaped value
  // (TableConfig, not a sanitized-HTML string) and a differently-shaped
  // onCommit. The table itself isn't a text box, so it's not
  // positionable — stays fixed, same as before.
  if (layout === "title-table") {
    return (
      <div ref={slideRef} className="relative flex h-full w-full flex-col px-16 py-12 text-foreground">
        {titleNode}
        <div className="mt-8 min-h-0 flex-1">
          <EditableTable
            value={slide.config.table}
            mode={mode}
            onCommit={(table) => onConfigChange?.({ table })}
          />
        </div>
      </div>
    );
  }

  // "image-left"/"image-right": an uploaded image alongside a rich-text body
  // box, mirroring two-column's split row but with a picture on one side
  // instead of a second text field. Both share this one branch (rather than
  // being two separate `if`s like the title-page layouts above) since they
  // differ only in which side the image renders on — genuinely just a
  // left/right swap of the same two nodes, unlike the title-page layouts'
  // structurally different alignment.
  //
  // The body text here is deliberately NOT wrapped in PositionableBox,
  // unlike every other body/body2 below — it shares this row with the
  // image via flex-1 on both, and freeing it to drag away would leave the
  // image as the row's only flex-1 child, which would then resize to fill
  // the gap. That's exactly the "make text boxes interact with images"
  // outcome that was explicitly ruled out, so this one stays fixed.
  if (layout === "image-left" || layout === "image-right") {
    const imageNode = (
      <EditableImage
        value={slide.config.image_url}
        mode={mode}
        courseVersionId={courseVersionId}
        widthPct={slide.config.image_width_pct}
        heightPct={slide.config.image_height_pct}
        onCommit={(image_url) => onConfigChange?.({ image_url })}
        onResize={(image_width_pct, image_height_pct) =>
          onConfigChange?.({ image_width_pct, image_height_pct })
        }
        className="flex-1"
      />
    );
    const textNode = (
      <EditableBody
        fieldId={`${slide.id}:body`}
        value={slide.config.body}
        mode={mode}
        onCommit={(body) => onConfigChange?.({ body })}
        className="flex-1"
      />
    );
    return (
      <div ref={slideRef} className="relative flex h-full w-full flex-col px-16 py-12 text-foreground">
        {titleNode}
        <div className="mt-8 flex min-h-0 flex-1 gap-8">
          {layout === "image-left" ? (
            <>
              {imageNode}
              {textNode}
            </>
          ) : (
            <>
              {textNode}
              {imageNode}
            </>
          )}
        </div>
      </div>
    );
  }

  // "two-column" renders two genuinely separate text boxes side by side
  // (config.body / config.body2), not one field CSS-split into columns —
  // CSS `columns` only wraps text into a second column once it overflows
  // the container's height, so a short body would look identical to
  // "title-body" and the layout picker would appear to do nothing. Neither
  // shares row space with anything but each other (no image here), so
  // both are freely positionable.
  //
  // CSS grid, not flex, for the row — this is what actually keeps the two
  // boxes from interacting once one of them is dragged. With flex-1 on
  // both (the original approach), dragging body2 away (removing it from
  // flow, same as an image being removed from a flex row would) left body
  // as the row's only flex-1 child, which duly grew to claim the vacated
  // space — confirmed via a real browser: body's width jumped from 400px
  // to 832px the moment body2 was dragged out, despite body itself never
  // being touched. A grid's `grid-template-columns: 1fr 1fr` defines two
  // fixed-width column tracks regardless of how many items are actually
  // present in them, so removing one box from flow leaves the other's
  // track — and therefore its width — completely untouched.
  const bodyNodes =
    layout === "two-column" ? (
      <div className="mt-8 grid h-full min-h-0 flex-1 grid-cols-2 gap-8">
        {positioned(
          "body",
          undefined,
          <EditableBody
            fieldId={`${slide.id}:body`}
            value={slide.config.body}
            mode={mode}
            onCommit={(body) => onConfigChange?.({ body })}
          />,
        )}
        {positioned(
          "body2",
          undefined,
          <EditableBody
            fieldId={`${slide.id}:body2`}
            value={slide.config.body2}
            mode={mode}
            onCommit={(body2) => onConfigChange?.({ body2 })}
          />,
        )}
      </div>
    ) : (
      positioned(
        "body",
        "mt-8 min-h-0 flex-1",
        <EditableBody
          fieldId={`${slide.id}:body`}
          value={slide.config.body}
          mode={mode}
          onCommit={(body) => onConfigChange?.({ body })}
        />,
      )
    );

  return (
    <div ref={slideRef} className="relative flex h-full w-full flex-col px-16 py-12 text-foreground">
      {titleNode}
      {bodyNodes}
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
  fieldId,
  value,
  mode,
  onCommit,
  className,
}: {
  fieldId: string;
  value: string | undefined;
  mode: SlideFaceProps["mode"];
  onCommit: (value: string) => void;
  className?: string;
}) {
  if (mode === "edit") {
    return <RichTextBody fieldId={fieldId} value={value} onCommit={onCommit} className={cn(FILL_BOX, className)} />;
  }
  return (
    <StaticField value={value} placeholder="Click to add text" className={cn(BODY_TYPOGRAPHY, FILL_BOX, className)} />
  );
}

// Same dispatch shape as EditableBody above, for the on-canvas slide title.
// Kept as a separate sibling (not folded into EditableBody with a "isTitle"
// flag) because the two fields genuinely differ in extensions, typography,
// and placeholder copy — a shared component would just be an if/else wearing
// a trenchcoat.
function EditableTitle({
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
    return <RichTextTitle fieldId={fieldId} value={value} onCommit={onCommit} className={FILL_BOX} />;
  }
  return (
    <StaticField
      value={value}
      placeholder="Click to add title"
      className={cn(FILL_BOX, SINGLE_LINE_TYPOGRAPHY, "text-4xl font-bold")}
    />
  );
}

// Same dispatch shape again, for the "title-subtitle" layout's subtitle
// field — used only by that one layout (see ContentSlideFace above).
function EditableSubtitle({
  fieldId,
  value,
  mode,
  onCommit,
}: {
  fieldId: string;
  value: string | undefined;
  mode: SlideFaceProps["mode"];
  onCommit: (value: string) => void;
}) {
  if (mode === "edit") {
    return <RichTextSubtitle fieldId={fieldId} value={value} onCommit={onCommit} className={FILL_BOX} />;
  }
  return (
    <StaticField
      value={value}
      placeholder="Click to add subtitle"
      className={cn(FILL_BOX, SINGLE_LINE_TYPOGRAPHY, "text-xl text-muted-foreground")}
    />
  );
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
// The p:empty:before rule below fixes a real, reported bug: a
// blank line (an author pressing Enter with nothing typed on it, used to
// put visual space between two blocks — e.g. two separate bullet lists)
// shows up as a genuinely empty `<p></p>` once saved — ProseMirror's own
// EDITOR rendering gives every empty paragraph a synthetic
// `<br class="ProseMirror-trailingBreak">` so it still occupies a real
// line's height on screen, but that `<br>` is a live rendering artifact,
// never part of `editor.getHTML()`'s output. The static render path
// (this class's other user — thumbnails, Preview, the actual learner-
// facing viewer) has no equivalent trick, so the exact same stored HTML
// collapses that blank line to zero height there: confirmed via a real
// side-by-side comparison, a blank line between two bullet lists was
// clearly visible in the builder and completely gone in Preview. A
// non-breaking space in a `::before` pseudo-element is the standard,
// long-supported fix for "give an empty block real line-height" — same
// idea as a literal `&nbsp;` character, without needing to rewrite any
// already-saved content.
// overflow-hidden, not overflow-y-auto — a scrollbar appearing on a text
// box was reported directly as looking wrong ("in weird scenarios they
// show up and it looks shite"): this app's canvas is a fixed-size,
// WYSIWYG-style surface (not a scrolling document), so a box whose
// content overflows its own bounds should behave the same way every
// other positioned/resized box on the canvas already does — clip
// silently — rather than sprouting a scrollbar that never appears in the
// builder's own thumbnail/Preview render of the same box anyway (static
// mode has never scrolled; only the live edit-mode textarea could).
export const BODY_TYPOGRAPHY =
  "h-full overflow-hidden text-lg leading-relaxed [&_p]:my-0 [&_p:empty]:before:content-['\\00a0'] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-0.5";

// A second, genuinely different bug behind the same user-visible report
// ("blank lines don't survive") — this one has nothing to do with
// rendering (BODY_TYPOGRAPHY's own `:empty` fix above already handles a
// blank line the author creates by pressing Enter twice while typing).
// This one is about PASTING multi-line text (drafted elsewhere — Word,
// an email, a text file — then pasted in, a completely ordinary way to
// author course content). Confirmed by reading prosemirror-view's own
// default plain-text clipboard parser directly
// (node_modules/prosemirror-view/dist/index.js, parseFromClipboard):
// it splits pasted text on `/(?:\r\n?|\n)+/` — ANY run of one or more
// line breaks collapses to a SINGLE split point. That means "A\n\nB"
// (one blank line) and "A\n\n\nB" (two blank lines) both produce the
// exact same two paragraphs, "A" and "B" — the blank line is consumed
// entirely as a paragraph separator and never becomes a paragraph (empty
// or otherwise) at all. No amount of fixing *rendering* can help here —
// the blank line is already gone before a single paragraph node exists.
//
// The fix: a `transformPastedText` hook (a real ProseMirror EditorProps
// hook, confirmed against prosemirror-view's own .d.ts) runs on the raw
// pasted string BEFORE that default splitter does. For every run of 2+
// line breaks (i.e. at least one genuine blank line), this re-inserts a
// lone non-breaking-space "line" in place of each blank line — turning
// "A\n\nB" into "A\n \nB" before the default splitter ever sees it,
// which now produces THREE paragraphs ("A", " ", "B") since none of
// those three gaps collapses into another. The middle paragraph isn't
// technically :empty (it holds one nbsp character), but that's exactly
// the point — a visible character gives it real height on its own, no
// extra CSS needed, and it reads identically to an author-typed blank
// line either way.
export function preserveBlankLinesInPastedText(text: string): string {
  return text.replace(/(?:\r\n|\r|\n){2,}/g, (run) => {
    const lineBreakCount = (run.match(/\r\n|\r|\n/g) ?? []).length;
    return "\n" + " \n".repeat(lineBreakCount - 1);
  });
}

// A THIRD, again genuinely different cause behind the same "blank lines
// don't survive outside the builder" report — found by inspecting a
// real author's actual saved content rather than another synthetic
// test case. Real authored paragraphs there looked like
// `<p>Some text<br></p>` — a trailing `<br>` as a paragraph's LAST
// child, not a separate empty `<p>`. Confirmed via a side-by-side
// screenshot: the builder's own contenteditable rendering visibly
// shows that trailing `<br>` as a second, blank line within the same
// paragraph (a well-known contenteditable browser quirk — effectively
// the same phenomenon as the synthetic ProseMirror-trailingBreak an
// EMPTY paragraph gets, just triggered by a real, saved `<br>` instead
// of a live-only rendering artifact this time). Plain static HTML has
// no such accommodation: a `<br>` with nothing after it inside a block
// contributes zero extra height there, by ordinary browser convention
// — so the exact same markup that visibly took two lines in the
// builder collapses to one line the moment it's rendered via
// dangerouslySetInnerHTML anywhere else (thumbnails, Preview, the
// learner-facing viewer).
//
// The fix splits each trailing `<br>` (or run of them) off into its
// own paragraph holding a non-breaking space, which — same as the
// paste fix's placeholder line above — gets real visible height on
// its own with no further CSS needed. Runs only on the SANITIZED
// string (after DOMPurify), so it can't itself introduce anything
// DOMPurify would have stripped.
function expandTrailingBreaks(html: string): string {
  return html.replace(/(?:<br\s*\/?>\s*)+<\/p>/gi, (match) => {
    const breakCount = (match.match(/<br\s*\/?>/gi) ?? []).length;
    return "</p>" + "<p> </p>".repeat(breakCount);
  });
}

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
export function StaticField({
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
  const sanitized = isClient ? expandTrailingBreaks(DOMPurify.sanitize(value ?? "")) : "";
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
  fieldId,
  value,
  onCommit,
  className,
}: {
  fieldId: string;
  value: string | undefined;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const { focusEditor, blurEditor, panelRef, panelInteractingRef, panelPointerDownRef, lastFontFamilyRef } =
    useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);
  // See free-text-box.tsx's identical ref for why this has to guard an
  // onFocus-time application, not an onCreate-time one.
  const appliedRememberedFontRef = useRef(false);

  const editor = useEditor({
    // SSR would otherwise print a "Tiptap Error: SSR has been detected"
    // warning and risk a hydration mismatch — this component only ever
    // needs to exist once mounted in the browser.
    immediatelyRender: false,
    // @tiptap/react v3 defaults this to false (a breaking change from v2,
    // where every transaction forced a re-render) — without it, a
    // selection-only change (clicking into different text, highlighting a
    // different run) never re-renders TextFormattingControls, so its Font/
    // Size/Color readouts go stale until something ELSE happens to
    // re-render this subtree (e.g. actually applying a format, which also
    // changes content and so triggers the parent's own onUpdate-driven
    // re-render). Confirmed as the mechanism behind a reported bug: the
    // Font dropdown would claim text was still "Geist" right after
    // selecting text that visibly wasn't, until the FIRST format change
    // forced a real re-render and the readout caught up.
    shouldRerenderOnTransaction: true,
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
      FontFamily,
      TextAlign,
      Color,
      // See free-text-box.tsx's identical fix for why this checks
      // `editor.isEmpty` rather than passing a plain string — a plain
      // string placeholder decorates whichever paragraph the cursor is
      // CURRENTLY in whenever that one's empty, so it kept showing on a
      // freshly-created second line even after the box's first line had
      // real text in it.
      Placeholder.configure({ placeholder: ({ editor }) => (editor.isEmpty ? "Click to add text" : "") }),
    ],
    editorProps: {
      attributes: {
        // Placeholder (@tiptap/extension-placeholder) stamps an `is-empty`
        // class + `data-placeholder` attribute onto the empty paragraph
        // node itself, not a `:empty` state on this wrapper div — so the
        // old field's `empty:before:content-[attr(data-placeholder)])`
        // pattern doesn't apply here; this targets the node the extension
        // actually decorates instead.
        //
        // `className` deliberately does NOT go here — see the comment on
        // <EditorContent> below for why a layout class like "flex-1" has to
        // land on a different element entirely.
        class: cn(
          FIELD_CLASSES,
          BODY_TYPOGRAPHY,
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
      // See preserveBlankLinesInPastedText's own comment for why this is
      // needed — pasting multi-line content (not typing it) is the other
      // half of "blank lines don't survive" that BODY_TYPOGRAPHY's :empty
      // CSS rule alone can't fix.
      transformPastedText: (text) => preserveBlankLinesInPastedText(text),
    },
    onUpdate: ({ editor }) => {
      debouncedCommit(editor.getHTML());
    },
    onFocus: ({ editor }) => {
      focusEditor(fieldId, editor);
      // See free-text-box.tsx's identical onFocus for the full
      // reasoning — applies the author's last-picked font
      // (active-editor-context.tsx's lastFontFamilyRef) the first time
      // a genuinely fresh/empty body is focused, never to one that
      // already has real saved content. Deliberately onFocus, not
      // onCreate: a stored mark set at creation time doesn't survive
      // the selection change focusing the box itself causes.
      if (!appliedRememberedFontRef.current && editor.isEmpty && lastFontFamilyRef.current) {
        appliedRememberedFontRef.current = true;
        editor.chain().setFontFamily(lastFontFamilyRef.current).run();
      }
    },
    // See active-editor-context.tsx's blurEditor for why this is safe against
    // focus/blur races between the two-column layout's two editors.
    //
    // Guarded two ways, because clicking a properties-panel control blurs
    // this editor too, and without a guard that would clear `activeEditor`
    // right as the user tries to use it:
    //  1. `relatedTarget` (the element about to receive focus) inside the
    //     panel's own DOM node — covers plain buttons (Bold/Italic/etc.),
    //     which stay focus-neutral thanks to their onMouseDown preventDefault,
    //     so relatedTarget here is really just a belt-and-suspenders check.
    //  2. `panelInteractingRef` — covers the font-size Select, which doesn't
    //     just focus its trigger: Base UI opens it straight to a listbox
    //     *item*, focusing that item directly, and that item is rendered in
    //     a portal outside the panel's DOM subtree entirely — confirmed by
    //     instrumenting this handler and inspecting the actual relatedTarget
    //     during a real open, not assumed. A DOM-containment check can't see
    //     into a portal it doesn't know the location of, so any such control
    //     instead sets this ref directly (see text-object-properties.tsx)
    //     whenever it's opening/open, sidestepping the portal question
    //     entirely in favor of explicit "we're mid-interaction" state.
    onBlur: ({ editor, event }) => {
      // Unconditional, and first — see use-debounced-callback.ts's own
      // comment for why a pending debounced commit must flush on every
      // blur, not just the ones that go on to call blurEditor below.
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

  // `className` (e.g. "flex-1" for two-column, or FILL_BOX for a box
  // wrapped in PositionableBox) goes on <EditorContent> itself, not inside
  // editorProps.attributes.class above. EditorContent renders its own
  // wrapper <div {...rest} /> and then appends the real ProseMirror element
  // (editor.view.dom, the one editorProps.attributes.class decorates) as
  // that wrapper's child — so the wrapper, not the ProseMirror div, is the
  // element that actually needs to fill whatever box contains it. Putting a
  // sizing class on the ProseMirror div instead (the original bug here, for
  // the old two-column layout) styled an element with no bearing on that:
  // the real layout participant was left at the browser's unstyled default
  // (`flex: 0 1 auto` in a flex row, or shrink-to-fit height inside
  // PositionableBox's percentage-height wrapper), which for the flex case
  // meant it shrink-wrapped to whatever had been typed so far (the column
  // "locking" to a sliver on the first space/word), and for the
  // PositionableBox case means the box's declared size wouldn't visibly
  // apply — the editor would just snap back to its own content height.
  return <EditorContent editor={editor} className={className} />;
}

// Shared by every single-line field on this face (title, subtitle) — a
// TipTap instance sharing SlideTextToolbar with RichTextBody above (that's
// the whole point: selecting part of a title/subtitle pops up the same
// Bold/Italic/Underline/list/font-size toolbar as selecting part of the
// body does), so its focus/blur wiring is identical to RichTextBody's — see
// the comments there for why the toolbarRef/toolbarInteractingRef guards on
// onBlur exist.
//
// Differs from RichTextBody in exactly three ways: the placeholder copy and
// typography class are caller-supplied instead of BODY_TYPOGRAPHY (each
// field's default, unformatted look is unchanged from its old plain
// <input>), and `editorProps.handleKeyDown` below, which is what actually
// keeps every caller of this hook a single line.
//
// Judgment call: this does NOT also disable bulletList/orderedList in the
// StarterKit config below (they're left exactly as RichTextBody configures
// them). A selection here can still, in principle, be toggled into a
// bullet/numbered list via the shared toolbar — it won't create a second
// line (Enter is still suppressed), just wrap the single line in a list
// marker, which is a cosmetic edge case the brief didn't ask about, not a
// correctness violation of "single line." Deliberately not touching
// StarterKit's list config to avoid an orphaned-schema risk (disabling
// bulletList/orderedList while leaving listItem enabled, or vice versa) for
// a case that wasn't requested.
function useSingleLineSlideEditor({
  fieldId,
  value,
  onCommit,
  typographyClass,
  placeholder,
}: {
  fieldId: string;
  value: string;
  onCommit: (value: string) => void;
  typographyClass: string;
  placeholder: string;
}) {
  const { focusEditor, blurEditor, panelRef, panelInteractingRef, panelPointerDownRef, lastFontFamilyRef } =
    useActiveEditorContext();
  const debouncedCommit = useDebouncedCallback(onCommit, CHANGE_DEBOUNCE_MS);
  // See free-text-box.tsx's identical ref for why this has to guard an
  // onFocus-time application, not an onCreate-time one.
  const appliedRememberedFontRef = useRef(false);

  return useEditor({
    immediatelyRender: false,
    // See the other useEditor() call in this file for why this is needed —
    // same TipTap v3 default-changed issue, same fix.
    shouldRerenderOnTransaction: true,
    editable: true,
    // Pre-existing rows may hold plain text with no wrapping tags (rows
    // written before TipTap replaced the old plain <input>s) — ProseMirror's
    // HTML parser auto-wraps loose top-level text into a paragraph the same
    // way it would `<p>...</p>`, so this needs no special-casing (see the
    // comment on `Slide.title` in course-types.ts).
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
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: cn(
          FIELD_CLASSES,
          typographyClass,
          "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/50 [&_.is-empty]:before:content-[attr(data-placeholder)]",
        ),
      },
      // Confirmed against prosemirror-view's actual EditorProps type
      // (node_modules/prosemirror-view/dist/index.d.ts):
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
      focusEditor(fieldId, editor);
      // See free-text-box.tsx's identical onFocus for the full
      // reasoning — applies the author's last-picked font
      // (active-editor-context.tsx's lastFontFamilyRef) the first time
      // a genuinely fresh/empty title or subtitle is focused, never to
      // one that already has real saved content. Deliberately onFocus,
      // not onCreate: a stored mark set at creation time doesn't
      // survive the selection change focusing the box itself causes.
      if (!appliedRememberedFontRef.current && editor.isEmpty && lastFontFamilyRef.current) {
        appliedRememberedFontRef.current = true;
        editor.chain().setFontFamily(lastFontFamilyRef.current).run();
      }
    },
    onBlur: ({ editor, event }) => {
      // Unconditional, and first — see use-debounced-callback.ts's own
      // comment for why a pending debounced commit must flush on every
      // blur, not just the ones that go on to call blurEditor below.
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
}

function RichTextTitle({
  fieldId,
  value,
  onCommit,
  className,
}: {
  fieldId: string;
  value: string;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const editor = useSingleLineSlideEditor({
    fieldId,
    value,
    onCommit,
    typographyClass: cn(SINGLE_LINE_TYPOGRAPHY, "text-4xl font-bold"),
    placeholder: "Click to add title",
  });

  return <EditorContent editor={editor} className={className} />;
}

// Used only by the "title-subtitle" layout — same single-line mechanics as
// RichTextTitle, just smaller/muted typography and different placeholder
// copy, so it reads as secondary text (a byline/name/date) rather than a
// second title.
function RichTextSubtitle({
  fieldId,
  value,
  onCommit,
  className,
}: {
  fieldId: string;
  value: string | undefined;
  onCommit: (value: string) => void;
  className?: string;
}) {
  const editor = useSingleLineSlideEditor({
    fieldId,
    value: value ?? "",
    onCommit,
    typographyClass: cn(SINGLE_LINE_TYPOGRAPHY, "text-xl text-muted-foreground"),
    placeholder: "Click to add subtitle",
  });

  return <EditorContent editor={editor} className={className} />;
}

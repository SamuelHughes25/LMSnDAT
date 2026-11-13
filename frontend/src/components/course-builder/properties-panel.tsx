"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  Minus,
  PaintBucket,
  Shapes,
  Square,
  Star,
  Trash2,
  Triangle,
  TriangleAlert,
  Type,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DEFAULT_SLIDE_TITLE, SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type {
  ContentSlideLayout,
  Lesson,
  PositionableField,
  ShapeKind,
  Slide,
  SlideConfig,
  SlideType,
} from "@/lib/course-types";
import { cn, stripHtml } from "@/lib/utils";
import { useActiveEditorContext, useForceRerenderOnEditorTransaction } from "./active-editor-context";
import { ColorPicker } from "./color-picker";
import { FreeTextBoxProperties } from "./free-text-box-properties";
import { ImageObjectProperties } from "./image-object-properties";
import { LessonProperties } from "./lesson-properties";
import { useObjectPlacement } from "./object-placement-context";
import { usePaintBucket } from "./paint-bucket-context";
import { ShapeObjectProperties } from "./shape-object-properties";
import { BackgroundFillControl, FreeformAddImageControl, SlideBackgroundPanel } from "./slide-background-panel";
import { SlideLayersPanel } from "./slide-layers-panel";
import { TextFormattingControls } from "./text-formatting-controls";
import { TextObjectProperties } from "./text-object-properties";

// The 5 basic shapes + 4 icon kinds offered from the Tools row's two
// One merged "Add shape" button/dropdown (same convention as most other
// apps' shape tools — one button, sectioned popup — rather than a
// separate button per section), sectioned by this array so a future
// section (arrows/connectors, callouts, whatever comes next) is a new
// entry here, not a new button or a rewrite of the dropdown JSX.
const SHAPE_SECTIONS: { label: string; options: { kind: ShapeKind; label: string; icon: typeof Type }[] }[] = [
  {
    label: "Shapes",
    options: [
      { kind: "rectangle", label: "Rectangle", icon: Square },
      { kind: "ellipse", label: "Ellipse", icon: Circle },
      { kind: "triangle", label: "Triangle", icon: Triangle },
      { kind: "line", label: "Line", icon: Minus },
      { kind: "arrow", label: "Arrow", icon: ArrowRight },
    ],
  },
  {
    label: "Icons",
    options: [
      { kind: "icon-check", label: "Checkmark", icon: Check },
      { kind: "icon-star", label: "Star", icon: Star },
      { kind: "icon-arrow-right", label: "Arrow right", icon: ArrowRight },
      { kind: "icon-warning-triangle", label: "Warning triangle", icon: TriangleAlert },
    ],
  },
];

// Interactive/assessment slide types whose text fields were converted from
// plain <input>/<textarea> to WidgetEditableText (widget-text-field.tsx) —
// see that component's own top-of-file comment for which two slide types
// (missing_word, and the plain-data table inside `content`) were
// deliberately excluded and why. These slide types have no "selectable
// object" concept at all (slide-selection-context never produces anything
// but a bare `{kind:"slide"}` for them — no draggable/positionable boxes to
// select), so the ONLY way the panel can know a text field is focused is by
// watching activeEditorId, which is exactly what SlideProperties' own
// widget-text branch below does.
const WIDGET_TEXT_SLIDE_TYPES: ReadonlySet<SlideType> = new Set([
  "multiple_choice",
  "accordion",
  "flashcards",
  "match_pairs",
  "sequencing",
  "hotspot_image",
]);

// What's currently selected WITHIN a slide (see slide-selection-context.tsx's
// selectedId, parsed by course-builder.tsx) — independent of which SLIDE is
// selected (the "slide" kind below already covers that). Only ever paired
// with `kind: "object"`.
export type SelectedObject =
  | { type: "text"; field: PositionableField }
  | { type: "background-image" }
  | { type: "extra-image"; imageId: string }
  // A freeform content slide's own text_boxes[] entry (see course-types.ts's
  // FreeTextBox) — deliberately a distinct variant from `{type:"text"}`
  // above rather than reusing it with a widened `field` type: the legacy
  // variant addresses one of a CLOSED set of named fields
  // (title/subtitle/body/body2), this one addresses an open-ended,
  // user-created id, and the two selection-id schemes
  // (`${slideId}:${field}` vs `${slideId}:text:${boxId}`) are genuinely
  // different shapes, not just a type-level widening.
  | { type: "free-text"; boxId: string }
  // A freeform content slide's own shapes[] entry (see course-types.ts's
  // ShapeObject) — covers both drawn shapes and icon glyphs, same single
  // SlideObjectRef variant reasoning as there.
  | { type: "shape"; shapeId: string };

export type PropertiesPanelProps =
  | { kind: "empty" }
  | {
      kind: "lesson";
      lesson: Lesson;
      onDescriptionChange: (description: string) => void;
      onDelete: () => void;
    }
  | {
      kind: "slide";
      slide: Slide;
      // Needed only for the "Edit" section's background-image upload
      // (SlideBackgroundPanel) — see courseVersionId's own comment on
      // SlideFaceProps in slide-faces/index.ts for why an upload needs to
      // know which draft's asset library to attach to.
      courseVersionId: string;
      // Deliberately a *partial config*, not `Partial<Slide>` merged here
      // against `slide.config` — that used to be exactly this component's
      // job (`{ config: { ...slide.config, layout } }`), and it was a real
      // bug: `slide` is a prop snapshot from whenever this component last
      // rendered, so spreading it right before a network PATCH raced with
      // any other in-flight config change (e.g. body text still mid-
      // debounce-commit) and silently discarded it. The merge now happens
      // once, in course-builder.tsx's handleSlideConfigChange, inside a
      // setLessons functional updater — the only place that's guaranteed
      // to see the truly current config no matter how close together two
      // changes happen.
      onConfigChange: (config: Partial<SlideConfig>) => void;
      // Only needed for the layout picker's "switching templates wipes the
      // slide" confirmation below — a full wipe has to clear the title too,
      // and title lives on the Slide itself, not in config (see
      // course-builder.tsx's handleSlideChange vs. handleSlideConfigChange).
      onTitleChange: (title: string) => void;
      onDelete: () => void;
    }
  | {
      kind: "object";
      slide: Slide;
      object: SelectedObject;
      courseVersionId: string;
      onConfigChange: (config: Partial<SlideConfig>) => void;
    };

export function PropertiesPanel(props: PropertiesPanelProps) {
  if (props.kind === "empty") {
    // Course-level settings (e.g. transition_style) land here in a later
    // stage — this is intentionally just an empty state for now.
    return (
      <div className="flex h-40 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Select a lesson or slide to edit its properties.
      </div>
    );
  }

  if (props.kind === "lesson") {
    // h-full overflow-y-auto — the panel's own outer wrapper
    // (course-builder.tsx's panelRef div) no longer scrolls itself (see
    // SlideProperties below for why: it needs to pin a few controls to its
    // own bottom instead), so every OTHER view rendered through here now
    // owns its own scrolling instead of relying on that wrapper's.
    return (
      <div className="h-full overflow-y-auto">
        <LessonProperties
          lesson={props.lesson}
          onDescriptionChange={props.onDescriptionChange}
          onDelete={props.onDelete}
        />
      </div>
    );
  }

  if (props.kind === "object") {
    let content: React.ReactNode;
    if (props.object.type === "text") {
      content = <TextObjectProperties slide={props.slide} field={props.object.field} onConfigChange={props.onConfigChange} />;
    } else if (props.object.type === "free-text") {
      content = (
        <FreeTextBoxProperties slide={props.slide} boxId={props.object.boxId} onConfigChange={props.onConfigChange} />
      );
    } else if (props.object.type === "background-image") {
      content = (
        <ImageObjectProperties
          kind="background"
          slide={props.slide}
          courseVersionId={props.courseVersionId}
          onConfigChange={props.onConfigChange}
        />
      );
    } else if (props.object.type === "shape") {
      content = (
        <ShapeObjectProperties slide={props.slide} shapeId={props.object.shapeId} onConfigChange={props.onConfigChange} />
      );
    } else {
      content = (
        <ImageObjectProperties
          kind="extra"
          imageId={props.object.imageId}
          slide={props.slide}
          courseVersionId={props.courseVersionId}
          onConfigChange={props.onConfigChange}
        />
      );
    }
    return <div className="h-full overflow-y-auto">{content}</div>;
  }

  return (
    <SlideProperties
      slide={props.slide}
      courseVersionId={props.courseVersionId}
      onConfigChange={props.onConfigChange}
      onTitleChange={props.onTitleChange}
      onDelete={props.onDelete}
    />
  );
}

// True once anything has actually been typed/uploaded onto this slide — the
// gate for the layout picker's "switching will delete your content" warning
// below. Checked against the fields a content slide's layouts actually use
// (title, subtitle, body/body2, the image-left/right picture, the
// title-table table); deliberately NOT background_image_url — that's a
// cross-cutting per-slide setting independent of layout (see its own
// comment in course-types.ts and in SlideBackgroundPanel below), not part
// of "this template's content," and switching templates doesn't touch it
// either (see applyLayoutChange), so it shouldn't be what triggers a warning
// about doing so.
//
// stripHtml (a real DOM-based tag strip, not a regex) is what StaticField
// already uses to tell "genuinely empty" apart from TipTap's `<p></p>`
// round-trip of a field that was typed into and then fully cleared — same
// reasoning applies here: a config.body of `"<p></p>"` is not content.
//
// slide.title is checked against DEFAULT_SLIDE_TITLE, not just against
// "" — every slide is created with a real, non-empty title ("New slide",
// see app/actions/courses.ts's createSlide), so the plain hasText() check
// alone treated an untouched, freshly-created slide as already having
// content. Confirmed via a real browser: switching a brand-new slide's
// layout the very first time always warned about losing content that was
// never actually authored, purely because of this untouched default —
// and only the first time, since applying a switch resets the title to
// "" (see applyLayoutChange below), at which point the plain empty-string
// check alone starts working correctly for every switch after that.
function hasSlideContent(slide: Slide): boolean {
  const hasText = (v: string | undefined) => !!v && stripHtml(v).trim().length > 0;
  if (slide.title !== DEFAULT_SLIDE_TITLE && hasText(slide.title)) return true;
  if (hasText(slide.config.subtitle)) return true;
  if (hasText(slide.config.body)) return true;
  if (hasText(slide.config.body2)) return true;
  if (slide.config.image_url) return true;
  const table = slide.config.table;
  if (table) {
    if (table.headers.some((h) => h.trim().length > 0)) return true;
    if (table.rows.some((row) => row.some((cell) => cell.trim().length > 0))) return true;
  }
  return false;
}

function SlideProperties({
  slide,
  courseVersionId,
  onConfigChange,
  onTitleChange,
  onDelete,
}: {
  slide: Slide;
  courseVersionId: string;
  onConfigChange: (config: Partial<SlideConfig>) => void;
  onTitleChange: (title: string) => void;
  onDelete: () => void;
}) {
  // The layout the confirmation dialog is asking about switching TO — null
  // means the dialog is closed. Only ever set when hasSlideContent(slide)
  // is true at click time; see handleLayoutChangeRequest.
  const [pendingLayout, setPendingLayout] = useState<ContentSlideLayout | null>(null);
  const { startPlacing } = useObjectPlacement();
  const { armedColor, armBucket, disarmBucket } = usePaintBucket();

  // Widget-type slides (see WIDGET_TEXT_SLIDE_TYPES above) have no
  // "selectable object" concept — their text fields live directly in the
  // widget's own fixed layout, never a draggable/positionable box — so the
  // only way this panel can offer text formatting for them is by watching
  // which editor currently has focus and checking it belongs to THIS slide
  // (its fieldId starts with `${slide.id}:`, the same convention every
  // other field id in this app already uses).
  const isWidgetTextSlide = WIDGET_TEXT_SLIDE_TYPES.has(slide.slide_type);
  const { activeEditor, activeEditorId, panelInteractingRef } = useActiveEditorContext();
  const widgetFieldEditor =
    isWidgetTextSlide && activeEditorId?.startsWith(`${slide.id}:`) ? activeEditor : null;
  useForceRerenderOnEditorTransaction(widgetFieldEditor);

  // The actual switch: resets every layout-scoped field to its blank state
  // (not just box_transforms, which the picker always cleared even before
  // this confirmation existed) and applies the new layout, so the slide
  // ends up looking exactly like a freshly-added slide in that layout — "an
  // empty template," per the request. Title resets to DEFAULT_SLIDE_TITLE,
  // not "" — a truly fresh slide (app/actions/courses.ts's createSlide)
  // starts with that same literal title, not an empty one, so resetting to
  // "" here would leave a wiped slide looking subtly different from (and
  // triggering the layout picker's own hasSlideContent check differently
  // than) a genuinely new one — the exact inconsistency that surfaced as a
  // false "you'll lose content" warning the first time a brand-new slide's
  // layout was switched. image_url is set to `null` (removed) rather than
  // left `undefined`, matching how EditableImage's own Remove button clears
  // it — image_width_pct/height_pct are left as `undefined` rather than a
  // literal removed marker, same as an image that was simply never resized.
  function applyLayoutChange(layout: ContentSlideLayout) {
    onTitleChange(DEFAULT_SLIDE_TITLE);
    onConfigChange({
      layout,
      box_transforms: undefined,
      subtitle: undefined,
      body: undefined,
      body2: undefined,
      image_url: null,
      image_width_pct: undefined,
      image_height_pct: undefined,
      table: undefined,
    });
  }

  function handleLayoutChangeRequest(layout: ContentSlideLayout) {
    if (layout === (slide.config.layout ?? "title-body")) return;
    if (!hasSlideContent(slide)) {
      applyLayoutChange(layout);
      return;
    }
    setPendingLayout(layout);
  }

  const isImageLayout =
    slide.slide_type === "content" &&
    (slide.config.layout === "image-left" || slide.config.layout === "image-right");
  const isFreeformContent = slide.slide_type === "content" && slide.config.layout == null;

  // Three controls pinned to the panel's own bottom, stacked (Layers on
  // top, then the image dropbox, then Delete slide at the very bottom) —
  // reported directly as a real gap when they lived in the normal
  // scrolling flow above: on a slide with much content in the scrollable
  // section, Delete slide (and the image dropbox, and the layers list)
  // could end up scrolled well out of view, unreachable without first
  // scrolling all the way down. Pinning them here means they're always
  // exactly where the author expects them, regardless of how much is
  // above. shrink-0 (not part of the flex-1 scrollable area below) is what
  // makes the pinning real rather than just visual — see this component's
  // own root className for the flex-column split this depends on.
  const pinnedBottom = (
    <div className="shrink-0 space-y-3 border-t border-border p-3">
      {isFreeformContent && <SlideLayersPanel slide={slide} onConfigChange={onConfigChange} />}

      {/* Cross-cutting, every slide_type — same tier as the image
          controls just below. See BackgroundFillControl's own comment. */}
      <BackgroundFillControl fill={slide.config.background_fill} onConfigChange={onConfigChange} />

      {/* Unlike the layout picker above, this section applies to every
          slide_type — a background image (and, planned next, a background
          color) is cross-cutting styling, not something specific to
          "content" slides. See course-types.ts's note on
          ContentSlideLayout for why this lives here instead of being a
          layout option.

          Hidden specifically for "image-left"/"image-right", the two
          layouts that already have their OWN dedicated on-canvas picture
          box: a caption here explaining the two fields are different
          (an earlier attempt at this fix) wasn't enough — confirmed by a
          real user hitting this exact mix-up again after it shipped, so
          the actual fix is removing the second, redundant "paste an
          image" control in the one situation where its near-identical
          wording collides with a different, more obviously-the-one-you-
          want box sitting right there in the canvas. Every other layout
          has no on-canvas picture of its own, so this stays the only way
          to add an image there. */}
      {/* A freeform content slide gets the small add-image control
          instead — see FreeformAddImageControl's own comment for why
          SlideBackgroundPanel's per-image list isn't reused for it (every
          image it adds is an ordinary layer from the start, managed via
          the Layers panel above, not a second list of its own here). */}
      {!isImageLayout && (isFreeformContent ? (
        <FreeformAddImageControl slide={slide} courseVersionId={courseVersionId} onConfigChange={onConfigChange} />
      ) : (
        <SlideBackgroundPanel
          imageUrl={slide.config.background_image_url}
          extraImages={slide.config.extra_images ?? []}
          courseVersionId={courseVersionId}
          onConfigChange={onConfigChange}
        />
      ))}

      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" />
        Delete slide
      </Button>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {/* The only part of the panel that scrolls now — see pinnedBottom's
          own comment above for why the other three controls moved out of
          this flow entirely. */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Slide</div>
          <Badge variant="outline" className="mt-1">
            {SLIDE_TYPE_LABELS[slide.slide_type]}
          </Badge>
        </div>

        {/* Legacy content slides (config.layout set — every slide that
            existed before the freeform system) keep this exact picker,
            unchanged. Freeform content slides (the default for anything
            created from here on) get the Tools section below instead.
            Other slide_types get neither — only "content" has ever had a
            layout concept. */}
        {slide.slide_type === "content" && !isFreeformContent && (
          <ContentLayoutPicker layout={slide.config.layout ?? "title-body"} onChange={handleLayoutChangeRequest} />
        )}

        {isFreeformContent && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tools</div>
              <div className="flex items-center gap-1">
                {/* Small icon buttons, not full-width labeled ones — this
                    row is meant to grow more tools over time, and a
                    full-width button per tool would eat the whole panel's
                    height before that even starts. Saving this slide as a
                    template moved to a bookmark button on the canvas
                    itself (slide-canvas.tsx) — it's about the slide being
                    viewed, not a side-panel "tool." */}
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={() => startPlacing({ kind: "text" })}
                  aria-label="Add text box"
                  title="Add text box"
                >
                  <Type className="h-4 w-4" />
                </Button>

                {/* One button, one popup sectioned into "Shapes"/"Icons"
                    (SHAPE_SECTIONS above) — the usual convention for a
                    shape tool in most design apps, rather than a
                    separate button per section. A new section (arrows/
                    connectors, callouts, whatever's next) is a new entry
                    in that array, not a new button here. */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button type="button" variant="outline" size="icon-sm" />}
                    aria-label="Add shape or icon"
                    title="Add shape or icon"
                  >
                    <Shapes className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {SHAPE_SECTIONS.map((section, index) => (
                      <DropdownMenuGroup key={section.label}>
                        {index > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
                        {section.options.map(({ kind, label, icon: Icon }) => (
                          <DropdownMenuItem key={kind} onClick={() => startPlacing({ kind: "shape", shapeKind: kind })}>
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Paint bucket: armed/disarmed is a plain toggle (click
                    again to turn it off), same as this panel's own format
                    buttons elsewhere — the color itself comes from the
                    small ColorPicker swatch right next to it, which stays
                    armed at whatever color was last picked rather than
                    re-prompting on every click (see paint-bucket-context.tsx's
                    own comment on why). Applying it is handled entirely on
                    the canvas side (shape-field.tsx's ShapeEditLayer,
                    freeform-content-slide.tsx's background click) — this
                    button only arms/disarms the tool. */}
                <Button
                  type="button"
                  variant={armedColor ? "default" : "outline"}
                  size="icon-sm"
                  aria-pressed={!!armedColor}
                  onClick={() => (armedColor ? disarmBucket() : armBucket("#2563eb"))}
                  aria-label="Paint bucket"
                  title="Paint bucket — click a shape, icon, or the background to recolor it"
                >
                  <PaintBucket className="h-4 w-4" />
                </Button>
                <ColorPicker
                  value={armedColor}
                  onChange={(color) => (color ? armBucket(color) : disarmBucket())}
                  panelInteractingRef={panelInteractingRef}
                  ariaLabel="Paint bucket color"
                  triggerClassName="h-7 w-7 shrink-0 rounded-md border border-input p-0"
                  renderTrigger={(current) => (
                    <span className="block h-full w-full rounded-md" style={{ backgroundColor: current ?? "transparent" }} />
                  )}
                />
              </div>
            </div>
          </div>
        )}

        {/* Multiple choice / accordion / flashcards / match pairs /
            sequencing / hotspot image: no layout picker, no layers panel —
            just whichever text field on this slide the author last clicked
            into, exactly like the freeform system's own TextObjectProperties/
            FreeTextBoxProperties above but driven by focus alone instead of a
            selectable object (see isWidgetTextSlide's own comment). */}
        {isWidgetTextSlide && (
          <div className="space-y-2 border-t border-border pt-4">
            <div className="text-[11px] font-medium text-muted-foreground/70">Text</div>
            {widgetFieldEditor ? (
              <TextFormattingControls editor={widgetFieldEditor} panelInteractingRef={panelInteractingRef} hideSize />
            ) : (
              <p className="text-xs text-muted-foreground">Click into a text field on the slide to format it.</p>
            )}
          </div>
        )}

        {/* Only ever open when a layout switch was requested on a slide that
            already had content — see handleLayoutChangeRequest. Cancelling
            (Escape, backdrop click, or the Cancel button — all funnel through
            onOpenChange) leaves the slide exactly as it was; only the
            "Switch and delete content" button actually calls
            applyLayoutChange. */}
        <Dialog open={pendingLayout !== null} onOpenChange={(open) => !open && setPendingLayout(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Switch template?</DialogTitle>
              <DialogDescription>
                This slide already has content. Switching templates will delete its title, text, image, and table,
                and replace it with an empty version of the new template. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingLayout(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingLayout) applyLayoutChange(pendingLayout);
                  setPendingLayout(null);
                }}
              >
                Switch and delete content
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {pinnedBottom}
    </div>
  );
}

// Grouped by what the layout is *for*, not just listed flat — "Title
// pages" are cover/section-divider slides with no body text (a title,
// positioned somewhere, optionally with a subtitle); "Text pages" are the
// ones with a real body-text box the author writes into. Splitting the
// picker into two labeled groups makes that distinction visible instead of
// leaving the author to infer it from six unlabeled icons in a row.
const LAYOUT_CATEGORIES: { label: string; options: { value: ContentSlideLayout; label: string }[] }[] = [
  {
    label: "Title pages",
    options: [
      { value: "title-only", label: "Title only" },
      { value: "title-subtitle", label: "Title & subtitle" },
      { value: "title-top", label: "Title top" },
      { value: "title-bottom", label: "Title bottom" },
    ],
  },
  {
    label: "Text pages",
    options: [
      { value: "title-body", label: "Title & body" },
      { value: "two-column", label: "Two column" },
    ],
  },
  {
    label: "Table pages",
    options: [{ value: "title-table", label: "Title & table" }],
  },
  {
    label: "Image pages",
    options: [
      { value: "image-left", label: "Image left" },
      { value: "image-right", label: "Image right" },
    ],
  },
];

// Tiny CSS-glyph icon buttons (no icon assets needed) previewing each
// arrangement — the compact "change layout after the fact" picker the plan
// calls for, as opposed to a two-step layout-then-content creation flow.
function ContentLayoutPicker({
  layout,
  onChange,
}: {
  layout: ContentSlideLayout;
  onChange: (layout: ContentSlideLayout) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Layout</div>
      {LAYOUT_CATEGORIES.map((category) => (
        <div key={category.label} className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted-foreground/70">{category.label}</div>
          <div className="flex flex-wrap gap-1.5">
            {category.options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                aria-label={opt.label}
                aria-pressed={layout === opt.value}
                title={opt.label}
                className={cn(
                  "flex h-10 w-12 items-center justify-center rounded-md border-2 text-muted-foreground transition-colors",
                  layout === opt.value
                    ? "border-primary text-primary"
                    : "border-border hover:border-muted-foreground/40",
                )}
              >
                <LayoutGlyph value={opt.value} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LayoutGlyph({ value }: { value: ContentSlideLayout }) {
  if (value === "title-only") {
    return (
      <div className="flex h-5 w-8 items-center justify-center">
        <div className="h-1.5 w-5 rounded-sm bg-current" />
      </div>
    );
  }

  if (value === "title-subtitle") {
    return (
      <div className="flex h-5 w-8 flex-col items-center justify-center gap-1">
        <div className="h-1.5 w-5 rounded-sm bg-current" />
        <div className="h-1 w-3 rounded-sm bg-current/40" />
      </div>
    );
  }

  if (value === "title-top") {
    return (
      <div className="flex h-5 w-8 items-start justify-center pt-0.5">
        <div className="h-1.5 w-5 rounded-sm bg-current" />
      </div>
    );
  }

  if (value === "title-bottom") {
    return (
      <div className="flex h-5 w-8 items-end justify-center pb-0.5">
        <div className="h-1.5 w-5 rounded-sm bg-current" />
      </div>
    );
  }

  if (value === "title-table") {
    return (
      <div className="flex h-5 w-8 flex-col gap-0.5">
        <div className="h-1 w-5 rounded-sm bg-current" />
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-0.5">
          <div className="rounded-[1px] bg-current/30" />
          <div className="rounded-[1px] bg-current/30" />
          <div className="rounded-[1px] bg-current/30" />
          <div className="rounded-[1px] bg-current/30" />
        </div>
      </div>
    );
  }

  if (value === "image-left" || value === "image-right") {
    return (
      <div className="flex h-5 w-8 flex-col gap-0.5">
        <div className="h-1 w-5 rounded-sm bg-current" />
        <div className="flex flex-1 gap-0.5">
          {value === "image-left" ? (
            <>
              <div className="flex-1 rounded-sm bg-current/60" />
              <div className="flex-1 rounded-sm bg-current/30" />
            </>
          ) : (
            <>
              <div className="flex-1 rounded-sm bg-current/30" />
              <div className="flex-1 rounded-sm bg-current/60" />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-5 w-8 flex-col gap-0.5">
      <div className="h-1 w-5 rounded-sm bg-current" />
      {value === "two-column" ? (
        <div className="flex flex-1 gap-0.5">
          <div className="flex-1 rounded-sm bg-current/30" />
          <div className="flex-1 rounded-sm bg-current/30" />
        </div>
      ) : (
        <div className="flex-1 rounded-sm bg-current/30" />
      )}
    </div>
  );
}

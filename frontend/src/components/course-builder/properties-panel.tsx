"use client";

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";

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
import { DEFAULT_SLIDE_TITLE, SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type {
  ContentSlideLayout,
  FreeTextBox,
  Lesson,
  PositionableField,
  Slide,
  SlideConfig,
  SlideObjectRef,
  SlideType,
} from "@/lib/course-types";
import { cn, stripHtml } from "@/lib/utils";
import { useActiveEditorContext, useForceRerenderOnEditorTransaction } from "./active-editor-context";
import { FreeTextBoxProperties } from "./free-text-box-properties";
import { ImageObjectProperties } from "./image-object-properties";
import { LessonProperties } from "./lesson-properties";
import { FreeformAddImageControl, SlideBackgroundPanel } from "./slide-background-panel";
import { SlideLayersPanel } from "./slide-layers-panel";
import { useTextBoxPlacement } from "./text-box-placement-context";
import { TextFormattingControls } from "./text-formatting-controls";
import { TextObjectProperties } from "./text-object-properties";

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
  | { type: "free-text"; boxId: string };

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
    return (
      <LessonProperties
        lesson={props.lesson}
        onDescriptionChange={props.onDescriptionChange}
        onDelete={props.onDelete}
      />
    );
  }

  if (props.kind === "object") {
    if (props.object.type === "text") {
      return <TextObjectProperties slide={props.slide} field={props.object.field} onConfigChange={props.onConfigChange} />;
    }
    if (props.object.type === "free-text") {
      return (
        <FreeTextBoxProperties slide={props.slide} boxId={props.object.boxId} onConfigChange={props.onConfigChange} />
      );
    }
    if (props.object.type === "background-image") {
      return (
        <ImageObjectProperties
          kind="background"
          slide={props.slide}
          courseVersionId={props.courseVersionId}
          onConfigChange={props.onConfigChange}
        />
      );
    }
    return (
      <ImageObjectProperties
        kind="extra"
        imageId={props.object.imageId}
        slide={props.slide}
        courseVersionId={props.courseVersionId}
        onConfigChange={props.onConfigChange}
      />
    );
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

// Freeform-mode twin of hasSlideContent above — gates the "Templates"
// preset's own destructive-replace confirmation the same way, just checking
// the freeform fields (text_boxes/extra_images/background image) instead
// of the legacy named fields. Deliberately NOT the same function: the two
// systems' "has content" question is genuinely about different fields (see
// SlideConfig.layout's comment in course-types.ts for why a slide is never
// in both systems at once, so there's no case where both checks would ever
// need to run against the same slide).
function hasFreeformContent(slide: Slide): boolean {
  const hasText = (box: FreeTextBox) => stripHtml(box.html).trim().length > 0;
  if ((slide.config.text_boxes ?? []).some(hasText)) return true;
  if ((slide.config.extra_images ?? []).length > 0) return true;
  if (slide.config.background_image_url) return true;
  return false;
}

// The subset of ContentSlideLayout presets that make sense as a freeform
// "quick-start" seed — title-table/image-left/image-right are deliberately
// excluded: they rely on mechanisms (a structured table, a dedicated
// upload-into-this-slot image box) that don't exist in the generic
// text-box+extra-image freeform object model, so there's no honest way to
// "seed" them as ordinary, freely-editable objects. A real, stated scope
// boundary for this pass, not an oversight.
const FREEFORM_TEMPLATE_OPTIONS: { value: ContentSlideLayout; label: string }[] = [
  { value: "title-only", label: "Title only" },
  { value: "title-subtitle", label: "Title & subtitle" },
  { value: "title-top", label: "Title top" },
  { value: "title-bottom", label: "Title bottom" },
  { value: "title-body", label: "Title & body" },
  { value: "two-column", label: "Two column" },
];

function makeTextBoxId(): string {
  return `text_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// A plain `<strong>` wrap — the real Bold mark's own universally-recognized
// default HTML (StarterKit's Bold.renderHTML/parseHTML), not a CSS class
// and not a guessed font-size markup shape. Loading this into the SAME
// extension set free-text-box.tsx's editor uses parses it back out as a
// genuinely active, toggleable Bold mark (shown as "active" in the Text
// panel, same as if the author had selected the text and clicked Bold
// themselves) — this is the literal mechanism behind "seeded boxes start
// pre-formatted via real marks, not a hardcoded style," see this file's own
// top-of-section comment on the Templates dropdown.
function titleHtml(text: string, align?: "center"): string {
  const style = align ? ` style="text-align: ${align}"` : "";
  return `<p${style}><strong>${text}</strong></p>`;
}

// Produces a one-time starting arrangement for a freeform slide — called
// only from the "Templates" dropdown below, never automatically. Positions
// are deliberately approximate visual equivalents of the legacy layout's
// own arrangement (see content-slide-face.tsx's layout branches), not
// pixel-exact — the whole point is that these are just a convenient
// starting point, freely moved/resized/deleted afterward like any other
// freeform object.
function seedFreeformFromTemplate(layout: ContentSlideLayout): {
  text_boxes: FreeTextBox[];
  object_order: SlideObjectRef[];
} {
  // 9% of the 540px-tall canvas is ~49px — a close, slightly-generous match
  // for one line of 4xl/bold text's own ~40px natural line-height, not the
  // old 15% (~81px) every title box used to spawn at. That extra ~40px was
  // reported directly: title boxes spawned noticeably taller than the one
  // line of text they'd ever actually hold, reading as a box with a lot of
  // empty room inside it rather than one sized to its own content. Shared
  // by every template below (not just the base `title` object) so "every
  // title box spawns one line tall" holds everywhere, not just title-top/
  // title-bottom/title-body/two-column, which inherit it from `title`
  // directly.
  const TITLE_HEIGHT_PCT = 9;
  const title: FreeTextBox = {
    id: makeTextBoxId(),
    html: titleHtml("New slide"),
    xPct: 10,
    yPct: 8,
    widthPct: 80,
    heightPct: TITLE_HEIGHT_PCT,
  };

  function withBoxes(...boxes: FreeTextBox[]) {
    return { text_boxes: boxes, object_order: boxes.map((b): SlideObjectRef => ({ type: "text", id: b.id })) };
  }

  // Shared symmetric left/right margin for the two layouts reported as
  // having "way too big" horizontal padding (title-body, two-column) — 6%
  // of the 960px-wide canvas is ~58px a side, close to the legacy system's
  // own `px-16` (64px) rather than the old 10% (~96px) margin, which read
  // as noticeably wider than the fixed-layout equivalent it's standing in
  // for. title-only/title-subtitle/title-top/title-bottom weren't reported
  // as having a horizontal-margin problem, so they keep the base `title`
  // box's own 10%/80% geometry untouched.
  const BODY_MARGIN_PCT = 6;
  const BODY_WIDTH_PCT = 100 - BODY_MARGIN_PCT * 2;

  switch (layout) {
    case "title-only":
      // Previously yPct: 40/heightPct: 20 with the base (left-aligned)
      // title html — two confirmed bugs at once: a 20%-tall box is far
      // taller than one line of 4xl text actually needs, so the text sat
      // near the box's own top edge, reading as "too high" even though the
      // BOX itself was roughly centered; and with no text-align, that
      // oversized box's text also sat flush left instead of centered.
      // yPct: 45 against TITLE_HEIGHT_PCT (9) keeps the box itself truly
      // vertically centered (45 + 9/2 = ~50), and centering the text is
      // the same fix title-subtitle's own box already needed for the
      // identical reason.
      return withBoxes({ ...title, yPct: 45, html: titleHtml("New slide", "center") });
    case "title-subtitle": {
      // Both boxes span a wide chunk of the slide (same symmetric-margin
      // geometry every other template here uses) but default to
      // LEFT-aligned text — confirmed as the actual cause of "the title
      // and subtitle look off-center": the BOX itself is centered on the
      // slide, but short left-aligned text inside a wide box sits flush
      // near the box's own left edge, nowhere near the slide's visual
      // center. Centering the text (not narrowing the box — a centered
      // box with centered text lands at the slide's midpoint regardless
      // of how wide the box is) is what actually fixes that; title-only/
      // title-bottom/etc. use the same wide-box geometry but weren't
      // reported as looking wrong, so left unchanged.
      //
      // yPct shifted down from 35/52 to 42/60 (title/subtitle respectively)
      // — reported as spawning "a little too high": the pair's old 35-62%
      // span centered at ~48.5%, visibly above the slide's true 50%
      // midpoint; 42-70% centers at ~56%, which reads as vertically
      // centered once the title's own larger font weight is accounted for.
      // Nudged to 45 (from 42) when the title box itself shrank to
      // TITLE_HEIGHT_PCT — keeps the gap between title and subtitle
      // looking the same as before rather than growing by the height
      // reduction.
      const centeredTitle = { ...title, yPct: 45, html: titleHtml("New slide", "center") };
      const subtitle: FreeTextBox = {
        id: makeTextBoxId(),
        html: '<p style="text-align: center">Subtitle</p>',
        xPct: 15,
        yPct: 60,
        widthPct: 70,
        heightPct: 10,
      };
      return withBoxes(centeredTitle, subtitle);
    }
    case "title-bottom":
      return withBoxes({ ...title, yPct: 77 });
    case "two-column": {
      // Columns split BODY_WIDTH_PCT in half with the same BODY_MARGIN_PCT
      // gap between them as on either outer edge, so the two columns and
      // the gap between them all read as evenly spaced — not just each
      // column's own outer margin shrinking while the gap between them
      // stayed at its old (also too wide) value.
      const columnWidth = (BODY_WIDTH_PCT - BODY_MARGIN_PCT) / 2;
      const body1: FreeTextBox = {
        id: makeTextBoxId(),
        html: "",
        xPct: BODY_MARGIN_PCT,
        yPct: 26,
        widthPct: columnWidth,
        heightPct: 66,
      };
      const body2: FreeTextBox = {
        id: makeTextBoxId(),
        html: "",
        xPct: BODY_MARGIN_PCT + columnWidth + BODY_MARGIN_PCT,
        yPct: 26,
        widthPct: columnWidth,
        heightPct: 66,
      };
      return withBoxes({ ...title, xPct: BODY_MARGIN_PCT, widthPct: BODY_WIDTH_PCT }, body1, body2);
    }
    case "title-top":
      return withBoxes(title);
    case "title-body":
    default: {
      const body: FreeTextBox = {
        id: makeTextBoxId(),
        html: "",
        xPct: BODY_MARGIN_PCT,
        yPct: 26,
        widthPct: BODY_WIDTH_PCT,
        heightPct: 66,
      };
      return withBoxes({ ...title, xPct: BODY_MARGIN_PCT, widthPct: BODY_WIDTH_PCT }, body);
    }
  }
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
  // Same idea, for the freeform system's own "Templates" preset — see
  // handleTemplateRequest below. Independent state: the two confirmation
  // flows can never both be relevant for the same slide at once (see
  // SlideConfig.layout's comment on why a slide is always in exactly one
  // system), so there's no reason to unify them into one piece of state.
  const [pendingTemplate, setPendingTemplate] = useState<ContentSlideLayout | null>(null);
  const { startPlacing } = useTextBoxPlacement();

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

  // Deliberately does NOT set `config.layout` — that would re-enter the
  // legacy render branch (content-slide-face.tsx's own top-of-file
  // comment). This seeds text_boxes/object_order with a one-time starting
  // arrangement and leaves the slide in freeform mode, so the result is
  // ordinary, freely-editable objects, not a locked structural layout.
  function applyTemplate(layout: ContentSlideLayout) {
    onConfigChange(seedFreeformFromTemplate(layout));
  }

  function handleTemplateRequest(layout: ContentSlideLayout) {
    if (!hasFreeformContent(slide)) {
      applyTemplate(layout);
      return;
    }
    setPendingTemplate(layout);
  }

  const isImageLayout =
    slide.slide_type === "content" &&
    (slide.config.layout === "image-left" || slide.config.layout === "image-right");
  const isFreeformContent = slide.slide_type === "content" && slide.config.layout == null;

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Slide</div>
        <Badge variant="outline" className="mt-1">
          {SLIDE_TYPE_LABELS[slide.slide_type]}
        </Badge>
      </div>

      {/* Legacy content slides (config.layout set — every slide that
          existed before the freeform system) keep this exact picker,
          unchanged. Freeform content slides (the default for anything
          created from here on) get the "Add text box" + layers panel +
          Templates dropdown block below instead. Other slide_types get
          neither — only "content" has ever had a layout concept. */}
      {slide.slide_type === "content" && !isFreeformContent && (
        <ContentLayoutPicker layout={slide.config.layout ?? "title-body"} onChange={handleLayoutChangeRequest} />
      )}

      {isFreeformContent && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Content</div>
            {/* A small icon button, not the old full-width labeled one —
                this panel is meant to grow more add-object buttons over
                time (shapes, etc.), and a full-width button per object
                type would eat the whole panel's height before that even
                starts. */}
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={startPlacing}
              aria-label="Add text box"
              title="Add text box"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <SlideLayersPanel slide={slide} onConfigChange={onConfigChange} />
          <TemplatesDropdown onSelect={handleTemplateRequest} />
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

      {/* Freeform twin of the dialog above — same shape, gated by
          hasFreeformContent instead of hasSlideContent (see
          handleTemplateRequest). */}
      <Dialog open={pendingTemplate !== null} onOpenChange={(open) => !open && setPendingTemplate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply template?</DialogTitle>
            <DialogDescription>
              This slide already has content. Applying a template will replace everything on it with the new
              template&apos;s starting text boxes. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTemplate(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingTemplate) applyTemplate(pendingTemplate);
                setPendingTemplate(null);
              }}
            >
              Apply and replace content
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      {/* A freeform content slide gets the small, bottom-of-panel add-image
          control instead — see FreeformAddImageControl's own comment for
          why SlideBackgroundPanel's per-image list isn't reused for it
          (every image it adds is an ordinary layer from the start, managed
          via the Layers panel above, not a second list of its own here). */}
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
}

// What used to be THE layout picker, inline and shown by default, for a
// freeform content slide — now an explicit, opt-in list of starting
// presets rather than the default experience (see course-types.ts's
// SlideConfig.layout comment: the default for a new content slide is now a
// blank canvas, not title-body). An inline expand/collapse section, not a
// popup DropdownMenu (the previous version) — a floating overlay in this
// narrow side panel looked out of place and could overlap neighboring
// panel content; this instead pushes the option list into the panel's own
// flow when opened, same collapsed-header/expanded-body shape as the
// Accordion slide type's own learner-facing render (see
// accordion-slide-face.tsx's AccordionPresent). Reuses LayoutGlyph for the
// same small visual icon per option, just one row each instead of a grid.
function TemplatesDropdown({ onSelect }: { onSelect: (layout: ContentSlideLayout) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted"
        aria-expanded={open}
      >
        Templates
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-0.5 border-t border-border p-1.5">
          {FREEFORM_TEMPLATE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              <span className="flex h-5 w-7 items-center justify-center text-muted-foreground">
                <LayoutGlyph value={option.value} />
              </span>
              {option.label}
            </button>
          ))}
        </div>
      )}
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

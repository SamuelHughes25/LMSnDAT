"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

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
import { SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type { ContentSlideLayout, Lesson, Slide, SlideConfig } from "@/lib/course-types";
import { cn, stripHtml } from "@/lib/utils";
import { LessonProperties } from "./lesson-properties";
import { SlideBackgroundPanel } from "./slide-background-panel";

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
function hasSlideContent(slide: Slide): boolean {
  const hasText = (v: string | undefined) => !!v && stripHtml(v).trim().length > 0;
  if (hasText(slide.title)) return true;
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

  // The actual switch: resets every layout-scoped field to its blank state
  // (not just box_transforms, which the picker always cleared even before
  // this confirmation existed) and applies the new layout, so the slide
  // ends up looking exactly like a freshly-added slide in that layout — "an
  // empty template," per the request. image_url is set to `null` (removed)
  // rather than left `undefined`, matching how EditableImage's own Remove
  // button clears it — image_width_pct/height_pct are left as `undefined`
  // rather than a literal removed marker, same as an image that was simply
  // never resized.
  function applyLayoutChange(layout: ContentSlideLayout) {
    onTitleChange("");
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

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Slide</div>
        <Badge variant="outline" className="mt-1">
          {SLIDE_TYPE_LABELS[slide.slide_type]}
        </Badge>
      </div>

      {/* Dispatches on slide_type — only "content" has a layout picker
          this stage. A later stage can grow this into a per-type lookup
          without disturbing this component's shape. */}
      {slide.slide_type === "content" && (
        <ContentLayoutPicker layout={slide.config.layout ?? "title-body"} onChange={handleLayoutChangeRequest} />
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

      {/* Unlike the layout picker above, this section applies to every
          slide_type — a background image (and, planned next, a background
          color) is cross-cutting styling, not something specific to
          "content" slides. See course-types.ts's note on
          ContentSlideLayout for why this lives here instead of being a
          layout option. */}
      <SlideBackgroundPanel
        imageUrl={slide.config.background_image_url}
        courseVersionId={courseVersionId}
        onConfigChange={onConfigChange}
      />

      <Button variant="outline" className="w-full text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="mr-1.5 h-4 w-4" />
        Delete slide
      </Button>
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

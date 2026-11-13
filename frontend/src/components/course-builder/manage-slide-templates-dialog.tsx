"use client";

import { Fragment, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, GripVertical, Trash2 } from "lucide-react";

import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { useStageScale } from "@/components/course-preview/course-preview-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewToggle } from "@/components/view-toggle";
import { backgroundFillStyle } from "@/lib/background-fill-style";
import { SLIDE_TYPE_LABELS } from "@/lib/course-types";
import type { Slide, SlideTemplate } from "@/lib/course-types";
import { useViewMode } from "@/lib/use-view-mode";
import { cn } from "@/lib/utils";
import { InlineRenameField } from "./inline-rename-field";
import { CANVAS_H, CANVAS_W } from "./slide-canvas";
import { SLIDE_TYPE_FACES } from "./slide-faces";
import { SlideTypeIcon } from "./slide-type-icon";

// Same fixed-pixel-scaled-down technique as slide-thumbnail.tsx's own true
// miniature (a real Face render, shrunk via CSS transform, not a separate
// simplified preview renderer). Two sizes — Compact's row-height thumb and
// Normal's own larger card preview — since the two views genuinely want
// different amounts of screen real estate per entry. A SlideTemplate can be
// ANY slide_type now (not just freeform "content" — see its own comment in
// course-types.ts), so unlike the old content-only version of this file,
// every thumb/panel below looks up the right Face per template instead of
// assuming SLIDE_TYPE_FACES.content.
const COMPACT_THUMB_W = 72;
const COMPACT_THUMB_H = 41;
const NORMAL_THUMB_W = 240;
const NORMAL_THUMB_H = 135;

// A synthetic Slide — SlideTemplate isn't one (see course-types.ts's own
// comment), but every Face component only ever reads
// `slide.slide_type`/`slide.config` in "static" mode, so this is a safe,
// throwaway stand-in purely for rendering, shared by the small thumb below
// and the expanded preview panel further down.
function fakeSlideFor(template: SlideTemplate): Slide {
  return { id: template.id, lesson: "", slide_type: template.slide_type, title: template.name, order: 0, config: template.config };
}

function TemplatePreviewThumb({ template, width, height }: { template: SlideTemplate; width: number; height: number }) {
  const Face = SLIDE_TYPE_FACES[template.slide_type];
  const scale = width / CANVAS_W;

  return (
    <div
      style={{ width, height, overflow: "hidden", ...backgroundFillStyle(template.config.background_fill) }}
      className="slide-surface shrink-0 rounded border border-border bg-white"
    >
      <div
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
          position: "relative",
        }}
      >
        <Face slide={fakeSlideFor(template)} mode="static" />
      </div>
    </div>
  );
}

// The eye button's expanded state — a single slide, so this renders its
// own stage directly instead of going through CoursePreviewViewer (used
// by manage-lessons-dialog.tsx's own expansion panel and the course's
// version-history table): a SlideTemplate can only ever hold one slide,
// so that component's Previous/Next row and "Slide 1 of 1" caption would
// just be permanently-disabled, always-1-of-1 chrome with nothing for it
// to do — removed here rather than shown in a state that can never
// change. useStageScale is the same scale-to-fit sizing math
// CoursePreviewViewer itself uses internally, exported from there
// specifically for this reuse. Rendered inline, right below the row it
// belongs to — see this file's own ManageSlideTemplatesDialog comment for
// why this replaced a separate popup dialog.
//
// mode="present" (not "static") — the same mode CoursePreviewViewer's own
// Face render uses everywhere else it's shown (the lesson library's own
// expansion panel just below in this app, the version-history table, the
// admin Preview tab, the real portal player). "static" is thumbnail-only:
// read-only and deliberately inert, which left an assessment/interactive
// template (multiple_choice, sequencing, flashcards, etc.) looking right
// but not actually clickable/draggable here — reported directly as a real
// gap, since every other place a slide gets previewed in this app lets you
// try it. `onInteraction`/`priorResult`/`isAssessment` are all optional
// (see SlideFaceProps) and safe to omit: there's no real attempt behind
// this preview, so the usual answer-permanence/scoring plumbing those
// enable doesn't apply here — the author can just freely try the slide out,
// same as the admin's own Preview tab already lets them do with a real
// lesson (attemptTracking unset there too).
function TemplateExpansionPanel({ template }: { template: SlideTemplate }) {
  const Face = SLIDE_TYPE_FACES[template.slide_type];
  const { containerRef, scale } = useStageScale();

  return (
    <div className="h-[460px] rounded-lg border border-border bg-muted/40 p-2">
      <div ref={containerRef} className="flex h-full w-full items-center justify-center overflow-hidden">
        <div
          className="slide-surface relative overflow-hidden rounded-sm bg-white shadow-lg"
          style={{ width: CANVAS_W, height: CANVAS_H, zoom: scale, ...backgroundFillStyle(template.config.background_fill) }}
        >
          <Face slide={fakeSlideFor(template)} mode="present" />
        </div>
      </div>
    </div>
  );
}

const VIEW_STORAGE_KEY = "manage-slide-templates-view";

// The "add/manage/view" dialog for the slide-template library — opened
// from the icon button next to "Import or manage reusable lessons" in
// slide-rail.tsx (see this project's identical pattern for lessons).
// Entries can only be CREATED from the canvas's own bookmark button (see
// save-slide-template-dialog.tsx), never from here; this only manages what
// already exists: preview it, rename it, reorder it, or delete it.
// Deliberately no "Import" action here — importing a template into the
// current lesson stays in the Add slide menu's own Templates submenu,
// where a slide is actually about to be created; this dialog is purely a
// library manager.
//
// Fixed 70vw/70vh — was sized purely by its own content before, which
// meant an empty or near-empty library spawned a tiny dialog that only
// grew as templates were added. A fixed footprint regardless of content
// reads as a real, predictable workspace rather than something that
// visibly resizes under the author as they use it.
export function ManageSlideTemplatesDialog({
  open,
  onOpenChange,
  templates,
  onRename,
  onReorder,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: SlideTemplate[];
  onRename: (slideTemplateId: string, name: string) => Promise<void>;
  onReorder: (reordered: SlideTemplate[]) => void;
  onDelete: (slideTemplateId: string) => Promise<void>;
}) {
  const [view, setView] = useViewMode(VIEW_STORAGE_KEY);
  // The template a delete was requested for — null means the confirm
  // dialog is closed. Rendered as a sibling of the main Dialog below
  // (both portal, so nesting order in the tree doesn't matter).
  const [pendingDelete, setPendingDelete] = useState<SlideTemplate | null>(null);
  // Which row's eye button is toggled open — same single-row-at-a-time
  // pattern as version-history-table.tsx's own expandedId, which this
  // directly mirrors (an inline expansion below the row, not a popup).
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Reset whichever row was expanded once the dialog closes — this Dialog
  // stays mounted (just hidden) rather than unmounting on close, so
  // without this, reopening it would silently resume showing whatever was
  // expanded last time, even though the author just closed and reopened a
  // fresh library view. Reset during render on the open->closed
  // transition, not inside an effect — this project's sanctioned
  // alternative to a synchronous setState-in-an-effect (see
  // save-lesson-dialog.tsx's identical pattern for the fuller rationale).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setExpandedId(null);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = templates.findIndex((t) => t.id === active.id);
    const newIndex = templates.findIndex((t) => t.id === over.id);
    const reordered = arrayMove(templates, oldIndex, newIndex).map((t, index) => ({ ...t, order: index }));
    onReorder(reordered);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* sm:max-w-none cancels DialogContent's own default sm:max-w-sm —
            without it, that default breakpoint cap wins over a plain
            unprefixed w-[70vw] (different CSS properties, so twMerge never
            treats them as conflicting and drops neither), and the dialog
            silently clamps to 24rem regardless of this className. Confirmed
            via a real browser: exactly this happened on the first pass. */}
        <DialogContent className="flex h-[70vh] w-[70vw] max-w-none flex-col sm:max-w-none">
          <DialogHeader className="shrink-0">
            <DialogTitle>Slide templates</DialogTitle>
          </DialogHeader>
          <div className="flex shrink-0 items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Preview, rename, reorder, or delete a saved template. Add one to a lesson from the Add slide menu&apos;s
              Templates list, or save a new one from the bookmark button on the canvas.
            </p>
            <ViewToggle view={view} onChange={setView} />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing saved yet — save a slide to get started.</p>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={templates.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <div className={view === "normal" ? "grid grid-cols-2 gap-3" : "space-y-1.5"}>
                    {templates.map((template) => {
                      const isExpanded = expandedId === template.id;
                      const rowProps = {
                        template,
                        onRename: (name: string) => onRename(template.id, name),
                        isExpanded,
                        onToggleExpand: () => setExpandedId(isExpanded ? null : template.id),
                        onDelete: () => setPendingDelete(template),
                      };
                      return (
                        <Fragment key={template.id}>
                          {view === "normal" ? <NormalTemplateCard {...rowProps} /> : <CompactTemplateRow {...rowProps} />}
                          {isExpanded && (
                            <div className={view === "normal" ? "col-span-2" : undefined}>
                              <TemplateExpansionPanel template={template} />
                            </div>
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(nextOpen) => !nextOpen && setPendingDelete(null)}
        title="Delete this template?"
        description={
          <>
            &ldquo;{pendingDelete?.name}&rdquo; will be removed from your templates library. Slides already created
            from it won&apos;t be affected. This can&apos;t be undone.
          </>
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        destructive
        action={async () => {
          if (pendingDelete) await onDelete(pendingDelete.id);
        }}
        onSuccess={() => {}}
      />
    </>
  );
}

function CompactTemplateRow({
  template,
  onRename,
  isExpanded,
  onToggleExpand,
  onDelete,
}: {
  template: SlideTemplate;
  onRename: (name: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: template.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border border-border bg-card p-1.5"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <TemplatePreviewThumb template={template} width={COMPACT_THUMB_W} height={COMPACT_THUMB_H} />
      <span
        className="shrink-0 text-muted-foreground"
        title={SLIDE_TYPE_LABELS[template.slide_type]}
        aria-label={SLIDE_TYPE_LABELS[template.slide_type]}
      >
        <SlideTypeIcon type={template.slide_type} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <InlineRenameField value={template.name} onRename={onRename} />
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {new Date(template.created_at).toLocaleDateString()}
      </span>
      <Button
        variant={isExpanded ? "secondary" : "ghost"}
        size="icon-sm"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `Hide ${template.name}'s preview` : `Preview ${template.name}`}
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${template.name}`}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function NormalTemplateCard({
  template,
  onRename,
  isExpanded,
  onToggleExpand,
  onDelete,
}: {
  template: SlideTemplate;
  onRename: (name: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: template.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex flex-col gap-2 rounded-lg border-2 border-border bg-card p-3 shadow-sm"
    >
      <div className="flex items-center justify-center">
        <TemplatePreviewThumb template={template} width={NORMAL_THUMB_W} height={NORMAL_THUMB_H} />
      </div>
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab touch-none text-muted-foreground"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <InlineRenameField value={template.name} onRename={onRename} className="text-base" />
          <div className="mt-1 flex items-center gap-1.5">
            <Badge variant="outline" className="gap-1">
              <SlideTypeIcon type={template.slide_type} className="h-3 w-3" />
              {SLIDE_TYPE_LABELS[template.slide_type]}
            </Badge>
            <p className="text-xs text-muted-foreground">saved {new Date(template.created_at).toLocaleDateString()}</p>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          className={cn(isExpanded && "bg-accent")}
        >
          <Eye className="mr-1 h-3.5 w-3.5" />
          {isExpanded ? "Hide preview" : "Preview"}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={`Delete ${template.name}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

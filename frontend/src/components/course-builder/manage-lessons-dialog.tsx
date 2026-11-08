"use client";

import { Fragment, useEffect, useState } from "react";
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
import { BookOpen, Eye, GripVertical, Trash2 } from "lucide-react";

import {
  deleteReusableLesson,
  getReusableLessonDetail,
  listReusableLessons,
  renameReusableLesson,
  reorderReusableLessons,
} from "@/app/actions/courses";
import { CoursePreviewViewer, type PreviewSlide } from "@/components/course-preview/course-preview-viewer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ViewToggle } from "@/components/view-toggle";
import type { ReusableLesson } from "@/lib/course-types";
import { useViewMode } from "@/lib/use-view-mode";
import { cn } from "@/lib/utils";
import { InlineRenameField } from "./inline-rename-field";

const VIEW_STORAGE_KEY = "manage-lessons-view";

// The eye button's expanded state — fetches this lesson's real slides (the
// list above only ever carries a count, see getReusableLessonDetail's own
// comment) and hands them to the exact same CoursePreviewViewer the
// course's own Preview tab and version-history table both use, built the
// identical way those do (flatten, sorted-by-order, carrying the lesson
// title for the viewer's caption). Rendered inline, right below the row —
// see ManageLessonsDialog's own comment for why this replaced a separate
// popup dialog.
function LessonExpansionPanel({ lessonId, lessonName }: { lessonId: string; lessonName: string }) {
  const [slides, setSlides] = useState<PreviewSlide[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset during render when a DIFFERENT lesson expands, not inside the
  // fetch effect below — this project's sanctioned alternative to a
  // synchronous setState-in-an-effect (see save-lesson-dialog.tsx's
  // identical pattern). This component remounts fresh per lessonId anyway
  // (see its own `key` at the call site), so in practice this only ever
  // guards against a lesson collapsing and a DIFFERENT one expanding
  // before the old instance has a chance to unmount.
  const [prevLessonId, setPrevLessonId] = useState(lessonId);
  if (lessonId !== prevLessonId) {
    setPrevLessonId(lessonId);
    setSlides(null);
    setError(null);
  }

  useEffect(() => {
    getReusableLessonDetail(lessonId)
      .then((detail) => {
        const previewSlides: PreviewSlide[] = [...detail.slides]
          .sort((a, b) => a.order - b.order)
          .map((s): PreviewSlide => ({
            slide: { id: s.id, lesson: "", slide_type: s.slide_type, title: s.title, order: s.order, config: s.config },
            lessonTitle: detail.name,
          }));
        setSlides(previewSlides);
      })
      .catch(() => setError("Could not load this lesson's slides."));
  }, [lessonId]);

  return (
    <div className="h-[500px] rounded-lg border border-border bg-muted/40 p-2">
      {error ? (
        <p className="p-4 text-sm text-destructive">{error}</p>
      ) : slides === null ? (
        <p className="p-4 text-sm text-muted-foreground">Loading {lessonName}&apos;s slides…</p>
      ) : (
        <CoursePreviewViewer slides={slides} maxWidthClassName="max-w-4xl" />
      )}
    </div>
  );
}

// The "add/manage/view" dialog for saved reusable lessons — entries can
// only be CREATED via save-lesson-dialog.tsx (cloning an existing authored
// lesson's slides), not from here; this manages what already exists in
// the library: preview it, rename it, reorder it, import a copy into the
// current course's draft, or delete it permanently. Controlled, no
// DialogTrigger of its own — opened from a button in slide-rail.tsx next
// to "Add lesson".
//
// Fixed 70vw/70vh and owns its own `lessons` state (fetched fresh each
// time it opens, same as before) — see manage-slide-templates-dialog.tsx's
// identical sizing comment for why a fixed footprint regardless of
// content. Reordering/renaming/deleting all operate on this local state
// directly (no lifting to course-builder.tsx needed, unlike slide
// templates — nothing outside this one dialog ever needs the lesson
// library's list).
export function ManageLessonsDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (reusableLessonId: string) => Promise<void>;
}) {
  const [lessons, setLessons] = useState<ReusableLesson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Which row's eye button is toggled open — same single-row-at-a-time
  // pattern as version-history-table.tsx's own expandedId.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [view, setView] = useViewMode(VIEW_STORAGE_KEY);

  // Reset whichever row was expanded once the dialog closes — this Dialog
  // stays mounted (just hidden) rather than unmounting on close, so
  // without this, reopening it would silently resume showing whatever was
  // expanded last time. Reset during render on the open->closed
  // transition, not inside an effect — this project's sanctioned
  // alternative to a synchronous setState-in-an-effect (see
  // save-lesson-dialog.tsx's identical pattern for the fuller rationale).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setExpandedId(null);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Refetches every time the dialog opens — the library can change between
  // opens (a lesson saved from elsewhere in this same session, or one
  // deleted here last time) and a Client Component like this one has no
  // Server Component refetch to piggyback on.
  useEffect(() => {
    if (!open) return;
    listReusableLessons()
      .then((data) => {
        setLessons(data);
        setError(null);
      })
      .catch(() => setError("Could not load the reusable lesson library."));
  }, [open]);

  async function handleImport(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await onImport(id);
      onOpenChange(false);
    } catch {
      setError("Could not import this lesson. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await deleteReusableLesson(id);
      setLessons((prev) => prev?.filter((l) => l.id !== id) ?? prev);
    } catch {
      setError("Could not delete this lesson. Please try again.");
    } finally {
      setPendingId(null);
    }
  }

  function handleRename(lesson: ReusableLesson, name: string) {
    renameReusableLesson(lesson.id, name)
      .then((updated) => setLessons((prev) => prev?.map((l) => (l.id === lesson.id ? updated : l)) ?? prev))
      .catch(() => setError("Could not rename this lesson. Please try again."));
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!lessons) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = lessons.findIndex((l) => l.id === active.id);
    const newIndex = lessons.findIndex((l) => l.id === over.id);
    const reordered = arrayMove(lessons, oldIndex, newIndex).map((l, index) => ({ ...l, order: index }));
    setLessons(reordered);
    reorderReusableLessons(reordered.map((l) => ({ id: l.id, order: l.order }))).catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-none cancels DialogContent's own default sm:max-w-sm —
          see manage-slide-templates-dialog.tsx's identical comment for
          why a plain unprefixed w-[70vw] alone doesn't override it. */}
      <DialogContent className="flex h-[70vh] w-[70vw] max-w-none flex-col sm:max-w-none">
        <DialogHeader className="shrink-0">
          <DialogTitle>Reusable lessons</DialogTitle>
        </DialogHeader>
        <div className="flex shrink-0 items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Preview, rename, reorder, import, or delete a saved lesson. Save a new one from any lesson&apos;s own
            menu.
          </p>
          <ViewToggle view={view} onChange={setView} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {lessons === null && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {lessons?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing saved yet — save a lesson to get started.</p>
          )}
          {lessons && lessons.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={lessons.map((l) => l.id)} strategy={verticalListSortingStrategy}>
                <div className={view === "normal" ? "grid grid-cols-2 gap-3" : "space-y-1.5"}>
                  {lessons.map((lesson) => {
                    const isExpanded = expandedId === lesson.id;
                    const rowProps = {
                      lesson,
                      pending: pendingId === lesson.id,
                      onRename: (name: string) => handleRename(lesson, name),
                      isExpanded,
                      onToggleExpand: () => setExpandedId(isExpanded ? null : lesson.id),
                      onImport: () => handleImport(lesson.id),
                      onDelete: () => handleDelete(lesson.id),
                    };
                    return (
                      <Fragment key={lesson.id}>
                        {view === "normal" ? <NormalLessonCard {...rowProps} /> : <CompactLessonRow {...rowProps} />}
                        {isExpanded && (
                          <div className={view === "normal" ? "col-span-2" : undefined}>
                            <LessonExpansionPanel lessonId={lesson.id} lessonName={lesson.name} />
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

        {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

function CompactLessonRow({
  lesson,
  pending,
  onRename,
  isExpanded,
  onToggleExpand,
  onImport,
  onDelete,
}: {
  lesson: ReusableLesson;
  pending: boolean;
  onRename: (name: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id });
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
      <div className="min-w-0 flex-1">
        <InlineRenameField value={lesson.name} onRename={onRename} />
        {lesson.description && <p className="truncate text-xs text-muted-foreground">{lesson.description}</p>}
      </div>
      <span className="shrink-0 text-xs text-muted-foreground">
        {lesson.slide_count} slide{lesson.slide_count === 1 ? "" : "s"}
      </span>
      <Button
        variant={isExpanded ? "secondary" : "ghost"}
        size="icon-sm"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        aria-label={isExpanded ? `Hide ${lesson.name}'s preview` : `Preview ${lesson.name}`}
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Button size="sm" disabled={pending} onClick={onImport}>
        {pending ? "Importing…" : "Import"}
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending}
        onClick={onDelete}
        aria-label={`Delete ${lesson.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function NormalLessonCard({
  lesson,
  pending,
  onRename,
  isExpanded,
  onToggleExpand,
  onImport,
  onDelete,
}: {
  lesson: ReusableLesson;
  pending: boolean;
  onRename: (name: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 rounded-lg border-2 border-border bg-card p-4 shadow-sm"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="mt-1 cursor-grab touch-none text-muted-foreground"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {/* No thumbnail field on ReusableLesson (unlike Course) — a plain
          icon box in the same spot admin-courses-view.tsx's own Normal
          view puts a course's picture, so the two "Normal" lists still
          read as the same kind of layout. */}
      <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-muted">
        <BookOpen className="h-6 w-6 text-muted-foreground/40" />
      </div>

      <div className="min-w-0 flex-1">
        <InlineRenameField value={lesson.name} onRename={onRename} className="text-base" />
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{lesson.description || "—"}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {lesson.slide_count} slide{lesson.slide_count === 1 ? "" : "s"} · saved{" "}
          {new Date(lesson.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex gap-1.5">
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
          <Button size="sm" disabled={pending} onClick={onImport}>
            {pending ? "Importing…" : "Import"}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          onClick={onDelete}
          aria-label={`Delete ${lesson.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

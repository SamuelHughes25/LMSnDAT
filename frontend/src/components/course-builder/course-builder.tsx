"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { ArrowLeft } from "lucide-react";

import {
  createLesson,
  createSlide,
  deleteLesson,
  deleteSlide,
  importReusableLesson,
  publishVersion,
  reorderLessons,
  reorderSlides,
  saveLessonAsReusable,
  updateLesson,
  updateSlide,
} from "@/app/actions/courses";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Course, CourseVersion, Lesson, Slide, SlideConfig, SlideType } from "@/lib/course-types";
import { ActiveEditorProvider, useActiveEditorContext } from "./active-editor-context";
import { PropertiesPanel, type PropertiesPanelProps, type SelectedObject } from "./properties-panel";
import { SlideCanvas } from "./slide-canvas";
import { SlideRail } from "./slide-rail";
import { SlideSelectionProvider, useSlideSelection } from "./slide-selection-context";
import { SnapGuideProvider } from "./snap-guide-context";
import { TextBoxPlacementProvider } from "./text-box-placement-context";

type Selection =
  | { type: "lesson"; lessonId: string }
  | { type: "slide"; lessonId: string; slideId: string }
  | null;

// Parses slide-selection-context.tsx's own `${slideId}:${field}` /
// `${slideId}:background-image` / `${slideId}:extra-image:${id}` id shapes
// back into a structured SelectedObject, scoped to one specific slide — a
// selectedId belonging to a DIFFERENT (e.g. previously viewed) slide simply
// won't match this prefix and correctly falls through to null, no separate
// "is this stale" check needed (see slide-selection-context.tsx's own
// comment on why namespacing already makes stale ids harmless).
function parseSelectedObject(selectedId: string | null, slideId: string | undefined): SelectedObject | null {
  if (!selectedId || !slideId) return null;
  const prefix = `${slideId}:`;
  if (!selectedId.startsWith(prefix)) return null;
  const suffix = selectedId.slice(prefix.length);
  if (suffix === "title" || suffix === "subtitle" || suffix === "body" || suffix === "body2") {
    return { type: "text", field: suffix };
  }
  if (suffix === "background-image") return { type: "background-image" };
  if (suffix.startsWith("extra-image:")) {
    return { type: "extra-image", imageId: suffix.slice("extra-image:".length) };
  }
  // A freeform content slide's own text_boxes[] entry — see
  // free-text-box.tsx/free-text-box-properties.tsx, which both namespace
  // their own PositionableBox/ActiveEditorContext ids this same way
  // (`${slideId}:text:${boxId}`).
  if (suffix.startsWith("text:")) {
    return { type: "free-text", boxId: suffix.slice("text:".length) };
  }
  return null;
}

// The public export just sets up the two contexts the inner component (and
// every descendant under SlideCanvas/SlideRail) needs — ActiveEditorProvider
// and SlideSelectionProvider — and renders CourseBuilderInner as their
// child. This split exists specifically so CourseBuilderInner can call
// useSlideSelection()/useActiveEditorContext() itself (to read which object
// is selected and where the panel's own DOM node is): a component can only
// consume a context provided by an ANCESTOR, never one it renders itself as
// part of its own JSX, so the actual builder body has to live one level
// below these providers, not alongside them.
export function CourseBuilder(props: { course: Course; initialVersion: CourseVersion }) {
  return (
    <ActiveEditorProvider>
      <SlideSelectionProvider>
        <SnapGuideProvider>
          <TextBoxPlacementProvider>
            <CourseBuilderInner {...props} />
          </TextBoxPlacementProvider>
        </SnapGuideProvider>
      </SlideSelectionProvider>
    </ActiveEditorProvider>
  );
}

function CourseBuilderInner({
  course,
  initialVersion,
}: {
  course: Course;
  initialVersion: CourseVersion;
}) {
  const [lessons, setLessons] = useState<Lesson[]>(
    [...initialVersion.lessons].sort((a, b) => a.order - b.order),
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [publishing, setPublishing] = useState(false);
  const [, startTransition] = useTransition();
  const { selectedId } = useSlideSelection();
  const { panelRef } = useActiveEditorContext();
  const router = useRouter();

  // Latest known config per slide, read/written OUTSIDE React's render
  // cycle — see handleSlideConfigChange below for why. Refs must never be
  // written during render (React flags it, and it can silently break under
  // concurrent rendering), so this is populated lazily, only inside that
  // handler — a slide's first-ever edit in a session falls back to reading
  // `lessons` state directly (a plain closure read, safe in an event
  // handler), and every edit after that reads its own prior result back
  // out of the ref instead.
  const slideConfigRef = useRef(new Map<string, SlideConfig>());

  const selectedLesson = selection ? (lessons.find((l) => l.id === selection.lessonId) ?? null) : null;
  const selectedSlide =
    selection?.type === "slide"
      ? (selectedLesson?.slides.find((s) => s.id === selection.slideId) ?? null)
      : null;

  // --- Lessons ---

  function handleAddLesson() {
    startTransition(async () => {
      const lesson = await createLesson(initialVersion.id, lessons.length);
      setLessons((prev) => [...prev, lesson]);
      setSelection({ type: "lesson", lessonId: lesson.id });
    });
  }

  function handleLessonTitleChange(lessonId: string, title: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, title } : l)));
    startTransition(() => {
      updateLesson(lessonId, { title }).catch(() => {});
    });
  }

  function handleLessonDescriptionChange(lessonId: string, description: string) {
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, description } : l)));
    startTransition(() => {
      updateLesson(lessonId, { description }).catch(() => {});
    });
  }

  function handleDeleteLesson(lessonId: string) {
    setLessons((prev) => prev.filter((l) => l.id !== lessonId));
    setSelection((sel) => (sel?.lessonId === lessonId ? null : sel));
    startTransition(() => {
      deleteLesson(lessonId).catch(() => {});
    });
  }

  // Doesn't touch `lessons` state at all — saving a lesson as reusable
  // clones it into a separate library, it never changes the lesson itself.
  async function handleSaveLessonAsReusable(lessonId: string, name: string, description: string) {
    await saveLessonAsReusable(lessonId, name, description);
  }

  // Mirrors handleAddLesson's optimistic-append shape: the server does the
  // real cloning (services.import_reusable_lesson), this just appends
  // whatever Lesson it hands back.
  async function handleImportLesson(reusableLessonId: string) {
    const lesson = await importReusableLesson(initialVersion.id, reusableLessonId, lessons.length);
    setLessons((prev) => [...prev, lesson]);
    setSelection({ type: "lesson", lessonId: lesson.id });
  }

  function handleLessonDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Compute the reordered array up front and call setLessons/startTransition
    // as separate statements — calling startTransition from inside a setState
    // updater function is invalid (React: "Cannot call startTransition while
    // rendering"), since updater functions must be pure.
    const oldIndex = lessons.findIndex((l) => l.id === active.id);
    const newIndex = lessons.findIndex((l) => l.id === over.id);
    const reordered = arrayMove(lessons, oldIndex, newIndex).map((l, index) => ({ ...l, order: index }));
    setLessons(reordered);
    startTransition(() => {
      reorderLessons(reordered.map((l) => ({ id: l.id, order: l.order }))).catch(() => {});
    });
  }

  // --- Slides ---

  function handleAddSlide(lessonId: string, slideType: SlideType) {
    startTransition(async () => {
      const lesson = lessons.find((l) => l.id === lessonId);
      const order = lesson ? lesson.slides.length : 0;
      const slide = await createSlide(lessonId, slideType, order);
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, slides: [...l.slides, slide] } : l)),
      );
      setSelection({ type: "slide", lessonId, slideId: slide.id });
    });
  }

  function handleSlideChange(lessonId: string, slideId: string, data: Partial<Slide>) {
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? { ...l, slides: l.slides.map((s) => (s.id === slideId ? { ...s, ...data } : s)) }
          : l,
      ),
    );
    startTransition(() => {
      updateSlide(slideId, data).catch(() => {});
    });
  }

  // Config changes go through this dedicated path rather than
  // handleSlideChange, because config needs a MERGE (the backend's `config`
  // JSONField is replaced wholesale on save, not deep-merged, so every
  // PATCH must carry the slide's full config) and a merge needs the
  // CURRENT config to merge into. Reading that "current config" from a
  // render closure — `selectedSlide.config`, the way this used to work —
  // is a real bug, not a hypothetical one: two config changes fired close
  // together (e.g. typing body text, then pasting an image onto the same
  // slide moments later, both well inside typing debounce windows) both
  // read the SAME stale pre-either-change config, so whichever PATCH
  // effectively lands "second" wipes out the other's change — silent data
  // loss, reproduced while verifying the background-image feature (typed
  // body text, pasted an image, and the body text was gone after a
  // reload).
  //
  // The fix reads/writes slideConfigRef instead — a plain ref, not
  // `lessons` state — specifically because a setLessons functional updater
  // does NOT run synchronously when called (React defers invoking it to
  // when it flushes the update, which can be after this function has
  // already returned), so a second call arriving microseconds later can't
  // rely on "read inside the updater" to see the first call's result
  // either — and calling startTransition/updateSlide *inside* a setLessons
  // updater at all is its own bug (updater functions must stay pure; this
  // is the exact "Cannot call startTransition while rendering" class of
  // crash already fixed once before, for the drag-reorder handlers, and
  // reintroduced here on the first pass of this fix before being caught in
  // testing). A ref's read/write is genuinely synchronous with no
  // batching, so writing to it eagerly — before setLessons, before the
  // PATCH — is what actually guarantees the next call sees this call's
  // result, no matter how close together they happen. `lessons` (plain
  // state, safe to read here since this only ever runs in an event
  // handler, never during render) is the fallback for a slide's first-ever
  // edit, before the ref has anything recorded for it yet.
  function handleSlideConfigChange(lessonId: string, slideId: string, partialConfig: Partial<SlideConfig>) {
    const fallbackConfig = lessons.find((l) => l.id === lessonId)?.slides.find((s) => s.id === slideId)?.config;
    const currentConfig = slideConfigRef.current.get(slideId) ?? fallbackConfig ?? {};
    const mergedConfig: SlideConfig = { ...currentConfig, ...partialConfig };
    slideConfigRef.current.set(slideId, mergedConfig);

    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? { ...l, slides: l.slides.map((s) => (s.id === slideId ? { ...s, config: mergedConfig } : s)) }
          : l,
      ),
    );
    startTransition(() => {
      updateSlide(slideId, { config: mergedConfig }).catch(() => {});
    });
  }

  function handleDeleteSlide(lessonId: string, slideId: string) {
    setLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, slides: l.slides.filter((s) => s.id !== slideId) } : l)),
    );
    setSelection((sel) => (sel?.type === "slide" && sel.slideId === slideId ? null : sel));
    startTransition(() => {
      deleteSlide(slideId).catch(() => {});
    });
  }

  function handleSlideDragEnd(lessonId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    // Same fix as handleLessonDragEnd: compute first, then setLessons and
    // startTransition as separate statements (not nested in the updater).
    const slides = [...lesson.slides].sort((a, b) => a.order - b.order);
    const oldIndex = slides.findIndex((s) => s.id === active.id);
    const newIndex = slides.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(slides, oldIndex, newIndex).map((s, index) => ({ ...s, order: index }));
    setLessons((prev) => prev.map((l) => (l.id === lessonId ? { ...l, slides: reordered } : l)));
    startTransition(() => {
      reorderSlides(reordered.map((s) => ({ id: s.id, order: s.order }))).catch(() => {});
    });
  }

  // --- Publish ---

  function handlePublish() {
    setPublishing(true);
    startTransition(async () => {
      try {
        await publishVersion(course.id, initialVersion.id);
        router.push(`/courses/${course.id}`);
      } finally {
        setPublishing(false);
      }
    });
  }

  // Object selection (a text box or image WITHIN the current slide) takes
  // priority over the slide's own view — the whole point of this feature is
  // that selecting something on the canvas replaces the normal per-slide
  // properties with that object's own controls. `selectedId` comes from
  // slide-selection-context.tsx and is completely independent of `selection`
  // above (course-builder's own lesson/slide picker state) — see
  // parseSelectedObject's own comment for why a selectedId left over from a
  // different slide can never incorrectly match here.
  const selectedObject = parseSelectedObject(selectedId, selectedSlide?.id);

  const panelProps: PropertiesPanelProps =
    selectedSlide && selectedLesson && selectedObject
      ? {
          kind: "object",
          slide: selectedSlide,
          object: selectedObject,
          courseVersionId: initialVersion.id,
          onConfigChange: (config) => handleSlideConfigChange(selectedLesson.id, selectedSlide.id, config),
        }
      : selectedSlide && selectedLesson
        ? {
            kind: "slide",
            slide: selectedSlide,
            courseVersionId: initialVersion.id,
            onConfigChange: (config) => handleSlideConfigChange(selectedLesson.id, selectedSlide.id, config),
            onTitleChange: (title) => handleSlideChange(selectedLesson.id, selectedSlide.id, { title }),
            onDelete: () => handleDeleteSlide(selectedLesson.id, selectedSlide.id),
          }
        : selectedLesson
          ? {
              kind: "lesson",
              lesson: selectedLesson,
              onDescriptionChange: (v) => handleLessonDescriptionChange(selectedLesson.id, v),
              onDelete: () => handleDeleteLesson(selectedLesson.id),
            }
          : { kind: "empty" };

  const panelKey = selectedObject
    ? `object-${selectedId}`
    : selection
      ? selection.type === "lesson"
        ? `lesson-${selection.lessonId}`
        : `slide-${selection.slideId}`
      : "empty";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            render={<Link href={`/courses/${course.id}`} aria-label="Back to course" />}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{course.name}</h1>
            <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">Draft</Badge>
              <span>Version {initialVersion.version_number}</span>
            </div>
          </div>
        </div>
        <Button disabled={publishing} onClick={handlePublish}>
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="w-60 shrink-0">
          <SlideRail
            lessons={lessons}
            selectedLessonId={selection?.type === "lesson" ? selection.lessonId : null}
            selectedSlideId={selection?.type === "slide" ? selection.slideId : null}
            onSelectLesson={(lessonId) => setSelection({ type: "lesson", lessonId })}
            onSelectSlide={(lessonId, slideId) => setSelection({ type: "slide", lessonId, slideId })}
            onLessonTitleChange={handleLessonTitleChange}
            onDeleteLesson={handleDeleteLesson}
            onDeleteSlide={handleDeleteSlide}
            onSlideDragEnd={handleSlideDragEnd}
            onLessonDragEnd={handleLessonDragEnd}
            onAddSlide={handleAddSlide}
            onAddLesson={handleAddLesson}
            onSaveLessonAsReusable={handleSaveLessonAsReusable}
            onImportLesson={handleImportLesson}
          />
        </div>

        <SlideCanvas
          slide={selectedSlide}
          courseVersionId={initialVersion.id}
          onTitleChange={(title) => {
            if (selectedLesson && selectedSlide) handleSlideChange(selectedLesson.id, selectedSlide.id, { title });
          }}
          onConfigChange={(config) => {
            if (selectedLesson && selectedSlide)
              handleSlideConfigChange(selectedLesson.id, selectedSlide.id, config);
          }}
        />

        {/* panelRef/panelInteractingRef (active-editor-context.tsx) point at
            THIS stable wrapper, not the PropertiesPanel instance inside it —
            switching between lesson/slide/object views remounts the panel
            (key={panelKey}) but never this div, so a text editor's onBlur
            guard (and slide-selection-context's own outside-click checks)
            can reliably tell "focus moved into the panel" regardless of
            which view is currently showing. */}
        <div ref={panelRef} className="w-64 shrink-0 overflow-y-auto rounded-lg border-2 border-border bg-card shadow-sm">
          <PropertiesPanel key={panelKey} {...panelProps} />
        </div>
      </div>
    </div>
  );
}
